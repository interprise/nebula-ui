import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';

// SXADV-6225, HomePanel. Chi prova non e' chi implementa: si prova il contratto.
// .1 niente piu' «Seleziona una voce dal menu a sinistra per iniziare», ne' sulla
//    dashboard ne' sugli avvisi.
// .4 benvenuto e commutatore Dashboard/Banner con la STESSA struttura sulle due schede:
//    passare da una all'altra non deve spostare il commutatore. In jsdom: il blocco del
//    benvenuto e' identico (stesso livello di titolo, stesso stile, profilo in linea nello
//    stesso elemento), la strada fino al Segmented e' identica, il contenitore esterno ha
//    lo stesso maxWidth. Non si fissano i pixel: si chiede l'uguaglianza fra le schede.
// Impianto: quello di homePanel.sxadv6121.test.tsx (motore di hook finto).


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
const { Segmented, Typography } = await import('antd');

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
const apri = (banners: unknown[] = [], extra: Record<string, unknown> = {}) => {
  proprieta = { loginInfo: { login: '44AMM', name: 'Mario Rossi', profile: 'Amministratore', banners, ...extra } };
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

/** Tutto il testo raggiungibile da un nodo (figli, in ordine). */
function testoDi(n: unknown): string {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(testoDi).join('');
  const e = n as El;
  return e.props ? testoDi(e.props.children) : '';
}

const SUGGERIMENTO = /Seleziona una voce dal menu/i;
const BENVENUTO = 'Benvenuta/o, Mario Rossi';
const PROFILO = 'Amministratore';

describe('SXADV-6225.1 niente suggerimento in fondo alla Home', () => {
  it('sulla dashboard', () => {
    apri();
    expect(cosa()).toBe('dashboard');
    expect(testoDi(tree)).not.toMatch(SUGGERIMENTO);
  });

  it('sugli avvisi, con avvisi', () => {
    apri([BANNER('a')]);
    expect(cosa()).toBe('avvisi');
    expect(testoDi(tree)).not.toMatch(SUGGERIMENTO);
  });

  it('sugli avvisi, senza avvisi (pagina vuota)', () => {
    apri();
    passaA('avvisi');
    expect(testoDi(tree)).not.toMatch(SUGGERIMENTO);
  });

  it('in nessuna prop di nessun elemento (anche fuori dai figli)', () => {
    apri();
    for (const v of ['dashboard', 'avvisi']) {
      passaA(v);
      const tutto = JSON.stringify(elements(tree).map((e) => {
        const { children, ...resto } = e.props;
        void children;
        return Object.values(resto).filter((x) => typeof x === 'string');
      }));
      expect(tutto, v).not.toMatch(SUGGERIMENTO);
    }
  });
});

// ─────────────────────────────── .4 stessa struttura sulle due schede

/** Il nome del tipo di un elemento: tag, displayName o nome della funzione. */
function nomeTipo(t: unknown): string {
  if (typeof t === 'string') return t;
  if (t && (typeof t === 'object' || typeof t === 'function')) {
    const x = t as { displayName?: string; name?: string; render?: { displayName?: string; name?: string } };
    return x.displayName || x.name || x.render?.displayName || x.render?.name || 'Componente';
  }
  return String(t);
}

/**
 * La forma di un sottoalbero, per confrontarla fra le due schede: tipi, prop (le funzioni
 * diventano «fn») e figli. `salta(el, chiave)` toglie le prop che possono cambiare senza
 * spostare niente (il valore del Segmented, la classe sticky della testata, il ref).
 */
function forma(n: unknown, salta: (e: El, k: string) => boolean = () => false): unknown {
  if (n == null || typeof n === 'boolean') return null;
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map((x) => forma(x, salta));
  const e = n as El;
  if (!e.props || (e as unknown as { $$typeof?: unknown }).$$typeof === undefined) return '?';
  const p: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e.props)) {
    if (k === 'children' || k === 'ref' || salta(e, k)) continue;
    p[k] = typeof v === 'function' ? 'fn'
      : v && typeof v === 'object' && (v as { $$typeof?: unknown }).$$typeof !== undefined ? forma(v, salta)
        : v;
  }
  return { t: nomeTipo(e.type), p, c: forma(e.props.children, salta) };
}

/** Il piu' piccolo elemento che contiene sia il benvenuto sia il profilo, ma non il Segmented. */
function bloccoBenvenuto(): El {
  const candidati = elements(tree).filter((e) => {
    const t = testoDi(e);
    return t.includes(BENVENUTO) && t.includes(PROFILO) && !elements(e).some((x) => x.type === Segmented);
  });
  expect(candidati.length, 'un blocco col benvenuto e il profilo').toBeGreaterThan(0);
  // Il piu' interno: quello che non ne contiene altri.
  return candidati.find((c) => !candidati.some((d) => d !== c && elements(c).includes(d)))!;
}

/** Il blocco esterno del benvenuto: l'antenato piu' alto che non contiene il Segmented. */
function riquadroBenvenuto(): El {
  const candidati = elements(tree).filter((e) => {
    const t = testoDi(e);
    return t.includes(BENVENUTO) && !elements(e).some((x) => x.type === Segmented);
  });
  expect(candidati.length, 'il riquadro del benvenuto').toBeGreaterThan(0);
  return candidati.find((c) => !candidati.some((d) => d !== c && elements(d).includes(c)))!;
}

/** Gli elementi dalla radice fino al Segmented compreso. */
function stradaAlSegmented(): El[] {
  const seg = segmented();
  const strada: El[] = [];
  const cerca = (e: El): boolean => {
    strada.push(e);
    if (e === seg) return true;
    const figli = elements(e.props.children);
    // solo i figli diretti (elements li visita in profondita': si filtrano quelli
    // che non stanno dentro un altro figlio)
    const diretti = figli.filter((f) => !figli.some((g2) => g2 !== f && elements(g2.props.children).includes(f)));
    for (const f of diretti) if (cerca(f)) return true;
    strada.pop();
    return false;
  };
  cerca(tree as El);
  expect(strada[strada.length - 1], 'il Segmented si raggiunge dalla radice').toBe(seg);
  return strada;
}

/** Lo stile «di posto» di un elemento: quello che ne decide posizione e dimensioni. */
const stile = (e: El) => JSON.stringify(e.props.style ?? null);

/** Disegna la Home sulle due schede e restituisce quello che `f` legge su ognuna. */
function sulleDue<T>(f: () => T): { dashboard: T; avvisi: T } {
  apri();
  expect(cosa()).toBe('dashboard');
  const dashboard = f();
  passaA('avvisi');
  expect(cosa()).toBe('avvisi');
  const avvisi = f();
  return { dashboard, avvisi };
}

const saltaVariabili = (e: El, k: string) =>
  (e.type === Segmented && (k === 'value' || k === 'options' || k === 'onChange'))
  || (k === 'className' && e.type === 'div' && !!e.props.ref);

describe('SXADV-6225.4 benvenuto e commutatore: stessa struttura sulle due schede', () => {
  it('il contenitore esterno ha lo stesso maxWidth', () => {
    const r = sulleDue(() => (tree as El).props.style as Record<string, unknown> | undefined);
    expect(r.dashboard?.maxWidth, 'maxWidth sulla dashboard').toBeDefined();
    expect(r.avvisi?.maxWidth).toEqual(r.dashboard?.maxWidth);
  });

  it('il resto dello stile del contenitore esterno e\' uguale (margini, padding, larghezza)', () => {
    const r = sulleDue(() => stile(tree as El));
    expect(r.avvisi).toBe(r.dashboard);
  });

  it('il riquadro del benvenuto e\' identico (tipi, stili, figli)', () => {
    const r = sulleDue(() => forma(riquadroBenvenuto(), saltaVariabili));
    expect(r.avvisi).toEqual(r.dashboard);
  });

  it('stesso stile del riquadro: padding e marginBottom uguali', () => {
    const r = sulleDue(() => {
      const s = (riquadroBenvenuto().props.style || {}) as Record<string, unknown>;
      return { padding: s.padding, paddingTop: s.paddingTop, paddingBottom: s.paddingBottom, marginBottom: s.marginBottom };
    });
    expect(r.avvisi).toEqual(r.dashboard);
  });

  it('stesso livello di titolo, e il profilo sta in linea nello stesso titolo', () => {
    const r = sulleDue(() => {
      const titoli = elements(tree).filter((e) => e.type === Typography.Title && testoDi(e).includes(BENVENUTO));
      expect(titoli, 'un Title col benvenuto').toHaveLength(1);
      expect(testoDi(titoli[0]), 'il profilo dentro lo stesso Title').toContain(PROFILO);
      return titoli[0].props.level;
    });
    expect(r.dashboard).toBeDefined();
    expect(r.avvisi).toBe(r.dashboard);
  });

  it('il blocco benvenuto+profilo ha la stessa forma', () => {
    const r = sulleDue(() => forma(bloccoBenvenuto(), saltaVariabili));
    expect(r.avvisi).toEqual(r.dashboard);
  });

  it('la strada fino al commutatore e\' la stessa: stessi tipi e stili a ogni passo', () => {
    const r = sulleDue(() => stradaAlSegmented().map((e) => ({
      t: nomeTipo(e.type),
      s: stile(e),
      // quanti fratelli precedono il passo: un elemento in piu' o in meno sopra lo sposta
      prima: (() => {
        const ch = e.props.children;
        return Array.isArray(ch) ? ch.filter((x) => x != null && x !== false).length : ch == null ? 0 : 1;
      })(),
    })));
    // L'ultimo passo e' il Segmented stesso: il suo stile non conta qui.
    expect(r.avvisi).toEqual(r.dashboard);
  });

  it('tutto quello che sta sopra il commutatore, nella testata, ha la stessa forma', () => {
    const r = sulleDue(() => forma(testata(), saltaVariabili));
    expect(r.avvisi).toEqual(r.dashboard);
  });

  it('vale anche partendo dagli avvisi (avvisi nuovi) e tornando alla dashboard', () => {
    apri([BANNER('a')]);
    expect(cosa()).toBe('avvisi');
    const avvisi = { box: forma(riquadroBenvenuto(), saltaVariabili), max: ((tree as El).props.style as Record<string, unknown>)?.maxWidth };
    passaA('dashboard');
    const dashboard = { box: forma(riquadroBenvenuto(), saltaVariabili), max: ((tree as El).props.style as Record<string, unknown>)?.maxWidth };
    expect(avvisi).toEqual(dashboard);
  });

  it('senza nome: il benvenuto usa il login, e la forma resta la stessa', () => {
    proprieta = { loginInfo: { login: '44AMM', profile: PROFILO, banners: [] } };
    disegna();
    const d = testoDi(tree);
    expect(d).toContain('Benvenuta/o, 44AMM');
    expect(d).toContain(PROFILO);
  });
});

// Le etichette e l'apertura sugli avvisi non devono regredire: le prova homePanel.sxadv6121.
describe('SXADV-6225 non regressione minima del commutatore', () => {
  it('etichetta con i nuovi e apertura sugli avvisi', () => {
    apri([BANNER('a'), BANNER('b')]);
    expect(cosa()).toBe('avvisi');
    expect(etichetta()).toBe('Banner Informativi (2 nuovi)');
  });
});

