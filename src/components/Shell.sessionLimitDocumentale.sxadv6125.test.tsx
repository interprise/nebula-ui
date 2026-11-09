// SXADV-6125 + SXADV-5789: «Naviga» / «Apri la lista completa» dalla Home apre una scheda
// nuova se quella di lavoro e' in uso, salvo il limite di sessioni (`sessionLimit`). Il limite
// conta SOLO le schede del gestionale, come `atSessionLimit` che spegne il «+»: le 2 schede che
// il Documentale apre da solo (Ricerca, Documenti recenti) restano vive ma non contano.
//
// Harness copiato da Shell.homeScroll.sxadv6124.test.tsx (la Shell gira davvero col motore
// di hook finto; i figli non girano).
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
const AVVISO_4 = "Non si possono tenere aperte piu' di 4 sessioni";
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

describe('SXADV-6125 «Naviga» dalla Home e limite di sessioni: il Documentale non conta', () => {
  it('limite 4, 2 schede del gestionale in uso + le 2 del Documentale: si apre la terza del gestionale, senza avviso', async () => {
    props.sessionLimit = 4;
    await schedeGestionaleInUso(2);
    await apriDocumentaleETorna();
    expect(schede()).toHaveLength(4);
    dialogs.avvisi = [];
    server.next.push(videata('documentiList', 'S9-5'));
    expect(await clicNaviga('Ordini', 9)).toBe(true);
    expect(delGestionale()).toHaveLength(3);
    expect(delDocumentale()).toHaveLength(2);
    const nuova = delGestionale().at(-1)!;
    expect(nuova.label).toBe('Ordini');
    expect(schedaAttiva()).toBe(nuova.key);
    expect(server.postAction.at(-1)).toMatchObject({ action: 'dashboard.Naviga', sid: nuova.sid });
    expect(dialogs.avvisi).toEqual([]);
  });

  it('idem chiamando onNaviga direttamente (entraDallaHome con nuovaScheda), senza passare da puoNavigare', async () => {
    props.sessionLimit = 4;
    await schedeGestionaleInUso(2);
    await apriDocumentaleETorna();
    dialogs.avvisi = [];
    server.next.push(videata('documentiList', 'S9-5'));
    expect(homeP().onNaviga('Ordini', 9)).toBe(true);
    await settle();
    expect(delGestionale()).toHaveLength(3);
    expect(dialogs.avvisi).toEqual([]);
  });

  it('limite 4, 3 schede del gestionale + 2 del Documentale: si apre la quarta (il limite non e\' 4 schede in tutto)', async () => {
    props.sessionLimit = 4;
    await schedeGestionaleInUso(3);
    await apriDocumentaleETorna();
    dialogs.avvisi = [];
    server.next.push(videata('documentiList', 'S9-5'));
    expect(await clicNaviga('Ordini', 9)).toBe(true);
    expect(delGestionale()).toHaveLength(4);
    expect(dialogs.avvisi).toEqual([]);
  });

  it.each([0, 2])('limite 4, 4 schede del gestionale e %i del Documentale: avviso e non si apre niente', async (doc) => {
    props.sessionLimit = 4;
    await schedeGestionaleInUso(4);
    if (doc) await apriDocumentaleETorna();
    expect(delDocumentale()).toHaveLength(doc);
    dialogs.avvisi = [];
    const n = richieste();
    const prima = schede().map((t) => t.key);
    server.next.push(videata('documentiList', 'S9-5'));
    expect(await clicNaviga('Ordini', 9)).toBe(false);
    expect(schede().map((t) => t.key)).toEqual(prima);
    expect(richieste(), 'nessuna richiesta al server').toBe(n);
    expect(home(), 'si resta sulla Home').toBeDefined();
    expect(dialogs.avvisi).toHaveLength(1);
    expect(dialogs.avvisi[0]).toContain(AVVISO_4);
  });

  it('limite 4 pieno: anche onNaviga chiamato direttamente si ferma con l\'avviso', async () => {
    props.sessionLimit = 4;
    await schedeGestionaleInUso(4);
    await apriDocumentaleETorna();
    dialogs.avvisi = [];
    const prima = schede().length;
    expect(homeP().onNaviga('Ordini', 9)).toBe(false);
    await settle();
    expect(schede()).toHaveLength(prima);
    expect(dialogs.avvisi.join(' ')).toContain(AVVISO_4);
  });

  it('a limite pieno anche il «+» della barra e\' spento: stessa regola', async () => {
    props.sessionLimit = 4;
    await schedeGestionaleInUso(4);
    await apriDocumentaleETorna();
    expect(String(tabsBar()!.props.className)).toContain('session-tabs-full');
  });

  it('con 2 del gestionale + 2 del Documentale il «+» non e\' spento', async () => {
    props.sessionLimit = 4;
    await schedeGestionaleInUso(2);
    await apriDocumentaleETorna();
    expect(String(tabsBar()!.props.className)).not.toContain('session-tabs-full');
  });

  it.each([
    ['0', 0 as number | undefined],
    ['assente', undefined],
  ])('limite %s: nessun limite, con 5 schede del gestionale e le 2 del Documentale si apre la sesta', async (_n, lim) => {
    if (lim === undefined) delete props.sessionLimit; else props.sessionLimit = lim;
    await schedeGestionaleInUso(5);
    await apriDocumentaleETorna();
    dialogs.avvisi = [];
    server.next.push(videata('documentiList', 'S9-5'));
    expect(await clicNaviga('Ordini', 9)).toBe(true);
    expect(delGestionale()).toHaveLength(6);
    expect(dialogs.avvisi).toEqual([]);
  });
});
