import { describe, it, expect } from 'vitest';
import { withRowPostPath } from './rowPostPath';

// SXADV-6052 (difetto trovato): il digitato del pannello di riga finiva sulla
// riga che il server ricordava (l'ultima aggiunta), non su quella del pannello.
// Contratto: CORE/docs/20261013_SXADV-6052_postpath_della_riga_in_modifica.md
//
// withRowPostPath(params, editNavpath): con una riga in modifica nel pannello
// ogni azione porta anche postPath = percorso di quella riga; un postPath gia'
// messo da chi chiama vince; senza riga in modifica il parametro non parte.

// Percorsi della riproduzione sulla Prima Nota (Reg. contabili).
const LISTA = 'S1-0.0,S1-9.1'; // navpath del Nuovo: la lista, posizione della resa
const RIGA_PANNELLO = 'S1-0.0,S1-9.0'; // riga 1, aperta nel pannello

describe('withRowPostPath: senza riga in modifica', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['stringa vuota', ''],
  ])('editNavpath %s: params invariati, nessuna chiave postPath', (_n, edit) => {
    const params = { navpath: LISTA };
    const out = withRowPostPath(params, edit as string | null | undefined);
    expect(out).toEqual({ navpath: LISTA });
    expect('postPath' in out).toBe(false);
  });

  it('params vuoti e nessuna riga: restano vuoti', () => {
    expect(withRowPostPath({}, null)).toEqual({});
  });
});

describe('withRowPostPath: con riga in modifica', () => {
  it('Nuovo del pannello: navpath resta la lista, postPath e la riga del pannello', () => {
    const out = withRowPostPath({ navpath: LISTA }, RIGA_PANNELLO);
    expect(out).toEqual({ navpath: LISTA, postPath: RIGA_PANNELLO });
  });

  it('postPath parte anche quando coincide con il navpath', () => {
    const out = withRowPostPath({ navpath: RIGA_PANNELLO }, RIGA_PANNELLO);
    expect(out).toEqual({ navpath: RIGA_PANNELLO, postPath: RIGA_PANNELLO });
  });

  it('parte anche senza navpath nei params', () => {
    const out = withRowPostPath({}, RIGA_PANNELLO);
    expect(out).toEqual({ postPath: RIGA_PANNELLO });
    expect('navpath' in out).toBe(false);
  });

  it('le altre chiavi restano identiche', () => {
    const params = { navpath: LISTA, option1: 'descrizione', messages: 'CONF1,', full: '1' };
    const out = withRowPostPath(params, RIGA_PANNELLO);
    expect(out).toEqual({
      navpath: LISTA,
      option1: 'descrizione',
      messages: 'CONF1,',
      full: '1',
      postPath: RIGA_PANNELLO,
    });
  });

  it('il percorso viene copiato tale e quale (niente normalizzazioni)', () => {
    const strano = 'S2-3.-1,S2-14.12';
    expect(withRowPostPath({ navpath: 'S2-14' }, strano).postPath).toBe(strano);
  });
});

describe('withRowPostPath: postPath gia messo da chi chiama', () => {
  it('un postPath non vuoto vince: params invariati', () => {
    const params = { navpath: LISTA, postPath: 'S1-0.0,S1-9.3' };
    const out = withRowPostPath(params, RIGA_PANNELLO);
    expect(out).toEqual({ navpath: LISTA, postPath: 'S1-0.0,S1-9.3' });
  });

  it('un postPath vuoto conta come assente: si mette la riga del pannello', () => {
    const out = withRowPostPath({ navpath: LISTA, postPath: '' }, RIGA_PANNELLO);
    expect(out).toEqual({ navpath: LISTA, postPath: RIGA_PANNELLO });
  });

  it('postPath vuoto e nessuna riga in modifica: params invariati', () => {
    const out = withRowPostPath({ navpath: LISTA, postPath: '' }, null);
    expect(out).toEqual({ navpath: LISTA, postPath: '' });
  });
});

describe("withRowPostPath: l'input non viene mutato", () => {
  it('aggiungendo postPath restituisce un oggetto nuovo e lascia i params come erano', () => {
    const params = { navpath: LISTA, option1: 'x' };
    const snapshot = { ...params };
    const out = withRowPostPath(params, RIGA_PANNELLO);
    expect(out).not.toBe(params);
    expect(params).toEqual(snapshot);
    expect('postPath' in params).toBe(false);
  });

  it('sostituendo un postPath vuoto non tocca i params', () => {
    const params = { navpath: LISTA, postPath: '' };
    const out = withRowPostPath(params, RIGA_PANNELLO);
    expect(out).not.toBe(params);
    expect(params.postPath).toBe('');
  });

  it('params congelati: non lancia', () => {
    const params = Object.freeze({ navpath: LISTA });
    expect(() => withRowPostPath(params, RIGA_PANNELLO)).not.toThrow();
  });

  it('modificare il risultato non tocca i params', () => {
    const params = { navpath: LISTA };
    const out = withRowPostPath(params, RIGA_PANNELLO);
    out.navpath = 'altro';
    expect(params.navpath).toBe(LISTA);
  });
});

// Terzo parametro sid: la riga in modifica e' una sola per tutte le schede e il
// cambio scheda non la azzera; il server cerca il percorso solo nella Session
// della richiesta (altrimenti NoSessionException). Se sid e' dato e il percorso
// non comincia con `${sid}-`, postPath non parte.
describe('withRowPostPath: la riga in modifica deve stare nella sessione della richiesta', () => {
  it('stessa sessione: postPath parte', () => {
    expect(withRowPostPath({ navpath: LISTA }, RIGA_PANNELLO, 'S1')).toEqual({
      navpath: LISTA,
      postPath: RIGA_PANNELLO,
    });
  });

  it('altra sessione (S2 con un percorso S1): params invariati, niente postPath', () => {
    const params = { navpath: 'S2-0.0,S2-4.2' };
    const out = withRowPostPath(params, RIGA_PANNELLO, 'S2');
    expect(out).toEqual({ navpath: 'S2-0.0,S2-4.2' });
    expect('postPath' in out).toBe(false);
  });

  it("prefisso ambiguo: sid 'S1' non accetta un percorso S10", () => {
    const out = withRowPostPath({ navpath: LISTA }, 'S10-0.0,S10-9.0', 'S1');
    expect('postPath' in out).toBe(false);
  });

  it("prefisso ambiguo: sid 'S10' non accetta un percorso S1", () => {
    const out = withRowPostPath({ navpath: 'S10-0.0,S10-9.1' }, RIGA_PANNELLO, 'S10');
    expect('postPath' in out).toBe(false);
  });

  it("sid 'S10' con un percorso S10: postPath parte", () => {
    expect(withRowPostPath({}, 'S10-0.0,S10-9.0', 'S10').postPath).toBe('S10-0.0,S10-9.0');
  });

  it.each([
    ['undefined', undefined],
    ['stringa vuota', ''],
  ])('sid %s: come senza sid, postPath parte', (_n, sid) => {
    expect(withRowPostPath({ navpath: LISTA }, RIGA_PANNELLO, sid as string | undefined)).toEqual({
      navpath: LISTA,
      postPath: RIGA_PANNELLO,
    });
  });

  it('sid dato ma nessuna riga in modifica: params invariati', () => {
    expect(withRowPostPath({ navpath: LISTA }, null, 'S1')).toEqual({ navpath: LISTA });
  });

  it('il postPath esplicito di chi chiama vince anche con un sid diverso', () => {
    const params = { navpath: 'S2-0.0,S2-4.1', postPath: 'S2-0.0,S2-4.0' };
    expect(withRowPostPath(params, RIGA_PANNELLO, 'S2')).toEqual({
      navpath: 'S2-0.0,S2-4.1',
      postPath: 'S2-0.0,S2-4.0',
    });
  });

  it('sessione diversa: input non mutato', () => {
    const params = { navpath: 'S2-0.0,S2-4.2' };
    withRowPostPath(params, RIGA_PANNELLO, 'S2');
    expect(params).toEqual({ navpath: 'S2-0.0,S2-4.2' });
  });
});
