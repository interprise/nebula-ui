import { describe, it, expect, vi, beforeEach } from 'vitest';

// SXADV-5963 — il pulsante "Gestione Profili" della barra verticale apre una
// scheda intitolata esattamente "Gestione Profili" (non "Gestione Profili
// Menu"), e al server continua ad andare ProfileManager con navpath 'menu'.
//
// Stesso motore di Shell.menuConfirm.sxadv5952.test.tsx: niente DOM, la Shell si
// esegue come funzione e l'albero che restituisce si cammina come dato. Il
// pulsante si trova dal tooltip e si preme il suo onClick, cosi' si prova il
// pulsante vero e non la costante del titolo.

const rt = vi.hoisted(() => ({
  active: false,
  i: 0,
  slots: [] as { v: unknown }[],
  effects: [] as (() => unknown)[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  type AnyFn = (...a: never[]) => unknown;
  const slot = (init: () => unknown) => {
    const i = rt.i++;
    if (!rt.slots[i]) rt.slots[i] = { v: init() };
    return rt.slots[i];
  };
  const on = <F extends AnyFn>(real: F, fake: AnyFn): F =>
    ((...a: never[]) => (rt.active ? fake(...a) : real(...a))) as unknown as F;
  const over = {
    useState: on(actual.useState as AnyFn, ((init: unknown) => {
      const s = slot(() => (typeof init === 'function' ? (init as () => unknown)() : init));
      const set = (nv: unknown) => {
        s.v = typeof nv === 'function' ? (nv as (p: unknown) => unknown)(s.v) : nv;
      };
      return [s.v, set];
    }) as AnyFn),
    useReducer: on(actual.useReducer as AnyFn, ((reducer: (s: unknown, a: unknown) => unknown, init: unknown) => {
      const s = slot(() => init);
      return [s.v, (a: unknown) => { s.v = reducer(s.v, a); }];
    }) as AnyFn),
    useRef: on(actual.useRef as AnyFn, ((init: unknown) => slot(() => ({ current: init })).v) as AnyFn),
    useCallback: on(actual.useCallback as AnyFn, ((fn: AnyFn) => fn) as AnyFn),
    useMemo: on(actual.useMemo as AnyFn, ((f: () => unknown) => f()) as AnyFn),
    // Gli effetti non partono da soli: si tengono per rieseguire l'ingresso dalla Home.
    useEffect: on(actual.useEffect as AnyFn, ((fn: () => unknown) => { rt.effects.push(fn); }) as AnyFn),
    useLayoutEffect: on(actual.useLayoutEffect as AnyFn, (() => {}) as AnyFn),
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
    showServerMessages: () => {}, error: () => {}, warning: () => {}, info: () => {}, failure: () => {},
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
  postAction: [] as { action: string; params: Record<string, string> }[],
  next: [] as unknown[],
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  postAction: async (action: string, params: Record<string, string>) => {
    server.postAction.push({ action, params: { ...params } });
    return server.next.shift() ?? {};
  },
  executeMenuItem: async () => server.next.shift() ?? {},
  subscribeInFlight: () => () => {},
}));

const { default: Shell } = await import('./Shell');
const { clearTemplates } = await import('../services/templateCache');

class FakeHTMLElement {}
Object.assign(globalThis, {
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  HTMLElement: (globalThis as { HTMLElement?: unknown }).HTMLElement ?? FakeHTMLElement,
  document: (globalThis as { document?: unknown }).document ?? {
    body: { style: {} },
    activeElement: null,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  },
});

type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } };

const props = { menuItems: [], loginInfo: { login: '44AMM' }, onLogout: () => {}, onReloadMenu: () => {} };

let tree: unknown;

function render(): void {
  rt.active = true;
  rt.i = 0;
  rt.effects = [];
  try {
    tree = (Shell as unknown as (p: typeof props) => unknown)(props);
  } finally {
    rt.active = false;
  }
}

/** Gli elementi dell'albero, figli soltanto: i componenti non si eseguono. */
function elements(node: unknown, out: El[] = []): El[] {
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const n of node) elements(n, out);
    return out;
  }
  const el = node as El;
  if ((el as unknown as { $$typeof?: unknown }).$$typeof !== undefined && el.props) {
    out.push(el);
    elements(el.props.children, out);
  }
  return out;
}

/** Il Button della barra sotto il tooltip dato: quello che l'utente preme. */
function pulsanteBarra(tooltip: string): El {
  const bar = elements(tree).find((e) => e.props.className === 'app-bar');
  expect(bar, 'la app bar non e\' stata resa').toBeDefined();
  const sotto = elements(bar!.props.children).filter((e) => e.props.title === tooltip);
  expect(sotto, `pulsanti col tooltip "${tooltip}"`).toHaveLength(1);
  const btn = elements(sotto[0].props.children).find((e) => typeof e.props.onClick === 'function');
  expect(btn, 'il pulsante sotto il tooltip').toBeDefined();
  return btn!;
}

type Tab = { key: string; label: string; menuId?: string; functionAction?: string };

const tab = (): Tab => {
  const tabs = rt.slots.find((s) => Array.isArray(s.v) && (s.v as { key?: string }[])[0]?.key === 'tab_1');
  return (tabs!.v as Tab[])[0];
};

const settle = () => new Promise((r) => setTimeout(r, 0));

async function premi(): Promise<void> {
  render();
  (pulsanteBarra('Gestione Profili').props.onClick as () => void)();
  await settle();
  render();
}

/** Una risposta del server a ProfileManager. */
const pagina = (title?: string) => ({
  ui: { rows: [], pageType: 0, path: 'S1-3', viewName: 'gestorePrivilegiDetail', viewType: 'detail', ...(title ? { title } : {}) },
  toolbar: [],
});

function sceglieSchedaDiLavoro(): void {
  const active = rt.slots.find((s) => s.v === 'home');
  active!.v = 'tab_1';
  render();
}

beforeEach(() => {
  rt.slots = [];
  server.postAction = [];
  server.next = [];
  clearTemplates();
  render();
});

describe('SXADV-5963: pulsante Gestione Profili della barra', () => {
  it('da una scheda di lavoro: la scheda si intitola esattamente "Gestione Profili"', async () => {
    sceglieSchedaDiLavoro();
    server.next.push(pagina());
    await premi();
    expect(tab().label).toBe('Gestione Profili');
  });

  it('manda sempre ProfileManager con navpath "menu", una volta sola e ripartendo da zero', async () => {
    sceglieSchedaDiLavoro();
    server.next.push(pagina());
    await premi();
    expect(server.postAction).toHaveLength(1);
    expect(server.postAction[0].action).toBe('ProfileManager');
    expect(server.postAction[0].params.navpath).toBe('menu');
    expect(server.postAction[0].params.newTask).toBe('1');
  });

  it('la scheda ricorda la funzione e il pulsante risulta acceso, senza voce di menu', async () => {
    sceglieSchedaDiLavoro();
    server.next.push(pagina());
    await premi();
    expect(tab().functionAction).toBe('ProfileManager');
    expect(tab().menuId).toBeUndefined();
    expect(pulsanteBarra('Gestione Profili').props['aria-current']).toBe('true');
  });

  it('il titolo resta anche quando il server risponde con un suo ui.title', async () => {
    sceglieSchedaDiLavoro();
    server.next.push(pagina('Gestione Profili Menu'));
    await premi();
    expect(tab().label).toBe('Gestione Profili');
  });

  it('dalla Home: stesso titolo e stessa richiesta, sulla scheda di lavoro', async () => {
    server.next.push(pagina());
    await premi();
    // entraDallaHome rimanda l'apertura all'effetto che gira con la scheda attiva.
    const ingresso = rt.effects.filter((f) => f.toString().includes('ingressoRef.current'));
    expect(ingresso.length).toBeGreaterThan(0);
    for (const f of ingresso) f();
    await settle();
    render();
    expect(tab().label).toBe('Gestione Profili');
    expect(server.postAction).toHaveLength(1);
    expect(server.postAction[0].action).toBe('ProfileManager');
    expect(server.postAction[0].params.navpath).toBe('menu');
  });
});
