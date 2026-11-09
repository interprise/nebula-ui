import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';

// SXADV-6110.1: forma Numero o Barre, Calcola somma/media/min/max e nessuna colonna: Salva non
// parte, avviso «Indicare la colonna per la quale eseguire il calcolo» e select in errore;
// scelta la colonna l'errore sparisce e Salva parte. Con conteggio o forma Lista, nessun blocco.
// SXADV-6132: «Distribuisci nelle Home», «Se resta vuoto, si apre il dettaglio abituale della lista».
// Impianto: quello di modificaWidget.sxadv6043.test.tsx. Chi prova non e' chi implementa.

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
  fb.errori = []; fb.avvisi = [];
  server.chiamate = [];
  server.save = { esito: 'ok' };
});

afterEach(() => {
  vi.useRealTimers();
});

const MSG = 'Indicare la colonna per la quale eseguire il calcolo';
const tastoSalva = () => elements(tree).find((e) => e.type === Button && testoDi(e.props.children) === 'Salva');
const premiSalva = async () => { (tastoSalva()!.props.onClick as () => void)(); await passa(200); };
const salvataggi = () => server.chiamate.filter((c) => c.action === 'dashboard.Save');
const selColonna = () => selezione('Su quale colonna');
const sceglieColonna = async (v: string) => { (selColonna()!.props.onChange as (v: string) => void)(v); await passa(50); };

describe('SXADV-6110.1 calcolo senza colonna: Salva si ferma', () => {
  describe.each(['kpi', 'bar'])('forma %s', (forma) => {
    it.each(['sum', 'avg', 'min', 'max'])('%s: nessuna richiesta, avviso, select in errore', async (agg) => {
      await apri(widget({ group: ['sede'], agg, outAgg: 'sum' }, { forma }));
      expect(selColonna()!.props.status, 'prima di Salva nessun errore').toBeUndefined();
      await premiSalva();
      expect(salvataggi()).toHaveLength(0);
      expect(fb.avvisi).toEqual([MSG]);
      expect(selColonna()!.props.status).toBe('error');
    });
  });

  it('scelta la colonna l\'errore sparisce e Salva parte, col valore scelto', async () => {
    await apri(widget({ agg: 'sum' }));
    await premiSalva();
    expect(selColonna()!.props.status).toBe('error');
    await sceglieColonna('importo');
    expect(selColonna()!.props.status).toBeUndefined();
    await premiSalva();
    expect(salvataggi()).toHaveLength(1);
    expect(JSON.parse(salvataggi()[0].params.trasformazione).col).toBe('importo');
    expect(fb.avvisi).toHaveLength(1);
  });

  it('due Salva a vuoto: due avvisi, nessuna richiesta, tasto non bloccato', async () => {
    await apri(widget({ agg: 'sum' }));
    await premiSalva();
    await premiSalva();
    expect(fb.avvisi).toHaveLength(2);
    expect(salvataggi()).toHaveLength(0);
  });

  it('cambiando calcolo la colonna gia\' scelta resta buona: Salva parte', async () => {
    await apri(widget({ agg: 'sum', col: 'importo' }));
    (selezione('Calcola')!.props.onChange as (v: string) => void)('avg');
    await passa(50);
    expect(selColonna()!.props.value).toBe('importo');
    await premiSalva();
    expect(salvataggi()).toHaveLength(1);
  });

  it('il titolo vuoto si dice per primo: niente avviso sulla colonna', async () => {
    await apri(widget({ agg: 'sum' }, { titolo: '   ' }));
    await premiSalva();
    expect(salvataggi()).toHaveLength(0);
    expect(fb.avvisi).toHaveLength(0);
  });
});

describe('SXADV-6110.1 nessun blocco dove la colonna non serve', () => {
  it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
    ['conteggio, Numero', { agg: 'count' }, {}],
    ['conteggio, Barre', { group: ['sede'], agg: 'count', outAgg: 'sum' }, { forma: 'bar' }],
    ['somma con colonna', { agg: 'sum', col: 'importo' }, {}],
  ])('%s', async (_n, t, p) => {
    await apri(widget(t, p));
    await premiSalva();
    expect(salvataggi()).toHaveLength(1);
    expect(fb.avvisi).toHaveLength(0);
  });

  it('forma Lista, con una somma rimasta dalla forma di prima', async () => {
    await apri(widget({ agg: 'sum' }));
    const forma = elements(tree).find((e) => e.type === Radio.Group && JSON.stringify(e.props.options ?? '').includes('list'))
      ?? elements(tree).find((e) => e.props['aria-label'] === 'Forma');
    expect(forma, 'il comando della forma').toBeDefined();
    (forma!.props.onChange as (x: unknown) => void)({ target: { value: 'list' } });
    await passa(50);
    await premiSalva();
    expect(salvataggi()).toHaveLength(1);
    expect(salvataggi()[0].params.forma).toBe('list');
    expect(fb.avvisi).toHaveLength(0);
  });

  it('forma Lista senza trasformazione', async () => {
    await apri(widget(null, { forma: 'list' }));
    await premiSalva();
    expect(salvataggi()).toHaveLength(1);
  });

  it('passando a conteggio dopo l\'errore, Salva parte', async () => {
    await apri(widget({ agg: 'sum' }));
    await premiSalva();
    (selezione('Calcola')!.props.onChange as (v: string) => void)('count');
    await passa(50);
    expect(selColonna()).toBeUndefined();
    await premiSalva();
    expect(salvataggi()).toHaveLength(1);
  });
});

describe('SXADV-6110.1 l\'errore non sopravvive a quello che lo ha causato', () => {
  it('aperto un ALTRO widget, la select non nasce gia\' in errore', async () => {
    await apri(widget({ agg: 'sum' }));
    await premiSalva();
    expect(selColonna()!.props.status).toBe('error');
    proprieta = { ...proprieta, widget: widget({ agg: 'avg' }, { idWidget: 8, titolo: 'Altro' }) };
    disegna();
    await passa(600);
    expect(selColonna()!.props.status).toBeUndefined();
  });

  it('chiuso e riaperto lo stesso widget, idem', async () => {
    await apri(widget({ agg: 'sum' }));
    await premiSalva();
    proprieta = { ...proprieta, widget: null };
    disegna();
    await passa(50);
    proprieta = { ...proprieta, widget: widget({ agg: 'sum' }) };
    disegna();
    await passa(600);
    expect(selColonna()!.props.status).toBeUndefined();
  });

  it('via a conteggio e ritorno a somma: niente rosso prima di un nuovo Salva', async () => {
    await apri(widget({ agg: 'sum' }));
    await premiSalva();
    const calcola = (v: string) => (selezione('Calcola')!.props.onChange as (v: string) => void)(v);
    calcola('count');
    await passa(50);
    calcola('sum');
    await passa(50);
    expect(selColonna()!.props.status).toBeUndefined();
  });
});

describe('SXADV-6132 i testi di «Modifica widget»', () => {
  it('«Se resta vuoto, si apre il dettaglio abituale della lista»', async () => {
    await apri(widget({ agg: 'count' }, { sceltaDettaglio: true }));
    expect(voce('Apri il dettaglio con')!.props.extra)
      .toBe('Il clic su una riga apre questa vista. Se resta vuoto, si apre il dettaglio abituale della lista.');
  });

  it('«Distribuisci nelle Home» al posto di «Mandalo nelle Home», solo se condiviso', async () => {
    await apri(widget({ agg: 'count' }, { condivisione: { ambito: 'azienda', mandato: false } }));
    proprieta = { ...proprieta, puoCondividere: true };
    disegna();
    await passa(50);
    const caselle = elements(tree).filter((e) => e.type === Checkbox).map((e) => testoDi(e.props.children));
    expect(caselle).toContain('Distribuisci nelle Home');
    expect(caselle).not.toContain('Mandalo nelle Home');
    (selezione('Condivisione')!.props.onChange as (v: string) => void)('privato');
    await passa(50);
    expect(elements(tree).filter((e) => e.type === Checkbox).map((e) => testoDi(e.props.children)))
      .not.toContain('Distribuisci nelle Home');
  });
});

// Dall'impianto comune, qui non usati.
void [CONTA, nascosti, presenti, scegliNumeroFinale, salva];
