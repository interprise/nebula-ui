import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';

// SXADV-6043: il pannello «Modifica widget». Con un raggruppamento e «Numero finale» sulla
// prima opzione («nessuno: solo i gruppi») il numero non si disegna, a qualunque calcolo e
// filtro: i radio sale/scende parlerebbero di un numero assente e si nascondono. I valori
// salvati pero' non si perdono: se poi si torna a un numero, il tono scelto e' ancora quello.
//
// Impianto: quello di modificaWidget.sxadv6105.test.tsx (niente DOM, motore di hook finto).

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


const { Button, Form, Radio, Select } = await import('antd');

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
  { item: 'sede', etichetta: 'Sede', tipo: 'Text' },
  { item: 'importo', etichetta: 'Importo', tipo: 'Number' },
];
const CONTA = { group: ['sede'], agg: 'count', outAgg: 'count' };

const widget = (trasformazione: unknown, p: Record<string, unknown> = {}) => ({
  idWidget: 7,
  titolo: 'Documenti per sede',
  forma: 'kpi',
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

const voce = (label: string) => elements(tree).find((e) => e.type === Form.Item && e.props.label === label);
const radio = (nome: string) =>
  elements(tree).find((e) => e.type === Radio.Group && e.props['aria-label'] === nome);
const radioSaleScende = () => [radio('Se il numero sale'), radio('Se il numero scende')];
const selezione = (nome: string) =>
  elements(tree).find((e) => e.type === Select && e.props['aria-label'] === nome);

const nascosti = () => {
  expect(voce('Numero finale'), 'la voce «Numero finale»').toBeDefined();
  expect(radioSaleScende()).toEqual([undefined, undefined]);
  expect(voce('Se il numero sale è')).toBeUndefined();
  expect(voce('Se il numero scende è')).toBeUndefined();
};
const presenti = () => {
  for (const r of radioSaleScende()) expect(r, 'il radio').toBeDefined();
};
const scegliNumeroFinale = async (v: string) => {
  (selezione('Numero finale')!.props.onChange as (v: string) => void)(v);
  await passa(50);
};

async function salva(): Promise<Record<string, string>> {
  const b = elements(tree).find((e) => e.type === Button && testoDi(e.props.children) === 'Salva');
  expect(b, 'il tasto Salva').toBeDefined();
  (b!.props.onClick as () => void)();
  await passa(200);
  const s = server.chiamate.filter((c) => c.action === 'dashboard.Save');
  expect(s.length, 'una dashboard.Save').toBe(1);
  return s[0].params;
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

describe('SXADV-6043 Modifica widget: i nomi', () => {
  it('l\'opzione count di «Numero finale» si chiama «nessuno: solo i gruppi»', async () => {
    await apri(widget(CONTA));
    const opzioni = selezione('Numero finale')!.props.options as { value: string; label: string }[];
    expect(opzioni.find((o) => o.value === 'count')?.label).toBe('nessuno: solo i gruppi');
    expect(opzioni.map((o) => o.label)).not.toContain('quanti gruppi');
    expect(opzioni.map((o) => o.value)).toEqual(['count', 'sum', 'avg']);
  });

  it.each<[string, Record<string, unknown>]>([
    ['conteggio', CONTA],
    ['filtro > 5', { ...CONTA, having: { op: '>', value: 5 } }],
    ['somma dei gruppi', { group: ['sede'], agg: 'count', outAgg: 'sum' }],
  ])('sotto «Numero finale» nessun testo: %s', async (_n, t) => {
    await apri(widget(t));
    expect(voce('Numero finale')!.props.extra).toBeUndefined();
  });

  it('l\'esempio si chiama «Gruppi con valore > 0», il nome vecchio non c\'e\' piu\'', async () => {
    await apri(widget(null, { forma: 'list', colonne: [...COLONNE] }));
    const testi = elements(tree).filter((e) => e.type === Button).map((e) => testoDi(e.props.children));
    expect(testi).toContain('Gruppi con valore > 0');
    expect(testi).not.toContain('Conta i gruppi con valore > 0');
  });
});

describe('SXADV-6043 Modifica widget: i radio sale e scende', () => {
  it.each<[string, string, Record<string, unknown> | undefined]>([
    ['count', 'senza filtro', undefined],
    ['count', '> 0', { op: '>', value: 0 }],
    ['count', '> 5', { op: '>', value: 5 }],
    ['count', '< 200', { op: '<', value: 200 }],
    ['sum', 'senza filtro', undefined],
    ['sum', '> 5', { op: '>', value: 5 }],
    ['avg', '< 200', { op: '<', value: 200 }],
    ['min', '= 4', { op: '=', value: 4 }],
    ['max', '!= 1', { op: '!=', value: 1 }],
  ])('raggruppamento e outAgg count, agg %s, %s: nascosti', async (agg, _n, having) => {
    await apri(widget({ group: ['sede'], agg, col: 'importo', outAgg: 'count', having }));
    nascosti();
  });

  it('outAgg assente nel salvato: vale count, nascosti', async () => {
    await apri(widget({ group: ['sede'], agg: 'sum', col: 'importo' }));
    nascosti();
  });

  it.each<[string, Record<string, unknown>]>([
    ['outAgg sum', { group: ['sede'], agg: 'count', outAgg: 'sum' }],
    ['outAgg avg', { group: ['sede'], agg: 'count', outAgg: 'avg' }],
    ['outAgg sum con somma e filtro', { group: ['sede'], agg: 'sum', col: 'importo', outAgg: 'sum', having: { op: '>', value: 5 } }],
    ['senza raggruppamento', { agg: 'count' }],
    ['senza raggruppamento, somma', { agg: 'sum', col: 'importo' }],
  ])('%s: presenti', async (_n, t) => {
    await apri(widget(t));
    presenti();
  });

  it('senza raggruppamento la voce «Numero finale» non c\'e\'', async () => {
    await apri(widget({ agg: 'count' }));
    expect(voce('Numero finale')).toBeUndefined();
  });

  it('cambiando «Numero finale» i radio seguono, in tutti e due i versi', async () => {
    await apri(widget(CONTA));
    nascosti();
    await scegliNumeroFinale('sum');
    presenti();
    await scegliNumeroFinale('count');
    nascosti();
  });
});

describe('SXADV-6043 Modifica widget: sale e scende al Salva', () => {
  it('a radio nascosti i valori salvati restano nel payload', async () => {
    await apri(widget(CONTA));
    nascosti();
    const o = JSON.parse((await salva()).opzioni);
    expect(o.sale).toBe('bene');
    expect(o.scende).toBe('neutro');
  });

  it('nascosti non toccano le altre opzioni', async () => {
    await apri(widget(CONTA, { opzioni: { sale: 'attenzione', scende: 'bene', sconosciuta: 'x' } }));
    const o = JSON.parse((await salva()).opzioni);
    expect(o).toMatchObject({ sale: 'attenzione', scende: 'bene', sconosciuta: 'x' });
  });

  it('riaperti dopo un giro nascosti: i radio mostrano ancora i valori salvati', async () => {
    await apri(widget(CONTA));
    await scegliNumeroFinale('sum');
    expect(radio('Se il numero sale')!.props.value).toBe('bene');
    expect(radio('Se il numero scende')!.props.value).toBe('neutro');
  });

  it('anche con una somma per gruppo e un filtro vero, a radio nascosti', async () => {
    await apri(widget({ group: ['sede'], agg: 'sum', col: 'importo', outAgg: 'count', having: { op: '>', value: 5 } }));
    nascosti();
    const o = JSON.parse((await salva()).opzioni);
    expect(o).toMatchObject({ sale: 'bene', scende: 'neutro' });
  });

  it('a radio visibili il payload e\' quello di sempre', async () => {
    await apri(widget({ group: ['sede'], agg: 'count', outAgg: 'sum' }));
    const o = JSON.parse((await salva()).opzioni);
    expect(o).toMatchObject({ sale: 'bene', scende: 'neutro' });
  });
});
