import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import type { LoginInfo, MenuItem } from '../types/ui';
import { APERTURA_FUNZIONE } from './cdmsTabs';

// SXADV-5815.9 — una cartella dell'albero: la scheda porta il nome della cartella,
// la richiesta il titolo 'Gestione Documentale' (lista, dettaglio e link di ritorno
// sono di quella funzione). Le altre aperture del documentale tengono il proprio.
// Stesso motore di Shell.documentale.sxadv5789.test.tsx: il mock del server rimanda
// il title ricevuto come ui.title, quindi si prova anche che la risposta non
// sovrascriva l'etichetta della scheda.

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

const fb = vi.hoisted(() => ({ avvisi: [] as string[], errori: [] as unknown[] }));
const notifiche = vi.hoisted(() => ({ arrivate: [] as { onClick?: () => void }[] }));

vi.mock('../hooks/feedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/feedback')>()),
  useFeedback: () => ({
    showServerMessages: (e: unknown) => { fb.errori.push(e); },
    error: (e: unknown) => { fb.errori.push(e); },
    warning: (m: string) => { fb.avvisi.push(m); },
    info: () => {},
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

// Il registro di tutto cio' che parte verso il server.
type Richiesta = { action: string; params: Record<string, string>; sid: string };
const server = vi.hoisted(() => ({
  richieste: [] as { action: string; params: Record<string, string>; sid: string }[],
  // Se c'e', le postAction restano in volo finche' non si risolve.
  attesa: null as Promise<void> | null,
}));

vi.mock('../services/api', async (importOriginal) => {
  const risposta = (viewName: string, title: string) => ({
    ui: { rows: [], path: `${viewName}-path`, pageType: 0, viewName, title },
    toolbar: [],
    uiData: {},
  });
  return {
    ...(await importOriginal<typeof import('../services/api')>()),
    postAction: async (action: string, params: Record<string, string> = {}, _fv: unknown, sid = 'S1') => {
      server.richieste.push({ action, params: { ...params }, sid });
      if (server.attesa) await server.attesa;
      return risposta(params.viewName ?? action, params.title ?? action);
    },
    executeMenuItem: async (menuId: string, sid = 'S1') => {
      server.richieste.push({ action: 'ExecuteMenuItem', params: { menuId }, sid });
      return risposta(menuId, menuId);
    },
    postAction2: async () => ({}),
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
];

const LOGIN: LoginInfo = { login: '44AMM', cdms: true, cdmsAdmin: true } as LoginInfo;

type El = ReactElement<Record<string, unknown>>;
type Props = {
  menuItems: MenuItem[];
  loginInfo: LoginInfo;
  sessionLimit?: number;
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

async function clicBarra(tooltip: string): Promise<void> {
  const b = pulsanteBarra(tooltip);
  expect(b, `il pulsante "${tooltip}" della barra verticale`).toBeDefined();
  (b!.props.onClick as () => void)();
  await assesta();
}
const entra = () => clicBarra('Documentale');




const azzeraRichieste = () => { server.richieste.length = 0; };
const richieste = (): Richiesta[] => server.richieste;

/** Due schede del gestionale con dentro una funzione: Fatturazione, poi Magazzino (attiva). */

async function monta(extra: Partial<Props> = {}): Promise<void> {
  props = { menuItems: MENU, loginInfo: LOGIN, onLogout: noop, onReloadMenu: noop, ...extra };
  await assesta();
}

beforeEach(async () => {
  rt.slots = [];
  rt.effects = [];
  server.richieste.length = 0;
  fb.avvisi.length = 0;
  fb.errori.length = 0;
  notifiche.arrivate.length = 0;
  await monta();
});

// ─────────────────────────────────────────────────────────────── le prove

const GD = 'Gestione Documentale';

async function cartella(id: string, nome: string): Promise<void> {
  const albero = find((p) => typeof p.onFolderClick === 'function');
  expect(albero, 'CdmsTree').toBeDefined();
  (albero!.props.onFolderClick as (i: string, n: string) => void)(id, nome);
  await assesta();
}

describe('SXADV-5815.9: cartella dell\'albero', () => {
  beforeEach(async () => {
    await entra();
    azzeraRichieste();
  });

  it('scheda col nome della cartella anche dopo la risposta; richiesta con titolo Gestione Documentale', async () => {
    await cartella('ROOT|abc-123', '2026');
    expect(etichette()).toEqual(['Ricerca', 'Documenti recenti', '2026']);
    expect(attiva()).toBe('2026');
    expect(richieste()).toHaveLength(1);
    const r = richieste()[0];
    expect(r.action).toBe('ListPage');
    expect(r.params).toEqual({
      viewName: 'cdmsRisorseList',
      title: GD,
      newTask: '1',
      orderBy: 'nickname',
      filter: "exists(nodi[idNodoClass = 'abc-123'])",
    });
  });

  it('la cartella dopo riusa la scheda: etichetta nuova, stesso sid, stesso titolo di vista', async () => {
    await cartella('ROOT|abc-123', '2026');
    const sid = richieste()[0].sid;
    azzeraRichieste();
    await cartella('ROOT|def-456', 'Fatture');
    expect(etichette()).toEqual(['Ricerca', 'Documenti recenti', 'Fatture']);
    expect(richieste()).toHaveLength(1);
    expect(richieste()[0].sid).toBe(sid);
    expect(richieste()[0].params.title).toBe(GD);
    expect(richieste()[0].params.filter).toContain('def-456');
  });

  it('una cartella che si chiama come un\'altra funzione resta il nome della scheda', async () => {
    await cartella('ROOT|abc-123', 'Cestino');
    expect(etichette()).toContain('Cestino');
    expect(richieste()[0].params.title).toBe(GD);
  });
});

describe('SXADV-5815.9: le altre aperture tengono il proprio titolo', () => {
  it('Ricerca e Documenti recenti, entrando', async () => {
    azzeraRichieste();
    await entra();
    const titoli = richieste().map((r) => r.params.title).sort();
    expect(titoli).toEqual([APERTURA_FUNZIONE.recenti.title, APERTURA_FUNZIONE.ricerca.title].sort());
  });

  it.each([
    { tooltip: 'Cestino', funzione: 'cestino' as const },
    { tooltip: 'Gestione Profili', funzione: 'profili' as const },
    { tooltip: 'Gestione Utenti', funzione: 'utenti' as const },
    { tooltip: 'Aggiungi Albero', funzione: 'nuovoAlbero' as const },
  ])('$tooltip, anche dopo una cartella: titolo proprio, uguale all\'etichetta', async ({ tooltip, funzione }) => {
    await entra();
    await cartella('ROOT|abc-123', '2026');
    azzeraRichieste();
    await clicBarra(tooltip);
    expect(richieste()).toHaveLength(1);
    expect(richieste()[0].params.title).toBe(APERTURA_FUNZIONE[funzione].title);
    expect(attiva()).toBe(APERTURA_FUNZIONE[funzione].title);
  });
});
