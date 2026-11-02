import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import type { ErrorItem, LoginInfo, MenuItem, SessionPanel } from '../types/ui';

// SXADV-5789, seconda parte del contratto: il sid dell'albero, l'apertura con
// conferma, i job, la scheda fallita, le cartelle, la riga in modifica, il F5, il
// cambio azienda. Stesso motore di Shell.documentale.sxadv5789.test.tsx (niente DOM,
// la Shell si esegue come funzione, gli effetti girano davvero), con un server che
// si puo' istruire: una risposta preparata per vista/voce di menu, un Error =
// richiesta rifiutata, una Promise = risposta che resta in volo.

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

const fb = vi.hoisted(() => ({
  avvisi: [] as string[],
  errori: [] as unknown[],
  info: [] as string[],
  domande: [] as { errors: unknown[]; handlers: { onCancel?: () => void; onAnswer?: (p: unknown, a: 'yes' | 'no') => void } }[],
}));
const notifiche = vi.hoisted(() => ({ arrivate: [] as { onClick?: () => void }[] }));

vi.mock('../hooks/feedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/feedback')>()),
  useFeedback: () => ({
    showServerMessages: (errors: { type: string }[], handlers = {}) => {
      if (errors.some((e) => e.type === 'CONFIRMATION' || e.type === 'YESNOCANCEL')) fb.domande.push({ errors, handlers });
      else fb.errori.push(errors);
    },
    error: (e: unknown) => { fb.errori.push(e); },
    warning: (m: string) => { fb.avvisi.push(m); },
    info: (m: string) => { fb.info.push(m); },
    failure: (e: unknown) => { fb.errori.push(e); },
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

type Richiesta = { action: string; params: Record<string, string>; sid: string };
const server = vi.hoisted(() => ({
  richieste: [] as { action: string; params: Record<string, string>; sid: string }[],
  azioni2: [] as { action: string; params: Record<string, string> }[],
  progressi: [] as string[],
  coda: new Map<string, unknown[]>(),
  esitoAzione2: null as unknown,
}));

vi.mock('../services/api', async (importOriginal) => {
  const risposta = (viewName: string, title: string) => ({
    ui: { rows: [], path: `${viewName}-path`, pageType: 0, viewName, title },
    toolbar: [],
    uiData: {},
  });
  const dallaCoda = async (chiave: string, altrimenti: () => unknown) => {
    const c = server.coda.get(chiave);
    if (!c || c.length === 0) return altrimenti();
    const r = await c.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  return {
    ...(await importOriginal<typeof import('../services/api')>()),
    postAction: async (action: string, params: Record<string, string> = {}, _fv: unknown, sid = 'S1') => {
      server.richieste.push({ action, params: { ...params }, sid });
      return dallaCoda(params.viewName ?? action, () => risposta(params.viewName ?? action, params.title ?? action));
    },
    executeMenuItem: async (menuId: string, sid = 'S1') => {
      server.richieste.push({ action: 'ExecuteMenuItem', params: { menuId }, sid });
      return dallaCoda(menuId, () => risposta(menuId, menuId));
    },
    postAction2: async (action: string, params: Record<string, string> = {}) => {
      server.azioni2.push({ action, params: { ...params } });
      const e = action === 'CloseSession' ? null : server.esitoAzione2;
      server.esitoAzione2 = null;
      return e ?? {};
    },
    checkProgress: async (sid = 'S1') => {
      server.progressi.push(sid);
      return risposta('job', 'Fine job');
    },
    subscribeInFlight: () => () => {},
  };
});

vi.mock('../services/notifications', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>().catch(() => ({}));
  return {
    ...actual,
    notify: (n: { onClick?: () => void }) => { notifiche.arrivate.push(n); },
  };
});

const { default: Shell } = await import('./Shell');

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
  { id: 'menu.fat', description: 'Fatturazione', leaf: true },
  { id: 'menu.mag', description: 'Magazzino', leaf: true },
  { id: 'menu.cli', description: 'Clienti', leaf: true },
  { id: 'menu.alt', description: 'Altro', leaf: true },
];

const LOGIN: LoginInfo = { login: '44AMM', cdms: true, cdmsAdmin: true } as LoginInfo;

type El = ReactElement<Record<string, unknown>>;
type Props = {
  menuItems: MenuItem[];
  loginInfo: LoginInfo;
  sessionLimit?: number;
  initialPanels?: SessionPanel[];
  onLogout: () => void;
  onReloadMenu: () => void;
};

let props: Props;
let tree: unknown = null;

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
    for (const e of daFare) {
      if (typeof e.st.cleanup === 'function') (e.st.cleanup as () => void)();
      e.st.cleanup = e.fn();
      e.st.deps = e.deps;
      e.st.first = false;
    }
    if (!rt.dirty) return;
  }
  throw new Error('la Shell non si stabilizza');
}

/** Disegna finche' richieste e risposte non si sono esaurite. */
async function assesta(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    disegna();
    await new Promise((r) => setTimeout(r, 0));
  }
  disegna();
}

function elements(node: unknown, out: El[] = []): El[] {
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const n of node) elements(n, out);
    return out;
  }
  const el = node as El;
  if (!el.props) return out;
  out.push(el);
  elements(el.props.children, out);
  return out;
}

const find = (pred: (p: Record<string, unknown>) => boolean): El | undefined =>
  elements(tree).find((e) => pred(e.props));

function testo(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(testo).join('');
  const p = (node as El).props;
  return p ? testo(p.children) : '';
}

type Voce = { key: string; label: unknown; closable?: boolean };
type TabsProps = {
  className: string;
  items: Voce[];
  activeKey: string;
  hideAdd?: boolean;
  onChange: (k: string) => void;
  onEdit: (k: unknown, a: 'add' | 'remove') => void;
};

const barra = (): TabsProps => {
  const t = find((p) => typeof p.className === 'string' && p.className.includes('session-tabs') && Array.isArray(p.items));
  expect(t, 'la barra delle schede').toBeDefined();
  return t!.props as unknown as TabsProps;
};
const etichette = () => barra().items.map((v) => testo(v.label).trim());
const voce = (etichetta: string) => barra().items.find((v) => testo(v.label).trim() === etichetta);
const attiva = () => {
  const b = barra();
  const v = b.items.find((x) => x.key === b.activeKey);
  return v ? testo(v.label).trim() : `(nessuna: ${b.activeKey})`;
};

/** Il pulsante della barra verticale con questo tooltip. */
function pulsanteBarra(tooltip: string): El | undefined {
  const t = elements(tree).find((e) => e.props.title === tooltip);
  if (!t) return undefined;
  return elements(t).find((e) => typeof e.props.onClick === 'function');
}
const haBarra = (tooltip: string) => pulsanteBarra(tooltip) !== undefined;

async function clicBarra(tooltip: string): Promise<void> {
  const b = pulsanteBarra(tooltip);
  expect(b, `il pulsante "${tooltip}" della barra verticale`).toBeDefined();
  (b!.props.onClick as () => void)();
  await assesta();
}
const entra = () => clicBarra('Documentale');
const esci = () => clicBarra('Gestionale');

async function casetta(): Promise<void> {
  const b = find((p) => p['aria-label'] === 'Torna alla Home');
  expect(b, 'la casetta').toBeDefined();
  (b!.props.onClick as () => void)();
  await assesta();
}

async function voceDiMenu(id: string): Promise<void> {
  const m = find((p) => 'inlineCollapsed' in p && Array.isArray(p.items));
  expect(m, 'il menu del gestionale').toBeDefined();
  (m!.props.onClick as (a: { key: string }) => void)({ key: id });
  await assesta();
}

async function aggiungiScheda(): Promise<void> {
  barra().onEdit(undefined, 'add');
  await assesta();
}
async function chiudi(etichetta: string): Promise<void> {
  const v = voce(etichetta);
  expect(v, `la scheda "${etichetta}"`).toBeDefined();
  barra().onEdit(v!.key, 'remove');
  await assesta();
}
async function vaiA(etichetta: string): Promise<void> {
  const v = voce(etichetta);
  expect(v, `la scheda "${etichetta}"`).toBeDefined();
  barra().onChange(v!.key);
  await assesta();
}

const azzeraRichieste = () => { server.richieste.length = 0; };
const richieste = (): Richiesta[] => server.richieste;
const richiestaDi = (viewName: string) => richieste().filter((r) => r.params.viewName === viewName);

/** Due schede del gestionale con dentro una funzione: Fatturazione, poi Magazzino (attiva). */
async function gestionaleConDueSchede(): Promise<void> {
  await voceDiMenu('menu.fat');
  await aggiungiScheda();
  await voceDiMenu('menu.mag');
  expect(etichette()).toEqual(['Home', 'Fatturazione', 'Magazzino']);
  expect(attiva()).toBe('Magazzino');
  azzeraRichieste();
}

const QUERY = 'cdmsRisorseQuery';
const RECENTI = 'cdmsRisorseList';
const CESTINO = 'cdmsRisorseListCestino';

const MODIFICHE: ErrorItem = {
  type: 'CONFIRMATION',
  message: 'Ci sono modifiche non salvate. Si desidera vengano annullate TUTTE le modifiche?',
  mnemonic: 'CANCEL_ALL_CHANGES',
} as ErrorItem;
const ALTRA: ErrorItem = { type: 'CONFIRMATION', message: 'Sicuro?', mnemonic: 'ALTRA' } as ErrorItem;

/** La prossima risposta per questa vista (o voce di menu). */
const prepara = (chiave: string, r: unknown) => {
  const c = server.coda.get(chiave) ?? [];
  c.push(r);
  server.coda.set(chiave, c);
};

function trattieni(chiave: string): (r?: unknown) => void {
  let rilascia: (r: unknown) => void = () => {};
  prepara(chiave, new Promise((res) => { rilascia = res; }));
  return (r: unknown = {}) => rilascia(r);
}

type Scheda = { key: string; sid: string; label: string; loading?: boolean; ui?: { title?: string }; formValues: Record<string, unknown> };
const schede = (): Scheda[] =>
  rt.slots.find((s) => Array.isArray(s.v) && (s.v as Scheda[])[0]?.sid !== undefined && (s.v as Scheda[])[0]?.formValues !== undefined)!.v as Scheda[];
const scheda = (etichetta: string): Scheda => {
  const t = schede().find((x) => x.label === etichetta);
  expect(t, `lo stato della scheda "${etichetta}"`).toBeDefined();
  return t!;
};
const inArea = (prefisso: string) => schede().filter((t) => t.sid.startsWith(prefisso));
const numero = (sid: string) => Number(sid.substring(1));

const videata = () => {
  const v = find((p) => typeof p.onGridChange === 'function');
  return v?.props as undefined | {
    ui?: { title?: string };
    onAction: (a: string, p?: Record<string, string>) => Promise<unknown>;
    onChange: (n: string, v: unknown) => void;
    onEditRow: (n: string | null) => void;
  };
};

async function cartella(id: string, nome: string): Promise<void> {
  const albero = find((p) => typeof p.onFolderClick === 'function');
  expect(albero, 'CdmsTree').toBeDefined();
  (albero!.props.onFolderClick as (i: string, n: string) => void)(id, nome);
  await assesta();
}

const homePanel = () => {
  const h = find((p) => typeof p.onBannerClick === 'function');
  expect(h, 'HomePanel').toBeDefined();
  return h!.props as { onBannerClick: (to: string) => void };
};

const conferma = () => {
  const d = fb.domande.at(-1);
  expect(d, 'la finestra di conferma').toBeDefined();
  return d!.handlers;
};

/** Il registro dei sid aperti: la chiave del contratto, in JSON come cdmsTabs.ts. */
const CHIAVE = 'nebula.documentale.sid';
let memoria: Map<string, string>;
const registro = (): string[] => JSON.parse(memoria.get(CHIAVE) ?? '[]') as string[];
const sidChiusi = () => server.azioni2.filter((a) => a.action === 'CloseSession').map((a) => a.params.sid);

function storage(s: unknown): void {
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, writable: true, value: s });
}
function storageInMemoria(): void {
  memoria = new Map();
  storage({
    getItem: (k: string) => memoria.get(k) ?? null,
    setItem: (k: string, v: string) => { memoria.set(k, String(v)); },
    removeItem: (k: string) => { memoria.delete(k); },
  });
}

async function monta(extra: Partial<Props> = {}): Promise<void> {
  props = { menuItems: MENU, loginInfo: LOGIN, onLogout: noop, onReloadMenu: noop, ...extra };
  await assesta();
}

/** Un F5: stato di React perso, sessionStorage e contatore del modulo restano. */
async function ricarica(extra: Partial<Props> = {}): Promise<void> {
  rt.slots = [];
  rt.effects = [];
  server.azioni2.length = 0;
  server.richieste.length = 0;
  await monta(extra);
}

// I sid "di prima di un F5" stanno sopra a qualunque numero il contatore abbia
// raggiunto: un contatore non aggiornato li riuserebbe davvero, prima o poi.
let alto = 1_000_000;

beforeEach(async () => {
  rt.slots = [];
  rt.effects = [];
  server.richieste.length = 0;
  server.azioni2.length = 0;
  server.progressi.length = 0;
  server.coda.clear();
  fb.avvisi.length = 0;
  fb.errori.length = 0;
  fb.info.length = 0;
  fb.domande.length = 0;
  notifiche.arrivate.length = 0;
  storageInMemoria();
  await monta();
});

afterEach(() => {
  storage(undefined);
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────── le prove

describe('A. albero: la sua Session', () => {
  const corpi: { url: string; body: URLSearchParams }[] = [];
  beforeEach(() => {
    corpi.length = 0;
    vi.stubGlobal('fetch', async (url: string, init: { body: URLSearchParams }) => {
      corpi.push({ url, body: new URLSearchParams(init.body) });
      return new Response('{}', { status: 200 });
    });
  });
  const vero = () => vi.importActual<typeof import('../services/api')>('../services/api');

  it("cdmsGetRoots spedisce sid 'D0'", async () => {
    await (await vero()).cdmsGetRoots();
    expect(corpi).toHaveLength(1);
    expect(corpi[0].body.get('action')).toBe('CdmsRoots');
    expect(corpi[0].body.getAll('sid')).toEqual(['D0']);
  });

  it("cdmsGetChildren spedisce sid 'D0' e il path", async () => {
    await (await vero()).cdmsGetChildren('ROOT|x');
    expect(corpi[0].body.get('action')).toBe('CdmsGet');
    expect(corpi[0].body.get('path')).toBe('ROOT|x');
    expect(corpi[0].body.getAll('sid')).toEqual(['D0']);
  });

  it("cdmsExec spedisce sid 'D0' e i parametri del comando", async () => {
    await (await vero()).cdmsExec('rename', { path: 'ROOT|x', newname: 'Nuovo' });
    expect(corpi[0].body.get('action')).toBe('CdmsExec');
    expect(corpi[0].body.get('cmd')).toBe('rename');
    expect(corpi[0].body.get('newname')).toBe('Nuovo');
    expect(corpi[0].body.getAll('sid')).toEqual(['D0']);
  });
});

describe('B. apertura con conferma su una scheda gia\' popolata', () => {
  /** Lista di cartella 2026 aperta, poi clic su 2025: il server chiede conferma. */
  async function domandaSuCartella(): Promise<Scheda> {
    await entra();
    await cartella('ROOT|u2026', '2026');
    expect(attiva()).toBe('2026');
    expect(videata()?.ui?.title).toBe('2026');
    videata()!.onChange('note.X', 'bozza');
    await assesta();
    azzeraRichieste();
    fb.domande.length = 0;
    prepara(RECENTI, { errors: [MODIFICHE] });
    await cartella('ROOT|u2025', '2025');
    expect(fb.domande).toHaveLength(1);
    return schede().find((t) => t.key === barra().activeKey)!;
  }

  it('mentre si attende la risposta la videata di prima resta', async () => {
    const t = await domandaSuCartella();
    expect(t.ui?.title).toBe('2026');
    expect(videata()?.ui?.title).toBe('2026');
  });

  it('Annulla: titolo e videata di prima, digitato conservato, nessuna richiesta, scheda libera', async () => {
    const t = await domandaSuCartella();
    azzeraRichieste();
    conferma().onCancel?.();
    await assesta();
    expect(etichette()).toContain('2026');
    expect(etichette()).not.toContain('2025');
    expect(videata()?.ui?.title).toBe('2026');
    expect(richieste()).toEqual([]);
    const dopo = schede().find((x) => x.key === t.key)!;
    expect(dopo.loading).toBeFalsy();
    expect(dopo.formValues).toMatchObject({ 'note.X': 'bozza' });
  });

  it('Annulla stando nel gestionale: il titolo si ripristina e la scheda attiva non cambia', async () => {
    await gestionaleConDueSchede();
    const t = await domandaSuCartella();
    await esci();
    azzeraRichieste();
    conferma().onCancel?.();
    await assesta();
    expect(attiva()).toBe('Magazzino');
    expect(schede().find((x) => x.key === t.key)!.label).toBe('2026');
    expect(richieste()).toEqual([]);
  });

  it('Si\': rigioca la stessa richiesta col messages, sul sid della scheda, senza Post', async () => {
    const t = await domandaSuCartella();
    azzeraRichieste();
    conferma().onAnswer?.(MODIFICHE, 'yes');
    await assesta();
    expect(richieste()).toHaveLength(1);
    expect(richieste()[0]).toMatchObject({
      action: 'ListPage',
      sid: t.sid,
      params: { viewName: RECENTI, newTask: '1', title: '2025', orderBy: 'nickname', messages: 'CANCEL_ALL_CHANGES,' },
    });
    expect(richieste()[0].params.filter).toContain('u2025');
    expect(videata()?.ui?.title).toBe('2025');
    expect(attiva()).toBe('2025');
  });

  it('Si\' dopo essere tornati al gestionale: parte sul sid D, il gestionale non riceve niente', async () => {
    await gestionaleConDueSchede();
    const t = await domandaSuCartella();
    await esci();
    azzeraRichieste();
    conferma().onAnswer?.(MODIFICHE, 'yes');
    await assesta();
    expect(richieste().map((r) => [r.action, r.sid])).toEqual([['ListPage', t.sid]]);
    expect(richieste()[0].params.messages).toBe('CANCEL_ALL_CHANGES,');
    expect(attiva()).toBe('Magazzino');
    expect(haBarra('Documentale')).toBe(true);
    expect(schede().find((x) => x.key === t.key)!.ui?.title).toBe('2025');
  });

  it('una funzione con action propria (Aggiungi Albero) rigioca la sua AddPage', async () => {
    await entra();
    await clicBarra('Aggiungi Albero');
    const sid = richieste().at(-1)!.sid;
    fb.domande.length = 0;
    prepara('cdmsNodiClassificazioneDetail', { errors: [MODIFICHE] });
    await vaiA('Ricerca');
    await clicBarra('Aggiungi Albero');
    azzeraRichieste();
    conferma().onAnswer?.(MODIFICHE, 'yes');
    await assesta();
    expect(richieste()).toHaveLength(1);
    expect(richieste()[0]).toMatchObject({
      action: 'AddPage',
      sid,
      params: { viewName: 'cdmsNodiClassificazioneDetail', newTask: '1', messages: 'CANCEL_ALL_CHANGES,' },
    });
  });

  it('due domande in fila: il messages le accumula', async () => {
    await domandaSuCartella();
    azzeraRichieste();
    prepara(RECENTI, { errors: [ALTRA] });
    conferma().onAnswer?.(MODIFICHE, 'yes');
    await assesta();
    conferma().onAnswer?.(ALTRA, 'yes');
    await assesta();
    expect(richieste().map((r) => r.params.messages)).toEqual(['CANCEL_ALL_CHANGES,', 'CANCEL_ALL_CHANGES,ALTRA,']);
    expect(richieste().filter((r) => r.action === 'Post')).toEqual([]);
  });
});

describe('C. job alla prima risposta di una scheda documentale', () => {
  const JOB = { uiData: { showProgress: true } };

  it('Ricerca: il polling usa il sid D della scheda, mai S1', async () => {
    prepara(QUERY, JOB);
    await entra();
    const sid = richiestaDi(QUERY)[0].sid;
    expect(sid).toMatch(/^D/);
    expect(server.progressi).toEqual([sid]);
    expect(videata()?.ui?.title).toBe('Fine job');
  });

  it('una funzione (Cestino): stesso sid della sua apertura', async () => {
    await entra();
    prepara(CESTINO, JOB);
    await clicBarra('Cestino');
    expect(server.progressi).toEqual([richiestaDi(CESTINO)[0].sid]);
  });

  it('una cartella: stesso sid della sua apertura', async () => {
    await entra();
    azzeraRichieste();
    prepara(RECENTI, JOB);
    await cartella('ROOT|u1', 'Uno');
    expect(server.progressi).toEqual([richiestaDi(RECENTI)[0].sid]);
  });

  it('dopo il Si\' a una conferma il polling resta sul sid D', async () => {
    await entra();
    await clicBarra('Cestino');
    const sid = richiestaDi(CESTINO)[0].sid;
    await vaiA('Ricerca');
    prepara(CESTINO, { errors: [MODIFICHE] });
    await clicBarra('Cestino');
    prepara(CESTINO, JOB);
    conferma().onAnswer?.(MODIFICHE, 'yes');
    await assesta();
    expect(server.progressi).toEqual([sid]);
  });
});

describe('D. scheda fallita', () => {
  it('Ricerca rifiutata: si esce e si rientra, l\'apertura viene rilanciata sulla stessa scheda', async () => {
    prepara(QUERY, new Error('rete'));
    await entra();
    expect(fb.errori).toHaveLength(1);
    const sid = richiestaDi(QUERY)[0].sid;
    expect(scheda('Ricerca').loading).toBeFalsy();
    await esci();
    azzeraRichieste();
    await entra();
    expect(richieste()).toHaveLength(1);
    expect(richieste()[0]).toMatchObject({ action: 'QueryPage', sid, params: { viewName: QUERY } });
    expect(etichette()).toEqual(['Ricerca', 'Documenti recenti']);
    expect(videata()?.ui?.title).toBe('Ricerca');
  });

  // Oltre la lettera del contratto: il commento del codice promette che le due fisse
  // non restino vuote fino a un F5, e qui la fallita non e' quella su cui si rientra.
  it('Documenti recenti rifiutata (dietro a Ricerca): uscendo e rientrando viene rilanciata', async () => {
    prepara(RECENTI, new Error('rete'));
    await entra();
    await esci();
    azzeraRichieste();
    await entra();
    await vaiA('Documenti recenti');
    expect(richiestaDi(RECENTI)).toHaveLength(1);
    expect(scheda('Documenti recenti').ui, 'la scheda con la sua videata').toBeDefined();
  });
});

describe('E. Vai alla Home dalla scheda vuota', () => {
  it('riporta al gestionale con la Home attiva, senza richieste', async () => {
    await gestionaleConDueSchede();
    prepara(QUERY, new Error('rete'));
    await entra();
    expect(haBarra('Gestionale')).toBe(true);
    const b = elements(tree).find((e) => typeof e.props.onClick === 'function' && testo(e).trim() === 'Vai alla Home');
    expect(b, 'il pulsante «Vai alla Home»').toBeDefined();
    azzeraRichieste();
    (b!.props.onClick as () => void)();
    await assesta();
    expect(haBarra('Documentale')).toBe(true);
    expect(etichette()).toEqual(['Home', 'Fatturazione', 'Magazzino']);
    expect(attiva()).toBe('Home');
    expect(richieste()).toEqual([]);
  });
});

describe('F. cartelle: una scheda sola', () => {
  beforeEach(entra);

  it('due cartelle: stessa scheda e stesso sid, orderBy nickname, filter della cartella, titolo = nome', async () => {
    azzeraRichieste();
    await cartella('ROOT|anno|u2026', '2026');
    const chiave = barra().activeKey;
    await cartella('ROOT|anno|u2025', '2025');
    expect(barra().items).toHaveLength(3);
    expect(barra().activeKey).toBe(chiave);
    expect(etichette()).toEqual(['Ricerca', 'Documenti recenti', '2025']);
    const [a, b] = richieste();
    expect(richieste()).toHaveLength(2);
    expect(b.sid).toBe(a.sid);
    for (const [r, uuid, nome] of [[a, 'u2026', '2026'], [b, 'u2025', '2025']] as const) {
      expect(r.params).toMatchObject({ viewName: RECENTI, orderBy: 'nickname', title: nome, newTask: '1' });
      expect(r.params.filter).toContain(uuid);
      expect(r.params.filter).not.toContain('anno');
    }
  });

  it('riclicco sulla stessa cartella da un\'altra scheda: ci torna e rifa\' la richiesta', async () => {
    await cartella('ROOT|u1', 'Uno');
    const chiave = barra().activeKey;
    await vaiA('Ricerca');
    azzeraRichieste();
    await cartella('ROOT|u1', 'Uno');
    expect(barra().activeKey).toBe(chiave);
    expect(barra().items).toHaveLength(3);
    expect(richieste()).toHaveLength(1);
  });

  it('la scheda delle cartelle si chiude, e la cartella dopo ne apre una nuova', async () => {
    await cartella('ROOT|u1', 'Uno');
    expect(voce('Uno')!.closable).toBe(true);
    await chiudi('Uno');
    await cartella('ROOT|u2', 'Due');
    expect(etichette()).toEqual(['Ricerca', 'Documenti recenti', 'Due']);
  });
});

describe('G. la riga in modifica non e\' di tutte le schede', () => {
  it('la risposta dei Documenti recenti (dietro) non toglie la riga alla scheda attiva del gestionale', async () => {
    await gestionaleConDueSchede();
    const risposta = trattieni(RECENTI);
    await entra();
    await esci();
    expect(attiva()).toBe('Magazzino');
    const riga = `${scheda('Magazzino').sid}-6.3`;
    videata()!.onEditRow(riga);
    risposta({ ui: { rows: [], path: 'p', pageType: 1, viewName: RECENTI, title: 'Documenti recenti' }, toolbar: [], uiData: {} });
    await assesta();
    expect(scheda('Documenti recenti').ui).toBeDefined();
    azzeraRichieste();
    await videata()!.onAction('Post', {});
    await assesta();
    expect(richieste().at(-1)!.params).toMatchObject({ navpath: riga, postPath: riga });
  });

  // Le risposte vere arrivano a due fasi, con la chiave del template: e' un altro ramo.
  it('lo stesso quando la risposta dietro porta un template (due fasi)', async () => {
    await gestionaleConDueSchede();
    const risposta = trattieni(RECENTI);
    await entra();
    await esci();
    const riga = `${scheda('Magazzino').sid}-6.3`;
    videata()!.onEditRow(riga);
    risposta({
      templateKey: 'cdmsRisorseList:1',
      template: { rows: [], path: 'p', pageType: 1, viewName: RECENTI, title: 'Documenti recenti' },
      toolbar: [],
      uiData: {},
    });
    await assesta();
    expect(scheda('Documenti recenti').ui).toBeDefined();
    azzeraRichieste();
    await videata()!.onAction('Post', {});
    await assesta();
    expect(richieste().at(-1)!.params).toMatchObject({ navpath: riga, postPath: riga });
  });

  it('la risposta di una voce del gestionale (dietro) non toglie la riga alla scheda documentale attiva', async () => {
    await gestionaleConDueSchede();
    const risposta = trattieni('menu.cli');
    await voceDiMenu('menu.cli');
    await entra();
    await clicBarra('Cestino');
    const riga = `${scheda('Cestino').sid}-2.1`;
    videata()!.onEditRow(riga);
    risposta({ ui: { rows: [], path: 'p', pageType: 1, viewName: 'clienti', title: 'Clienti' }, toolbar: [], uiData: {} });
    await assesta();
    azzeraRichieste();
    await videata()!.onAction('Post', {});
    await assesta();
    expect(richieste().at(-1)).toMatchObject({ sid: scheda('Cestino').sid, params: { navpath: riga, postPath: riga } });
  });

  it('controprova: la risposta della scheda attiva invece la riga la toglie', async () => {
    await entra();
    await clicBarra('Cestino');
    videata()!.onEditRow(`${scheda('Cestino').sid}-2.1`);
    await vaiA('Cestino');
    await clicBarra('Cestino');
    azzeraRichieste();
    await videata()!.onAction('Post', {});
    await assesta();
    expect(richieste().at(-1)!.params.navpath).toBeUndefined();
  });
});

describe('H. dopo un F5: le Session orfane del documentale', () => {
  it('le schede aperte finiscono nel registro, solo quelle D', async () => {
    await voceDiMenu('menu.fat');
    await entra();
    await clicBarra('Cestino');
    expect(registro().sort()).toEqual(inArea('D').map((t) => t.sid).sort());
    expect(registro()).toHaveLength(3);
  });

  it('al montaggio CloseSession per ciascuna, una volta sola, e il registro si svuota', async () => {
    await entra();
    const aperte = inArea('D').map((t) => t.sid);
    await ricarica();
    expect(sidChiusi().sort()).toEqual([...aperte].sort());
    expect(registro()).toEqual([]);
    disegna();
    await assesta();
    expect(sidChiusi()).toHaveLength(aperte.length);
    expect(etichette()).toContain('Home');
    expect(inArea('D')).toEqual([]);
  });

  it('un secondo F5 non richiude niente', async () => {
    await entra();
    await ricarica();
    await ricarica();
    expect(sidChiusi()).toEqual([]);
  });

  it('il registro seminato: le schede aperte dopo non riusano quei numeri', async () => {
    alto += 10;
    memoria.set(CHIAVE, JSON.stringify([`D${alto}`, `D${alto + 1}`]));
    await ricarica();
    expect(sidChiusi().sort()).toEqual([`D${alto}`, `D${alto + 1}`]);
    await entra();
    expect(inArea('D').every((t) => numero(t.sid) > alto + 1)).toBe(true);
    await esci();
    await aggiungiScheda();
    expect(numero(schede().at(-1)!.sid)).toBeGreaterThan(alto + 1);
  });

  it('anche con le schede del gestionale ricostruite dal server il contatore resta sopra agli orfani', async () => {
    alto += 10;
    memoria.set(CHIAVE, JSON.stringify([`D${alto}`]));
    await ricarica({ initialPanels: [{ id: 'S3', title: 'Clienti', menuId: 'menu.cli' }] as SessionPanel[] });
    expect(sidChiusi()).toEqual([`D${alto}`]);
    expect(schede().map((t) => t.sid)).toEqual(['S3']);
    await aggiungiScheda();
    expect(numero(schede().at(-1)!.sid)).toBeGreaterThan(alto);
  });

  it('una scheda chiusa dall\'utente esce dal registro e al F5 non si richiude', async () => {
    await entra();
    await clicBarra('Cestino');
    const sid = scheda('Cestino').sid;
    await chiudi('Cestino');
    expect(sidChiusi()).toEqual([sid]);
    expect(registro()).not.toContain(sid);
    expect(registro()).toHaveLength(2);
    await ricarica();
    expect(sidChiusi()).not.toContain(sid);
    expect(sidChiusi()).toHaveLength(2);
  });

  it('un registro illeggibile non ferma la Shell', async () => {
    memoria.set(CHIAVE, '{non json');
    await ricarica();
    expect(sidChiusi()).toEqual([]);
    expect(etichette()).toContain('Home');
  });

  const percorso = async () => {
    await ricarica();
    await entra();
    expect(etichette()).toEqual(['Ricerca', 'Documenti recenti']);
    await clicBarra('Cestino');
    await chiudi('Cestino');
    await esci();
    expect(attiva()).toBe('Home');
  };

  it('sessionStorage con metodi che lanciano: la Shell funziona', async () => {
    const lancia = () => { throw new Error('negato'); };
    storage({ getItem: lancia, setItem: lancia, removeItem: lancia });
    await percorso();
  });

  it('sessionStorage che lancia gia\' a nominarlo: la Shell funziona', async () => {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: () => { throw new Error('negato'); } });
    await percorso();
  });
});

describe('I. cambio azienda dal documentale', () => {
  const conAziende = {
    loginInfo: {
      ...LOGIN,
      customerKey: '44',
      aziende: [{ value: '44', text: 'Una' }, { value: '45', text: 'Due' }],
    } as LoginInfo,
  };

  async function cambiaAzienda(): Promise<void> {
    const s = find((p) => p.className === 'header-select' && Array.isArray(p.options));
    expect(s, 'la tendina delle aziende').toBeDefined();
    (s!.props.onChange as (v: string) => void)('45');
    await assesta();
  }

  beforeEach(async () => {
    rt.slots = [];
    await monta(conAziende);
    await gestionaleConDueSchede();
    await entra();
    await clicBarra('Cestino');
    server.azioni2.length = 0;
  });

  it('si torna al gestionale con la Home attiva e una sola scheda S1, senza schede D', async () => {
    await cambiaAzienda();
    expect(server.azioni2.filter((a) => a.action === 'CambioAzienda')).toHaveLength(1);
    expect(haBarra('Documentale')).toBe(true);
    expect(attiva()).toBe('Home');
    expect(schede().map((t) => t.sid)).toEqual(['S1']);
  });

  // I numeri possono ripartire: il cambio ha gia' svuotato le Session sul server.
  it('rientrando si riapre una coppia nuova', async () => {
    await cambiaAzienda();
    azzeraRichieste();
    await entra();
    expect(etichette()).toEqual(['Ricerca', 'Documenti recenti']);
    expect(attiva()).toBe('Ricerca');
    expect(richiestaDi(QUERY)).toHaveLength(1);
    expect(richiestaDi(RECENTI)).toHaveLength(1);
    expect(richieste()).toHaveLength(2);
    for (const r of richieste()) expect(r.sid).toMatch(/^D/);
  });

  it('il registro non tiene le schede di prima del cambio', async () => {
    await cambiaAzienda();
    expect(registro()).toEqual([]);
    await entra();
    expect(registro().sort()).toEqual(inArea('D').map((t) => t.sid).sort());
    expect(registro()).toHaveLength(2);
  });

  it('una voce di menu dopo il cambio parte su S1', async () => {
    await cambiaAzienda();
    azzeraRichieste();
    homePanel().onBannerClick('menu.cli');
    await assesta();
    expect(richieste().map((r) => r.sid)).toEqual(['S1']);
  });

  it('cambio rifiutato dal server: si resta nel documentale, schede intatte', async () => {
    server.esitoAzione2 = { errors: [{ type: 'ERROR', message: 'Salvare prima' }] };
    await cambiaAzienda();
    expect(haBarra('Gestionale')).toBe(true);
    expect(etichette()).toEqual(['Ricerca', 'Documenti recenti', 'Cestino']);
    expect(attiva()).toBe('Cestino');
  });
});

describe('J. avviso dal documentale con la scheda di lavoro occupata', () => {
  it('si passa al gestionale, la richiesta non parte di nascosto, compare un info', async () => {
    rt.slots = [];
    await monta({ loginInfo: { ...LOGIN, banners: [{ text: 'Avviso', navigateTo: 'menu.cli' }] } as LoginInfo });
    await voceDiMenu('menu.fat');
    await aggiungiScheda();
    const risposta = trattieni('menu.mag');
    await voceDiMenu('menu.mag');
    expect(scheda('Magazzino').loading).toBe(true);
    await entra();
    azzeraRichieste();
    expect(notifiche.arrivate.length).toBeGreaterThan(0);
    notifiche.arrivate[0].onClick!();
    await assesta();
    expect(haBarra('Documentale'), 'si e\' tornati nel gestionale').toBe(true);
    expect(attiva()).toBe('Magazzino');
    expect(fb.info).toHaveLength(1);
    expect(fb.info[0]).toContain('Magazzino');
    expect(richieste()).toEqual([]);
    risposta({ ui: { rows: [], path: 'p', pageType: 1, viewName: 'mag', title: 'Magazzino' }, toolbar: [], uiData: {} });
    await assesta();
    expect(richieste(), 'l\'ingresso non riparte da solo quando la scheda si libera').toEqual([]);
    expect(attiva()).toBe('Magazzino');
  });
});

describe('K. chiudere una scheda del gestionale con schede D in mezzo', () => {
  // S1, D, D, S4, S5, S6: Fatturazione, Ricerca, Recenti, Magazzino, Clienti, Altro.
  beforeEach(async () => {
    await voceDiMenu('menu.fat');
    await entra();
    await esci();
    for (const m of ['menu.mag', 'menu.cli', 'menu.alt']) {
      await aggiungiScheda();
      await voceDiMenu(m);
    }
    expect(schede().map((t) => t.sid[0]).join('')).toBe('SDDSSS');
    expect(etichette()).toEqual(['Home', 'Fatturazione', 'Magazzino', 'Clienti', 'Altro']);
    await vaiA('Magazzino');
  });

  it('chiusa dalla scheda stessa: si passa alla successiva del gestionale', async () => {
    await chiudi('Magazzino');
    expect(attiva()).toBe('Clienti');
  });

  it('chiusa stando sulla Home: una voce di menu dalla Home finisce nella successiva', async () => {
    const sid = scheda('Clienti').sid;
    await casetta();
    await chiudi('Magazzino');
    expect(attiva()).toBe('Home');
    azzeraRichieste();
    homePanel().onBannerClick('menu.fat');
    await assesta();
    expect(richieste().map((r) => r.sid)).toEqual([sid]);
  });

  it('chiudendo l\'ultima del gestionale si passa alla precedente, mai a una D', async () => {
    await vaiA('Altro');
    await chiudi('Altro');
    expect(attiva()).toBe('Clienti');
  });
});

describe('L. le schede fisse e il rientro', () => {
  it('le due fisse restano non chiudibili con funzioni e cartelle aperte, le altre si chiudono', async () => {
    await entra();
    await clicBarra('Cestino');
    await cartella('ROOT|u1', 'Uno');
    for (const v of ['Ricerca', 'Documenti recenti']) expect(voce(v)!.closable).toBe(false);
    for (const v of ['Cestino', 'Uno']) expect(voce(v)!.closable).toBe(true);
    await chiudi('Cestino');
    await chiudi('Uno');
    for (const v of ['Ricerca', 'Documenti recenti']) expect(voce(v)!.closable).toBe(false);
  });

  it('piu\' rientri con tutte le schede popolate: nessuna richiesta', async () => {
    await entra();
    await clicBarra('Cestino');
    azzeraRichieste();
    for (const scheda_ of ['Ricerca', 'Documenti recenti', 'Cestino']) {
      await vaiA(scheda_);
      await esci();
      await entra();
      expect(attiva()).toBe(scheda_);
    }
    expect(richieste()).toEqual([]);
  });

  it('se la scheda su cui si era e\' stata chiusa si rientra su una fissa, senza richieste', async () => {
    await entra();
    await clicBarra('Cestino');
    await chiudi('Cestino');
    await esci();
    azzeraRichieste();
    await entra();
    expect(['Ricerca', 'Documenti recenti']).toContain(attiva());
    expect(richieste()).toEqual([]);
  });

  it('rientrando mentre una fissa sta ancora caricando: nessuna richiesta doppia', async () => {
    const risposta = trattieni(QUERY);
    await entra();
    await esci();
    azzeraRichieste();
    await entra();
    expect(richieste()).toEqual([]);
    risposta({ ui: { rows: [], path: 'p', pageType: 0, viewName: QUERY, title: 'Ricerca' }, toolbar: [], uiData: {} });
    await assesta();
    expect(richieste()).toEqual([]);
  });
});
