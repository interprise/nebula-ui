import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { UITree } from '../types/ui';
import { ELTYPE_CONTENT, ELTYPE_DUMMY, ELTYPE_SELECTOR } from '../types/ui';

// SXADV-6298 — la catenella (NavigateView verso contentViewName) nelle BANDE DI
// CONTINUAZIONE di una lista. Il legacy la disegnava dopo il valore in
// qualunque banda; il server la manda come `control.navigateView` anche sulle
// celle delle righe di continuazione (es. «Sottoconto» di Righe fattura =
// docRigheCliList, seconda banda del record).
//
// Contratto provato qui:
//   1. una cella di continuazione (testo o html) con control.navigateView mostra
//      la stessa icona della prima banda (.list-cell-nav con .nav-icon);
//   2. il clic chiama onAction(command, { navpath: percorso della RIGA,
//      option1: controlName }) — il navpath impacchettato nel descrittore non
//      conta — e non attiva la riga (non si propaga; il clic che AG Grid vede
//      sul rigo, partito dall'icona, non apre il record);
//   3. senza navigateView nessuna icona;
//   4. il testo della cella resta quello del server;
//   5. lo stesso in modalità una-riga (bande promosse a colonne).
//
// Motore di hook e browser finto come in sxadv5859e.test.tsx: ListRenderer si
// esegue come funzione, si leggono le props di AgGridReact e si "rendono" a
// mano i renderer (fullWidthCellRenderer per le bande, cellRenderer delle
// colonne promosse in una-riga).

const flags = vi.hoisted(() => ({ oneLine: false }));

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
    isOneLine: () => flags.oneLine, setOneLine: () => {},
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
// Il filtro dell'HTML del server (serverHtml) usa DOMParser: quello di jsdom.
// Import dinamico con lo specificatore come stringa: jsdom non ha i tipi nel
// progetto (TS7016 rompe `npm run build`), e qui servono solo due costruttori.
type JsdomLike = { JSDOM: new (html: string) => { window: { DOMParser: unknown; Node: unknown } } };
const jsdomName: string = 'jsdom';
const { JSDOM } = (await import(/* @vite-ignore */ jsdomName)) as JsdomLike;
const jsdomWin = new JSDOM('').window;
const realParser = g.DOMParser;
const realNode = g.Node;
beforeEach(() => {
  installBrowser();
  g.DOMParser = jsdomWin.DOMParser;
  g.Node = jsdomWin.Node;
  flags.oneLine = false;
});
afterEach(() => { restoreBrowser(); g.DOMParser = realParser; g.Node = realNode; });

// ── la lista ────────────────────────────────────────────────────────────────
// Record su due bande: prima banda Seq. + Descrizione; seconda banda Sottoconto
// (testo, con catenella), Servizio (html, con catenella), Note (testo, senza).
const LIST = 'S1-12';
const UI_PATH = 'S1-0.0,S1-11.0,S1-12';
const rowPath = (pos: number) => `${UI_PATH}.${pos}`;
const CMD = 'NavigateDetail';
/** navpath nel descrittore volutamente diverso dal percorso della riga. */
const PACKED = 'S1-0.0,S1-11.0';
const SOTTO = (i: number) => `205.04.0${i} - RICAVI LIBRI PAGA`;
const SERV_HTML = (i: number) => `001${i}<br />LIBRO UNICO DEL LAVORO`;
const NOTE = (i: number) => `Nota ${i}`;

type Opts = { nav?: boolean; n?: number };

function listUi(o: Opts = {}): UITree {
  const n = o.n ?? 2;
  const nav = o.nav ?? true;
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: `r${i}`,
      cls: i % 2 ? 'oddRow' : 'evenRow',
      props: { path: rowPath(i) },
      cells: [
        { elementType: ELTYPE_SELECTOR, colspan: 1, pos: i },
        { elementType: ELTYPE_CONTENT, colspan: 1, control: { value: String(i + 1) } },
        { elementType: ELTYPE_CONTENT, colspan: 2, control: { value: `Riga ${i}` } },
      ],
    });
    // Forma del server: celle di continuazione con il solo control (niente text/type).
    rows.push({
      cls: i % 2 ? 'oddRow' : 'evenRow',
      cells: [
        { elementType: ELTYPE_DUMMY, colspan: 1 },
        {
          elementType: ELTYPE_CONTENT, colspan: 1,
          control: {
            displayValue: SOTTO(i), value: `44|GEN|1|371${i}`,
            ...(nav ? { navigateView: { controlName: 'sottoconto', command: 'NavigateView', navpath: PACKED } } : {}),
          },
        },
        {
          elementType: ELTYPE_CONTENT, colspan: 1,
          control: {
            value: SERV_HTML(i),
            ...(nav ? { navigateView: { controlName: 'servizio', command: 'NavigateView', navpath: PACKED } } : {}),
          },
        },
        { elementType: ELTYPE_CONTENT, colspan: 1, control: { value: NOTE(i) } },
      ],
    });
  }
  return {
    pageType: 1,
    viewName: 'docRigheCliList',
    path: UI_PATH,
    listEdit: false,
    multiEdit: false,
    inlineEdit: false,
    hasDetailView: true,
    headers: [
      { text: '', colspan: 1 },
      { text: 'Seq.', colspan: 1 },
      { text: 'Descrizione', colspan: 2 },
    ],
    continuationHeaders: [[
      { text: '', colspan: 1 },
      { text: 'Sottoconto', colspan: 1 },
      { text: 'Servizio', colspan: 1 },
      { text: 'Note', colspan: 1 },
    ]],
    columns: [
      { elementType: ELTYPE_SELECTOR, selector: { command: CMD, basePath: LIST, canEdit: false, canUpdate: true } },
      { elementType: ELTYPE_CONTENT, control: { name: 'sequenzaFormattata', type: 'text' } },
      { elementType: ELTYPE_CONTENT, control: { name: 'descrizione', type: 'text' } },
    ],
    rows,
  } as unknown as UITree;
}

// ── albero React a mano ─────────────────────────────────────────────────────
type El = ReactElement<Record<string, unknown>> & { type: unknown };
const isEl = (x: unknown): x is El => !!x && typeof x === 'object' && 'props' in (x as object) && 'type' in (x as object);

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

/** Esegue un componente funzione con hook propri (slot separati da ListRenderer). */
function callComponent(type: (p: unknown) => unknown, props: unknown): unknown {
  const saved = { slots: rt.slots, i: rt.i, effects: rt.effects, active: rt.active };
  rt.slots = []; rt.i = 0; rt.effects = []; rt.active = true;
  try { return type(props); } finally {
    rt.slots = saved.slots; rt.i = saved.i; rt.effects = saved.effects; rt.active = saved.active;
  }
}

/** Espande i componenti funzione (non quelli di libreria: oggetti forwardRef/memo). */
function expand(n: unknown, depth = 0): unknown {
  if (depth > 60 || n == null || typeof n !== 'object') return n;
  if (Array.isArray(n)) return n.map((x) => expand(x, depth + 1));
  if (!isEl(n)) return n;
  const e = n as El;
  if (typeof e.type === 'function' && !(e.type as { prototype?: { isReactComponent?: unknown } }).prototype?.isReactComponent) {
    return expand(callComponent(e.type as (p: unknown) => unknown, e.props), depth + 1);
  }
  const ch = e.props.children;
  if (ch === undefined) return e;
  return { ...e, props: { ...e.props, children: expand(ch, depth + 1) } };
}

/** Elementi (dopo l'espansione) con i loro antenati. */
function walk(n: unknown, visit: (e: El, ancestors: El[]) => void, anc: El[] = []): void {
  if (n == null || typeof n !== 'object') return;
  if (Array.isArray(n)) { n.forEach((x) => walk(x, visit, anc)); return; }
  if (!isEl(n)) return;
  visit(n, anc);
  const ch = n.props.children;
  if (ch !== undefined) walk(ch, visit, [...anc, n]);
}
const classesOf = (e: El) => String(e.props.className ?? '').split(/\s+/).filter(Boolean);

/** Le icone catenella: .nav-icon dentro un .list-cell-nav (stesso selettore della prima banda). */
function navIcons(tree: unknown) {
  const out: { icon: El; ancestors: El[] }[] = [];
  walk(tree, (e, anc) => {
    if (classesOf(e).includes('nav-icon') && anc.some((a) => classesOf(a).includes('list-cell-nav'))) out.push({ icon: e, ancestors: anc });
  });
  return out;
}

/** Testo visibile: stringhe + HTML iniettato. */
function textOf(tree: unknown): string {
  const parts: string[] = [];
  const rec = (n: unknown) => {
    if (n == null || typeof n === 'boolean') return;
    if (typeof n === 'string' || typeof n === 'number') { parts.push(String(n)); return; }
    if (Array.isArray(n)) { n.forEach(rec); return; }
    if (!isEl(n)) return;
    const h = (n.props.dangerouslySetInnerHTML as { __html?: string } | undefined)?.__html;
    if (h) parts.push(h.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''));
    rec(n.props.children);
  };
  rec(tree);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// ── montaggio ───────────────────────────────────────────────────────────────
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
  rt.i = 0; rt.effects = []; rt.active = true;
  try { tree = (ListRenderer as unknown as (p: unknown) => ReactNode)(props); } finally { rt.active = false; }
  const grid = () => {
    const el = findEl(tree, (e) => typeof e.props.onGridReady === 'function');
    if (!el) throw new Error('AgGridReact non trovato');
    return el;
  };
  const rowData = () => grid().props.rowData as Row[];
  const records = () => rowData().filter((r) => !r._isContinuationRow && !r._isBreakRow);
  const continuations = () => rowData().filter((r) => r._isContinuationRow);
  const context = () => grid().props.context as Row;
  /** La banda di continuazione `data` come la disegna AG Grid (riga a tutta larghezza). */
  const renderBand = (data: Row) => {
    const isFW = grid().props.isFullWidthRow as (p: unknown) => boolean;
    expect(isFW({ rowNode: { data } })).toBe(true);
    const R = grid().props.fullWidthCellRenderer as (p: unknown) => unknown;
    return expand(R({ data, context: context(), node: undefined, api: undefined }));
  };
  const flatColDefs = () => {
    const out: Row[] = [];
    const rec = (defs: Row[] | undefined) => (defs ?? []).forEach((d) => { if (Array.isArray(d.children)) rec(d.children as Row[]); else out.push(d); });
    rec(grid().props.columnDefs as Row[]);
    return out;
  };
  /** Le celle promosse a colonna (una-riga) del record `data`, già rese. */
  const renderFlatCells = (data: Row) => flatColDefs()
    .filter((c) => typeof c.field === 'string' && data[`_contcell_${c.field}`] !== undefined && typeof c.cellRenderer === 'function')
    .map((c) => ({
      field: c.field as string,
      tree: expand((c.cellRenderer as (p: unknown) => unknown)({
        data, value: data[c.field as string], colDef: c, context: context(), ...(c.cellRendererParams as Row ?? {}),
      })),
    }));
  /** Clic sul rigo (onRowClicked di AG Grid) con un target finto. */
  const clickRow = (data: Row, target: { closest: (s: string) => unknown } = { closest: () => null }) => {
    (grid().props.onRowClicked as (e: unknown) => void)({ data, node: { data }, event: { target } });
  };
  return { props, grid, rowData, records, continuations, renderBand, renderFlatCells, clickRow };
}

/** Clic sull'icona: ritorna lo stopPropagation spiato. */
function clickIcon(icon: El) {
  const stopPropagation = vi.fn();
  const fn = icon.props.onClick as ((e: unknown) => void) | undefined;
  expect(typeof fn).toBe('function');
  fn!({ stopPropagation, preventDefault: () => {} });
  return stopPropagation;
}

/** Un target DOM finto che sta dentro gli antenati dell'icona (per onRowClicked). */
function targetInside(icon: El, ancestors: El[]) {
  const cls = new Set([...ancestors, icon].flatMap(classesOf));
  return {
    closest: (sel: string) => (sel.split(',').map((s) => s.trim())
      .some((s) => /^\.[\w-]+$/.test(s) && cls.has(s.slice(1))) ? {} : null),
  };
}

// ── 1. bande a più righe ────────────────────────────────────────────────────
describe('SXADV-6298: catenella nelle bande di continuazione', () => {
  it('la banda di continuazione porta il percorso del record', () => {
    const m = mount(listUi());
    expect(m.continuations().map((r) => r._selectorPath)).toEqual([rowPath(0), rowPath(1)]);
  });

  it('cella di testo e cella html con navigateView: un\'icona catenella ciascuna', () => {
    const m = mount(listUi());
    const icons = navIcons(m.renderBand(m.continuations()[0]));
    expect(icons).toHaveLength(2);
  });

  it('clic sull\'icona del Sottoconto (testo): onAction(command, {navpath: riga, option1: controlName})', () => {
    const m = mount(listUi());
    const [sotto] = navIcons(m.renderBand(m.continuations()[1]));
    clickIcon(sotto.icon);
    expect(m.props.onAction).toHaveBeenCalledTimes(1);
    const [cmd, params] = m.props.onAction.mock.calls[0] as [string, Record<string, string>];
    expect(cmd).toBe('NavigateView');
    expect(params).toMatchObject({ navpath: rowPath(1), option1: 'sottoconto' });
    expect(params.navpath).not.toBe(PACKED);
  });

  it('clic sull\'icona del Servizio (html): stesso contratto, controlName della cella', () => {
    const m = mount(listUi());
    const icons = navIcons(m.renderBand(m.continuations()[0]));
    clickIcon(icons[1].icon);
    const [cmd, params] = m.props.onAction.mock.calls[0] as [string, Record<string, string>];
    expect(cmd).toBe('NavigateView');
    expect(params).toMatchObject({ navpath: rowPath(0), option1: 'servizio' });
  });

  it('il clic sull\'icona non attiva la riga', () => {
    const m = mount(listUi());
    const band = m.continuations()[0];
    const [sotto] = navIcons(m.renderBand(band));
    const stop = clickIcon(sotto.icon);
    expect(stop).toHaveBeenCalled();
    // AG Grid vede lo stesso clic sul rigo, col target dentro la cella dell'icona
    m.clickRow(band, targetInside(sotto.icon, sotto.ancestors));
    expect(m.props.onAction.mock.calls.filter((c) => c[0] === CMD)).toHaveLength(0);
    expect(m.props.onSelectRecord).not.toHaveBeenCalled();
    expect(m.props.onAction).toHaveBeenCalledTimes(1); // solo la NavigateView
  });

  it('controprova: il clic sul rigo fuori dall\'icona apre il record', () => {
    const m = mount(listUi());
    m.clickRow(m.records()[0]);
    const opened = m.props.onAction.mock.calls.some((c) => c[0] === CMD) || m.props.onSelectRecord.mock.calls.length > 0;
    expect(opened).toBe(true);
  });

  it('senza navigateView nessuna icona', () => {
    const m = mount(listUi({ nav: false }));
    expect(navIcons(m.renderBand(m.continuations()[0]))).toHaveLength(0);
  });

  it('la cella Note (senza navigateView) resta senza icona accanto a quelle con', () => {
    const m = mount(listUi());
    const tree = m.renderBand(m.continuations()[0]);
    // le icone sono 2 su 3 celle: la terza (Note) non ne ha
    expect(navIcons(tree)).toHaveLength(2);
    expect(textOf(tree)).toContain(NOTE(0));
  });

  it('il testo resta quello del server, con e senza catenella', () => {
    const m = mount(listUi());
    const t = textOf(m.renderBand(m.continuations()[0]));
    expect(t).toContain(SOTTO(0));
    expect(t).toContain('0010 LIBRO UNICO DEL LAVORO');
    expect(t).not.toContain('<br');
    const plain = mount(listUi({ nav: false }));
    expect(textOf(plain.renderBand(plain.continuations()[0]))).toBe(t);
  });
});

// ── 2. una-riga: bande promosse a colonne ───────────────────────────────────
describe('SXADV-6298: catenella nelle colonne promosse (una-riga)', () => {
  it('in una-riga le bande diventano colonne del record', () => {
    flags.oneLine = true;
    const m = mount(listUi());
    expect(m.continuations()).toHaveLength(0);
    expect(m.renderFlatCells(m.records()[0]).length).toBeGreaterThanOrEqual(3);
  });

  it('Sottoconto e Servizio promossi hanno l\'icona, Note no', () => {
    flags.oneLine = true;
    const m = mount(listUi());
    const cells = m.renderFlatCells(m.records()[0]);
    const withIcon = cells.filter((c) => navIcons(c.tree).length === 1);
    expect(withIcon).toHaveLength(2);
    const noteCell = cells.find((c) => textOf(c.tree).includes(NOTE(0)));
    expect(noteCell && navIcons(noteCell.tree)).toHaveLength(0);
  });

  it('clic in una-riga: navpath della riga, option1 = controlName, nessuna propagazione', () => {
    flags.oneLine = true;
    const m = mount(listUi());
    const cells = m.renderFlatCells(m.records()[1]);
    const sotto = cells.find((c) => textOf(c.tree).includes(SOTTO(1)));
    expect(sotto).toBeTruthy();
    const [ic] = navIcons(sotto!.tree);
    const stop = clickIcon(ic.icon);
    expect(stop).toHaveBeenCalled();
    const [cmd, params] = m.props.onAction.mock.calls[0] as [string, Record<string, string>];
    expect(cmd).toBe('NavigateView');
    expect(params).toMatchObject({ navpath: rowPath(1), option1: 'sottoconto' });
  });

  it('senza navigateView, in una-riga nessuna icona e testo invariato', () => {
    flags.oneLine = true;
    const m = mount(listUi({ nav: false }));
    const cells = m.renderFlatCells(m.records()[0]);
    expect(cells.every((c) => navIcons(c.tree).length === 0)).toBe(true);
    const all = cells.map((c) => textOf(c.tree)).join(' ');
    expect(all).toContain(SOTTO(0));
    expect(all).toContain('LIBRO UNICO DEL LAVORO');
  });
});
