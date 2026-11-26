import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import type { ErrorItem, UITree } from '../types/ui';

// SXADV-6301 — ritorno dalla catenella (BackTo) con modifiche non salvate.
//
// Prima nota > documento > Reg. contabili > Nuovo (pannello di riga) > un
// Sottoconto > clic su «Prima nota - Lista» nella catenella. Il server
// risponde con una CONFIRMATION SAVE_BEFORE_NEW («Ci sono modifiche non
// salvate. Si desidera vengano annullate TUTTE le modifiche?») e NON si muove.
//
// Il contratto lato client:
//   - la domanda si mostra (finestra di conferma con i gestori OK/Annulla);
//   - OK rigioca la STESSA richiesta BackTo (stessi navpath, option1, postPath)
//     con `messages` che contiene "SAVE_BEFORE_NEW,"; la catenella si accorcia
//     solo quando arriva la risposta finale (quella che si e' mossa), non prima;
//   - Annulla non manda niente: catenella, valori digitati e riga del pannello
//     restano;
//   - dopo un Annulla, una risposta qualsiasi che arriva dopo (un Post, un
//     Refresh...) non applica il ritorno rifiutato.
//
// Motore di hook di Shell.homeScroll.sxadv6124.test.tsx (stato, ref, memo ed
// effetti veri, figli non eseguiti), feedback finto di
// Shell.menuConfirm.sxadv5952.test.tsx: "premere OK" = onAnswer, "premere
// Annulla" = onCancel. Il clic sulla briciola e' il vero onClick dell'<a> che
// la Shell disegna nella catenella.

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

// Il feedback: le finestre non si disegnano, se ne tengono i gestori.
type Handlers = { onCancel?: () => void; onAnswer?: (prompt: ErrorItem, answer: 'yes' | 'no') => void };
const dialogs = vi.hoisted(() => ({
  shown: [] as { errors: ErrorItem[]; handlers: Handlers }[],
  failures: [] as unknown[],
}));
vi.mock('../hooks/feedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/feedback')>()),
  useFeedback: () => ({
    showServerMessages: (errors: ErrorItem[], handlers: Handlers = {}) => { dialogs.shown.push({ errors, handlers }); },
    error: () => {}, warning: () => {}, info: () => {},
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
  postAction: [] as { action: string; params: Record<string, string>; fv?: Record<string, string | string[]>; sid?: string }[],
  postAction2: [] as { action: string; params: Record<string, string> }[],
  menu: [] as { menuId: string; sid?: string; extra?: Record<string, string> }[],
  next: [] as unknown[],
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  postAction: async (action: string, params: Record<string, string>, fv?: Record<string, string | string[]>, sid?: string) => {
    server.postAction.push({ action, params: { ...params }, fv: fv && { ...fv }, sid });
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
const { clearTemplates } = await import('../services/templateCache');

// Il minimo di browser che Shell e i suoi effetti toccano. DOPO gli import.
const noop = () => {};
const g = globalThis as Record<string, unknown>;
g.document ??= {
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
g.window ??= globalThis;
g.addEventListener ??= noop;
g.removeEventListener ??= noop;
g.requestAnimationFrame = () => 0;
g.cancelAnimationFrame = noop;
g.matchMedia ??= () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop });
g.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
g.MutationObserver ??= class { observe() {} disconnect() {} takeRecords() { return []; } };
g.getComputedStyle ??= () => ({ getPropertyValue: () => '', paddingTop: '0', paddingBottom: '0', marginTop: '0', marginBottom: '0', overflow: 'auto', overflowY: 'auto', overflowX: 'auto' });
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
// Le briciole del server sono HTML e la Shell le legge con DOMParser: basta
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

/** Tutti gli elementi raggiungibili dall'albero restituito (anche `items` di Breadcrumb). */
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
    for (const [k, v] of Object.entries(rest)) {
      if (k === 'ui' || k === 'loginInfo' || k === 'info' || k === 'style') continue;
      if (v && typeof v === 'object') elements(v, out, seen);
    }
    elements(children, out, seen);
    return out;
  }
  if (Object.getPrototypeOf(node) === Object.prototype) {
    for (const v of Object.values(node)) elements(v, out, seen);
  }
  return out;
}

const evento = { preventDefault: () => {}, stopPropagation: () => {} };

/** Le briciole cliccabili a video, nell'ordine. */
function briciole(): El[] {
  return elements(tree).filter((e) =>
    typeof e.props.onClick === 'function'
    && /breadcrumb(-back)?-link/.test(String(e.props.className ?? ''))
    && !/torna-al-widget/.test(String(e.props.className ?? '')));
}
const titoliBriciole = () => briciole().map((e) => String(e.props.title));

const handler = <F,>(marker: string): F => {
  const found = rt.callbacks.filter((f) => f.toString().includes(marker));
  if (found.length !== 1) throw new Error(`gestore "${marker}": trovati ${found.length}`);
  return found[0] as unknown as F;
};
const handleAction = () =>
  handler<(action: string, params?: Record<string, string>) => Promise<void>>('serverParams.hasTemplate = ');
const handleMenuClick = () =>
  handler<(menuId: string, label: string) => Promise<void>>('executeMenuItem(menuId, tab.sid)');
const handleFieldChange = () =>
  handler<(name: string, value: unknown, caption?: unknown) => void>('dirtyFieldsRef.current.add(name)');
const handleEditRow = () =>
  handler<(navpath: string | null) => void>('editNavpathRef.current = navpath');

type Tab = {
  key: string; sid: string; label: string; loading?: boolean; templateKey?: string;
  ui?: UITree & { breadcrumbs?: string; viewName?: string };
  formValues: Record<string, string | string[]>;
};
function tab(): Tab {
  const s = rt.slots.find((x) => Array.isArray(x.v) && (x.v as { key?: string }[])[0]?.key === 'tab_1');
  return (s!.v as Tab[])[0];
}

// ───────────────────────────────────────────────────────────── risposte tipo
const LIST_KEY = 'docPrimaNotaList:1';
const DETAIL_KEY = 'docPrimaNotaDetail:2';
const QUERY_KEY = 'docPrimaNotaQuery:0';

const CRUMB_QUERY =
  '<span class="breadcrumbElement" title="Prima nota - Interrogazione" onclick="doAction(\'BackTo\',\'S1-0\',\'0\')">Prima nota - Interrogazione</span>';
const CRUMB_LIST =
  '<span class="breadcrumbElement" title="Prima nota - Lista" onclick="doAction(\'BackTo\',\'S1-0\',\'1\')">Prima nota - Lista</span>';

function template(viewName: string, viewType: string, pageType: number, path: string): UITree {
  return {
    rows: [{ id: 'r0', cells: [{ elementType: 1, control: { name: 'descrizione', id: 'descrizione', type: 'text', editable: true } }] }],
    pageType,
    path,
    viewName,
    viewType,
  } as unknown as UITree;
}

/** METADATA+DATA con le briciole della pagina. */
function metadata(key: string, viewName: string, viewType: string, pageType: number, path: string, crumbs: string) {
  return {
    templateKey: key,
    template: template(viewName, viewType, pageType, path),
    values: { descrizione: 'test' },
    dynProps: {},
    bindings: { '': path },
    scopePaths: { '': path },
    breadcrumbs: crumbs,
    toolbar: [],
  };
}

/** La risposta di una BackTo andata a buon fine: DATA-only su un template in cache. */
function dataOnly(key: string, path: string) {
  return { ui: { dataOnly: true, templateKey: key, values: { descrizione: 'test' }, dynProps: {} }, bindings: { '': path }, scopePaths: { '': path }, toolbar: [] };
}

const MODIFICHE: ErrorItem = {
  type: 'CONFIRMATION',
  message: 'Ci sono modifiche non salvate. Si desidera vengano annullate TUTTE le modifiche?',
  mnemonic: 'SAVE_BEFORE_NEW',
} as ErrorItem;

/** Interrogazione dal menu, lista (Esegui), documento (dettaglio). */
async function apriDocumento(): Promise<void> {
  server.next.push(metadata(QUERY_KEY, 'docPrimaNotaQuery', 'query', 0, 'S1-0', ''));
  render();
  await handleMenuClick()('menu.ctb.docPrimaNotaQuery', 'Prima nota');
  await settle();
  server.next.push(metadata(LIST_KEY, 'docPrimaNotaList', 'list', 1, 'S1-0', CRUMB_QUERY));
  await handleAction()('ExecuteQuery', {});
  await settle();
  server.next.push(metadata(DETAIL_KEY, 'docPrimaNotaDetail', 'detail', 2, 'S1-0.1', CRUMB_QUERY + CRUMB_LIST));
  await handleAction()('NavigateDetail', { navpath: 'S1-0.1' });
  await settle();
  expect(tab().templateKey).toBe(DETAIL_KEY);
  expect(titoliBriciole()).toEqual(['Prima nota - Interrogazione', 'Prima nota - Lista']);
}

/** Il rigo nuovo nel pannello (S1-9.1) col Sottoconto scelto e gia' partito, piu' la Descrizione di testata digitata. */
function modificheInSospeso(): void {
  handleEditRow()('S1-9.1');
  handleFieldChange()('descrizione.S1-0.1', 'test 6301');
  render();
}

/** Clic sulla briciola col titolo dato; il server risponde `resp`. */
async function cliccaBriciola(titolo: string, resp: unknown): Promise<void> {
  const b = briciole().find((e) => e.props.title === titolo);
  expect(b, `la briciola «${titolo}»`).toBeDefined();
  server.next.push(resp);
  (b!.props.onClick as (e: unknown) => void)(evento);
  await settle();
}

function laDomanda(): Handlers {
  const d = dialogs.shown.find((x) => x.errors.some((e) => e.type === 'CONFIRMATION' && e.mnemonic === 'SAVE_BEFORE_NEW'));
  expect(d, 'la finestra di conferma «modifiche non salvate»').toBeDefined();
  return d!.handlers;
}

const backTos = () => server.postAction.filter((r) => r.action === 'BackTo');

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
  clearTemplates();
  render();
  await settle();
  // Si parte dalla Home (SXADV-62): la scheda di lavoro diventa quella attiva.
  const active = rt.slots.find((s) => s.v === 'home');
  if (active) active.v = 'tab_1';
  render();
});

// ────────────────────────────────────────────────────────────── la domanda
describe('SXADV-6301: BackTo dalla catenella che riceve CONFIRMATION SAVE_BEFORE_NEW', () => {
  it('mostra la domanda «modifiche non salvate» e la catenella resta com\'era', async () => {
    await apriDocumento();
    modificheInSospeso();
    const prima = tab().ui?.breadcrumbs;
    await cliccaBriciola('Prima nota - Lista', { errors: [MODIFICHE] });
    expect(backTos()).toHaveLength(1);
    expect(backTos()[0].params).toMatchObject({ navpath: 'S1-0', option1: '1' });
    laDomanda();
    expect(tab().ui?.breadcrumbs).toBe(prima);
    expect(titoliBriciole()).toEqual(['Prima nota - Interrogazione', 'Prima nota - Lista']);
    expect(tab().templateKey).toBe(DETAIL_KEY);
    expect(tab().loading).toBeFalsy();
  });

  it('la BackTo porta i valori digitati e la riga del pannello (postPath)', async () => {
    await apriDocumento();
    modificheInSospeso();
    await cliccaBriciola('Prima nota - Lista', { errors: [MODIFICHE] });
    const sent = backTos()[0];
    expect(sent.params.postPath).toBe('S1-9.1');
    expect(sent.fv).toMatchObject({ 'descrizione.S1-0.1': 'test 6301' });
  });
});

// ─────────────────────────────────────────────────────────────── OK
describe('SXADV-6301: OK sulla domanda -> la STESSA BackTo rigiocata con messages', () => {
  it('rigioca BackTo con stessi navpath/option1/postPath e messages che contiene SAVE_BEFORE_NEW,', async () => {
    await apriDocumento();
    modificheInSospeso();
    await cliccaBriciola('Prima nota - Lista', { errors: [MODIFICHE] });
    const primo = backTos()[0].params;
    server.next.push(dataOnly(LIST_KEY, 'S1-0'));
    laDomanda().onAnswer?.(MODIFICHE, 'yes');
    await settle();
    expect(backTos()).toHaveLength(2);
    const rigioco = backTos()[1].params;
    expect(rigioco.navpath).toBe(primo.navpath);
    expect(rigioco.option1).toBe(primo.option1);
    expect(rigioco.postPath).toBe(primo.postPath);
    expect(rigioco.messages ?? '').toContain('SAVE_BEFORE_NEW,');
    // nessun'altra richiesta in mezzo (niente Post, niente menu)
    expect(server.postAction.map((r) => r.action).slice(-2)).toEqual(['BackTo', 'BackTo']);
    expect(server.menu).toHaveLength(1);
  });

  it('la catenella si accorcia solo con la risposta finale, non prima', async () => {
    await apriDocumento();
    modificheInSospeso();
    const prima = tab().ui?.breadcrumbs;
    await cliccaBriciola('Prima nota - Lista', { errors: [MODIFICHE] });
    expect(tab().ui?.breadcrumbs).toBe(prima);
    // Il rigioco resta in volo finche' non si risolve la promessa.
    let rispondi: (r: unknown) => void = () => {};
    const inVolo = new Promise((res) => { rispondi = res; });
    server.next.push(undefined);
    const api = await import('../services/api');
    const spy = vi.spyOn(api, 'postAction').mockImplementationOnce(async (action, params, fv, sid) => {
      server.postAction.push({ action, params: { ...(params ?? {}) }, fv: fv && { ...fv }, sid });
      return (await inVolo) as never;
    });
    laDomanda().onAnswer?.(MODIFICHE, 'yes');
    await settle();
    expect(tab().ui?.breadcrumbs, 'prima della risposta la catenella non cambia').toBe(prima);
    rispondi(dataOnly(LIST_KEY, 'S1-0'));
    await settle();
    spy.mockRestore();
    expect(tab().templateKey).toBe(LIST_KEY);
    expect(tab().ui?.breadcrumbs).toBe(CRUMB_QUERY);
    expect(titoliBriciole()).toEqual(['Prima nota - Interrogazione']);
    expect(tab().loading).toBeFalsy();
  });

  it('OK, il rigioco chiede di nuovo: la catenella resta ancora, poi si accorcia alla risposta finale', async () => {
    await apriDocumento();
    modificheInSospeso();
    const prima = tab().ui?.breadcrumbs;
    await cliccaBriciola('Prima nota - Lista', { errors: [MODIFICHE] });
    const ALTRA: ErrorItem = { type: 'CONFIRMATION', message: 'Altra domanda?', mnemonic: 'ALTRA' } as ErrorItem;
    server.next.push({ errors: [ALTRA] });
    laDomanda().onAnswer?.(MODIFICHE, 'yes');
    await settle();
    expect(tab().ui?.breadcrumbs).toBe(prima);
    const seconda = dialogs.shown.find((d) => d.errors.some((e) => e.mnemonic === 'ALTRA'));
    expect(seconda).toBeDefined();
    server.next.push(dataOnly(LIST_KEY, 'S1-0'));
    seconda!.handlers.onAnswer?.(ALTRA, 'yes');
    await settle();
    const ultimo = backTos().at(-1)!.params;
    expect(ultimo.messages ?? '').toContain('SAVE_BEFORE_NEW,');
    expect(ultimo.messages ?? '').toContain('ALTRA,');
    expect(tab().ui?.breadcrumbs).toBe(CRUMB_QUERY);
  });

  it('ritorno all\'Interrogazione: OK rigioca BackTo con option1=0 e la catenella si svuota', async () => {
    await apriDocumento();
    modificheInSospeso();
    await cliccaBriciola('Prima nota - Interrogazione', { errors: [MODIFICHE] });
    expect(backTos()[0].params).toMatchObject({ navpath: 'S1-0', option1: '0' });
    server.next.push(dataOnly(QUERY_KEY, 'S1-0'));
    laDomanda().onAnswer?.(MODIFICHE, 'yes');
    await settle();
    const rigioco = backTos()[1].params;
    expect(rigioco).toMatchObject({ navpath: 'S1-0', option1: '0' });
    expect(rigioco.messages ?? '').toContain('SAVE_BEFORE_NEW,');
    expect(titoliBriciole()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────── Annulla
describe('SXADV-6301: Annulla sulla domanda -> niente ritorno', () => {
  it('non manda niente e la catenella resta', async () => {
    await apriDocumento();
    modificheInSospeso();
    const prima = tab().ui?.breadcrumbs;
    await cliccaBriciola('Prima nota - Lista', { errors: [MODIFICHE] });
    const n = server.postAction.length;
    laDomanda().onCancel?.();
    await settle();
    expect(server.postAction).toHaveLength(n);
    expect(server.menu).toHaveLength(1);
    expect(tab().ui?.breadcrumbs).toBe(prima);
    expect(tab().templateKey).toBe(DETAIL_KEY);
    expect(tab().loading).toBeFalsy();
  });

  it('i valori digitati e la riga del pannello restano per l\'azione successiva', async () => {
    await apriDocumento();
    modificheInSospeso();
    await cliccaBriciola('Prima nota - Lista', { errors: [MODIFICHE] });
    laDomanda().onCancel?.();
    await settle();
    server.next.push({});
    await handleAction()('Post', {});
    await settle();
    const sent = server.postAction.at(-1)!;
    expect(sent.action).toBe('Post');
    expect(sent.params.navpath).toBe('S1-9.1');
    expect(sent.fv).toMatchObject({ 'descrizione.S1-0.1': 'test 6301' });
  });

  it('una risposta successiva qualsiasi (DATA-only sul documento) non applica il ritorno rifiutato', async () => {
    await apriDocumento();
    modificheInSospeso();
    const prima = tab().ui?.breadcrumbs;
    await cliccaBriciola('Prima nota - Lista', { errors: [MODIFICHE] });
    laDomanda().onCancel?.();
    await settle();
    // Un Refresh del documento: risposta DATA-only sullo stesso template.
    server.next.push(dataOnly(DETAIL_KEY, 'S1-0.1'));
    await handleAction()('Refresh', {});
    await settle();
    expect(tab().templateKey).toBe(DETAIL_KEY);
    expect(tab().ui?.breadcrumbs).toBe(prima);
    expect(titoliBriciole()).toEqual(['Prima nota - Interrogazione', 'Prima nota - Lista']);
  });

  it('una risposta successiva qualsiasi (Post senza videata) non applica il ritorno rifiutato', async () => {
    await apriDocumento();
    modificheInSospeso();
    const prima = tab().ui?.breadcrumbs;
    await cliccaBriciola('Prima nota - Lista', { errors: [MODIFICHE] });
    laDomanda().onCancel?.();
    await settle();
    server.next.push(dataOnly(DETAIL_KEY, 'S1-0.1'));
    await handleAction()('Post', { navpath: 'S1-0.1' });
    await settle();
    expect(tab().ui?.breadcrumbs).toBe(prima);
  });
});

// ─────────────────────────────────────────────────────── contro-casi (oggi)
describe('SXADV-6301: contro-casi che non cambiano', () => {
  it('sessione pulita: il server si muove subito, la catenella si accorcia, nessuna domanda', async () => {
    await apriDocumento();
    await cliccaBriciola('Prima nota - Lista', dataOnly(LIST_KEY, 'S1-0'));
    expect(backTos()).toHaveLength(1);
    expect(backTos()[0].params.messages).toBeUndefined();
    expect(dialogs.shown.filter((d) => d.errors.length > 0)).toHaveLength(0);
    expect(tab().templateKey).toBe(LIST_KEY);
    expect(titoliBriciole()).toEqual(['Prima nota - Interrogazione']);
  });

  it('transazione annidata sporca: errore SAVE_BEFORE_NEW_ERR, la catenella resta e un Refresh dopo non la accorcia', async () => {
    await apriDocumento();
    modificheInSospeso();
    const prima = tab().ui?.breadcrumbs;
    const ERR: ErrorItem = { type: 'ERROR', message: 'Salvare o annullare le modifiche prima di proseguire', mnemonic: 'SAVE_BEFORE_NEW_ERR' } as ErrorItem;
    await cliccaBriciola('Prima nota - Lista', { errors: [ERR] });
    expect(tab().ui?.breadcrumbs).toBe(prima);
    server.next.push(dataOnly(DETAIL_KEY, 'S1-0.1'));
    await handleAction()('Refresh', {});
    await settle();
    expect(tab().ui?.breadcrumbs).toBe(prima);
  });
});
