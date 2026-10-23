import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';

// SXADV-6100.2 (il × del widget e «Rimuovi»), 6100.4 (l'etichetta «visualizzazione: N di
// M») e 6100.1 C4 lato pannello (la scelta «Colonne» non offre i comandi) — DashboardPanel.
// Oracolo: docs/sxadv-62-prove/SXADV6100_contratto.md. Chi prova non e' chi implementa.
//
//   6100.2: il × (e «Rimuovi» del widget con la lista d'origine cambiata) apre la finestra di
//   conferma standard, `feedback.confirm(question, text, onOk, onCancel?)`, con titolo
//   «Eliminare dalla dashboard questo widget?» e testo «La dashboard non lo mostrera' piu'.».
//   OK -> UNA `dashboard.RimuoviWidget` con `idWidget`, poi l'avviso «"<titolo>" eliminato
//   dalla dashboard.» e la rilettura; Annulla o Esc -> nessuna richiesta.
//   6100.4: righe mostrate meno del totale -> «visualizzazione: 200 di 4.762»; altrimenti
//   «17 righe», «1 riga».
//
// Impianto: lo stesso di ritornoWidget.home.sxadv5999.test.tsx (niente DOM: il componente si
// esegue come funzione con un motore di hook finto che fa girare gli effetti). useFeedback e'
// finto e registra confirm/info; il server finto risponde dashboard.Get e RimuoviWidget.
// «Nessuna richiesta» si legge al netto delle letture di fondo del pannello (dashboard.Get,
// dashboard.Stato, che girano da sole col tempo).

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
  rimozione: { esito: 'ok' } as Record<string, unknown>,
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  postAction2: async (action: string, params: Record<string, string>) => {
    server.chiamate.push({ action, params: { ...(params || {}) } });
    switch (action) {
      case 'dashboard.Get': return { widget: server.widget };
      case 'dashboard.RimuoviWidget': return server.rimozione;
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

/** Il × del widget: il pulsante con aria-label «Togli <titolo> dalla dashboard». */
const pulsanteX = (id: number) =>
  elements(articolo(id)).find((e) => /^Togli .* dalla dashboard$/.test(String(e.props['aria-label'] || '')));
/** «Rimuovi» del widget con la lista d'origine cambiata. */
const pulsanteRimuovi = (id: number) =>
  elements(articolo(id)).find((e) => typeof e.props.onClick === 'function' && testiDiretti(e).join('').trim() === 'Rimuovi');
const rimozioni = () => server.chiamate.filter((c) => c.action === 'dashboard.RimuoviWidget');
const letture = () => server.chiamate.filter((c) => c.action === 'dashboard.Get').length;
/** Le richieste dopo l'indice `da` che non sono le letture di fondo del pannello (Get, Stato). */
const richiesteDopo = (da: number) =>
  server.chiamate.slice(da).filter((c) => c.action !== 'dashboard.Get' && c.action !== 'dashboard.Stato');

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
  fb.errori = [];
  fb.info = [];
  fb.conferme = [];
  fb.altreFinestre = [];
  server.chiamate = [];
  server.rimozione = { esito: 'ok' };
  server.widget = [
    widgetLista(3, 'Scadenze', 200, 4762),
    widgetLista(7, 'Fatture da incassare', 17, 17),
    widgetLista(9, 'Ordini aperti', 1, 1),
  ];
  (g.localStorage as { clear: () => void }).clear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ───────────────────────────────────────────────────────────── 6100.2
describe('SXADV-6100.2 il × del widget chiede conferma con la finestra standard', () => {
  it('impianto: tre widget a schermo, ognuno col suo ×', async () => {
    await monta_(DashboardPanel as never, {});
    expect(articoli().length).toBe(3);
    for (const id of [3, 7, 9]) expect(pulsanteX(id), `× del widget ${id}`).toBeDefined();
  });

  it('il clic sul × apre UNA conferma (feedback.confirm) e non manda niente', async () => {
    await monta_(DashboardPanel as never, {});
    const prima = server.chiamate.length;
    (pulsanteX(7)!.props.onClick as (e?: unknown) => void)({ stopPropagation() {}, preventDefault() {} });
    await passa(50);
    expect(fb.conferme.length).toBe(1);
    expect(rimozioni()).toEqual([]);
    expect(richiesteDopo(prima)).toEqual([]);
  });

  it('i testi della finestra: titolo e spiegazione del contratto', async () => {
    await monta_(DashboardPanel as never, {});
    (pulsanteX(7)!.props.onClick as (e?: unknown) => void)({ stopPropagation() {}, preventDefault() {} });
    expect(fb.conferme[0].question).toBe('Eliminare dalla dashboard questo widget?');
    expect(fb.conferme[0].text).toBe("La dashboard non lo mostrera' piu'.");
  });

  it('OK -> una sola dashboard.RimuoviWidget, con l\'idWidget giusto', async () => {
    await monta_(DashboardPanel as never, {});
    (pulsanteX(7)!.props.onClick as (e?: unknown) => void)({ stopPropagation() {}, preventDefault() {} });
    fb.conferme[0].onOk();
    await passa(200);
    expect(rimozioni().length).toBe(1);
    expect(rimozioni()[0].params.idWidget).toBe('7');
  });

  it('OK -> l\'avviso «"<titolo>" eliminato dalla dashboard.» e la rilettura', async () => {
    await monta_(DashboardPanel as never, {});
    const lettePrima = letture();
    (pulsanteX(7)!.props.onClick as (e?: unknown) => void)({ stopPropagation() {}, preventDefault() {} });
    fb.conferme[0].onOk();
    await passa(200);
    expect(fb.info).toContain('"Fatture da incassare" eliminato dalla dashboard.');
    expect(letture()).toBeGreaterThan(lettePrima);
    // la rilettura viene DOPO la rimozione
    const iR = server.chiamate.findIndex((c) => c.action === 'dashboard.RimuoviWidget');
    expect(server.chiamate.slice(iR + 1).some((c) => c.action === 'dashboard.Get')).toBe(true);
  });

  it('Annulla (o Esc) -> nessuna richiesta, nessun avviso', async () => {
    await monta_(DashboardPanel as never, {});
    const prima = server.chiamate.length;
    (pulsanteX(7)!.props.onClick as (e?: unknown) => void)({ stopPropagation() {}, preventDefault() {} });
    fb.conferme[0].onCancel?.();
    await passa(500);
    expect(rimozioni()).toEqual([]);
    expect(richiesteDopo(prima)).toEqual([]);
    expect(fb.info).toEqual([]);
  });

  it('il × del widget 3 toglie il 3, non un altro', async () => {
    await monta_(DashboardPanel as never, {});
    (pulsanteX(3)!.props.onClick as (e?: unknown) => void)({ stopPropagation() {}, preventDefault() {} });
    fb.conferme[0].onOk();
    await passa(200);
    expect(rimozioni().map((c) => c.params.idWidget)).toEqual(['3']);
    expect(fb.info).toContain('"Scadenze" eliminato dalla dashboard.');
  });

  it('la rimozione rifiutata dal server: nessun avviso di eliminazione', async () => {
    server.rimozione = { esito: 'WIDGET', messaggio: 'Widget non trovato' };
    await monta_(DashboardPanel as never, {});
    (pulsanteX(7)!.props.onClick as (e?: unknown) => void)({ stopPropagation() {}, preventDefault() {} });
    fb.conferme[0].onOk();
    await passa(200);
    expect(rimozioni().length).toBe(1);
    expect(fb.info.filter((t) => t.includes('eliminato'))).toEqual([]);
    expect(fb.errori.length).toBeGreaterThan(0);
  });

  it('«Rimuovi» del widget con la lista d\'origine cambiata: stessa finestra, stessi testi', async () => {
    server.widget = [
      widgetLista(5, 'Vecchia lista', 3, 3, {
        fotografia: { stato: 'ERR', definitivo: true, ts: '2026-10-20T08:00:00', totaleRighe: 3, righe: righe(3) },
      }),
    ];
    await monta_(DashboardPanel as never, {});
    const b = pulsanteRimuovi(5);
    expect(b, 'il pulsante Rimuovi').toBeDefined();
    (b!.props.onClick as (e?: unknown) => void)({ stopPropagation() {}, preventDefault() {} });
    await passa(50);
    expect(rimozioni()).toEqual([]);
    expect(fb.conferme.length).toBe(1);
    expect(fb.conferme[0].question).toBe('Eliminare dalla dashboard questo widget?');
    expect(fb.conferme[0].text).toBe("La dashboard non lo mostrera' piu'.");
    fb.conferme[0].onOk();
    await passa(200);
    expect(rimozioni().map((c) => c.params.idWidget)).toEqual(['5']);
  });

  it('«Rimuovi» e Annulla: nessuna richiesta', async () => {
    server.widget = [
      widgetLista(5, 'Vecchia lista', 3, 3, {
        fotografia: { stato: 'ERR', definitivo: true, ts: '2026-10-20T08:00:00', totaleRighe: 3, righe: righe(3) },
      }),
    ];
    await monta_(DashboardPanel as never, {});
    (pulsanteRimuovi(5)!.props.onClick as (e?: unknown) => void)({ stopPropagation() {}, preventDefault() {} });
    fb.conferme[0]?.onCancel?.();
    await passa(300);
    expect(rimozioni()).toEqual([]);
  });

  it('nessuna finestrella Popconfirm sul × (la conferma e\' quella standard)', async () => {
    await monta_(DashboardPanel as never, {});
    const art = articolo(7)!;
    const pop = elements(art).filter((e) => typeof e.props.onConfirm === 'function');
    expect(pop).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────── 6100.4
describe('SXADV-6100.4 l\'etichetta delle righe', () => {
  it('meno righe mostrate che il totale: «visualizzazione: 200 di 4.762»', async () => {
    await monta_(DashboardPanel as never, {});
    expect(nelWidget(3)).toContain('visualizzazione: 200 di 4.762');
  });

  it('e non piu\' «prime 200 di 4.762»', async () => {
    await monta_(DashboardPanel as never, {});
    expect(nelWidget(3)).not.toMatch(/prime 200 di/);
  });

  it('tutte le righe a video: «17 righe», senza «visualizzazione»', async () => {
    await monta_(DashboardPanel as never, {});
    expect(nelWidget(7)).toContain('17 righe');
    expect(nelWidget(7)).not.toContain('visualizzazione');
  });

  it('una riga: «1 riga»', async () => {
    await monta_(DashboardPanel as never, {});
    expect(nelWidget(9)).toMatch(/(^|[^0-9.])1 riga\b/);
    expect(nelWidget(9)).not.toContain('visualizzazione');
  });

  it('N e\' il numero di righe che arrivano a video, non quello della fotografia', async () => {
    server.widget = [widgetLista(4, 'Grande', 150, 66322)];
    await monta_(DashboardPanel as never, {});
    expect(nelWidget(4)).toContain('visualizzazione: 150 di 66.322');
  });
});

// ───────────────────────────────────────────────────────────── 6100.1 C4 nel pannello
describe('SXADV-6100.1 C4: la scelta «Colonne» non offre i comandi', () => {
  const conComandi = () =>
    widgetLista(11, 'Fatture W1', 2, 2, {
      colonne: [
        { item: 'numDoc', etichetta: 'Num doc.', tipo: 'Text' },
        { item: 'visualizzaFE', etichetta: 'visualizzaFE', tipo: 'SingleAction', azione: true },
        { item: 'anagrafica', etichetta: 'Cliente', tipo: 'List' },
        { item: 'print', etichetta: 'Stampa', tipo: 'ReportBar', azione: true },
      ],
      fotografia: {
        stato: 'OK', ts: '2026-10-23T08:00:00', totaleRighe: 2, righeInFotografia: 2,
        righe: [
          { k: 'A', c: [{ t: 'F1' }, { t: '' }, { t: 'Rossi' }, { t: '' }] },
          { k: 'B', c: [{ t: 'F2' }, { t: '' }, { t: 'Bianchi' }, { t: '' }] },
        ],
      },
    });

  const scelta = () => elements(articolo(11)).find((e) => typeof e.props.onRipristina === 'function');

  it('la scelta c\'e\' e le sue caselle sono solo le colonne-dato', async () => {
    server.widget = [conComandi()];
    await monta_(DashboardPanel as never, {});
    const s = scelta();
    expect(s, 'SceltaColonne').toBeDefined();
    expect([...(s!.props.ordine as number[])].sort()).toEqual([0, 2]);
  });

  it('le mostrate della scelta non contengono comandi', async () => {
    server.widget = [conComandi()];
    await monta_(DashboardPanel as never, {});
    const m = scelta()!.props.mostrate as number[];
    expect(m.filter((i) => i === 1 || i === 3)).toEqual([]);
  });

  it('la tabella riceve tutte le colonne (C2: restano nella sorgente, nella loro posizione)', async () => {
    server.widget = [conComandi()];
    await monta_(DashboardPanel as never, {});
    const tab = elements(articolo(11)).find((e) => typeof e.props.onApri === 'function' && Array.isArray(e.props.colonne));
    expect(tab).toBeDefined();
    expect((tab!.props.colonne as unknown[]).length).toBe(4);
  });
});
