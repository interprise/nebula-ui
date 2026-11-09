import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import sorgenteGriglia from './dashboard/GrigliaWidget.tsx?raw';

// SXADV-6107.1b: l'etichetta e' «Banner Informativi» con i contatori.
// SXADV-6121: sulla dashboard il blocco testata ha la classe home-testata e la variabile CSS
// --home-testata-h misura la sua altezza; sugli avvisi la classe no. La variabile serve a
// .dash-griglia-barra, che sta DOPO la testata: per arrivarci deve stare su un antenato comune.
// Impianto: motore di hook finto di ritornoWidget.home.sxadv5999.test.tsx. La testata diventa
// un nodo finto con la sua altezza; ResizeObserver e' finto: «il browser ha visto un cambio di
// misura» = chiamarne il callback. Quindi qui non si prova che il browser lo chiami.

const rt = vi.hoisted(() => ({
  active: false,
  i: 0,
  dirty: false,
  slots: [] as { v: unknown; set?: unknown }[],
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

vi.mock('./BannerCard', () => ({ default: () => null }));
vi.mock('./DashboardPanel', () => ({ default: () => null }));

const { default: HomePanel } = await import('./HomePanel');
const { Segmented } = await import('antd');

const noop = () => {};
const g = globalThis as Record<string, unknown>;
class FakeElement {}
g.Element ??= FakeElement;
g.HTMLElement ??= g.Element;
g.document = {
  body: { style: {}, classList: { add: noop, remove: noop, contains: () => false } },
  documentElement: { style: {}, classList: { add: noop, remove: noop, contains: () => false } },
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
  addEventListener: noop, removeEventListener: noop,
};
g.window ??= globalThis;
{
  const mem = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
  };
}

class FintoRO {
  static tutti: FintoRO[] = [];
  osservati: unknown[] = [];
  spento = false;
  cb: () => void;
  constructor(cb: () => void) { this.cb = cb; FintoRO.tutti.push(this); }
  observe(n: unknown) { this.osservati.push(n); }
  unobserve() {}
  disconnect() { this.spento = true; this.osservati = []; }
}
g.ResizeObserver = FintoRO;

type El = ReactElement<Record<string, unknown>>;
function elements(node: unknown, out: El[] = [], seen = new Set<unknown>()): El[] {
  if (node == null || typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  if (Array.isArray(node)) { for (const n of node) elements(n, out, seen); return out; }
  const el = node as El;
  if ((el as unknown as { $$typeof?: unknown }).$$typeof !== undefined && el.props) {
    out.push(el);
    elements(el.props.children, out, seen);
  }
  return out;
}

let tree: unknown = null;
let proprieta: Record<string, unknown> = {};
const vars = new Map<string, string>();
const genitore = { style: { setProperty: (k: string, v: string) => { vars.set(k, v); } } };
const testataNodo = { offsetHeight: 120, parentElement: genitore };

/** Il blocco testata: il div col ref, primo figlio del contenitore. */
const testata = () => elements(tree).find((e) => e.type === 'div' && e.props.ref);

function disegna(): void {
  for (let giro = 0; giro < 40; giro++) {
    rt.dirty = false;
    rt.active = true;
    rt.i = 0;
    rt.effects = [];
    try {
      tree = (HomePanel as unknown as (p: unknown) => unknown)(proprieta);
    } finally {
      rt.active = false;
    }
    const r = testata()?.props.ref as { current: unknown } | undefined;
    if (r) r.current = testataNodo;
    const daFare = rt.effects;
    rt.effects = [];
    for (const e of daFare) {
      const st = e.s.v as { cleanup?: unknown };
      if (typeof st.cleanup === 'function') (st.cleanup as () => void)();
      e.s.v = { first: false, deps: e.deps, cleanup: e.fn() };
    }
    if (!rt.dirty) return;
  }
  throw new Error('non smette di ridisegnarsi');
}

const segmented = () => elements(tree).find((e) => e.type === Segmented)!;
const etichetta = () =>
  (segmented().props.options as { value: string; label: string }[]).find((o) => o.value === 'avvisi')!.label;
const passaA = (v: string) => { (segmented().props.onChange as (x: string) => void)(v); disegna(); };
const cosa = () => segmented().props.value;

const BANNER = (t: string) => ({ text: t, banDate: '2026-11-02', banHomePage: true });
const apri = (banners: unknown[] = []) => {
  proprieta = { loginInfo: { login: '44AMM', profile: 'P', banners } };
  disegna();
};

beforeEach(() => {
  rt.slots = [];
  rt.effects = [];
  vars.clear();
  testataNodo.offsetHeight = 120;
  FintoRO.tutti = [];
  (g.localStorage as { clear: () => void }).clear();
});

describe('SXADV-6107.1b l\'etichetta del commutatore', () => {
  it('nessun banner', () => {
    apri();
    expect(etichetta()).toBe('Banner Informativi');
  });

  it('due nuovi; il numero resta mentre li si legge', () => {
    apri([BANNER('a'), BANNER('b')]);
    expect(cosa()).toBe('avvisi');
    expect(etichetta()).toBe('Banner Informativi (2 nuovi)');
  });

  it('uno nuovo, al singolare', () => {
    apri([BANNER('a')]);
    expect(etichetta()).toBe('Banner Informativi (1 nuovo)');
  });

  it('gia\' visti: il totale, e si apre sulla dashboard', () => {
    apri([BANNER('a'), BANNER('b')]);
    rt.slots = [];
    apri([BANNER('a'), BANNER('b')]);
    expect(cosa()).toBe('dashboard');
    expect(etichetta()).toBe('Banner Informativi (2)');
  });

  it('il nome vecchio non c\'e\' piu\' nel commutatore', () => {
    apri([BANNER('a')]);
    expect(etichetta()).not.toMatch(/^Avvisi/);
  });
});

describe('SXADV-6121 la testata', () => {
  const classe = () => testata()!.props.className;

  it('sulla dashboard: classe home-testata e variabile con l\'altezza misurata', () => {
    apri();
    expect(classe()).toBe('home-testata');
    expect(vars.get('--home-testata-h')).toBe('120px');
  });

  it('sugli avvisi: nessuna classe', () => {
    apri();
    passaA('avvisi');
    expect(classe()).toBeUndefined();
  });

  // La variabile resta sul genitore anche sugli avvisi: la legge solo la barra della
  // griglia, che li' non c'e', e cosi' e' gia' giusta quando si torna alla dashboard.
  it('sugli avvisi: la testata non e\' fissata, la variabile c\'e\' ma nessuno la legge', () => {
    apri([BANNER('a')]);
    expect(cosa()).toBe('avvisi');
    expect(classe()).toBeUndefined();
    expect(vars.has('--home-testata-h')).toBe(true);
  });

  it('il selettore e il benvenuto stanno dentro il blocco', () => {
    apri();
    expect(elements(testata()).some((e) => e.type === Segmented)).toBe(true);
  });

  it('da avvisi a dashboard: la classe arriva, stesso nodo osservato, misura aggiornata', () => {
    apri([BANNER('a')]);
    expect(cosa()).toBe('avvisi');
    testataNodo.offsetHeight = 180;
    FintoRO.tutti[0].cb();
    expect(vars.get('--home-testata-h')).toBe('180px');
    passaA('dashboard');
    expect(classe()).toBe('home-testata');
    const vivi = FintoRO.tutti.filter((r) => !r.spento);
    expect(vivi).toHaveLength(1);
    expect(vivi[0].osservati).toEqual([testataNodo]);
    testataNodo.offsetHeight = 70;
    vivi[0].cb();
    expect(vars.get('--home-testata-h')).toBe('70px');
  });

  it('avanti e indietro non moltiplica gli osservatori', () => {
    apri();
    for (const v of ['avvisi', 'dashboard', 'avvisi', 'dashboard']) passaA(v);
    expect(FintoRO.tutti).toHaveLength(1);
  });

  it('senza ResizeObserver non lancia', () => {
    g.ResizeObserver = undefined;
    try {
      expect(() => apri()).not.toThrow();
    } finally {
      g.ResizeObserver = FintoRO;
    }
  });
});

// Il CSS con ?raw sotto vitest arriva vuoto: si legge da disco. Il nome passa da una variabile
// perche' il progetto non ha i tipi di node.
const modFs = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ modFs)) as { readFileSync: (p: URL, e: string) => string };
const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

describe('SXADV-6121 il foglio di stile', () => {
  const regola = (sel: string) => new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

  it('.home-testata resta ferma, con un fondo', () => {
    expect(regola('.home-testata')).toMatch(/position:\s*sticky/);
    expect(regola('.home-testata')).toMatch(/top:\s*0/);
    expect(regola('.home-testata')).toMatch(/background:/);
  });

  it('la barra dei widget si ferma sotto: var con ripiego', () => {
    expect(regola('.dash-griglia-barra')).toMatch(/position:\s*sticky/);
    expect(regola('.dash-griglia-barra')).toMatch(/top:\s*var\(--home-testata-h,\s*0px\)/);
  });

  it('GrigliaWidget usa la classe', () => {
    expect(sorgenteGriglia).toContain('dash-griglia-barra');
  });
});
