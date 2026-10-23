import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';

// SXADV-6105 — «Aggiungi alla dashboard» (AddWidgetModal): le date della ricerca.
// Oracolo: ~/ui-new-6105/CONTRATTO-6105.md, punto 8. Chi prova non e' chi implementa.
//
//   - il componente DateDellaRicerca sta sotto «Filtri della ricerca», in una sezione
//     intitolata «Le date della ricerca», e riceve i criteriData della bozza;
//   - i Tag dei filtri seguono la scelta DAL VIVO: il Tag del filtro il cui `campo` e'
//     quello di un criterio con modo mobile mostra «<etichetta>: <testo del modo>»;
//   - R7 (revisione 23/10): solo con esattamente un criterio e un filtro per quel `campo`,
//     e filtro non casella; con filtriLeggibili === false la nota sotto i Tag dice «Gli
//     altri valori...» se almeno un Tag e' riscritto, altrimenti «I valori...».
//
// Impianto: copiato da addWidgetModal.sxadv6100.test.tsx (niente DOM, motore di hook finto,
// Form.useForm finto). DateDellaRicerca NON si espande: e' un elemento dell'albero, e la
// prova chiama la sua onChange come farebbe l'utente.

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
  bozza: {} as Record<string, unknown>,
  chiamate: [] as { action: string; params: Record<string, string> }[],
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  postAction2: async (action: string, params: Record<string, string>) => {
    server.chiamate.push({ action, params: { ...(params || {}) } });
    if (action === 'dashboard.AddWidget') return server.bozza;
    return {};
  },
  subscribeInFlight: () => () => {},
}));


const { default: AddWidgetModal } = await import('./AddWidgetModal');
const { default: DateDellaRicerca } = await import('./dashboard/DateDellaRicerca');
const { Form, Tag, Typography } = await import('antd');


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


const tags = () => elements(tree).filter((e) => e.type === Tag).map((e) => testoDi(e.props.children));
const componenteDate = () => elements(tree).filter((e) => e.type === DateDellaRicerca);
const formItem = (label: string) => elements(tree).find((e) => e.type === Form.Item && e.props.label === label);

type Scelta = { modo: string; giorni: number };
async function scegli(chiave: string, scelta: Scelta) {
  const c = componenteDate()[0];
  (c.props.onChange as (k: string, s: Scelta) => void)(chiave, scelta);
  await passa(50);
}

const OGGI_VALE = { oggi: '23/10/2026', ieri: '22/10/2026', inizioMese: '01/10/2026', fineMesePrecedente: '30/09/2026', inizioAnno: '01/01/2026', oggiIso: '2026-10-23' };

const FILTRI = [
  { campo: 'data', etichetta: 'Alla data', valore: '18/09/2026', negato: false, casella: false },
  { campo: 'cliente', etichetta: 'Cliente', valore: 'ROSSI', negato: false, casella: false },
  { campo: 'indipendente', etichetta: 'Indipendente', valore: 'S', negato: false, casella: false },
  { campo: 'indipendente.nascitaData', etichetta: 'Nato il', valore: '01/05/1980', negato: false, casella: false },
];
const CRITERI = [
  { chiave: 'data.S1-2', campo: 'data', etichetta: 'Alla data', valore: '18/09/2026', modoProposto: 'fissa', oggiVale: OGGI_VALE },
  { chiave: 'indipendente.nascitaData.S1-0', campo: 'indipendente.nascitaData', etichetta: 'Nato il', valore: '01/05/1980', modoProposto: 'fissa', oggiVale: OGGI_VALE },
];

function bozza(filtri: unknown[] = FILTRI, criteriData: unknown[] = CRITERI) {
  return {
    esito: 'ok',
    widget: { titolo: 'Saldi', intervalloMin: 60 },
    sorgente: { filtri, filtriLeggibili: true, colonne: [{ item: 'a', etichetta: 'A' }], criteriData, listView: 'saldiList' },
  };
}

async function apri() {
  await monta_(AddWidgetModal as never, { open: true, sid: 'S1', onClose: () => {}, onAggiunto: () => {} });
  await passa(200);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  rt.slots = [];
  rt.effects = [];
  fb.errori = [];
  server.chiamate = [];
  server.bozza = bozza();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SXADV-6105 AddWidgetModal: il componente delle date', () => {
  it('DateDellaRicerca c\'e\', una volta, coi criteriData della bozza', async () => {
    await apri();
    const c = componenteDate();
    expect(c.length).toBe(1);
    expect(c[0].props.criteri).toEqual(CRITERI);
  });

  it('sta in una sezione «Le date della ricerca», dopo «Filtri della ricerca»', async () => {
    await apri();
    const sezione = formItem('Le date della ricerca');
    expect(sezione, 'la sezione').toBeDefined();
    expect(elements(sezione).some((e) => e.type === DateDellaRicerca)).toBe(true);
    const ordine = elements(tree).filter((e) => e.type === Form.Item).map((e) => e.props.label);
    expect(ordine.indexOf('Filtri della ricerca')).toBeGreaterThanOrEqual(0);
    expect(ordine.indexOf('Le date della ricerca')).toBeGreaterThan(ordine.indexOf('Filtri della ricerca'));
  });

  it('le scelte partono dalle proposte del server', async () => {
    server.bozza = bozza(FILTRI, [{ ...CRITERI[0], modoProposto: 'oggi' }, CRITERI[1]]);
    await apri();
    const scelte = componenteDate()[0].props.scelte as Record<string, Scelta>;
    expect(scelte['data.S1-2'].modo).toBe('oggi');
    expect(scelte['indipendente.nascitaData.S1-0'].modo).toBe('fissa');
  });

  it('senza criteriData il componente non c\'e\'', async () => {
    server.bozza = bozza(FILTRI, []);
    await apri();
    expect(componenteDate().length).toBe(0);
  });
});

describe('SXADV-6105 AddWidgetModal: i Tag dei filtri seguono la scelta', () => {
  it('data ferma: il Tag mostra il valore della ricerca', async () => {
    await apri();
    expect(tags()).toContain('Alla data: 18/09/2026');
  });

  it('proposta «oggi»: il Tag dice «Alla data: oggi» dall\'apertura', async () => {
    server.bozza = bozza(FILTRI, [{ ...CRITERI[0], modoProposto: 'oggi' }, CRITERI[1]]);
    await apri();
    expect(tags()).toContain('Alla data: oggi');
    expect(tags()).not.toContain('Alla data: 18/09/2026');
  });

  it.each([
    ['oggi', 30, 'Alla data: oggi'],
    ['ieri', 30, 'Alla data: ieri'],
    ['inizioMese', 30, 'Alla data: il primo del mese in corso'],
    ['fineMesePrecedente', 30, "Alla data: l'ultimo giorno del mese scorso"],
    ['inizioAnno', 30, "Alla data: il primo gennaio dell'anno in corso"],
    ['oggiMenoGiorni', 30, 'Alla data: oggi meno 30 giorni'],
    ['oggiMenoGiorni', 1, 'Alla data: oggi meno 1 giorno'],
  ])('scelta %s (%i): il Tag diventa «%s»', async (modo, giorni, atteso) => {
    await apri();
    await scegli('data.S1-2', { modo, giorni });
    expect(tags()).toContain(atteso);
    expect(tags()).not.toContain('Alla data: 18/09/2026');
  });

  it('tornando a fissa il Tag torna al valore della ricerca', async () => {
    await apri();
    await scegli('data.S1-2', { modo: 'oggiMenoGiorni', giorni: 30 });
    expect(tags()).toContain('Alla data: oggi meno 30 giorni');
    await scegli('data.S1-2', { modo: 'fissa', giorni: 30 });
    expect(tags()).toContain('Alla data: 18/09/2026');
  });

  it('cambiare i giorni cambia il Tag', async () => {
    await apri();
    await scegli('data.S1-2', { modo: 'oggiMenoGiorni', giorni: 30 });
    await scegli('data.S1-2', { modo: 'oggiMenoGiorni', giorni: 45 });
    expect(tags()).toContain('Alla data: oggi meno 45 giorni');
    expect(tags()).not.toContain('Alla data: oggi meno 30 giorni');
  });

  it('gli altri filtri non cambiano', async () => {
    await apri();
    await scegli('data.S1-2', { modo: 'oggi', giorni: 30 });
    expect(tags()).toContain('Cliente: ROSSI');
    expect(tags()).toContain('Indipendente: S');
    expect(tags()).toContain('Nato il: 01/05/1980');
  });

  it('nome del controllo con i punti: cambia solo il suo filtro, non quello col prefisso', async () => {
    await apri();
    await scegli('indipendente.nascitaData.S1-0', { modo: 'inizioAnno', giorni: 30 });
    expect(tags()).toContain("Nato il: il primo gennaio dell'anno in corso");
    expect(tags()).toContain('Indipendente: S');
    expect(tags()).toContain('Alla data: 18/09/2026');
  });

  it('il Salva manda le scelte fatte (date in JSON)', async () => {
    await apri();
    await scegli('data.S1-2', { modo: 'oggiMenoGiorni', giorni: 30 });
    const form = elements(tree).find((e) => e.type === Form && typeof e.props.onFinish === 'function');
    expect(form, 'il Form').toBeDefined();
    await (form!.props.onFinish as (v: unknown) => Promise<void>)({ titolo: 'Saldi', intervallo: 60 });
    await passa(50);
    const salva = server.chiamate.filter((c) => c.action === 'dashboard.AddWidget' && c.params.anteprima !== 'true');
    expect(salva.length).toBe(1);
    const date = JSON.parse(salva[0].params.date);
    expect(date['data.S1-2']).toEqual({ modo: 'oggiMenoGiorni', giorni: 30 });
    expect(date['indipendente.nascitaData.S1-0'].modo).toBe('fissa');
  });
});

describe('SXADV-6105 R7: il Tag si riscrive solo se il campo e\' univoco', () => {
  const nota = () =>
    elements(tree).filter((e) => e.type === Typography.Text).map((e) => testoDi(e.props.children).trim());

  it('due filtri con lo stesso campo: nessuno dei due si riscrive', async () => {
    server.bozza = bozza(
      [
        { campo: 'data', etichetta: 'Dal', valore: '01/09/2026', negato: false, casella: false },
        { campo: 'data', etichetta: 'Al', valore: '30/09/2026', negato: false, casella: false },
      ],
      [CRITERI[0]]
    );
    await apri();
    await scegli('data.S1-2', { modo: 'oggi', giorni: 30 });
    expect(tags()).toEqual(['Dal: 01/09/2026', 'Al: 30/09/2026']);
  });

  it('due criteri con lo stesso campo: il filtro non si riscrive', async () => {
    server.bozza = bozza(
      [FILTRI[0]],
      [CRITERI[0], { ...CRITERI[0], chiave: 'data.S3-4', etichetta: 'Alla data (2)' }]
    );
    await apri();
    await scegli('data.S1-2', { modo: 'oggi', giorni: 30 });
    expect(tags()).toEqual(['Alla data: 18/09/2026']);
  });

  it('un filtro casella non si riscrive', async () => {
    server.bozza = bozza(
      [{ campo: 'data', etichetta: 'Con data', valore: 'true', negato: false, casella: true }],
      [CRITERI[0]]
    );
    await apri();
    await scegli('data.S1-2', { modo: 'oggi', giorni: 30 });
    expect(tags()).toEqual(['Con data']);
  });

  it('il campo univoco accanto a un campo doppio si riscrive lo stesso', async () => {
    server.bozza = bozza(
      [
        { campo: 'data', etichetta: 'Dal', valore: '01/09/2026', negato: false, casella: false },
        { campo: 'data', etichetta: 'Al', valore: '30/09/2026', negato: false, casella: false },
        FILTRI[3],
      ],
      [CRITERI[0], CRITERI[1]]
    );
    await apri();
    await scegli('data.S1-2', { modo: 'oggi', giorni: 30 });
    await scegli('indipendente.nascitaData.S1-0', { modo: 'ieri', giorni: 30 });
    expect(tags()).toEqual(['Dal: 01/09/2026', 'Al: 30/09/2026', 'Nato il: ieri']);
  });

  it('filtriLeggibili false, nessun Tag riscritto: «I valori sono quelli inseriti nella ricerca.»', async () => {
    server.bozza = { ...bozza(), sorgente: { ...bozza().sorgente, filtriLeggibili: false } };
    await apri();
    expect(nota()).toContain('I valori sono quelli inseriti nella ricerca.');
    expect(nota()).not.toContain('Gli altri valori sono quelli inseriti nella ricerca.');
  });

  it('filtriLeggibili false, un Tag riscritto: «Gli altri valori sono quelli inseriti nella ricerca.»', async () => {
    server.bozza = { ...bozza(), sorgente: { ...bozza().sorgente, filtriLeggibili: false } };
    await apri();
    await scegli('data.S1-2', { modo: 'oggi', giorni: 30 });
    expect(nota()).toContain('Gli altri valori sono quelli inseriti nella ricerca.');
    expect(nota()).not.toContain('I valori sono quelli inseriti nella ricerca.');
  });

  it('filtriLeggibili false, scelta mobile su un campo doppio (nessun Tag riscritto): «I valori...»', async () => {
    const b = bozza(
      [
        { campo: 'data', etichetta: 'Dal', valore: '01/09/2026', negato: false, casella: false },
        { campo: 'data', etichetta: 'Al', valore: '30/09/2026', negato: false, casella: false },
      ],
      [CRITERI[0]]
    );
    server.bozza = { ...b, sorgente: { ...b.sorgente, filtriLeggibili: false } };
    await apri();
    await scegli('data.S1-2', { modo: 'oggi', giorni: 30 });
    expect(nota()).toContain('I valori sono quelli inseriti nella ricerca.');
    expect(nota()).not.toContain('Gli altri valori sono quelli inseriti nella ricerca.');
  });

  it('filtriLeggibili true: nessuna delle due note', async () => {
    await apri();
    await scegli('data.S1-2', { modo: 'oggi', giorni: 30 });
    expect(nota()).not.toContain('I valori sono quelli inseriti nella ricerca.');
    expect(nota()).not.toContain('Gli altri valori sono quelli inseriti nella ricerca.');
  });
});
