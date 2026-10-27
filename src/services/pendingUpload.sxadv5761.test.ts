import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// SXADV-5761 — "Carica da File Excel": scegliere il file non spedisce niente
// (legacy ui.js: il campo file tiene il file). Lo spedisce Salva/Post: prima
// la POST multipart col solo file (FileUpload o il comando del controllo), e
// SOLO se va a buon fine l'azione vera. uiData.cdmsKey trasforma il seguito in
// CdmsEdit navpath=<cdmsKey>. Il negozio e' per sid, al massimo un file.

const api = vi.hoisted(() => ({
  calls: [] as { file: File; sid: string; params: Record<string, string>; action: string }[],
  impl: null as null | ((...a: unknown[]) => Promise<unknown>),
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  uploadFile: (file: File, sid: string, params: Record<string, string>, action: string) => {
    api.calls.push({ file, sid, params: { ...params }, action });
    return api.impl ? api.impl(file, sid, params, action) : Promise.resolve({});
  },
}));

const P = await import('./pendingUpload');

const file = (name = 'listino.xlsx') => new File(['x'], name);
const pending = (over: Partial<import('./pendingUpload').PendingUpload> = {}) => ({
  file: file(),
  params: { option1: 'fileExcel', navpath: 'S1-3' },
  action: 'FileUpload',
  ...over,
});

// Upload tenuti in volo dal caso: a fine caso si chiudono tutti, cosi' lo
// stato del modulo (file in volo per sid) non passa al caso successivo.
const inFlight: ((v: unknown) => void)[] = [];
const hold = () => new Promise((res) => { inFlight.push(res); });
afterEach(async () => {
  while (inFlight.length) inFlight.shift()!({});
  await new Promise((r) => setTimeout(r, 0));
});

/** Vero se la promessa e' ancora pendente dopo un giro di microtask. */
async function stillPending(p: Promise<unknown>): Promise<boolean> {
  let done = false;
  void p.then(() => { done = true; }, () => { done = true; });
  await new Promise((r) => setTimeout(r, 0));
  return !done;
}

beforeEach(() => {
  api.calls = [];
  api.impl = null;
  for (const sid of ['S1', 'S2', 'S3']) P.clearPendingUpload(sid);
});

describe('negozio per sid', () => {
  it('set/get/clear', () => {
    const p = pending();
    expect(P.getPendingUpload('S1')).toBeUndefined();
    P.setPendingUpload('S1', p);
    expect(P.getPendingUpload('S1')).toBe(p);
    P.clearPendingUpload('S1');
    expect(P.getPendingUpload('S1')).toBeUndefined();
  });

  it('un secondo set sostituisce il primo (al massimo un file per sid)', () => {
    const a = pending({ file: file('a.xlsx') });
    const b = pending({ file: file('b.xlsx') });
    P.setPendingUpload('S1', a);
    P.setPendingUpload('S1', b);
    expect(P.getPendingUpload('S1')?.file.name).toBe('b.xlsx');
  });

  it('i sid sono indipendenti', () => {
    P.setPendingUpload('S1', pending({ file: file('uno.xlsx') }));
    P.setPendingUpload('S2', pending({ file: file('due.xlsx') }));
    P.clearPendingUpload('S1');
    expect(P.getPendingUpload('S1')).toBeUndefined();
    expect(P.getPendingUpload('S2')?.file.name).toBe('due.xlsx');
  });

  it('subscribe: notifica su set e clear del proprio sid, non degli altri; unsubscribe ferma', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const off1 = P.subscribePendingUpload('S1', cb1);
    P.subscribePendingUpload('S2', cb2);
    P.setPendingUpload('S1', pending());
    expect(cb1).toHaveBeenCalledTimes(1);
    P.clearPendingUpload('S1');
    expect(cb1).toHaveBeenCalledTimes(2);
    expect(cb2).not.toHaveBeenCalled();
    off1();
    P.setPendingUpload('S1', pending());
    expect(cb1).toHaveBeenCalledTimes(2);
  });

  it('subscribe: notifica quando un flush riuscito toglie il file', async () => {
    P.setPendingUpload('S1', pending());
    const cb = vi.fn();
    P.subscribePendingUpload('S1', cb);
    await P.flushPendingUpload('S1', 'Save', {});
    expect(P.getPendingUpload('S1')).toBeUndefined();
    expect(cb).toHaveBeenCalled();
  });
});

describe('flushPendingUpload: quando NON spedisce', () => {
  it('niente in attesa: ok invariato, nessuna richiesta', async () => {
    const r = await P.flushPendingUpload('S1', 'Save', { a: '1' });
    expect(r).toEqual({ ok: true, action: 'Save', params: { a: '1' } });
    expect(api.calls).toHaveLength(0);
  });

  it.each(['ExecuteQuery', 'Cancel', 'Refresh', 'Add', 'Delete', 'FileUpload', 'save'])(
    'azione %s: non e\' Save/Post, il file resta e non parte niente', async (action) => {
      const p = pending();
      P.setPendingUpload('S1', p);
      const r = await P.flushPendingUpload('S1', action, { x: 'y' });
      expect(r).toEqual({ ok: true, action, params: { x: 'y' } });
      expect(api.calls).toHaveLength(0);
      expect(P.getPendingUpload('S1')).toBe(p);
    });

  it('vista diversa da quella del file (l\'utente e\' uscito): il file si scarta, nessuna richiesta', async () => {
    P.setPendingUpload('S1', pending({ viewName: 'caricaExcelDetail' }));
    const r = await P.flushPendingUpload('S1', 'Save', { a: '1' }, 'altraVistaDetail');
    expect(r).toEqual({ ok: true, action: 'Save', params: { a: '1' } });
    expect(api.calls).toHaveLength(0);
    expect(P.getPendingUpload('S1')).toBeUndefined();
  });

  it('vista assente sul file: nessun controllo di vista, si spedisce', async () => {
    P.setPendingUpload('S1', pending());
    await P.flushPendingUpload('S1', 'Save', {}, 'qualunqueDetail');
    expect(api.calls).toHaveLength(1);
  });
});

describe('flushPendingUpload: Save/Post con un file in attesa', () => {
  it.each(['Save', 'Post'])('%s: uploadFile una volta, con file, sid, params e azione del file', async (action) => {
    const p = pending({ action: 'CdmsUpload', viewName: 'caricaExcelDetail' });
    P.setPendingUpload('S2', p);
    const r = await P.flushPendingUpload('S2', action, { navpath: 'S2-1' }, 'caricaExcelDetail');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].file).toBe(p.file);
    expect(api.calls[0].sid).toBe('S2');
    expect(api.calls[0].params).toEqual({ option1: 'fileExcel', navpath: 'S1-3' });
    expect(api.calls[0].action).toBe('CdmsUpload');
    expect(r).toEqual({ ok: true, action, params: { navpath: 'S2-1' } });
    expect(P.getPendingUpload('S2')).toBeUndefined();
  });

  it('cdmsKey nella risposta: il seguito diventa CdmsEdit navpath=<cdmsKey>', async () => {
    api.impl = async () => ({ uiData: { cdmsKey: 'CDMS-42' } });
    P.setPendingUpload('S1', pending());
    const r = await P.flushPendingUpload('S1', 'Post', { foo: 'bar' });
    expect(r).toEqual({ ok: true, action: 'CdmsEdit', params: { navpath: 'CDMS-42' } });
    expect(P.getPendingUpload('S1')).toBeUndefined();
  });

  it('errore ERROR nella risposta: ok=false con gli errori, il file resta in attesa', async () => {
    const errors = [{ type: 'ERROR', message: 'Formato non valido', mnemonic: 'BAD_FMT' }];
    api.impl = async () => ({ errors });
    const p = pending();
    P.setPendingUpload('S1', p);
    const r = await P.flushPendingUpload('S1', 'Save', {});
    expect(r.ok).toBe(false);
    expect((r as { errors?: unknown[] }).errors).toEqual(errors);
    expect(P.getPendingUpload('S1')).toBe(p);
  });

  it('solo messaggi non ERROR (WARNING/INFO): l\'upload vale come riuscito', async () => {
    api.impl = async () => ({ errors: [{ type: 'WARNING', message: 'attenzione' }] });
    P.setPendingUpload('S1', pending());
    const r = await P.flushPendingUpload('S1', 'Save', {});
    expect(r).toEqual({ ok: true, action: 'Save', params: {} });
    expect(P.getPendingUpload('S1')).toBeUndefined();
  });

  it('eccezione: ok=false con error, il file resta in attesa', async () => {
    const boom = new Error('rete giu');
    api.impl = async () => { throw boom; };
    const p = pending();
    P.setPendingUpload('S1', p);
    const r = await P.flushPendingUpload('S1', 'Save', {});
    expect(r.ok).toBe(false);
    expect((r as { error?: unknown }).error).toBe(boom);
    expect(P.getPendingUpload('S1')).toBe(p);
  });

  it('dopo un errore, il secondo Salva rispedisce lo stesso file', async () => {
    let n = 0;
    api.impl = async () => (n++ === 0 ? { errors: [{ type: 'ERROR', message: 'no' }] } : {});
    const p = pending();
    P.setPendingUpload('S1', p);
    expect((await P.flushPendingUpload('S1', 'Save', {})).ok).toBe(false);
    expect((await P.flushPendingUpload('S1', 'Save', {})).ok).toBe(true);
    expect(api.calls).toHaveLength(2);
    expect(api.calls[1].file).toBe(p.file);
  });

  it('Salva durante l\'upload dello stesso sid ASPETTA (coda legacy) e poi non rispedisce', async () => {
    let release!: (v: unknown) => void;
    api.impl = () => new Promise((res) => { release = res; });
    P.setPendingUpload('S1', pending());
    const first = P.flushPendingUpload('S1', 'Post', { a: '1' });
    const second = P.flushPendingUpload('S1', 'Save', { b: '2' });
    expect(await stillPending(second)).toBe(true);
    expect(api.calls).toHaveLength(1);
    release({});
    expect(await first).toEqual({ ok: true, action: 'Post', params: { a: '1' } });
    expect(await second).toEqual({ ok: true, action: 'Save', params: { b: '2' } });
    expect(api.calls).toHaveLength(1);
  });

  it('durante l\'upload si sceglie un altro file: il Salva in coda, a upload riuscito, carica il nuovo', async () => {
    let release!: (v: unknown) => void;
    api.impl = () => new Promise((res) => { release = res; });
    P.setPendingUpload('S1', pending({ file: file('vecchio.xlsx') }));
    const first = P.flushPendingUpload('S1', 'Post', {});
    P.setPendingUpload('S1', pending({ file: file('nuovo.xlsx') }));
    const second = P.flushPendingUpload('S1', 'Save', {});
    expect(await stillPending(second)).toBe(true);
    api.impl = async () => ({});
    release({});
    await first;
    expect(await second).toEqual({ ok: true, action: 'Save', params: {} });
    expect(api.calls.map((c) => c.file.name)).toEqual(['vecchio.xlsx', 'nuovo.xlsx']);
    expect(P.getPendingUpload('S1')).toBeUndefined();
  });

  it('l\'upload in volo fallisce: il Salva in coda torna ok=false SENZA errori (li mostra il primo) e non rispedisce', async () => {
    let release!: (v: unknown) => void;
    api.impl = () => new Promise((res) => { release = res; });
    const p = pending();
    P.setPendingUpload('S1', p);
    const first = P.flushPendingUpload('S1', 'Post', {});
    const second = P.flushPendingUpload('S1', 'Save', {});
    release({ errors: [{ type: 'ERROR', message: 'no' }] });
    const r1 = await first;
    const r2 = await second;
    expect(r1.ok).toBe(false);
    expect((r1 as { errors?: unknown[] }).errors).toHaveLength(1);
    expect(r2.ok).toBe(false);
    expect((r2 as { errors?: unknown }).errors).toBeUndefined();
    expect((r2 as { error?: unknown }).error).toBeUndefined();
    expect(api.calls).toHaveLength(1);
    expect(P.getPendingUpload('S1')).toBe(p);
  });

  it('l\'upload in volo lancia: il Salva in coda torna ok=false senza errori ne\' error', async () => {
    let fail!: (e: unknown) => void;
    api.impl = () => new Promise((_res, rej) => { fail = rej; });
    P.setPendingUpload('S1', pending());
    const first = P.flushPendingUpload('S1', 'Post', {});
    const second = P.flushPendingUpload('S1', 'Save', {});
    fail(new Error('rete giu'));
    expect((await first).ok).toBe(false);
    expect(await second).toEqual({ ok: false });
    expect(api.calls).toHaveLength(1);
  });

  it('un\'azione non Save/Post durante l\'upload non aspetta', async () => {
    api.impl = hold;
    P.setPendingUpload('S1', pending());
    void P.flushPendingUpload('S1', 'Post', {});
    const r = P.flushPendingUpload('S1', 'ExecuteQuery', {});
    expect(await stillPending(r)).toBe(false);
    expect(await r).toEqual({ ok: true, action: 'ExecuteQuery', params: {} });
  });

  it('un flush su un altro sid durante l\'upload spedisce il suo file e non aspetta', async () => {
    api.impl = hold;
    P.setPendingUpload('S1', pending({ file: file('uno.xlsx') }));
    void P.flushPendingUpload('S1', 'Save', {});
    api.impl = async () => ({});
    P.setPendingUpload('S2', pending({ file: file('due.xlsx') }));
    const r = P.flushPendingUpload('S2', 'Save', {});
    expect(await stillPending(r)).toBe(false);
    expect(api.calls.map((c) => [c.sid, c.file.name])).toEqual([['S1', 'uno.xlsx'], ['S2', 'due.xlsx']]);
  });

  it('upload fallito mentre ne era stato scelto uno nuovo: resta il nuovo, non quello vecchio', async () => {
    let release!: (v: unknown) => void;
    api.impl = () => new Promise((res) => { release = res; });
    P.setPendingUpload('S1', pending({ file: file('vecchio.xlsx') }));
    const first = P.flushPendingUpload('S1', 'Save', {});
    P.setPendingUpload('S1', pending({ file: file('nuovo.xlsx') }));
    release({ errors: [{ type: 'ERROR', message: 'no' }] });
    expect((await first).ok).toBe(false);
    expect(P.getPendingUpload('S1')?.file.name).toBe('nuovo.xlsx');
  });
});

describe('hasPendingUpload / cancelsUpload', () => {
  it('hasPendingUpload: falso senza file, vero in attesa e IN VOLO, falso a upload riuscito', async () => {
    let release!: (v: unknown) => void;
    api.impl = () => new Promise((res) => { release = res; });
    expect(P.hasPendingUpload('S1')).toBe(false);
    P.setPendingUpload('S1', pending());
    expect(P.hasPendingUpload('S1')).toBe(true);
    const f = P.flushPendingUpload('S1', 'Save', {});
    expect(P.getPendingUpload('S1')).toBeUndefined();
    expect(P.hasPendingUpload('S1')).toBe(true);
    expect(P.hasPendingUpload('S2')).toBe(false);
    release({});
    await f;
    expect(P.hasPendingUpload('S1')).toBe(false);
  });

  it('hasPendingUpload: vero di nuovo dopo un upload fallito (il file resta)', async () => {
    api.impl = async () => ({ errors: [{ type: 'ERROR', message: 'no' }] });
    P.setPendingUpload('S1', pending());
    await P.flushPendingUpload('S1', 'Save', {});
    expect(P.hasPendingUpload('S1')).toBe(true);
  });

  it('cancelsUpload: solo Cancel', () => {
    expect(P.cancelsUpload('Cancel')).toBe(true);
    for (const a of ['Save', 'Post', 'ExecuteQuery', 'cancel', 'CancelEdit', '']) expect(P.cancelsUpload(a)).toBe(false);
  });
});
