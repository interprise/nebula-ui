import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';

// SXADV-6127: «Apri il dettaglio con» (opzioni.vistaDettaglio) lo vede e lo cambia solo un
// amministratore. Il server mette nel widget `sceltaDettaglio: true` solo per chi lo e'.
// Il campo c'e' solo con sceltaDettaglio === true; senza, Salva rimanda la scelta gia'
// salvata cosi' com'e' (non la toglie, non la svuota). Con il campo, tutto come prima.
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


const { Button, Form } = await import('antd');

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

// Un widget come lo manda dashboard.Get. `sceltaDettaglio` non e' (ancora) nel tipo:
// si passa per cast, il componente lo riceve com'e'.
const widget = (p: Record<string, unknown> = {}) => ({
  idWidget: 7,
  titolo: 'Documenti per sede',
  forma: 'list',
  intervalloMin: 60,
  trasformazione: null,
  opzioni: { vistaDettaglio: 'dettaglioClienti', altraChiave: 'resta' },
  dettaglioPredefinito: 'dettaglioDocumenti',
  colonne: COLONNE,
  ...p,
});

async function apri(w: Record<string, unknown>) {
  proprieta = { widget: w, sid: 'S1', onClose: noop, onSalvato: noop, aziende: [] };
  disegna();
  await passa(600);
}

const voce = (label: string) => elements(tree).find((e) => e.type === Form.Item && e.props.label === label);
const campo = (nome: string) => elements(tree).find((e) => e.props['aria-label'] === nome);
const campoDettaglio = () => campo('Vista di dettaglio');
const scrivi = async (nome: string, v: string) => {
  const c = campo(nome);
  expect(c, `il campo «${nome}»`).toBeDefined();
  (c!.props.onChange as (e: unknown) => void)({ target: { value: v } });
  await passa(50);
};

const tastoSalva = () => elements(tree).find((e) => e.type === Button && testoDi(e.props.children) === 'Salva');
const salvataggi = () => server.chiamate.filter((c) => c.action === 'dashboard.Save');

/** Preme Salva e restituisce le opzioni mandate (oggetto; {} se il parametro e' vuoto). */
async function salvaOpzioni(): Promise<Record<string, unknown>> {
  const b = tastoSalva();
  expect(b, 'il tasto Salva').toBeDefined();
  (b!.props.onClick as () => void)();
  await passa(200);
  const s = salvataggi();
  expect(s.length, 'una dashboard.Save').toBe(1);
  const o = s[s.length - 1].params.opzioni;
  return o ? (JSON.parse(o) as Record<string, unknown>) : {};
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

describe('SXADV-6127 chi vede «Apri il dettaglio con»', () => {
  it('amministratore (sceltaDettaglio: true): la voce e il campo ci sono', async () => {
    await apri(widget({ sceltaDettaglio: true }));
    expect(voce('Apri il dettaglio con'), 'la voce').toBeDefined();
    expect(campoDettaglio(), 'il campo «Vista di dettaglio»').toBeDefined();
    expect(campoDettaglio()!.props.value).toBe('dettaglioClienti');
  });

  it.each<[string, Record<string, unknown>]>([
    ['sceltaDettaglio assente', {}],
    ['sceltaDettaglio: false', { sceltaDettaglio: false }],
    ['sceltaDettaglio: null', { sceltaDettaglio: null }],
    // Solo il booleano vero apre il campo: niente letture «quasi vere».
    ['sceltaDettaglio: "true" (stringa)', { sceltaDettaglio: 'true' }],
    ['sceltaDettaglio: 1', { sceltaDettaglio: 1 }],
  ])("%s: ne' la voce ne' il campo", async (_n, p) => {
    await apri(widget(p));
    expect(voce('Apri il dettaglio con')).toBeUndefined();
    expect(campoDettaglio()).toBeUndefined();
  });

  it('nascosto anche in ogni forma, non solo in Lista', async () => {
    await apri(widget({ forma: 'kpi', trasformazione: { agg: 'count' } }));
    expect(campoDettaglio()).toBeUndefined();
    await scrivi('Forma', 'bar');
    expect(campoDettaglio()).toBeUndefined();
  });

  it('gli altri campi del pannello restano (Titolo, Aggiorna ogni)', async () => {
    await apri(widget());
    expect(campo('Titolo')).toBeDefined();
    expect(voce('Titolo')).toBeDefined();
  });
});

describe('SXADV-6127 senza il campo, Salva rimanda la scelta salvata uguale', () => {
  it('la scelta salvata va al server com\'era', async () => {
    await apri(widget());
    const o = await salvaOpzioni();
    expect(o.vistaDettaglio).toBe('dettaglioClienti');
    expect(o.altraChiave, 'le chiavi che il pannello non conosce restano').toBe('resta');
  });

  it('cambiando il titolo, la scelta resta', async () => {
    await apri(widget());
    await scrivi('Titolo', 'Nuovo titolo');
    const o = await salvaOpzioni();
    expect(salvataggi()[0].params.titolo).toBe('Nuovo titolo');
    expect(o.vistaDettaglio).toBe('dettaglioClienti');
  });

  it('cambiando forma (Lista -> Numero -> Lista), la scelta resta', async () => {
    await apri(widget());
    await scrivi('Forma', 'kpi');
    await scrivi('Forma', 'list');
    const o = await salvaOpzioni();
    expect(o.vistaDettaglio).toBe('dettaglioClienti');
  });

  it('salvato come Numero, la scelta resta', async () => {
    await apri(widget({ forma: 'kpi', trasformazione: { agg: 'count' } }));
    const o = await salvaOpzioni();
    expect(o.vistaDettaglio).toBe('dettaglioClienti');
  });

  it('nessuna scelta salvata: nessuna vistaDettaglio, e non stringa vuota', async () => {
    await apri(widget({ opzioni: { altraChiave: 'resta' } }));
    const o = await salvaOpzioni();
    expect('vistaDettaglio' in o, `opzioni mandate: ${JSON.stringify(o)}`).toBe(false);
  });

  it('opzioni assenti: nessuna vistaDettaglio', async () => {
    await apri(widget({ opzioni: null }));
    const o = await salvaOpzioni();
    expect('vistaDettaglio' in o).toBe(false);
  });

  it('aperto prima un widget con il campo e poi uno senza: va la scelta del secondo', async () => {
    await apri(widget({ sceltaDettaglio: true }));
    await scrivi('Vista di dettaglio', 'dettaglioScrittoNelPrimo');
    proprieta = {
      ...proprieta,
      widget: widget({ idWidget: 8, titolo: 'Altro', opzioni: { vistaDettaglio: 'dettaglioDelSecondo' } }),
    };
    disegna();
    await passa(600);
    expect(campoDettaglio()).toBeUndefined();
    const o = await salvaOpzioni();
    expect(salvataggi()[0].params.idWidget).toBe('8');
    expect(o.vistaDettaglio).toBe('dettaglioDelSecondo');
  });
});

describe('SXADV-6127 con il campo, come prima', () => {
  it('senza toccarlo, va la scelta salvata', async () => {
    await apri(widget({ sceltaDettaglio: true }));
    const o = await salvaOpzioni();
    expect(o.vistaDettaglio).toBe('dettaglioClienti');
  });

  it('cambiata, va la nuova (rifilata)', async () => {
    await apri(widget({ sceltaDettaglio: true }));
    await scrivi('Vista di dettaglio', '  dettaglioAltro  ');
    expect(campoDettaglio()!.props.value).toBe('  dettaglioAltro  ');
    const o = await salvaOpzioni();
    expect(o.vistaDettaglio).toBe('dettaglioAltro');
  });

  it('svuotata, la chiave non si manda: torna il dettaglio della lista', async () => {
    await apri(widget({ sceltaDettaglio: true }));
    await scrivi('Vista di dettaglio', '');
    const o = await salvaOpzioni();
    expect('vistaDettaglio' in o).toBe(false);
    expect(o.altraChiave).toBe('resta');
  });

  it('aggiunta dove non c\'era', async () => {
    await apri(widget({ sceltaDettaglio: true, opzioni: null }));
    await scrivi('Vista di dettaglio', 'dettaglioNuovo');
    const o = await salvaOpzioni();
    expect(o.vistaDettaglio).toBe('dettaglioNuovo');
  });

  it('il segnaposto e\' il dettaglio della lista', async () => {
    await apri(widget({ sceltaDettaglio: true }));
    expect(campoDettaglio()!.props.placeholder).toBe('dettaglioDocumenti');
  });
});
