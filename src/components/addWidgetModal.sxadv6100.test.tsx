import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import sorgenteModifica from './dashboard/ModificaWidget.tsx?raw';
import sorgenteAggiungi from './AddWidgetModal.tsx?raw';
// SXADV-6105: il campo dei giorni ora sta nel componente delle date, condiviso con «Modifica widget».
import sorgenteDate from './dashboard/DateDellaRicerca.tsx?raw';

// SXADV-6100.1 C6 e 6100.3 — la finestra «Aggiungi alla dashboard» (AddWidgetModal).
// Oracolo: docs/sxadv-62-prove/SXADV6100_contratto.md. Chi prova non e' chi implementa.
//
//   C6: conta solo le colonne non di comando («N colonne, come nella lista.») e, se ce ne
//       sono, aggiunge «Senza i pulsanti (etichette): si usano aprendo la riga.»
//   6100.3: con «oggi meno N giorni» il campo numerico (proposto 30, 1-3650) non ha le
//       frecce (`controls={false}`); stesso trattamento per i campi numerici di «Modifica
//       widget» (valore del filtro sui gruppi, «Quante barre»).
//
// Lettura della prova (dichiarata): «(etichette)» del contratto e' il segnaposto delle
// etichette delle colonne di comando, separate da virgola; la prova vuole tra parentesi le
// etichette dei comandi e nient'altro (in particolare non quelle delle colonne-dato).
//
// Impianto: quello di ritornoWidget.home.sxadv5999.test.tsx (niente DOM, motore di hook
// finto). Form.useForm di antd e' sostituito da un modulo finto (e' un hook di antd, che
// col motore finto non gira). Per «Modifica widget» la prova e' sul SORGENTE: ogni
// <InputNumber> del file porta controls={false} (montare il pannello vorrebbe la Home intera).

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
const { InputNumber, Typography } = await import('antd');
const { default: DateDellaRicerca } = await import('./dashboard/DateDellaRicerca');

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

/** Il testo di ogni Typography.Text della finestra. */
const testiTypography = () =>
  elements(tree).filter((e) => e.type === Typography.Text).map((e) => testoDi(e.props.children));
const fraseColonne = () => testiTypography().find((t) => /colonne, come nella lista\./.test(t));
// SXADV-6105: il campo dei giorni e' un livello piu' giu', in DateDellaRicerca. Il
// componente non ha hook: chiamarlo con le sue prop da' il disegno che React monterebbe.
const campiNumero = () =>
  elements(tree)
    .flatMap((e) => (e.type === DateDellaRicerca
      ? elements((DateDellaRicerca as unknown as (p: unknown) => unknown)(e.props))
      : [e]))
    .filter((e) => e.type === InputNumber);

function bozza(colonne: Array<Record<string, unknown>>, criteriData: unknown[] = []) {
  return {
    esito: 'ok',
    widget: { titolo: 'Fatture attive', intervalloMin: 60 },
    sorgente: { filtri: [], filtriLeggibili: true, colonne, criteriData, listView: 'docCliList' },
  };
}

const W1 = [
  { item: 'numDoc', etichetta: 'Num doc.', tipo: 'Text' },
  { item: 'sts', etichetta: 'Stato', tipo: 'WorkflowStatus' },
  { item: 'att', etichetta: 'Allegati', tipo: 'Attachments' },
  { item: 'visualizzaFE', etichetta: 'visualizzaFE', tipo: 'SingleAction', azione: true },
  { item: 'anagrafica', etichetta: 'Cliente', tipo: 'List' },
  { item: 'print', etichetta: 'Stampa', tipo: 'ReportBar', azione: true },
];

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
  server.bozza = bozza(W1);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SXADV-6100.1 C6: «Aggiungi alla dashboard» conta solo le colonne-dato', () => {
  it('impianto: una sola richiesta, l\'anteprima, e la bozza a schermo', async () => {
    await apri();
    const aw = server.chiamate.filter((c) => c.action === 'dashboard.AddWidget');
    expect(aw.length).toBe(1);
    expect(aw[0].params.anteprima).toBe('true');
    expect(fraseColonne(), 'la frase sulle colonne').toBeDefined();
  });

  it('sei colonne di cui due comandi: «4 colonne, come nella lista.»', async () => {
    await apri();
    expect(fraseColonne()).toMatch(/^4 colonne, come nella lista\./);
  });

  it('con comandi: «Senza i pulsanti (…): si usano aprendo la riga.»', async () => {
    await apri();
    expect(fraseColonne()).toMatch(/Senza i pulsanti \([^)]*\): si usano aprendo la riga\.$/);
  });

  it('tra parentesi le etichette dei comandi, e solo quelle', async () => {
    await apri();
    const m = /Senza i pulsanti \(([^)]*)\)/.exec(fraseColonne() || '');
    const nomi = (m?.[1] || '').split(',').map((x) => x.trim()).filter(Boolean);
    expect(nomi.sort()).toEqual(['Stampa', 'visualizzaFE']);
  });

  it('senza comandi: «6 colonne, come nella lista.» e niente sui pulsanti', async () => {
    server.bozza = bozza(W1.map((c) => ({ ...c, azione: undefined })));
    await apri();
    expect(fraseColonne()?.trim()).toBe('6 colonne, come nella lista.');
  });

  it('azione: false non e\' un comando', async () => {
    server.bozza = bozza([{ item: 'a', etichetta: 'A', azione: false }, { item: 'b', etichetta: 'B' }]);
    await apri();
    expect(fraseColonne()?.trim()).toBe('2 colonne, come nella lista.');
  });

  it('Allegati e Stato (dati, non comandi) si contano', async () => {
    server.bozza = bozza([
      { item: 'att', etichetta: 'Allegati', tipo: 'Attachments' },
      { item: 'sts', etichetta: 'Stato', tipo: 'WorkflowStatus' },
      { item: 'x', etichetta: 'X', tipo: 'ImageButton', azione: true },
    ]);
    await apri();
    expect(fraseColonne()).toMatch(/^2 colonne, come nella lista\./);
    expect(fraseColonne()).toContain('(X)');
  });
});

describe('SXADV-6100.3 «oggi meno N giorni»: il numero senza frecce', () => {
  const CRIT = [{ chiave: 'dataReg.S1-0', etichetta: 'Data reg.', valore: '01/10/2026', modoProposto: 'oggiMenoGiorni' }];

  it('il campo numerico c\'e\', proposto 30, fra 1 e 3650', async () => {
    server.bozza = bozza(W1, CRIT);
    await apri();
    const n = campiNumero();
    expect(n.length).toBe(1);
    expect(n[0].props.value).toBe(30);
    expect(n[0].props.min).toBe(1);
    expect(n[0].props.max).toBe(3650);
  });

  it('senza le frecce su/giu\' (controls={false})', async () => {
    server.bozza = bozza(W1, CRIT);
    await apri();
    expect(campiNumero()[0].props.controls).toBe(false);
  });

  it('con un altro modo il campo non c\'e\'', async () => {
    server.bozza = bozza(W1, [{ ...CRIT[0], modoProposto: 'oggi' }]);
    await apri();
    expect(campiNumero()).toEqual([]);
  });
});

describe('SXADV-6100.3 «Modifica widget»: i campi numerici senza frecce (sul sorgente)', () => {
  const inputNumber = (src: string) => [...src.matchAll(/<InputNumber\b[\s\S]*?\/?>/g)].map((m) => m[0]);

  it('ModificaWidget: almeno due InputNumber (valore del filtro, «Quante barre»)', () => {
    expect(inputNumber(sorgenteModifica).length).toBeGreaterThanOrEqual(2);
  });

  it('ModificaWidget: ogni InputNumber ha controls={false}', () => {
    for (const t of inputNumber(sorgenteModifica))
      expect(t, t.slice(0, 120)).toMatch(/controls=\{false\}/);
  });

  it('AddWidgetModal: ogni InputNumber ha controls={false}', () => {
    for (const t of inputNumber(sorgenteAggiungi)) expect(t, t.slice(0, 120)).toMatch(/controls=\{false\}/);
    for (const t of inputNumber(sorgenteDate)) expect(t, t.slice(0, 120)).toMatch(/controls=\{false\}/);
  });
});
