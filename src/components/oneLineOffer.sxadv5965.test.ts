import { describe, it, expect } from 'vitest';
import { columnsOverflow, canOfferOneLine } from './oneLineOffer';

// SXADV-5965: il pulsante "un record per riga" (ListRenderer, canFlatten)
// oggi compare solo se la lista ha bande di continuazione. La lista "Tessere"
// ha ~60 colonne su una riga sola: niente bande, niente pulsante, eppure
// scorre in orizzontale ed e' proprio li' che bloccare le prime due colonne
// serve. Regola nuova: offrirlo anche quando le colonne non entrano.

const widths = (n: number, w: number): number[] => Array.from({ length: n }, () => w);

describe('columnsOverflow', () => {
  it('Tessere: 60 colonne da 100px in 1500px sforano', () => {
    expect(columnsOverflow(widths(60, 100), 1500)).toBe(true);
  });

  it('poche colonne in una vista larga non sforano', () => {
    expect(columnsOverflow([120, 80, 200], 1500)).toBe(false);
  });

  it('somma esattamente uguale alla vista non sfora', () => {
    expect(columnsOverflow([500, 500, 500], 1500)).toBe(false);
  });

  it('somma = vista + 1px e\' tolleranza di arrotondamento, non sforo', () => {
    expect(columnsOverflow([500, 500, 501], 1500)).toBe(false);
  });

  it('somma = vista + 1.5px sfora', () => {
    expect(columnsOverflow([500, 500, 501.5], 1500)).toBe(true);
  });

  it('somma = vista + 2px sfora', () => {
    expect(columnsOverflow([500, 500, 502], 1500)).toBe(true);
  });

  it('tolleranza con larghezze sub-pixel: 100.5 * 2 in 200px (+1) non sfora', () => {
    expect(columnsOverflow([100.5, 100.5], 200)).toBe(false);
  });

  it('array vuoto -> false', () => {
    expect(columnsOverflow([], 1500)).toBe(false);
  });

  it('array vuoto anche con vista non misurata -> false', () => {
    expect(columnsOverflow([], 0)).toBe(false);
  });

  describe('vista non misurata / nascosta -> false', () => {
    const many = widths(60, 100);
    it.each([
      ['0', 0],
      ['-0', -0],
      ['negativa', -100],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
    ])('viewport %s', (_label, vw) => {
      expect(columnsOverflow(many, vw)).toBe(false);
    });
  });

  it('vista minuscola ma positiva e finita misura davvero: sfora', () => {
    expect(columnsOverflow([10], 0.5)).toBe(true);
  });

  describe('larghezze spazzatura contano 0', () => {
    it('NaN non fa sforare', () => {
      expect(columnsOverflow([100, Number.NaN, 100], 300)).toBe(false);
    });

    it('Infinity non fa sforare', () => {
      expect(columnsOverflow([100, Number.POSITIVE_INFINITY], 300)).toBe(false);
    });

    it('-Infinity non azzera uno sforo reale', () => {
      expect(columnsOverflow([1000, Number.NEGATIVE_INFINITY], 300)).toBe(true);
    });

    it('una negativa non compensa le altre (sforo resta)', () => {
      // 400 + 0 = 400 > 300 + 1; se la negativa contasse sarebbe 200
      expect(columnsOverflow([400, -200], 300)).toBe(true);
    });

    it('una negativa non compensa: caso al limite', () => {
      expect(columnsOverflow([150, 152, -10], 300)).toBe(true);
    });

    it('solo spazzatura -> false', () => {
      expect(
        columnsOverflow([Number.NaN, -5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY], 100),
      ).toBe(false);
    });

    it('spazzatura mescolata a larghezze valide che sforano -> true', () => {
      expect(columnsOverflow([Number.NaN, 800, -5, 800, Number.POSITIVE_INFINITY], 1500)).toBe(true);
    });
  });

  it('accetta un array readonly e non lo modifica', () => {
    const ws: readonly number[] = Object.freeze([700, 700, 200]);
    expect(columnsOverflow(ws, 1500)).toBe(true);
    expect(ws).toEqual([700, 700, 200]);
  });
});

describe('canOfferOneLine', () => {
  const base = {
    gridId: 'grid-1',
    hasContinuationBands: false,
    columnsOverflow: false,
    oneLineOn: false,
  };

  it('Iscritti: bande, nessuno sforo -> offerto (comportamento di oggi)', () => {
    expect(canOfferOneLine({ ...base, hasContinuationBands: true })).toBe(true);
  });

  it('Tessere: niente bande, colonne che sforano -> offerto (nuovo)', () => {
    expect(
      canOfferOneLine({ ...base, columnsOverflow: columnsOverflow(widths(60, 100), 1500) }),
    ).toBe(true);
  });

  it('poche colonne, niente bande, modo spento -> nessun pulsante inutile', () => {
    expect(
      canOfferOneLine({ ...base, columnsOverflow: columnsOverflow([120, 80, 200], 1500) }),
    ).toBe(false);
  });

  it('tutto falso -> false', () => {
    expect(canOfferOneLine(base)).toBe(false);
  });

  it('bande e sforo insieme -> true', () => {
    expect(canOfferOneLine({ ...base, hasContinuationBands: true, columnsOverflow: true })).toBe(true);
  });

  describe('modo acceso = offerta appiccicosa', () => {
    it('acceso senza bande ne\' sforo (dopo un resize le colonne entrano): si puo\' spegnere', () => {
      expect(canOfferOneLine({ ...base, oneLineOn: true })).toBe(true);
    });

    it('acceso e colonne che sforano -> true', () => {
      expect(canOfferOneLine({ ...base, oneLineOn: true, columnsOverflow: true })).toBe(true);
    });

    it('acceso con bande -> true', () => {
      expect(canOfferOneLine({ ...base, oneLineOn: true, hasContinuationBands: true })).toBe(true);
    });
  });

  describe('senza gridId -> false qualunque sia il resto', () => {
    const allOn = { hasContinuationBands: true, columnsOverflow: true, oneLineOn: true };
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['stringa vuota', ''],
    ])('gridId %s', (_label, gridId) => {
      expect(canOfferOneLine({ ...allOn, gridId })).toBe(false);
      expect(canOfferOneLine({ ...base, gridId, hasContinuationBands: true })).toBe(false);
      expect(canOfferOneLine({ ...base, gridId, columnsOverflow: true })).toBe(false);
      expect(canOfferOneLine({ ...base, gridId, oneLineOn: true })).toBe(false);
      expect(canOfferOneLine({ ...base, gridId })).toBe(false);
    });
  });

  it('restituisce un booleano vero e proprio, non un valore truthy', () => {
    expect(canOfferOneLine({ ...base, columnsOverflow: true })).toBe(true);
    expect(typeof canOfferOneLine(base)).toBe('boolean');
  });
});
