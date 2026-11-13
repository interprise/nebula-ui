import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';

// SXADV-6114 · «Modifica widget», sezione «Ordina» (contratto ~/ui-new-6114/CONTRATTO-6114.md, O5).
// Voce «Ordina» subito dopo «Calcola», visibile con forma non Lista e un raggruppamento; due select
// («Tipo di ordinamento», «Colonna di ordinamento»); `ordina` nella trasformazione di Preview e Save
// solo se la scelta non e' quella predefinita (desc + valore) e c'e' un raggruppamento.
// Impianto: quello di modificaWidget.sxadv6110.test.tsx. Chi prova non e' chi implementa.

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

const fb = vi.hoisted(() => ({ errori: [] as unknown[], avvisi: [] as unknown[] }));
vi.mock('../../hooks/feedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/feedback')>()),
  useFeedback: () => ({
    showServerMessages: (e: unknown) => { fb.errori.push(e); },
    error: (e: unknown) => { fb.errori.push(e); },
    warning: (m: unknown) => { fb.avvisi.push(m); },
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


const { Button, Form, Radio, Select, Checkbox } = await import('antd');

// Il «DOM» finto: quanto basta perche' antd non cerchi altro.
const noop = () => {};
const g = globalThis as Record<string, unknown>;
class FakeElement {}
g.Element ??= FakeElement;
g.HTMLElement ??= g.Element;
g.document = {
  body: { style: {}, classList: { add: noop, remove: noop, contains: () => false } },
  documentElement: { style: {}, classList: { add: noop, remove: noop, contains: () => false } },
  visibilityState: 'visible',
  hidden: false,
  activeElement: null,
  querySelector: () => null,
  querySelectorAll: () => [],
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

function elements(node: unknown, out: El[] = [], seen = new Set<unknown>()): El[] {
  if (node == null || typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const n of node) elements(n, out, seen);
    return out;
  }
  const el = node as El;
  if ((el as unknown as { $$typeof?: unknown }).$$typeof !== undefined && el.props) {
    out.push(el);
    const { children, ...rest } = el.props;
    for (const [k, v] of Object.entries(rest)) {
      if (k === 'widget' || k === 'style') continue;
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

function disegna(p: Record<string, unknown> = proprieta): void {
  for (let giro = 0; giro < 40; giro++) {
    rt.dirty = false;
    rt.active = true;
    rt.i = 0;
    rt.effects = [];
    try {
      tree = (ModificaWidget as unknown as (x: unknown) => unknown)(p);
    } finally {
      rt.active = false;
    }
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

let proprieta: Record<string, unknown> = {};

async function passa(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 16) {
    await vi.advanceTimersByTimeAsync(Math.min(16, ms - t));
    disegna();
  }
}

function testoDi(n: unknown): string {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(testoDi).join('');
  const e = n as El;
  if (e.props) return testoDi(e.props.children);
  return '';
}


const COLONNE = [
  { item: 'dataDoc', etichetta: 'Data doc.', tipo: 'Date' },
  { item: 'sede', etichetta: 'Sede', tipo: 'Text' },
  { item: 'totale', etichetta: 'Totale doc.', tipo: 'Number' },
];
const SOMMA = { agg: 'sum', col: 'totale', group: ['dataDoc'], topN: 10, resto: 'altri' };

const widget = (trasformazione: unknown, p: Record<string, unknown> = {}) => ({
  idWidget: 7,
  titolo: 'Documenti per data',
  forma: 'bar',
  intervalloMin: 60,
  trasformazione,
  opzioni: { sale: 'bene', scende: 'neutro' },
  colonne: COLONNE,
  ...p,
});

async function apri(w: Record<string, unknown>) {
  proprieta = { widget: w, sid: 'S1', onClose: noop, onSalvato: noop, aziende: [] };
  disegna();
  await passa(600);
}

const voci = () => elements(tree).filter((e) => e.type === Form.Item).map((e) => e.props.label);
const voce = (label: string) => elements(tree).find((e) => e.type === Form.Item && e.props.label === label);
const selezione = (nome: string) =>
  elements(tree).find((e) => e.type === Select && e.props['aria-label'] === nome);
const tipo = () => selezione('Tipo di ordinamento');
const colonna = () => selezione('Colonna di ordinamento');
const scegli = async (nome: string, v: unknown) => {
  const s = selezione(nome);
  expect(s, `la select «${nome}»`).toBeDefined();
  (s!.props.onChange as (v: unknown) => void)(v);
  await passa(600);
};
const opzioni = (s: El | undefined) =>
  ((s?.props.options as { value: unknown; label: unknown }[] | undefined) || []).map((o) => ({
    value: o.value,
    label: typeof o.label === 'string' ? o.label : testoDi(o.label),
  }));

const tastoSalva = () => elements(tree).find((e) => e.type === Button && testoDi(e.props.children) === 'Salva');
async function salva(): Promise<Record<string, unknown>> {
  expect(tastoSalva(), 'il tasto Salva').toBeDefined();
  (tastoSalva()!.props.onClick as () => void)();
  await passa(200);
  const s = server.chiamate.filter((c) => c.action === 'dashboard.Save');
  expect(s.length, 'una dashboard.Save').toBe(1);
  return JSON.parse(s[0].params.trasformazione);
}
/** La trasformazione dell'ultima anteprima chiesta. */
const ultimaAnteprima = (): Record<string, unknown> => {
  const p = server.chiamate.filter((c) => c.action === 'dashboard.Preview');
  expect(p.length, 'almeno una dashboard.Preview').toBeGreaterThan(0);
  return JSON.parse(p[p.length - 1].params.trasformazione);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  rt.slots = [];
  rt.effects = [];
  fb.errori = []; fb.avvisi = [];
  server.chiamate = [];
  server.save = { esito: 'ok' };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SXADV-6114 O5 · quando la voce «Ordina» c\'e\'', () => {
  it.each(['bar', 'kpi'])('forma %s con raggruppamento: voce e due select', async (forma) => {
    await apri(widget({ ...SOMMA, outAgg: 'sum' }, { forma }));
    expect(voce('Ordina'), 'la voce «Ordina»').toBeDefined();
    expect(tipo(), 'Tipo di ordinamento').toBeDefined();
    expect(colonna(), 'Colonna di ordinamento').toBeDefined();
  });

  it('subito dopo «Calcola», prima di «Tieni solo i gruppi con»', async () => {
    await apri(widget(SOMMA));
    const v = voci();
    const i = v.indexOf('Ordina');
    expect(i, 'la voce «Ordina»').toBeGreaterThan(-1);
    expect(v[i - 1]).toBe('Calcola');
    expect(v[i + 1]).toBe('Tieni solo i gruppi con');
  });

  it('senza raggruppamento non c\'e\'', async () => {
    await apri(widget({ agg: 'sum', col: 'totale' }, { forma: 'kpi' }));
    expect(voce('Ordina')).toBeUndefined();
    expect(tipo()).toBeUndefined();
    expect(colonna()).toBeUndefined();
  });

  it('con la forma Lista non c\'e\'', async () => {
    await apri(widget(SOMMA, { forma: 'list' }));
    expect(voce('Ordina')).toBeUndefined();
    expect(tipo()).toBeUndefined();
  });

  it('tolto il raggruppamento sparisce, rimesso torna', async () => {
    await apri(widget(SOMMA));
    await scegli('Raggruppa per', '');
    expect(voce('Ordina')).toBeUndefined();
    await scegli('Raggruppa per', 'sede');
    expect(voce('Ordina')).toBeDefined();
  });
});

describe('SXADV-6114 O5 · le opzioni', () => {
  it('Tipo di ordinamento: Decrescente (desc) e Crescente (asc)', async () => {
    await apri(widget(SOMMA));
    expect(opzioni(tipo())).toEqual([
      { value: 'desc', label: 'Decrescente' },
      { value: 'asc', label: 'Crescente' },
    ]);
  });

  it('Colonna di ordinamento: il calcolo con la funzione tra parentesi, poi la colonna di raggruppamento', async () => {
    await apri(widget(SOMMA));
    expect(opzioni(colonna())).toEqual([
      { value: 'valore', label: 'Totale doc. (somma)' },
      { value: 'gruppo', label: 'Data doc.' },
    ]);
  });

  it('col conteggio il calcolo si chiama «conteggio delle righe»', async () => {
    await apri(widget({ agg: 'count', group: ['sede'], topN: 10, resto: 'altri' }));
    expect(opzioni(colonna())).toEqual([
      { value: 'valore', label: 'conteggio delle righe' },
      { value: 'gruppo', label: 'Sede' },
    ]);
  });

  it('le etichette seguono il calcolo e il raggruppamento scelti nel pannello', async () => {
    await apri(widget(SOMMA));
    await scegli('Calcola', 'avg');
    expect(opzioni(colonna())[0]).toEqual({ value: 'valore', label: 'Totale doc. (media)' });
    await scegli('Raggruppa per', 'sede');
    expect(opzioni(colonna())[1]).toEqual({ value: 'gruppo', label: 'Sede' });
    await scegli('Calcola', 'count');
    expect(opzioni(colonna())[0]).toEqual({ value: 'valore', label: 'conteggio delle righe' });
  });
});

describe('SXADV-6114 O5 · valori proposti e widget salvati', () => {
  it('widget salvato senza ordina: Decrescente + il calcolo', async () => {
    await apri(widget(SOMMA));
    expect(tipo()!.props.value).toBe('desc');
    expect(colonna()!.props.value).toBe('valore');
  });

  it('widget vecchio salvato senza modifiche: niente ordina, ne\' in anteprima ne\' nel Save', async () => {
    await apri(widget(SOMMA));
    expect('ordina' in ultimaAnteprima()).toBe(false);
    const t = await salva();
    expect('ordina' in t).toBe(false);
    expect(t).toEqual(SOMMA);
  });

  it('widget salvato con ordina asc/gruppo: il pannello lo mostra e il Save lo rimanda uguale', async () => {
    await apri(widget({ ...SOMMA, ordina: { verso: 'asc', per: 'gruppo' } }));
    expect(tipo()!.props.value).toBe('asc');
    expect(colonna()!.props.value).toBe('gruppo');
    expect(ultimaAnteprima().ordina).toEqual({ verso: 'asc', per: 'gruppo' });
    expect((await salva()).ordina).toEqual({ verso: 'asc', per: 'gruppo' });
  });

  it('widget salvato con ordina scritto per esteso ma predefinito: non si rimanda', async () => {
    await apri(widget({ ...SOMMA, ordina: { verso: 'desc', per: 'valore' } }));
    expect(tipo()!.props.value).toBe('desc');
    expect(colonna()!.props.value).toBe('valore');
    expect('ordina' in (await salva())).toBe(false);
  });

  it('widget salvato con ordina ma senza raggruppamento: non si manda', async () => {
    await apri(widget({ agg: 'sum', col: 'totale', ordina: { verso: 'asc', per: 'valore' } }, { forma: 'kpi' }));
    expect('ordina' in (await salva())).toBe(false);
  });
});

describe('SXADV-6114 O5 · le scelte arrivano a Preview e Save', () => {
  it('Crescente: ordina {asc, valore}', async () => {
    await apri(widget(SOMMA));
    await scegli('Tipo di ordinamento', 'asc');
    expect(ultimaAnteprima().ordina).toEqual({ verso: 'asc', per: 'valore' });
    expect((await salva()).ordina).toEqual({ verso: 'asc', per: 'valore' });
  });

  it('solo la colonna di raggruppamento: ordina {desc, gruppo}', async () => {
    await apri(widget(SOMMA));
    await scegli('Colonna di ordinamento', 'gruppo');
    expect(ultimaAnteprima().ordina).toEqual({ verso: 'desc', per: 'gruppo' });
    expect((await salva()).ordina).toEqual({ verso: 'desc', per: 'gruppo' });
  });

  it('tornati a Decrescente + calcolo la chiave sparisce', async () => {
    await apri(widget({ ...SOMMA, ordina: { verso: 'asc', per: 'gruppo' } }));
    await scegli('Tipo di ordinamento', 'desc');
    await scegli('Colonna di ordinamento', 'valore');
    expect('ordina' in ultimaAnteprima()).toBe(false);
    expect('ordina' in (await salva())).toBe(false);
  });

  it('il cambio fa partire un\'anteprima nuova', async () => {
    await apri(widget(SOMMA));
    const prima = server.chiamate.filter((c) => c.action === 'dashboard.Preview').length;
    await scegli('Tipo di ordinamento', 'asc');
    expect(server.chiamate.filter((c) => c.action === 'dashboard.Preview').length).toBeGreaterThan(prima);
  });

  it('tolto il raggruppamento ordina non si manda; rimesso, la scelta torna', async () => {
    await apri(widget(SOMMA));
    await scegli('Tipo di ordinamento', 'asc');
    await scegli('Colonna di ordinamento', 'gruppo');
    await scegli('Raggruppa per', '');
    expect('ordina' in ultimaAnteprima()).toBe(false);
    await scegli('Raggruppa per', 'sede');
    expect(tipo()!.props.value).toBe('asc');
    expect(colonna()!.props.value).toBe('gruppo');
    expect(ultimaAnteprima().ordina).toEqual({ verso: 'asc', per: 'gruppo' });
    expect((await salva()).ordina).toEqual({ verso: 'asc', per: 'gruppo' });
  });

  it('tolto il raggruppamento e salvato: niente ordina nel Save', async () => {
    await apri(widget({ ...SOMMA, ordina: { verso: 'asc', per: 'valore' } }, { forma: 'kpi' }));
    await scegli('Raggruppa per', '');
    expect('ordina' in (await salva())).toBe(false);
  });

  it('passando a Lista nessuna trasformazione, dunque nessun ordina', async () => {
    await apri(widget({ ...SOMMA, ordina: { verso: 'asc', per: 'valore' } }));
    const forma = elements(tree).find((e) => e.props['aria-label'] === 'Forma');
    expect(forma, 'il comando della forma').toBeDefined();
    (forma!.props.onChange as (x: unknown) => void)({ target: { value: 'list' } });
    await passa(600);
    expect(voce('Ordina')).toBeUndefined();
    (tastoSalva()!.props.onClick as () => void)();
    await passa(200);
    const s = server.chiamate.filter((c) => c.action === 'dashboard.Save');
    expect(s).toHaveLength(1);
    expect(s[0].params.trasformazione || '').not.toContain('ordina');
  });
});

// Dall'impianto comune, qui non usati.
void [Radio, Checkbox];
