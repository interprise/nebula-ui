import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';

// SXADV-6127.3 e 6132, DashboardPanel: widget su piu' aziende = elenco in un Popover, una per
// riga, con le escluse; ambito corrente su lista che dipende dall'azienda = tag «azienda
// corrente»; senza `ambito` o con possibile=false nessun tag. Tag «condiviso» azzurro. Testo
// della dashboard vuota con le tre vie. Impianto: dashboardPanel.sxadv6100.test.tsx.

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

const fb = vi.hoisted(() => ({
  errori: [] as unknown[],
  info: [] as string[],
  conferme: [] as Array<{ question: string; text: string; onOk: () => void; onCancel?: () => void }>,
  altreFinestre: [] as unknown[],
}));
vi.mock('../hooks/feedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/feedback')>()),
  useFeedback: () => ({
    showServerMessages: (e: unknown) => { fb.errori.push(e); },
    error: (e: unknown) => { fb.errori.push(e); },
    warning: (e: unknown) => { fb.altreFinestre.push(e); },
    info: (t: string) => { fb.info.push(String(t)); },
    failure: (e: unknown) => { fb.errori.push(e); },
    confirm: (question: string, text: string, onOk: () => void, onCancel?: () => void) => {
      fb.conferme.push({ question, text, onOk, onCancel });
    },
  }),
}));
vi.mock('./BannerCard', () => ({ default: () => null }));

const server = vi.hoisted(() => ({
  widget: [] as unknown[],
  chiamate: [] as { action: string; params: Record<string, string> }[],
  extra: {} as Record<string, unknown>,
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  postAction2: async (action: string, params: Record<string, string>) => {
    server.chiamate.push({ action, params: { ...(params || {}) } });
    switch (action) {
      case 'dashboard.Get': return { widget: server.widget, ...server.extra };
      case 'dashboard.SegnaViste': return { segnate: [] };
      default: return {};
    }
  },
  subscribeInFlight: () => () => {},
}));

const { default: DashboardPanel } = await import('./DashboardPanel');

// ───────────────────────────────────────────── il «DOM» finto (dopo gli import)
const noop = () => {};
const g = globalThis as Record<string, unknown>;
class FakeElement {}
g.Element ??= FakeElement;
g.HTMLElement ??= g.Element;
const ElementCtor = g.Element as { prototype: Record<string, unknown> };
/** Chi e' stato portato in vista, in ordine. */
const inVista: number[] = [];
ElementCtor.prototype.scrollIntoView = function (this: { idWidget?: number }) {
  if (this.idWidget !== undefined) inVista.push(this.idWidget);
};

class Riquadro extends (g.Element as new () => object) {
  classi = new Set<string>();
  idWidget: number;
  constructor(idWidget: number) { super(); this.idWidget = idWidget; }
  tagName = 'ARTICLE';
  nodeType = 1;
  dataset = { widget: '' };
  style = {} as Record<string, string>;
  classList = {
    add: (...c: string[]) => c.forEach((x) => this.classi.add(x)),
    remove: (...c: string[]) => c.forEach((x) => this.classi.delete(x)),
    contains: (c: string) => this.classi.has(c),
    toggle: (c: string, force?: boolean) => {
      const on = force ?? !this.classi.has(c);
      if (on) this.classi.add(c); else this.classi.delete(c);
      return on;
    },
  };
  getAttribute(n: string) { return n === 'data-widget' ? String(this.idWidget) : null; }
  hasAttribute(n: string) { return n === 'data-widget'; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  matches() { return false; }
  focus() {}
  getBoundingClientRect() { return { top: 0, left: 0, bottom: 100, right: 100, width: 100, height: 100 }; }
  addEventListener() {}
  removeEventListener() {}
}

const nodi = new Map<number, Riquadro>();
const montati = new Set<number>();
const idDa = (sel: string) => {
  const m = /data-widget\s*=\s*["']?(\d+)/.exec(sel);
  return m ? Number(m[1]) : null;
};
g.document = {
  body: { style: {}, classList: { add: noop, remove: noop, contains: () => false } },
  documentElement: { style: {}, classList: { add: noop, remove: noop, contains: () => false } },
  visibilityState: 'visible',
  hidden: false,
  activeElement: null,
  querySelector: (sel: string) => {
    const id = idDa(sel);
    return id !== null && montati.has(id) ? nodi.get(id) ?? null : null;
  },
  querySelectorAll: (sel: string) => {
    const id = idDa(sel);
    return id !== null && montati.has(id) ? [nodi.get(id)] : [];
  },
  getElementById: () => null,
  addEventListener: noop,
  removeEventListener: noop,
};
g.window ??= globalThis;
g.addEventListener ??= noop;
g.removeEventListener ??= noop;
{
  const mem = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
  };
}

type El = ReactElement<Record<string, unknown>>;

/** Elementi raggiungibili: figli e prop (anche le Map, come `articoli` di GrigliaWidget). */
function elements(node: unknown, out: El[] = [], seen = new Set<unknown>()): El[] {
  if (node == null || typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const n of node) elements(n, out, seen);
    return out;
  }
  if (node instanceof Map) {
    for (const n of node.values()) elements(n, out, seen);
    return out;
  }
  const el = node as El;
  if ((el as unknown as { $$typeof?: unknown }).$$typeof !== undefined && el.props) {
    out.push(el);
    const { children, ...rest } = el.props;
    for (const [k, v] of Object.entries(rest)) {
      if (k === 'widget' || k === 'loginInfo' || k === 'style' || k === 'righe' || k === 'colonne') continue;
      if (v && typeof v === 'object') elements(v, out, seen);
    }
    elements(children, out, seen);
    return out;
  }
  if (Object.getPrototypeOf(node) === Object.prototype) {
    for (const v of Object.values(node)) elements(v, out, seen);
  }
  return out;
}

let tree: unknown = null;
let componente: (p: never) => unknown = () => null;
let proprieta: Record<string, unknown> = {};

const articoli = () =>
  elements(tree).filter((e) => e.type === 'article' && e.props['data-widget'] !== undefined);

/** Gli article del disegno diventano i nodi «a schermo»; i ref li ricevono. */
function monta(): void {
  montati.clear();
  for (const a of articoli()) {
    const id = Number(a.props['data-widget']);
    let n = nodi.get(id);
    if (!n) { n = new Riquadro(id); nodi.set(id, n); }
    montati.add(id);
    const ref = (a as unknown as { ref?: unknown }).ref ?? a.props.ref;
    if (typeof ref === 'function') (ref as (x: unknown) => void)(n);
    else if (ref && typeof ref === 'object') (ref as { current: unknown }).current = n;
  }
}

function disegna(): void {
  for (let giro = 0; giro < 40; giro++) {
    rt.dirty = false;
    rt.active = true;
    rt.i = 0;
    rt.effects = [];
    try {
      tree = componente(proprieta as never);
    } finally {
      rt.active = false;
    }
    monta();
    const daFare = rt.effects;
    rt.effects = [];
    for (const e of daFare) {
      const st = e.s.v as { first: boolean; deps?: unknown[]; cleanup?: unknown };
      if (typeof st.cleanup === 'function') (st.cleanup as () => void)();
      const c = e.fn();
      e.s.v = { first: false, deps: e.deps, cleanup: c };
    }
    if (!rt.dirty) return;
  }
  throw new Error('il componente non smette di ridisegnarsi');
}

/** Lascia passare `ms` (timer e promesse), ridisegnando a ogni fotogramma. */
async function passa(ms: number): Promise<void> {
  const passo = 16;
  for (let t = 0; t < ms; t += passo) {
    await vi.advanceTimersByTimeAsync(Math.min(passo, ms - t));
    disegna();
  }
}

async function monta_(comp: (p: never) => unknown, p: Record<string, unknown>): Promise<void> {
  componente = comp;
  proprieta = p;
  disegna();
  await passa(100);
}



/** Il testo diretto di ogni elemento (le stringhe e i numeri fra i suoi figli, uniti). */
function testiDiretti(radice: unknown): string[] {
  const out: string[] = [];
  for (const e of elements(radice)) {
    const ch = e.props.children;
    const lista = Array.isArray(ch) ? ch.flat(Infinity) : [ch];
    const s = lista.filter((x) => typeof x === 'string' || typeof x === 'number').join('');
    if (s) out.push(s);
  }
  return out;
}
const articolo = (id: number) => articoli().find((e) => Number(e.props['data-widget']) === id);
const nelWidget = (id: number) => testiDiretti(articolo(id)).join(' | ');

function righe(n: number, c = 2) {
  return Array.from({ length: n }, (_, i) => ({ k: `K${i}`, c: Array.from({ length: c }, (_, j) => ({ t: `r${i}c${j}` })) }));
}

function widgetLista(id: number, titolo: string, mostrate: number, totale: number, extra: Record<string, unknown> = {}) {
  return {
    idWidget: id,
    titolo,
    forma: 'list',
    dettaglio: 'documentiDetail',
    colonne: [{ item: 'numDoc', etichetta: 'Num doc.' }, { item: 'cliente', etichetta: 'Cliente' }],
    fotografia: {
      stato: 'OK',
      ts: '2026-10-23T08:00:00',
      totaleRighe: totale,
      righeInFotografia: Math.min(totale, 1000),
      righe: righe(mostrate),
    },
    ...extra,
  };
}

const { Popover, Tag, Empty, Tooltip } = await import('antd');

function testoDi(n: unknown): string {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(testoDi).join('');
  const e = n as El;
  return e.props ? testoDi(e.props.children) : '';
}
const dettagli = (id: number) => elements(articolo(id));
const tagAmbito = (id: number) => dettagli(id).filter((e) => e.type === Tag && /dash-widget-ambito/.test(String(e.props.className)));
const popover = (id: number) => dettagli(id).find((e) => e.type === Popover);
const voci = (id: number) => elements(popover(id)!.props.content).filter((e) => e.type === 'li').map((e) => testoDi(e));

const AZIENDE = [{ codice: '44', descrizione: 'Alfa' }, { codice: '45', descrizione: 'Beta' }];

async function conWidget(extra: Record<string, unknown>, resp: Record<string, unknown> = {}) {
  server.widget = [widgetLista(1, 'W', 1, 1, extra)];
  server.extra = resp;
  await monta_(DashboardPanel as never, {});
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  if (typeof g.requestAnimationFrame !== 'function') {
    g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
    g.cancelAnimationFrame = (h: number) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>);
  }
  rt.slots = [];
  rt.effects = [];
  nodi.clear();
  montati.clear();
  server.chiamate = [];
  server.extra = {};
  (g.localStorage as { clear: () => void }).clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SXADV-6127.3 widget su piu\' aziende: l\'elenco in un Popover', () => {
  it('una per riga, con la descrizione dove si conosce', async () => {
    await conWidget(
      { ambito: { modo: 'scelte', codici: ['44', '45', '99'], possibile: true } },
      { aziendeAbilitate: AZIENDE },
    );
    expect(popover(1), 'il Popover').toBeDefined();
    expect(voci(1)).toEqual(['44 — Alfa', '45 — Beta', '99']);
    expect(testoDi(tagAmbito(1)[0])).toBe('3 aziende');
    expect(testoDi(popover(1)!.props.content)).not.toContain('Escluse');
  });

  it('le escluse si dicono, sotto l\'elenco e non fra le voci', async () => {
    await conWidget({ ambito: { modo: 'tutte', codici: ['44'], escluse: ['45', '46'], possibile: true } });
    expect(voci(1)).toEqual(['44']);
    expect(testoDi(popover(1)!.props.content)).toContain('Escluse perche\' li\' hai un altro profilo: 45, 46');
    expect(testoDi(tagAmbito(1)[0])).toBe('tutte le aziende');
  });

  it('una sola scelta: «1 azienda»', async () => {
    await conWidget({ ambito: { modo: 'scelte', codici: ['44'], possibile: true } });
    expect(testoDi(tagAmbito(1)[0])).toBe('1 azienda');
  });

  it('il tag sta dentro il Popover, e niente vecchio Tooltip attorno', async () => {
    await conWidget({ ambito: { modo: 'scelte', codici: ['44', '45'], possibile: true } });
    expect(elements(popover(1)!.props.children).some((e) => e.type === Tag)).toBe(true);
    const tooltips = dettagli(1).filter((e) => e.type === Tooltip);
    expect(tooltips.some((t) => elements(t.props.children).some((x) => /dash-widget-ambito/.test(String(x.props.className))))).toBe(false);
  });

  it('codici assenti: non lancia', async () => {
    await conWidget({ ambito: { modo: 'tutte', possibile: true } });
    expect(voci(1)).toEqual([]);
    expect(testoDi(tagAmbito(1)[0])).toBe('tutte le aziende');
  });
});

describe('SXADV-6127.3 ambito corrente: il tag «azienda corrente»', () => {
  it('lista che dipende dall\'azienda: c\'e\', senza Popover', async () => {
    await conWidget({ ambito: { modo: 'corrente', codici: ['44'], possibile: true } });
    expect(tagAmbito(1).map(testoDi)).toEqual(['azienda corrente']);
    expect(popover(1)).toBeUndefined();
  });

  it('senza ambito: nessun tag', async () => {
    await conWidget({});
    expect(tagAmbito(1)).toEqual([]);
  });

  it('ambito null: nessun tag', async () => {
    await conWidget({ ambito: null });
    expect(tagAmbito(1)).toEqual([]);
  });

  it('possibile=false: nessun tag', async () => {
    await conWidget({ ambito: { modo: 'corrente', codici: [], possibile: false } });
    expect(tagAmbito(1)).toEqual([]);
  });

  it.each(['scelte', 'tutte'])('possibile=false anche con modo %s salvato: nessun tag', async (modo) => {
    await conWidget({ ambito: { modo, codici: ['44', '45'], possibile: false } });
    expect(tagAmbito(1)).toEqual([]);
    expect(popover(1)).toBeUndefined();
  });
});

describe('SXADV-6132 tag «condiviso» e dashboard vuota', () => {
  const tagCondiviso = (id: number) => dettagli(id).filter((e) => e.type === Tag && /dash-widget-condiviso/.test(String(e.props.className)));

  it('proprio e condiviso: azzurro', async () => {
    await conWidget({ modificabile: true, condivisione: { ambito: 'azienda' } });
    expect(testoDi(tagCondiviso(1)[0])).toBe('condiviso');
    expect(tagCondiviso(1)[0].props.color).toBe('blue');
  });

  it('privato: nessun tag', async () => {
    await conWidget({ modificabile: true, condivisione: { ambito: 'privato' } });
    expect(tagCondiviso(1)).toEqual([]);
  });

  it('ricevuto da altri: «da X», senza azzurro', async () => {
    await conWidget({ modificabile: false, autore: 'Elena', condivisione: { ambito: 'azienda' } });
    expect(tagCondiviso(1).map(testoDi)).toEqual(['da Elena']);
    expect(tagCondiviso(1)[0].props.color).toBeUndefined();
  });

  it('nessun widget: le tre vie', async () => {
    server.widget = [];
    await monta_(DashboardPanel as never, {});
    const vuoto = elements(tree).find((e) => e.type === Empty);
    expect(vuoto, 'il testo vuoto').toBeDefined();
    const t = testoDi(vuoto!.props.description).replace(/\s+/g, ' ');
    expect(t).toContain('Si creano da una lista di risultati con il pulsante Aggiungi alla dashboard');
    expect(t).toContain('oppure si aggiungono con Aggiungi widget scegliendo da un elenco di widget già esistenti');
    expect(t).toContain('oppure ancora si ottengono automaticamente dalla fase di distribuzione');
  });
});

// Dall'impianto comune, qui non usati.
void [nelWidget];
