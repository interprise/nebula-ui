import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postAction, postAction2, executeMenuItem, isSidBusy } from './api';

// SXADV-5927, contratto P7''' (quarta revisione). La pulizia dei ritorni armati
// (Shell, settleReturns) guarda le richieste in volo della SOLA sessione:
// `isSidBusy(sid)`, un contatore per `params.sid` dentro post(). Deve:
//   - salire mentre la richiesta e' in volo;
//   - essere gia' sceso quando il chiamante riceve la risposta (Shell decide
//     applicando quella risposta: se contasse ancora se stessa non chiuderebbe mai);
//   - non contare le altre sessioni (job, altre schede);
//   - scendere anche se la richiesta fallisce.

/** fetch finto: ogni chiamata resta appesa finche' il test non la chiude. */
type Appesa = { risolvi: (r: Response) => void; rifiuta: (e: unknown) => void; body: URLSearchParams };
let appese: Appesa[];

beforeEach(() => {
  appese = [];
  vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((risolvi, rifiuta) => {
    appese.push({ risolvi, rifiuta, body: new URLSearchParams(String(init?.body ?? '')) });
  })));
});

afterEach(async () => {
  // Nessuna richiesta deve restare appesa fra un test e l'altro (il contatore e' di modulo).
  for (const a of appese) a.risolvi(new Response('{}', { status: 200 }));
  await new Promise((r) => setTimeout(r, 0));
  vi.unstubAllGlobals();
});

const ok = () => new Response('{}', { status: 200 });
const prossimoGiro = () => new Promise((r) => setTimeout(r, 0));

describe("isSidBusy — P7'''", () => {
  it('a riposo nessuna sessione e\' occupata', () => {
    expect(isSidBusy('S1')).toBe(false);
    expect(isSidBusy('S2')).toBe(false);
  });

  it('sale durante postAction della sessione e scende alla risposta', async () => {
    const p = postAction('Add', { navpath: 'S1-9' }, undefined, 'S1');
    await prossimoGiro();
    expect(appese).toHaveLength(1);
    expect(isSidBusy('S1')).toBe(true);
    appese[0].risolvi(ok());
    await p;
    expect(isSidBusy('S1')).toBe(false);
  });

  it('e\' gia\' sceso quando il chiamante vede la risposta', async () => {
    const p = postAction('Add', {}, undefined, 'S1');
    await prossimoGiro();
    let vistoDalChiamante: boolean | null = null;
    const fatto = p.then(() => { vistoDalChiamante = isSidBusy('S1'); });
    appese[0].risolvi(ok());
    await fatto;
    expect(vistoDalChiamante).toBe(false);
  });

  it('le altre sessioni non contano', async () => {
    const p = postAction('Add', {}, undefined, 'S2');
    await prossimoGiro();
    expect(isSidBusy('S2')).toBe(true);
    expect(isSidBusy('S1')).toBe(false);
    expect(isSidBusy('S20')).toBe(false);
    appese[0].risolvi(ok());
    await p;
  });

  it('due richieste in volo sulla stessa sessione: occupata finche\' non finisce l\'ultima', async () => {
    const a = postAction('Post', {}, undefined, 'S1');
    const b = postAction('Refresh', {}, undefined, 'S1');
    await prossimoGiro();
    expect(appese).toHaveLength(2);
    appese[0].risolvi(ok());
    await a;
    expect(isSidBusy('S1')).toBe(true);
    appese[1].risolvi(ok());
    await b;
    expect(isSidBusy('S1')).toBe(false);
  });

  it('una richiesta che fallisce in rete scende lo stesso', async () => {
    const p = postAction('Add', {}, undefined, 'S1');
    await prossimoGiro();
    expect(isSidBusy('S1')).toBe(true);
    appese[0].rifiuta(new TypeError('Failed to fetch'));
    await expect(p).rejects.toBeTruthy();
    expect(isSidBusy('S1')).toBe(false);
  });

  it('una risposta HTTP di errore scende lo stesso, anche se il chiamante riceve un errore', async () => {
    const p = postAction('Add', {}, undefined, 'S1');
    await prossimoGiro();
    let vistoDalChiamante: boolean | null = null;
    const fatto = p.catch(() => { vistoDalChiamante = isSidBusy('S1'); });
    appese[0].risolvi(new Response('boom', { status: 500, statusText: 'Internal Server Error' }));
    await fatto;
    expect(vistoDalChiamante).toBe(false);
  });

  it('executeMenuItem conta per la sua sessione', async () => {
    const p = executeMenuItem('menu.documenti.FA', 'S3');
    await prossimoGiro();
    expect(isSidBusy('S3')).toBe(true);
    expect(isSidBusy('S1')).toBe(false);
    appese[0].risolvi(ok());
    await p;
    expect(isSidBusy('S3')).toBe(false);
  });

  it('una richiesta senza sid (postAction2 di /controller2) non occupa nessuna sessione', async () => {
    const p = postAction2('JSONMenu');
    await prossimoGiro();
    expect(appese[0].body.get('sid')).toBeNull();
    expect(isSidBusy('S1')).toBe(false);
    expect(isSidBusy('')).toBe(false);
    appese[0].risolvi(ok());
    await p;
  });

  it('postAction2 con sid nei parametri conta per quella sessione (il contatore segue params.sid)', async () => {
    const p = postAction2('Qualcosa', { sid: 'S4' });
    await prossimoGiro();
    expect(isSidBusy('S4')).toBe(true);
    appese[0].risolvi(ok());
    await p;
    expect(isSidBusy('S4')).toBe(false);
  });

  it('dopo molti giri, fra successi ed errori, il contatore torna a zero', async () => {
    for (let i = 0; i < 5; i++) {
      const p = postAction('Post', {}, undefined, 'S1');
      await prossimoGiro();
      const a = appese[appese.length - 1];
      if (i % 2) a.rifiuta(new Error('x')); else a.risolvi(ok());
      await p.catch(() => {});
    }
    expect(isSidBusy('S1')).toBe(false);
  });
});
