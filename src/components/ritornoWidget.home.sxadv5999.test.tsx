import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';

// SXADV-5999.3 — «Torna al widget», lato Home. Oracolo:
// docs/sxadv-62-prove/RITORNO_contratto.md, R3 punti 2-4 e la «Superficie per le prove»:
//   - HomePanel `mostraWidget`: se presente apre su Dashboard (anche con avvisi nuovi)
//     e la passa al pannello;
//   - DashboardPanel `mostraWidget`: appena il riquadro article[data-widget="<id>"] c'e',
//     lo porta in vista (scrollIntoView) e lo evidenzia (classe dash-widget-ritorno,
//     tolta dopo circa 2 s); una volta per montaggio/valore; widget assente = niente.
// La parte della Shell sta in ritornoWidget.sxadv5999.test.tsx.
//
// Niente DOM nel progetto (vitest in node, senza jsdom): il componente si esegue come
// funzione con un motore di hook finto che fa girare anche gli effetti (con le loro
// dipendenze, come React). Dopo ogni disegno gli <article data-widget> dell'albero
// si «montano» su nodi finti: document.querySelector('[data-widget="7"]') li trova, un
// eventuale ref li riceve, e scrollIntoView (stubbato sul prototipo di Element) annota
// chi e' stato portato in vista. L'evidenza si legge dalla classe: nella prop
// className dell'article disegnato o nel classList del nodo, come la mette il codice.

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

const fb = vi.hoisted(() => ({ errori: [] as unknown[] }));
vi.mock('../hooks/feedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/feedback')>()),
  useFeedback: () => ({
    showServerMessages: (e: unknown) => { fb.errori.push(e); },
    error: (e: unknown) => { fb.errori.push(e); },
    warning: () => {},
    info: () => {},
    failure: (e: unknown) => { fb.errori.push(e); },
  }),
}));
vi.mock('./BannerCard', () => ({ default: () => null }));

// Il server della dashboard: dashboard.Get risponde i widget del caso.
const server = vi.hoisted(() => ({
  widget: [] as unknown[],
  chiamate: [] as { action: string; params: Record<string, string> }[],
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  postAction2: async (action: string, params: Record<string, string>) => {
    server.chiamate.push({ action, params: { ...(params || {}) } });
    switch (action) {
      case 'dashboard.Get': return { widget: server.widget };
      case 'dashboard.ApriRecord': return { esito: 'ok', viewName: 'documentiDetail' };
      case 'dashboard.PreparaNaviga': return { esito: 'ok' };
      case 'dashboard.SegnaViste': return { segnate: [] };
      default: return {};
    }
  },
  subscribeInFlight: () => () => {},
}));

const { default: HomePanel } = await import('./HomePanel');
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

/** Cambia le prop dello stesso componente montato (un ridisegno dal genitore). */
async function nuoveProp(p: Record<string, unknown>, ms = 100): Promise<void> {
  proprieta = { ...proprieta, ...p };
  disegna();
  await passa(ms);
}

const evidenziato = (id: number) => {
  const a = articoli().find((e) => Number(e.props['data-widget']) === id);
  const daClasse = /\bdash-widget-ritorno\b/.test(String(a?.props.className ?? ''));
  return daClasse || !!nodi.get(id)?.classi.has('dash-widget-ritorno');
};

function widget(id: number, titolo: string) {
  return {
    idWidget: id,
    titolo,
    dettaglio: 'documentiDetail',
    colonne: [{ item: 'numero', etichetta: 'Numero' }],
    fotografia: {
      stato: 'OK',
      ts: '2026-10-23T08:00:00',
      totaleRighe: 1,
      righeInFotografia: 1,
      righe: [{ k: `K${id}`, c: [{ t: `N${id}` }] }],
    },
  };
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
  inVista.length = 0;
  fb.errori = [];
  server.chiamate = [];
  server.widget = [widget(3, 'Scadenze'), widget(7, 'Fatture da incassare'), widget(9, 'Ordini aperti')];
  (g.localStorage as { clear: () => void }).clear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────── DashboardPanel
describe('SXADV-5999.3 R3: DashboardPanel con mostraWidget', () => {
  it('porta in vista il riquadro del widget, e solo quello', async () => {
    await monta_(DashboardPanel as never, { mostraWidget: 7 });
    expect(articoli().length, 'i tre widget a schermo').toBe(3);
    expect(inVista).toContain(7);
    expect(inVista.filter((id) => id !== 7)).toEqual([]);
  });

  it('lo evidenzia con dash-widget-ritorno, e solo lui', async () => {
    await monta_(DashboardPanel as never, { mostraWidget: 7 });
    expect(evidenziato(7)).toBe(true);
    expect(evidenziato(3)).toBe(false);
    expect(evidenziato(9)).toBe(false);
  });

  it('l\'evidenza dura un momento: c\'e\' ancora a 1 s, non piu\' dopo circa 2 s', async () => {
    await monta_(DashboardPanel as never, { mostraWidget: 7 });
    await passa(900);
    expect(evidenziato(7), 'a ~1 s').toBe(true);
    await passa(2500);
    expect(evidenziato(7), 'a ~3,5 s').toBe(false);
  });

  it('senza mostraWidget: nessuno scorrimento, nessuna evidenza (la Home di oggi)', async () => {
    await monta_(DashboardPanel as never, {});
    expect(articoli().length).toBe(3);
    expect(inVista).toEqual([]);
    expect([3, 7, 9].some(evidenziato)).toBe(false);
  });

  it('mostraWidget null: come senza', async () => {
    await monta_(DashboardPanel as never, { mostraWidget: null });
    expect(inVista).toEqual([]);
    expect([3, 7, 9].some(evidenziato)).toBe(false);
  });

  it('widget che non c\'e\' piu\': la dashboard si apre normalmente, senza errori', async () => {
    await monta_(DashboardPanel as never, { mostraWidget: 42 });
    expect(articoli().length).toBe(3);
    expect(inVista).toEqual([]);
    expect([3, 7, 9].some(evidenziato)).toBe(false);
    expect(fb.errori).toEqual([]);
  });

  it('dashboard vuota con mostraWidget: nessun errore', async () => {
    server.widget = [];
    await monta_(DashboardPanel as never, { mostraWidget: 7 });
    expect(inVista).toEqual([]);
    expect(fb.errori).toEqual([]);
  });

  it('una volta per valore: altri ridisegni e una rilettura della dashboard non lo rifanno', async () => {
    await monta_(DashboardPanel as never, { mostraWidget: 7 });
    expect(inVista.filter((id) => id === 7)).toHaveLength(1);
    await nuoveProp({ mostraWidget: 7 }, 3000);
    // Una rilettura (ricarica = la Home torna a galla) rimette gli stessi widget.
    await nuoveProp({ ricarica: 1 }, 3000);
    expect(inVista.filter((id) => id === 7), 'portato in vista una volta sola').toHaveLength(1);
    expect(evidenziato(7), 'e niente seconda evidenza').toBe(false);
  });

  it('un valore nuovo porta in vista il widget nuovo', async () => {
    await monta_(DashboardPanel as never, { mostraWidget: 7 });
    await nuoveProp({ mostraWidget: 9 });
    expect(inVista).toContain(9);
    expect(evidenziato(9)).toBe(true);
  });

  it('il widget arriva dopo (lettura lenta): lo si porta in vista appena c\'e\'', async () => {
    const tutti = server.widget;
    server.widget = [];
    await monta_(DashboardPanel as never, { mostraWidget: 7 });
    expect(inVista).toEqual([]);
    server.widget = tutti;
    await nuoveProp({ ricarica: 1 });
    expect(inVista).toContain(7);
    expect(evidenziato(7)).toBe(true);
  });
});

// Perche' la Shell possa ricordare il widget anche dal clic su una RIGA (R1), il
// pannello deve dirle da quale widget viene. Il contratto non fissa la firma: si
// prova solo che l'id del widget arriva a onApriDettaglio.
describe('SXADV-5999.3 R1: dalla dashboard alla Shell arriva il widget', () => {
  it('clic su una riga: onApriDettaglio riceve anche l\'id del widget', async () => {
    const onApriDettaglio = vi.fn(() => true);
    await monta_(DashboardPanel as never, { onApriDettaglio });
    const art = articoli().find((e) => Number(e.props['data-widget']) === 7)!;
    const tabella = elements(art).find((e) => typeof e.props.onApri === 'function');
    expect(tabella, 'la tabella del widget 7').toBeDefined();
    (tabella!.props.onApri as (r: unknown) => void)({ k: 'K7', c: [{ t: 'N7' }] });
    await passa(50);
    expect(onApriDettaglio).toHaveBeenCalledTimes(1);
    const args = onApriDettaglio.mock.calls[0] as unknown[];
    expect(args[0]).toBe('Fatture da incassare');
    expect(args.some((a) => a === 7 || a === '7')).toBe(true);
  });

  it('«Apri la lista completa»: onNaviga riceve titolo e id del widget', async () => {
    const onNaviga = vi.fn(() => true);
    await monta_(DashboardPanel as never, { onNaviga });
    const art = articoli().find((e) => Number(e.props['data-widget']) === 9)!;
    const bottone = elements(art).find((e) => e.props['aria-label'] === 'Naviga alla lista di origine');
    expect(bottone, 'il bottone «Apri la lista completa»').toBeDefined();
    (bottone!.props.onClick as () => void)();
    await passa(50);
    expect(onNaviga).toHaveBeenCalledWith('Ordini aperti', 9);
  });
});

// ─────────────────────────────────────────────────────────────── HomePanel
describe('SXADV-5999.3 R3: HomePanel con mostraWidget', () => {
  const conAvvisoNuovo = {
    login: '44AMM',
    banners: [{ text: 'Manutenzione sabato', hpText: 'Manutenzione sabato', banDate: '2026-10-22' }],
  };

  const vista = () => {
    const seg = elements(tree).find((e) => 'value' in e.props && Array.isArray(e.props.options));
    return seg?.props.value as string | undefined;
  };
  const pannello = () => elements(tree).find((e) => e.type === DashboardPanel);

  it('controllo: oggi, con un avviso nuovo, la Home si apre sugli Avvisi', async () => {
    await monta_(HomePanel as never, { loginInfo: conAvvisoNuovo });
    expect(vista()).toBe('avvisi');
    expect(pannello()).toBeUndefined();
  });

  it('con mostraWidget si apre sulla Dashboard anche con avvisi nuovi', async () => {
    await monta_(HomePanel as never, { loginInfo: conAvvisoNuovo, mostraWidget: 7 });
    expect(vista()).toBe('dashboard');
    expect(pannello(), 'la dashboard a video').toBeDefined();
  });

  it('... e resta sulla Dashboard anche dopo l\'apertura (gli avvisi non la scavalcano)', async () => {
    await monta_(HomePanel as never, { loginInfo: conAvvisoNuovo, mostraWidget: 7 });
    await passa(2000);
    expect(vista()).toBe('dashboard');
  });

  it('passa mostraWidget al pannello della dashboard', async () => {
    await monta_(HomePanel as never, { loginInfo: { login: '44AMM' }, mostraWidget: 7 });
    expect(pannello()?.props.mostraWidget).toBe(7);
  });

  it('senza mostraWidget il pannello non riceve nessun widget da mostrare', async () => {
    await monta_(HomePanel as never, { loginInfo: { login: '44AMM' } });
    expect(vista()).toBe('dashboard');
    expect(pannello()?.props.mostraWidget ?? null).toBeNull();
  });
});
