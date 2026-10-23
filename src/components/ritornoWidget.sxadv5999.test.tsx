import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import type { ErrorItem } from '../types/ui';

// SXADV-5999.3 — «Torna al widget». Oracolo: docs/sxadv-62-prove/RITORNO_contratto.md
// (R1 la scheda ricorda il widget, R2 il collegamento nella banda delle briciole,
// R3 il ritorno alla Home). Qui la parte della Shell; la parte di HomePanel e
// DashboardPanel (Dashboard forzata, scrollIntoView, evidenza) sta in
// ritornoWidget.home.sxadv5999.test.tsx.
//
// Niente DOM nel progetto (vitest gira in node, senza jsdom): la Shell si esegue
// come funzione con un motore di hook finto, come Shell.menuConfirm.sxadv5952.test.tsx,
// e l'albero di elementi che restituisce si visita come dati. A differenza di quei
// test qui gli EFFETTI girano (con le loro dipendenze, come in React): l'ingresso
// dalla Home (entraDallaHome) si esegue in un effetto, e saltarlo vorrebbe dire non
// provare il percorso vero.
//
// I componenti figli non si eseguono: la Home e' l'elemento HomePanel con le sue
// prop (onApriDettaglio / onNaviga sono quello che DashboardPanel chiama al clic su
// una riga e su «Apri la lista completa»), il collegamento si trova per testo
// («Torna al widget») e si clicca chiamandone onClick.

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
}));
vi.mock('../hooks/feedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/feedback')>()),
  useFeedback: () => ({
    showServerMessages: (errors: ErrorItem[], handlers: Handlers = {}) => { dialogs.shown.push({ errors, handlers }); },
    error: (m: unknown) => { dialogs.errori.push(m); }, warning: () => {}, info: () => {},
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
g.requestAnimationFrame = () => 0;
g.cancelAnimationFrame = noop;
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

const props = {
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
  dialogs.errori = [];
  clearTemplates();
  render();
  await settle();
});

// ───────────────────────────────────────────────────────────── R1 + R2
describe('SXADV-5999.3 R1/R2: entrando da un widget la scheda lo ricorda e offre il ritorno', () => {
  it('Home all\'inizio: nessun collegamento (la Home non e\' una scheda di lavoro)', () => {
    expect(home()).toBeDefined();
    expect(collegamento()).toBeUndefined();
  });

  it('«Apri la lista completa» -> nella scheda di lavoro c\'e\' «Torna al widget «<titolo>»»', async () => {
    await navigaDallaHome('Fatture da incassare', 7);
    expect(home(), 'si e\' lasciata la Home').toBeUndefined();
    expect(server.postAction.at(-1)?.action).toBe('dashboard.Naviga');
    const c = collegamento();
    expect(c, 'il collegamento').toBeDefined();
    expect(nome(c!)).toContain('Fatture da incassare');
  });

  it('clic su una riga del widget -> anche il dettaglio offre il ritorno a QUEL widget', async () => {
    await rigaDallaHome('Ordini aperti', 9);
    expect(server.postAction.at(-1)?.action).toBe('ViewByKey');
    const c = collegamento();
    expect(c, 'il collegamento').toBeDefined();
    expect(nome(c!)).toContain('Ordini aperti');
  });

  it('la scheda tiene id e titolo del widget (stato daWidget)', async () => {
    await navigaDallaHome('Fatture da incassare', 7);
    expect(scheda().daWidget).toEqual({ idWidget: 7, titolo: 'Fatture da incassare' });
  });

  it('la banda compare anche senza briciole ne\' allegati, e il collegamento sta prima della barra degli strumenti', async () => {
    await navigaDallaHome('Fatture da incassare', 7);
    const c = collegamento();
    const tb = toolbar();
    expect(c).toBeDefined();
    expect(tb, 'la barra degli strumenti').toBeDefined();
    expect(indice(c)).toBeLessThan(indice(tb));
  });

  it('con le briciole: il collegamento e\' il PRIMO a sinistra, prima delle briciole', async () => {
    await navigaDallaHome('Fatture da incassare', 7, videata('documentiList', 'S1-5', CRUMBS));
    const c = collegamento();
    expect(c).toBeDefined();
    // La briciola del server (non il collegamento, che puo' averne la stessa classe).
    const briciola = elements(tree).find((e) =>
      /breadcrumb-(back-)?link/.test(String(e.props.className ?? '')) && !/Torna al widget/.test(nome(e)));
    expect(briciola, 'la briciola del server').toBeDefined();
    expect(indice(c)).toBeLessThan(indice(briciola));
    expect(indice(c)).toBeLessThan(indice(toolbar()));
  });

  it('il ricordo resta lungo il percorso: un\'azione nella scheda (Dettaglio, poi indietro) non lo toglie', async () => {
    await navigaDallaHome('Fatture da incassare', 7);
    server.next.push(videata('documentiDetail', 'S1-6', CRUMBS));
    await handleAction()('Detail', { navpath: 'S1-5.0' });
    await settle();
    expect(collegamento(), 'sul dettaglio').toBeDefined();
    server.next.push(videata('documentiList', 'S1-5'));
    await handleAction()('BackTo', { navpath: 'S1-5' });
    await settle();
    expect(collegamento(), 'tornati alla lista').toBeDefined();
    expect(nome(collegamento()!)).toContain('Fatture da incassare');
  });

  it('una scheda entrata dal MENU (dalla Home) non mostra il collegamento', async () => {
    server.next.push(videata('clientiList', 'S1-5'));
    render();
    await handleMenuClick()('menu.clienti', 'Clienti');
    await settle();
    expect(home()).toBeUndefined();
    expect(scheda().label).toBe('Clienti');
    expect(collegamento()).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────── R1: quando il ricordo si perde
describe('SXADV-5999.3 R1: un altro ingresso di primo livello toglie il ricordo', () => {
  it('voce di menu sulla stessa scheda', async () => {
    await navigaDallaHome('Fatture da incassare', 7);
    server.next.push(videata('clientiList', 'S1-8'));
    await handleMenuClick()('menu.clienti', 'Clienti');
    await settle();
    expect(scheda().label).toBe('Clienti');
    expect(collegamento()).toBeUndefined();
    expect(scheda().daWidget).toBeUndefined();
  });

  it('funzione per azione (openFunctionByAction senza widget)', async () => {
    await navigaDallaHome('Fatture da incassare', 7);
    server.next.push(videata('profiliMenuList', 'S1-8'));
    expect(openFunctionByAction()('Gestione Profili Menu', 'ProfileManager', { navpath: 'menu' })).toBe(true);
    await settle();
    expect(scheda().functionAction).toBe('ProfileManager');
    expect(collegamento()).toBeUndefined();
  });

  it('documentale (openCdmsView)', async () => {
    await navigaDallaHome('Fatture da incassare', 7);
    server.next.push(videata('cdmsRisorseListCestino', 'S1-8'));
    openCdmsView()('cdmsRisorseListCestino', 'Cestino');
    await settle();
    expect(scheda().label).toBe('Cestino');
    expect(collegamento()).toBeUndefined();
  });

  it('cambio azienda/sede (resetToHome): tornati a lavorare, nessun collegamento', async () => {
    await navigaDallaHome('Fatture da incassare', 7);
    await changeContext()('CambioAzienda', '45');
    await settle();
    expect(home(), 'dopo il cambio si e\' sulla Home').toBeDefined();
    expect(schede().every((t) => !t.daWidget)).toBe(true);
    await vaiAllaScheda('tab_1');
    expect(collegamento()).toBeUndefined();
  });

  it('un secondo ingresso da un ALTRO widget lo sostituisce col nuovo', async () => {
    await navigaDallaHome('Fatture da incassare', 7);
    await cliccaCasetta();
    await rigaDallaHome('Ordini aperti', 9);
    const c = collegamento();
    expect(c).toBeDefined();
    expect(nome(c!)).toContain('Ordini aperti');
    expect(nome(c!)).not.toContain('Fatture da incassare');
    expect(scheda().daWidget).toEqual({ idWidget: 9, titolo: 'Ordini aperti' });
  });

  it('dopo un ingresso da widget, uno dal menu dalla Home toglie il ricordo', async () => {
    await navigaDallaHome('Fatture da incassare', 7);
    await cliccaCasetta();
    server.next.push(videata('clientiList', 'S1-8'));
    await handleMenuClick()('menu.clienti', 'Clienti');
    await settle();
    expect(home()).toBeUndefined();
    expect(collegamento()).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────── R1: undoMenuChange lo conserva
describe('SXADV-5999.3 R1: ingresso di menu annullato -> la scheda resta col suo widget', () => {
  const MODIFICHE: ErrorItem = {
    type: 'CONFIRMATION',
    message: 'Ci sono modifiche non salvate. Si desidera vengano annullate TUTTE le modifiche?',
    mnemonic: 'CANCEL_ALL_CHANGES',
  } as ErrorItem;

  it('conferma «annullare le modifiche?» rifiutata: titolo e collegamento quelli di prima', async () => {
    await navigaDallaHome('Fatture da incassare', 7);
    const prima = scheda().label;
    dialogs.shown = [];
    server.next.push({ errors: [MODIFICHE] });
    await handleMenuClick()('menu.clienti', 'Clienti');
    await settle();
    const conferma = dialogs.shown.find((d) => d.errors.some((e) => e.type === 'CONFIRMATION'));
    expect(conferma, 'la finestra di conferma').toBeDefined();
    conferma!.handlers.onCancel?.();
    await settle();
    expect(scheda().label).toBe(prima);
    expect(scheda().daWidget).toEqual({ idWidget: 7, titolo: 'Fatture da incassare' });
    const c = collegamento();
    expect(c, 'il collegamento c\'e\' ancora').toBeDefined();
    expect(nome(c!)).toContain('Fatture da incassare');
  });

  it('richiesta di menu fallita: il widget resta', async () => {
    await navigaDallaHome('Fatture da incassare', 7);
    server.next.push(new Error('rete'));
    await handleMenuClick()('menu.clienti', 'Clienti');
    await settle();
    expect(dialogs.failures).toHaveLength(1);
    expect(collegamento()).toBeDefined();
  });
});

// ─────────────────────────────────────────────────── R1: il ricordo e' per scheda
describe('SXADV-5999.3 R1: il ricordo e\' per scheda', () => {
  it('una scheda nuova non ha il collegamento; tornando alla prima c\'e\' ancora', async () => {
    await navigaDallaHome('Fatture da incassare', 7);
    (tabsBar()!.props.onEdit as (k: unknown, a: 'add' | 'remove') => void)('', 'add');
    await settle();
    expect(schede().length).toBe(2);
    const nuova = schede()[1];
    expect(nuova.daWidget).toBeUndefined();
    expect(collegamento()).toBeUndefined();
    await vaiAllaScheda('tab_1');
    expect(collegamento()).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────── R3: il ritorno
describe('SXADV-5999.3 R3: clic su «Torna al widget»', () => {
  it('porta alla Home, chiedendole di mostrare QUEL widget', async () => {
    await navigaDallaHome('Fatture da incassare', 7);
    await cliccaCollegamento();
    const h = home();
    expect(h, 'la Home a video').toBeDefined();
    expect(homeProps().mostraWidget).toBe(7);
  });

  it('non manda nessuna richiesta, e la scheda di lavoro resta com\'era', async () => {
    await navigaDallaHome('Fatture da incassare', 7);
    const ui = scheda().ui;
    const label = scheda().label;
    const n = richieste();
    await cliccaCollegamento();
    expect(richieste()).toBe(n);
    expect(scheda().ui).toBe(ui);
    expect(scheda().label).toBe(label);
  });

  it('il ritorno non cambia il ricordo: tornando alla scheda dalla barra, il collegamento c\'e\' ancora', async () => {
    await navigaDallaHome('Fatture da incassare', 7);
    const ui = scheda().ui;
    await cliccaCollegamento();
    await vaiAllaScheda('tab_1');
    expect(home()).toBeUndefined();
    expect(scheda().ui, 'la scheda si ritrova uguale').toBe(ui);
    const c = collegamento();
    expect(c).toBeDefined();
    expect(nome(c!)).toContain('Fatture da incassare');
  });

  it('dal dettaglio di una riga: torna allo stesso widget', async () => {
    await rigaDallaHome('Ordini aperti', 9);
    await cliccaCollegamento();
    expect(homeProps().mostraWidget).toBe(9);
  });
});

describe('SXADV-5999.3 R3: la casetta resta com\'e\' oggi', () => {
  it('dalla scheda entrata da un widget, la casetta apre la Home senza widget da mostrare', async () => {
    await navigaDallaHome('Fatture da incassare', 7);
    await cliccaCasetta();
    expect(home()).toBeDefined();
    expect(homeProps().mostraWidget ?? null).toBeNull();
  });

  it('il ritorno al widget non resta armato: dopo, la casetta non riporta al widget', async () => {
    await navigaDallaHome('Fatture da incassare', 7);
    await cliccaCollegamento();
    expect(homeProps().mostraWidget).toBe(7);
    await vaiAllaScheda('tab_1');
    await cliccaCasetta();
    expect(home()).toBeDefined();
    expect(homeProps().mostraWidget ?? null).toBeNull();
  });

  it('cambio azienda/sede stando sulla Home dopo il ritorno: la Home nuova non cerca il widget', async () => {
    await navigaDallaHome('Fatture da incassare', 7);
    await cliccaCollegamento();
    expect(homeProps().mostraWidget).toBe(7);
    await changeContext()('CambioAzienda', '45');
    await settle();
    expect(home()).toBeDefined();
    expect(homeProps().mostraWidget ?? null).toBeNull();
  });

  // Il contratto nomina la casetta; la scheda «Home» della barra delle schede e' l'altro
  // ritorno alla Home di oggi, e vale lo stesso: il ritorno non resta armato.
  it('nemmeno passando alla Home dalla barra delle schede', async () => {
    await navigaDallaHome('Fatture da incassare', 7);
    await cliccaCollegamento();
    await vaiAllaScheda('tab_1');
    await vaiAllaScheda('home');
    expect(home()).toBeDefined();
    expect(homeProps().mostraWidget ?? null).toBeNull();
  });
});
