import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import type { LoginInfo, MenuItem, SessionPanel, ToolbarItem } from '../types/ui';

// Chiudere una scheda di sessione con modifiche non salvate. La «x» della scheda
// (onEdit 'remove' delle Tabs editable-card) oggi chiude subito e manda
// CloseSession: il lavoro non salvato si perde senza avviso. Il contratto: se la
// toolbar DI QUELLA scheda contiene «Annulla» abilitato (handler
// doAction.createCallback('Cancel'), disabled = !session.isDirty()), prima si
// chiede conferma col feedback; OK chiude come oggi, Annulla lascia tutto com'era.
//
// La «x» la disegna antd dentro Tabs: senza DOM non si puo' cliccare, quindi si
// chiama la onEdit che la Shell passa a Tabs, come fa antd al clic.
//
// Motore preso da Shell.documentale2.sxadv5789.test.tsx (la Shell si esegue come
// funzione, gli effetti girano davvero).

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
  domande: [] as { question: string; text: string; onOk: () => void; onCancel?: () => void }[],
  server: [] as unknown[],
  avvisi: [] as string[],
}));

vi.mock('../hooks/feedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/feedback')>()),
  useFeedback: () => ({
    showServerMessages: (errors: unknown[]) => { fb.server.push(errors); },
    error: (e: unknown) => { fb.server.push(e); },
    warning: (m: string) => { fb.avvisi.push(m); },
    info: () => {},
    failure: (e: unknown) => { fb.server.push(e); },
    confirm: (question: string, text: string, onOk: () => void, onCancel?: () => void) => {
      fb.domande.push({ question, text, onOk, onCancel });
    },
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
  richieste: [] as { action: string; params: Record<string, string>; sid: string }[],
  azioni2: [] as { action: string; params: Record<string, string> }[],
  toolbar: new Map<string, unknown[]>(),
  /** Esiti preparati per PendingChanges, in fila: un valore, un Error (= reject), una Promise (= in volo). Fila vuota = {}. */
  pending: [] as unknown[],
}));

vi.mock('../services/api', async (importOriginal) => {
  const risposta = (viewName: string, title: string) => ({
    ui: { rows: [], path: `${viewName}-path`, pageType: 1, viewName, title },
    toolbar: server.toolbar.get(viewName) ?? [],
    uiData: {},
  });
  return {
    ...(await importOriginal<typeof import('../services/api')>()),
    postAction: async (action: string, params: Record<string, string> = {}, _fv: unknown, sid = 'S1') => {
      server.richieste.push({ action, params: { ...params }, sid });
      return risposta(params.viewName ?? action, params.title ?? action);
    },
    executeMenuItem: async (menuId: string, sid = 'S1') => {
      server.richieste.push({ action: 'ExecuteMenuItem', params: { menuId }, sid });
      return risposta(menuId, menuId);
    },
    postAction2: async (action: string, params: Record<string, string> = {}) => {
      server.azioni2.push({ action, params: { ...params } });
      if (action === 'PendingChanges' && server.pending.length > 0) {
        const r = await server.pending.shift();
        if (r instanceof Error) throw r;
        return r;
      }
      return {};
    },
    checkProgress: async () => risposta('job', 'Fine job'),
    subscribeInFlight: () => () => {},
  };
});

vi.mock('../services/notifications', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>().catch(() => ({}));
  return { ...actual, notify: () => {} };
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
];
const LOGIN: LoginInfo = { login: '44AMM' } as LoginInfo;

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
/** Il clic sulla «x» della scheda: antd chiama onEdit(chiave, 'remove'). */
async function chiudi(etichetta: string): Promise<void> {
  const v = voce(etichetta);
  expect(v, `la scheda "${etichetta}"`).toBeDefined();
  expect(v!.closable, `la scheda "${etichetta}" ha la x`).not.toBe(false);
  barra().onEdit(v!.key, 'remove');
  await assesta();
}
async function vaiA(etichetta: string): Promise<void> {
  const v = voce(etichetta);
  expect(v, `la scheda "${etichetta}"`).toBeDefined();
  barra().onChange(v!.key);
  await assesta();
}

type Scheda = { key: string; sid: string; label: string; toolbar?: unknown[]; formValues: Record<string, unknown> };
const schede = (): Scheda[] =>
  rt.slots.find((s) => Array.isArray(s.v) && (s.v as Scheda[])[0]?.sid !== undefined && (s.v as Scheda[])[0]?.formValues !== undefined)!.v as Scheda[];
const scheda = (etichetta: string): Scheda => {
  const t = schede().find((x) => x.label === etichetta);
  expect(t, `lo stato della scheda "${etichetta}"`).toBeDefined();
  return t!;
};
const sidChiusi = () => server.azioni2.filter((a) => a.action === 'CloseSession').map((a) => a.params.sid);

const DOMANDA = 'Ci sono modifiche non salvate. Si desidera vengano annullate TUTTE le modifiche?';

/** La toolbar vera di CORE: pulsanti, separatori, il paginatore. */
const toolbar = (sporca: boolean): ToolbarItem[] =>
  [
    { id: 'tb1', text: 'Salva', handler: "doAction.createCallback('Save')", disabled: !sporca },
    { id: 'tb2', text: 'Annulla', handler: "doAction.createCallback('Cancel')", disabled: !sporca },
    '-',
    'pag:',
    { tag: 'input', value: '1' },
    { html: '<span>di 1</span>' },
  ] as unknown as ToolbarItem[];

/** La prossima risposta della voce di menu porta questa toolbar. */
const conToolbar = (menuId: string, sporca: boolean) => server.toolbar.set(menuId, toolbar(sporca));

const domanda = () => {
  const d = fb.domande.at(-1);
  expect(d, 'la finestra di conferma').toBeDefined();
  return d!;
};

async function monta(extra: Partial<Props> = {}): Promise<void> {
  props = { menuItems: MENU, loginInfo: LOGIN, onLogout: noop, onReloadMenu: noop, ...extra };
  await assesta();
}

/** Due schede del gestionale: Fatturazione, poi Magazzino (attiva). */
async function dueSchede(fat: boolean | null, mag: boolean | null): Promise<void> {
  if (fat !== null) conToolbar('menu.fat', fat);
  if (mag !== null) conToolbar('menu.mag', mag);
  await voceDiMenu('menu.fat');
  await aggiungiScheda();
  await voceDiMenu('menu.mag');
  expect(etichette()).toEqual(['Home', 'Fatturazione', 'Magazzino']);
  expect(attiva()).toBe('Magazzino');
  server.azioni2.length = 0;
  fb.domande.length = 0;
}

beforeEach(async () => {
  rt.slots = [];
  rt.effects = [];
  server.richieste.length = 0;
  server.azioni2.length = 0;
  server.toolbar.clear();
  server.pending.length = 0;
  fb.domande.length = 0;
  fb.server.length = 0;
  fb.avvisi.length = 0;
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true, writable: true,
    value: { getItem: () => null, setItem: noop, removeItem: noop },
  });
  await monta();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────── le prove

describe('A. il motore: la toolbar arriva nello stato della scheda', () => {
  it('ogni scheda tiene la toolbar della sua risposta', async () => {
    await dueSchede(true, false);
    expect(scheda('Fatturazione').toolbar).toEqual(toolbar(true));
    expect(scheda('Magazzino').toolbar).toEqual(toolbar(false));
  });
});

describe('B. scheda senza modifiche: si chiude subito, come oggi', () => {
  it('Annulla disabilitato: chiusa, CloseSession col suo sid, nessuna domanda', async () => {
    await dueSchede(false, false);
    const sid = scheda('Magazzino').sid;
    await chiudi('Magazzino');
    expect(fb.domande).toEqual([]);
    expect(etichette()).toEqual(['Home', 'Fatturazione']);
    expect(sidChiusi()).toEqual([sid]);
    expect(attiva()).toBe('Fatturazione');
  });

  it('toolbar senza Annulla: chiusa subito', async () => {
    server.toolbar.set('menu.mag', ['pag:', { id: 'x', text: 'Stampa', handler: "doAction.createCallback('Print')" }]);
    await dueSchede(null, null);
    const sid = scheda('Magazzino').sid;
    await chiudi('Magazzino');
    expect(fb.domande).toEqual([]);
    expect(sidChiusi()).toEqual([sid]);
  });

  it('toolbar vuota: chiusa subito', async () => {
    await dueSchede(null, null);
    await chiudi('Fatturazione');
    expect(fb.domande).toEqual([]);
    expect(etichette()).toEqual(['Home', 'Magazzino']);
    expect(sidChiusi()).toHaveLength(1);
  });

  it('una scheda non attiva senza modifiche si chiude subito anche se quella attiva ne ha', async () => {
    await dueSchede(false, true);
    const sid = scheda('Fatturazione').sid;
    await chiudi('Fatturazione');
    expect(fb.domande).toEqual([]);
    expect(sidChiusi()).toEqual([sid]);
    expect(attiva()).toBe('Magazzino');
  });
});

describe('C. scheda attiva con modifiche', () => {
  it('la x non chiude: compare la domanda, la scheda resta, nessun CloseSession', async () => {
    await dueSchede(false, true);
    await chiudi('Magazzino');
    expect(fb.domande).toHaveLength(1);
    expect(etichette()).toEqual(['Home', 'Fatturazione', 'Magazzino']);
    expect(attiva()).toBe('Magazzino');
    expect(sidChiusi()).toEqual([]);
  });

  it('il testo della domanda e\' esattamente quello del contratto', async () => {
    await dueSchede(false, true);
    await chiudi('Magazzino');
    const d = domanda();
    expect([d.question, d.text], 'la domanda come question o come text del confirm').toContain(DOMANDA);
  });

  it('OK: la scheda si chiude, CloseSession col suo sid, si passa alla vicina', async () => {
    await dueSchede(false, true);
    const sid = scheda('Magazzino').sid;
    await chiudi('Magazzino');
    domanda().onOk();
    await assesta();
    expect(etichette()).toEqual(['Home', 'Fatturazione']);
    expect(sidChiusi()).toEqual([sid]);
    expect(attiva()).toBe('Fatturazione');
  });

  it('Annulla: la scheda resta attiva, nessun CloseSession, stato intatto', async () => {
    await dueSchede(false, true);
    const prima = scheda('Magazzino');
    await chiudi('Magazzino');
    domanda().onCancel?.();
    await assesta();
    expect(etichette()).toEqual(['Home', 'Fatturazione', 'Magazzino']);
    expect(attiva()).toBe('Magazzino');
    expect(sidChiusi()).toEqual([]);
    expect(scheda('Magazzino').sid).toBe(prima.sid);
    expect(scheda('Magazzino').toolbar).toEqual(toolbar(true));
  });

  it('Annulla e poi di nuovo la x: la domanda si ripete', async () => {
    await dueSchede(false, true);
    await chiudi('Magazzino');
    domanda().onCancel?.();
    await assesta();
    await chiudi('Magazzino');
    expect(fb.domande).toHaveLength(2);
    expect(sidChiusi()).toEqual([]);
  });
});

describe('D. scheda NON attiva con modifiche', () => {
  it('la x chiede conferma anche se la scheda non e\' quella attiva', async () => {
    await dueSchede(true, false);
    await chiudi('Fatturazione');
    expect(fb.domande).toHaveLength(1);
    expect([domanda().question, domanda().text]).toContain(DOMANDA);
    expect(etichette()).toEqual(['Home', 'Fatturazione', 'Magazzino']);
    expect(sidChiusi()).toEqual([]);
  });

  it('OK: si chiude quella, CloseSession col SUO sid, la scheda attiva non cambia', async () => {
    await dueSchede(true, false);
    const sid = scheda('Fatturazione').sid;
    await chiudi('Fatturazione');
    domanda().onOk();
    await assesta();
    expect(etichette()).toEqual(['Home', 'Magazzino']);
    expect(sidChiusi()).toEqual([sid]);
    expect(attiva()).toBe('Magazzino');
  });

  it('Annulla: resta, nessun CloseSession, la scheda attiva non cambia', async () => {
    await dueSchede(true, false);
    await chiudi('Fatturazione');
    domanda().onCancel?.();
    await assesta();
    expect(etichette()).toEqual(['Home', 'Fatturazione', 'Magazzino']);
    expect(sidChiusi()).toEqual([]);
    expect(attiva()).toBe('Magazzino');
  });

  it('la domanda guarda la toolbar della scheda chiusa, non quella attiva', async () => {
    // Attiva sporca, chiusa pulita (gia' in B) e viceversa: qui la pulita e' attiva.
    await dueSchede(true, false);
    await vaiA('Fatturazione');
    fb.domande.length = 0;
    await chiudi('Magazzino');
    expect(fb.domande).toEqual([]);
    expect(etichette()).toEqual(['Home', 'Fatturazione']);
  });

  it('OK dopo aver cambiato scheda nel frattempo: si chiude quella giusta, l\'attiva resta', async () => {
    await dueSchede(true, false);
    const sid = scheda('Fatturazione').sid;
    await chiudi('Fatturazione');
    await vaiA('Home');
    domanda().onOk();
    await assesta();
    expect(etichette()).toEqual(['Home', 'Magazzino']);
    expect(sidChiusi()).toEqual([sid]);
    expect(attiva()).toBe('Home');
  });
});

describe('E. la Home', () => {
  it('la Home non ha la x', async () => {
    await dueSchede(true, true);
    expect(voce('Home')!.closable).toBe(false);
  });
});

// ─────────────────────────────────────── contratto allargato: digitato e server

const chiestiPending = () => server.azioni2.filter((a) => a.action === 'PendingChanges').map((a) => a.params.sid);

const videata = () => {
  const v = find((p) => typeof p.onGridChange === 'function');
  expect(v, 'la videata della scheda attiva').toBeDefined();
  return v!.props as {
    onChange: (n: string, v: unknown) => void;
    onAction: (a: string, p?: Record<string, string>) => Promise<unknown>;
  };
};

/** Batte un campo nella scheda attiva, col percorso normale (onChange della videata). */
async function batti(nome = 'note', valore: unknown = 'bozza'): Promise<void> {
  videata().onChange(nome, valore);
  await assesta();
}

/** Trattiene la prossima risposta a PendingChanges: torna la funzione che la rilascia. */
function pendingInVolo(): (r?: unknown) => void {
  let rilascia: (r: unknown) => void = () => {};
  server.pending.push(new Promise((res) => { rilascia = res; }));
  return (r: unknown = {}) => rilascia(r);
}

describe('F. digitato non spedito', () => {
  it('campo battuto e nessuna richiesta dopo: la x chiede anche con Annulla spento', async () => {
    await dueSchede(false, false);
    await batti();
    await chiudi('Magazzino');
    expect(fb.domande).toHaveLength(1);
    expect([domanda().question, domanda().text]).toContain(DOMANDA);
    expect(etichette()).toContain('Magazzino');
    expect(sidChiusi()).toEqual([]);
  });

  it('con digitato pendente non parte PendingChanges: la domanda e\' subito', async () => {
    await dueSchede(false, false);
    await batti();
    await chiudi('Magazzino');
    expect(chiestiPending()).toEqual([]);
    expect(fb.domande).toHaveLength(1);
  });

  it('digitato pendente, OK: chiude con CloseSession del suo sid', async () => {
    await dueSchede(false, false);
    const sid = scheda('Magazzino').sid;
    await batti();
    await chiudi('Magazzino');
    domanda().onOk();
    await assesta();
    expect(etichette()).toEqual(['Home', 'Fatturazione']);
    expect(sidChiusi()).toEqual([sid]);
  });

  it('digitato pendente, Annulla: la scheda resta, nessun CloseSession', async () => {
    await dueSchede(false, false);
    await batti();
    await chiudi('Magazzino');
    domanda().onCancel?.();
    await assesta();
    expect(etichette()).toContain('Magazzino');
    expect(attiva()).toBe('Magazzino');
    expect(sidChiusi()).toEqual([]);
  });

  it('il digitato e\' per scheda: battuto in A, chiudendo B (pulita) non si chiede', async () => {
    await dueSchede(false, false);
    await vaiA('Fatturazione');
    await batti();
    await vaiA('Magazzino');
    fb.domande.length = 0;
    const sid = scheda('Magazzino').sid;
    await chiudi('Magazzino');
    expect(fb.domande).toEqual([]);
    expect(sidChiusi()).toEqual([sid]);
  });

  it('il digitato di A resta di A: battuto in A, si va in B, chiudendo A si chiede', async () => {
    await dueSchede(false, false);
    await vaiA('Fatturazione');
    await batti();
    await vaiA('Magazzino');
    await chiudi('Fatturazione');
    expect(fb.domande).toHaveLength(1);
    expect(sidChiusi()).toEqual([]);
    expect(chiestiPending()).toEqual([]);
  });

  it('dopo una richiesta partita da A con i valori il digitato di A non conta piu\'', async () => {
    await dueSchede(false, false);
    const sid = scheda('Magazzino').sid;
    await batti();
    await videata().onAction('Post', {});
    await assesta();
    expect(server.richieste.some((r) => r.action === 'Post' && r.sid === sid), 'il Post e\' partito dalla scheda').toBe(true);
    fb.domande.length = 0;
    await chiudi('Magazzino');
    expect(fb.domande).toEqual([]);
    expect(sidChiusi()).toEqual([sid]);
  });
});

describe('G. chiedere al server: PendingChanges', () => {
  it('niente digitato e Annulla spento: prima di chiudere parte PendingChanges col sid della scheda', async () => {
    await dueSchede(false, false);
    const sid = scheda('Magazzino').sid;
    await chiudi('Magazzino');
    expect(chiestiPending()).toEqual([sid]);
    const ordine = server.azioni2.map((a) => a.action);
    expect(ordine.indexOf('PendingChanges')).toBeLessThan(ordine.indexOf('CloseSession'));
  });

  it('PendingChanges di una scheda non attiva porta il SUO sid', async () => {
    await dueSchede(false, false);
    const sid = scheda('Fatturazione').sid;
    await chiudi('Fatturazione');
    expect(chiestiPending()).toEqual([sid]);
  });

  it('{modifiche: true}: domanda, la scheda resta, nessun CloseSession', async () => {
    server.pending.push({ modifiche: true });
    await dueSchede(false, false);
    await chiudi('Magazzino');
    expect(fb.domande).toHaveLength(1);
    expect([domanda().question, domanda().text]).toContain(DOMANDA);
    expect(etichette()).toContain('Magazzino');
    expect(sidChiusi()).toEqual([]);
  });

  it('{modifiche: true}, OK: chiude con CloseSession del suo sid', async () => {
    server.pending.push({ modifiche: true });
    await dueSchede(false, false);
    const sid = scheda('Magazzino').sid;
    await chiudi('Magazzino');
    domanda().onOk();
    await assesta();
    expect(etichette()).toEqual(['Home', 'Fatturazione']);
    expect(sidChiusi()).toEqual([sid]);
  });

  it('{modifiche: true}, Annulla: nessun CloseSession, scheda attiva invariata', async () => {
    server.pending.push({ modifiche: true });
    await dueSchede(false, false);
    await chiudi('Magazzino');
    domanda().onCancel?.();
    await assesta();
    expect(sidChiusi()).toEqual([]);
    expect(etichette()).toContain('Magazzino');
    expect(attiva()).toBe('Magazzino');
  });

  it('{modifiche: false}: chiude subito con CloseSession, nessuna domanda', async () => {
    server.pending.push({ modifiche: false });
    await dueSchede(false, false);
    const sid = scheda('Magazzino').sid;
    await chiudi('Magazzino');
    expect(fb.domande).toEqual([]);
    expect(sidChiusi()).toEqual([sid]);
    expect(etichette()).toEqual(['Home', 'Fatturazione']);
  });

  it('risposta senza il campo modifiche: chiude subito, nessuna domanda', async () => {
    server.pending.push({});
    await dueSchede(false, false);
    const sid = scheda('Magazzino').sid;
    await chiudi('Magazzino');
    expect(fb.domande).toEqual([]);
    expect(sidChiusi()).toEqual([sid]);
  });

  it('PendingChanges fallita: chiude come prima', async () => {
    server.pending.push(new Error('rete'));
    await dueSchede(false, false);
    const sid = scheda('Magazzino').sid;
    await chiudi('Magazzino');
    expect(fb.domande).toEqual([]);
    expect(sidChiusi()).toEqual([sid]);
    expect(etichette()).toEqual(['Home', 'Fatturazione']);
  });

  it('con Annulla acceso non parte PendingChanges: la domanda e\' subito', async () => {
    await dueSchede(false, true);
    await chiudi('Magazzino');
    expect(chiestiPending()).toEqual([]);
    expect(fb.domande).toHaveLength(1);
  });

  it('mentre PendingChanges e\' in volo la scheda non e\' ancora chiusa', async () => {
    const rilascia = pendingInVolo();
    await dueSchede(false, false);
    await chiudi('Magazzino');
    expect(etichette()).toContain('Magazzino');
    expect(sidChiusi()).toEqual([]);
    rilascia({ modifiche: false });
    await assesta();
    expect(etichette()).toEqual(['Home', 'Fatturazione']);
    expect(sidChiusi()).toHaveLength(1);
  });
});

describe('H. doppio clic e domande doppie', () => {
  it('doppio clic sulla x con PendingChanges in volo: una sola PendingChanges, un solo CloseSession', async () => {
    const rilascia = pendingInVolo();
    await dueSchede(false, false);
    const sid = scheda('Magazzino').sid;
    const k = voce('Magazzino')!.key;
    barra().onEdit(k, 'remove');
    barra().onEdit(k, 'remove');
    await assesta();
    rilascia({ modifiche: false });
    await assesta();
    expect(chiestiPending()).toEqual([sid]);
    expect(sidChiusi()).toEqual([sid]);
  });

  it('doppio clic con PendingChanges in volo che risponde modifiche: una sola domanda', async () => {
    const rilascia = pendingInVolo();
    await dueSchede(false, false);
    const k = voce('Magazzino')!.key;
    barra().onEdit(k, 'remove');
    barra().onEdit(k, 'remove');
    await assesta();
    rilascia({ modifiche: true });
    await assesta();
    expect(chiestiPending()).toHaveLength(1);
    expect(fb.domande).toHaveLength(1);
  });

  it('due domande aperte sulla stessa scheda, OK su entrambe: un solo CloseSession', async () => {
    await dueSchede(false, true);
    const sid = scheda('Magazzino').sid;
    const k = voce('Magazzino')!.key;
    barra().onEdit(k, 'remove');
    barra().onEdit(k, 'remove');
    await assesta();
    expect(fb.domande.length).toBeGreaterThanOrEqual(1);
    for (const d of [...fb.domande]) { d.onOk(); await assesta(); }
    expect(sidChiusi()).toEqual([sid]);
    expect(etichette()).toEqual(['Home', 'Fatturazione']);
  });

  it('due domande aperte, OK sulla seconda dopo che la prima ha chiuso: la scheda attiva non salta', async () => {
    await dueSchede(true, true);
    await vaiA('Fatturazione');
    const k = voce('Magazzino')!.key;
    barra().onEdit(k, 'remove');
    barra().onEdit(k, 'remove');
    await assesta();
    for (const d of [...fb.domande]) { d.onOk(); await assesta(); }
    expect(etichette()).toEqual(['Home', 'Fatturazione']);
    expect(attiva()).toBe('Fatturazione');
  });
});
