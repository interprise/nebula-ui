import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import type { ReactElement, ReactNode, ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UITree } from '../types/ui';
import { ELTYPE_CONTENT, ELTYPE_SELECTOR } from '../types/ui';

// SXADV-5490 — Somma e Media sulle colonne delle liste, la resa in ListRenderer
// (contratto CORE/docs/20261027_SXADV-5490_totali_di_colonna.md §6):
//   - le colonne con una voce in ui.totals.columns hanno nell'intestazione un
//     pulsante «Σ» con un menu «Somma» / «Media»; le altre no;
//   - la scelta chiama onAction(totals.command, { option1: <controlName>,
//     option2: 'sum'|'avg', navpath: totals.path });
//   - available=false: le due voci disabilitate, con reason visibile;
//   - almeno una colonna attiva: pinnedBottomRowData con il testo nella colonna;
//     nessuna colonna attiva: nessuna riga fissata;
//   - il clic sulla riga totali non naviga e non chiama onAction.
//
// Niente DOM (ne' jsdom ne' happy-dom): come in ListRenderer.reveal.sxadv4569,
// un motore di hook minimo esegue ListRenderer come funzione e si leggono le
// props dell'elemento AgGridReact (columnDefs, pinnedBottomRowData,
// onRowClicked). L'intestazione di una colonna e' il suo headerComponent (o
// l'innerHeaderComponent di serie) con i suoi headerComponentParams: la si
// disegna con renderToStaticMarkup (hook veri) per cercare «Σ», e la si
// "espande" chiamando i componenti funzione (hook finti) per trovare le voci del
// menu, che antd non disegna finche' il menu e' chiuso. In entrambi i casi
// l'intestazione riceve i contesti dei provider che racchiudono AgGridReact
// nell'albero di ListRenderer: nel browser AG Grid la disegna in un portale li'
// dentro, quindi li vede.
//
// Assunzioni di forma (non scritte nel contratto, dichiarate qui):
//   - il pulsante Σ sta nel componente d'intestazione della colonna, non
//     iniettato nel DOM da un effetto (allora qui non si vede);
//   - il menu e' un menu antd (`menu.items` di Dropdown, o `items` di Menu) o,
//     in mancanza, elementi con testo «Somma»/«Media» e un onClick/onChange.

type AnyFn = (...a: never[]) => unknown;

const rt = vi.hoisted(() => ({
  active: false,
  i: 0,
  slots: [] as { v: unknown; deps?: unknown[]; set?: unknown }[],
  effects: [] as { fn: () => unknown; deps?: unknown[] }[],
  // Valori di contesto imposti a mano (i provider che racchiudono la griglia).
  ctx: new Map<unknown, unknown>(),
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
    useContext: on(actual.useContext as AnyFn, ((c: { _currentValue: unknown }) =>
      (rt.ctx.has(c) ? rt.ctx.get(c) : c._currentValue)) as AnyFn),
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

// Browser finto, messo DOPO gli import (come nel test del Cerca).
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

// ── la lista ────────────────────────────────────────────────────────────────
const LIST = 'S1-0';
const rowPath = (pos: number) => `${LIST}.${pos}`;
const MSG_SOLO_PAGINA = 'Il totale di questa colonna si calcola solo quando la ricerca sta in una pagina: '
  + 'restringi i filtri, oppure esporta in Excel, dove il totale c\'è.';

interface ColTotals {
  available: boolean;
  active: string[];
  sum?: string;
  avg?: string;
  mixedCurrencies?: boolean;
  reason?: string;
  error?: string;
}
interface Totals { command: string; path: string; scope?: string; rows?: number; columns: Record<string, ColTotals> }

/**
 * Tre colonne: descrizione (testo, niente totali), quantita (Number),
 * importo (Money). Con `selector` una colonna selettore in testa (indice 0) e
 * le altre slittano di uno.
 */
function listUi(n: number, totals?: Totals, opts: { selector?: boolean } = {}): UITree {
  const ctl = (name: string, type: string, i: number, value: string) =>
    ({ name: `${name}.${LIST}.${i}`, id: name, type, editable: false, value });
  const sel = opts.selector;
  const headers = [
    ...(sel ? [{ text: '', colspan: 1 }] : []),
    { text: 'Descrizione', colspan: 1 },
    { text: 'Quantità', colspan: 1 },
    { text: 'Importo', colspan: 1 },
  ];
  const columns = [
    ...(sel ? [{ elementType: ELTYPE_SELECTOR, selector: { command: 'NavigateDetail', basePath: LIST } }] : []),
    { elementType: ELTYPE_CONTENT, control: { name: 'descrizione', id: 'descrizione', type: 'text' } },
    { elementType: ELTYPE_CONTENT, control: { name: 'quantita', id: 'quantita', type: 'number' } },
    { elementType: ELTYPE_CONTENT, control: { name: 'importo', id: 'importo', type: 'money' } },
  ];
  return {
    pageType: 1,
    viewName: 'documentiList',
    path: LIST,
    headers,
    columns,
    ...(totals ? { totals } : {}),
    rows: Array.from({ length: n }, (_, i) => ({
      id: `r${i}`,
      props: { path: rowPath(i) },
      cells: [
        ...(sel ? [{ elementType: ELTYPE_SELECTOR, colspan: 1, pos: i }] : []),
        { elementType: ELTYPE_CONTENT, colspan: 1, text: `Riga ${i}`, control: ctl('descrizione', 'text', i, `Riga ${i}`) },
        { elementType: ELTYPE_CONTENT, colspan: 1, text: String(i), control: ctl('quantita', 'number', i, String(i)) },
        { elementType: ELTYPE_CONTENT, colspan: 1, text: `${i},00 €`, control: ctl('importo', 'money', i, `${i},00 €`) },
      ],
    })),
  } as unknown as UITree;
}

function totalsOf(columns: Record<string, ColTotals>, command = 'ListTotals'): Totals {
  return { command, path: LIST, scope: 'page', rows: 3, columns };
}

// ── visita degli elementi ───────────────────────────────────────────────────
type El = ReactElement<Record<string, unknown>> & { type: unknown };
const isEl = (n: unknown): n is El =>
  !!n && typeof n === 'object' && '$$typeof' in (n as object) && 'props' in (n as object);

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

/**
 * I provider di contesto che racchiudono l'elemento cercato, dall'esterno
 * all'interno. AG Grid disegna le intestazioni in portali dentro AgGridReact:
 * vedono gli stessi contesti della griglia, e cosi' devono vederli qui.
 */
function providersAround(root: unknown, target: El): { type: unknown; ctx: unknown; value: unknown }[] {
  const REACT_CONTEXT = Symbol.for('react.context');
  const REACT_PROVIDER = Symbol.for('react.provider');
  const path: El[] = [];
  const dfs = (n: unknown, depth: number): boolean => {
    if (!n || typeof n !== 'object' || depth > 400) return false;
    if (Array.isArray(n)) return n.some((x) => dfs(x, depth + 1));
    const e = n as El;
    if (!e.props) return false;
    if (e === target) return true;
    path.push(e);
    for (const v of Object.values(e.props)) {
      if (v && typeof v === 'object' && dfs(v, depth + 1)) return true;
    }
    path.pop();
    return false;
  };
  dfs(root, 0);
  const out: { type: unknown; ctx: unknown; value: unknown }[] = [];
  for (const e of path) {
    const t = e.type as { $$typeof?: symbol; _context?: unknown } | null;
    if (!t || typeof t !== 'object') continue;
    if (t.$$typeof === REACT_CONTEXT) out.push({ type: t, ctx: t, value: e.props.value });
    else if (t.$$typeof === REACT_PROVIDER) out.push({ type: t, ctx: t._context, value: e.props.value });
  }
  return out;
}

/** Chiama un componente funzione fuori da React, con hook finti e slot propri. */
function callComponent(type: (p: unknown) => unknown, props: unknown): unknown {
  const saved = { active: rt.active, i: rt.i, slots: rt.slots, effects: rt.effects };
  rt.active = true;
  rt.i = 0;
  rt.slots = [];
  rt.effects = [];
  try {
    return type(props);
  } finally {
    rt.active = saved.active;
    rt.i = saved.i;
    rt.slots = saved.slots;
    rt.effects = saved.effects;
  }
}

/**
 * Visita profonda: elementi, oggetti e array nelle props (menu.items, label),
 * e il risultato dei componenti funzione (espansi a mano). Un componente che
 * fuori da React lancia si ferma li' (le sue props sono gia' state visitate).
 */
function visitAll(root: unknown, visit: (e: El) => void, onString?: (s: string) => void) {
  const seen = new WeakSet<object>();
  const walk = (n: unknown, depth: number, expandDepth: number) => {
    if (n == null || depth > 80) return;
    if (typeof n === 'string') { onString?.(n); return; }
    if (typeof n === 'number') { onString?.(String(n)); return; }
    if (typeof n !== 'object') return;
    if (seen.has(n as object)) return;
    seen.add(n as object);
    if (Array.isArray(n)) { for (const x of n) walk(x, depth + 1, expandDepth); return; }
    if (isEl(n)) {
      visit(n);
      for (const [k, v] of Object.entries(n.props ?? {})) {
        if (k === 'context' || k === 'api' || k === 'column') continue;
        walk(v, depth + 1, expandDepth);
      }
      const t = n.type as unknown;
      const isClass = typeof t === 'function'
        && !!(t as { prototype?: { isReactComponent?: unknown } }).prototype?.isReactComponent;
      if (typeof t === 'function' && !isClass && expandDepth < 25) {
        let out: unknown;
        try { out = callComponent(t as unknown as (p: unknown) => unknown, n.props); } catch { return; }
        walk(out, depth + 1, expandDepth + 1);
      }
      return;
    }
    // Oggetto semplice (es. { items: [...] } di un menu).
    const proto = Object.getPrototypeOf(n);
    if (proto !== Object.prototype && proto !== null) return;
    for (const v of Object.values(n as Record<string, unknown>)) walk(v, depth + 1, expandDepth);
  };
  walk(root, 0, 0);
}

/** Il testo di un nodo: stringhe dei children, senza espandere componenti. */
function textOf(n: unknown, depth = 0): string {
  if (n == null || depth > 50) return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map((x) => textOf(x, depth + 1)).join('');
  if (isEl(n)) return textOf(n.props.children, depth + 1);
  return '';
}

// ── montaggio ───────────────────────────────────────────────────────────────
interface ColDefLike {
  field?: string;
  headerName?: string;
  headerComponent?: unknown;
  headerComponentParams?: Record<string, unknown>;
}

function mount(ui: UITree, extra: Record<string, unknown> = {}) {
  rt.slots = [];
  const props: Record<string, unknown> & { onAction: ReturnType<typeof vi.fn>; onSelectRecord: ReturnType<typeof vi.fn> } = {
    ui,
    onAction: vi.fn(() => undefined),
    onSelectRecord: vi.fn(),
    embedded: true,
    ...extra,
  } as never;
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
  const colDefs = (): ColDefLike[] => {
    const flat: ColDefLike[] = [];
    const add = (defs: unknown) => {
      for (const d of (defs as Record<string, unknown>[] | undefined) ?? []) {
        if (Array.isArray(d.children)) add(d.children);
        else flat.push(d as ColDefLike);
      }
    };
    add(grid().props.columnDefs);
    return flat;
  };
  const colDef = (field: string) => {
    const d = colDefs().find((c) => c.field === field);
    if (!d) throw new Error(`colonna ${field} non trovata fra ${colDefs().map((c) => c.field).join(',')}`);
    return d;
  };
  /** Il componente d'intestazione della colonna e le sue props come le darebbe AG Grid. */
  const header = (field: string): { comp?: ComponentType<Record<string, unknown>>; params: Record<string, unknown> } => {
    const d = colDef(field);
    const components = (grid().props.components ?? {}) as Record<string, unknown>;
    const resolve = (c: unknown) => (typeof c === 'string' ? components[c] : c) as ComponentType<Record<string, unknown>> | undefined;
    const agParams = {
      displayName: d.headerName ?? '',
      column: {
        getColId: () => field, getId: () => field, getColDef: () => d, getSort: () => undefined,
        isSortAscending: () => false, isSortDescending: () => false, isFilterActive: () => false,
        addEventListener: () => {}, removeEventListener: () => {}, getActualWidth: () => 120,
      },
      api: { getGridOption: () => undefined, addEventListener: () => {}, removeEventListener: () => {} },
      context: grid().props.context,
      enableSorting: false,
      enableMenu: false,
      enableFilterButton: false,
      showColumnMenu: () => {},
      showColumnMenuAfterMouseClick: () => {},
      showFilter: () => {},
      progressSort: () => {},
      setSort: () => {},
      eGridHeader: { addEventListener: () => {}, removeEventListener: () => {} },
      setTooltip: () => {},
    };
    const hc = resolve(d.headerComponent);
    if (hc) return { comp: hc, params: { ...agParams, ...(d.headerComponentParams ?? {}) } };
    const inner = resolve(d.headerComponentParams?.innerHeaderComponent);
    return {
      comp: inner,
      params: { ...agParams, ...(d.headerComponentParams ?? {}), ...((d.headerComponentParams?.innerHeaderComponentParams as Record<string, unknown>) ?? {}) },
    };
  };
  const providers = () => providersAround(tree, grid());
  const headerMarkup = (field: string): string => {
    const { comp, params } = header(field);
    if (!comp) return '';
    let el: ReactNode = createElement(comp, params);
    for (const p of [...providers()].reverse()) el = createElement(p.type as never, { value: p.value }, el);
    return renderToStaticMarkup(el as ReactElement);
  };
  /** L'albero dell'intestazione espanso: elementi e stringhe. */
  const headerScan = (field: string) => {
    const { comp, params } = header(field);
    const els: El[] = [];
    const strings: string[] = [];
    if (comp) {
      rt.ctx = new Map(providers().map((p) => [p.ctx, p.value] as [unknown, unknown]));
      try {
        visitAll(createElement(comp, params), (e) => els.push(e), (s) => strings.push(s));
      } finally {
        rt.ctx = new Map();
      }
    }
    return { els, strings };
  };
  return { props, render, grid, colDefs, colDef, header, headerMarkup, headerScan, providers, tree: () => tree };
}

// ── il menu Somma / Media ───────────────────────────────────────────────────
interface Choice {
  disabled: boolean;
  click: () => void;
}
const fakeDomEvent = () => ({ stopPropagation: () => {}, preventDefault: () => {}, nativeEvent: {} });

/** Trova la voce «Somma» o «Media» nell'intestazione espansa, comunque sia fatto il menu. */
function findChoice(els: El[], label: RegExp): Choice | undefined {
  // 1. Menu antd: Dropdown menu={{ items, onClick }} o Menu items/onClick.
  for (const e of els) {
    const menu = (e.props.menu as { items?: unknown[]; onClick?: (i: unknown) => void } | undefined)
      ?? (Array.isArray(e.props.items) ? { items: e.props.items as unknown[], onClick: e.props.onClick as ((i: unknown) => void) | undefined } : undefined);
    if (!menu || !Array.isArray(menu.items)) continue;
    for (const raw of menu.items) {
      const it = raw as { key?: string; label?: unknown; title?: string; disabled?: boolean; onClick?: (i: unknown) => void } | null;
      if (!it) continue;
      const text = `${textOf(it.label)} ${typeof it.label === 'string' ? it.label : ''} ${it.title ?? ''}`;
      if (!label.test(text)) continue;
      return {
        disabled: !!it.disabled,
        click: () => {
          const info = { key: it.key, keyPath: [it.key], item: it, domEvent: fakeDomEvent() };
          if (it.onClick) it.onClick(info);
          else menu.onClick?.(info);
        },
      };
    }
  }
  // 2. Ripiego: un elemento col testo e un gestore (Checkbox, Button, voce a mano).
  for (const e of els) {
    if (!label.test(textOf(e.props.children))) continue;
    const h = (e.props.onClick ?? e.props.onChange) as ((ev: unknown) => void) | undefined;
    if (typeof h !== 'function' && !('disabled' in e.props)) continue;
    return {
      disabled: !!e.props.disabled,
      click: () => h?.({ ...fakeDomEvent(), target: { checked: true }, key: undefined }),
    };
  }
  return undefined;
}

// ── casi ────────────────────────────────────────────────────────────────────
beforeEach(() => { installBrowser(); });
afterEach(() => { restoreBrowser(); });

const inactive: Record<string, ColTotals> = {
  quantita: { available: true, active: [] },
  importo: { available: true, active: [] },
};

describe('ListRenderer: pulsante Σ nell\'intestazione (SXADV-5490)', () => {
  it('impianto: le tre colonne ci sono, col_0..col_2', () => {
    const v = mount(listUi(3, totalsOf(inactive)));
    expect(v.colDefs().map((c) => c.field)).toEqual(expect.arrayContaining(['col_0', 'col_1', 'col_2']));
  });

  it('Σ sulle colonne con una voce in totals.columns, non sulle altre', () => {
    const v = mount(listUi(3, totalsOf(inactive)));
    expect(v.headerMarkup('col_1')).toContain('Σ');
    expect(v.headerMarkup('col_2')).toContain('Σ');
    expect(v.headerMarkup('col_0')).not.toContain('Σ');
  });

  it('solo importo in totals.columns: Σ solo su importo', () => {
    const v = mount(listUi(3, totalsOf({ importo: { available: true, active: [] } })));
    expect(v.headerMarkup('col_2')).toContain('Σ');
    expect(v.headerMarkup('col_1')).not.toContain('Σ');
  });

  it('senza ui.totals: nessun Σ', () => {
    const v = mount(listUi(3));
    for (const f of ['col_0', 'col_1', 'col_2']) expect(v.headerMarkup(f)).not.toContain('Σ');
  });

  it('il menu ha «Somma» e «Media»', () => {
    const v = mount(listUi(3, totalsOf(inactive)));
    const { els } = v.headerScan('col_2');
    expect(findChoice(els, /Somma/)).toBeDefined();
    expect(findChoice(els, /Media/)).toBeDefined();
  });

  it('nessun menu Somma/Media sulla colonna senza totali', () => {
    const v = mount(listUi(3, totalsOf(inactive)));
    const { els } = v.headerScan('col_0');
    expect(findChoice(els, /Somma/)).toBeUndefined();
  });
});

describe('ListRenderer: la scelta chiama ListTotals (SXADV-5490)', () => {
  it('Somma su importo: onAction(\'ListTotals\', { option1: importo, option2: sum, navpath })', () => {
    const v = mount(listUi(3, totalsOf(inactive)));
    const c = findChoice(v.headerScan('col_2').els, /Somma/);
    expect(c).toBeDefined();
    expect(c!.disabled).toBe(false);
    c!.click();
    expect(v.props.onAction).toHaveBeenCalledWith('ListTotals', expect.objectContaining({ option1: 'importo', option2: 'sum', navpath: LIST }));
  });

  it('Media su quantita: option2 = avg, option1 = quantita', () => {
    const v = mount(listUi(3, totalsOf(inactive)));
    const c = findChoice(v.headerScan('col_1').els, /Media/);
    c!.click();
    expect(v.props.onAction).toHaveBeenCalledWith('ListTotals', expect.objectContaining({ option1: 'quantita', option2: 'avg', navpath: LIST }));
  });

  it('il comando e il path vengono da totals (command, path), non sono fissi', () => {
    const t = { ...totalsOf(inactive, 'AltroComando'), path: 'S1-0.2,S1-7' };
    const v = mount(listUi(3, t));
    findChoice(v.headerScan('col_2').els, /Somma/)!.click();
    expect(v.props.onAction).toHaveBeenCalledWith('AltroComando', expect.objectContaining({ option1: 'importo', option2: 'sum', navpath: 'S1-0.2,S1-7' }));
  });

  it('option1 e\' il controlName della colonna, non il name decorato delle celle (importo.S1-0.0)', () => {
    const v = mount(listUi(3, totalsOf(inactive)));
    findChoice(v.headerScan('col_2').els, /Somma/)!.click();
    const params = v.props.onAction.mock.calls.at(-1)?.[1] as Record<string, string>;
    expect(params.option1).toBe('importo');
  });

  it('una scelta = una chiamata', () => {
    const v = mount(listUi(3, totalsOf(inactive)));
    findChoice(v.headerScan('col_2').els, /Somma/)!.click();
    expect(v.props.onAction.mock.calls.filter((c) => c[0] === 'ListTotals')).toHaveLength(1);
  });
});

describe('ListRenderer: colonna non disponibile (SXADV-5490)', () => {
  const unavailable = totalsOf({
    quantita: { available: true, active: [] },
    importo: { available: false, reason: MSG_SOLO_PAGINA, active: [] },
  });

  it('Σ c\'e\' comunque, le voci sono disabilitate', () => {
    const v = mount(listUi(3, unavailable));
    expect(v.headerMarkup('col_2')).toContain('Σ');
    const { els } = v.headerScan('col_2');
    expect(findChoice(els, /Somma/)?.disabled).toBe(true);
    expect(findChoice(els, /Media/)?.disabled).toBe(true);
  });

  it('il motivo e\' esposto (testo o suggerimento nell\'intestazione)', () => {
    const v = mount(listUi(3, unavailable));
    const { strings } = v.headerScan('col_2');
    const markup = v.headerMarkup('col_2');
    expect(strings.some((s) => s.includes(MSG_SOLO_PAGINA)) || markup.includes('restringi i filtri')).toBe(true);
  });

  it('l\'altra colonna resta abilitata', () => {
    const v = mount(listUi(3, unavailable));
    expect(findChoice(v.headerScan('col_1').els, /Somma/)?.disabled).toBe(false);
  });
});

describe('ListRenderer: riga totali fissata in fondo (SXADV-5490)', () => {
  const pinned = (v: ReturnType<typeof mount>) => v.grid().props.pinnedBottomRowData as Record<string, unknown>[] | undefined;
  const text = (x: unknown) => (typeof x === 'string' ? x : (x as { text?: string } | undefined)?.text);

  it('nessuna colonna attiva: nessuna riga fissata', () => {
    const v = mount(listUi(3, totalsOf(inactive)));
    const p = pinned(v);
    expect(p == null || p.length === 0).toBe(true);
  });

  it('senza totals: nessuna riga fissata', () => {
    const v = mount(listUi(3));
    const p = pinned(v);
    expect(p == null || p.length === 0).toBe(true);
  });

  it('una colonna attiva: una riga, col testo nella sua colonna e «Totale» nella prima', () => {
    const v = mount(listUi(3, totalsOf({
      quantita: { available: true, active: [] },
      importo: { available: true, active: ['sum'], sum: '3,00 €' },
    })));
    const p = pinned(v);
    expect(p).toHaveLength(1);
    expect(text(p![0].col_2)).toBe('Σ 3,00 €');
    expect(text(p![0].col_0)).toBe('Totale');
  });

  it('somma e media: due righe di testo nella cella', () => {
    const v = mount(listUi(3, totalsOf({
      importo: { available: true, active: ['sum', 'avg'], sum: '3,00 €', avg: '1,00 €' },
    })));
    expect(text(pinned(v)![0].col_2)?.split(/\r?\n/)).toEqual(['Σ 3,00 €', '⌀ 1,00 €']);
  });

  it('attiva ma non disponibile: «—» e il motivo nella riga', () => {
    const v = mount(listUi(3, totalsOf({
      importo: { available: false, reason: MSG_SOLO_PAGINA, active: ['sum'] },
    })));
    const p = pinned(v);
    expect(p).toHaveLength(1);
    expect(text(p![0].col_2)).toBe('—');
    expect(JSON.stringify(p![0])).toContain('restringi i filtri');
  });

  it('valute diverse', () => {
    const v = mount(listUi(3, totalsOf({ importo: { available: true, active: ['sum'], mixedCurrencies: true } })));
    expect(text(pinned(v)![0].col_2)).toBe('valute diverse');
  });

  it('la riga fissata non e\' fra le righe dei dati', () => {
    const v = mount(listUi(3, totalsOf({ importo: { available: true, active: ['sum'], sum: '3,00 €' } })));
    const rows = v.grid().props.rowData as Record<string, unknown>[];
    expect(rows.some((r) => text(r.col_0) === 'Totale' || text(r.col_2) === 'Σ 3,00 €')).toBe(false);
  });

  it('con la colonna selettore: il testo segue la colonna dell\'item, non la posizione nella mappa', () => {
    const v = mount(listUi(3, totalsOf({ importo: { available: true, active: ['sum'], sum: '3,00 €' } }), { selector: true }));
    const p = pinned(v);
    expect(p).toHaveLength(1);
    // importo e' columns[3]: la chiave e' col_3.
    expect(text(p![0].col_3)).toBe('Σ 3,00 €');
  });
});

describe('ListRenderer: la riga totali non si attiva (SXADV-5490)', () => {
  const clickEvent = () => ({
    target: { closest: () => null },
    detail: 1,
    timeStamp: Math.random() * 1e6,
    stopPropagation: () => {},
    preventDefault: () => {},
  });

  it('impianto: il clic su una riga normale (con selettore) naviga', () => {
    const v = mount(listUi(3, totalsOf({ importo: { available: true, active: ['sum'], sum: '3,00 €' } }), { selector: true }));
    const data = (v.grid().props.rowData as Record<string, unknown>[])[1];
    (v.grid().props.onRowClicked as (e: unknown) => void)({ data, node: { data, rowPinned: undefined }, rowPinned: undefined, event: clickEvent() });
    expect(v.props.onAction).toHaveBeenCalledWith('NavigateDetail', expect.objectContaining({ navpath: rowPath(1) }));
  });

  it('clic sulla riga totali: niente onAction, niente onSelectRecord', () => {
    const v = mount(listUi(3, totalsOf({ importo: { available: true, active: ['sum'], sum: '3,00 €' } }), { selector: true }));
    const p = v.grid().props.pinnedBottomRowData as Record<string, unknown>[] | undefined;
    expect(p).toHaveLength(1);
    const data = p![0];
    (v.grid().props.onRowClicked as (e: unknown) => void)({ data, node: { data, rowPinned: 'bottom' }, rowPinned: 'bottom', event: clickEvent() });
    expect(v.props.onAction).not.toHaveBeenCalled();
    expect(v.props.onSelectRecord).not.toHaveBeenCalled();
  });

  it('clic sulla riga totali di una listEdit col pannello: il pannello non si apre', () => {
    const ui = { ...listUi(3, totalsOf({ importo: { available: true, active: ['sum'], sum: '3,00 €' } }), { selector: true }), listEdit: true, panelTemplateKey: 'documentiList:panel' } as UITree;
    const v = mount(ui);
    const p = v.grid().props.pinnedBottomRowData as Record<string, unknown>[] | undefined;
    expect(p).toHaveLength(1);
    const data = p![0];
    (v.grid().props.onRowClicked as (e: unknown) => void)({ data, node: { data, rowPinned: 'bottom' }, rowPinned: 'bottom', event: clickEvent() });
    expect(v.props.onSelectRecord).not.toHaveBeenCalled();
    expect(v.props.onAction).not.toHaveBeenCalled();
  });
});

// ── difetti trovati a schermo (SXADV-5490) ──────────────────────────────────
//
// 1. Scegliere Somma/Media dal menu Σ di un'intestazione ordinata dal server
//    (ServerSortHeader) non deve mai mandare anche SortColumn. Il menu antd sta
//    in un portale, ma gli eventi SINTETICI di React risalgono gli antenati
//    React del portale: il Dropdown, poi il div dell'intestazione che ordina al
//    clic. Lo stesso per il clic sul Σ che apre il menu.
//
//    Niente DOM nel progetto (ne' jsdom ne' happy-dom ne' testing-library in
//    node_modules; aggiungerli e' una dipendenza nuova, fuori dal mandato): non
//    si puo' montare un Dropdown antd vero ne' cliccarlo. Si modella quindi la
//    propagazione di React sull'albero degli elementi, che e' l'albero su cui
//    React la fa davvero:
//      - clic su una voce: si chiama menu.onClick (cio' che fa la voce antd) con
//        un evento sintetico, poi lo si fa risalire per gli onClick/onMouseDown
//        degli elementi host fra il menu e la radice di popupRender, poi per gli
//        antenati host del Dropdown nell'intestazione, finche' qualcuno non
//        chiama stopPropagation;
//      - clic sul Σ: prima i listener NATIVI registrati dagli effetti sul nodo
//        del Σ (un nodo finto); se fermano l'evento nativo, React (che ascolta
//        alla radice) non lo vede; altrimenti risale come sopra dal Σ.
//    Assunzione: gli elementi interni di antd fra la voce e popupRender non
//    fermano la propagazione (non lo fanno), quindi non ci si conta.
//
// 2. La cella della riga totali non deve andare a capo fra «Σ » e il numero:
//    con white-space: pre-line un totale lungo in una colonna stretta mostrava
//    solo «Σ» (la seconda riga era nascosta dall'altezza della riga). Due righe
//    sono ammesse solo per somma + media, unite da "\n". Senza DOM non c'e'
//    stile calcolato: si legge lo white-space in linea della cella disegnata.

interface SynthEvent {
  type: string;
  stopped: boolean;
  stopPropagation: () => void;
  preventDefault: () => void;
  isPropagationStopped: () => boolean;
  nativeEvent: Record<string, unknown>;
  target: unknown;
  currentTarget: unknown;
}
const synth = (type: string): SynthEvent => {
  const ev: SynthEvent = {
    type,
    stopped: false,
    stopPropagation: () => { ev.stopped = true; },
    preventDefault: () => {},
    isPropagationStopped: () => ev.stopped,
    nativeEvent: {},
    target: null,
    currentTarget: null,
  };
  return ev;
};
const HANDLER: Record<string, string> = { click: 'onClick', mousedown: 'onMouseDown' };

/** Risale gli elementi host di `chain` (dal piu' interno) chiamando il gestore dell'evento. */
function bubble(chainOuterToInner: El[], ev: SynthEvent) {
  for (const e of [...chainOuterToInner].reverse()) {
    if (ev.stopped) return;
    if (typeof e.type !== 'string') continue;
    const h = e.props[HANDLER[ev.type]] as ((x: SynthEvent) => void) | undefined;
    if (typeof h === 'function') h(ev);
  }
}

/** Il cammino di elementi (radice -> bersaglio), senza espandere componenti. */
function pathTo(root: unknown, pred: (e: El) => boolean): El[] | undefined {
  const walk = (n: unknown, path: El[], depth: number): El[] | undefined => {
    if (!n || typeof n !== 'object' || depth > 200) return undefined;
    if (Array.isArray(n)) { for (const x of n) { const f = walk(x, path, depth + 1); if (f) return f; } return undefined; }
    if (!isEl(n)) return undefined;
    const p = [...path, n];
    if (pred(n)) return p;
    return walk(n.props.children, p, depth + 1);
  };
  return walk(root, [], 0);
}

/** Un'istanza di componente con stato proprio, ridisegnabile: hook finti, effetti raccolti. */
function instance(type: (p: unknown) => unknown, props: unknown) {
  const slots: { v: unknown; deps?: unknown[]; set?: unknown }[] = [];
  let effects: { fn: () => unknown; deps?: unknown[] }[] = [];
  const render = (): unknown => {
    const saved = { active: rt.active, i: rt.i, slots: rt.slots, effects: rt.effects };
    rt.active = true;
    rt.i = 0;
    rt.slots = slots;
    rt.effects = [];
    try {
      const out = type(props);
      effects = rt.effects;
      return out;
    } finally {
      rt.active = saved.active;
      rt.i = saved.i;
      rt.slots = saved.slots;
      rt.effects = saved.effects;
    }
  };
  return { render, runEffects: () => { for (const e of effects) e.fn(); } };
}

/** Nodo DOM finto: registra i listener nativi e li chiama su dispatch. */
function fakeNode() {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  return {
    listeners,
    addEventListener: (t: string, f: (e: unknown) => void) => { (listeners[t] ??= []).push(f); },
    removeEventListener: (t: string, f: (e: unknown) => void) => { listeners[t] = (listeners[t] ?? []).filter((x) => x !== f); },
    /** true se un listener nativo ha fermato l'evento (React alla radice non lo vede). */
    dispatch: (type: string): boolean => {
      let stopped = false;
      const ev = { type, stopPropagation: () => { stopped = true; }, preventDefault: () => {}, target: null };
      for (const f of listeners[type] ?? []) f(ev);
      return stopped;
    },
  };
}

describe('ListRenderer: Somma/Media dal menu Σ non ordinano la colonna (SXADV-5490)', () => {
  /** Lista paginata dal server (piu' pagine) con importo ordinabile: intestazione ServerSortHeader. */
  const sortedUi = (totals: Totals) => {
    const ui = listUi(3, totals) as unknown as Record<string, unknown>;
    ui.headers = (ui.headers as Record<string, unknown>[]).map((h) =>
      (h.text === 'Importo' ? { ...h, sortExpression: 'importo' } : h));
    ui.paging = { currentPage: 1, totalPages: 3, totalRows: 300, position: 0, pageSize: 100 };
    return ui as unknown as UITree;
  };
  const isTotalsBtn = (e: El) => typeof e.type === 'function' && e.props.name === 'importo' && !('displayName' in e.props);

  /**
   * L'intestazione di importo espansa fino al pulsante Σ: il cammino degli
   * elementi dalla radice dell'intestazione a TotalsHeaderButton, e
   * un'istanza del pulsante con stato proprio.
   */
  function setup(totals: Totals = totalsOf(inactive)) {
    const v = mount(sortedUi(totals));
    const { comp, params } = v.header('col_2');
    expect(comp).toBeDefined();
    rt.ctx = new Map(v.providers().map((p) => [p.ctx, p.value] as [unknown, unknown]));
    const headerOut = callComponent(comp as unknown as (p: unknown) => unknown, params);
    const toBtn = pathTo(headerOut, isTotalsBtn);
    if (!toBtn) throw new Error('pulsante Σ non trovato nell\'intestazione di importo');
    const btnEl = toBtn[toBtn.length - 1];
    const btn = instance(btnEl.type as (p: unknown) => unknown, btnEl.props);
    const out = btn.render();
    const dropdown = pathTo(out, (e) => !!e.props.menu)?.at(-1);
    if (!dropdown) throw new Error('Dropdown col menu non trovato');
    return { v, headerChain: toBtn.slice(0, -1), btn, out, dropdown };
  }
  afterEach(() => { rt.ctx = new Map(); });
  const sortCalls = (v: ReturnType<typeof mount>) => v.props.onAction.mock.calls.filter((c) => c[0] === 'SortColumn');

  it('impianto: l\'intestazione di importo ordina dal server al clic', () => {
    const { v, headerChain } = setup();
    expect(headerChain.some((e) => typeof e.type === 'string' && typeof e.props.onClick === 'function')).toBe(true);
    bubble(headerChain, synth('click'));
    expect(sortCalls(v)).toHaveLength(1);
    expect(sortCalls(v)[0][1]).toEqual(expect.objectContaining({ option1: 'importo' }));
  });

  for (const [label, key] of [['Somma', 'sum'], ['Media', 'avg']] as const) {
    it(`«${label}» dal menu: solo ListTotals, nessun SortColumn (anche risalendo dal portale)`, () => {
      const { v, headerChain, dropdown } = setup();
      const menu = dropdown.props.menu as { items: { key: string; label: unknown }[]; onClick?: (i: unknown) => void };
      const item = menu.items.find((i) => textOf(i.label) === label || i.label === label);
      expect(item).toBeDefined();
      // Il contenuto del portale: popupRender (se c'e') attorno al menu.
      const MENU = createElement('ul', { 'data-menu-marker': true });
      const popupRender = (dropdown.props.popupRender ?? dropdown.props.dropdownRender) as ((m: ReactNode) => ReactNode) | undefined;
      const popup = popupRender ? popupRender(MENU) : MENU;
      const popupChain = pathTo(popup, (e) => e === MENU) ?? [];
      // Il ramo React del portale: header -> ... -> Dropdown -> popup -> menu.
      const chain = [...headerChain, dropdown, ...popupChain];
      for (const type of ['mousedown', 'click']) {
        const ev = synth(type);
        if (type === 'click') {
          const info = { key, keyPath: [key], item: {}, domEvent: ev };
          const own = (item as { onClick?: (i: unknown) => void }).onClick;
          if (own) own(info); else menu.onClick?.(info);
        }
        bubble(chain, ev);
      }
      expect(v.props.onAction).toHaveBeenCalledWith('ListTotals', { option1: 'importo', option2: key, navpath: LIST });
      expect(v.props.onAction.mock.calls.filter((c) => c[0] === 'ListTotals')).toHaveLength(1);
      expect(sortCalls(v)).toHaveLength(0);
    });
  }

  it('clic sul Σ: apre il menu e non ordina', () => {
    const { v, headerChain, btn, out } = setup();
    const spanPath = pathTo(out, (e) => e.type === 'span' && textOf(e.props.children).includes('Σ'));
    expect(spanPath).toBeDefined();
    const span = spanPath!.at(-1)!;
    const ref = (span.props.ref ?? (span as unknown as { ref?: unknown }).ref) as { current: unknown } | ((n: unknown) => void) | undefined;
    const node = fakeNode();
    if (typeof ref === 'function') ref(node); else if (ref) ref.current = node;
    btn.runEffects();
    // Il Dropdown parte chiuso.
    expect(pathTo(btn.render(), (e) => !!e.props.menu)!.at(-1)!.props.open).not.toBe(true);
    // Il ramo React del Σ: header -> ... -> Dropdown -> ... -> span.
    const chain = [...headerChain, ...spanPath!];
    for (const type of ['mousedown', 'click']) {
      const nativeStopped = node.dispatch(type);
      if (!nativeStopped) bubble(chain, synth(type));
    }
    expect(sortCalls(v)).toHaveLength(0);
    // Il menu ora e' aperto (stato del pulsante, o un trigger React che l'ha aperto).
    const dd = pathTo(btn.render(), (e) => !!e.props.menu)!.at(-1)!;
    expect(dd.props.open).toBe(true);
    expect(v.props.onAction.mock.calls.filter((c) => c[0] === 'ListTotals')).toHaveLength(0);
  });
});

describe('ListRenderer: la cella dei totali non va a capo dopo «Σ » (SXADV-5490)', () => {
  const LONG_SUM = '1.234.567.890.123,45 €';
  const LONG_AVG = '411.522.630.041,15 €';

  /** La cella della riga fissata, disegnata col renderer che la griglia sceglie per lei. */
  function renderTotalsCell(v: ReturnType<typeof mount>, field: string): string {
    const row = (v.grid().props.pinnedBottomRowData as Record<string, unknown>[])[0];
    const d = { ...((v.grid().props.defaultColDef ?? {}) as Record<string, unknown>), ...(v.colDef(field) as Record<string, unknown>) };
    const raw = row[field];
    const value = typeof raw === 'string' ? raw : (raw as { text?: string } | undefined)?.text;
    const params = { value, data: row, colDef: d, node: { rowPinned: 'bottom', data: row }, column: { getColId: () => field } };
    const sel = d.cellRendererSelector as ((p: unknown) => { component?: unknown } | undefined) | undefined;
    const comp = (sel?.(params)?.component ?? d.cellRenderer) as ComponentType<Record<string, unknown>> | string | undefined;
    if (!comp || typeof comp === 'string') return String(value ?? '');
    return renderToStaticMarkup(createElement(comp, params));
  }
  const whiteSpaces = (markup: string) =>
    [...markup.matchAll(/white-space:\s*([a-z-]+)/gi)].map((m) => m[1].toLowerCase());
  const cellText = (markup: string) =>
    markup.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');

  it('solo somma, totale lungo: testo «Σ <numero>» su una riga, white-space che non spezza', () => {
    const v = mount(listUi(3, totalsOf({ importo: { available: true, active: ['sum'], sum: LONG_SUM } })));
    const m = renderTotalsCell(v, 'col_2');
    expect(cellText(m)).toBe(`Σ ${LONG_SUM}`);
    expect(cellText(m)).not.toContain('\n');
    const ws = whiteSpaces(m);
    expect(ws.length).toBeGreaterThan(0);
    for (const w of ws) expect(['pre', 'nowrap']).toContain(w);
  });

  it('solo media, totale lungo: «⌀ <numero>» su una riga, nessun a capo morbido', () => {
    const v = mount(listUi(3, totalsOf({ importo: { available: true, active: ['avg'], avg: LONG_AVG } })));
    const m = renderTotalsCell(v, 'col_2');
    expect(cellText(m)).toBe(`⌀ ${LONG_AVG}`);
    const ws = whiteSpaces(m);
    expect(ws.length).toBeGreaterThan(0);
    for (const w of ws) expect(['pre', 'nowrap']).toContain(w);
  });

  it('somma + media: due righe esatte unite da "\\n", e nessun altro a capo', () => {
    const v = mount(listUi(3, totalsOf({ importo: { available: true, active: ['sum', 'avg'], sum: LONG_SUM, avg: LONG_AVG } })));
    const m = renderTotalsCell(v, 'col_2');
    expect(cellText(m).split('\n')).toEqual([`Σ ${LONG_SUM}`, `⌀ ${LONG_AVG}`]);
    // Il "\n" deve restare un a capo (pre), gli spazi no (non pre-wrap / pre-line / normal).
    const ws = whiteSpaces(m);
    expect(ws.length).toBeGreaterThan(0);
    for (const w of ws) expect(w).toBe('pre');
  });
});
