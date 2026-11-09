import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { UITree } from '../types/ui';
import { ELTYPE_CONTENT } from '../types/ui';

// SXADV-5815.8 — clic su un <a href> in una cella di lista: il link fa il suo mestiere
// e la riga non si attiva. Un <a> senza href o il testo della cella la attivano.
// Motore di ListRenderer.reveal.sxadv4569: si chiamano i veri onRowClicked della griglia
// e onClick del contenitore. I bersagli sono elementi finti con un `closest` che valuta
// davvero il selettore; un selettore che non sa leggere fa esplodere la prova.

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
const saved = { window: g.window, document: g.document, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
beforeEach(() => {
  g.requestAnimationFrame = () => 0;
  g.cancelAnimationFrame = () => {};
  g.window = {
    innerHeight: 800, innerWidth: 1280,
    setTimeout: () => 0, clearTimeout: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    getComputedStyle: () => ({}),
  };
  g.document = {
    createElement: () => ({ getContext: () => null, style: {} }),
    body: { style: {} }, activeElement: null,
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener: () => {}, removeEventListener: () => {},
  };
});
afterEach(() => {
  g.window = saved.window;
  g.document = saved.document;
  g.requestAnimationFrame = saved.raf;
  g.cancelAnimationFrame = saved.caf;
});

// ── elementi finti ──────────────────────────────────────────────────────────
interface Nodo {
  tag: string;
  cls: string[];
  attrs: Record<string, string>;
  parent: Nodo | null;
  closest: (sel: string) => Nodo | null;
  getAttribute: (a: string) => string | null;
}
const SEMPLICE = /^([a-z]*)((?:\.[\w-]+)*)(?:\[([\w-]+)(?:="([^"]*)")?\])?$/;
function combacia(n: Nodo, sel: string): boolean {
  const m = SEMPLICE.exec(sel.trim());
  if (!m) throw new Error(`selettore non capito dalla prova: ${sel}`);
  if (m[1] && m[1] !== n.tag) return false;
  for (const c of m[2].split('.').filter(Boolean)) if (!n.cls.includes(c)) return false;
  if (m[3]) {
    if (!(m[3] in n.attrs)) return false;
    if (m[4] !== undefined && n.attrs[m[3]] !== m[4]) return false;
  }
  return true;
}
function nodo(tag: string, parent: Nodo | null, cls: string[] = [], attrs: Record<string, string> = {}): Nodo {
  const n: Nodo = {
    tag, cls, attrs, parent,
    closest(sel) {
      const alts = sel.split(',');
      for (let x: Nodo | null = n; x; x = x.parent) if (alts.some((a) => combacia(x!, a))) return x;
      return null;
    },
    getAttribute: (a) => (a in attrs ? attrs[a] : null),
  };
  return n;
}
const rigaEl = () => nodo('div', null, ['ag-row'], { 'row-id': 'R0' });
const cella = () => nodo('div', rigaEl(), ['ag-cell']);

// ── la lista ────────────────────────────────────────────────────────────────
const PATH = 'S1-3.0';
const DATI = { _selectorPath: PATH, _selectorCommand: 'NavigateDetail' };
const ui = {
  pageType: 1,
  viewName: 'cdmsRisorseList',
  path: 'S1-3',
  headers: [{ text: 'Nome', colspan: 1 }],
  rows: [{
    id: 'r0',
    props: { path: PATH },
    cells: [{ elementType: ELTYPE_CONTENT, colspan: 1, text: 'Nome', control: { name: 'nome.S1-3.0', id: 'nome', type: 'text', editable: false, value: 'Nome' } }],
  }],
} as unknown as UITree;

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

function mount(dati: Record<string, unknown> = DATI) {
  rt.slots = [];
  const onAction = vi.fn(() => undefined);
  const props = { ui, onAction, embedded: true };
  const render = (): ReactNode => {
    rt.i = 0;
    rt.effects = [];
    rt.active = true;
    try {
      return (ListRenderer as unknown as (p: unknown) => ReactNode)(props);
    } finally {
      rt.active = false;
    }
  };
  let tree = render();
  const griglia = () => findEl(tree, (e) => typeof e.props.onRowClicked === 'function')!;
  const api = {
    isDestroyed: () => false,
    getRowNode: () => ({ data: dati, rowIndex: 0 }),
    deselectAll: () => {}, refreshCells: () => {}, redrawRows: () => {}, forEachNode: () => {},
    getDisplayedRowCount: () => 1, getDisplayedRowAtIndex: () => null, setFocusedCell: () => {},
    getAllDisplayedColumns: () => [], getColumns: () => [], getColumnDefs: () => [],
    ensureIndexVisible: () => {}, sizeColumnsToFit: () => {}, resetRowHeights: () => {},
    onRowHeightChanged: () => {}, setGridOption: () => {}, getGridOption: () => undefined,
    addEventListener: () => {}, removeEventListener: () => {},
  };
  (griglia().props.onGridReady as (p: unknown) => void)({ api });
  tree = render();
  return {
    onAction,
    /** Il clic come lo passa AG Grid a onRowClicked. */
    rowClick(target: Nodo) {
      (griglia().props.onRowClicked as (e: unknown) => void)({ event: { target }, data: dati });
    },
    /** Il clic sul contenitore: handleGridClick, l'unica via delle bande di continuazione. */
    gridClick(target: Nodo) {
      const c = findEl(tree, (e) => typeof e.props.onClick === 'function' && !!findEl(e.props.children, (x) => x === griglia()));
      (c!.props.onClick as (e: unknown) => void)({ target });
    },
  };
}

const LINK = { href: 'http://h/entrasp/controller?action=DownloadAllegato&sid=S1&navpath=k&option1=inline', target: '_blank' };

describe('SXADV-5815.8: onRowClicked', () => {
  it('impianto: il testo della cella attiva la riga', () => {
    const m = mount();
    m.rowClick(nodo('span', cella()));
    expect(m.onAction).toHaveBeenCalledTimes(1);
    expect(m.onAction).toHaveBeenCalledWith('NavigateDetail', { navpath: PATH });
  });

  it('un <a href> non la attiva', () => {
    const m = mount();
    m.rowClick(nodo('a', cella(), [], LINK));
    expect(m.onAction).not.toHaveBeenCalled();
  });

  it('nemmeno l\'icona o il testo dentro un <a href>', () => {
    const m = mount();
    m.rowClick(nodo('img', nodo('a', nodo('div', cella()), [], LINK)));
    expect(m.onAction).not.toHaveBeenCalled();
  });

  it('un <a> senza href la attiva', () => {
    const m = mount();
    m.rowClick(nodo('a', cella()));
    expect(m.onAction).toHaveBeenCalledTimes(1);
  });

  it('la cella stessa la attiva', () => {
    const m = mount();
    m.rowClick(cella());
    expect(m.onAction).toHaveBeenCalledTimes(1);
  });
});

describe('SXADV-5815.8: banda di continuazione (handleGridClick)', () => {
  const BANDA = { ...DATI, _isContinuationRow: true };

  it('un <a href> non la attiva', () => {
    const m = mount(BANDA);
    m.gridClick(nodo('a', cella(), [], LINK));
    expect(m.onAction).not.toHaveBeenCalled();
  });

  it('un <a> senza href la attiva', () => {
    const m = mount(BANDA);
    m.gridClick(nodo('a', cella()));
    expect(m.onAction).toHaveBeenCalledTimes(1);
  });

  it('il testo la attiva', () => {
    const m = mount(BANDA);
    m.gridClick(nodo('span', cella()));
    expect(m.onAction).toHaveBeenCalledTimes(1);
  });
});
