import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { UITree } from '../types/ui';
import { ELTYPE_CONTENT, ELTYPE_SELECTOR } from '../types/ui';

// SXADV-6242 — il rigo trovato dal «Cerca» si evidenzia e si porta a vista,
// ma il pannello di riga NON si apre: la ricerca non chiama mai onSelectRecord,
// nemmeno su una listEdit/multiEdit col pannello (prima: onSelectRecord(path,
// { focusPanel: true })). Di conseguenza la classe gialla «in modifica»
// (record-row-editing) non la mette una ricerca.
//
// Impianto copiato da ListRenderer.reveal.sxadv4569.test.tsx: motore di hook
// minimo, effetti registrati e fatti girare a mano solo quello del locate
// (riconosciuto dal sorgente: usa pathAtPosition); rAF e timer finti.

type AnyFn = (...a: never[]) => unknown;
interface Effect { fn: () => unknown; deps?: unknown[] }

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
const { default: ListSearchBox } = await import('./ListSearchBox');

// Browser finto, messo DOPO gli import. rAF in coda, eseguito a mano.
const g = globalThis as Record<string, unknown>;
let rafQueue: Map<number, () => void>;
let rafSeq = 0;
const realWindow = g.window;
const realDocument = g.document;
const realRaf = g.requestAnimationFrame;
const realCaf = g.cancelAnimationFrame;

function installBrowser() {
  rafQueue = new Map();
  g.requestAnimationFrame = (cb: () => void) => { const id = ++rafSeq; rafQueue.set(id, cb); return id; };
  g.cancelAnimationFrame = (id: number) => { rafQueue.delete(id); };
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
/** Esegue i frame in coda (e quelli che ne nascono), al piu' `max` giri. */
function frames(max = 20) {
  for (let k = 0; k < max && rafQueue.size > 0; k++) {
    const batch = [...rafQueue.entries()];
    rafQueue.clear();
    for (const [, cb] of batch) cb();
  }
}

// ── la lista ────────────────────────────────────────────────────────────────
const LIST = 'S1-0.2,S1-3';
const rowPath = (pos: number) => `${LIST}.${pos}`;

interface Opts { listEdit?: boolean; multiEdit?: boolean; panel?: boolean; canEdit?: boolean }

/** Una lista con colonna selettore; col pannello di riga se `panel`. */
function listUi(n: number, o: Opts = {}): UITree {
  return {
    pageType: 1,
    viewName: 'eventiList',
    path: LIST,
    listEdit: o.listEdit ?? false,
    multiEdit: o.multiEdit ?? false,
    hasDetailView: true,
    ...(o.panel ? { panelTemplateKey: 'eventiDetail' } : {}),
    headers: [{ text: '', colspan: 1 }, { text: 'Nome', colspan: 1 }],
    columns: [
      { elementType: ELTYPE_SELECTOR, selector: { command: 'NavigateDetail', basePath: LIST, canEdit: o.canEdit ?? true, canUpdate: true } },
      { elementType: ELTYPE_CONTENT, control: { name: 'nome', id: 'nome', type: 'text' } },
    ],
    rows: Array.from({ length: n }, (_, i) => ({
      id: `r${i}`,
      props: { path: rowPath(i) },
      editData: { values: {} },
      cells: [
        { elementType: ELTYPE_SELECTOR, colspan: 1, pos: i },
        { elementType: ELTYPE_CONTENT, colspan: 1, text: `Nome ${i}`, control: { name: `nome.S1-3.${i}`, id: 'nome', type: 'text', editable: false, value: `Nome ${i}` } },
      ],
    })),
  } as unknown as UITree;
}

type El = ReactElement<Record<string, unknown>>;
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

function fakeApi(n: number) {
  const api = {
    destroyed: false,
    isDestroyed: () => api.destroyed,
    ensureIndexVisible: vi.fn(),
    forEachNode: (cb: (n: { data?: Record<string, unknown>; rowIndex?: number | null; id?: string }) => void) => {
      for (let i = 0; i < n; i++) cb({ data: { _selectorPath: rowPath(i), _selectorCommand: 'NavigateDetail' }, rowIndex: i, id: `r${i}` });
    },
    getAllDisplayedColumns: () => [],
    setFocusedCell: () => {},
    deselectAll: () => {},
    getDisplayedRowCount: () => n,
    getDisplayedRowAtIndex: () => null,
    refreshCells: () => {},
    redrawRows: () => {},
    resetRowHeights: () => {},
    onRowHeightChanged: () => {},
    getColumnDefs: () => [],
    getColumns: () => [],
    sizeColumnsToFit: () => {},
    setGridOption: () => {},
    getGridOption: () => undefined,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return api;
}

function mount(n: number, o: Opts = {}) {
  rt.slots = [];
  const ui = listUi(n, o);
  const props = {
    ui,
    onAction: vi.fn((...a: unknown[]) => { void a; return undefined; }),
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
  const api = fakeApi(n);
  const gridEl = () => {
    const g0 = findEl(tree, (e) => typeof e.props.onGridReady === 'function');
    if (!g0) throw new Error('AgGridReact non trovato');
    return g0;
  };
  (gridEl().props.onGridReady as (p: unknown) => void)({ api });
  const runEffect = (marker: string) => {
    const e = rt.effects.filter((x) => (x as Effect).fn.toString().includes(marker));
    if (e.length !== 1) throw new Error(`effetto "${marker}": trovati ${e.length}`);
    e[0].fn();
  };
  return {
    props,
    api,
    render,
    /** Le regole di classe passate ad AG Grid. */
    rowClass(cls: string, pos: number): boolean {
      render();
      const rules = gridEl().props.rowClassRules as Record<string, (p: unknown) => boolean> | undefined;
      if (!rules?.[cls]) throw new Error(`regola "${cls}" assente`);
      return !!rules[cls]({ data: { _selectorPath: rowPath(pos) } });
    },
    /** Il server ha trovato il rigo: come ListSearchBox chiama onFound. */
    found(position: number) {
      render();
      const box = findEl(tree, (e) => e.type === ListSearchBox);
      if (!box) throw new Error('ListSearchBox non trovato');
      (box.props.onFound as (p: number) => void)(position);
      render();
      runEffect('pathAtPosition');
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  installBrowser();
});
afterEach(() => {
  vi.useRealTimers();
  restoreBrowser();
});

const calls = (f: { mock: { calls: unknown } }) => f.mock.calls as unknown[][];

describe('ListRenderer: il «Cerca» evidenzia ma non apre il pannello (SXADV-6242)', () => {
  it.each([
    ['listEdit col pannello', { listEdit: true, panel: true }],
    ['listEdit + multiEdit col pannello', { listEdit: true, multiEdit: true, panel: true }],
    ['multiEdit col pannello', { multiEdit: true, panel: true }],
  ] as const)('%s: onSelectRecord non chiamato', (_n, o) => {
    const v = mount(10, o);
    v.found(7);
    frames();
    vi.advanceTimersByTime(1000);
    frames();
    expect(v.props.onSelectRecord).not.toHaveBeenCalled();
  });

  it.each([
    ['listEdit col pannello', { listEdit: true, panel: true }],
    ['listEdit + multiEdit col pannello', { listEdit: true, multiEdit: true, panel: true }],
  ] as const)('%s: il rigo trovato si evidenzia (record-group-selected) e si porta a vista', (_n, o) => {
    const v = mount(10, o);
    v.found(7);
    frames();
    expect(calls(v.api.ensureIndexVisible)[0]).toEqual([7, 'middle']);
    expect(v.rowClass('record-group-selected', 7)).toBe(true);
    expect(v.rowClass('record-group-selected', 6)).toBe(false);
  });

  it('listEdit col pannello: la ricerca non mette la classe gialla record-row-editing', () => {
    const v = mount(10, { listEdit: true, panel: true });
    v.found(7);
    frames();
    vi.advanceTimersByTime(1000);
    expect(v.rowClass('record-row-editing', 7)).toBe(false);
  });

  it('ricerche consecutive: nessuna apre il pannello, l\'evidenza segue l\'ultimo rigo', () => {
    const v = mount(10, { listEdit: true, panel: true });
    v.found(2);
    frames();
    v.found(8);
    frames();
    expect(v.props.onSelectRecord).not.toHaveBeenCalled();
    expect(v.rowClass('record-group-selected', 8)).toBe(true);
    expect(v.rowClass('record-group-selected', 2)).toBe(false);
  });

  it('lista senza pannello: niente onSelectRecord e nessuna navigazione (invariato)', () => {
    const v = mount(10);
    v.found(3);
    frames();
    vi.advanceTimersByTime(1000);
    expect(v.props.onSelectRecord).not.toHaveBeenCalled();
    expect(calls(v.props.onAction).map((c) => c[0])).not.toContain('NavigateDetail');
    expect(v.rowClass('record-group-selected', 3)).toBe(true);
  });

  it('listEdit col pannello: la ricerca non naviga nemmeno (niente NavigateDetail)', () => {
    const v = mount(10, { listEdit: true, panel: true });
    v.found(5);
    frames();
    vi.advanceTimersByTime(1000);
    expect(calls(v.props.onAction).map((c) => c[0])).not.toContain('NavigateDetail');
  });
});
