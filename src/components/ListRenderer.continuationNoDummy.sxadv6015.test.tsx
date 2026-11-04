import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { UITree } from '../types/ui';
import { ELTYPE_CONTENT, ELTYPE_DUMMY } from '../types/ui';
import { buildColumnFieldName, resolveListBasePath } from './listEditPosting';

// SXADV-6015 — un record di lista su DUE righe di layout, la seconda che parte
// dalla colonna 0 (niente cella DUMMY in testa). Il server marca con
// `props.path` SOLO la riga primaria di ogni record (CORE LayoutManager, "si
// emette sempre, sulla riga primaria (quelle di continuazione sono lo stesso
// record e il client propaga il percorso della riga che le precede)").
//
// Contratto provato qui:
//   1. se la lista porta props.path, una riga SENZA path che segue una riga con
//      path e' la continuazione di quel record: un record = una riga primaria,
//      e il testo della seconda riga non finisce nelle colonne primarie (la
//      colonna Boolean «Sel.» che mostrerebbe «No»);
//   2. multiEdit: la spunta di selezione manda `selected.<vs>` con UNA voce per
//      record, non per riga di layout;
//   3. lista senza nessun props.path (forma vecchia/fixture): ogni riga non
//      DUMMY resta un record a se' (guardia di regressione);
//   4. riga con prima cella DUMMY: continuazione come prima.
//
// Motore di hook e browser finto come in ListRenderer.totals.sxadv5490.test.tsx:
// ListRenderer si esegue come funzione e si leggono le props di AgGridReact
// (rowData, onGridReady, onCellValueChanged).

type AnyFn = (...a: never[]) => unknown;

const rt = vi.hoisted(() => ({
  active: false,
  i: 0,
  slots: [] as { v: unknown; deps?: unknown[]; set?: unknown }[],
  effects: [] as { fn: () => unknown; deps?: unknown[] }[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const slot = (init: () => unknown) => {
    const i = rt.i++;
    if (!rt.slots[i]) rt.slots[i] = { v: init() };
    return rt.slots[i];
  };
  const same = (a?: unknown[], b?: unknown[]) =>
    !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
  const memo = (f: () => unknown, deps?: unknown[]) => {
    const i = rt.i++;
    const s = rt.slots[i];
    if (s && deps && same(s.deps, deps)) return s.v;
    rt.slots[i] = { v: f(), deps };
    return rt.slots[i].v;
  };
  const on = <F extends AnyFn>(real: F, fake: AnyFn): F =>
    ((...a: never[]) => (rt.active ? fake(...a) : real(...a))) as unknown as F;
  const effect = ((fn: () => unknown, deps?: unknown[]) => { rt.i++; rt.effects.push({ fn, deps }); }) as AnyFn;
  const over = {
    useState: on(actual.useState as AnyFn, ((init: unknown) => {
      const s = slot(() => (typeof init === 'function' ? (init as () => unknown)() : init));
      s.set ??= (nv: unknown) => {
        s.v = typeof nv === 'function' ? (nv as (p: unknown) => unknown)(s.v) : nv;
      };
      return [s.v, s.set];
    }) as AnyFn),
    useReducer: on(actual.useReducer as AnyFn, ((reducer: (s: unknown, a: unknown) => unknown, init: unknown, initFn?: (x: unknown) => unknown) => {
      const s = slot(() => (initFn ? initFn(init) : init));
      s.set ??= (a: unknown) => { s.v = reducer(s.v, a); };
      return [s.v, s.set];
    }) as AnyFn),
    useRef: on(actual.useRef as AnyFn, ((init: unknown) => slot(() => ({ current: init })).v) as AnyFn),
    useCallback: on(actual.useCallback as AnyFn, ((fn: unknown, deps?: unknown[]) => memo(() => fn, deps)) as AnyFn),
    useMemo: on(actual.useMemo as AnyFn, memo as AnyFn),
    useEffect: on(actual.useEffect as AnyFn, effect),
    useLayoutEffect: on(actual.useLayoutEffect as AnyFn, effect),
    useInsertionEffect: on(actual.useInsertionEffect as AnyFn, (() => { rt.i++; }) as AnyFn),
    useImperativeHandle: on(actual.useImperativeHandle as AnyFn, (() => { rt.i++; }) as AnyFn),
    useContext: on(actual.useContext as AnyFn, ((c: { _currentValue: unknown }) => c._currentValue) as AnyFn),
    useId: on(actual.useId as AnyFn, (() => ':t:') as AnyFn),
    useSyncExternalStore: on(actual.useSyncExternalStore as AnyFn, ((_s: unknown, get: () => unknown) => get()) as AnyFn),
    useTransition: on(actual.useTransition as AnyFn, (() => [false, (f: () => void) => f()]) as AnyFn),
    useDeferredValue: on(actual.useDeferredValue as AnyFn, ((v: unknown) => v) as AnyFn),
  };
  return { ...actual, ...over, default: { ...actual, ...over } };
});

vi.mock('../hooks/uiMode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/uiMode')>()),
  useUiMode: () => ({
    immersive: false, setImmersive: () => {}, zoomedGridId: null, setZoomedGridId: () => {},
    isOneLine: () => false, setOneLine: () => {},
  }),
}));
vi.mock('../hooks/hotkeys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/hotkeys')>()),
  useHotkey: () => {},
}));

const { default: ListRenderer } = await import('./ListRenderer');

const g = globalThis as Record<string, unknown>;
const realWindow = g.window;
const realDocument = g.document;
const realRaf = g.requestAnimationFrame;
const realCaf = g.cancelAnimationFrame;
function installBrowser() {
  g.requestAnimationFrame = () => 0;
  g.cancelAnimationFrame = () => {};
  g.window = {
    innerHeight: 800,
    innerWidth: 1280,
    setTimeout: (f: () => void, ms?: number) => setTimeout(f, ms),
    clearTimeout: (id?: number) => clearTimeout(id),
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: g.requestAnimationFrame,
    cancelAnimationFrame: g.cancelAnimationFrame,
    getComputedStyle: () => ({}),
  };
  g.document = {
    createElement: () => ({ getContext: () => null, style: {} }),
    body: { style: {} },
    activeElement: null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}
function restoreBrowser() {
  g.window = realWindow;
  g.document = realDocument;
  g.requestAnimationFrame = realRaf;
  g.cancelAnimationFrame = realCaf;
}
beforeEach(() => { installBrowser(); });
afterEach(() => { restoreBrowser(); });

// ── la lista: sollecitiScadenzeList incorporata, multiEdit ───────────────────
// Percorsi come sul server vero: riga primaria `S1-7.0,S1-8.<pos>`.
const UI_PATH = 'S1-7.0,S1-8';
const rowPath = (pos: number) => `${UI_PATH}.${pos}`;
const TIPO_DOC = 'Insoluti e Richiami RID';

type Shape = 'path' | 'nopath';

/** Riga primaria: Sel. (Boolean modificabile) + cliente + scadenza + importo. */
function primary(pos: number, shape: Shape): Record<string, unknown> {
  return {
    id: `p${pos}`,
    cls: pos % 2 ? 'oddRow' : 'evenRow',
    ...(shape === 'path' ? { props: { path: rowPath(pos), canDelete: true }, editData: { values: {} } } : {}),
    cells: [
      { elementType: ELTYPE_CONTENT, colspan: 1, control: { value: false, displayValue: 'No', editable: true } },
      { elementType: ELTYPE_CONTENT, colspan: 1, control: { value: `44|14866${pos}`, displayValue: `G101987${pos} AM TEAM` } },
      { elementType: ELTYPE_CONTENT, colspan: 1, control: { value: '31/10/2026' } },
      { elementType: ELTYPE_CONTENT, colspan: 1, control: { value: `${pos}00,00` } },
    ],
  };
}

/** Seconda riga del record: parte dalla colonna 0, niente DUMMY, niente props. */
function second(pos: number): Record<string, unknown> {
  return {
    cls: pos % 2 ? 'oddRow' : 'evenRow',
    cells: [
      { elementType: ELTYPE_CONTENT, colspan: 2, control: { value: TIPO_DOC, editable: false } },
      { elementType: ELTYPE_CONTENT, colspan: 1, control: { value: `1280${pos}` } },
      { elementType: ELTYPE_CONTENT, colspan: 1, control: { value: `Sollecito ${pos}` } },
    ],
  };
}

/** Seconda riga col DUMMY in testa (forma gia' gestita). */
function secondDummy(pos: number): Record<string, unknown> {
  return {
    cls: pos % 2 ? 'oddRow' : 'evenRow',
    cells: [
      { elementType: ELTYPE_DUMMY, colspan: 1 },
      { elementType: ELTYPE_CONTENT, colspan: 1, control: { value: TIPO_DOC, editable: false } },
      { elementType: ELTYPE_CONTENT, colspan: 1, control: { value: `1280${pos}` } },
      { elementType: ELTYPE_CONTENT, colspan: 1, control: { value: `Sollecito ${pos}` } },
    ],
  };
}

function listUi(rows: Record<string, unknown>[]): UITree {
  return {
    pageType: 1,
    viewName: 'sollecitiScadenzeList',
    path: UI_PATH,
    multiEdit: true,
    listEdit: true,
    headers: [
      { text: 'Sel.', colspan: 1 },
      { text: 'Cliente', colspan: 1 },
      { text: 'Scadenza', colspan: 1 },
      { text: 'Importo', colspan: 1 },
    ],
    continuationHeaders: [[
      { text: 'Tipo documento', colspan: 2 },
      { text: 'Numero documento', colspan: 1 },
      { text: 'Sollecito', colspan: 1 },
    ]],
    columns: [
      { elementType: ELTYPE_CONTENT, control: { name: 'selected', id: 'selected', type: 'boolean', editable: true } },
      { elementType: ELTYPE_CONTENT, control: { name: 'cliente', id: 'cliente', type: 'text' } },
      { elementType: ELTYPE_CONTENT, control: { name: 'scadenza', id: 'scadenza', type: 'date' } },
      { elementType: ELTYPE_CONTENT, control: { name: 'importo', id: 'importo', type: 'money' } },
    ],
    rows,
  } as unknown as UITree;
}

const twoRowRecords = (n: number, make: (pos: number) => Record<string, unknown>[]) =>
  Array.from({ length: n }, (_, i) => make(i)).flat();

// ── montaggio ───────────────────────────────────────────────────────────────
type El = ReactElement<Record<string, unknown>> & { type: unknown };
function findEl(n: unknown, pred: (e: El) => boolean, depth = 0): El | undefined {
  if (!n || typeof n !== 'object' || depth > 400) return undefined;
  if (Array.isArray(n)) { for (const x of n) { const f = findEl(x, pred, depth + 1); if (f) return f; } return undefined; }
  const e = n as El;
  if (!e.props) return undefined;
  if (pred(e)) return e;
  for (const v of Object.values(e.props)) {
    if (v && typeof v === 'object') { const f = findEl(v, pred, depth + 1); if (f) return f; }
  }
  return undefined;
}

type Row = Record<string, unknown>;

function mount(ui: UITree) {
  rt.slots = [];
  const onGridChange = vi.fn();
  const props = { ui, onAction: vi.fn(() => undefined), onSelectRecord: vi.fn(), onGridChange, embedded: true };
  let tree: ReactNode = null;
  const render = () => {
    rt.i = 0;
    rt.effects = [];
    rt.active = true;
    try {
      tree = (ListRenderer as unknown as (p: unknown) => ReactNode)(props);
    } finally {
      rt.active = false;
    }
  };
  render();
  const grid = () => {
    const el = findEl(tree, (e) => typeof e.props.onGridReady === 'function');
    if (!el) throw new Error('AgGridReact non trovato');
    return el;
  };
  const rowData = () => grid().props.rowData as Row[];
  const records = () => rowData().filter((r) => !r._isContinuationRow && !r._isBreakRow);
  const continuations = () => rowData().filter((r) => r._isContinuationRow);

  /** AG Grid finto: il tanto che pushColumnValues e onGridReady toccano. */
  const attachApi = () => {
    const api = {
      forEachNodeAfterFilterAndSort: (cb: (n: { data?: Row }) => void) => { for (const d of rowData()) cb({ data: d }); },
      forEachNode: (cb: (n: { data?: Row }) => void) => { for (const d of rowData()) cb({ data: d }); },
      isDestroyed: () => false,
      getAllDisplayedColumns: () => [],
      stopEditing: () => {},
      getGridOption: () => undefined,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    (grid().props.onGridReady as (p: unknown) => void)({ api });
    render();
  };

  /** La spunta di selezione sul record `k` (k-esima riga primaria). */
  const toggle = (k: number) => {
    const target = records()[k];
    target.col_0 = true;
    (grid().props.onCellValueChanged as (e: unknown) => void)({
      colDef: { field: 'col_0' },
      node: { data: target },
      newValue: true,
      oldValue: false,
    });
  };
  return { props, onGridChange, render, grid, rowData, records, continuations, attachApi, toggle };
}

const FIELD = buildColumnFieldName('selected', resolveListBasePath({ uiPath: UI_PATH }));

// ── 1. riga senza path dopo una con path = continuazione ───────────────────
describe('SXADV-6015: seconda riga del record senza DUMMY, props.path solo sulla primaria', () => {
  const ui = () => listUi(twoRowRecords(3, (p) => [primary(p, 'path'), second(p)]));

  it('una riga primaria per record (3 record, non 6)', () => {
    const m = mount(ui());
    expect(m.records()).toHaveLength(3);
  });

  it('le righe primarie sono quelle con il path, nell\'ordine', () => {
    const m = mount(ui());
    expect(m.records().map((r) => r._selectorPath)).toEqual([rowPath(0), rowPath(1), rowPath(2)]);
  });

  it('la seconda riga e\' resa come continuazione, col percorso del record che la precede', () => {
    const m = mount(ui());
    const cont = m.continuations();
    expect(cont).toHaveLength(3);
    expect(cont.map((r) => r._selectorPath)).toEqual([rowPath(0), rowPath(1), rowPath(2)]);
    const texts = cont.map((r) => ((r._continuationCells as { text?: string }[]) ?? []).map((c) => c.text));
    for (const t of texts) expect(t).toContain(TIPO_DOC);
  });

  it('il «Tipo documento» non finisce nella colonna Boolean «Sel.» di una riga primaria', () => {
    const m = mount(ui());
    // Nessuna riga primaria senza percorso: quella e' la seconda riga presa per un record.
    for (const r of m.records()) expect(r._selectorPath).toBeTruthy();
    for (const r of m.records()) expect(r._raw_0).not.toBe(TIPO_DOC);
  });
});

// ── 2. spunta multiEdit: una voce per record ───────────────────────────────
describe('SXADV-6015: spunta di selezione su una multiEdit con record a due righe', () => {
  it('selected.<vs> ha esattamente 3 voci, quella spuntata all\'indice del record', () => {
    const m = mount(listUi(twoRowRecords(3, (p) => [primary(p, 'path'), second(p)])));
    m.attachApi();
    m.toggle(1);
    expect(m.onGridChange).toHaveBeenCalled();
    const [name, values] = m.onGridChange.mock.calls.at(-1)!;
    expect(name).toBe(FIELD);
    expect(values).toEqual(['false', 'true', 'false']);
  });

  it('spunta sull\'ultimo record: indice 2 di 3', () => {
    const m = mount(listUi(twoRowRecords(3, (p) => [primary(p, 'path'), second(p)])));
    m.attachApi();
    m.toggle(m.records().length - 1);
    const [, values] = m.onGridChange.mock.calls.at(-1)!;
    expect(values).toEqual(['false', 'false', 'true']);
  });
});

// ── 3. guardia di regressione: lista senza props.path ──────────────────────
describe('SXADV-6015: lista senza nessun props.path (forma vecchia)', () => {
  const ui = () => listUi([primary(0, 'nopath'), second(0), primary(1, 'nopath'), second(1)]);

  it('ogni riga non DUMMY resta un record a se\'', () => {
    const m = mount(ui());
    expect(m.records()).toHaveLength(4);
    expect(m.continuations()).toHaveLength(0);
  });

  it('la spunta manda una voce per riga', () => {
    const m = mount(ui());
    m.attachApi();
    m.toggle(0);
    const [, values] = m.onGridChange.mock.calls.at(-1)!;
    expect(values).toHaveLength(4);
    expect(values[0]).toBe('true');
  });
});

// ── 4. DUMMY in testa: continuazione come prima ────────────────────────────
describe('SXADV-6015: seconda riga con DUMMY in testa', () => {
  it('con props.path sulle primarie: 3 record, 3 continuazioni', () => {
    const m = mount(listUi(twoRowRecords(3, (p) => [primary(p, 'path'), secondDummy(p)])));
    expect(m.records()).toHaveLength(3);
    expect(m.continuations()).toHaveLength(3);
    expect(m.continuations().map((r) => r._selectorPath)).toEqual([rowPath(0), rowPath(1), rowPath(2)]);
  });

  it('senza nessun props.path: 2 record, 2 continuazioni', () => {
    const m = mount(listUi([primary(0, 'nopath'), secondDummy(0), primary(1, 'nopath'), secondDummy(1)]));
    expect(m.records()).toHaveLength(2);
    expect(m.continuations()).toHaveLength(2);
  });

  it('la spunta manda una voce per record', () => {
    const m = mount(listUi(twoRowRecords(3, (p) => [primary(p, 'path'), secondDummy(p)])));
    m.attachApi();
    m.toggle(1);
    const [, values] = m.onGridChange.mock.calls.at(-1)!;
    expect(values).toEqual(['false', 'true', 'false']);
  });
});
