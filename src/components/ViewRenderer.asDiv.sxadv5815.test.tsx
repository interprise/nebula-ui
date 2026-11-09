import { describe, it, expect, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { UITree } from '../types/ui';
import { ELTYPE_CONTENT } from '../types/ui';

// SXADV-5815.9 — una riga resa come `asDiv` (barra delle azioni in testa) non passa
// da CellRenderer: una cella con visible=false non deve disegnare il suo controllo,
// quelle visibili e la barra si'. Niente DOM: motore di hook minimo, l'albero si
// legge come dato e RowRenderer si chiama come funzione.


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


const { default: ViewRenderer } = await import('./ViewRenderer');
const { default: ControlRenderer } = await import('../controls/ControlRenderer');

type El = ReactElement<Record<string, unknown>>;

/** Le righe asDiv dell'albero, aprendo i componenti funzione intermedi di ViewRenderer. */
function righeAsDiv(node: unknown, out: El[] = [], depth = 0): El[] {
  if (!node || typeof node !== 'object' || depth > 200) return out;
  if (Array.isArray(node)) {
    for (const n of node) righeAsDiv(n, out, depth + 1);
    return out;
  }
  const el = node as El;
  if (!el.props) return out;
  if (el.props.asDiv === true) { out.push(el); return out; }
  righeAsDiv(el.props.children, out, depth + 1);
  return out;
}

function cercaForm(node: unknown): El | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) { for (const n of node) { const f = cercaForm(n); if (f) return f; } return undefined; }
  const el = node as El;
  if (!el.props) return undefined;
  if ((el.type as { name?: string }).name === 'DetailFormView') return el;
  return cercaForm(el.props.children);
}

function controlli(node: unknown, out: El[] = []): El[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const n of node) controlli(n, out); return out; }
  const el = node as El;
  if (!el.props) return out;
  if (el.type === ControlRenderer) out.push(el);
  controlli(el.props.children, out);
  return out;
}

const cell = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
  elementType: ELTYPE_CONTENT,
  colspan: 1,
  control: { name, id: name, type, editable: true, value: '' },
  ...extra,
});

function pagina(cells: unknown[]): UITree {
  return {
    pageType: 2,
    viewName: 'cdmsRisorseDetail',
    path: 'S1-0',
    rows: [
      { id: 'barra', cells },
      { id: 'sotto', cells: [{ elementType: ELTYPE_CONTENT, colspan: 1, control: { name: 'tabs', id: 'tabs', type: 'tab', tabs: [] } }] },
    ],
  } as unknown as UITree;
}

/** Disegna la pagina e restituisce i nomi dei controlli delle righe asDiv. */
function disegnati(ui: UITree): string[] {
  const g = globalThis as Record<string, unknown>;
  g.window ??= { innerHeight: 800, innerWidth: 1280, addEventListener() {}, removeEventListener() {} };
  g.document ??= { body: { style: {} }, activeElement: null, addEventListener() {}, removeEventListener() {} };
  rt.slots = [];
  rt.i = 0;
  rt.active = true;
  try {
    const props = { ui, pageType: 2, onAction: vi.fn(), onChange: vi.fn() };
    const outer = (ViewRenderer as unknown as (p: unknown) => ReactNode)(props);
    const form = cercaForm(outer);
    expect(form, 'DetailFormView').toBeDefined();
    rt.i = 0;
    const tree = (form!.type as (p: unknown) => ReactNode)(form!.props);
    const righe = righeAsDiv(tree);
    expect(righe.length, 'la riga della barra arriva a RowRenderer con asDiv').toBeGreaterThan(0);
    return righe.flatMap((r) => {
      rt.i = 0;
      const out = (r.type as (p: unknown) => ReactNode)(r.props);
      return controlli(out).map((c) => (c.props.control as { name: string }).name);
    });
  } finally {
    rt.active = false;
  }
}

describe('SXADV-5815.9: riga asDiv', () => {
  it('la cella nascosta non si disegna; la barra e il campo visibile si', () => {
    expect(disegnati(pagina([
      cell('nascosto', 'text', { visible: false }),
      cell('visibile', 'text', { visible: true }),
      cell('azioni', 'actionBar'),
    ]))).toEqual(['visibile', 'azioni']);
  });

  it('visible assente vale visibile', () => {
    expect(disegnati(pagina([cell('senza', 'text'), cell('azioni', 'actionBar')]))).toEqual(['senza', 'azioni']);
  });

  it('una cella senza controllo non rompe la riga', () => {
    expect(disegnati(pagina([
      { elementType: ELTYPE_CONTENT, colspan: 1 },
      cell('azioni', 'actionBar'),
    ]))).toEqual(['azioni']);
  });
});
