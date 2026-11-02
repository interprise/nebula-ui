import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import type { ErrorItem } from '../types/ui';

// SXADV-6124: tornando sulla Home la posizione e' rimessa anche se i widget arrivano dopo; si
// interrompe se l'utente scorre o se c'e' un «Torna al widget».
// SXADV-6125: «Naviga» dalla Home apre una scheda nuova se la scheda di lavoro e' gia' in uso,
// usa quella se e' vuota.
//
// La Shell si esegue davvero, col motore di hook di ritornoWidget.sxadv5999.test.tsx. I figli
// non girano. L'area .tab-content e' un nodo finto che si comporta come il browser su scrollTop
// (un valore oltre l'escursione viene troncato) e ogni ritorno sulla Home ne crea uno nuovo,
// corto: i widget che arrivano dopo sono `crescita`. I fotogrammi li scandisce la prova.

const rt = vi.hoisted(() => ({
  active: false,
  i: 0,
  dirty: false,
  slots: [] as { v: unknown; set?: unknown }[],
  callbacks: [] as ((...a: never[]) => unknown)[],
  effects: [] as { s: { v: unknown }; fn: () => unknown; deps?: unknown[] }[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  type AnyFn = (...a: never[]) => unknown;
  const slot = (init: () => unknown) => {
    const i = rt.i++;
    if (!rt.slots[i]) rt.slots[i] = { v: init() };
    return rt.slots[i];
  };
  const same = (a?: unknown[], b?: unknown[]) =>
    !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
  const on = <F extends AnyFn>(real: F, fake: AnyFn): F =>
    ((...a: never[]) => (rt.active ? fake(...a) : real(...a))) as unknown as F;
  const effect = ((fn: () => unknown, deps?: unknown[]) => {
    const s = slot(() => ({ first: true, deps: undefined as unknown[] | undefined, cleanup: undefined as unknown }));
    const st = s.v as { first: boolean; deps?: unknown[] };
    if (st.first || !deps || !same(st.deps, deps)) rt.effects.push({ s, fn, deps });
  }) as AnyFn;
  const memo = (f: () => unknown, deps?: unknown[]) => {
    const s = slot(() => ({ deps: undefined as unknown[] | undefined, val: undefined as unknown, ok: false }));
    const st = s.v as { deps?: unknown[]; val: unknown; ok: boolean };
    if (!st.ok || !deps || !same(st.deps, deps)) {
      st.val = f();
      st.deps = deps;
      st.ok = true;
    }
    return st.val;
  };
  const over = {
    useState: on(actual.useState as AnyFn, ((init: unknown) => {
      const s = slot(() => (typeof init === 'function' ? (init as () => unknown)() : init));
      s.set ??= (nv: unknown) => {
        const n = typeof nv === 'function' ? (nv as (p: unknown) => unknown)(s.v) : nv;
        if (!Object.is(n, s.v)) { s.v = n; rt.dirty = true; }
      };
      return [s.v, s.set];
    }) as AnyFn),
    useReducer: on(actual.useReducer as AnyFn, ((reducer: (s: unknown, a: unknown) => unknown, init: unknown) => {
      const s = slot(() => init);
      s.set ??= (a: unknown) => {
        const n = reducer(s.v, a);
        if (!Object.is(n, s.v)) { s.v = n; rt.dirty = true; }
      };
      return [s.v, s.set];
    }) as AnyFn),
    useRef: on(actual.useRef as AnyFn, ((init: unknown) => slot(() => ({ current: init })).v) as AnyFn),
    useCallback: on(actual.useCallback as AnyFn, ((fn: AnyFn, deps?: unknown[]) => {
      const f = memo(() => fn, deps) as AnyFn;
      rt.callbacks.push(f);
      return f;
    }) as AnyFn),
    useMemo: on(actual.useMemo as AnyFn, memo as AnyFn),
    useEffect: on(actual.useEffect as AnyFn, effect),
    useLayoutEffect: on(actual.useLayoutEffect as AnyFn, effect),
    useInsertionEffect: on(actual.useInsertionEffect as AnyFn, (() => {}) as AnyFn),
    useImperativeHandle: on(actual.useImperativeHandle as AnyFn, (() => {}) as AnyFn),
    useDebugValue: on(actual.useDebugValue as AnyFn, (() => {}) as AnyFn),
    useContext: on(actual.useContext as AnyFn, ((c: { _currentValue: unknown }) => c._currentValue) as AnyFn),
    useId: on(actual.useId as AnyFn, (() => ':t:') as AnyFn),
    useSyncExternalStore: on(actual.useSyncExternalStore as AnyFn, ((_s: unknown, get: () => unknown) => get()) as AnyFn),
    useTransition: on(actual.useTransition as AnyFn, (() => [false, (f: () => void) => f()]) as AnyFn),
    useDeferredValue: on(actual.useDeferredValue as AnyFn, ((v: unknown) => v) as AnyFn),
  };
  return { ...actual, ...over, default: { ...actual, ...over } };
});

// Il feedback: le finestre non si disegnano, se ne tengono i gestori
// ("premere Annulla" sulla conferma = chiamarne onCancel).
type Handlers = { onCancel?: () => void; onAnswer?: (prompt: ErrorItem, answer: 'yes' | 'no') => void };
const dialogs = vi.hoisted(() => ({
  shown: [] as { errors: ErrorItem[]; handlers: Handlers }[],
  failures: [] as unknown[],
  errori: [] as unknown[],
  avvisi: [] as string[],
  info: [] as string[],
}));
vi.mock('../hooks/feedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/feedback')>()),
  useFeedback: () => ({
    showServerMessages: (errors: ErrorItem[], handlers: Handlers = {}) => { dialogs.shown.push({ errors, handlers }); },
    error: (m: unknown) => { dialogs.errori.push(m); }, warning: (m: unknown) => { dialogs.avvisi.push(String(m)); }, info: (m: unknown) => { dialogs.info.push(String(m)); },
    failure: (e: unknown) => { dialogs.failures.push(e); },
  }),
}));
vi.mock('../hooks/uiMode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/uiMode')>()),
  useUiMode: () => ({ immersive: false, setImmersive: () => {} }),
}));
vi.mock('../hooks/density', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/density')>()),
  useDensity: () => ({ density: 'normal', setDensity: () => {} }),
}));
vi.mock('../hooks/hotkeys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/hotkeys')>()),
  useHotkey: () => {},
}));
vi.mock('../services/notifications', () => ({ ensureNotificationPermission: () => {}, notify: () => {} }));
vi.mock('./BannerCard', () => ({ default: () => null }));
vi.mock('./CdmsTree', () => ({ default: () => null }));

// Il server: si registra ogni richiesta, si risponde quello che il caso prepara.
const server = vi.hoisted(() => ({
  postAction: [] as { action: string; params: Record<string, string>; sid?: string }[],
  postAction2: [] as { action: string; params: Record<string, string> }[],
  menu: [] as { menuId: string; sid?: string; extra?: Record<string, string> }[],
  next: [] as unknown[],
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  postAction: async (action: string, params: Record<string, string>, _fv?: unknown, sid?: string) => {
    server.postAction.push({ action, params: { ...params }, sid });
    const r = server.next.shift();
    if (r instanceof Error) throw r;
    return r ?? {};
  },
  postAction2: async (action: string, params: Record<string, string>) => {
    server.postAction2.push({ action, params: { ...(params || {}) } });
    return {};
  },
  executeMenuItem: async (menuId: string, sid?: string, extra?: Record<string, string>) => {
    server.menu.push({ menuId, sid, extra: extra && { ...extra } });
    const r = server.next.shift();
    if (r instanceof Error) throw r;
    return r ?? {};
  },
  subscribeInFlight: () => () => {},
}));

const { default: Shell } = await import('./Shell');
const { default: HomePanel } = await import('./HomePanel');
const { default: Toolbar } = await import('./Toolbar');
const { clearTemplates } = await import('../services/templateCache');

// Il minimo di browser che Shell e i suoi effetti toccano. DOPO gli import: alcuni
// moduli, al caricamento, scrivono sul documento se c'e'.
const noop = () => {};
const rafCoda = new Map<number, () => void>();
let rafSeq = 0;
const fakeDocument = {
  body: { style: {} as Record<string, string>, classList: { add: noop, remove: noop, contains: () => false, toggle: noop } },
  documentElement: { style: { setProperty: noop, removeProperty: noop }, classList: { add: noop, remove: noop, contains: () => false, toggle: noop }, setAttribute: noop, removeAttribute: noop },
  activeElement: null,
  visibilityState: 'visible',
  hidden: false,
  title: '',
  head: { appendChild: noop },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop }),
  addEventListener: noop,
  removeEventListener: noop,
};
const g = globalThis as Record<string, unknown>;
g.document ??= fakeDocument;
g.window ??= globalThis;
g.addEventListener ??= noop;
g.removeEventListener ??= noop;
g.requestAnimationFrame = (cb: () => void) => { const id = ++rafSeq; rafCoda.set(id, cb); return id; };
g.cancelAnimationFrame = (id: number) => { rafCoda.delete(id); };
g.matchMedia ??= () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop });
g.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
g.MutationObserver ??= class { observe() {} disconnect() {} takeRecords() { return []; } };
class FakeHTMLElement {}
g.HTMLElement ??= FakeHTMLElement;
g.Element ??= FakeHTMLElement;
g.Node ??= FakeHTMLElement;
if (typeof g.localStorage === 'undefined' || g.localStorage === null) {
  const mem = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
  };
}
// Le briciole del server sono HTML e la Shell le legge con DOMParser: qui basta
// riconoscere <span class="breadcrumbElement" title=".." onclick="..">..</span>.
g.DOMParser ??= class {
  parseFromString(html: string) {
    const els = [...html.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/g)]
      .filter((m) => /class="[^"]*breadcrumbElement/.test(m[1]) || /onclick=/.test(m[1]))
      .map((m) => {
        const attr = (n: string) => new RegExp(`${n}="([^"]*)"`).exec(m[1])?.[1] ?? null;
        return { getAttribute: attr, textContent: m[2].replace(/<[^>]*>/g, ''), outerHTML: m[0] };
      });
    return { querySelectorAll: () => els };
  }
};

const props: Record<string, unknown> = {
  menuItems: [],
  loginInfo: { login: '44AMM', customerKey: '44' },
  onLogout: () => {},
  onReloadMenu: async () => {},
};

let tree: unknown = null;

/** Un disegno della Shell, poi gli effetti con le dipendenze cambiate, finche' lo stato non si ferma. */
function render(): void {
  for (let giro = 0; giro < 40; giro++) {
    rt.dirty = false;
    rt.active = true;
    rt.i = 0;
    rt.callbacks = [];
    rt.effects = [];
    try {
      tree = (Shell as unknown as (p: typeof props) => unknown)(props);
    } finally {
      rt.active = false;
    }
    attaccaRadice();
    const daFare = rt.effects;
    rt.effects = [];
    for (const e of daFare) {
      const st = e.s.v as { first: boolean; deps?: unknown[]; cleanup?: unknown };
      if (typeof st.cleanup === 'function') (st.cleanup as () => void)();
      const c = e.fn();
      e.s.v = { first: false, deps: e.deps, cleanup: c };
    }
    if (!rt.dirty) return;
  }
  throw new Error('la Shell non smette di ridisegnarsi');
}

/** Lascia finire le promesse in volo, poi ridisegna. */
async function settle(): Promise<void> {
  for (let k = 0; k < 4; k++) {
    await new Promise((r) => setTimeout(r, 0));
    render();
  }
}

type El = ReactElement<Record<string, unknown>>;

/** Tutti gli elementi raggiungibili dall'albero restituito: figli e prop (anche
 *  `items` di Breadcrumb/Tabs), in ordine di documento. I componenti non si eseguono. */
function elements(node: unknown, out: El[] = [], seen = new Set<unknown>()): El[] {
  if (node == null || typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const n of node) elements(n, out, seen);
    return out;
  }
  const el = node as El;
  if ((el as unknown as { $$typeof?: unknown }).$$typeof !== undefined && el.props) {
    out.push(el);
    const { children, ...rest } = el.props;
    // Prima le prop che disegnano qualcosa di proprio (items, title...), poi i figli.
    for (const [k, v] of Object.entries(rest)) {
      if (k === 'ui' || k === 'loginInfo' || k === 'info' || k === 'style') continue;
      if (v && typeof v === 'object') elements(v, out, seen);
    }
    elements(children, out, seen);
    return out;
  }
  // Oggetti semplici dentro le prop (le voci di un Breadcrumb).
  if (Object.getPrototypeOf(node) === Object.prototype) {
    for (const v of Object.values(node)) elements(v, out, seen);
  }
  return out;
}

/** Il testo che un elemento mostra (stringhe dei figli, ricorsivamente). */
function testo(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(testo).join('');
  const el = node as El;
  if (el.props) return testo(el.props.children);
  return '';
}

const nome = (el: El) =>
  `${testo(el)} ${String(el.props['aria-label'] ?? '')} ${typeof el.props.title === 'string' ? el.props.title : ''}`;

/** Il collegamento «Torna al widget»: l'elemento piu' interno, cliccabile, che lo nomina. */
function collegamento(): El | undefined {
  const tutti = elements(tree).filter((e) => /Torna al widget/.test(nome(e)) && typeof e.props.onClick === 'function');
  return tutti.at(-1);
}
const indice = (el: El | undefined) => (el ? elements(tree).indexOf(el) : -1);

const evento = { preventDefault: () => {}, stopPropagation: () => {} };

async function cliccaCollegamento(): Promise<void> {
  const c = collegamento();
  expect(c, 'il collegamento «Torna al widget»').toBeDefined();
  (c!.props.onClick as (e: unknown) => void)(evento);
  await settle();
}

const home = () => elements(tree).find((e) => e.type === HomePanel);
const toolbar = () => elements(tree).find((e) => e.type === Toolbar);
const tabsBar = () => elements(tree).find((e) => typeof e.props.onEdit === 'function' && Array.isArray(e.props.items));
const casetta = () => elements(tree).find((e) => e.props['aria-label'] === 'Torna alla Home' && typeof e.props.onClick === 'function');

type Tab = { key: string; sid: string; label: string; menuId?: string; functionAction?: string; loading?: boolean; ui?: unknown; daWidget?: { idWidget: number; titolo: string } };
function schede(): Tab[] {
  const s = rt.slots.find((x) => Array.isArray(x.v) && (x.v as { key?: string }[])[0]?.key === 'tab_1');
  return s!.v as Tab[];
}
const scheda = (key = 'tab_1') => schede().find((t) => t.key === key)!;

/** Una lista qualunque, come la manda il server; `crumbs` = HTML delle briciole. */
function videata(viewName: string, path: string, crumbs?: string) {
  return {
    ui: {
      rows: [{ id: 'r0', cells: [{ elementType: 1, control: { name: 'descrizione', id: 'descrizione', type: 'text', editable: true } }] }],
      pageType: 1,
      path,
      viewName,
      viewType: 'list',
      ...(crumbs !== undefined ? { breadcrumbs: crumbs } : {}),
    },
    toolbar: [{ id: 'Detail', text: 'Dettaglio', handler: 'Detail' }],
  };
}

const CRUMBS =
  '<span class="breadcrumbElement" title="&lt;&lt; Fatture da incassare" onclick="doAction(\'BackTo\',\'S1-5\')">Fatture da incassare</span>';

const homeProps = () => {
  const h = home();
  expect(h, 'la Home a video').toBeDefined();
  return h!.props as {
    onApriDettaglio: (titolo: string, viewName: string, chiave: string, idWidget?: number) => boolean;
    onNaviga: (titolo: string, idWidget: number) => boolean;
    mostraWidget?: number | null;
  };
};

/** Dalla Home: «Apri la lista completa» sul widget `id`. */
async function navigaDallaHome(titolo: string, id: number, resp: unknown = videata('documentiList', 'S1-5')) {
  expect(home(), 'si parte dalla Home').toBeDefined();
  server.next.push(resp);
  expect(homeProps().onNaviga(titolo, id)).toBe(true);
  await settle();
}

/** Dalla Home: clic sulla riga `chiave` del widget `id` (DashboardPanel passa anche il widget). */
async function rigaDallaHome(titolo: string, id: number, chiave = 'K1') {
  expect(home(), 'si parte dalla Home').toBeDefined();
  server.next.push(videata('documentiDetail', 'S1-6'));
  expect(homeProps().onApriDettaglio(titolo, 'documentiDetail', chiave, id)).toBe(true);
  await settle();
}

const handler = <F,>(marker: string): F => {
  const found = rt.callbacks.filter((f) => f.toString().includes(marker));
  if (found.length !== 1) throw new Error(`gestore "${marker}": trovati ${found.length}`);
  return found[0] as unknown as F;
};
const handleMenuClick = () =>
  handler<(menuId: string, label: string) => Promise<void>>('executeMenuItem(menuId, tab.sid)');
const handleAction = () =>
  handler<(action: string, params?: Record<string, string>) => Promise<void>>('serverParams.hasTemplate = ');
const openFunctionByAction = () =>
  handler<(label: string, action: string, params?: Record<string, string>) => boolean>('functionAction: action');
const openCdmsView = () =>
  handler<(viewName: string, title: string, filter?: string) => void>("tipo: \"cdms\"");
const changeContext = () =>
  handler<(action: 'CambioAzienda' | 'CambioSede', value: string) => Promise<void>>('postAction2(action, { navpath: value })');

async function cliccaCasetta(): Promise<void> {
  const c = casetta();
  expect(c, 'la casetta').toBeDefined();
  (c!.props.onClick as (e: unknown) => void)(evento);
  await settle();
}

async function vaiAllaScheda(key: string): Promise<void> {
  (tabsBar()!.props.onChange as (k: string) => void)(key);
  await settle();
}

const richieste = () => server.postAction.length + server.menu.length;

beforeEach(async () => {
  rt.slots = [];
  rt.callbacks = [];
  rt.effects = [];
  server.postAction = [];
  server.postAction2 = [];
  server.menu = [];
  server.next = [];
  dialogs.shown = [];
  dialogs.failures = [];
  dialogs.errori = []; dialogs.avvisi = []; dialogs.info = [];
  azzeraRadici();
  clearTemplates();
  render();
  await settle();
});

// ───────────────────────────────────────────── l'area che scorre
g.getComputedStyle = () => ({ getPropertyValue: () => '', paddingTop: '0', paddingBottom: '0', marginTop: '0', marginBottom: '0', overflow: 'auto', overflowY: 'auto', overflowX: 'auto' });
class Radice {
  altezza = 600;
  clientHeight = 500;
  clientWidth = 800;
  scrollWidth = 800;
  scrollLeft = 0;
  scritture: number[] = [];
  ascolti = new Map<string, Set<() => void>>();
  private top = 0;
  style = {};
  children: unknown[] = [];
  get scrollHeight() { return this.altezza; }
  get scrollTop() { return this.top; }
  set scrollTop(v: number) { this.scritture.push(v); this.top = Math.max(0, Math.min(v, this.altezza - this.clientHeight)); }
  /** L'utente che scorre: non passa dal setter delle scritture del programma. */
  portaA(v: number) { this.altezza = Math.max(this.altezza, v + this.clientHeight); this.top = v; }
  addEventListener(t: string, f: () => void) { if (!this.ascolti.has(t)) this.ascolti.set(t, new Set()); this.ascolti.get(t)!.add(f); }
  removeEventListener(t: string, f: () => void) { this.ascolti.get(t)?.delete(f); }
  evento(t: string) { [...(this.ascolti.get(t) ?? [])].forEach((f) => f()); }
  ascoltatori() { return [...this.ascolti.values()].reduce((n, s) => n + s.size, 0); }
  setAttribute() {}
  removeAttribute() {}
  hasAttribute() { return false; }
  getAttribute() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  contains() { return false; }
  getBoundingClientRect() { return { top: 0, left: 0, bottom: 500, right: 800, width: 800, height: 500 }; }
}

let radiceHome: Radice;
let radiceScheda: Radice;
let eraHome = false;
let adesso = 0;
function azzeraRadici() {
  radiceHome = new Radice();
  radiceScheda = new Radice();
  eraHome = false;
  rafCoda.clear();
}
function attaccaRadice() {
  const area = elements(tree).find((e) => e.props.className === 'tab-content');
  const staHome = !!elements(tree).find((e) => e.type === HomePanel);
  if (staHome && !eraHome) radiceHome = new Radice();
  eraHome = staHome;
  const ref = area?.props.ref as { current: unknown } | undefined;
  if (ref) ref.current = staHome ? radiceHome : radiceScheda;
}
vi.spyOn(performance, 'now').mockImplementation(() => adesso);
/** `n` fotogrammi da 16 ms. */
function fotogrammi(n: number, passo = 16) {
  for (let k = 0; k < n; k++) {
    adesso += passo;
    const coda = [...rafCoda.values()];
    rafCoda.clear();
    coda.forEach((f) => f());
  }
}

const schedaAttiva = () => tabsBar()!.props.activeKey as string;
const homeP = () => home()!.props as { onNaviga: (t: string, id: number) => boolean; onApriDettaglio: (t: string, v: string, k: string, id?: number) => boolean; puoAprire: () => boolean; puoNavigare?: () => boolean };
/** Quello che fa DashboardPanel.naviga: prima puoNavigare (o puoAprire), poi (dopo il controllo sul server) onNaviga. */
async function clicNaviga(titolo: string, id: number): Promise<boolean> {
  const p = homeP();
  if (!(p.puoNavigare ?? p.puoAprire)()) { await settle(); return false; }
  const ok = p.onNaviga(titolo, id);
  await settle();
  return ok;
}
function differita<T>() {
  let risolvi!: (v: T) => void;
  const promessa = new Promise<T>((r) => { risolvi = r; });
  return { promessa, risolvi };
}
/** La scheda di lavoro in uso: una lista aperta da un widget, e si torna alla Home. */
async function schedaInUso() {
  await navigaDallaHome('Prima lista', 1);
  expect(scheda('tab_1').ui, 'la lista e\' arrivata').toBeDefined();
  await cliccaCasetta();
  expect(home()).toBeDefined();
}

beforeEach(() => {
  adesso = 0;
});
afterEach(() => {
  // Qui e non nel beforeEach: quello dell'impianto, che gira prima, disegna gia'.
  delete props.sessionLimit;
  delete props.initialPanels;
});

// ───────────────────────────────────────────────────────────── 6124
describe('SXADV-6124 la Home ritrova la posizione', () => {
  async function lasciaAScorrimento(top: number) {
    radiceHome.portaA(top);
    await vaiAllaScheda('tab_1');
    expect(home()).toBeUndefined();
  }

  it('mai scorsa: nessuno tocca la posizione', async () => {
    await vaiAllaScheda('tab_1');
    await cliccaCasetta();
    radiceHome.altezza = 3000;
    fotogrammi(10);
    expect(radiceHome.scritture).toEqual([]);
    expect(radiceHome.scrollTop).toBe(0);
  });

  it('i widget arrivano dopo: la posizione si rimette appena la pagina e\' abbastanza alta', async () => {
    await lasciaAScorrimento(800);
    await cliccaCasetta();
    expect(radiceHome.scrollTop, 'pagina corta: troncata').toBe(100);
    fotogrammi(5);
    radiceHome.altezza = 900;
    fotogrammi(1);
    expect(radiceHome.scrollTop).toBe(400);
    radiceHome.altezza = 3000;
    fotogrammi(1);
    expect(radiceHome.scrollTop).toBe(800);
  });

  it('raggiunta la posizione smette, e toglie gli ascoltatori', async () => {
    await lasciaAScorrimento(800);
    await cliccaCasetta();
    radiceHome.altezza = 3000;
    fotogrammi(2);
    const n = radiceHome.scritture.length;
    radiceHome.portaA(50);
    fotogrammi(10);
    expect(radiceHome.scritture.length).toBe(n);
    expect(radiceHome.ascoltatori()).toBe(0);
  });

  it.each(['wheel', 'pointerdown', 'keydown', 'touchstart'])('%s dell\'utente interrompe', async (ev) => {
    await lasciaAScorrimento(800);
    await cliccaCasetta();
    fotogrammi(2);
    radiceHome.evento(ev);
    radiceHome.altezza = 3000;
    fotogrammi(10);
    expect(radiceHome.scrollTop).toBe(100);
    expect(radiceHome.ascoltatori()).toBe(0);
  });

  it('dopo 8 secondi si arrende', async () => {
    await lasciaAScorrimento(800);
    await cliccaCasetta();
    fotogrammi(1, 8001);
    fotogrammi(1);
    const n = radiceHome.scritture.length;
    radiceHome.altezza = 3000;
    fotogrammi(10);
    expect(radiceHome.scritture.length).toBe(n);
  });

  it('un «Torna al widget» decide lui: nessuna posizione rimessa', async () => {
    radiceHome.portaA(800);
    await navigaDallaHome('Fatture', 7);
    await cliccaCollegamento();
    expect(home()!.props.mostraWidget).toBe(7);
    radiceHome.altezza = 3000;
    fotogrammi(10);
    expect(radiceHome.scritture).toEqual([]);
  });

  it('lasciata di nuovo la Home a meta\': il ciclo si ferma', async () => {
    await lasciaAScorrimento(800);
    await cliccaCasetta();
    const h = radiceHome;
    await vaiAllaScheda('tab_1');
    const n = h.scritture.length;
    h.altezza = 3000;
    fotogrammi(10);
    expect(h.scritture.length).toBe(n);
    expect(h.ascoltatori()).toBe(0);
  });

  it('la posizione ricordata sopravvive a un\'uscita fatta prima che i widget arrivassero', async () => {
    await lasciaAScorrimento(800);
    await cliccaCasetta();
    expect(radiceHome.scrollTop).toBe(100);
    await vaiAllaScheda('tab_1');
    await cliccaCasetta();
    radiceHome.altezza = 3000;
    fotogrammi(3);
    expect(radiceHome.scrollTop).toBe(800);
  });

  it('dopo un cambio azienda la posizione della dashboard di prima non vale piu\'', async () => {
    await lasciaAScorrimento(800);
    await changeContext()('CambioAzienda', '45');
    await settle();
    expect(home()).toBeDefined();
    radiceHome.altezza = 3000;
    fotogrammi(5);
    expect(radiceHome.scrollTop).toBe(0);
  });

  it('idem per un cambio sede', async () => {
    await lasciaAScorrimento(800);
    await changeContext()('CambioSede', '002');
    await settle();
    radiceHome.altezza = 3000;
    fotogrammi(5);
    expect(radiceHome.scrollTop).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────── 6125
describe('SXADV-6125 «Naviga» dalla Home', () => {
  it('scheda di lavoro vuota: usa quella', async () => {
    expect(await clicNaviga('Fatture', 7)).toBe(true);
    expect(schede().map((t) => t.key)).toEqual(['tab_1']);
    expect(schedaAttiva()).toBe('tab_1');
    expect(server.postAction.at(-1)).toMatchObject({ action: 'dashboard.Naviga', sid: 'S1' });
    expect(scheda('tab_1').daWidget).toEqual({ idWidget: 7, titolo: 'Fatture' });
  });

  it('scheda in uso: una nuova, attiva, col titolo e il ricordo del widget; la vecchia intatta', async () => {
    await schedaInUso();
    const primaUi = scheda('tab_1').ui;
    const n = server.postAction.length;
    server.next.push(videata('documentiList', 'S2-5'));
    expect(await clicNaviga('Ordini', 9)).toBe(true);
    const nuova = schede().at(-1)!;
    expect(schede()).toHaveLength(2);
    expect(nuova.key).not.toBe('tab_1');
    expect(schedaAttiva()).toBe(nuova.key);
    expect(nuova.label).toBe('Ordini');
    expect(nuova.daWidget).toEqual({ idWidget: 9, titolo: 'Ordini' });
    expect(server.postAction.length).toBe(n + 1);
    expect(server.postAction.at(-1)).toMatchObject({ action: 'dashboard.Naviga', sid: nuova.sid });
    expect(server.postAction.at(-1)!.params).toMatchObject({ idWidget: '9', newTask: '1' });
    expect(scheda('tab_1').ui).toBe(primaUi);
    expect(scheda('tab_1').label).toBe('Prima lista');
    expect(collegamento()).toBeDefined();
  });

  it('il clic su una RIGA resta nella scheda di lavoro (non e\' «Naviga»)', async () => {
    await schedaInUso();
    await rigaDallaHome('Fatture', 7);
    expect(schede()).toHaveLength(1);
    expect(schedaAttiva()).toBe('tab_1');
  });

  it('fuori dalla Home «Naviga» resta nella scheda corrente', async () => {
    await navigaDallaHome('Prima lista', 1);
    expect(openFunctionByAction()).toBeDefined();
    expect(schede()).toHaveLength(1);
  });

  it('scheda ripristinata da F5 e mai aperta: e\' in uso, una nuova, e la vecchia resta da ripristinare', async () => {
    props.initialPanels = [{ id: 'S1', title: 'Prima' }, { id: 'S2', title: 'Seconda' }];
    rt.slots = [];
    render();
    await settle();
    await cliccaCasetta();
    // Chiusa la prima, la scheda di lavoro diventa la seconda, mai aperta.
    (tabsBar()!.props.onEdit as (k: string, a: string) => void)('tab_1', 'remove');
    await settle();
    expect(home(), 'si resta sulla Home').toBeDefined();
    // schede() cerca la tab_1, che qui non c'e' piu'.
    const restanti = () => rt.slots.find((x) => Array.isArray(x.v) && (x.v as Tab[])[0]?.key === 'tab_2')!.v as (Tab & { restorePending?: boolean })[];
    expect(restanti()[0].restorePending).toBe(true);
    server.next.push(videata('documentiList', 'S3-5'));
    await clicNaviga('Ordini', 9);
    expect(restanti().map((t) => t.label)).toEqual(['Seconda', 'Ordini']);
    expect(restanti()[0].restorePending).toBe(true);
  });

  it('scheda di lavoro che sta caricando, chiamata diretta: nuova scheda, e la risposta vecchia resta sulla sua', async () => {
    await navigaDallaHome('Prima lista', 1);
    const att = differita<unknown>();
    server.next.push(att.promessa);
    void handleMenuClick()('M1', 'Altra');
    await settle();
    expect(scheda('tab_1').loading).toBe(true);
    await cliccaCasetta();
    server.next.push(videata('documentiList', 'S2-5'));
    expect(homeP().onNaviga('Ordini', 9)).toBe(true);
    await settle();
    const nuova = schede().at(-1)!;
    expect(nuova.key).not.toBe('tab_1');
    expect(schedaAttiva()).toBe(nuova.key);
    expect((nuova.ui as { viewName?: string } | undefined)?.viewName).toBe('documentiList');
    att.risolvi(videata('altraLista', 'S1-9'));
    await settle();
    expect(schedaAttiva()).toBe(nuova.key);
    expect((nuova.ui as { viewName?: string } | undefined)?.viewName).toBe('documentiList');
    expect((schede().at(-1)!.ui as { viewName?: string }).viewName).toBe('documentiList');
    expect((scheda('tab_1').ui as { viewName?: string }).viewName).toBe('altraLista');
  });

  it('scheda di lavoro che sta caricando, percorso vero di DashboardPanel (puoAprire e poi onNaviga): nuova scheda', async () => {
    await navigaDallaHome('Prima lista', 1);
    const att = differita<unknown>();
    server.next.push(att.promessa);
    void handleMenuClick()('M1', 'Altra');
    await settle();
    expect(scheda('tab_1').loading).toBe(true);
    await cliccaCasetta();
    server.next.push(videata('documentiList', 'S2-5'));
    const ok = await clicNaviga('Ordini', 9);
    att.risolvi(videata('altraLista', 'S1-9'));
    await settle();
    expect(ok, `puoAprire ha detto no; info: ${dialogs.info.join(' / ')}`).toBe(true);
    expect(schede().length).toBe(2);
    expect(schedaAttiva()).not.toBe('tab_1');
  });

  it('limite di sessioni pieno: non si apre oltre il limite, e l\'utente lo sa', async () => {
    props.sessionLimit = 1;
    await schedaInUso();
    server.next.push(videata('documentiList', 'S2-5'));
    await clicNaviga('Ordini', 9);
    expect(schede().length).toBe(1);
    expect(dialogs.avvisi.join(' ')).toMatch(/sessioni/);
  });

  it('limite non ancora pieno: la scheda nuova si apre', async () => {
    props.sessionLimit = 2;
    await schedaInUso();
    server.next.push(videata('documentiList', 'S2-5'));
    await clicNaviga('Ordini', 9);
    expect(schede().length).toBe(2);
  });

  it('due Naviga di fila dalla Home: tre schede, nessuna sovrascritta', async () => {
    await schedaInUso();
    server.next.push(videata('documentiList', 'S2-5'));
    await clicNaviga('Ordini', 9);
    await cliccaCasetta();
    server.next.push(videata('documentiList', 'S3-5'));
    await clicNaviga('Scadenze', 3);
    expect(schede().map((t) => t.label)).toEqual(['Prima lista', 'Ordini', 'Scadenze']);
  });

  it('la Home ricorda la posizione anche uscendo verso la scheda nuova', async () => {
    await schedaInUso();
    radiceHome.portaA(800);
    server.next.push(videata('documentiList', 'S2-5'));
    await clicNaviga('Ordini', 9);
    await cliccaCasetta();
    radiceHome.altezza = 3000;
    fotogrammi(2);
    expect(radiceHome.scrollTop).toBe(800);
  });
});

// Dall'impianto comune, qui non usati.
void [indice, toolbar, CRUMBS, handleAction, openCdmsView, richieste];
