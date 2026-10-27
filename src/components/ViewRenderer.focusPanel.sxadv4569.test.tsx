import { describe, it, expect, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { UITree } from '../types/ui';
import { ELTYPE_CONTENT } from '../types/ui';

// SXADV-4569 — il rigo trovato dal «Cerca» su una lista col pannello di riga:
// ListRenderer chiama onSelectRecord(path, { focusPanel: true }) e il pannello
// deve ricevere la richiesta di fuoco (focusRequest > 0) come dopo un Nuovo
// (fromAdd), ma senza la semantica dell'Add. Un clic normale su un rigo
// (nessuna opzione) non chiede il fuoco.
//
// Niente DOM: un motore di hook minimo al posto di React; ViewRenderer e la sua
// ListView si chiamano come funzioni, l'albero restituito si legge come dato
// (ListRenderer ed EditPanel NON si espandono: se ne leggono le props).

type AnyFn = (...a: never[]) => unknown;

const rt = vi.hoisted(() => ({
  active: false,
  i: 0,
  slots: [] as { v: unknown; deps?: unknown[]; set?: unknown }[],
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
    useEffect: on(actual.useEffect as AnyFn, (() => { rt.i++; }) as AnyFn),
    useLayoutEffect: on(actual.useLayoutEffect as AnyFn, (() => { rt.i++; }) as AnyFn),
    useContext: on(actual.useContext as AnyFn, ((ctx: { _currentValue: unknown }) => ctx._currentValue) as AnyFn),
    useId: on(actual.useId as AnyFn, (() => 'id') as AnyFn),
  };
  return { ...actual, ...over, default: { ...actual, ...over } };
});

const { default: ViewRenderer, AddWaitContext, FlushEditsContext } = await import('./ViewRenderer');

/** Il valore di un contesto senza Provider: il motore legge _currentValue. */
function withContext<T>(ctx: unknown, value: T, fn: () => void) {
  const c = ctx as { _currentValue: unknown };
  const saved = c._currentValue;
  c._currentValue = value;
  try { fn(); } finally { c._currentValue = saved; }
}

type El = ReactElement<Record<string, unknown>>;

function typeName(t: unknown): string {
  if (typeof t === 'function') return (t as { displayName?: string; name?: string }).displayName || (t as { name: string }).name;
  if (t && typeof t === 'object') {
    const o = t as { displayName?: string; type?: unknown; render?: { name?: string } };
    if (o.displayName) return o.displayName;
    if (o.type) return typeName(o.type);
    if (o.render?.name) return o.render.name;
  }
  return String(t);
}

function find(node: ReactNode, name: string): El | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const n of node) { const f = find(n, name); if (f) return f; }
    return undefined;
  }
  const el = node as El;
  if (typeName(el.type) === name) return el;
  return find(el.props?.children as ReactNode, name);
}

const ROW_A = 'S1-3.0';
const ROW_B = 'S1-3.57';

const ui = {
  pageType: 1,
  viewName: 'eventiList',
  path: 'S1-3',
  listEdit: true,
  rows: [],
  panelTemplate: {
    rows: [{
      id: 'p0',
      cells: [{
        elementType: ELTYPE_CONTENT,
        colspan: 1,
        control: { name: 'esito', id: 'esito', type: 'text', editable: true, value: '' },
      }],
    }],
  },
} as unknown as UITree;

/** ViewRenderer -> ListView, con lo stato di ListView che resta fra i giri. */
function mount(onAction: (a: string, p?: Record<string, string>) => unknown = vi.fn()) {
  rt.slots = [];
  let listView: El | undefined;
  const render = () => {
    rt.active = true;
    try {
      const outer = (ViewRenderer as unknown as (p: unknown) => ReactNode)({ ui, onAction, onChange: vi.fn() });
      listView = find(outer, 'ListView');
      if (!listView) throw new Error('ListView non trovata nell\'albero di ViewRenderer');
      // ViewRenderer stesso usa hook (useContext) prima di ListView: ListView ha
      // i suoi slot, contati da zero.
      rt.i = 0;
      return (listView.type as (p: unknown) => ReactNode)(listView.props);
    } finally {
      rt.active = false;
    }
  };
  let tree = render();
  const listRenderer = () => {
    const lr = find(tree, 'ListRenderer');
    if (!lr) throw new Error('ListRenderer non trovato');
    return lr;
  };
  // La lista dice quali record ci sono, con i dati per il pannello.
  (listRenderer().props.onRecordPaths as (r: unknown[]) => void)([
    { path: ROW_A, editData: { values: { esito: 'a' } } },
    { path: ROW_B, editData: { values: { esito: 'b' } } },
  ]);
  tree = render();
  return {
    select(path: string, opts?: Record<string, boolean>) {
      (listRenderer().props.onSelectRecord as (p: string, o?: unknown) => void)(path, opts);
      tree = render();
    },
    panel: () => find(tree, 'EditPanel'),
    listRenderer,
  };
}

describe('ListView onSelectRecord focusPanel (SXADV-4569)', () => {
  it('impianto: il pannello si apre sul rigo selezionato', () => {
    const v = mount();
    expect(typeof v.listRenderer().props.onSelectRecord).toBe('function');
    v.select(ROW_A);
    const p = v.panel();
    expect(p).toBeDefined();
    expect(p!.props.rowPath).toBe(ROW_A);
  });

  it('clic normale: nessuna richiesta di fuoco', () => {
    const v = mount();
    v.select(ROW_A);
    expect(v.panel()!.props.focusRequest).toBe(0);
  });

  it('fromAdd: richiesta di fuoco (riferimento)', () => {
    const v = mount();
    v.select(ROW_A, { fromAdd: true });
    expect(Number(v.panel()!.props.focusRequest)).toBeGreaterThan(0);
  });

  it('focusPanel (rigo trovato dal Cerca): richiesta di fuoco come fromAdd', () => {
    const v = mount();
    v.select(ROW_B, { focusPanel: true });
    const p = v.panel()!;
    expect(p.props.rowPath).toBe(ROW_B);
    expect(Number(p.props.focusRequest)).toBeGreaterThan(0);
  });

  it('due ricerche di fila: la seconda chiede di nuovo il fuoco (il valore cresce)', () => {
    const v = mount();
    v.select(ROW_A, { focusPanel: true });
    const first = Number(v.panel()!.props.focusRequest);
    v.select(ROW_B, { focusPanel: true });
    const second = Number(v.panel()!.props.focusRequest);
    expect(second).toBeGreaterThan(first);
  });

  it('dopo una ricerca, un clic normale toglie la richiesta di fuoco', () => {
    const v = mount();
    v.select(ROW_A, { focusPanel: true });
    v.select(ROW_B);
    expect(v.panel()!.props.focusRequest).toBe(0);
  });

  it('un\'opzione qualunque non chiede il fuoco (il motore distingue)', () => {
    const v = mount();
    v.select(ROW_A, { altro: true });
    expect(v.panel()!.props.focusRequest).toBe(0);
  });

  it('focusPanel non ha la semantica dell\'Add: niente settle, niente discard; il rigo lasciato si spedisce', () => {
    const settle = vi.fn();
    const discard = vi.fn();
    const flush = vi.fn();
    withContext(AddWaitContext, { waiting: true, settle, discard }, () => {
      withContext(FlushEditsContext, flush, () => {
        const v = mount();
        v.select(ROW_A);
        flush.mockClear();
        v.select(ROW_B, { focusPanel: true });
        expect(settle).not.toHaveBeenCalled();
        expect(discard).not.toHaveBeenCalled();
        expect(flush).toHaveBeenCalledWith(ROW_A);
      });
    });
  });

  it('riferimento: fromAdd con un Nuovo in attesa chiude l\'attesa (settle)', () => {
    const settle = vi.fn();
    withContext(AddWaitContext, { waiting: true, settle, discard: vi.fn() }, () => {
      const v = mount();
      v.select(ROW_B, { fromAdd: true });
      expect(settle).toHaveBeenCalled();
    });
  });
});

// Revisione SXADV-4569: la risposta di LocateRow deve arrivare alla lista anche
// attraverso i wrapper di onAction. Il pannello di riga riceve onPanelAction.
describe('ListView onPanelAction restituisce la risposta (SXADV-4569)', () => {
  it('il valore di onAction torna a chi chiama (anche una Promise)', async () => {
    const resp = { located: { found: true, more: false, position: 3, scanned: 4 } };
    const onAction = vi.fn(async () => resp);
    const v = mount(onAction);
    v.select(ROW_A);
    const panelAction = v.panel()!.props.onAction as (a: string, p?: Record<string, string>) => unknown;
    const params = { navpath: 'S1-3', option1: 'rossi', from: '-1' };
    const r = panelAction('LocateRow', params);
    expect(onAction).toHaveBeenCalledWith('LocateRow', params);
    await expect(r).resolves.toBe(resp);
  });

  it('valore sincrono: torna uguale', () => {
    const resp = { located: { found: false, more: false, position: -1, scanned: 2 } };
    const v = mount(() => resp);
    v.select(ROW_A);
    const panelAction = v.panel()!.props.onAction as (a: string, p?: Record<string, string>) => unknown;
    expect(panelAction('LocateRow', { navpath: 'S1-3', option1: 'x' })).toBe(resp);
  });

  it('la lista principale riceve onAction senza wrapper che perdano la risposta', () => {
    const resp = { located: { found: true, more: false, position: 1, scanned: 2 } };
    const v = mount(() => resp);
    const listAction = v.listRenderer().props.onAction as (a: string, p?: Record<string, string>) => unknown;
    expect(listAction('LocateRow', { navpath: 'S1-3', option1: 'x' })).toBe(resp);
  });
});
