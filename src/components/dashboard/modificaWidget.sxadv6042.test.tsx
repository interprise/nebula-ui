import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';

// SXADV-6042: «Raggruppa per» una data, per anno, semestre, trimestre, mese o giorno.
// Sotto «Raggruppa per», solo se la colonna scelta e' una data (tipo Date, Timestamp, DateTime,
// senza badare alle maiuscole), la select «Periodo». Un widget salvato senza periodo mostra
// «giorno» e NON lo riscrive finche' la select non si tocca; una colonna data scelta adesso
// porta periodo 'giorno' esplicito; una colonna non data o «nessuno» lo tolgono; cambiare il
// periodo azzera «Escludi i gruppi» e i candidati; la forma Lista non manda trasformazione.
// Contratto rivisto: su una colonna con l'ora (Timestamp, DateTime) «nessun periodo» NON e'
// «giorno»: la select nasce vuota (placeholder «data e ora esatte») e scegliere «giorno» manda
// periodo 'giorno' e azzera gli esclusi. Su una colonna Date i due valgono uguale.
// Contratto: ~/.cache/sixtema/SXADV-6042/contratto.md.
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
  preview: { esito: 'ok', risultato: { tipo: 'list' } } as Record<string, unknown>,
  chiamate: [] as { action: string; params: Record<string, string> }[],
}));
vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  postAction2: async (action: string, params: Record<string, string>) => {
    server.chiamate.push({ action, params: { ...(params || {}) } });
    switch (action) {
      case 'dashboard.ColonneDettaglio': return { esito: 'ok', vista: null, candidati: [] };
      case 'dashboard.Save': return server.save;
      case 'dashboard.Preview': return server.preview;
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
  { item: 'data', etichetta: 'Data', tipo: 'Date' },
  { item: 'scadenza', etichetta: 'Scadenza', tipo: 'Date' },
  { item: 'ora', etichetta: 'Registrato il', tipo: 'Timestamp' },
  { item: 'quando', etichetta: 'Quando', tipo: 'DateTime' },
  { item: 'minuscola', etichetta: 'minuscola', tipo: 'date' },
  { item: 'maiuscola', etichetta: 'MAIUSCOLA', tipo: 'TIMESTAMP' },
  { item: 'importo', etichetta: 'Importo', tipo: 'Number' },
  { item: 'senzaTipo', etichetta: 'Senza tipo', tipo: null },
];

const widget = (trasformazione: unknown, p: Record<string, unknown> = {}) => ({
  idWidget: 7,
  titolo: 'Documenti per periodo',
  forma: 'bar',
  intervalloMin: 60,
  trasformazione,
  opzioni: {},
  colonne: COLONNE,
  ...p,
});

async function apri(w: Record<string, unknown>) {
  proprieta = { widget: w, sid: 'S1', onClose: noop, onSalvato: noop, aziende: [] };
  disegna();
  await passa(600);
}

const selezione = (nome: string) =>
  elements(tree).find((e) => e.type === Select && e.props['aria-label'] === nome);
const periodo = () => selezione('Periodo');
const scegli = async (nome: string, v: unknown) => {
  const s = selezione(nome);
  expect(s, `la select «${nome}»`).toBeDefined();
  (s!.props.onChange as (v: unknown) => void)(v);
  await passa(600);
};
const raggruppa = (v: string) => scegli('Raggruppa per', v);
const scegliPeriodo = (v: string) => scegli('Periodo', v);

const tastoSalva = () => elements(tree).find((e) => e.type === Button && testoDi(e.props.children) === 'Salva');
/** Preme Salva e torna la trasformazione mandata (null = stringa vuota). */
async function salva(): Promise<Record<string, unknown> | null> {
  const prima = server.chiamate.filter((c) => c.action === 'dashboard.Save').length;
  (tastoSalva()!.props.onClick as () => void)();
  await passa(200);
  const s = server.chiamate.filter((c) => c.action === 'dashboard.Save');
  expect(s.length, 'una dashboard.Save in piu\'').toBe(prima + 1);
  const t = s[s.length - 1].params.trasformazione;
  return t ? (JSON.parse(t) as Record<string, unknown>) : null;
}
/** Le trasformazioni mandate all'anteprima, in ordine. */
const anteprime = () =>
  server.chiamate.filter((c) => c.action === 'dashboard.Preview').map((c) => JSON.parse(c.params.trasformazione) as Record<string, unknown>);
const ultimaAnteprima = () => anteprime()[anteprime().length - 1];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  rt.slots = [];
  rt.effects = [];
  fb.errori = []; fb.avvisi = [];
  server.chiamate = [];
  server.save = { esito: 'ok' };
  server.preview = { esito: 'ok', risultato: { tipo: 'list' } };
});

afterEach(() => {
  vi.useRealTimers();
});

const PER_DATA = { group: ['data'], agg: 'count' };

describe('SXADV-6042 la select «Periodo» compare solo sulle date', () => {
  it.each(['data', 'ora', 'quando', 'minuscola', 'maiuscola'])('colonna %s: c\'e\'', async (col) => {
    await apri(widget({ group: [col], agg: 'count' }));
    expect(periodo(), 'la select Periodo').toBeDefined();
  });

  it.each(['sede', 'importo', 'senzaTipo'])('colonna %s: non c\'e\'', async (col) => {
    await apri(widget({ group: [col], agg: 'count' }));
    expect(selezione('Raggruppa per'), 'Raggruppa per').toBeDefined();
    expect(periodo()).toBeUndefined();
  });

  it('senza raggruppamento non c\'e\'', async () => {
    await apri(widget({ agg: 'count' }, { forma: 'kpi' }));
    expect(periodo()).toBeUndefined();
  });

  it('le voci: anno, semestre, trimestre, mese, giorno (data completa)', async () => {
    await apri(widget(PER_DATA));
    const opz = periodo()!.props.options as { value: string; label: string }[];
    expect(opz.map((o) => o.value)).toEqual(['anno', 'semestre', 'trimestre', 'mese', 'giorno']);
    expect(opz.map((o) => o.label)).toEqual(['anno', 'semestre', 'trimestre', 'mese', 'giorno (data completa)']);
  });

  it('forma Lista: niente select, e la trasformazione non parte', async () => {
    await apri(widget({ ...PER_DATA, periodo: 'mese' }, { forma: 'list' }));
    expect(periodo()).toBeUndefined();
    expect(await salva()).toBeNull();
    expect(anteprime()).toHaveLength(0);
  });
});

describe('SXADV-6042 un widget salvato SENZA periodo non cambia', () => {
  it('la select mostra «giorno»', async () => {
    await apri(widget(PER_DATA));
    expect(periodo()!.props.value).toBe('giorno');
  });

  it('l\'anteprima parte senza periodo', async () => {
    await apri(widget(PER_DATA));
    expect(anteprime().length, 'almeno un\'anteprima').toBeGreaterThan(0);
    for (const t of anteprime()) expect(t).not.toHaveProperty('periodo');
  });

  it('un Salva che tocca solo il titolo non scrive il periodo', async () => {
    await apri(widget(PER_DATA));
    const titolo = elements(tree).find((e) => e.props['aria-label'] === 'Titolo');
    (titolo!.props.onChange as (e: unknown) => void)({ target: { value: 'Altro titolo' } });
    await passa(600);
    const t = await salva();
    expect(t).not.toHaveProperty('periodo');
    expect(t!.group).toEqual(['data']);
    for (const a of anteprime()) expect(a).not.toHaveProperty('periodo');
  });

  it('anche con escludi salvati: restano, e il periodo non compare', async () => {
    await apri(widget({ ...PER_DATA, escludi: ['2025-03-14'] }));
    const t = await salva();
    expect(t).not.toHaveProperty('periodo');
    expect(t!.escludi).toEqual(['2025-03-14']);
  });
});

describe('SXADV-6042 un widget salvato CON periodo', () => {
  it.each(['anno', 'semestre', 'trimestre', 'mese', 'giorno'])('%s: si rilegge e si riscrive uguale', async (p) => {
    await apri(widget({ ...PER_DATA, periodo: p }));
    expect(periodo()!.props.value).toBe(p);
    expect(ultimaAnteprima().periodo).toBe(p);
    expect((await salva())!.periodo).toBe(p);
  });
});

describe('SXADV-6042 scegliere la colonna', () => {
  it('da una colonna non data a una data: periodo \'giorno\' esplicito', async () => {
    await apri(widget({ group: ['sede'], agg: 'count' }));
    await raggruppa('data');
    expect(periodo()!.props.value).toBe('giorno');
    expect(ultimaAnteprima().periodo).toBe('giorno');
    const t = await salva();
    expect(t!.group).toEqual(['data']);
    expect(t!.periodo).toBe('giorno');
  });

  it('da «nessuno» a una data Timestamp: \'giorno\'', async () => {
    await apri(widget({ agg: 'count' }, { forma: 'kpi' }));
    await raggruppa('ora');
    expect((await salva())!.periodo).toBe('giorno');
  });

  it('da una data con periodo a un\'ALTRA data: torna \'giorno\'', async () => {
    await apri(widget({ ...PER_DATA, periodo: 'mese' }));
    await raggruppa('scadenza');
    expect(periodo()!.props.value).toBe('giorno');
    const t = await salva();
    expect(t!.group).toEqual(['scadenza']);
    expect(t!.periodo).toBe('giorno');
  });

  it('a una colonna non data: il periodo sparisce, e la select con lui', async () => {
    await apri(widget({ ...PER_DATA, periodo: 'mese' }));
    await raggruppa('sede');
    expect(periodo()).toBeUndefined();
    expect(ultimaAnteprima()).not.toHaveProperty('periodo');
    const t = await salva();
    expect(t!.group).toEqual(['sede']);
    expect(t).not.toHaveProperty('periodo');
  });

  it('a «nessuno»: il periodo sparisce', async () => {
    await apri(widget({ ...PER_DATA, periodo: 'trimestre' }, { forma: 'kpi' }));
    await raggruppa('');
    expect(periodo()).toBeUndefined();
    const t = await salva();
    expect(t).not.toHaveProperty('group');
    expect(t).not.toHaveProperty('periodo');
  });

  it('via e ritorno alla stessa data: il periodo di prima non torna, si riparte da \'giorno\'', async () => {
    await apri(widget({ ...PER_DATA, periodo: 'anno' }));
    await raggruppa('sede');
    await raggruppa('data');
    expect(periodo()!.props.value).toBe('giorno');
    expect((await salva())!.periodo).toBe('giorno');
  });
});

describe('SXADV-6042 cambiare il periodo', () => {
  it.each(['anno', 'semestre', 'trimestre', 'mese'])('%s: va all\'anteprima e al Salva', async (p) => {
    await apri(widget(PER_DATA));
    await scegliPeriodo(p);
    expect(periodo()!.props.value).toBe(p);
    expect(ultimaAnteprima().periodo).toBe(p);
    const t = await salva();
    expect(t!.periodo).toBe(p);
    expect(t!.group).toEqual(['data']);
  });

  it('da trimestre a giorno: \'giorno\' scritto', async () => {
    await apri(widget({ ...PER_DATA, periodo: 'trimestre' }));
    await scegliPeriodo('giorno');
    expect((await salva())!.periodo).toBe('giorno');
  });

  it('azzera «Escludi i gruppi»', async () => {
    await apri(widget({ ...PER_DATA, escludi: ['2025-03-14', '2025-03-15'] }));
    expect(selezione('Escludi i gruppi')!.props.value).toEqual(['2025-03-14', '2025-03-15']);
    await scegliPeriodo('trimestre');
    expect(selezione('Escludi i gruppi')!.props.value).toEqual([]);
    expect(ultimaAnteprima()).not.toHaveProperty('escludi');
    const t = await salva();
    expect(t!.periodo).toBe('trimestre');
    expect(t).not.toHaveProperty('escludi');
  });

  it('azzera anche fra due periodi espliciti', async () => {
    await apri(widget({ ...PER_DATA, periodo: 'mese', escludi: ['2025-03'] }));
    await scegliPeriodo('anno');
    expect(selezione('Escludi i gruppi')!.props.value).toEqual([]);
    expect(await salva()).not.toHaveProperty('escludi');
  });

  it('azzera i candidati: le chiavi di giorno non si offrono sui trimestri', async () => {
    server.preview = {
      esito: 'ok',
      risultato: { tipo: 'bar' },
      candidati: [
        { k: '2025-03-14', etichetta: '14/03/2025', valore: 3, righe: 3 },
        { k: '2025-03-15', etichetta: '15/03/2025', valore: 1, righe: 1 },
      ],
    };
    await apri(widget(PER_DATA));
    const prima = (selezione('Escludi i gruppi')!.props.options as { value: string }[]).map((o) => o.value);
    expect(prima, 'i candidati dell\'anteprima').toEqual(['2025-03-14', '2025-03-15']);
    // La nuova anteprima non porta candidati: restassero quelli di prima, sarebbero giorni.
    server.preview = { esito: 'ok', risultato: { tipo: 'bar' } };
    await scegliPeriodo('trimestre');
    const dopo = (selezione('Escludi i gruppi')!.props.options as { value: string }[]).map((o) => o.value);
    expect(dopo).toEqual([]);
  });

  it('i candidati nuovi, di periodo, si offrono', async () => {
    await apri(widget(PER_DATA));
    server.preview = {
      esito: 'ok',
      risultato: { tipo: 'bar' },
      candidati: [{ k: '2025-T1', etichetta: '1° trim. 2025', valore: 4, righe: 4 }],
    };
    await scegliPeriodo('trimestre');
    const opz = selezione('Escludi i gruppi')!.props.options as { value: string; label: string }[];
    expect(opz).toEqual([{ value: '2025-T1', label: '1° trim. 2025' }]);
    await scegli('Escludi i gruppi', ['2025-T1']);
    const t = await salva();
    expect(t!.escludi).toEqual(['2025-T1']);
    expect(t!.periodo).toBe('trimestre');
  });
});

describe('SXADV-6042 colonne con l\'ora: nessun periodo non e\' giorno', () => {
  it.each(['ora', 'quando', 'maiuscola'])('%s salvata senza periodo: select vuota, «data e ora esatte»', async (col) => {
    await apri(widget({ group: [col], agg: 'count' }));
    expect(periodo(), 'la select Periodo').toBeDefined();
    expect(periodo()!.props.value ?? null, 'nessuna voce scelta').toBeNull();
    expect(periodo()!.props.placeholder).toBe('data e ora esatte');
    for (const t of anteprime()) expect(t).not.toHaveProperty('periodo');
    expect(await salva()).not.toHaveProperty('periodo');
  });

  it.each(['ora', 'quando'])('%s: scegliere «giorno» manda periodo \'giorno\' e azzera gli esclusi', async (col) => {
    server.preview = {
      esito: 'ok',
      risultato: { tipo: 'bar' },
      candidati: [{ k: '2025-03-14T10:30:00', etichetta: '14/03/2025 10:30:00', valore: 1, righe: 1 }],
    };
    await apri(widget({ group: [col], agg: 'count', escludi: ['2025-03-14T10:30:00'] }));
    server.preview = { esito: 'ok', risultato: { tipo: 'bar' } };
    await scegliPeriodo('giorno');
    expect(periodo()!.props.value).toBe('giorno');
    expect(selezione('Escludi i gruppi')!.props.value).toEqual([]);
    expect((selezione('Escludi i gruppi')!.props.options as unknown[]), 'candidati azzerati').toEqual([]);
    expect(ultimaAnteprima().periodo).toBe('giorno');
    const t = await salva();
    expect(t!.periodo).toBe('giorno');
    expect(t).not.toHaveProperty('escludi');
  });

  it('Timestamp con periodo salvato: si rilegge', async () => {
    await apri(widget({ group: ['ora'], agg: 'count', periodo: 'mese' }));
    expect(periodo()!.props.value).toBe('mese');
    expect((await salva())!.periodo).toBe('mese');
  });
});

describe('SXADV-6042 colonna Date: nessun periodo e giorno valgono uguale', () => {
  it('scegliere «giorno» su un widget salvato senza periodo non azzera esclusi ne\' candidati', async () => {
    server.preview = {
      esito: 'ok',
      risultato: { tipo: 'bar' },
      candidati: [{ k: '2025-03-14', etichetta: '14/03/2025', valore: 1, righe: 1 }],
    };
    await apri(widget({ ...PER_DATA, escludi: ['2025-03-14'] }));
    server.preview = { esito: 'ok', risultato: { tipo: 'bar' } };
    await scegliPeriodo('giorno');
    expect(selezione('Escludi i gruppi')!.props.value).toEqual(['2025-03-14']);
    expect((selezione('Escludi i gruppi')!.props.options as { value: string }[]).map((o) => o.value))
      .toEqual(['2025-03-14']);
    expect((await salva())!.escludi).toEqual(['2025-03-14']);
  });

  it('il placeholder della data e ora non c\'entra: la select mostra «giorno»', async () => {
    await apri(widget(PER_DATA));
    expect(periodo()!.props.value).toBe('giorno');
  });
});

describe('SXADV-6042 forma Lista', () => {
  it('passando a Lista dopo aver scelto il periodo: nessuna trasformazione', async () => {
    await apri(widget(PER_DATA));
    await scegliPeriodo('mese');
    const forma = elements(tree).find((e) => e.type === Radio.Group && e.props['aria-label'] === 'Forma');
    (forma!.props.onChange as (x: unknown) => void)({ target: { value: 'list' } });
    await passa(600);
    expect(await salva()).toBeNull();
  });
});

// Dall'impianto comune, qui non usati.
void [Form, Checkbox];
