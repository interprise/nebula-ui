// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from 'antd';
import type { UITree, UIRow } from '../types/ui';
import { ELTYPE_CONTENT, ELTYPE_CONTAINER } from '../types/ui';
import { registerBuiltinControls } from '../controls/builtins/index';

// SXADV-6297 — Reg. contabili - Dettaglio (docRegContabiliDetail): sotto la testata
// compare un'area inferiore vuota col solo pulsante «Ingrandisce sezione». Il server
// manda come ultimo rigo un controllo `type: "tab"` (controlName "this") con
// `tabs: []` — le schede di quel tab sono tutte condizionali e per quel record
// nessuna e' visibile — e nessun contentRows.
//
// Scritto da chi NON implementa: prova il contratto, non come e' fatto.
//   1. tab con zero schede = niente: nessuna area inferiore, nessun divisore,
//      nessuna barra dei tab vuota, nessun pulsante di zoom; in coda o dentro la
//      testata.
//   2. lo stesso per una vista incorporata in coda nascosta (cella o controllo
//      visible === false).
//   3. invariati: tab con schede, detailView visibile, piu' sezioni senza tab
//      (pagina unica .view-flow, SXADV-6300), tab vuoto + detailView visibile.
//   4. lo stesso tab che passa da zero schede a una e viceversa, sullo stesso
//      montaggio.
//
// DOM vero (jsdom), antd vero, ViewRenderer vero; AG Grid sostituito da uno stub
// (come in stackedSections.sxadv5935). jsdom non fa layout: si legge la struttura.

registerBuiltinControls();

vi.mock('ag-grid-react', async () => {
  const { createElement } = await import('react');
  return {
    AgGridReact: () => createElement('div', { className: 'griglia-stub' }),
  };
});

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  postAction2: async () => ({}),
  postAction: async () => ({}),
  subscribeInFlight: () => () => {},
}));

const { default: ViewRenderer } = await import('./ViewRenderer');

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  class FakeRO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as Record<string, unknown>).ResizeObserver = FakeRO;
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, onchange: null,
      addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

/* ── Fixture: la forma che manda il server ──────────────────────────────── */

const ZOOM = '[aria-label="Ingrandisce sezione"]';

function campo(id: string, prompt: string, value: string): UIRow {
  return {
    id: `h_${id}`,
    cells: [
      { elementType: 0, prompt },
      { elementType: ELTYPE_CONTENT, colspan: 1, control: { type: 'text', name: id, id, value } },
    ],
  } as unknown as UIRow;
}

/** La testata di Reg. contabili - Dettaglio. */
const TESTATA: UIRow[] = [
  campo('competenza', 'Competenza:', '23/10/2026'),
  campo('descrizione', 'Descrizione:', 'Fatt B'),
  campo('sottoconto', 'Sottoconto:', '205.04.01'),
];

type Schede = { name: string; prompt: string; selected?: boolean }[] | undefined;

/** Il tab `this` cosi' come arriva: senza schede visibili, `tabs: []` e niente contentRows. */
function tab(schede: Schede, conContenuto = false) {
  return {
    elementType: ELTYPE_CONTAINER,
    colspan: 1,
    id: 'cella_tab',
    control: {
      type: 'tab', id: 'this', name: 'this', controlName: 'this', navpath: 'S1-0.1',
      ...(schede === undefined ? {} : { tabs: schede }),
      ...(conContenuto && schede && schede.length > 0
        ? {
          contentViewName: 'docRegContabiliScheda',
          contentRows: [campo('nota', 'Nota:', 'contenuto della scheda')],
        }
        : {}),
    },
  };
}

const UNA_SCHEDA = [{ name: 'generale', prompt: 'Generale', selected: true }];
const DUE_SCHEDE = [
  { name: 'generale', prompt: 'Generale', selected: true },
  { name: 'altro', prompt: 'Altro' },
];

interface OpzioniVista {
  cellVisible?: boolean;
  controlVisible?: boolean;
  type?: 'detailView' | 'embeddedView';
}

/** Una vista incorporata in forma di lista. */
function vista(viewName: string, o: OpzioniVista = {}) {
  const path = `S1-0.1,${viewName}`;
  return {
    elementType: ELTYPE_CONTAINER,
    colspan: 1,
    id: `cella_${viewName}`,
    ...(o.cellVisible === undefined ? {} : { visible: o.cellVisible }),
    control: {
      type: o.type ?? 'detailView',
      id: viewName,
      name: viewName,
      viewName,
      pageType: 1,
      ...(o.controlVisible === undefined ? {} : { visible: o.controlVisible }),
      headers: [{ text: 'Codice', colspan: 1 }],
      rows: [0, 1].map((pos) => ({
        id: `${viewName}_r${pos}`,
        props: { path: `${path}.${pos}` },
        cells: [{
          elementType: ELTYPE_CONTENT, colspan: 1, text: `v${pos}`,
          control: { name: `codice.${pos}`, id: 'codice', type: 'text', editable: false, value: `v${pos}` },
        }],
      })),
      header: { path },
      gridActions: { path, addCommand: 'Add' },
    },
  };
}

/** Dettaglio di primo livello: testata, poi le righe date (ognuna un gruppo di celle). */
function dettaglio(...righe: unknown[][]): UITree {
  return {
    viewName: 'docRegContabiliDetail',
    pageType: 2,
    path: 'S1-0.1',
    title: 'Reg. contabili - Dettaglio',
    rows: [...TESTATA, ...righe.map((cells, i) => ({ id: `b${i}`, cells }))],
  } as unknown as UITree;
}

/** Dettaglio con righe libere (per mettere il tab DENTRO la testata). */
function dettaglioRighe(rows: unknown[]): UITree {
  return {
    viewName: 'docRegContabiliDetail',
    pageType: 2,
    path: 'S1-0.1',
    title: 'Reg. contabili - Dettaglio',
    rows,
  } as unknown as UITree;
}

/* ── Montaggio ─────────────────────────────────────────────────────────── */

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = '';
});

function monta(ui: UITree) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const disegna = (u: UITree) => act(() => {
    root!.render(
      <App>
        <ViewRenderer ui={u} onAction={() => undefined} onChange={() => undefined} onGridChange={() => undefined} />
      </App>,
    );
  });
  disegna(ui);
  return { el: host, ridisegna: disegna };
}

const conta = (el: ParentNode, sel: string) => el.querySelectorAll(sel).length;

/** Una barra dei tab senza nessuna scheda dentro. */
function barreTabVuote(el: ParentNode): number {
  return [...el.querySelectorAll('.ant-tabs')].filter((t) => t.querySelectorAll('.ant-tabs-tab').length === 0).length;
}

/** Nessuna traccia di area inferiore: ne' area, ne' divisore, ne' barra vuota, ne' zoom. */
function attendiNessunaAreaInferiore(el: ParentNode) {
  expect(conta(el, '.view-split-bottom'), '.view-split-bottom').toBe(0);
  expect(conta(el, '.view-split-resizer'), '.view-split-resizer').toBe(0);
  expect(barreTabVuote(el), 'barra dei tab vuota').toBe(0);
  expect(conta(el, '.ant-tabs-nav'), '.ant-tabs-nav').toBe(0);
  expect(conta(el, ZOOM), 'pulsante «Ingrandisce sezione»').toBe(0);
}

/** La testata e' disegnata (i suoi valori ci sono). */
function attendiTestata(el: HTMLElement) {
  const html = el.innerHTML;
  expect(html).toContain('Competenza:');
  expect(html).toContain('Sottoconto:');
}

/* ── Prove ──────────────────────────────────────────────────────────────── */

describe('fixture (prerequisito)', () => {
  it('un tab con una scheda in coda apre davvero l\'area inferiore con barra e zoom', () => {
    const { el } = monta(dettaglio([tab(UNA_SCHEDA, true)]));
    expect(conta(el, '.view-split-bottom')).toBe(1);
    expect(conta(el, '.ant-tabs-tab')).toBeGreaterThanOrEqual(1);
    expect(conta(el, ZOOM)).toBeGreaterThanOrEqual(1);
  });

  it('una detailView visibile in coda disegna la sua griglia', () => {
    const { el } = monta(dettaglio([vista('righeList')]));
    expect(conta(el, '.griglia-stub')).toBe(1);
  });
});

describe('SXADV-6297 — 1. tab con zero schede: nessuna area inferiore', () => {
  it('tabs: [] come ultimo rigo (il caso della segnalazione)', () => {
    const { el } = monta(dettaglio([tab([])]));
    attendiTestata(el);
    attendiNessunaAreaInferiore(el);
  });

  it('tabs assenti come ultimo rigo', () => {
    const { el } = monta(dettaglio([tab(undefined)]));
    attendiTestata(el);
    attendiNessunaAreaInferiore(el);
  });

  it('la testata occupa la pagina: e\' l\'unica area, non .view-split-form accanto a un pannello', () => {
    const { el } = monta(dettaglio([tab([])]));
    // Senza pannello inferiore non c'e' niente da dividere.
    expect(conta(el, '.view-split-bottom')).toBe(0);
    expect(conta(el, '.view-split-resizer')).toBe(0);
  });

  it('tab con zero schede DENTRO la testata (non in coda): niente barra vuota, niente zoom', () => {
    const { el } = monta(dettaglioRighe([
      TESTATA[0],
      { id: 'mezzo', cells: [tab([])] },
      TESTATA[1],
      TESTATA[2],
    ]));
    attendiTestata(el);
    attendiNessunaAreaInferiore(el);
  });

  it('tab senza schede dentro la testata, tabs assenti', () => {
    const { el } = monta(dettaglioRighe([
      TESTATA[0],
      { id: 'mezzo', cells: [tab(undefined)] },
      TESTATA[1],
      TESTATA[2],
    ]));
    attendiNessunaAreaInferiore(el);
  });
});

describe('SXADV-6297 — 2. vista incorporata nascosta in coda: nessuna area inferiore', () => {
  const casi: [string, OpzioniVista][] = [
    ['detailView, cella visible=false', { cellVisible: false }],
    ['detailView, controllo visible=false', { controlVisible: false }],
    ['embeddedView, cella visible=false', { cellVisible: false, type: 'embeddedView' }],
    ['embeddedView, controllo visible=false', { controlVisible: false, type: 'embeddedView' }],
  ];

  it.each(casi)('%s', (_n, o) => {
    const { el } = monta(dettaglio([vista('righeList', o)]));
    attendiTestata(el);
    attendiNessunaAreaInferiore(el);
    expect(conta(el, '.griglia-stub'), 'la griglia nascosta non si disegna').toBe(0);
  });

  it('due viste nascoste in coda: nessuna area inferiore', () => {
    const { el } = monta(dettaglio(
      [vista('aList', { cellVisible: false })],
      [vista('bList', { controlVisible: false })],
    ));
    attendiNessunaAreaInferiore(el);
  });

  it('vista nascosta e tab vuoto in coda: nessuna area inferiore', () => {
    const { el } = monta(dettaglio([vista('righeList', { cellVisible: false })], [tab([])]));
    attendiNessunaAreaInferiore(el);
  });
});

describe('SXADV-6297 — 3. invariati', () => {
  it('tab con una scheda: area inferiore, barra con la scheda, pulsante di zoom', () => {
    const { el } = monta(dettaglio([tab(UNA_SCHEDA, true)]));
    expect(conta(el, '.view-split-bottom')).toBe(1);
    expect(conta(el, '.ant-tabs-nav')).toBeGreaterThanOrEqual(1);
    expect(el.innerHTML).toContain('Generale');
    expect(barreTabVuote(el)).toBe(0);
    expect(conta(el, ZOOM)).toBeGreaterThanOrEqual(1);
  });

  it('tab con due schede: area inferiore con le due schede', () => {
    const { el } = monta(dettaglio([tab(DUE_SCHEDE, true)]));
    expect(conta(el, '.view-split-bottom')).toBe(1);
    expect(conta(el, '.ant-tabs-tab')).toBe(2);
    expect(conta(el, ZOOM)).toBeGreaterThanOrEqual(1);
  });

  it('una detailView visibile in coda: area inferiore come oggi', () => {
    const { el } = monta(dettaglio([vista('righeList')]));
    expect(conta(el, '.view-split-bottom')).toBe(1);
    expect(conta(el, '.griglia-stub')).toBe(1);
    expect(conta(el, ZOOM)).toBeGreaterThanOrEqual(1);
  });

  it('piu\' sezioni senza tab (Sottoconti, SXADV-6300): pagina unica .view-flow', () => {
    const { el } = monta(dettaglio([vista('versioniList')], [vista('sediList')], [vista('riclassList')]));
    expect(conta(el, '.view-flow')).toBe(1);
    expect(conta(el, '.griglia-stub')).toBe(3);
    expect(conta(el, '.ant-tabs-nav')).toBe(0);
  });

  it('tab vuoto in coda + detailView visibile: c\'e\' la sola sezione della detailView', () => {
    const { el } = monta(dettaglio([vista('righeList')], [tab([])]));
    expect(conta(el, '.view-split-bottom')).toBe(1);
    expect(conta(el, '.griglia-stub')).toBe(1);
    expect(barreTabVuote(el), 'barra dei tab vuota').toBe(0);
    expect(conta(el, '.ant-tabs-nav')).toBe(0);
  });

  it('tab vuoto PRIMA della detailView visibile: stessa cosa', () => {
    const { el } = monta(dettaglio([tab([])], [vista('righeList')]));
    expect(conta(el, '.view-split-bottom')).toBe(1);
    expect(conta(el, '.griglia-stub')).toBe(1);
    expect(barreTabVuote(el), 'barra dei tab vuota').toBe(0);
    expect(conta(el, '.ant-tabs-nav')).toBe(0);
  });
});

describe('SXADV-6297 — 4. lo stesso tab cambia numero di schede col dato nuovo', () => {
  it('da zero schede a una: l\'area compare con barra e zoom', () => {
    const { el, ridisegna } = monta(dettaglio([tab([])]));
    ridisegna(dettaglio([tab(UNA_SCHEDA, true)]));
    expect(conta(el, '.view-split-bottom')).toBe(1);
    expect(conta(el, '.ant-tabs-tab')).toBeGreaterThanOrEqual(1);
    expect(conta(el, ZOOM)).toBeGreaterThanOrEqual(1);
    expect(el.innerHTML).toContain('Generale');
  });

  it('da zero schede a due: l\'area compare con le due schede', () => {
    const { el, ridisegna } = monta(dettaglio([tab(undefined)]));
    ridisegna(dettaglio([tab(DUE_SCHEDE, true)]));
    expect(conta(el, '.view-split-bottom')).toBe(1);
    expect(conta(el, '.ant-tabs-tab')).toBe(2);
  });

  it('da una scheda a zero: l\'area sparisce', () => {
    const { el, ridisegna } = monta(dettaglio([tab(UNA_SCHEDA, true)]));
    expect(conta(el, '.view-split-bottom'), 'prerequisito: prima c\'e\'').toBe(1);
    ridisegna(dettaglio([tab([])]));
    attendiTestata(el);
    attendiNessunaAreaInferiore(el);
  });

  it('andata e ritorno: zero -> una -> zero', () => {
    const { el, ridisegna } = monta(dettaglio([tab([])]));
    ridisegna(dettaglio([tab(UNA_SCHEDA, true)]));
    expect(conta(el, '.view-split-bottom')).toBe(1);
    ridisegna(dettaglio([tab([])]));
    attendiNessunaAreaInferiore(el);
  });
});
