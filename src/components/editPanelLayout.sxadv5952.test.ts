import { describe, it, expect } from 'vitest';
import { panelUnitWidths, panelCellFloor } from './editPanelLayout';
import { numberWidthForSize, pickerWidthForFormat, javaToDayjsFormat } from '../controls/helpers';
import type { UIControl } from '../types/ui';

// SXADV-5952 — pannello di riga (micro-detail) di Eventi commerciali > Azioni:
// la cella "Prog Evento" ha colspan 1 su 27 colonne di layout. Con le colonne
// tutte uguali (100/27 % ~ 46px) padding e stellina dell'obbligatorio lasciano
// all'InputNumber 0px: il valore non si vede.
//
// Il contratto: ogni colonna di layout prende la sua larghezza in px da
// `panelUnitWidths`, che da' a ogni cella almeno il suo minimo
// (`panelCellFloor` del controllo) e divide il resto in parti UGUALI fra le
// colonne che un minimo non lo impongono ("riempimento ad acqua").

type Cell = { span?: number; floor: number };

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Quanto ricevono le colonne coperte da ciascuna cella, da sinistra a destra. */
function coveredWidths(row: Cell[], widths: number[]): number[] {
  const out: number[] = [];
  let at = 0;
  for (const c of row) {
    const s = c.span != null && c.span > 0 ? c.span : 1;
    out.push(sum(widths.slice(at, at + s)));
    at += s;
  }
  return out;
}

// ─────────────────────────────────────────────────────────── panelUnitWidths
describe('panelUnitWidths (SXADV-5952)', () => {
  it('senza minimi: tutte le colonne uguali, width/units', () => {
    const w = panelUnitWidths([[{ span: 5, floor: 0 }, { span: 22, floor: 0 }]], 27, 1242);
    expect(w).toHaveLength(27);
    for (const x of w) expect(x).toBeCloseTo(1242 / 27, 5);
  });

  it('caso Prog Evento: colspan 1 su 27 con un minimo di 120px', () => {
    const w = panelUnitWidths([[{ span: 1, floor: 120 }, { span: 26, floor: 0 }]], 27, 1242);
    expect(w).toHaveLength(27);
    expect(w[0]).toBeCloseTo(120, 5);
    // Il resto diviso in parti uguali fra le altre 26 colonne.
    for (const x of w.slice(1)) expect(x).toBeCloseTo((1242 - 120) / 26, 5);
    expect(Math.abs(sum(w) - 1242)).toBeLessThanOrEqual(0.5);
  });

  it('una cella su piu\' colonne chiede floor/span a ciascuna', () => {
    // 10 colonne da 30px; la cella di 3 colonne vuole 300px -> 100 a colonna.
    const w = panelUnitWidths([[{ span: 3, floor: 300 }, { span: 7, floor: 0 }]], 10, 1000);
    expect(w.slice(0, 3).map((x) => Math.round(x * 1000) / 1000)).toEqual([100, 100, 100]);
    for (const x of w.slice(3)) expect(x).toBeCloseTo(700 / 7, 5);
  });

  it('il riempimento si ripete finche\' e\' stabile', () => {
    // Quota uguale 100: la prima (150) si fissa; restano 250/3 = 83,3 < 90,
    // quindi si fissa anche la seconda; le ultime due si dividono 160.
    const w = panelUnitWidths(
      [[{ span: 1, floor: 150 }, { span: 1, floor: 90 }, { span: 1, floor: 0 }, { span: 1, floor: 0 }]],
      4,
      400,
    );
    expect(w[0]).toBeCloseTo(150, 5);
    expect(w[1]).toBeCloseTo(90, 5);
    expect(w[2]).toBeCloseTo(80, 5);
    expect(w[3]).toBeCloseTo(80, 5);
  });

  it('un minimo sotto la quota uguale non cambia niente', () => {
    const w = panelUnitWidths([[{ span: 1, floor: 30 }, { span: 3, floor: 0 }]], 4, 400);
    for (const x of w) expect(x).toBeCloseTo(100, 5);
  });

  it('le celle si dispongono da sinistra a destra', () => {
    // La cella col minimo e' la TERZA colonna, non la prima.
    const w = panelUnitWidths([[{ span: 2, floor: 0 }, { span: 1, floor: 60 }]], 3, 90);
    expect(w[0]).toBeCloseTo(15, 5);
    expect(w[1]).toBeCloseTo(15, 5);
    expect(w[2]).toBeCloseTo(60, 5);
  });

  it('span mancante, 0 o negativo vale 1 (come panelTableUnits)', () => {
    const w = panelUnitWidths([[{ floor: 50 }, { span: 0, floor: 0 }, { span: -2, floor: 0 }]], 3, 90);
    expect(w[0]).toBeCloseTo(50, 5);
    expect(w[1]).toBeCloseTo(20, 5);
    expect(w[2]).toBeCloseTo(20, 5);
  });

  it('il minimo di una colonna e\' il massimo fra le righe', () => {
    // Riga 1: cella su 2 colonne da 200 -> 100 a colonna. Riga 2: 160 sulla
    // prima. Minimi per colonna: 160 e 100.
    const rows: Cell[][] = [[{ span: 2, floor: 200 }, { span: 2, floor: 0 }], [{ span: 1, floor: 160 }, { span: 3, floor: 0 }]];
    const w = panelUnitWidths(rows, 4, 500);
    expect(w[0]).toBeCloseTo(160, 5);
    // Quota uguale (500-160)/3 = 113,3 > 100: la seconda resta nel gruppo uguale.
    expect(w[1]).toBeCloseTo(340 / 3, 5);
    expect(w[2]).toBeCloseTo(340 / 3, 5);
    expect(w[3]).toBeCloseTo(340 / 3, 5);
  });

  it('minimi che non ci stanno: ogni colonna esattamente il suo minimo (la tabella sborda)', () => {
    const rows: Cell[][] = [[{ span: 1, floor: 300 }, { span: 1, floor: 250 }, { span: 1, floor: 0 }]];
    const w = panelUnitWidths(rows, 3, 400);
    expect(w).toHaveLength(3);
    expect(w[0]).toBeCloseTo(300, 5);
    expect(w[1]).toBeCloseTo(250, 5);
    expect(w[2]).toBeCloseTo(0, 5);
  });

  it('minimi da righe diverse che sommati sbordano: ancora i soli minimi', () => {
    const rows: Cell[][] = [[{ span: 2, floor: 100 }], [{ span: 1, floor: 80 }, { span: 1, floor: 0 }]];
    const w = panelUnitWidths(rows, 2, 100);
    expect(w[0]).toBeCloseTo(80, 5);
    expect(w[1]).toBeCloseTo(50, 5);
  });

  it.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY])('larghezza %s: ogni colonna il suo minimo', (width) => {
    const w = panelUnitWidths([[{ span: 1, floor: 120 }, { span: 2, floor: 40 }, { span: 1, floor: 0 }]], 4, width);
    expect(w).toHaveLength(4);
    expect(w[0]).toBeCloseTo(120, 5);
    expect(w[1]).toBeCloseTo(20, 5);
    expect(w[2]).toBeCloseTo(20, 5);
    expect(w[3]).toBeCloseTo(0, 5);
  });

  it('colonne che nessuna cella copre: senza minimo, nel gruppo uguale', () => {
    const w = panelUnitWidths([[{ span: 1, floor: 0 }]], 5, 500);
    expect(w).toHaveLength(5);
    for (const x of w) expect(x).toBeCloseTo(100, 5);
  });

  it('nessuna riga: width/units', () => {
    const w = panelUnitWidths([], 4, 200);
    expect(w).toHaveLength(4);
    for (const x of w) expect(x).toBeCloseTo(50, 5);
  });

  it('non modifica le righe ricevute', () => {
    const rows: Cell[][] = [[{ span: 1, floor: 120 }, { floor: 0 }], [{ span: 2, floor: 10 }]];
    const copia = JSON.parse(JSON.stringify(rows));
    panelUnitWidths(rows, 2, 300);
    expect(JSON.parse(JSON.stringify(rows))).toEqual(copia);
  });

  // Le proprieta' del contratto su righe casuali (generatore con seme fisso,
  // cosi' una prova che fallisce si ripete uguale).
  it('proprieta\': somma = width, ogni cella almeno il suo minimo, colonne senza minimo uguali', () => {
    let seed = 5952;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let caso = 0; caso < 300; caso++) {
      const units = 1 + Math.floor(rnd() * 40);
      const nRows = 1 + Math.floor(rnd() * 4);
      const rows: Cell[][] = [];
      for (let r = 0; r < nRows; r++) {
        const row: Cell[] = [];
        let left = units;
        while (left > 0) {
          const span = 1 + Math.floor(rnd() * Math.min(left, 8));
          const floor = rnd() < 0.3 ? Math.round(rnd() * 160) : 0;
          row.push({ span, floor });
          left -= span;
        }
        rows.push(row);
      }
      // Minimo per colonna, ricavato qui per sapere quali colonne non ne hanno.
      const unitFloor = new Array<number>(units).fill(0);
      for (const row of rows) {
        let at = 0;
        for (const c of row) {
          for (let k = 0; k < c.span!; k++) unitFloor[at + k] = Math.max(unitFloor[at + k], c.floor / c.span!);
          at += c.span!;
        }
      }
      const floorsTotal = sum(unitFloor);
      const width = floorsTotal + Math.round(rnd() * 1500);
      const w = panelUnitWidths(rows, units, width);
      const where = `caso ${caso}: units=${units} width=${width} rows=${JSON.stringify(rows)}`;
      expect(w, where).toHaveLength(units);
      expect(Math.abs(sum(w) - width), where).toBeLessThanOrEqual(0.5);
      for (const row of rows) {
        const got = coveredWidths(row, w);
        row.forEach((c, i) => expect(got[i], where).toBeGreaterThanOrEqual(c.floor - 0.5));
      }
      const free = w.filter((_, i) => unitFloor[i] === 0);
      for (const x of free) expect(x, where).toBeCloseTo(free[0], 5);
    }
  });
});

// ───────────────────────────────────────────────────────────── panelCellFloor
describe('panelCellFloor (SXADV-5952)', () => {
  const ctl = (c: Partial<UIControl> & { type: string }): UIControl => ({ ...c }) as UIControl;

  it('nessun controllo -> 0', () => {
    expect(panelCellFloor(undefined)).toBe(0);
  });

  it.each(['number', 'money', 'date', 'time', 'timestamp'])('%s non editabile -> 0', (type) => {
    expect(panelCellFloor(ctl({ type, editable: false, size: 8 }))).toBe(0);
    expect(panelCellFloor(ctl({ type, size: 8 }))).toBe(0);
  });

  it.each(['text', 'textarea', 'combo'])('%s editabile -> 0 (si stringe senza perdere il valore)', (type) => {
    expect(panelCellFloor(ctl({ type, editable: true, size: 40 }))).toBe(0);
    expect(panelCellFloor(ctl({ type, editable: true, size: 40, mandatory: true }))).toBe(0);
  });

  it('number editabile: almeno la larghezza che il controllo si da\' (numberWidthForSize)', () => {
    expect(panelCellFloor(ctl({ type: 'number', editable: true, size: 5 }))).toBeGreaterThanOrEqual(numberWidthForSize(5));
    expect(panelCellFloor(ctl({ type: 'number', editable: true }))).toBeGreaterThanOrEqual(numberWidthForSize(undefined));
  });

  it('money editabile: almeno numberWidthForSize', () => {
    expect(panelCellFloor(ctl({ type: 'money', editable: true, size: 12 }))).toBeGreaterThanOrEqual(numberWidthForSize(12));
  });

  it('date editabile: almeno la larghezza del DatePicker (pickerWidthForFormat del formato)', () => {
    const conFormato = ctl({ type: 'date', editable: true, format: 'dd/MM/yyyy' });
    expect(panelCellFloor(conFormato)).toBeGreaterThanOrEqual(
      pickerWidthForFormat(javaToDayjsFormat('dd/MM/yyyy') || 'DD/MM/YYYY', 10),
    );
    expect(panelCellFloor(ctl({ type: 'date', editable: true }))).toBeGreaterThanOrEqual(pickerWidthForFormat('DD/MM/YYYY', 10));
  });

  it('time editabile: almeno pickerWidthForFormat(HH:mm)', () => {
    expect(panelCellFloor(ctl({ type: 'time', editable: true }))).toBeGreaterThanOrEqual(pickerWidthForFormat('HH:mm', 5));
  });

  it('timestamp editabile: almeno pickerWidthForFormat del formato data e ora', () => {
    expect(panelCellFloor(ctl({ type: 'timestamp', editable: true }))).toBeGreaterThanOrEqual(
      pickerWidthForFormat('DD/MM/YYYY HH:mm', 16),
    );
  });

  it.each(['number', 'money', 'date', 'time', 'timestamp'])('%s obbligatorio: piu\' spazio del non obbligatorio (la stellina)', (type) => {
    const base = panelCellFloor(ctl({ type, editable: true, size: 6 }));
    const star = panelCellFloor(ctl({ type, editable: true, size: 6, mandatory: true }));
    expect(base).toBeGreaterThan(0);
    expect(star).toBeGreaterThan(base);
  });

  it('caso Prog Evento: la prima colonna (colspan 1 di 27) tiene l\'InputNumber obbligatorio', () => {
    const progEvento = ctl({ type: 'number', editable: true, mandatory: true, size: 5 });
    const floor = panelCellFloor(progEvento);
    const w = panelUnitWidths([[{ span: 1, floor }, { span: 26, floor: 0 }]], 27, 1242);
    expect(w[0]).toBeGreaterThanOrEqual(floor);
    expect(w[0]).toBeGreaterThanOrEqual(numberWidthForSize(5));
    // Le colonne uguali di prima (1242/27 = 46px) non bastavano.
    expect(w[0]).toBeGreaterThan(1242 / 27);
  });
});
