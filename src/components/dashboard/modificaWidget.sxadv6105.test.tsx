import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';

// SXADV-6105 — il pannello «Modifica widget» (ModificaWidget): le date della ricerca.
// Oracolo: ~/ui-new-6105/CONTRATTO-6105.md, punto 9. Chi prova non e' chi implementa.
//
//   - la sezione «Le date della ricerca» (col componente DateDellaRicerca) c'e' solo se il
//     widget ha criteriData non vuoti;
//   - si parte da `date` della Get: chi non c'e' = fissa, giorni 30;
//   - al Salva `date` (JSON) va a dashboard.Save SOLO se la scelta e' diversa da quella
//     ricevuta; altrimenti il parametro non c'e';
//   - una nota dice che la lista nuova arriva col primo aggiornamento dopo il Salva.
//
// Impianto: quello di addWidgetModal.sxadv6100.test.tsx (niente DOM, motore di hook finto).
// DateDellaRicerca non si espande: la prova chiama la sua onChange come farebbe l'utente,
// e il tasto Salva del footer con la sua onClick.
// Lettura della prova (dichiarata): «la scelta e' diversa» si giudica sul modo e, per
// oggiMenoGiorni, sui giorni; cambiare e poi rimettere com'era = nessun cambiamento.

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
vi.mock('../../hooks/feedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/feedback')>()),
  useFeedback: () => ({
    showServerMessages: (e: unknown) => { fb.errori.push(e); },
    error: (e: unknown) => { fb.errori.push(e); },
    warning: () => {},
    info: () => {},
    failure: (e: unknown) => { fb.errori.push(e); },
    confirm: () => {},
  }),
}));

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  const finto = { resetFields() {}, setFieldsValue() {}, submit() {}, getFieldsValue: () => ({}) };
  const Form = Object.assign((p: unknown) => (actual.Form as unknown as (x: unknown) => unknown)(p), actual.Form, {
    useForm: () => [finto],
  });
  return { ...actual, Form };
});


const server = vi.hoisted(() => ({
  save: { esito: 'ok' } as Record<string, unknown>,
  chiamate: [] as { action: string; params: Record<string, string> }[],
}));
vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  postAction2: async (action: string, params: Record<string, string>) => {
    server.chiamate.push({ action, params: { ...(params || {}) } });
    switch (action) {
      case 'dashboard.ColonneDettaglio': return { esito: 'ok', vista: null, candidati: [] };
      case 'dashboard.Save': return server.save;
      case 'dashboard.Preview': return { esito: 'ok', risultato: { tipo: 'list' } };
      default: return {};
    }
  },
  subscribeInFlight: () => () => {},
}));

const { default: ModificaWidget } = await import('./ModificaWidget');
const { default: DateDellaRicerca } = await import('./DateDellaRicerca');
const { Button, Form } = await import('antd');


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



function testoDi(n: unknown): string {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(testoDi).join('');
  const e = n as El;
  if (e.props) return testoDi(e.props.children);
  return '';
}


type Scelta = { modo: string; giorni: number };
const OGGI_VALE = { oggi: '23/10/2026', ieri: '22/10/2026', inizioMese: '01/10/2026', fineMesePrecedente: '30/09/2026', inizioAnno: '01/01/2026', oggiIso: '2026-10-23' };
const DA = 'dataDa.S1-0';
const A = 'dataA.S1-0';
const NASCITA = 'indipendente.nascitaData.S1-0';
const CRITERI = [
  { chiave: DA, campo: 'dataDa', etichetta: 'Dal', valore: '01/01/2026', modoProposto: 'fissa', oggiVale: OGGI_VALE },
  { chiave: A, campo: 'dataA', etichetta: 'Al', valore: '23/10/2026', modoProposto: 'oggi', oggiVale: OGGI_VALE },
  { chiave: NASCITA, campo: 'indipendente.nascitaData', etichetta: 'Nato il', valore: '1980-05-01', modoProposto: 'fissa', oggiVale: OGGI_VALE },
];
/** Come le manda la Get: solo le mobili. */
const DATE = { [DA]: { modo: 'inizioMese' }, [NASCITA]: { modo: 'oggiMenoGiorni', giorni: 10 } };

const widget = (p: Record<string, unknown> = {}) => ({
  idWidget: 7,
  titolo: 'Saldi',
  forma: 'list',
  intervalloMin: 60,
  trasformazione: null,
  opzioni: null,
  colonne: [{ item: 'a', etichetta: 'A', tipo: 'Text' }],
  criteriData: CRITERI,
  date: DATE,
  ...p,
});

const componenteDate = () => elements(tree).filter((e) => e.type === DateDellaRicerca);
const sezione = () => elements(tree).find((e) => e.type === Form.Item && e.props.label === 'Le date della ricerca');
const scelte = () => componenteDate()[0].props.scelte as Record<string, Scelta>;

async function apri(w: Record<string, unknown> | null) {
  await monta_(ModificaWidget as never, { widget: w, sid: 'S1', onClose: () => {}, onSalvato: () => {}, aziende: [] });
  await passa(500);
}
async function scegli(chiave: string, scelta: Scelta) {
  (componenteDate()[0].props.onChange as (k: string, s: Scelta) => void)(chiave, scelta);
  await passa(50);
}
async function salva(): Promise<Record<string, string> | undefined> {
  const b = elements(tree).find((e) => e.type === Button && testoDi(e.props.children) === 'Salva');
  expect(b, 'il tasto Salva').toBeDefined();
  (b!.props.onClick as () => void)();
  await passa(200);
  const s = server.chiamate.filter((c) => c.action === 'dashboard.Save');
  expect(s.length, 'una dashboard.Save').toBe(1);
  return s[0]?.params;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  rt.slots = [];
  rt.effects = [];
  fb.errori = [];
  server.chiamate = [];
  server.save = { esito: 'ok' };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SXADV-6105 Modifica widget: la sezione delle date', () => {
  it('con criteriData: la sezione «Le date della ricerca» col componente', async () => {
    await apri(widget());
    expect(sezione(), 'la sezione').toBeDefined();
    expect(componenteDate().length).toBe(1);
    expect(elements(sezione()).some((e) => e.type === DateDellaRicerca)).toBe(true);
    expect(componenteDate()[0].props.criteri).toEqual(CRITERI);
  });

  it('senza criteriData: niente sezione', async () => {
    await apri(widget({ criteriData: undefined, date: undefined }));
    expect(sezione()).toBeUndefined();
    expect(componenteDate().length).toBe(0);
  });

  it('criteriData vuoti: niente sezione', async () => {
    await apri(widget({ criteriData: [], date: {} }));
    expect(sezione()).toBeUndefined();
    expect(componenteDate().length).toBe(0);
  });

  it('una nota dice che la lista nuova arriva col primo aggiornamento dopo il Salva', async () => {
    await apri(widget());
    const s = sezione()!;
    const testo = [testoDi(s.props.extra), testoDi(s.props.help), testoDi(s.props.tooltip), testoDi(s.props.children)].join(' ');
    expect(testo).toMatch(/aggiornamento/i);
    expect(testo).toMatch(/Salva/);
  });
});

describe('SXADV-6105 Modifica widget: si parte da `date`', () => {
  it('le scelte salvate e, per chi non c\'e\', fissa con giorni 30', async () => {
    await apri(widget());
    const s = scelte();
    expect(s[DA].modo).toBe('inizioMese');
    expect(s[NASCITA]).toEqual({ modo: 'oggiMenoGiorni', giorni: 10 });
    expect(s[A]).toEqual({ modo: 'fissa', giorni: 30 });
  });

  it('non la proposta: «Al» proposto oggi ma non salvato resta fissa', async () => {
    await apri(widget());
    expect(scelte()[A].modo).toBe('fissa');
  });

  it('date assenti (null): tutte ferme', async () => {
    await apri(widget({ date: null }));
    for (const c of CRITERI) expect(scelte()[c.chiave]).toEqual({ modo: 'fissa', giorni: 30 });
  });
});

describe('SXADV-6105 Modifica widget: `date` va al Salva solo se cambiata', () => {
  it('senza cambiamenti il parametro date non c\'e\'', async () => {
    await apri(widget());
    const p = await salva();
    expect(p).toBeDefined();
    expect('date' in (p || {})).toBe(false);
  });

  it('senza criteriData il parametro date non c\'e\'', async () => {
    await apri(widget({ criteriData: undefined, date: undefined }));
    const p = await salva();
    expect('date' in (p || {})).toBe(false);
  });

  it('cambiato un modo: date c\'e\', JSON, con la scelta nuova', async () => {
    await apri(widget());
    await scegli(A, { modo: 'ieri', giorni: 30 });
    const p = await salva();
    expect(p?.date, 'il parametro date').toBeDefined();
    const d = JSON.parse(p!.date);
    expect(d[A].modo).toBe('ieri');
    // chi non e' stato toccato, se compare, compare com'era
    if (d[DA]) expect(d[DA].modo).toBe('inizioMese');
    if (d[NASCITA]) expect(d[NASCITA]).toMatchObject({ modo: 'oggiMenoGiorni', giorni: 10 });
  });

  it('una data mobile rimessa ferma: date c\'e\' e la dice fissa (o la toglie)', async () => {
    await apri(widget());
    await scegli(DA, { modo: 'fissa', giorni: 30 });
    const p = await salva();
    expect(p?.date).toBeDefined();
    const d = JSON.parse(p!.date);
    // il server tratta come «resta come salvata» chi non e' nominato: allora DEVE esserci, fissa
    expect(d[DA]?.modo).toBe('fissa');
  });

  it('cambiati solo i giorni di oggiMenoGiorni: date c\'e\'', async () => {
    await apri(widget());
    await scegli(NASCITA, { modo: 'oggiMenoGiorni', giorni: 20 });
    const p = await salva();
    expect(p?.date).toBeDefined();
    expect(JSON.parse(p!.date)[NASCITA]).toMatchObject({ modo: 'oggiMenoGiorni', giorni: 20 });
  });

  it('cambiato e rimesso com\'era: il parametro date non c\'e\'', async () => {
    await apri(widget());
    await scegli(A, { modo: 'oggi', giorni: 30 });
    await scegli(A, { modo: 'fissa', giorni: 30 });
    const p = await salva();
    expect('date' in (p || {})).toBe(false);
  });

  it('la chiave col nome del controllo con i punti arriva intera', async () => {
    await apri(widget());
    await scegli(NASCITA, { modo: 'inizioAnno', giorni: 10 });
    const p = await salva();
    const d = JSON.parse(p!.date);
    expect(d[NASCITA].modo).toBe('inizioAnno');
  });
});
