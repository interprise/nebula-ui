import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { UITree } from '../types/ui';
import { ELTYPE_CONTENT, ELTYPE_DUMMY, ELTYPE_SELECTOR } from '../types/ui';

// SXADV-5859.e — il «>» (colonna selettore, SelectorNavRenderer) di una lista
// listEdit.
//   - micro-detail (listEdit, non multiEdit, inlineEdit !== false): il «>» non
//     apre una pagina; fa quello che fa il clic sul rigo (activateRow). Col
//     pannello di riga apre il pannello (onSelectRecord) e non manda
//     NavigateDetail. Rigo non trovato nei dati: onAction(command, {navpath}).
//   - lista che apre la pagina (non listEdit, inlineEdit=false, multiEdit):
//     come prima, ritorno armato, rigo ricordato, onAction(command, {navpath}),
//     mai onSelectRecord.
//
// Motore di hook e browser finto come in ListRenderer.continuationNoDummy.sxadv6015.test.tsx.

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

// Ritorno armato e rigo ricordato: si spiano le funzioni vere.
const mem = vi.hoisted(() => ({ armReturn: null as unknown as ReturnType<typeof vi.fn>, rememberRow: null as unknown as ReturnType<typeof vi.fn> }));
vi.mock('./rowSelectionMemory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./rowSelectionMemory')>();
  mem.armReturn = vi.fn(actual.armReturn);
  mem.rememberRow = vi.fn(actual.rememberRow);
  return { ...actual, armReturn: mem.armReturn, rememberRow: mem.rememberRow };
});

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
beforeEach(() => { installBrowser(); mem.armReturn.mockClear(); mem.rememberRow.mockClear(); });
afterEach(() => { restoreBrowser(); });

// ── la lista ────────────────────────────────────────────────────────────────
const LIST = 'S1-5';
const UI_PATH = 'S1-4.0,S1-5';
const rowPath = (pos: number) => `${UI_PATH}.${pos}`;
const CMD = 'NavigateDetail';

type Opts = {
  listEdit?: boolean;
  multiEdit?: boolean;
  inlineEdit?: boolean;
  panel?: boolean;
  canEdit?: boolean;
  canUpdate?: boolean;
  continuation?: boolean;
  n?: number;
};

function listUi(o: Opts = {}): UITree {
  const n = o.n ?? 3;
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: `r${i}`,
      props: { path: rowPath(i) },
      editData: { values: {} },
      cells: [
        { elementType: ELTYPE_SELECTOR, colspan: 1, pos: i },
        { elementType: ELTYPE_CONTENT, colspan: 1, text: `Riga ${i}`, control: { name: 'descrizione', id: 'descrizione', value: `Riga ${i}` } },
        { elementType: ELTYPE_CONTENT, colspan: 1, text: String(i), control: { name: 'quantita', id: 'quantita', value: String(i) } },
      ],
    });
    if (o.continuation) {
      rows.push({
        cells: [
          { elementType: ELTYPE_DUMMY, colspan: 1 },
          { elementType: ELTYPE_CONTENT, colspan: 2, text: `Note ${i}`, control: { value: `Note ${i}`, editable: false } },
        ],
      });
    }
  }
  return {
    pageType: 1,
    viewName: 'righeList',
    path: UI_PATH,
    listEdit: o.listEdit ?? true,
    multiEdit: o.multiEdit ?? false,
    ...(o.inlineEdit !== undefined ? { inlineEdit: o.inlineEdit } : {}),
    hasDetailView: true,
    ...(o.panel ?? true ? { panelTemplateKey: 'righeDetail' } : {}),
    headers: [
      { text: '', colspan: 1 },
      { text: 'Descrizione', colspan: 1 },
      { text: 'Quantita', colspan: 1 },
    ],
    ...(o.continuation ? { continuationHeaders: [[{ text: '', colspan: 1 }, { text: 'Note', colspan: 2 }]] } : {}),
    columns: [
      { elementType: ELTYPE_SELECTOR, selector: { command: CMD, basePath: LIST, canEdit: o.canEdit ?? true, canUpdate: o.canUpdate ?? true } },
      { elementType: ELTYPE_CONTENT, control: { name: 'descrizione', id: 'descrizione', type: 'text' } },
      { elementType: ELTYPE_CONTENT, control: { name: 'quantita', id: 'quantita', type: 'number' } },
    ],
    rows,
  } as unknown as UITree;
}

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
  const props = {
    ui,
    onAction: vi.fn((..._a: unknown[]) => undefined),
    onSelectRecord: vi.fn(),
    onGridChange: vi.fn(),
    embedded: true,
  };
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
  const selCol = () => (grid().props.columnDefs as Row[]).find((c) => c.field === '_selnav');

  /** Il «>» disegnato per `data`: null se il renderer non lo disegna. */
  const selector = (data: Row) => {
    const col = selCol();
    if (!col) throw new Error('colonna selettore assente');
    const R = col.cellRenderer as (p: unknown) => El | null;
    return R({ data, ...(col.cellRendererParams as Row) });
  };
  /** Clic sul «>» del rigo `data`. */
  const clickSelector = (data: Row) => {
    const el = selector(data);
    if (!el) throw new Error('«>» non disegnato');
    const stopPropagation = vi.fn();
    (el.props.onClick as (e: unknown) => void)({ stopPropagation });
    return stopPropagation;
  };
  /** Clic sul rigo (onRowClicked di AG Grid), fuori dal selettore. */
  const clickRow = (data: Row, target: { closest: (s: string) => unknown } = { closest: () => null }) => {
    (grid().props.onRowClicked as (e: unknown) => void)({ data, node: { data }, event: { target } });
  };
  const navigateCalls = () => props.onAction.mock.calls.filter((c) => c[0] === CMD);
  return { props, render, grid, rowData, records, continuations, selCol, selector, clickSelector, clickRow, navigateCalls };
}

// ── 1. micro-detail col pannello ───────────────────────────────────────────
describe('SXADV-5859.e: micro-detail con pannello, il «>» apre il pannello', () => {
  it('la colonna «>» c\'e\' (listEdit + hasDetailView)', () => {
    const m = mount(listUi());
    expect(m.selCol()).toBeTruthy();
    expect(m.selector(m.records()[1])).not.toBeNull();
  });

  it('il «>» chiama onSelectRecord(path) e non manda NavigateDetail', () => {
    const m = mount(listUi());
    m.clickSelector(m.records()[1]);
    expect(m.props.onSelectRecord).toHaveBeenCalledTimes(1);
    expect(m.props.onSelectRecord.mock.calls[0][0]).toBe(rowPath(1));
    expect(m.navigateCalls()).toHaveLength(0);
    expect(m.props.onAction).not.toHaveBeenCalled();
  });

  it('nessun ritorno armato: la pagina non cambia', () => {
    const m = mount(listUi());
    m.clickSelector(m.records()[0]);
    expect(mem.armReturn).not.toHaveBeenCalled();
  });

  it('il clic sul «>» non si propaga al rigo', () => {
    const m = mount(listUi());
    const stop = m.clickSelector(m.records()[0]);
    expect(stop).toHaveBeenCalled();
  });

  it('inlineEdit=true esplicito: stesso comportamento', () => {
    const m = mount(listUi({ inlineEdit: true }));
    m.clickSelector(m.records()[2]);
    expect(m.props.onSelectRecord).toHaveBeenCalledTimes(1);
    expect(m.props.onSelectRecord.mock.calls[0][0]).toBe(rowPath(2));
    expect(m.navigateCalls()).toHaveLength(0);
  });

  it('il «>» fa esattamente quello che fa il clic sul rigo', () => {
    const a = mount(listUi());
    a.clickSelector(a.records()[1]);
    const viaSel = { sel: a.props.onSelectRecord.mock.calls.map((c) => c[0]), act: a.props.onAction.mock.calls };
    const b = mount(listUi());
    b.clickRow(b.records()[1]);
    const viaRow = { sel: b.props.onSelectRecord.mock.calls.map((c) => c[0]), act: b.props.onAction.mock.calls };
    expect(viaSel).toEqual(viaRow);
  });

  it('il rigo cliccato col «>» viene ricordato, come col clic sul rigo', () => {
    const m = mount(listUi());
    m.clickSelector(m.records()[1]);
    expect(mem.rememberRow.mock.calls.some((c) => c[1] === rowPath(1))).toBe(true);
  });

  it('il clic sul «>» che AG Grid vede anche come clic sul rigo apre il pannello una volta sola', () => {
    const m = mount(listUi());
    const data = m.records()[1];
    m.clickSelector(data);
    // AG Grid riceve lo stesso clic: il target sta nella cella del selettore.
    m.clickRow(data, { closest: (s: string) => (s.includes('.selector-nav-cell') ? {} : null) });
    expect(m.props.onSelectRecord).toHaveBeenCalledTimes(1);
    expect(m.props.onAction).not.toHaveBeenCalled();
  });
});

// ── 2. micro-detail con righe di continuazione ─────────────────────────────
describe('SXADV-5859.e: micro-detail, rigo con righe di continuazione', () => {
  it('fixture: 3 record e 3 continuazioni col percorso del record', () => {
    const m = mount(listUi({ continuation: true }));
    expect(m.records()).toHaveLength(3);
    expect(m.continuations().map((r) => r._selectorPath)).toEqual([rowPath(0), rowPath(1), rowPath(2)]);
  });

  it('sulla riga di continuazione il «>» non si disegna', () => {
    const m = mount(listUi({ continuation: true }));
    expect(m.selector(m.continuations()[0])).toBeNull();
  });

  it('il «>» del rigo primario apre il pannello sul record, una volta', () => {
    const m = mount(listUi({ continuation: true }));
    m.clickSelector(m.records()[1]);
    expect(m.props.onSelectRecord).toHaveBeenCalledTimes(1);
    expect(m.props.onSelectRecord.mock.calls[0][0]).toBe(rowPath(1));
    expect(m.navigateCalls()).toHaveLength(0);
  });

  it('il «>» dell\'ultimo record (seguito solo dalla sua continuazione) apre il pannello', () => {
    const m = mount(listUi({ continuation: true }));
    m.clickSelector(m.records()[2]);
    expect(m.props.onSelectRecord.mock.calls.map((c) => c[0])).toEqual([rowPath(2)]);
    expect(m.navigateCalls()).toHaveLength(0);
  });
});

// ── 3. micro-detail: casi limite di activateRow / rowClickOutcome ──────────
describe('SXADV-5859.e: micro-detail, casi limite', () => {
  it('rigo non trovato nei dati della griglia: ripiega su onAction(command, {navpath})', () => {
    const m = mount(listUi());
    const ghost = { _selectorPath: rowPath(99), _selectorCommand: CMD };
    m.clickSelector(ghost);
    expect(m.props.onSelectRecord).not.toHaveBeenCalled();
    expect(m.navigateCalls()).toEqual([[CMD, { navpath: rowPath(99) }]]);
    // Ripiego del micro-detail: la pagina non cambia, niente ritorno.
    expect(mem.armReturn).not.toHaveBeenCalled();
  });

  it('senza pannello (micro-detail senza panelTemplateKey): come il clic sul rigo, NavigateDetail senza ritorno', () => {
    const a = mount(listUi({ panel: false }));
    a.clickSelector(a.records()[1]);
    expect(a.props.onSelectRecord).not.toHaveBeenCalled();
    expect(a.navigateCalls()).toEqual([[CMD, { navpath: rowPath(1) }]]);
    expect(mem.armReturn).not.toHaveBeenCalled();
    const b = mount(listUi({ panel: false }));
    b.clickRow(b.records()[1]);
    expect(b.props.onAction.mock.calls).toEqual(a.props.onAction.mock.calls);
  });

  it('pannello ma rigo non modificabile (canEdit false): come il clic sul rigo, niente pannello', () => {
    const a = mount(listUi({ canEdit: false }));
    a.clickSelector(a.records()[0]);
    expect(a.props.onSelectRecord).not.toHaveBeenCalled();
    const b = mount(listUi({ canEdit: false }));
    b.clickRow(b.records()[0]);
    expect(a.props.onAction.mock.calls).toEqual(b.props.onAction.mock.calls);
    expect(a.props.onSelectRecord.mock.calls).toEqual(b.props.onSelectRecord.mock.calls);
  });

  it('pannello ma vista non aggiornabile (canUpdate false): come il clic sul rigo, niente pannello', () => {
    const a = mount(listUi({ canUpdate: false }));
    a.clickSelector(a.records()[0]);
    expect(a.props.onSelectRecord).not.toHaveBeenCalled();
    const b = mount(listUi({ canUpdate: false }));
    b.clickRow(b.records()[0]);
    expect(a.props.onAction.mock.calls).toEqual(b.props.onAction.mock.calls);
  });

  it('dopo un nuovo render (righe nuove dal server) il «>» usa i dati correnti', () => {
    const m = mount(listUi({ n: 2 }));
    m.props.ui = listUi({ n: 4 });
    m.render();
    m.clickSelector(m.records()[3]);
    expect(m.props.onSelectRecord.mock.calls.map((c) => c[0])).toEqual([rowPath(3)]);
    expect(m.navigateCalls()).toHaveLength(0);
  });
});

// ── 4. liste dove il «>» apre una pagina: come prima ───────────────────────
describe('SXADV-5859.e: il «>» apre la pagina di dettaglio, come prima', () => {
  const expectOldBehaviour = (m: ReturnType<typeof mount>, k: number) => {
    m.clickSelector(m.records()[k]);
    expect(m.props.onSelectRecord).not.toHaveBeenCalled();
    expect(m.navigateCalls()).toEqual([[CMD, { navpath: rowPath(k) }]]);
    expect(mem.armReturn).toHaveBeenCalledTimes(1);
    expect(mem.armReturn.mock.calls[0][1]).toBe('row');
    expect(mem.rememberRow.mock.calls.some((c) => c[1] === rowPath(k))).toBe(true);
  };

  it('inlineEdit=false con detailViewName: NavigateDetail, ritorno armato, rigo ricordato', () => {
    expectOldBehaviour(mount(listUi({ inlineEdit: false })), 1);
  });

  it('inlineEdit=false con pannello e righe di continuazione: sempre NavigateDetail', () => {
    expectOldBehaviour(mount(listUi({ inlineEdit: false, continuation: true })), 2);
  });

  it('multiEdit: NavigateDetail, ritorno armato, mai il pannello', () => {
    expectOldBehaviour(mount(listUi({ multiEdit: true })), 0);
  });

  it('multiEdit in linea esplicita (inlineEdit=true): NavigateDetail come prima', () => {
    expectOldBehaviour(mount(listUi({ multiEdit: true, inlineEdit: true })), 1);
  });

  it('multiEdit senza pannello: NavigateDetail come prima', () => {
    expectOldBehaviour(mount(listUi({ multiEdit: true, panel: false })), 1);
  });

  it('rigo non nei dati su una lista che apre la pagina: NavigateDetail con ritorno', () => {
    const m = mount(listUi({ inlineEdit: false }));
    m.clickSelector({ _selectorPath: rowPath(42), _selectorCommand: CMD });
    expect(m.props.onSelectRecord).not.toHaveBeenCalled();
    expect(m.navigateCalls()).toEqual([[CMD, { navpath: rowPath(42) }]]);
    expect(mem.armReturn).toHaveBeenCalledTimes(1);
  });

  it('lista non listEdit: la colonna «>» non c\'e\' (il clic sul rigo naviga)', () => {
    const m = mount(listUi({ listEdit: false }));
    expect(m.selCol()).toBeUndefined();
  });

  it('lista non listEdit: il renderer «>», se chiamato, manda NavigateDetail con ritorno e niente pannello', () => {
    // La colonna non si monta su una non listEdit, ma openDetailRef e' lo stesso:
    // si usa il renderer di una lista listEdit dopo aver riletto la ui come non listEdit.
    const m = mount(listUi({ inlineEdit: false }));
    const col = m.selCol()!;
    m.props.ui = listUi({ listEdit: false });
    m.render();
    const R = col.cellRenderer as (p: unknown) => El;
    const el = R({ data: m.records()[1], ...(col.cellRendererParams as Row) });
    (el.props.onClick as (e: unknown) => void)({ stopPropagation: () => {} });
    expect(m.props.onSelectRecord).not.toHaveBeenCalled();
    expect(m.navigateCalls()).toEqual([[CMD, { navpath: rowPath(1) }]]);
    expect(mem.armReturn).toHaveBeenCalledTimes(1);
  });
});
