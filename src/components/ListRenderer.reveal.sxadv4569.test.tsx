import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { UITree } from '../types/ui';
import { ELTYPE_CONTENT } from '../types/ui';

// SXADV-4569 — il rigo trovato dal «Cerca» si porta a vista. Contratto:
//   - trovato il rigo: api.ensureIndexVisible(index, 'middle');
//   - al frame successivo (rAF) e di nuovo dopo 300 ms (REVEAL_AFTER_PANEL_MS):
//     revealRow(index) = api.ensureIndexVisible(index) SENZA posizione, poi
//     scrollIntoView({block:'nearest', inline:'nearest'}) sull'elemento
//     `.ag-center-cols-container .ag-row[row-index="<index>"]` del contenitore
//     della griglia;
//   - revealRow non fa nulla ad api distrutta, e non lancia se l'elemento manca;
//   - il timer si cancella allo smontaggio e quando parte un nuovo locate.
//
// Niente DOM: un motore di hook minimo esegue ListRenderer come funzione. Gli
// effetti si registrano ma NON girano, tranne quelli della prova, riconosciuti
// dal sorgente: l'effetto del locate (usa pathAtPosition) e lo smontaggio del
// timer (revealTimerRef). L'api di AG Grid arriva da onGridReady dell'elemento
// AgGridReact, il contenitore della griglia dalla sua ref; rAF e timer sono finti.

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
function listUi(n: number): UITree {
  return {
    pageType: 1,
    viewName: 'eventiList',
    path: LIST,
    headers: [{ text: 'Nome', colspan: 1 }],
    rows: Array.from({ length: n }, (_, i) => ({
      id: `r${i}`,
      props: { path: rowPath(i) },
      cells: [{ elementType: ELTYPE_CONTENT, colspan: 1, text: `Nome ${i}`, control: { name: `nome.S1-3.${i}`, id: 'nome', type: 'text', editable: false, value: `Nome ${i}` } }],
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

interface FakeApi {
  destroyed: boolean;
  isDestroyed: () => boolean;
  ensureIndexVisible: ReturnType<typeof vi.fn>;
  forEachNode: (cb: (n: { data?: Record<string, unknown>; rowIndex?: number | null }) => void) => void;
  [k: string]: unknown;
}

function fakeApi(n: number): FakeApi {
  const api: FakeApi = {
    destroyed: false,
    isDestroyed: () => api.destroyed,
    ensureIndexVisible: vi.fn(),
    forEachNode: (cb) => {
      for (let i = 0; i < n; i++) cb({ data: { _selectorPath: rowPath(i) }, rowIndex: i });
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

/** Una ListRenderer "montata": stato tra i disegni, effetti registrati. */
function mount(n: number) {
  rt.slots = [];
  const ui = listUi(n);
  const props = { ui, onAction: vi.fn(() => undefined), embedded: true };
  let tree: ReactNode = null;
  const cleanups: (() => void)[] = [];
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
  const grid = findEl(tree, (e) => typeof e.props.onGridReady === 'function');
  if (!grid) throw new Error('AgGridReact non trovato');
  (grid.props.onGridReady as (p: unknown) => void)({ api });
  // Il contenitore della griglia: l'elemento con ref che porta la griglia.
  const rowEls = new Map<number, { scrollIntoView: ReturnType<typeof vi.fn> }>();
  const querySelector = vi.fn((sel: string) => {
    const m = /\.ag-center-cols-container \.ag-row\[row-index="(\d+)"\]/.exec(sel);
    if (!m) return null;
    return rowEls.get(Number(m[1])) ?? null;
  });
  const container = findEl(tree, (e) => {
    const ref = e.props.ref as { current?: unknown } | undefined;
    return !!ref && typeof ref === 'object' && 'current' in ref && !!findEl(e.props.children, (c) => c === grid);
  });
  if (!container) throw new Error('contenitore della griglia non trovato');
  const containerRef = container.props.ref as { current: unknown };
  containerRef.current = { querySelector, clientHeight: 400, clientWidth: 800, getBoundingClientRect: () => ({ top: 0, left: 0, width: 800, height: 400 }) };
  const effect = (marker: string): Effect => {
    const e = rt.effects.filter((x) => x.fn.toString().includes(marker));
    if (e.length !== 1) throw new Error(`effetto "${marker}": trovati ${e.length}`);
    return e[0];
  };
  const runEffect = (marker: string) => {
    const c = effect(marker).fn();
    if (typeof c === 'function') cleanups.push(c as () => void);
  };
  return {
    api,
    rowEls,
    querySelector,
    render,
    /** Il server ha trovato il rigo: come ListSearchBox chiama onFound. */
    found(position: number) {
      render();
      const box = findEl(tree, (e) => e.type === ListSearchBox);
      if (!box) throw new Error('ListSearchBox non trovato');
      (box.props.onFound as (p: number) => void)(position);
      render();
      runEffect('pathAtPosition');
    },
    /** Lo smontaggio: le pulizie degli effetti eseguiti e quella del timer. */
    unmount() {
      for (const c of cleanups.splice(0)) c();
      const t = rt.effects.filter((x) => x.fn.toString().includes('revealTimerRef') && !x.fn.toString().includes('pathAtPosition'));
      for (const e of t) {
        const c = e.fn();
        if (typeof c === 'function') (c as () => void)();
      }
    },
    addRow(index: number) {
      const el = { scrollIntoView: vi.fn() };
      rowEls.set(index, el);
      return el;
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

describe('ListRenderer: il rigo trovato si porta a vista (SXADV-4569)', () => {
  it('trovato: ensureIndexVisible(index, \'middle\')', () => {
    const v = mount(10);
    v.found(7);
    frames(1); // il tentativo dell'effetto
    expect(calls(v.api.ensureIndexVisible)[0]).toEqual([7, 'middle']);
  });

  it('al frame successivo: ensureIndexVisible(index) senza posizione + scrollIntoView nearest', () => {
    const v = mount(10);
    const row = v.addRow(7);
    v.found(7);
    frames(1);
    expect(v.api.ensureIndexVisible).toHaveBeenCalledTimes(1);
    expect(row.scrollIntoView).not.toHaveBeenCalled();
    frames(1);
    const c = calls(v.api.ensureIndexVisible);
    expect(c[1]).toEqual([7]);
    expect(row.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(row.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(calls(v.querySelector).map((x) => x[0])).toContain('.ag-center-cols-container .ag-row[row-index="7"]');
  });

  it('di nuovo dopo 300 ms', () => {
    const v = mount(10);
    const row = v.addRow(4);
    v.found(4);
    frames();
    expect(row.scrollIntoView).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(299);
    expect(row.scrollIntoView).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(row.scrollIntoView).toHaveBeenCalledTimes(2);
    expect(calls(v.api.ensureIndexVisible).at(-1)).toEqual([4]);
  });

  it('elemento del rigo assente: nessuna eccezione, ensureIndexVisible comunque', () => {
    const v = mount(10);
    v.found(2);
    expect(() => { frames(); vi.advanceTimersByTime(300); }).not.toThrow();
    expect(calls(v.api.ensureIndexVisible).filter((x) => x.length === 1 && x[0] === 2).length).toBeGreaterThanOrEqual(2);
  });

  it('elemento senza scrollIntoView: nessuna eccezione', () => {
    const v = mount(10);
    v.rowEls.set(2, {} as { scrollIntoView: ReturnType<typeof vi.fn> });
    v.found(2);
    expect(() => { frames(); vi.advanceTimersByTime(300); }).not.toThrow();
  });

  it('api distrutta prima del frame / del timer: revealRow non fa nulla', () => {
    const v = mount(10);
    const row = v.addRow(5);
    v.found(5);
    frames(1);
    const before = calls(v.api.ensureIndexVisible).length;
    v.api.destroyed = true;
    frames();
    vi.advanceTimersByTime(300);
    expect(calls(v.api.ensureIndexVisible).length).toBe(before);
    expect(row.scrollIntoView).not.toHaveBeenCalled();
  });

  it('smontaggio prima dei 300 ms: il timer non scatta', () => {
    const v = mount(10);
    const row = v.addRow(3);
    v.found(3);
    frames();
    expect(row.scrollIntoView).toHaveBeenCalledTimes(1);
    v.unmount();
    vi.advanceTimersByTime(1000);
    expect(row.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('un nuovo locate trovato prima dei 300 ms: il timer vecchio non scatta', () => {
    const v = mount(10);
    const oldRow = v.addRow(3);
    const newRow = v.addRow(8);
    v.found(3);
    frames();
    vi.advanceTimersByTime(100);
    v.found(8);
    frames();
    expect(oldRow.scrollIntoView).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(oldRow.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(newRow.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('un nuovo locate partito (la sua pagina non e\' ancora arrivata): il timer vecchio non scatta', () => {
    const v = mount(10);
    const oldRow = v.addRow(3);
    v.found(3);
    frames();
    vi.advanceTimersByTime(100);
    // Il server ha trovato il rigo 250: la sua pagina non e' ancora nella lista.
    v.found(250);
    frames();
    vi.advanceTimersByTime(1000);
    expect(oldRow.scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
