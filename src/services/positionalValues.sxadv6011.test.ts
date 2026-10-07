import { describe, it, expect } from 'vitest';
import { withoutPositionalArrays } from './positionalValues';

// SXADV-6011 (difetto trovato): con un navpath che punta una riga di una lista,
// gli array di colonna di quel view state scrivono sulla riga puntata il valore
// della riga 1. withoutPositionalArrays li toglie prima della spedizione.
// Contratto: docs/features/20261007_SXADV-6011_valori_posizionali.md

type Values = Record<string, string | string[]>;

function deepFreeze<T extends object>(o: T): T {
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object') Object.freeze(v);
  }
  return Object.freeze(o);
}

describe('withoutPositionalArrays — caso reale', () => {
  it('Prima Nota dopo F5 + Nuovo: via gli array di S1-9, restano gli scalari', () => {
    const values: Values = {
      'descrizione.S1-9': ['riga uno', ''],
      'dare.S1-9': ['100,00', ''],
      'dataReg.S1-0': '07/10/2026',
    };
    const out = withoutPositionalArrays(values, 'S1-0.0,S1-9.1');
    expect(out).toEqual({ 'dataReg.S1-0': '07/10/2026' });
  });

  it('gli scalari dello stesso view state puntato restano (campi del pannello)', () => {
    const values: Values = {
      'descrizione.S1-9': 'dal pannello',
      'dare.S1-9': ['100,00', ''],
    };
    const out = withoutPositionalArrays(values, 'S1-0.0,S1-9.1');
    expect(out).toEqual({ 'descrizione.S1-9': 'dal pannello' });
  });

  it('gli array di altri view state restano', () => {
    const values: Values = {
      'descrizione.S1-9': ['a', 'b'],
      'importo.S1-12': ['1', '2'],
      'sel.S1-4': ['on'],
    };
    const out = withoutPositionalArrays(values, 'S1-0.0,S1-9.1');
    expect(out).toEqual({ 'importo.S1-12': ['1', '2'], 'sel.S1-4': ['on'] });
  });

  it('il segmento della testata (S1-0.0) toglie anche gli array di S1-0', () => {
    const values: Values = { 'x.S1-0': ['a', 'b'], 'y.S1-0': 'z' };
    const out = withoutPositionalArrays(values, 'S1-0.0,S1-9.1');
    expect(out).toEqual({ 'y.S1-0': 'z' });
  });
});

describe('withoutPositionalArrays — navpath che non punta righe', () => {
  const values: Values = {
    'descrizione.S1-9': ['riga uno', ''],
    'dataReg.S1-0': '07/10/2026',
  };

  for (const nav of [undefined, null, '']) {
    it(`navpath ${JSON.stringify(nav)}: tutto resta`, () => {
      expect(withoutPositionalArrays(values, nav)).toEqual(values);
    });
  }

  it("segmento senza posizione ('S1-9', ListActions) non toglie", () => {
    expect(withoutPositionalArrays(values, 'S1-9')).toEqual(values);
  });

  it("catena con l'unico segmento puntato su un altro view state non tocca S1-9", () => {
    expect(withoutPositionalArrays(values, 'S1-0,S1-9')).toEqual(values);
  });
});

describe('withoutPositionalArrays — forma del segmento', () => {
  it("posizione negativa ('S1-0.-1', record nuovo della testata) punta", () => {
    const values: Values = { 'a.S1-0': ['1', '2'], 'b.S1-0': 's' };
    expect(withoutPositionalArrays(values, 'S1-0.-1')).toEqual({ 'b.S1-0': 's' });
  });

  it("top-level a un segmento ('S1-3.2') toglie 'selected.S1-3'", () => {
    const values: Values = { 'selected.S1-3': ['on', '', 'on'], 'q.S1-3': 'x' };
    expect(withoutPositionalArrays(values, 'S1-3.2')).toEqual({ 'q.S1-3': 'x' });
  });

  it('un array vuoto e\' comunque un array: si toglie', () => {
    const values: Values = { 'sel.S1-9': [], 'n.S1-9': '' };
    expect(withoutPositionalArrays(values, 'S1-0.0,S1-9.1')).toEqual({ 'n.S1-9': '' });
  });

  it('nomi campo con punti: conta solo il suffisso .<id>', () => {
    const values: Values = {
      'conto.sottoconto.descr.S1-9': ['a', 'b'],
      'conto.sottoconto.descr.S1-12': ['c'],
      'conto.codice.S1-9': 'k',
    };
    expect(withoutPositionalArrays(values, 'S1-9.0')).toEqual({
      'conto.sottoconto.descr.S1-12': ['c'],
      'conto.codice.S1-9': 'k',
    });
  });
});

describe('withoutPositionalArrays — confronto esatto sull\'id', () => {
  const values: Values = {
    'x.S1-9': ['a'],
    'x.S11-9': ['b'],
    'x.S1-90': ['c'],
  };

  it('navpath su S1-9: non tocca S11-9 ne\' S1-90', () => {
    expect(withoutPositionalArrays(values, 'S1-9.0')).toEqual({
      'x.S11-9': ['b'],
      'x.S1-90': ['c'],
    });
  });

  it('navpath su S11-9: non tocca S1-9 ne\' S1-90', () => {
    expect(withoutPositionalArrays(values, 'S11-9.0')).toEqual({
      'x.S1-9': ['a'],
      'x.S1-90': ['c'],
    });
  });

  it('navpath su S1-90: non tocca S1-9 ne\' S11-9', () => {
    expect(withoutPositionalArrays(values, 'S1-90.3')).toEqual({
      'x.S1-9': ['a'],
      'x.S11-9': ['b'],
    });
  });

  it("chiave che contiene l'id senza punto davanti non conta ('xS1-9')", () => {
    const v: Values = { 'xS1-9': ['a'], 'x.S1-9': ['b'] };
    expect(withoutPositionalArrays(v, 'S1-9.0')).toEqual({ 'xS1-9': ['a'] });
  });
});

describe('withoutPositionalArrays — immutabilita\'', () => {
  it('input congelato: nessuna eccezione, input invariato, oggetto nuovo', () => {
    const values = deepFreeze<Values>({
      'descrizione.S1-9': ['riga uno', ''],
      'dataReg.S1-0': '07/10/2026',
    });
    const snapshot = JSON.parse(JSON.stringify(values));
    const out = withoutPositionalArrays(values, 'S1-0.0,S1-9.1');
    expect(values).toEqual(snapshot);
    expect(out).not.toBe(values);
    expect(out).toEqual({ 'dataReg.S1-0': '07/10/2026' });
  });

  it('niente da togliere: input invariato anche se si restituisce una copia', () => {
    const values = deepFreeze<Values>({ 'a.S1-2': ['1', '2'], b: 'c' });
    const snapshot = JSON.parse(JSON.stringify(values));
    const out = withoutPositionalArrays(values, 'S1-9.1');
    expect(values).toEqual(snapshot);
    expect(out).toEqual(snapshot);
  });

  it("modificare l'uscita non tocca l'input", () => {
    const values: Values = { 'a.S1-2': 'x', 'b.S1-9': ['1'] };
    const out = withoutPositionalArrays(values, 'S1-9.0');
    out['a.S1-2'] = 'cambiato';
    expect(values['a.S1-2']).toBe('x');
    expect(values['b.S1-9']).toEqual(['1']);
  });
});
