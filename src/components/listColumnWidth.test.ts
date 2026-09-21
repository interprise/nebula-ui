import { describe, it, expect } from 'vitest';
import {
  listColumnWidth,
  BOOLEAN_COLUMN_MIN_WIDTH,
  type ListColumnWidthInput,
} from './listColumnWidth';

// SXADV-5847: nella lista React la larghezza iniziale di una colonna e'
// max(minimo, colspan * perUnit), con colspan ricavato dal `size` dichiarato
// nella view XML. Le colonne booleane (resa "Sì"/"No") dichiarano spesso
// size="30" perche' lo stesso size serve al layout del form: uscivano larghe
// ~240px e le ultime colonne finivano fuori schermo (tab Privacy).
// Per una booleana la larghezza NON viene ne' dal size ne' dal colspan.

const base: ListColumnWidthInput = {
  headerMinWidth: 0,
  ctrlType: 'text',
  size: undefined,
  isCustom: false,
  isFiller: false,
  colspan: 1,
  perUnit: 0,
};

const col = (over: Partial<ListColumnWidthInput>) => listColumnWidth({ ...base, ...over });

// Tab Privacy: quattro Boolean size=30, colspan 6, perUnit 40.
const privacyHeaders: Record<string, number> = {
  'Trat.Art.196': 96,
  Marketing: 84,
  'Diffusione Internet': 90,
  'Comun.altri soci': 78,
};
const privacyCol = (headerMinWidth: number): ListColumnWidthInput => ({
  ...base,
  ctrlType: 'boolean',
  size: 30,
  colspan: 6,
  perUnit: 40,
  headerMinWidth,
});

describe('listColumnWidth — colonne booleane', () => {
  it('BOOLEAN_COLUMN_MIN_WIDTH vale 40', () => {
    expect(BOOLEAN_COLUMN_MIN_WIDTH).toBe(40);
  });

  it('scenario Privacy: ogni colonna e larga quanto la sua intestazione, non 240/205', () => {
    for (const [name, header] of Object.entries(privacyHeaders)) {
      const r = listColumnWidth(privacyCol(header));
      expect(r.width, name).toBe(header);
      expect(r.minWidth, name).toBe(40);
    }
  });

  it('scenario Privacy: la larghezza totale delle quattro colonne si riduce di molto', () => {
    const before = 4 * 240; // colspan 6 * perUnit 40
    const after = Object.values(privacyHeaders)
      .map((h) => listColumnWidth(privacyCol(h)).width)
      .reduce((a, b) => a + b, 0);
    expect(after).toBe(96 + 84 + 90 + 78);
    expect(after).toBeLessThan(before / 2);
  });

  it('intestazione lunga: tiene il minimo dell intestazione anche oltre colspan*perUnit', () => {
    const r = col({ ctrlType: 'boolean', size: 30, colspan: 2, perUnit: 40, headerMinWidth: 150 });
    expect(r).toEqual({ width: 150, minWidth: 40 });
  });

  it('rispetta secondaryMinWidth (etichette delle righe di continuazione)', () => {
    const r = col({ ctrlType: 'boolean', size: 30, colspan: 6, perUnit: 40, headerMinWidth: 60, secondaryMinWidth: 130 });
    expect(r).toEqual({ width: 130, minWidth: 40 });
  });

  it("'checkbox' si comporta come 'boolean'", () => {
    const inp = { size: 30, colspan: 6, perUnit: 40, headerMinWidth: 70, secondaryMinWidth: 50 };
    expect(col({ ...inp, ctrlType: 'checkbox' })).toEqual(col({ ...inp, ctrlType: 'boolean' }));
    expect(col({ ...inp, ctrlType: 'checkbox' }).width).toBe(70);
  });

  it('intestazione minuscola: pavimento a 40', () => {
    const r = col({ ctrlType: 'boolean', size: 30, colspan: 6, perUnit: 40, headerMinWidth: 18 });
    expect(r).toEqual({ width: 40, minWidth: 40 });
  });

  it('ignora anche isCustom e il size dichiarato', () => {
    const r = col({ ctrlType: 'boolean', size: 60, isCustom: true, colspan: 8, perUnit: 50, headerMinWidth: 55 });
    expect(r.width).toBe(55);
  });
});

describe('listColumnWidth — colonne non booleane (invariate)', () => {
  it('testo con size: size*6.3+16, colspan*perUnit se piu largo', () => {
    // 20*6.3+16 = 142 > 3*40 = 120
    expect(col({ size: 20, colspan: 3, perUnit: 40, headerMinWidth: 60 })).toEqual({ width: 142, minWidth: 40 });
    // 10*6.3+16 = 79 < 6*40 = 240
    expect(col({ size: 10, colspan: 6, perUnit: 40, headerMinWidth: 60 })).toEqual({ width: 240, minWidth: 40 });
  });

  it('controllo custom: 8px per carattere', () => {
    // 20*8+16 = 176
    expect(col({ size: 20, isCustom: true, ctrlType: 'custom', colspan: 1, perUnit: 40 }).width).toBe(176);
  });

  it('il minimo da size e tagliato a 500', () => {
    // 200*6.3+16 = 1276 -> 500
    expect(col({ size: 200, perUnit: 0 })).toEqual({ width: 500, minWidth: 40 });
    // ma colspan*perUnit oltre 500 vince comunque
    expect(col({ size: 200, colspan: 15, perUnit: 40 }).width).toBe(600);
  });

  it('riempitivo: round(colspan*6.3) come minimo, minWidth sotto 40 se il minimo e piccolo', () => {
    // 5*6.3 = 31.5 -> 32; 5*40 = 200
    expect(col({ ctrlType: undefined, isFiller: true, colspan: 5, perUnit: 40 })).toEqual({ width: 200, minWidth: 32 });
    expect(col({ ctrlType: undefined, isFiller: true, colspan: 5, perUnit: 0 })).toEqual({ width: 32, minWidth: 32 });
  });

  it('pavimenti di date (88) e timestamp (130)', () => {
    expect(col({ ctrlType: 'date', headerMinWidth: 50 })).toEqual({ width: 88, minWidth: 40 });
    // 10*6.3+16 = 79 -> 130
    expect(col({ ctrlType: 'timestamp', size: 10, headerMinWidth: 50 })).toEqual({ width: 130, minWidth: 40 });
    // size piu grande del pavimento: vince il size (20*6.3+16 = 142)
    expect(col({ ctrlType: 'date', size: 20 }).width).toBe(142);
  });

  it('perUnit 0 (server senza totalWidth/totalCols): larghezza = minimo effettivo', () => {
    expect(col({ size: 12, colspan: 6, perUnit: 0, headerMinWidth: 70 })).toEqual({ width: 92, minWidth: 40 });
  });

  it('colspan*perUnit arrotondato', () => {
    // 3 * 33.4 = 100.2 -> 100
    expect(col({ colspan: 3, perUnit: 33.4, headerMinWidth: 20 }).width).toBe(100);
  });

  it('secondaryMinWidth alza il minimo anche sulle non booleane', () => {
    expect(col({ size: 10, colspan: 1, perUnit: 40, headerMinWidth: 50, secondaryMinWidth: 180 })).toEqual({
      width: 180,
      minWidth: 40,
    });
  });

  it('intestazione piccola senza size: minWidth = minimo effettivo sotto 40', () => {
    expect(col({ headerMinWidth: 30, colspan: 1, perUnit: 0 })).toEqual({ width: 30, minWidth: 30 });
  });

  it('colspan 0 trattato come 1', () => {
    expect(col({ colspan: 0, perUnit: 40, headerMinWidth: 10 }).width).toBe(40);
  });
});
