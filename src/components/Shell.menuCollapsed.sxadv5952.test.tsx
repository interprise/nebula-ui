import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import type { MenuItem } from '../types/ui';

// SXADV-5952 — menu compresso con una ricerca attiva. La casella "Cerca nel
// menu..." sparisce quando il menu si comprime, ma il filtro restava attivo:
// menu filtrato e `openKeys` forzate su tutti i rami trovati
// (collectOpenKeys). Compresso, un ramo aperto e' un sottomenu A COMPARSA:
// restavano aperti da soli sopra la pagina e si prendevano i clic diretti ai
// campi (visto a schermo: un clic su un campo e' finito su una voce di menu).
//
// Il contratto: col menu compresso il filtro non vale (menu intero, nessuna
// openKeys forzata); il testo digitato pero' resta, e riaprendo il menu il
// filtro torna a valere (albero filtrato, rami aperti, testo nella casella).
//
// Si prova il comportamento della Shell, non un helper: stesso motore di hook
// di Shell.staleTemplateKey.test.tsx (niente DOM), e l'albero di elementi che
// la Shell restituisce si visita come dati — la casella si trova per
// placeholder, il pulsante per aria-label, il Menu per `inlineCollapsed`; si
// "digita" e si "clicca" chiamandone onChange / onClick.

const rt = vi.hoisted(() => ({
  active: false,
  i: 0,
  slots: [] as { v: unknown }[],
  callbacks: [] as ((...a: never[]) => unknown)[],
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
    useCallback: on(actual.useCallback as AnyFn, ((fn: AnyFn) => { rt.callbacks.push(fn); return fn; }) as AnyFn),
    useMemo: on(actual.useMemo as AnyFn, ((f: () => unknown) => f()) as AnyFn),
    useEffect: on(actual.useEffect as AnyFn, (() => {}) as AnyFn),
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

// Hook della Shell che passano da antd o dal browser: estranei alla prova.
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
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  postAction: async () => ({}),
  executeMenuItem: async () => ({}),
  subscribeInFlight: () => () => {},
}));

const { default: Shell } = await import('./Shell');

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

// Due moduli: Fatturazione (con un ramo intermedio) e Magazzino.
const MENU: MenuItem[] = [
  {
    id: 'menu.fat', description: 'Fatturazione', children: [
      { id: 'menu.fatAttive', description: 'Fatture attive', children: [
        { id: 'menu.fattureList', description: 'Elenco fatture', leaf: true },
      ] },
      { id: 'menu.riaddebito', description: 'Riaddebito costi ai clienti', leaf: true },
    ],
  },
  {
    id: 'menu.mag', description: 'Magazzino', children: [
      { id: 'menu.articoli', description: 'Articoli', leaf: true },
    ],
  },
];

const props = { menuItems: MENU, loginInfo: { login: '44AMM' }, onLogout: () => {}, onReloadMenu: () => {} };

let tree: unknown = null;

/** Un disegno della Shell: tiene l'albero di elementi restituito. */
function render(): void {
  rt.active = true;
  rt.i = 0;
  rt.callbacks = [];
  try {
    tree = (Shell as unknown as (p: typeof props) => unknown)(props);
  } finally {
    rt.active = false;
  }
}

type El = ReactElement<Record<string, unknown>>;

/** Tutti gli elementi dell'albero (solo i figli: i componenti non si eseguono). */
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

const casella = () => find((p) => p.placeholder === 'Cerca nel menu...');
const pulsante = (label: string) => find((p) => p['aria-label'] === label);
const menu = () => {
  const m = find((p) => 'inlineCollapsed' in p && Array.isArray(p.items));
  expect(m, 'il Menu della barra laterale').toBeDefined();
  return m!.props as { items: { key: string; children?: unknown[] }[]; openKeys?: string[]; inlineCollapsed?: boolean };
};
const chiaviRadice = () => menu().items.map((i) => i.key);

function digita(text: string): void {
  const input = casella();
  expect(input, 'la casella di ricerca').toBeDefined();
  (input!.props.onChange as (e: unknown) => void)({ target: { value: text } });
  render();
}

function clic(label: string): void {
  const b = pulsante(label);
  expect(b, `il pulsante "${label}"`).toBeDefined();
  (b!.props.onClick as () => void)();
  render();
}

beforeEach(() => {
  rt.slots = [];
  rt.callbacks = [];
  render();
});

describe('SXADV-5952: ricerca nel menu e menu compresso', () => {
  it('menu aperto: la ricerca filtra e apre i rami trovati (comportamento di oggi)', () => {
    digita('fatture');
    expect(chiaviRadice()).toEqual(['menu.fat']);
    expect(menu().openKeys).toEqual(expect.arrayContaining(['menu.fat', 'menu.fatAttive']));
  });

  it('menu compresso: il filtro non vale, si vede il menu intero', () => {
    digita('fatture');
    clic('Comprimi menu');
    expect(menu().inlineCollapsed).toBe(true);
    expect(chiaviRadice()).toEqual(['menu.fat', 'menu.mag']);
  });

  it('menu compresso: nessun sottomenu aperto da solo (niente openKeys dai rami trovati)', () => {
    digita('fatture');
    clic('Comprimi menu');
    const open = menu().openKeys ?? [];
    expect(open).not.toContain('menu.fat');
    expect(open).not.toContain('menu.fatAttive');
  });

  it('menu riaperto: il testo e\' ancora nella casella e il filtro torna a valere', () => {
    digita('fatture');
    clic('Comprimi menu');
    clic('Espandi menu');
    expect(menu().inlineCollapsed).toBe(false);
    expect(casella()?.props.value).toBe('fatture');
    expect(chiaviRadice()).toEqual(['menu.fat']);
    expect(menu().openKeys).toEqual(expect.arrayContaining(['menu.fat', 'menu.fatAttive']));
  });

  it('senza ricerca: compresso e riaperto il menu resta intero, nessuna openKeys forzata', () => {
    clic('Comprimi menu');
    expect(chiaviRadice()).toEqual(['menu.fat', 'menu.mag']);
    expect(menu().openKeys).toBeUndefined();
    clic('Espandi menu');
    expect(chiaviRadice()).toEqual(['menu.fat', 'menu.mag']);
    expect(menu().openKeys).toBeUndefined();
  });
});
