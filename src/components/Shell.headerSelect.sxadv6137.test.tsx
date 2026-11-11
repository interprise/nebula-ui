// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import * as ReactReal from 'react';
import { createRoot, type Root } from 'react-dom/client';

// SXADV-6137 — nella testata, «Azienda di accesso» e «Sede di accesso» devono
// mostrare la descrizione DENTRO un <input> (selezionabile e copiabile col
// mouse), come la combo editable:false del legacy, e non come nodo di testo
// sotto un input vuoto (Select antd v6 nuda).
//
// Due passi. 1) Stesso motore di Shell.titoloProfili.sxadv5963.test.tsx: la
// Shell si esegue come funzione con loginInfo con 2+ aziende e 2+ sedi, e
// dall'albero si prendono gli elementi della testata. 2) Quegli elementi, cosi'
// come la Shell li ha costruiti, si montano con React vero in jsdom e si legge
// il valore degli input.

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
const { HeaderContextSelect } = await import('./HeaderContextSelect');
const { act } = ReactReal;

type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } };

const AZIENDE = [
  { value: '44', text: '44 - C.N.A. SERVIZI MODENA SRL' },
  { value: '45', text: '45 - C.N.A. SERVIZI REGGIO EMILIA' },
];
const SEDI = [
  { value: '01', text: '01 - SEDE CENTRALE' },
  { value: '02', text: '02 - FILIALE CARPI' },
  { value: '03', text: '03 - FILIALE SASSUOLO' },
];

function shellProps(loginInfo: Record<string, unknown>) {
  return { menuItems: [], loginInfo: { login: '44AMM', profile: 'AMM', ...loginInfo }, onLogout: () => {}, onReloadMenu: () => {} };
}

let tree: unknown;

function render(p: ReturnType<typeof shellProps>): void {
  rt.slots = [];
  rt.active = true;
  rt.i = 0;
  rt.effects = [];
  try {
    tree = (Shell as unknown as (p: unknown) => unknown)(p);
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

/** I selettori della testata, nell'ordine dell'albero (azienda, poi sede). */
const selettori = () => elements(tree).filter((e) => e.type === HeaderContextSelect);

let root: Root | null = null;
let box: HTMLElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((q: string) => ({
    matches: false, media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});

beforeEach(() => { rt.slots = []; });

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  box?.remove();
  box = null;
});

/** Monta con React vero gli elementi che la Shell ha costruito. */
function montaElementi(els: El[]): HTMLInputElement[] {
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => {
    root!.render(ReactReal.createElement(ReactReal.Fragment, null,
      ...els.map((e, i) => ReactReal.createElement(e.type as ReactReal.ComponentType<Record<string, unknown>>, { ...e.props, key: i }))));
  });
  return [...box.querySelectorAll<HTMLInputElement>('.ant-select input')];
}

describe('SXADV-6137 — testata: Azienda e Sede di accesso in un input', () => {
  it('con 2+ aziende e 2+ sedi la testata usa HeaderContextSelect per entrambe', () => {
    render(shellProps({ customerKey: '45', sede: '02', aziende: AZIENDE, sedi: SEDI }));
    const s = selettori();
    expect(s, 'un selettore per azienda e uno per sede').toHaveLength(2);
    expect(s[0].props.value).toBe('45');
    expect(s[0].props.options).toEqual(AZIENDE);
    expect(s[1].props.value).toBe('02');
    expect(s[1].props.options).toEqual(SEDI);
    expect(typeof s[0].props.onChange).toBe('function');
    expect(typeof s[1].props.onChange).toBe('function');
  });

  it('non resta nessuna Select nuda con classe header-select', () => {
    render(shellProps({ customerKey: '45', sede: '02', aziende: AZIENDE, sedi: SEDI }));
    const nude = elements(tree).filter((e) => e.type !== HeaderContextSelect && e.props.className === 'header-select');
    expect(nude).toHaveLength(0);
  });

  it('gli input della testata contengono la descrizione di azienda e sede correnti', () => {
    render(shellProps({ customerKey: '45', sede: '02', aziende: AZIENDE, sedi: SEDI }));
    const inputs = montaElementi(selettori());
    expect(inputs.map((i) => i.value)).toEqual([AZIENDE[1].text, SEDI[1].text]);
  });

  it('i selettori hanno l\'etichetta accessibile «Azienda di accesso» / «Sede di accesso»', () => {
    render(shellProps({ customerKey: '44', sede: '01', aziende: AZIENDE, sedi: SEDI }));
    const s = selettori();
    expect(s.map((e) => e.props['aria-label'])).toEqual(['Azienda di accesso', 'Sede di accesso']);
  });

  it('una sola azienda e una sola sede: testo semplice, nessun selettore (invariato)', () => {
    render(shellProps({ customerKey: '44', sede: '01', aziende: AZIENDE.slice(0, 1), sedi: SEDI.slice(0, 1) }));
    expect(selettori()).toHaveLength(0);
  });
});
