import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import type { LoginInfo, MenuItem } from '../types/ui';

// SXADV-5789 — il Documentale, come in Nebula legacy, e' un'area a se' con schede
// proprie: entrando si vedono solo le sue, tornando al gestionale ricompare quello
// di prima, e le due aree non si scambiano mai sessioni ne' richieste.
//
// Niente DOM nel progetto: stesso motore di Shell.menuCollapsed.sxadv5952.test.tsx,
// qui con gli effetti eseguiti davvero (come ritornoWidget.home.sxadv5999.test.tsx)
// perche' l'ingresso dalla Home parte da un effetto. L'albero di elementi restituito
// si visita come dati e se ne chiamano gli onClick/onEdit; le richieste si leggono
// dal mock di services/api, le schede dalle `items` di Tabs.

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

describe('SXADV-5789: il pulsante della barra verticale', () => {
  it("nel gestionale si chiama 'Documentale', nel documentale 'Gestionale'; 'Torna al menu' non esiste piu'", async () => {
    expect(haBarra('Documentale')).toBe(true);
    expect(haBarra('Gestionale')).toBe(false);
    expect(haBarra('Torna al menu')).toBe(false);
    await entra();
    expect(haBarra('Gestionale')).toBe(true);
    expect(haBarra('Documentale')).toBe(false);
    expect(haBarra('Torna al menu')).toBe(false);
    await esci();
    expect(haBarra('Documentale')).toBe(true);
    expect(haBarra('Gestionale')).toBe(false);
  });
});

describe('SXADV-5789: entrare nel documentale', () => {
  beforeEach(gestionaleConDueSchede);

  it('1. la barra mostra solo Ricerca e Documenti recenti, Ricerca attiva, non chiudibili, senza +', async () => {
    await entra();
    expect(etichette()).toEqual(['Ricerca', 'Documenti recenti']);
    expect(attiva()).toBe('Ricerca');
    expect(voce('Ricerca')!.closable).toBe(false);
    expect(voce('Documenti recenti')!.closable).toBe(false);
    expect(barra().hideAdd).toBe(true);
  });

  it("2. partono le due viste su sid 'D' distinti; il gestionale non riceve nulla", async () => {
    await entra();
    const [ricerca] = richiestaDi('cdmsRisorseQuery');
    const [recenti] = richiestaDi('cdmsRisorseList');
    expect(ricerca?.action).toBe('QueryPage');
    expect(recenti?.action).toBe('ListPage');
    expect(recenti?.params.orderBy).toBe('dataUltimaRevisione desc');
    expect(ricerca.sid).toMatch(/^D/);
    expect(recenti.sid).toMatch(/^D/);
    expect(ricerca.sid).not.toBe(recenti.sid);
    expect(richieste().filter((r) => !r.sid.startsWith('D'))).toEqual([]);
    expect(richieste()).toHaveLength(2);
  });

  it('entrando dalla Home, senza schede lavorate: nessuna richiesta tocca le sessioni S', async () => {
    rt.slots = [];
    server.richieste.length = 0;
    await monta();
    await entra();
    expect(etichette()).toEqual(['Ricerca', 'Documenti recenti']);
    expect(richieste().map((r) => r.sid[0])).toEqual(['D', 'D']);
  });

  it('una cartella dell\'albero apre la lista su un sid D, non su una sessione del gestionale', async () => {
    await entra();
    azzeraRichieste();
    const albero = find((p) => typeof p.onFolderClick === 'function');
    expect(albero, 'CdmsTree').toBeDefined();
    (albero!.props.onFolderClick as (id: string, nome: string) => void)('ROOT|abc-123', '2026');
    await assesta();
    const lista = richiestaDi('cdmsRisorseList');
    expect(lista).toHaveLength(1);
    expect(lista[0].sid).toMatch(/^D/);
    expect(lista[0].params.filter).toContain('abc-123');
  });
});

describe('SXADV-5789: le funzioni del documentale', () => {
  beforeEach(async () => {
    await gestionaleConDueSchede();
    await entra();
  });

  const FUNZIONI = [
    { tooltip: 'Cestino', viewName: 'cdmsRisorseListCestino', action: 'ListPage' },
    { tooltip: 'Gestione Profili', viewName: 'cdmsProfiliList', action: 'ListPage' },
    { tooltip: 'Gestione Utenti', viewName: 'cdmsUtentiList', action: 'ListPage' },
    { tooltip: 'Aggiungi Albero', viewName: 'cdmsNodiClassificazioneDetail', action: 'AddPage' },
  ];

  it.each(FUNZIONI)('3. $tooltip apre una scheda nuova in coda, chiudibile, attiva, su un suo sid D', async ({ tooltip, viewName, action }) => {
    const sidFissi = richieste().map((r) => r.sid);
    azzeraRichieste();
    await clicBarra(tooltip);
    expect(etichette().slice(0, 2)).toEqual(['Ricerca', 'Documenti recenti']);
    expect(barra().items).toHaveLength(3);
    const ultima = barra().items[2];
    expect(barra().activeKey).toBe(ultima.key);
    expect(ultima.closable).toBe(true);
    expect(richieste()).toHaveLength(1);
    const r = richieste()[0];
    expect(r.action).toBe(action);
    expect(r.params.viewName).toBe(viewName);
    expect(r.sid).toMatch(/^D/);
    expect(sidFissi).not.toContain(r.sid);
  });

  it('3. funzioni diverse: ognuna ha la sua scheda e il suo sid', async () => {
    azzeraRichieste();
    for (const f of FUNZIONI) await clicBarra(f.tooltip);
    expect(barra().items).toHaveLength(6);
    const sids = richieste().map((r) => r.sid);
    expect(new Set(sids).size).toBe(4);
    expect(sids.every((s) => s.startsWith('D'))).toBe(true);
  });

  // Contratto cambiato: come il legacy, richiederla la riapre da capo sul suo sid.
  it.each(FUNZIONI)('4. secondo clic su $tooltip: attiva la scheda esistente, niente doppioni, rifa\' la richiesta sullo stesso sid', async ({ tooltip, viewName, action }) => {
    await clicBarra(tooltip);
    const chiave = barra().activeKey;
    const sid = richieste().at(-1)!.sid;
    await vaiA('Ricerca');
    azzeraRichieste();
    await clicBarra(tooltip);
    expect(barra().items).toHaveLength(3);
    expect(barra().activeKey).toBe(chiave);
    expect(richieste()).toHaveLength(1);
    expect(richieste()[0]).toMatchObject({ action, sid, params: { viewName, newTask: '1' } });
  });

  it.each(FUNZIONI)('4. secondo clic su $tooltip mentre sta caricando: attiva soltanto, nessuna richiesta', async ({ tooltip }) => {
    let rilascia = () => {};
    server.attesa = new Promise<void>((r) => { rilascia = r; });
    try {
      await clicBarra(tooltip);
      const chiave = barra().activeKey;
      await vaiA('Ricerca');
      azzeraRichieste();
      await clicBarra(tooltip);
      expect(barra().items).toHaveLength(3);
      expect(barra().activeKey).toBe(chiave);
      expect(richieste()).toEqual([]);
    } finally {
      server.attesa = null;
      rilascia();
    }
    await assesta();
    expect(richieste()).toEqual([]);
  });

  it('Ricerca e Documenti recenti restano non chiudibili anche con altre schede aperte', async () => {
    await clicBarra('Cestino');
    expect(voce('Ricerca')!.closable).toBe(false);
    expect(voce('Documenti recenti')!.closable).toBe(false);
  });
});

describe('SXADV-5789: tornare al gestionale e rientrare', () => {
  beforeEach(gestionaleConDueSchede);

  it('5. ricompaiono Home e le schede di prima, attiva quella che lo era, nessuna richiesta', async () => {
    await vaiA('Fatturazione');
    await entra();
    await clicBarra('Cestino');
    azzeraRichieste();
    await esci();
    expect(etichette()).toEqual(['Home', 'Fatturazione', 'Magazzino']);
    expect(attiva()).toBe('Fatturazione');
    expect(richieste()).toEqual([]);
  });

  it('5. se era attiva la Home, torna la Home', async () => {
    await casetta();
    expect(attiva()).toBe('Home');
    await entra();
    azzeraRichieste();
    await esci();
    expect(etichette()).toEqual(['Home', 'Fatturazione', 'Magazzino']);
    expect(attiva()).toBe('Home');
    expect(richieste()).toEqual([]);
  });

  it('5. senza schede lavorate (entrata dalla Home) torna la Home, non una D', async () => {
    rt.slots = [];
    await monta();
    await entra();
    await esci();
    expect(attiva()).toBe('Home');
    expect(etichette()).not.toContain('Ricerca');
    expect(etichette()).not.toContain('Documenti recenti');
  });

  it('5. nel gestionale il + torna disponibile', async () => {
    await entra();
    await esci();
    expect(barra().hideAdd).toBeFalsy();
  });

  it('6. rientrando ricompaiono le stesse schede documentale con la stessa ultima attiva, senza richieste', async () => {
    await entra();
    await clicBarra('Cestino');
    await vaiA('Documenti recenti');
    const prima = barra().items.map((v) => v.key);
    await esci();
    azzeraRichieste();
    await entra();
    expect(barra().items.map((v) => v.key)).toEqual(prima);
    expect(etichette()).toEqual(['Ricerca', 'Documenti recenti', 'Cestino']);
    expect(attiva()).toBe('Documenti recenti');
    expect(richieste()).toEqual([]);
  });

  it('6. piu\' giri avanti e indietro non moltiplicano le schede', async () => {
    for (let i = 0; i < 3; i++) {
      await entra();
      await esci();
    }
    expect(etichette()).toEqual(['Home', 'Fatturazione', 'Magazzino']);
    await entra();
    expect(etichette()).toEqual(['Ricerca', 'Documenti recenti']);
    expect(richiestaDi('cdmsRisorseQuery')).toHaveLength(1);
    expect(richiestaDi('cdmsRisorseList')).toHaveLength(1);
  });
});

describe('SXADV-5789: chiudere le schede', () => {
  beforeEach(gestionaleConDueSchede);

  it('7. chiudendo una funzione si attiva un\'altra scheda del documentale, mai del gestionale', async () => {
    await entra();
    await clicBarra('Cestino');
    expect(attiva()).toBe('Cestino');
    await chiudi('Cestino');
    expect(etichette()).toEqual(['Ricerca', 'Documenti recenti']);
    expect(['Ricerca', 'Documenti recenti']).toContain(attiva());
  });

  it('7. chiudendo la funzione in mezzo, l\'attiva resta nel documentale', async () => {
    await entra();
    await clicBarra('Cestino');
    await clicBarra('Gestione Profili');
    await chiudi('Cestino');
    expect(etichette()).toEqual(['Ricerca', 'Documenti recenti', 'Gestione Profili']);
    expect(attiva()).toBe('Gestione Profili');
  });

  it('7. riaprendo la funzione chiusa si ha una scheda nuova con la sua richiesta', async () => {
    await entra();
    await clicBarra('Cestino');
    const vecchia = barra().activeKey;
    await chiudi('Cestino');
    azzeraRichieste();
    await clicBarra('Cestino');
    expect(barra().items).toHaveLength(3);
    expect(barra().activeKey).not.toBe(vecchia);
    expect(richiestaDi('cdmsRisorseListCestino')).toHaveLength(1);
    expect(richieste()[0].sid).toMatch(/^D/);
  });

  it('chiudendo l\'ultima scheda del gestionale di due si resta nel gestionale, mai in una D', async () => {
    await entra();
    await esci();
    await chiudi('Magazzino');
    expect(etichette()).toEqual(['Home', 'Fatturazione']);
    expect(attiva()).toBe('Fatturazione');
  });

  it("l'unica scheda del gestionale resta non chiudibile anche con schede documentale aperte", async () => {
    await chiudi('Magazzino');
    await entra();
    await esci();
    expect(voce('Fatturazione')!.closable).toBe(false);
  });
});

describe('SXADV-5789: limite di sessioni', () => {
  it('le schede documentale non contano: col gestionale pieno si entra, e il + resta segnalato come pieno', async () => {
    rt.slots = [];
    await monta({ sessionLimit: 2 });
    await gestionaleConDueSchede();
    expect(barra().className).toContain('session-tabs-full');
    await entra();
    expect(etichette()).toEqual(['Ricerca', 'Documenti recenti']);
    expect(richieste()).toHaveLength(2);
    expect(fb.avvisi).toEqual([]);
    await esci();
    expect(barra().className).toContain('session-tabs-full');
    await aggiungiScheda();
    expect(etichette()).toEqual(['Home', 'Fatturazione', 'Magazzino']);
    expect(fb.avvisi).toHaveLength(1);
  });

  it('col gestionale pieno le funzioni del documentale si aprono lo stesso', async () => {
    rt.slots = [];
    await monta({ sessionLimit: 2 });
    await gestionaleConDueSchede();
    await entra();
    await clicBarra('Cestino');
    expect(etichette()).toEqual(['Ricerca', 'Documenti recenti', 'Cestino']);
    expect(fb.avvisi).toEqual([]);
  });

  it("con schede documentale aperte e gestionale sotto il limite, il + aggiunge una scheda con sid S", async () => {
    rt.slots = [];
    await monta({ sessionLimit: 3 });
    await gestionaleConDueSchede();
    await entra();
    await clicBarra('Cestino');
    await clicBarra('Gestione Profili');
    await esci();
    expect(barra().className).not.toContain('session-tabs-full');
    await aggiungiScheda();
    expect(fb.avvisi).toEqual([]);
    expect(barra().items).toHaveLength(4);
    azzeraRichieste();
    await voceDiMenu('menu.cli');
    expect(richieste()).toHaveLength(1);
    expect(richieste()[0].sid).toMatch(/^S/);
    // Non e' una delle due di prima.
    expect(etichette()).toEqual(['Home', 'Fatturazione', 'Magazzino', 'Clienti']);
  });
});

describe('SXADV-5789: la casetta nel documentale', () => {
  const homePanel = () => {
    const h = find((p) => typeof p.onBannerClick === 'function');
    expect(h, 'HomePanel').toBeDefined();
    return h!.props as {
      onBannerClick: (to: string) => void;
      onNaviga: (titolo: string, id: number) => unknown;
    };
  };

  it('torna al gestionale con la Home attiva, senza richieste', async () => {
    await gestionaleConDueSchede();
    await entra();
    azzeraRichieste();
    await casetta();
    expect(haBarra('Documentale')).toBe(true);
    expect(etichette()).toEqual(['Home', 'Fatturazione', 'Magazzino']);
    expect(attiva()).toBe('Home');
    expect(richieste()).toEqual([]);
  });

  it('una voce di menu dalla Home, dopo la casetta, finisce in una scheda del gestionale', async () => {
    await gestionaleConDueSchede();
    await entra();
    await clicBarra('Cestino'); // l'ultima scheda lavorata e' una D
    await casetta();
    azzeraRichieste();
    homePanel().onBannerClick('menu.cli');
    await assesta();
    expect(richieste()).toHaveLength(1);
    expect(richieste()[0].action).toBe('ExecuteMenuItem');
    expect(richieste()[0].sid).toMatch(/^S/);
    expect(haBarra('Documentale')).toBe(true);
    expect(etichette()).not.toContain('Cestino');
  });

  it('lo stesso quando nel gestionale non si era mai lavorato (entrata diretta dalla Home)', async () => {
    await entra();
    await casetta();
    azzeraRichieste();
    homePanel().onBannerClick('menu.cli');
    await assesta();
    expect(richieste()).toHaveLength(1);
    expect(richieste()[0].sid).toMatch(/^S/);
    expect(attiva()).toBe('Clienti');
  });

  it('anche un ingresso da widget (Naviga) dopo la casetta parte su una S', async () => {
    await entra();
    await clicBarra('Cestino');
    await casetta();
    azzeraRichieste();
    homePanel().onNaviga('Il widget', 7);
    await assesta();
    expect(richieste()).toHaveLength(1);
    expect(richieste()[0].sid).toMatch(/^S/);
  });
});

describe('SXADV-5789: avviso con una voce di menu mentre si e\' nel documentale', () => {
  const conBanner = {
    loginInfo: { ...LOGIN, banners: [{ text: 'Avviso', navigateTo: 'menu.cli' }] } as LoginInfo,
  };

  // La notifica nasce all'ingresso nell'app, col gestore di quel momento, e il clic
  // arriva quando l'utente e' ormai altrove: e' il caso reale del documentale.
  it('porta al gestionale e la richiesta parte su un sid S', async () => {
    rt.slots = [];
    await monta(conBanner);
    expect(notifiche.arrivate.length, 'la notifica dell\'avviso').toBeGreaterThan(0);
    await entra();
    await clicBarra('Cestino');
    azzeraRichieste();
    notifiche.arrivate[0].onClick!();
    await assesta();
    expect(haBarra('Documentale'), 'si e\' tornati nel gestionale').toBe(true);
    const menu = richieste().filter((r) => r.action === 'ExecuteMenuItem');
    expect(menu).toHaveLength(1);
    expect(menu[0].sid).toMatch(/^S/);
    expect(richieste().filter((r) => r.sid.startsWith('D'))).toEqual([]);
    expect(etichette()).not.toContain('Cestino');
    expect(attiva()).toBe('Clienti');
  });

  it('e le schede documentale restano li\' per quando si rientra', async () => {
    rt.slots = [];
    await monta(conBanner);
    await entra();
    await clicBarra('Cestino');
    notifiche.arrivate[0].onClick!();
    await assesta();
    azzeraRichieste();
    await entra();
    expect(etichette()).toEqual(['Ricerca', 'Documenti recenti', 'Cestino']);
    expect(attiva()).toBe('Cestino');
    expect(richieste()).toEqual([]);
  });
});
