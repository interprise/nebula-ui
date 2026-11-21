// SXADV-6276: dalla Home, il clic su una riga di un widget (dashboard.ApriRecord, poi la
// Shell apre ViewByKey con newTask) NON deve sovrascrivere la scheda di lavoro se e' gia'
// in uso: come «Apri la lista completa» (SXADV-6125), il dettaglio va in una scheda NUOVA
// in coda. Scheda di lavoro vuota = la si usa. Il limite delle sessioni vale (le schede
// del Documentale non contano): al limite avviso e nessuna apertura.
//
// Harness copiato da Shell.sessionLimitDocumentale.sxadv6125.test.tsx (la Shell gira
// davvero col motore di hook finto; i figli, Home e dashboard comprese, non girano: il
// clic sulla riga si simula come lo fa DashboardPanel.apriRecord, chiedendo prima alla
// Shell se si puo' aprire e poi chiamando onApriDettaglio).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import type { ErrorItem } from '../types/ui';


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
  loginInfo: { login: '44AMM', customerKey: '44', cdms: true },
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




const evento = { preventDefault: () => {}, stopPropagation: () => {} };


const home = () => elements(tree).find((e) => e.type === HomePanel);
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



async function cliccaCasetta(): Promise<void> {
  const c = casetta();
  expect(c, 'la casetta').toBeDefined();
  (c!.props.onClick as (e: unknown) => void)(evento);
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

// ───────────────────────────────────────────── il Documentale
const delGestionale = () => schede().filter((t) => t.sid.startsWith('S'));
const delDocumentale = () => schede().filter((t) => t.sid.startsWith('D'));

/** Il pulsante della barra laterale che passa da un'area all'altra (tooltip `titolo`). */
async function cliccaInterruttore(titolo: 'Documentale' | 'Gestionale'): Promise<void> {
  const tip = elements(tree).find((e) => e.props.title === titolo && e.props.placement === 'right');
  expect(tip, `il pulsante «${titolo}»`).toBeDefined();
  const btn = elements(tip).find((e) => typeof e.props.onClick === 'function' && String(e.props.className ?? '').includes('app-bar-btn'));
  expect(btn, `il bottone dentro «${titolo}»`).toBeDefined();
  (btn!.props.onClick as (e: unknown) => void)(evento);
  await settle();
}

/** Dalla Home del gestionale: si entra nel Documentale (apre Ricerca e Documenti recenti) e si torna. */
async function apriDocumentaleETorna(): Promise<void> {
  expect(home(), 'si parte dalla Home').toBeDefined();
  await cliccaInterruttore('Documentale');
  expect(delDocumentale(), 'il Documentale apre le sue 2 schede').toHaveLength(2);
  await cliccaInterruttore('Gestionale');
  expect(home(), 'tornati sulla Home del gestionale').toBeDefined();
  expect(delDocumentale(), 'le schede del Documentale restano vive').toHaveLength(2);
}

/** `n` schede del gestionale in uso (la prima e' la tab_1), poi sulla Home. */
async function schedeGestionaleInUso(n: number): Promise<void> {
  await schedaInUso();
  for (let k = 2; k <= n; k++) {
    server.next.push(videata('documentiList', `S${k}-5`));
    expect(await clicNaviga(`Lista ${k}`, 100 + k), `apertura della scheda ${k}`).toBe(true);
    await cliccaCasetta();
  }
  expect(delGestionale()).toHaveLength(n);
  expect(home()).toBeDefined();
}


// ───────────────────────────────────────────── SXADV-6276: il record di una riga
const AVVISO = (n: number) => `Non si possono tenere aperte piu' di ${n} sessioni`;

type Richiesta = { action: string; params: Record<string, string>; sid?: string };
const viewByKey = (): Richiesta[] => server.postAction.filter((r) => r.action === 'ViewByKey');

/**
 * Il clic su una riga del widget `id`, dalla Home, dopo che dashboard.ApriRecord ha detto
 * ok col dettaglio `viewName`: la dashboard chiama onApriDettaglio, la Shell apre ViewByKey.
 */
async function rigaDallaHome(titolo: string, id: number, chiave = 'K1', viewName = 'documentiDetail'): Promise<boolean> {
  expect(home(), 'si parte dalla Home').toBeDefined();
  // Come DashboardPanel.apriRecord: prima la domanda alla Shell (la stessa della lista
  // completa); se dice no, niente ApriRecord e niente onApriDettaglio.
  const p = homeP();
  expect(p.puoNavigare, 'la Shell offre puoNavigare alla Home').toBeTypeOf('function');
  if (!p.puoNavigare!()) { await settle(); return false; }
  server.postAction2.push({ action: 'dashboard.ApriRecord', params: { idWidget: String(id), k: chiave } });
  server.next.push(videata(viewName, 'S9-6'));
  const ok = homeProps().onApriDettaglio(titolo, viewName, chiave, id);
  await settle();
  return ok;
}
/** Le ApriRecord che la dashboard avrebbe mandato (simulate da rigaDallaHome). */
const apriRecord = () => server.postAction2.filter((r) => r.action === 'dashboard.ApriRecord');
/** onApriDettaglio chiamato direttamente, senza passare dalla guardia. */
async function rigaDiretta(titolo: string, id: number, chiave = 'K1', viewName = 'documentiDetail'): Promise<boolean> {
  server.next.push(videata(viewName, 'S9-6'));
  const ok = homeProps().onApriDettaglio(titolo, viewName, chiave, id);
  await settle();
  return ok;
}
const handler = <F,>(marker: string): F => {
  const found = rt.callbacks.filter((f) => f.toString().includes(marker));
  if (found.length !== 1) throw new Error(`gestore "${marker}": trovati ${found.length}`);
  return found[0] as unknown as F;
};
const handleMenuClick = () =>
  handler<(menuId: string, label: string) => Promise<void>>('executeMenuItem(menuId, tab.sid)');
function differita<T>() {
  let risolvi!: (v: T) => void;
  const promessa = new Promise<T>((r) => { risolvi = r; });
  return { promessa, risolvi };
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
const collegamento = (): El | undefined =>
  elements(tree).filter((e) => /Torna al widget/.test(nome(e)) && typeof e.props.onClick === 'function').at(-1);
async function cliccaCollegamento(): Promise<void> {
  const c = collegamento();
  expect(c, 'il collegamento «Torna al widget»').toBeDefined();
  (c!.props.onClick as (e: unknown) => void)(evento);
  await settle();
}
async function vaiAllaScheda(key: string): Promise<void> {
  (tabsBar()!.props.onChange as (k: string) => void)(key);
  await settle();
}

/** Fotografia di etichetta e contenuto di ogni scheda, per vedere che nessuna e' stata toccata. */
const fotografia = () => schede().map((t) => ({ key: t.key, sid: t.sid, label: t.label, ui: t.ui }));

describe('SXADV-6276 riga di un widget dalla Home: scheda di lavoro in uso -> scheda nuova', () => {
  it('una scheda in uso: il dettaglio nasce in una scheda nuova in coda, che diventa attiva', async () => {
    await schedaInUso();
    const prima = scheda('tab_1');
    const n = viewByKey().length;

    expect(await rigaDallaHome('Fatture da incassare', 7, 'K42')).toBe(true);

    expect(schede(), 'una scheda in piu\'').toHaveLength(2);
    const nuova = schede().at(-1)!;
    expect(nuova.key).not.toBe('tab_1');
    expect(nuova.sid, 'sid nuovo').not.toBe(prima.sid);
    expect(nuova.label).toBe('Fatture da incassare');
    expect(schedaAttiva()).toBe(nuova.key);
    expect(home(), 'la Home lascia il posto al dettaglio').toBeUndefined();

    const vbk = viewByKey().slice(n);
    expect(vbk, 'una ViewByKey').toHaveLength(1);
    expect(vbk[0].sid, 'la ViewByKey va sul sid della scheda nuova').toBe(nuova.sid);
    expect(vbk[0].params).toMatchObject({ viewName: 'documentiDetail', DOKey: 'K42', newTask: '1' });
  });

  it('la scheda di lavoro di prima conserva etichetta e contenuto, e non riceve richieste', async () => {
    await schedaInUso();
    const prima = scheda('tab_1');
    const label = prima.label;
    const ui = prima.ui;
    const n = server.postAction.length;

    await rigaDallaHome('Fatture da incassare', 7);

    expect(scheda('tab_1').label).toBe(label);
    expect(scheda('tab_1').ui, 'la lista di prima e\' ancora li\'').toBe(ui);
    expect(server.postAction.slice(n).filter((r) => r.sid === prima.sid), 'nessuna richiesta sul sid di prima').toEqual([]);
  });

  it('scenario del ticket: S1..S3 in uso, ultima di lavoro la terza: nasce la quarta, le altre restano com\'erano', async () => {
    await schedeGestionaleInUso(3);
    const prima = fotografia();
    const sidPrima = new Set(prima.map((t) => t.sid));
    const n = viewByKey().length;

    expect(await rigaDallaHome('Ordini aperti', 9, 'K9')).toBe(true);

    expect(schede()).toHaveLength(4);
    expect(schede().slice(0, 3).map((t) => ({ key: t.key, sid: t.sid, label: t.label, ui: t.ui })), 'le tre schede di prima intatte').toEqual(prima);
    const nuova = schede().at(-1)!;
    expect(sidPrima.has(nuova.sid), 'sid nuovo').toBe(false);
    expect(nuova.label).toBe('Ordini aperti');
    expect(schedaAttiva()).toBe(nuova.key);
    const vbk = viewByKey().slice(n);
    expect(vbk).toHaveLength(1);
    expect(vbk[0].sid).toBe(nuova.sid);
  });

  it('due righe di fila dalla Home: ognuna nella sua scheda nuova', async () => {
    await schedaInUso();
    await rigaDallaHome('Fatture da incassare', 7, 'K1');
    const primaNuova = schede().at(-1)!;
    await cliccaCasetta();
    await rigaDallaHome('Ordini aperti', 9, 'K2');
    expect(schede()).toHaveLength(3);
    const seconda = schede().at(-1)!;
    expect(seconda.sid).not.toBe(primaNuova.sid);
    expect(scheda(primaNuova.key).label).toBe('Fatture da incassare');
    expect(viewByKey().at(-1)!.sid).toBe(seconda.sid);
  });
});

describe('SXADV-6276 riga di un widget dalla Home: scheda di lavoro vuota -> la si usa', () => {
  it('all\'avvio (la sola scheda, vuota): niente scheda nuova, il dettaglio va li\'', async () => {
    expect(schede()).toHaveLength(1);
    const unica = scheda('tab_1');
    expect(unica.ui, 'la scheda e\' vuota').toBeUndefined();
    const n = viewByKey().length;

    expect(await rigaDallaHome('Fatture da incassare', 7, 'K5')).toBe(true);

    expect(schede(), 'nessuna scheda in piu\'').toHaveLength(1);
    expect(schedaAttiva()).toBe('tab_1');
    expect(scheda('tab_1').label).toBe('Fatture da incassare');
    const vbk = viewByKey().slice(n);
    expect(vbk).toHaveLength(1);
    expect(vbk[0].sid).toBe(unica.sid);
    expect(vbk[0].params).toMatchObject({ viewName: 'documentiDetail', DOKey: 'K5', newTask: '1' });
  });
});

describe('SXADV-6276 riga di un widget dalla Home: limite delle sessioni', () => {
  it('limite 3 con 3 schede in uso: avviso, nessuna scheda, nessuna richiesta, si resta sulla Home', async () => {
    props.sessionLimit = 3;
    await schedeGestionaleInUso(3);
    const prima = fotografia();
    dialogs.avvisi = [];
    const n = richieste();

    expect(await rigaDallaHome('Fatture da incassare', 7)).toBe(false);

    expect(apriRecord(), 'la Shell rifiuta prima di ApriRecord').toEqual([]);
    expect(fotografia(), 'nessuna scheda aperta o sovrascritta').toEqual(prima);
    expect(richieste(), 'nessuna richiesta al server').toBe(n);
    expect(home(), 'si resta sulla Home').toBeDefined();
    expect(dialogs.avvisi).toHaveLength(1);
    expect(dialogs.avvisi[0]).toContain(AVVISO(3));
  });

  it('limite 3 pieno, onApriDettaglio chiamato direttamente: anche la Shell si ferma con l\'avviso', async () => {
    props.sessionLimit = 3;
    await schedeGestionaleInUso(3);
    const prima = fotografia();
    dialogs.avvisi = [];
    const n = richieste();
    expect(await rigaDiretta('Fatture da incassare', 7)).toBe(false);
    expect(fotografia()).toEqual(prima);
    expect(richieste()).toBe(n);
    expect(dialogs.avvisi.join(' ')).toContain(AVVISO(3));
  });

  it('limite 4 con 3 del gestionale + le 2 del Documentale: il Documentale non conta, si apre la quarta', async () => {
    props.sessionLimit = 4;
    await schedeGestionaleInUso(3);
    await apriDocumentaleETorna();
    dialogs.avvisi = [];

    expect(await rigaDallaHome('Fatture da incassare', 7)).toBe(true);

    expect(delGestionale()).toHaveLength(4);
    expect(delDocumentale()).toHaveLength(2);
    const nuova = delGestionale().at(-1)!;
    expect(nuova.label).toBe('Fatture da incassare');
    expect(viewByKey().at(-1)!.sid).toBe(nuova.sid);
    expect(dialogs.avvisi).toEqual([]);
  });

  it('limite 4 con 4 del gestionale + 2 del Documentale: avviso e niente apertura', async () => {
    props.sessionLimit = 4;
    await schedeGestionaleInUso(4);
    await apriDocumentaleETorna();
    const prima = fotografia();
    dialogs.avvisi = [];
    const n = richieste();

    expect(await rigaDallaHome('Fatture da incassare', 7)).toBe(false);

    expect(apriRecord(), 'nessuna ApriRecord').toEqual([]);
    expect(fotografia()).toEqual(prima);
    expect(richieste()).toBe(n);
    expect(dialogs.avvisi.join(' ')).toContain(AVVISO(4));
  });

  it('limite 1 con la sola scheda vuota: la si usa, senza avviso (il limite conta le schede nuove)', async () => {
    props.sessionLimit = 1;
    render();
    await settle();
    dialogs.avvisi = [];
    expect(await rigaDallaHome('Fatture da incassare', 7)).toBe(true);
    expect(schede()).toHaveLength(1);
    expect(scheda('tab_1').label).toBe('Fatture da incassare');
    expect(dialogs.avvisi).toEqual([]);
  });
});

describe('SXADV-6276 «Torna al widget» dalla scheda nuova', () => {
  it('la scheda nuova ricorda il widget, il collegamento porta alla Home su quel widget', async () => {
    await schedaInUso();
    await rigaDallaHome('Fatture da incassare', 7);
    const nuova = schede().at(-1)!;
    expect(nuova.daWidget).toEqual({ idWidget: 7, titolo: 'Fatture da incassare' });
    expect(scheda('tab_1').daWidget?.idWidget, 'la scheda di prima non prende il widget della riga').not.toBe(7);
    await cliccaCollegamento();
    expect(home()).toBeDefined();
    expect(homeProps().mostraWidget).toBe(7);
  });

  it('dopo il ritorno, tornando alla scheda nuova il dettaglio e il collegamento ci sono ancora', async () => {
    await schedaInUso();
    await rigaDallaHome('Fatture da incassare', 7);
    expect(schede(), 'il dettaglio in una scheda sua').toHaveLength(2);
    const nuova = schede().at(-1)!;
    const ui = nuova.ui;
    const uiPrima = scheda('tab_1').ui;
    await cliccaCollegamento();
    await vaiAllaScheda(nuova.key);
    expect(home()).toBeUndefined();
    expect(scheda(nuova.key).ui).toBe(ui);
    expect(scheda('tab_1').ui, 'la lista di prima non e\' stata toccata').toBe(uiPrima);
    const c = collegamento();
    expect(c).toBeDefined();
    expect(nome(c!)).toContain('Fatture da incassare');
  });
});

describe('SXADV-6276 riga di un widget dalla Home: scheda di lavoro occupata in altri modi', () => {
  it('scheda di lavoro in uso e che sta caricando: la riga va in una scheda nuova, senza avviso «sta ancora lavorando»', async () => {
    await schedaInUso();
    const att = differita<unknown>();
    server.next.push(att.promessa);
    void handleMenuClick()('M1', 'Altra');
    await settle();
    expect(scheda('tab_1').loading, 'la scheda di lavoro sta caricando').toBe(true);
    await cliccaCasetta();
    dialogs.info = [];
    dialogs.avvisi = [];

    expect(await rigaDallaHome('Fatture da incassare', 7, 'K3')).toBe(true);

    expect(schede()).toHaveLength(2);
    const nuova = schede().at(-1)!;
    expect(nuova.key).not.toBe('tab_1');
    expect(schedaAttiva(), 'l\'utente e\' sulla scheda nuova').toBe(nuova.key);
    expect(viewByKey().at(-1)!.sid).toBe(nuova.sid);
    expect(dialogs.info.filter((m) => /sta ancora lavorando/.test(m)), 'nessun «sta ancora lavorando»').toEqual([]);
    expect(dialogs.avvisi).toEqual([]);

    // La risposta lenta arriva dopo: resta sulla sua scheda, l'utente resta sulla nuova.
    att.risolvi(videata('altraLista', 'S1-9'));
    await settle();
    expect(schedaAttiva()).toBe(nuova.key);
    expect((scheda(nuova.key).ui as { viewName?: string }).viewName).toBe('documentiDetail');
    expect((scheda('tab_1').ui as { viewName?: string }).viewName).toBe('altraLista');
  });

  it('scheda ripristinata da F5 e mai aperta: la riga va in una scheda nuova, la ripristinata resta da ripristinare', async () => {
    props.initialPanels = [{ id: 'S1', title: 'Prima' }, { id: 'S2', title: 'Seconda' }];
    rt.slots = [];
    render();
    await settle();
    await cliccaCasetta();
    // Chiusa la prima, la scheda di lavoro diventa la seconda, mai aperta.
    (tabsBar()!.props.onEdit as (k: string, a: string) => void)('tab_1', 'remove');
    await settle();
    expect(home(), 'si resta sulla Home').toBeDefined();
    const restanti = () => rt.slots.find((x) => Array.isArray(x.v) && (x.v as Tab[])[0]?.key === 'tab_2')!.v as (Tab & { restorePending?: boolean })[];
    expect(restanti()[0].restorePending).toBe(true);
    const sidRipristinata = restanti()[0].sid;
    const n = viewByKey().length;

    expect(await rigaDallaHome('Fatture da incassare', 7)).toBe(true);

    expect(restanti().map((t) => t.label)).toEqual(['Seconda', 'Fatture da incassare']);
    expect(restanti()[0].restorePending, 'la ripristinata resta da ripristinare').toBe(true);
    const vbk = viewByKey().slice(n);
    expect(vbk).toHaveLength(1);
    expect(vbk[0].sid).toBe(restanti()[1].sid);
    expect(vbk[0].sid).not.toBe(sidRipristinata);
  });
});

describe('SXADV-6276 la risposta di ApriRecord arriva quando la Home non e\' piu\' attiva', () => {
  it('l\'utente e\' passato alla scheda di lavoro: onApriDettaglio torna false e non la tocca', async () => {
    await schedaInUso();
    // Il clic sulla riga: la guardia dice si', parte ApriRecord...
    const p = homeProps();
    expect(homeP().puoNavigare!()).toBe(true);
    // ...e prima della risposta l'utente va sulla sua scheda.
    await vaiAllaScheda('tab_1');
    expect(home()).toBeUndefined();
    const label = scheda('tab_1').label;
    const ui = scheda('tab_1').ui;
    const n = viewByKey().length;
    const m = richieste();

    server.next.push(videata('documentiDetail', 'S9-6'));
    expect(p.onApriDettaglio('Fatture da incassare', 'documentiDetail', 'K1', 7), 'niente apertura').toBe(false);
    await settle();

    expect(viewByKey().length, 'nessuna ViewByKey').toBe(n);
    expect(richieste(), 'nessuna richiesta').toBe(m);
    expect(schede()).toHaveLength(1);
    expect(schedaAttiva()).toBe('tab_1');
    expect(scheda('tab_1').label, 'etichetta invariata').toBe(label);
    expect(scheda('tab_1').ui).toBe(ui);
    expect(scheda('tab_1').daWidget?.idWidget).not.toBe(7);
  });

  it('idem col gestore del disegno corrente (non quello del momento del clic): la scheda attiva non si tocca', async () => {
    // La dashboard tiene il gestore di quando si e' cliccato; qui si prova anche quello
    // nuovo, perche' la regola sia della Shell e non di una chiusura vecchia.
    await schedaInUso();
    expect(homeP().puoNavigare!()).toBe(true);
    await vaiAllaScheda('tab_1');
    const corrente = handler<(t: string, v: string, k: string, id?: number) => boolean>('DOKey: chiave');
    const prima = fotografia();
    const n = viewByKey().length;

    server.next.push(videata('documentiDetail', 'S9-6'));
    expect(corrente('Fatture da incassare', 'documentiDetail', 'K1', 7)).toBe(false);
    await settle();

    expect(viewByKey().length, 'nessuna ViewByKey').toBe(n);
    expect(fotografia()).toEqual(prima);
    expect(schedaAttiva()).toBe('tab_1');
    expect(scheda('tab_1').daWidget?.idWidget).not.toBe(7);
  });

  it('con S1 e S2 in uso, l\'utente passa a S2 prima della risposta: S2 resta com\'era', async () => {
    await schedeGestionaleInUso(2);
    const p = homeProps();
    expect(homeP().puoNavigare!()).toBe(true);
    await vaiAllaScheda('tab_2');
    const prima = fotografia();
    const n = viewByKey().length;

    server.next.push(videata('documentiDetail', 'S9-6'));
    expect(p.onApriDettaglio('Fatture da incassare', 'documentiDetail', 'K1', 7)).toBe(false);
    await settle();

    expect(viewByKey().length).toBe(n);
    expect(fotografia()).toEqual(prima);
    expect(schedaAttiva()).toBe('tab_2');
  });
});
