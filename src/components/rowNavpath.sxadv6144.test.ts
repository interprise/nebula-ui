import { describe, it, expect } from 'vitest';
import { withRowNavpath } from './rowPostPath';

// SXADV-6144/6146: una richiesta senza navpath porta come navpath la riga in
// modifica del pannello, ma solo se e' della sessione della richiesta (sid).
// Un navpath messo da chi chiama vince sempre. L'oggetto in ingresso non cambia.

const RIGA = 'S1-0.0,S1-9.1';
const RIGA_S12 = 'S12-0.0,S12-9.1';
const LISTA = 'S1-0.0,S1-9.0';

describe('withRowNavpath: senza riga in modifica', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['stringa vuota', ''],
  ])('editNavpath %s: params invariati, nessuna chiave navpath', (_n, edit) => {
    const out = withRowNavpath({ option1: 'x' }, edit as string | null | undefined, 'S1');
    expect(out).toEqual({ option1: 'x' });
    expect('navpath' in out).toBe(false);
  });

  it('params vuoti e nessuna riga: restano vuoti', () => {
    expect(withRowNavpath({}, null)).toEqual({});
  });
});

describe('withRowNavpath: con riga in modifica', () => {
  it('senza navpath: aggiunge la riga', () => {
    expect(withRowNavpath({}, RIGA, 'S1')).toEqual({ navpath: RIGA });
  });

  it('senza sid: aggiunge la riga', () => {
    expect(withRowNavpath({}, RIGA)).toEqual({ navpath: RIGA });
  });

  it('navpath vuoto nei params: conta come assente', () => {
    expect(withRowNavpath({ navpath: '' }, RIGA, 'S1')).toEqual({ navpath: RIGA });
  });

  it('navpath esplicito: vince sempre', () => {
    expect(withRowNavpath({ navpath: LISTA }, RIGA, 'S1')).toEqual({ navpath: LISTA });
    expect(withRowNavpath({ navpath: LISTA }, RIGA)).toEqual({ navpath: LISTA });
  });

  it('le altre chiavi restano identiche', () => {
    const out = withRowNavpath({ option1: 'descrizione', messages: 'CONF1,', postPath: RIGA }, RIGA, 'S1');
    expect(out).toEqual({ option1: 'descrizione', messages: 'CONF1,', postPath: RIGA, navpath: RIGA });
  });
});

describe('withRowNavpath: sessione della riga', () => {
  it('riga di un\'altra sessione: non parte', () => {
    expect(withRowNavpath({}, 'S2-0.0,S2-9.1', 'S1')).toEqual({});
  });

  it('S12 non e della sessione S1', () => {
    expect(withRowNavpath({}, RIGA_S12, 'S1')).toEqual({});
  });

  it('S1 non e della sessione S12', () => {
    expect(withRowNavpath({}, RIGA, 'S12')).toEqual({});
  });

  it('S12 nella sessione S12: parte', () => {
    expect(withRowNavpath({}, RIGA_S12, 'S12')).toEqual({ navpath: RIGA_S12 });
  });

  it('riga senza trattino dopo il sid: non e della sessione', () => {
    expect(withRowNavpath({}, 'S1', 'S1')).toEqual({});
  });

  it('sid vuoto: come sid assente', () => {
    expect(withRowNavpath({}, RIGA, '')).toEqual({ navpath: RIGA });
  });

  it('job J0: la riga di S1 non parte', () => {
    expect(withRowNavpath({}, RIGA, 'J0')).toEqual({});
  });
});

describe('withRowNavpath: immutabilita e idempotenza', () => {
  it('non modifica l\'oggetto in ingresso', () => {
    const params = Object.freeze({ option1: 'x' }) as Record<string, string>;
    const out = withRowNavpath(params, RIGA, 'S1');
    expect(params).toEqual({ option1: 'x' });
    expect(out).not.toBe(params);
    expect(out).toEqual({ option1: 'x', navpath: RIGA });
  });

  it('due passaggi danno lo stesso risultato di uno', () => {
    const una = withRowNavpath({}, RIGA, 'S1');
    expect(withRowNavpath(una, RIGA, 'S1')).toEqual(una);
    // il secondo passaggio con un'altra riga non sovrascrive
    expect(withRowNavpath(una, 'S1-0.0,S1-9.5', 'S1')).toEqual({ navpath: RIGA });
  });

  it('composto con withRowPostPath: navpath e postPath sono la stessa riga', async () => {
    const { withRowPostPath } = await import('./rowPostPath');
    const out = withRowPostPath(withRowNavpath({}, RIGA, 'S1'), RIGA, 'S1');
    expect(out).toEqual({ navpath: RIGA, postPath: RIGA });
  });
});
