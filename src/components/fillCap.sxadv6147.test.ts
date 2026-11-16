// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { computeFillCap, tailBelow, FILL_CAP_MIN, FILL_CAP_SLACK, type FillCapInput } from './fillCap';

// SXADV-6146.3 / SXADV-6147: la griglia incorporata del dettaglio (tree+detail,
// "Figlie" + pannello del rigo) veniva dimensionata fino al fondo del riquadro
// ignorando cio' che sta SOTTO il pannello (padding della cella della
// layout-table, righe di form dopo la griglia) e in coordinate di schermo. Il
// riquadro traboccava di pochi pixel e partiva il loop barre si'/barre no.
//
// Qui si prova cio' che computeFillCap PROMETTE nel suo commento, ricostruendo
// gli ingressi da un layout descritto in coordinate del contenuto del riquadro,
// come li misurerebbe il browser.

interface Layout {
  /** Riquadro che scorre (coordinate di schermo del suo bordo). */
  top: number;
  borderTop: number;
  paddingBottom: number;
  clientHeight: number;
  scrollTop: number;
  /** Cima di .list-container in coordinate del contenuto del riquadro. */
  listTopContent: number;
  /** Parte di .list-container che non e' griglia. */
  nonGridChrome: number;
  /** Altezza ATTUALE della griglia (quella con cui si misura). */
  gridHeight: number;
  /** Pannello del rigo; 0 = nessun pannello. */
  panelHeight: number;
  /** Contenuto del riquadro sotto il pannello (padding di cella, righe di form). */
  tail: number;
}

const base: Layout = {
  top: 112,
  borderTop: 1,
  paddingBottom: 8,
  clientHeight: 700,
  scrollTop: 0,
  listTopContent: 180,
  nonGridChrome: 34,
  gridHeight: 300,
  panelHeight: 140,
  tail: 0,
};

/** Altezza del contenuto (padding in basso compreso) con la griglia alta `g`. */
function contentHeight(l: Layout, g: number): number {
  return l.listTopContent + l.nonGridChrome + g + l.panelHeight + l.tail + l.paddingBottom;
}

function toInput(l: Layout): FillCapInput {
  const contentTop = l.top + l.borderTop;
  const screen = (yContent: number) => contentTop + yContent - l.scrollTop;
  const ownBottomContent = l.listTopContent + l.nonGridChrome + l.gridHeight + l.panelHeight;
  return {
    scroller: {
      top: l.top,
      borderTop: l.borderTop,
      paddingBottom: l.paddingBottom,
      clientHeight: l.clientHeight,
      scrollTop: l.scrollTop,
    },
    // Fondo del contenuto (padding del riquadro escluso), qualunque sia lo
    // spazio vuoto che resta sotto: in ListRenderer e' ownBottom + tailBelow(own, scroller).
    contentBottom: screen(ownBottomContent + l.tail),
    listTop: screen(l.listTopContent),
    nonGridChrome: l.nonGridChrome,
    panelHeight: l.panelHeight,
    ownBottom: screen(ownBottomContent),
  };
}

const lay = (over: Partial<Layout> = {}): Layout => ({ ...base, ...over });
const cap = (over: Partial<Layout> = {}) => computeFillCap(toInput(lay(over)));

/** La formula di prima (niente sotto il pannello), scritta nel contratto. */
function oldFormula(m: FillCapInput): number {
  const s = m.scroller;
  return Math.max(
    FILL_CAP_MIN,
    Math.floor(s.top + s.borderTop + s.clientHeight - s.paddingBottom - FILL_CAP_SLACK
      - m.panelHeight - m.listTop - m.nonGridChrome),
  );
}

describe('computeFillCap — SXADV-6147 (contenuto sotto il pannello)', () => {
  it('con l\'altezza restituita il contenuto sta dentro clientHeight', () => {
    for (const tail of [0, 1, 2, 3, 7, 25, 60]) {
      const l = lay({ tail });
      const h = computeFillCap(toInput(l));
      expect(h).toBeGreaterThan(FILL_CAP_MIN);
      expect(contentHeight(l, h)).toBeLessThanOrEqual(l.clientHeight);
      // ...e la riempie: avanzano al massimo SLACK + 1 pixel (arrotondamento).
      expect(l.clientHeight - contentHeight(l, h)).toBeLessThanOrEqual(FILL_CAP_SLACK + 1);
    }
  });

  it('regressione: una coda di 2..20px sotto il pannello toglie esattamente quella coda', () => {
    const h0 = cap({ tail: 0 });
    for (let tail = 2; tail <= 20; tail++) {
      expect(cap({ tail })).toBe(h0 - tail);
    }
  });

  it('il risultato non dipende dall\'altezza attuale della griglia (punto fisso, niente loop)', () => {
    const tail = 3;
    const ref = cap({ tail, gridHeight: 300 });
    for (const g of [120, 250, 301, 406, 500, 800]) {
      expect(cap({ tail, gridHeight: g })).toBe(ref);
    }
    // Rimisurare con la griglia gia' all'altezza restituita la conferma.
    expect(cap({ tail, gridHeight: ref })).toBe(ref);
  });

  it('lo spazio vuoto sotto il contenuto non conta: griglia bassa = stesso esito (regressione scrollHeight)', () => {
    // Con la griglia ancora bassa (prima misura, 45% della finestra) il riquadro
    // ha spazio libero sotto il pannello. Se quello spazio contasse come "sotto
    // il pannello" (come farebbe scrollHeight, che vale clientHeight) la griglia
    // si accorcerebbe a ogni misura fino a 120.
    for (const tail of [0, 3, 12]) {
      const expected = cap({ tail, gridHeight: 600 });
      for (const g of [120, 150, 200, 250, 300]) {
        const l = lay({ tail, gridHeight: g });
        expect(contentHeight(l, g)).toBeLessThan(l.clientHeight); // c'e' spazio libero
        expect(computeFillCap(toInput(l))).toBe(expected);
      }
      // misure ripetute partendo dal basso: un passo e poi fermo
      let g = 150;
      for (let i = 0; i < 5; i++) g = cap({ tail, gridHeight: g });
      expect(g).toBe(expected);
    }
  });

  it('con un contenuto corto e senza coda il risultato e\' quello di "niente sotto"', () => {
    const m = toInput(lay({ tail: 0, gridHeight: 150 }));
    expect(computeFillCap(m)).toBe(oldFormula(m));
  });

  it('non dipende dallo scorrimento del riquadro', () => {
    for (const tail of [0, 3, 40]) {
      // contenuto che trabocca davvero (griglia alta), cosi' scrollTop > 0 e' possibile
      const ref = cap({ tail, gridHeight: 600, scrollTop: 0 });
      for (const scrollTop of [1, 17, 64.5, 200]) {
        expect(cap({ tail, gridHeight: 600, scrollTop })).toBe(ref);
      }
    }
  });

  it('con niente sotto il pannello coincide con la formula di prima', () => {
    for (const over of [
      {},
      { panelHeight: 0 },
      { top: 0, borderTop: 0, paddingBottom: 0 },
      { clientHeight: 523, listTopContent: 41, nonGridChrome: 0 },
    ] as Partial<Layout>[]) {
      const m = toInput(lay({ ...over, tail: 0 }));
      expect(computeFillCap(m)).toBe(oldFormula(m));
    }
  });

  it('valore assoluto sul layout di riferimento', () => {
    // 700 - 8 (padding) - 2 (SLACK) - 140 (pannello) - 180 (cima lista) - 34 (chrome)
    expect(cap({ tail: 0 })).toBe(336);
    expect(cap({ tail: 3 })).toBe(333);
  });

  it('un "sotto il pannello" negativo (arrotondamenti) conta zero', () => {
    const l = lay({ tail: 0 });
    const m = toInput(l);
    const h0 = computeFillCap(m);
    for (const d of [0.4, 1, 1.9, 5]) {
      const neg = { ...m, contentBottom: m.ownBottom - d };
      expect(computeFillCap(neg)).toBe(h0);
    }
  });

  it('mai sotto FILL_CAP_MIN', () => {
    expect(cap({ tail: 500 })).toBe(FILL_CAP_MIN);
    expect(cap({ clientHeight: 200 })).toBe(FILL_CAP_MIN);
    expect(cap({ panelHeight: 2000 })).toBe(FILL_CAP_MIN);
    // appena sopra il minimo non si blocca al minimo
    const h0 = cap({ tail: 0 });
    expect(cap({ tail: h0 - FILL_CAP_MIN - 1 })).toBe(FILL_CAP_MIN + 1);
    expect(cap({ tail: h0 - FILL_CAP_MIN })).toBe(FILL_CAP_MIN);
    expect(cap({ tail: h0 - FILL_CAP_MIN + 1 })).toBe(FILL_CAP_MIN);
  });

  it('arrotonda per difetto', () => {
    const h0 = cap({ tail: 0 });
    expect(cap({ tail: 0.2 })).toBe(h0 - 1);
    expect(cap({ tail: 0.99 })).toBe(h0 - 1);
    expect(cap({ tail: 1 })).toBe(h0 - 1);
    expect(cap({ tail: 1.01 })).toBe(h0 - 2);
    expect(Number.isInteger(cap({ top: 111.37, listTopContent: 180.6 }))).toBe(true);
    expect(cap({ listTopContent: 180.6 })).toBe(h0 - 1);
  });

  it('senza pannello: la griglia (con la sua coda) arriva al fondo', () => {
    for (const tail of [0, 2, 9]) {
      const l = lay({ panelHeight: 0, tail });
      const h = computeFillCap(toInput(l));
      expect(contentHeight(l, h)).toBeLessThanOrEqual(l.clientHeight);
      expect(l.clientHeight - contentHeight(l, h)).toBeLessThanOrEqual(FILL_CAP_SLACK + 1);
    }
    expect(cap({ panelHeight: 0, tail: 0 }) - cap({ panelHeight: 0, tail: 5 })).toBe(5);
  });

  it('rettangoli frazionari (zoom 110%): il contenuto sta dentro e l\'esito non dipende da scrollTop', () => {
    const z = 1.1;
    const frac: Partial<Layout> = {
      top: 112 * z,
      borderTop: 0.909,
      paddingBottom: 7.273,
      clientHeight: 636, // intero, come lo da' il browser
      listTopContent: 163.64,
      nonGridChrome: 30.91,
      panelHeight: 127.27,
      gridHeight: 500.45,
    };
    for (const tail of [0, 0.91, 2.73, 12.4]) {
      const l = lay({ ...frac, tail });
      const h = computeFillCap(toInput(l));
      expect(Number.isInteger(h)).toBe(true);
      expect(contentHeight(l, h)).toBeLessThanOrEqual(l.clientHeight);
      expect(l.clientHeight - contentHeight(l, h)).toBeLessThanOrEqual(FILL_CAP_SLACK + 1);
      for (const scrollTop of [3.64, 21.82]) {
        expect(computeFillCap(toInput(lay({ ...frac, tail, scrollTop })))).toBe(h);
      }
    }
  });

  it('la barra orizzontale (clientHeight -17) accorcia la griglia di 17, non di piu\'', () => {
    const tail = 3;
    expect(cap({ tail }) - cap({ tail, clientHeight: base.clientHeight - 17 })).toBe(17);
  });
});

// tailBelow: quanto contenuto il riquadro tiene SOTTO il pannello, risalendo
// dal pannello al riquadro. Ogni caso e' costruito in modo che l'approccio
// precedente ("fondo piu' basso fra i figli diretti del riquadro") dia un
// numero diverso: lo si calcola accanto (oldDirectChildren) come promemoria.
describe('tailBelow', () => {
  type Box = { top: number; height: number; style?: Partial<CSSStyleDeclaration> };
  function box(b: Box, ...children: HTMLElement[]): HTMLElement {
    const e = document.createElement('div');
    Object.assign(e.style, b.style ?? {});
    e.getBoundingClientRect = () => ({
      top: b.top, bottom: b.top + b.height, height: b.height, left: 0, right: 100, width: 100,
      x: 0, y: b.top, toJSON: () => ({}),
    }) as DOMRect;
    e.append(...children);
    return e;
  }
  /** Il vecchio contentBottomOf, meno il fondo del pannello. */
  function oldDirectChildren(own: HTMLElement, scroller: HTMLElement): number {
    let b = -Infinity;
    for (const ch of Array.from(scroller.children)) {
      b = Math.max(b, ch.getBoundingClientRect().bottom + (parseFloat(getComputedStyle(ch).marginBottom) || 0));
    }
    return b - own.getBoundingClientRect().bottom;
  }

  it('antenato stirato (flex:1, fondo sul fondo del riquadro): conta solo il suo padding', () => {
    const list = box({ top: 10, height: 300 });
    const panel = box({ top: 310, height: 140 });
    const stretched = box({ top: 0, height: 700, style: { paddingBottom: '3px' } }, list, panel);
    const scroller = box({ top: 0, height: 700 }, stretched);
    document.body.append(scroller);
    expect(tailBelow(panel, scroller)).toBe(3);
    expect(oldDirectChildren(panel, scroller)).toBe(250); // lo spazio vuoto contato come contenuto
    scroller.remove();
  });

  it('i fratelli affiancati (altre celle della stessa riga) non contano, anche se piu\' alti', () => {
    const list = box({ top: 100, height: 200 });
    const panel = box({ top: 300, height: 150 });
    const cellA = box({ top: 100, height: 352, style: { paddingBottom: '2px' } }, list, panel);
    const cellB = box({ top: 100, height: 600 }); // stessa cima, finisce molto sotto
    const row = box({ top: 100, height: 600 }, cellA, cellB);
    const scroller = box({ top: 0, height: 800 }, row);
    document.body.append(scroller);
    expect(tailBelow(panel, scroller)).toBe(2);
    expect(oldDirectChildren(panel, scroller)).toBe(250);
    scroller.remove();
  });

  it('i fratelli sotto contano con i loro margini, e il margine inferiore del pannello', () => {
    const list = box({ top: 0, height: 300 });
    const panel = box({ top: 300, height: 150, style: { marginBottom: '4px' } });
    const after = box({ top: 464, height: 30, style: { marginTop: '10px', marginBottom: '5px' } });
    const scroller = box({ top: 0, height: 800 }, list, panel, after);
    document.body.append(scroller);
    expect(tailBelow(panel, scroller)).toBe(4 + 10 + 30 + 5);
    scroller.remove();
  });

  it('i fratelli di altezza zero si ignorano (margini compresi)', () => {
    const panel = box({ top: 300, height: 150 });
    const empty = box({ top: 450, height: 0, style: { marginTop: '8px', marginBottom: '8px' } });
    const after = box({ top: 450, height: 12 });
    const scroller = box({ top: 0, height: 800 }, panel, empty, after);
    document.body.append(scroller);
    expect(tailBelow(panel, scroller)).toBe(12);
    scroller.remove();
  });

  it('i fratelli PRIMA del pannello non contano', () => {
    const before = box({ top: 0, height: 300 });
    const panel = box({ top: 300, height: 150 });
    const scroller = box({ top: 0, height: 800 }, before, panel);
    document.body.append(scroller);
    expect(tailBelow(panel, scroller)).toBe(0);
    scroller.remove();
  });

  it('la risalita somma ogni livello: padding e bordo inferiori dei genitori e i fratelli sotto', () => {
    const list = box({ top: 0, height: 300 });
    const panel = box({ top: 300, height: 150 });
    const cell = box({ top: 0, height: 453, style: { paddingBottom: '2px', borderBottomWidth: '1px', borderBottomStyle: 'solid' } }, list, panel);
    const formRow = box({ top: 453, height: 24, style: { marginBottom: '6px' } }); // riga di form dopo la griglia
    const table = box({ top: 0, height: 480, style: { paddingBottom: '1px' } }, cell, formRow);
    const footer = box({ top: 490, height: 20 });
    const scroller = box({ top: 0, height: 800 }, table, footer);
    document.body.append(scroller);
    // livello panel: 0; genitore cell: 2 + 1; livello cell: formRow 24+6;
    // genitore table: 1; livello table: footer 20; genitore = riquadro: stop.
    expect(tailBelow(panel, scroller)).toBe(3 + 30 + 1 + 20);
    scroller.remove();
  });

  it('si ferma al riquadro: il suo padding/bordo (li toglie computeFillCap) e cio\' che sta fuori non contano', () => {
    const panel = box({ top: 300, height: 150, style: { marginBottom: '2px' } });
    const scroller = box({ top: 0, height: 700, style: { paddingBottom: '20px', borderBottomWidth: '3px', borderBottomStyle: 'solid' } }, panel);
    const outsideBelow = box({ top: 700, height: 100 });
    const outer = box({ top: 0, height: 800, style: { paddingBottom: '9px' } }, scroller, outsideBelow);
    document.body.append(outer);
    expect(tailBelow(panel, scroller)).toBe(2);
    outer.remove();
  });

  it('own figlio diretto del riquadro senza nulla sotto: zero', () => {
    const panel = box({ top: 300, height: 150 });
    const scroller = box({ top: 0, height: 700 }, panel);
    document.body.append(scroller);
    expect(tailBelow(panel, scroller)).toBe(0);
    scroller.remove();
  });

  it('con la coda di tailBelow computeFillCap non accorcia la griglia a ogni misura (antenato stirato)', () => {
    // Lo scenario della revisione: .view-nested-bottom stirato. La griglia
    // ricalcolata e rimisurata deve restare ferma.
    const measure = (gridH: number) => {
      const chrome = 34;
      const list = box({ top: 50, height: chrome + gridH });
      const panel = box({ top: 50 + chrome + gridH, height: 140 });
      const stretched = box({ top: 0, height: 700, style: { paddingBottom: '3px' } }, list, panel);
      const scroller = box({ top: 0, height: 700 }, stretched);
      document.body.append(scroller);
      const ownBottom = panel.getBoundingClientRect().bottom;
      const h = computeFillCap({
        scroller: { top: 0, borderTop: 0, paddingBottom: 0, clientHeight: 700, scrollTop: 0 },
        contentBottom: ownBottom + tailBelow(panel, scroller),
        listTop: 50, nonGridChrome: chrome, panelHeight: 140, ownBottom,
      });
      scroller.remove();
      return h;
    };
    const expected = 700 - FILL_CAP_SLACK - 3 - 140 - 50 - 34;
    for (const g of [120, 200, 300, expected]) expect(measure(g)).toBe(expected);
    let g = 150;
    for (let i = 0; i < 6; i++) g = measure(g);
    expect(g).toBe(expected);
  });
});
