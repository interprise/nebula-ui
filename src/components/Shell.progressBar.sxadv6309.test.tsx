import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import type { LoginInfo, MenuItem } from '../types/ui';

// SXADV-6309: una funzione lunga (un Bilancio) che gira come job asincrono
// mostra sul velo della scheda "0%" per tutta l'attesa, anche per minuti:
// l'utente pensa che l'applicativo sia bloccato.
//
// Fonte di verita': il client ExtJS (ui.js, handleErrors). Il comando che parte
// come job risponde { uiData: { trackAsynchJob, showProgress, progress? }, sid }
// senza `ui`; `uiData.progress === true` arriva SOLO se il comando gestisce una
// percentuale vera. Poi il client interroga JSONProgress (api.checkProgress),
// che risponde { trackAsynchJob: true, progress: n } finche' il job gira (n = 0
// se nessuno lo aggiorna) e la pagina finale quando ha finito.
//   - showProgress && uiData.progress === true -> barra con "n%" a ogni giro;
//   - altrimenti -> attesa indeterminata, SENZA percentuale, qualunque sia il
//     `progress` che il polling riporta.
//
// Motore di Shell.chiudiScheda.test.tsx: la Shell si esegue come funzione, gli
// effetti girano davvero. Il velo e' l'elemento LoadingOverlay che la Shell
// mette nel suo albero; per leggerne il testo lo si esegue con lo stesso motore
// (stato e timer suoi, conservati finche' l'elemento resta nell'albero: e' il
// suo "montaggio") e se ne rende l'uscita in markup statico. Il motore non
// distingue un rimontaggio per cambio di chiave/posizione: un velo che resta
// nell'albero conta come lo stesso velo.
//
// Timer finti (setTimeout/clearTimeout): il polling del job aspetta fra un
// giro e l'altro, e il messaggio dei 30 secondi del velo e' un timer.

const rt = vi.hoisted(() => ({
  active: false,
  i: 0,
  dirty: false,
  slots: [] as { v: unknown; set?: unknown }[],
  effects: [] as { st: { first: boolean; deps?: unknown[]; cleanup?: unknown }; fn: () => unknown; deps?: unknown[] }[],
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
    const s = slot(() => ({ first: true, deps: undefined, cleanup: undefined }));
    const st = s.v as { first: boolean; deps?: unknown[]; cleanup?: unknown };
    if (st.first || !deps || !same(st.deps, deps)) rt.effects.push({ st, fn, deps });
  }) as AnyFn;
  const memo = (f: () => unknown, deps?: unknown[]) => {
    const s = slot(() => ({ deps: undefined, val: undefined, ok: false }));
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
    useCallback: on(actual.useCallback as AnyFn, ((fn: AnyFn, deps?: unknown[]) => memo(() => fn, deps)) as AnyFn),
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

vi.mock('../hooks/feedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/feedback')>()),
  useFeedback: () => ({
    showServerMessages: () => {},
    error: () => {},
    warning: () => {},
    info: () => {},
    failure: () => {},
    confirm: () => {},
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
vi.mock('./BannerCard', () => ({ default: () => null }));
vi.mock('./CdmsTree', () => ({ default: () => null }));

const server = vi.hoisted(() => ({
  /** Risposta di ExecuteMenuItem per voce di menu (default: una pagina qualunque). */
  menu: new Map<string, unknown>(),
  /** Risposte di JSONProgress, in fila. Fila vuota = il giro resta in volo (il job gira ancora)
   *  finche' il caso non ne prepara una. */
  progress: [] as unknown[],
  /** Il giro in volo, in attesa di una risposta. */
  inVolo: null as null | ((r: unknown) => void),
  progressCalls: 0,
  /** Risposte di JSONProgress consegnate alla Shell. */
  serviti: 0,
  progressSids: [] as string[],
}));

vi.mock('../services/api', async (importOriginal) => {
  const pagina = (viewName: string, title: string) => ({
    ui: { rows: [], path: `${viewName}-path`, pageType: 1, viewName, title },
    toolbar: [],
    uiData: {},
  });
  return {
    ...(await importOriginal<typeof import('../services/api')>()),
    postAction: async (action: string, params: Record<string, string> = {}) =>
      pagina(params.viewName ?? action, params.title ?? action),
    executeMenuItem: async (menuId: string) => server.menu.get(menuId) ?? pagina(menuId, menuId),
    postAction2: async () => ({}),
    checkProgress: (sid = 'S1') => {
      server.progressCalls++;
      server.progressSids.push(sid);
      if (server.progress.length === 0) {
        return new Promise((r) => { server.inVolo = (x) => { server.serviti++; r(x); }; });
      }
      server.serviti++;
      return Promise.resolve(server.progress.shift());
    },
    subscribeInFlight: () => () => {},
  };
});

vi.mock('../services/notifications', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>().catch(() => ({}));
  return { ...actual, notify: () => {} };
});

const { default: Shell } = await import('./Shell');
const { default: LoadingOverlay } = await import('./LoadingOverlay');
const { renderToStaticMarkup } = await import('react-dom/server');

const noop = () => {};
const g = globalThis as Record<string, unknown>;
class FakeHTMLElement {}
g.HTMLElement ??= FakeHTMLElement;
g.Element ??= FakeHTMLElement;
g.window ??= globalThis;
g.addEventListener ??= noop;
g.removeEventListener ??= noop;
g.requestAnimationFrame = () => 0;
g.cancelAnimationFrame = noop;
g.document ??= {
  body: { style: {}, classList: { add: noop, remove: noop, contains: () => false } },
  documentElement: { style: {}, classList: { add: noop, remove: noop, contains: () => false } },
  visibilityState: 'visible',
  hidden: false,
  activeElement: null,
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: noop,
  removeEventListener: noop,
  createElement: () => ({ style: {} }),
};
// Il markup statico del velo passa da antd cssinjs, che vede un "DOM" (il finto
// qui sopra) e ci appoggia un nodo di prova: gli basta che le chiamate esistano.
{
  const body = (g.document as { body: Record<string, unknown> }).body;
  body.appendChild ??= noop;
  body.removeChild ??= noop;
  g.getComputedStyle ??= () => ({ content: '' });
}
{
  const mem = new Map<string, string>();
  g.localStorage ??= {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
  };
}

// ─────────────────────────────────────────────────────────────── il motore

const MENU: MenuItem[] = [
  { id: 'menu.bil', description: 'Bilancio', leaf: true },
  { id: 'menu.bil2', description: 'Bilancio di verifica', leaf: true },
];
const LOGIN: LoginInfo = { login: '44AMM' } as LoginInfo;

type El = ReactElement<Record<string, unknown>>;
type Props = { menuItems: MenuItem[]; loginInfo: LoginInfo; onLogout: () => void; onReloadMenu: () => void };

const props: Props = { menuItems: MENU, loginInfo: LOGIN, onLogout: noop, onReloadMenu: noop };
let tree: unknown = null;

type Effetto = (typeof rt.effects)[number];

function eseguiEffetti(lista: Effetto[]): void {
  for (const e of lista) {
    if (typeof e.st.cleanup === 'function') (e.st.cleanup as () => void)();
    e.st.cleanup = e.fn();
    e.st.deps = e.deps;
    e.st.first = false;
  }
}

function disegna(): void {
  for (let giro = 0; giro < 40; giro++) {
    rt.dirty = false;
    rt.effects = [];
    rt.active = true;
    rt.i = 0;
    try {
      tree = (Shell as unknown as (p: Props) => unknown)(props);
    } finally {
      rt.active = false;
    }
    const daFare = rt.effects;
    rt.effects = [];
    eseguiEffetti(daFare);
    if (!rt.dirty) {
      osservaVelo();
      return;
    }
  }
  throw new Error('la Shell non si stabilizza');
}

function elements(node: unknown, out: El[] = [], visti = new Set<unknown>()): El[] {
  if (node == null || typeof node !== 'object' || visti.has(node)) return out;
  visti.add(node);
  if (Array.isArray(node)) {
    for (const n of node) elements(n, out, visti);
    return out;
  }
  const el = node as El & { $$typeof?: unknown };
  if (el.$$typeof && el.props) {
    out.push(el);
    for (const v of Object.values(el.props)) elements(v, out, visti);
    return out;
  }
  // Oggetti semplici (es. le voci `items` dei Tabs): si scende nei valori.
  if (Object.getPrototypeOf(node) === Object.prototype) {
    for (const v of Object.values(node)) elements(v, out, visti);
  }
  return out;
}

const find = (pred: (e: El) => boolean): El | undefined => elements(tree).find(pred);

// ── il velo: un'istanza di LoadingOverlay viva finche' l'elemento sta nell'albero

const velo = {
  slots: [] as { v: unknown; set?: unknown }[],
  effetti: [] as Effetto['st'][],
  uscita: null as unknown,
};

function smontaVelo(): void {
  for (const st of velo.effetti) if (typeof st.cleanup === 'function') (st.cleanup as () => void)();
  velo.slots = [];
  velo.effetti = [];
  velo.uscita = null;
}

/** Esegue il velo con le props che la Shell gli passa ora (o lo smonta se non c'e'). */
function osservaVelo(): void {
  const el = find((e) => e.type === LoadingOverlay);
  if (!el) {
    smontaVelo();
    return;
  }
  const salva = { slots: rt.slots, i: rt.i, effects: rt.effects, dirty: rt.dirty };
  try {
    for (let giro = 0; giro < 10; giro++) {
      rt.slots = velo.slots;
      rt.effects = [];
      rt.dirty = false;
      rt.i = 0;
      rt.active = true;
      try {
        velo.uscita = (LoadingOverlay as unknown as (p: unknown) => unknown)(el.props);
      } finally {
        rt.active = false;
      }
      const daFare = rt.effects;
      rt.effects = [];
      for (const e of daFare) if (!velo.effetti.includes(e.st)) velo.effetti.push(e.st);
      eseguiEffetti(daFare);
      if (!rt.dirty) break;
    }
  } finally {
    rt.slots = salva.slots;
    rt.i = salva.i;
    rt.effects = salva.effects;
    rt.dirty = salva.dirty;
  }
}

/** Il testo che l'utente legge sul velo della scheda; null se il velo non c'e'. */
function testoVelo(): string | null {
  osservaVelo();
  if (!find((e) => e.type === LoadingOverlay)) return null;
  const html = renderToStaticMarkup(velo.uscita as ReactElement);
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

const PERCENTUALE = /\d+\s*%/;

/** Lascia passare `ms` di tempo finto (timer e promesse), ridisegnando. */
async function passa(ms = 0): Promise<void> {
  const passo = 100;
  let fatto = 0;
  do {
    const d = Math.min(passo, ms - fatto);
    await vi.advanceTimersByTimeAsync(Math.max(d, 0));
    disegna();
    fatto += Math.max(d, 0);
  } while (fatto < ms);
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(0);
    disegna();
  }
}

/** Il prossimo giro di JSONProgress risponde `resp`: si aspetta che venga chiesto e applicato. */
async function giro(resp: unknown): Promise<void> {
  const prima = server.serviti;
  if (server.inVolo) {
    const r = server.inVolo;
    server.inVolo = null;
    r(resp);
  } else {
    server.progress.push(resp);
  }
  for (let t = 0; t < 120 && server.serviti <= prima; t++) await passa(100);
  expect(server.serviti, 'la Shell interroga JSONProgress').toBeGreaterThan(prima);
  await passa(0);
}

async function voceDiMenu(id: string): Promise<void> {
  const m = find((e) => 'inlineCollapsed' in e.props && Array.isArray(e.props.items));
  expect(m, 'il menu del gestionale').toBeDefined();
  (m!.props.onClick as (a: { key: string }) => void)({ key: id });
  await passa(0);
}

type Scheda = { key: string; sid: string; label: string; loading?: boolean; ui?: { viewName?: string }; formValues: Record<string, unknown> };
const schede = (): Scheda[] =>
  rt.slots.find((s) => Array.isArray(s.v) && (s.v as Scheda[])[0]?.sid !== undefined && (s.v as Scheda[])[0]?.formValues !== undefined)!.v as Scheda[];

/** La pagina finale del Bilancio. */
const BILANCIO = {
  ui: { rows: [], path: 'S1-3', pageType: 1, viewName: 'bilancioDetail', title: 'Bilancio' },
  toolbar: [],
  uiData: {},
};

const inCorso = (progress: number) => ({ trackAsynchJob: true, progress });

/** La voce di menu parte come job con questo uiData. */
function job(menuId: string, uiData: Record<string, unknown>): void {
  server.menu.set(menuId, { uiData, sid: 'S1' });
}

const SENZA_PERCENTUALE: [string, Record<string, unknown>][] = [
  ['showProgress senza uiData.progress', { trackAsynchJob: true, showProgress: true }],
  ['solo trackAsynchJob', { trackAsynchJob: true }],
];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  rt.slots = [];
  rt.effects = [];
  smontaVelo();
  server.menu.clear();
  server.progress.length = 0;
  server.progressCalls = 0;
  server.serviti = 0;
  server.inVolo = null;
  server.progressSids.length = 0;
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true, writable: true,
    value: { getItem: () => null, setItem: noop, removeItem: noop },
  });
  await passa(0);
});

afterEach(() => {
  smontaVelo();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────── le prove

describe('SXADV-6309 1-2. job senza percentuale gestita: attesa indeterminata, nessun "n%"', () => {
  it.each(SENZA_PERCENTUALE)('%s: il velo c\'e\' ma non mostra percentuali con progress 0 ripetuto', async (_n, uiData) => {
    job('menu.bil', uiData);
    await voceDiMenu('menu.bil');
    expect(testoVelo(), 'il velo della scheda mentre il job gira').not.toBeNull();
    expect(testoVelo()).not.toMatch(PERCENTUALE);
    for (let k = 0; k < 4; k++) {
      await giro(inCorso(0));
      const t = testoVelo();
      expect(t, `velo presente dopo il giro ${k + 1}`).not.toBeNull();
      expect(t, `nessuna percentuale dopo il giro ${k + 1}`).not.toMatch(PERCENTUALE);
    }
  });

  it.each(SENZA_PERCENTUALE)('%s: nessuna percentuale anche se il polling riporta progress 37', async (_n, uiData) => {
    job('menu.bil', uiData);
    await voceDiMenu('menu.bil');
    await giro(inCorso(37));
    expect(testoVelo(), 'il velo della scheda').not.toBeNull();
    expect(testoVelo()).not.toMatch(PERCENTUALE);
    await giro(inCorso(37));
    expect(testoVelo()).not.toMatch(PERCENTUALE);
  });

  it('il polling interroga la sessione del job', async () => {
    job('menu.bil', { trackAsynchJob: true, showProgress: true });
    await voceDiMenu('menu.bil');
    await giro(inCorso(0));
    expect(server.progressSids.every((s) => s === 'S1')).toBe(true);
  });
});

describe('SXADV-6309 3. job con uiData.progress === true: barra con la percentuale', () => {
  it('dopo un giro con 37 si legge "37%", dopo uno con 60 si legge "60%"', async () => {
    job('menu.bil', { trackAsynchJob: true, showProgress: true, progress: true });
    await voceDiMenu('menu.bil');
    expect(testoVelo(), 'il velo della scheda').not.toBeNull();
    await giro(inCorso(37));
    expect(testoVelo()).toMatch(/37\s*%/);
    await giro(inCorso(60));
    expect(testoVelo()).toMatch(/60\s*%/);
    expect(testoVelo()).not.toMatch(/37\s*%/);
  });
});

describe('SXADV-6309 4. alla risposta finale il velo sparisce e la pagina c\'e\'', () => {
  it.each([
    ...SENZA_PERCENTUALE,
    ['con uiData.progress === true', { trackAsynchJob: true, showProgress: true, progress: true }] as [string, Record<string, unknown>],
  ])('%s', async (_n, uiData) => {
    job('menu.bil', uiData);
    await voceDiMenu('menu.bil');
    await giro(inCorso(37));
    expect(testoVelo()).not.toBeNull();
    await giro(BILANCIO);
    expect(testoVelo(), 'il velo dopo la risposta finale').toBeNull();
    const s = schede().find((x) => x.label === 'Bilancio');
    expect(s, 'la scheda del Bilancio').toBeDefined();
    expect(s!.ui?.viewName).toBe('bilancioDetail');
  });

  it('progress 100 chiude l\'attesa anche col polling che dice ancora trackAsynchJob', async () => {
    job('menu.bil', { trackAsynchJob: true, showProgress: true });
    await voceDiMenu('menu.bil');
    await giro(inCorso(0));
    await giro({ ...BILANCIO, trackAsynchJob: true, progress: 100 });
    expect(testoVelo()).toBeNull();
  });
});

describe('SXADV-6309 5. job senza percentuale: "Elaborazione in corso..." per tutta l\'attesa', () => {
  // Contratto corretto dalla sessione principale dopo la prima stesura: per un
  // job il legacy apre Ext.MessageBox.wait("Attendere...", "Elaborazione in
  // corso...") e lo tiene fino alla fine (ui.js handleErrors). Il messaggio
  // "più del previsto" nasce dal timeout di UNA richiesta (handleFailure):
  // durante il polling ogni richiesta e' breve e il legacy non lo mostrava mai.
  const ELAB = /Elaborazione in corso/;

  it('job senza percentuale, polling con progress 0: "Elaborazione in corso..." subito e dopo 30 s', async () => {
    job('menu.bil', { trackAsynchJob: true, showProgress: true });
    // I giri rispondono "ancora in corso, 0" per tutta l'attesa.
    for (let k = 0; k < 12; k++) server.progress.push(inCorso(0));
    await voceDiMenu('menu.bil');
    expect(testoVelo()).toMatch(ELAB);
    await passa(31000);
    expect(server.progressCalls, 'il polling ha girato durante l\'attesa').toBeGreaterThan(2);
    const t = testoVelo();
    expect(t, 'il velo dopo 31 s').not.toBeNull();
    expect(t).toMatch(ELAB);
    expect(t).not.toMatch(PERCENTUALE);
  });

  it('job senza percentuale, giro ancora in volo: dopo 30 s resta "Elaborazione in corso..."', async () => {
    job('menu.bil', { trackAsynchJob: true });
    await voceDiMenu('menu.bil');
    await passa(31000);
    expect(testoVelo()).toMatch(ELAB);
  });

  it('job CON percentuale: niente "Elaborazione in corso...", c\'e\' la %', async () => {
    job('menu.bil', { trackAsynchJob: true, showProgress: true, progress: true });
    await voceDiMenu('menu.bil');
    await giro(inCorso(37));
    expect(testoVelo()).toMatch(/37\s*%/);
    expect(testoVelo()).not.toMatch(ELAB);
  });
});

describe('SXADV-6309 6. un secondo job senza percentuale non eredita la percentuale del primo', () => {
  it('dopo un job con 60%, il job successivo nella stessa scheda non mostra percentuali', async () => {
    job('menu.bil', { trackAsynchJob: true, showProgress: true, progress: true });
    job('menu.bil2', { trackAsynchJob: true, showProgress: true });
    await voceDiMenu('menu.bil');
    await giro(inCorso(60));
    expect(testoVelo()).toMatch(/60\s*%/);
    await giro(BILANCIO);
    expect(testoVelo()).toBeNull();
    const chiave = schede().find((x) => x.label === 'Bilancio')?.key;

    await voceDiMenu('menu.bil2');
    expect(schede().find((x) => x.loading)?.key, 'il secondo job gira nella stessa scheda').toBe(chiave);
    expect(testoVelo(), 'il velo del secondo job').not.toBeNull();
    expect(testoVelo()).not.toMatch(PERCENTUALE);
    await giro(inCorso(60));
    expect(testoVelo()).not.toMatch(PERCENTUALE);
    await giro(inCorso(0));
    expect(testoVelo()).not.toMatch(PERCENTUALE);
  });
});
