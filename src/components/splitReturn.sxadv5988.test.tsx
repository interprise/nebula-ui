import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UITree } from '../types/ui';

// SXADV-5988 — una vista di dettaglio a due aree ricorda per sessione+vista lo
// spazio dell'area tab. Al ritorno da una vista figlia arriva focusNewPage come
// a ogni pagina nuova e mette il cursore sul primo campo della testata: quel
// fuoco non deve riportare la testata al 78%.
//
// Si prova il percorso vero: ViewRenderer -> DetailFormView e il focusNewPage
// vero. Il progetto non ha un DOM di prova (ne' jsdom ne' testing-library, vedi
// sectionZoomEscape.sxadv5956.test.tsx), quindi:
//  - un motore di hook minimo al posto di React, che esegue gli effetti e, come
//    React, scarta quelli di un passaggio che ha aggiornato lo stato in render;
//  - l'albero restituito si visita come dati: la basis si legge dallo stile di
//    .view-split-form, gli eventi si consegnano ai gestori di .view-container;
//  - un DOM finto col minimo che focusNewPage legge: il `focus()` consegna gli
//    eventi in modo SINCRONO, come il browser, prima il blur del campo che lascia
//    (relatedTarget = destinazione) e poi il focus; nessuna prova sa come
//    l'implementazione distingua l'arrivo sulla pagina dall'utente.

/* ── Motore di hook ─────────────────────────────────────────────────────── */

type AnyFn = (...a: never[]) => unknown;
interface Effect { deps?: unknown[]; pending?: () => unknown; cleanup?: () => void }
interface Inst { slots: { v: unknown; deps?: unknown[] }[]; i: number; effects: Effect[]; ei: number }

const rt = vi.hoisted(() => ({
  active: 0,
  inst: null as unknown,
  dirty: false,
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const cur = () => rt.inst as Inst;
  const slot = (init: () => unknown) => {
    const inst = cur();
    const i = inst.i++;
    if (!inst.slots[i]) inst.slots[i] = { v: init() };
    return inst.slots[i];
  };
  const same = (a?: unknown[], b?: unknown[]) =>
    !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
  const memo = (f: () => unknown, deps?: unknown[]) => {
    const inst = cur();
    const i = inst.i++;
    const s = inst.slots[i];
    if (s && deps && same(s.deps, deps)) return s.v;
    inst.slots[i] = { v: f(), deps };
    return inst.slots[i].v;
  };
  const effect = (fn: () => unknown, deps?: unknown[]) => {
    const inst = cur();
    const i = inst.ei++;
    const ef = (inst.effects[i] ??= {});
    if (ef.deps && deps && same(ef.deps, deps) && !ef.pending) return;
    ef.deps = deps;
    ef.pending = fn;
  };
  const on = <F extends AnyFn>(real: F, fake: AnyFn): F =>
    ((...a: never[]) => (rt.active > 0 ? fake(...a) : real(...a))) as unknown as F;
  const over = {
    useState: on(actual.useState as AnyFn, ((init: unknown) => {
      const s = slot(() => (typeof init === 'function' ? (init as () => unknown)() : init)) as {
        v: unknown; set?: (nv: unknown) => void;
      };
      s.set ??= (nv: unknown) => {
        const next = typeof nv === 'function' ? (nv as (p: unknown) => unknown)(s.v) : nv;
        if (!Object.is(next, s.v)) { s.v = next; rt.dirty = true; }
      };
      return [s.v, s.set];
    }) as AnyFn),
    useReducer: on(actual.useReducer as AnyFn, ((reducer: (s: unknown, a: unknown) => unknown, init: unknown) => {
      const s = slot(() => init) as { v: unknown; set?: (a: unknown) => void };
      s.set ??= (a: unknown) => { s.v = reducer(s.v, a); rt.dirty = true; };
      return [s.v, s.set];
    }) as AnyFn),
    useRef: on(actual.useRef as AnyFn, ((init: unknown) => slot(() => ({ current: init })).v) as AnyFn),
    useMemo: on(actual.useMemo as AnyFn, memo as AnyFn),
    useCallback: on(actual.useCallback as AnyFn, ((fn: unknown, deps?: unknown[]) => memo(() => fn, deps)) as AnyFn),
    useEffect: on(actual.useEffect as AnyFn, effect as AnyFn),
    useLayoutEffect: on(actual.useLayoutEffect as AnyFn, effect as AnyFn),
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

vi.mock('../hooks/density', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/density')>()),
  useDensity: () => ({ density: 'normal', setDensity: () => {} }),
}));

const { default: ViewRenderer, SidContext } = await import('./ViewRenderer');
const { focusNewPage } = await import('../services/focusRestore');
const { useHotkeyRegistry, HotkeyRegistryContext } = await import('../hooks/hotkeys');
const { useUiModeStore, UiModeStoreContext, ZoomScopeContext } = await import('../hooks/uiMode');

/* ── DOM finto ──────────────────────────────────────────────────────────── */

type Listener = (e: unknown) => void;
interface Reg { type: string; l: Listener; once: boolean }

function bersaglio() {
  const regs: Reg[] = [];
  return {
    addEventListener(type: string, l: Listener, o?: boolean | AddEventListenerOptions) {
      regs.push({ type, l, once: typeof o === 'object' && !!o.once });
    },
    removeEventListener(type: string, l: Listener) {
      const i = regs.findIndex((r) => r.type === type && r.l === l);
      if (i >= 0) regs.splice(i, 1);
    },
    fire(type: string, e: unknown = {}) {
      for (const r of regs.filter((x) => x.type === type)) {
        if (r.once) regs.splice(regs.indexOf(r), 1);
        r.l(e);
      }
    },
    clear() { regs.length = 0; },
  };
}
const suWindow = bersaglio();
const suDocument = bersaglio();

class FakeElement {
  tagName = 'DIV';
  id = '';
  type = 'text';
  tabIndex = 0;
  disabled = false;
  readOnly = false;
  isContentEditable = false;
  parentElement: FakeElement | null = null;
  dataset: Record<string, string> = {};
  /** I selettori a cui l'elemento appartiene: `closest` risponde da qui. */
  dentro: string[] = [];
  closest(sel: string) {
    return sel.split(',').map((s) => s.trim()).some((s) => this.dentro.includes(s)) ? this : null;
  }
  getClientRects() { return [{}]; }
  getBoundingClientRect() { return { top: 0, bottom: 20, left: 0, right: 100, width: 100, height: 20 }; }
  getAttribute() { return null; }
  setAttribute() {}
  removeAttribute() {}
  hasAttribute() { return false; }
  select() {}
  scrollIntoView() {}
  /** Vero per un elemento in un portale figlio della vista nell'albero React:
   *  fuori dal DOM del contenitore, ma i suoi eventi lo attraversano lo stesso. */
  portaleNellaVista = false;
  /** Come il browser: blur di chi lascia, poi focus, tutto prima che focus() torni. */
  focus() {
    if (dom.active === this) return;
    const prev = dom.active;
    if (prev && prev !== dom.body) consegnaBlur(prev, this);
    dom.active = this;
    consegnaFocus(this, prev);
  }
}
/** Un evento di fuoco arriva ai gestori capture della vista solo da chi le appartiene. */
function dellaVista(el: FakeElement): boolean {
  return contenitore.contains(el) || el.portaleNellaVista;
}
function consegnaBlur(el: FakeElement, to: FakeElement | null): void {
  suDocument.fire('focusout', { target: el, relatedTarget: to });
  if (dellaVista(el)) gestore('onBlurCapture')?.({ target: el, relatedTarget: to });
}
function consegnaFocus(el: FakeElement, from: FakeElement | null): void {
  suDocument.fire('focusin', { target: el, relatedTarget: from });
  if (dellaVista(el)) gestore('onFocusCapture')?.({ target: el, relatedTarget: from });
}
class FakeInput extends FakeElement { tagName = 'INPUT'; }
class FakeTextArea extends FakeElement { tagName = 'TEXTAREA'; }
class FakeSelect extends FakeElement { tagName = 'SELECT'; }

function elemento(dentro: string[], tagName = 'DIV'): FakeElement {
  const e = new FakeElement();
  e.tagName = tagName;
  e.dentro = dentro;
  return e;
}
function campo(id: string, dentro: string[]): FakeInput {
  const e = new FakeInput();
  e.id = id;
  e.dentro = dentro;
  return e;
}

/** I nodi della pagina visualizzata: rifatti a ogni cambio di vista. */
interface Pagina {
  testata: FakeInput;
  rigaTestata: FakeElement;
  campoTab: FakeInput;
  linguetta: FakeElement;
  resizer: FakeElement;
}
const dom = {
  active: null as FakeElement | null,
  /** document.hasFocus(): falso mentre la finestra del browser non e' in primo piano. */
  finestraAttiva: true,
  body: new FakeElement(),
  pagina: null as Pagina | null,
  raf: [] as (() => void)[],
  timer: [] as (() => void)[],
};

const contenitore = {
  contains: (el: unknown) => {
    const p = dom.pagina;
    return !!p && (el === p.testata || el === p.campoTab || el === p.linguetta || el === p.rigaTestata);
  },
  querySelector: () => null,
  querySelectorAll: (sel: string) => {
    const p = dom.pagina;
    return p && sel.includes('input') ? [p.testata, p.campoTab] : [];
  },
  getBoundingClientRect: () => ({ top: 0, bottom: 1000, left: 0, right: 1000, width: 1000, height: 1000 }),
};

Object.assign(globalThis, {
  HTMLElement: FakeElement,
  HTMLInputElement: FakeInput,
  HTMLTextAreaElement: FakeTextArea,
  HTMLSelectElement: FakeSelect,
  window: {
    addEventListener: suWindow.addEventListener,
    removeEventListener: suWindow.removeEventListener,
    setTimeout: (f: () => void) => { dom.timer.push(f); return dom.timer.length; },
    clearTimeout: () => {},
  },
  requestAnimationFrame: (f: () => void) => { dom.raf.push(f); return dom.raf.length; },
  cancelAnimationFrame: () => {},
  getComputedStyle: () => ({ display: 'block', overflowY: 'visible' }),
  document: {
    body: dom.body,
    get activeElement() { return dom.active; },
    hasFocus: () => dom.finestraAttiva,
    getElementById: (id: string) => {
      const p = dom.pagina;
      return p ? [p.testata, p.campoTab].find((e) => e.id === id) ?? null : null;
    },
    createElement: () => ({ getContext: () => null, style: {} }),
    querySelector: (sel: string) => (sel.includes('.view-container') ? contenitore : null),
    querySelectorAll: () => [],
    addEventListener: suDocument.addEventListener,
    removeEventListener: suDocument.removeEventListener,
  },
});
// Il body del DOM finto e' un elemento qualunque: gli stili li scrive il resizer.
(dom.body as unknown as { style: Record<string, string> }).style = {};

/* ── Applicazione ───────────────────────────────────────────────────────── */

interface Vista { viewName: string; path: string; newRecord?: boolean }
const PADRE: Vista = { viewName: 'ordiniDetail', path: 'S1-1' };
const FIGLIA: Vista = { viewName: 'righeOrdineDetail', path: 'S1-2' };
const FIGLIA_NUOVA: Vista = { ...FIGLIA, newRecord: true };

/** Dettaglio a due aree: una riga di testata e in coda un Tab. */
function vista(v: Vista): UITree {
  const f = v.viewName;
  return {
    viewName: v.viewName,
    pageType: 2,
    path: v.path,
    title: f,
    newRecord: v.newRecord,
    rows: [
      { id: 'h0', cells: [
        { elementType: 0, prompt: 'Numero:' },
        { elementType: 1, control: { type: 'text', name: `${f}_numero`, id: `${f}_numero`, group: 'testata', value: '12' } },
      ] },
      { id: 'b0', cells: [{
        elementType: 1,
        control: {
          type: 'tab', name: 'schede', id: 'schede', controlName: 'schede', navpath: v.path,
          tabs: [{ name: 'generale', prompt: 'Generale', selected: true }],
          contentRows: [
            { id: 'c0', cells: [
              { elementType: 0, prompt: 'Riferimento:' },
              { elementType: 1, control: { type: 'text', name: `${f}_rif`, id: `${f}_rif` } },
            ] },
          ],
        },
      }] },
    ],
  } as unknown as UITree;
}

function paginaDi(v: Vista): Pagina {
  const zonaT = ['.view-split-form'];
  const zonaB = ['.view-split-bottom', '.tab-content'];
  return {
    testata: campo(`${v.viewName}_numero`, zonaT),
    rigaTestata: elemento(zonaT),
    campoTab: campo(`${v.viewName}_rif`, zonaB),
    linguetta: elemento(['.view-split-bottom', '.ant-tabs-nav']),
    resizer: elemento(['.view-split-resizer']),
  };
}

const nuova = (): Inst => ({ slots: [], i: 0, effects: [], ei: 0 });

function esegui<T>(inst: Inst, fn: () => T): T {
  const prima = rt.dirty;
  rt.dirty = false;
  const prev = rt.inst;
  rt.inst = inst;
  inst.i = 0;
  inst.ei = 0;
  rt.active++;
  let out: T;
  try { out = fn(); } finally { rt.active--; rt.inst = prev; }
  // Stato aggiornato durante il render: React rifa' subito il componente e di
  // questo passaggio non esegue nessun effetto.
  const inRender = rt.dirty;
  rt.dirty = prima || inRender;
  if (inRender) return out;
  for (const ef of inst.effects) {
    if (!ef?.pending) continue;
    ef.cleanup?.();
    const r = ef.pending();
    ef.pending = undefined;
    ef.cleanup = typeof r === 'function' ? (r as () => void) : undefined;
  }
  return out;
}
function smonta(inst: Inst): void {
  for (const ef of inst.effects) { ef?.cleanup?.(); if (ef) ef.cleanup = undefined; }
}

interface El { type: unknown; props: Record<string, unknown> }
const isEl = (x: unknown): x is El =>
  !!x && typeof x === 'object' && '$$typeof' in (x as object) && 'props' in (x as object);

function visita(node: unknown, f: (el: El) => void): void {
  if (Array.isArray(node)) { node.forEach((n) => visita(n, f)); return; }
  if (!isEl(node)) return;
  f(node);
  for (const v of Object.values(node.props)) {
    if (Array.isArray(v) || isEl(v)) visita(v, f);
  }
}

let app: {
  registry: Inst; store: Inst; view: Inst;
  tree: unknown;
  v: Vista;
};

function render(): void {
  for (let pass = 0; pass < 30; pass++) {
    rt.dirty = false;
    const reg = esegui(app.registry, () => useHotkeyRegistry());
    (HotkeyRegistryContext as unknown as { _currentValue: unknown })._currentValue = reg;
    const store = esegui(app.store, () => useUiModeStore());
    (UiModeStoreContext as unknown as { _currentValue: unknown })._currentValue = store;
    (ZoomScopeContext as unknown as { _currentValue: unknown })._currentValue = `${sid}|${app.v.viewName}`;
    (SidContext as unknown as { _currentValue: unknown })._currentValue = sid;

    app.tree = esegui(app.view, () => {
      const el = (ViewRenderer as unknown as (p: unknown) => El)({
        ui: vista(app.v), onAction: () => {}, onChange: () => {}, onGridChange: () => {},
      });
      return typeof el?.type === 'function' ? (el.type as (p: unknown) => unknown)(el.props) : el;
    });
    // Il ref del contenitore: lo aggancerebbe React, serve al trascinamento.
    const c = cerca(conClasse('view-container'))[0];
    const ref = c?.props.ref as { current: unknown } | undefined;
    if (ref && typeof ref === 'object') ref.current = contenitore;
    if (!rt.dirty) return;
  }
  throw new Error('render: non si stabilizza');
}

function cerca(pred: (el: El) => boolean): El[] {
  const out: El[] = [];
  visita(app.tree, (el) => { if (pred(el)) out.push(el); });
  return out;
}
const conClasse = (cls: string) => (el: El) =>
  typeof el.props.className === 'string' && el.props.className.split(/\s+/).includes(cls);

function gestore(nome: string): ((e: unknown) => void) | undefined {
  return cerca(conClasse('view-container'))[0]?.props[nome] as ((e: unknown) => void) | undefined;
}

/** La basis di .view-split-form, in percento. */
function basis(): number {
  const [form] = cerca(conClasse('view-split-form'));
  expect(form, '.view-split-form presente').toBeDefined();
  const style = form.props.style as { flex?: string; flexBasis?: string };
  const m = /([\d.]+)%/.exec(String(style.flexBasis ?? style.flex));
  expect(m, `basis leggibile da ${JSON.stringify(style)}`).not.toBeNull();
  return Number(m![1]);
}

/* ── Mosse dell'utente e del client ─────────────────────────────────────── */

function scaricaRaf(): void {
  for (let i = 0; dom.raf.length > 0; i++) {
    if (i > 50) throw new Error('requestAnimationFrame: non si esaurisce');
    dom.raf.splice(0).forEach((f) => f());
  }
}
function scaricaTimer(): void {
  for (let i = 0; dom.timer.length > 0; i++) {
    if (i > 50) throw new Error('setTimeout: non si esaurisce');
    dom.timer.splice(0).forEach((f) => f());
  }
}

/** Il server risponde con un'altra vista: stesso componente, DOM rifatto, il
 *  campo che aveva il fuoco e' sparito e il fuoco cade su <body>. */
function mostra(v: Vista): void {
  app.v = v;
  dom.pagina = paginaDi(v);
  dom.active = dom.body;
  render();
}
/** Quel che il client fa dopo ogni pagina nuova. */
function arrivo(currField?: string | null): void {
  focusNewPage(currField);
  scaricaRaf();
  render();
}
/** Pagina nuova completa: resa, poi il cursore. */
function vaiA(v: Vista, currField?: string | null): void {
  mostra(v);
  arrivo(currField);
}

/** Clic vero: pointerdown -> il fuoco al bersaglio -> pointerup -> click. */
function premiERilascia(el: FakeElement): void {
  gestore('onPointerDownCapture')?.({ target: el });
  el.focus();
  suWindow.fire('pointerup');
  gestore('onClickCapture')?.({ target: el });
  render();
}
function clic(el: FakeElement): void {
  premiERilascia(el);
  scaricaTimer();
  render();
}
/** Fuoco messo dall'utente da tastiera (Tab), senza passare da focusNewPage. */
function tastiera(el: FakeElement): void {
  el.focus();
  render();
}
/** Trascina la maniglia fino alla percentuale voluta (contenitore alto 1000px). */
function trascinaA(pct: number): void {
  const res = pagina().resizer;
  const start = basis();
  gestore('onPointerDownCapture')?.({ target: res });
  const [maniglia] = cerca(conClasse('view-split-resizer'));
  expect(maniglia, '.view-split-resizer presente').toBeDefined();
  (maniglia.props.onMouseDown as (e: unknown) => void)({ preventDefault() {}, clientY: 100 });
  render();
  suDocument.fire('mousemove', { clientY: 100 + (pct - start) * 10 });
  render();
  suDocument.fire('mouseup', {});
  suWindow.fire('pointerup');
  gestore('onClickCapture')?.({ target: res });
  scaricaTimer();
  render();
  expect(basis()).toBeCloseTo(pct, 5);
}
const pagina = (): Pagina => dom.pagina!;

/** Il componente viene smontato (una lista in mezzo) e rimontato su `v`: celle
 *  di hook nuove, resta solo la memoria di modulo. */
function rimonta(v: Vista): void {
  smonta(app.view);
  app.view = nuova();
  mostra(v);
}
/** Altra finestra in primo piano: blur con hasFocus() falso, activeElement resta. */
function lasciaFinestra(): void {
  const el = dom.active!;
  dom.finestraAttiva = false;
  consegnaBlur(el, null);
  render();
}
/** Si rientra nella finestra: il browser ridà il focus allo stesso elemento. */
function rientraInFinestra(): void {
  dom.finestraAttiva = true;
  consegnaFocus(dom.active!, null);
  render();
}
/** Il fuoco va su un elemento della pagina fuori dalla vista (toolbar). */
function fuocoSuToolbar(): void {
  tastiera(elemento(['.toolbar'], 'BUTTON'));
}
/** Finestra di dialogo aperta col fuoco dentro. */
function apriDialogo(nellaVista: boolean): FakeElement {
  const d = elemento(['.ant-modal-root'], 'BUTTON');
  d.portaleNellaVista = nellaVista;
  d.focus();
  render();
  return d;
}
/** Il ritorno a una vista a due aree col cursore d'arrivo in testata, al 22%. */
function ritornoAlPadre(): void {
  padreColTabAperto();
  vaiA(FIGLIA);
  vaiA(PADRE);
  expect(dom.active).toBe(pagina().testata);
  expect(basis()).toBe(22);
}

/** Prima visita al padre, tab cliccato: la base di quasi tutte le prove. */
function padreColTabAperto(): void {
  vaiA(PADRE);
  clic(pagina().linguetta);
  expect(basis()).toBe(22);
}

/* ── Isolamento: la memoria e' di modulo, ogni prova ha la sua sessione ─── */

let sid = 'T0';
let progressivo = 0;

beforeEach(() => {
  sid = `T${++progressivo}`;
  suWindow.clear();
  suDocument.clear();
  dom.raf.length = 0;
  dom.timer.length = 0;
  dom.active = dom.body;
  dom.finestraAttiva = true;
  dom.pagina = paginaDi(PADRE);
  app = { registry: nuova(), store: nuova(), view: nuova(), tree: null, v: PADRE };
  render();
});

afterEach(() => {
  for (const inst of [app.view, app.store, app.registry]) smonta(inst);
});

/* ── Prove ──────────────────────────────────────────────────────────────── */

describe('fixture (prerequisito)', () => {
  it('la vista si apre a due aree, neutra al 50% prima che il cursore arrivi', () => {
    expect(cerca(conClasse('view-split-form'))).toHaveLength(1);
    expect(cerca(conClasse('view-split-bottom'))).toHaveLength(1);
    expect(basis()).toBe(50);
  });

  it('focusNewPage mette davvero il cursore sul primo campo della testata', () => {
    arrivo();
    expect(dom.active).toBe(pagina().testata);
  });
});

describe('SXADV-5988 — 1. prima visita', () => {
  it('nessuna zona ricordata: il cursore va in testata e la testata si apre al 78%', () => {
    expect(basis()).toBe(50);
    arrivo();
    expect(dom.active).toBe(pagina().testata);
    expect(basis()).toBe(78);
  });

  it('resta al 78% anche ai ridisegni successivi della stessa vista', () => {
    arrivo();
    render();
    render();
    expect(basis()).toBe(78);
  });
});

describe('SXADV-5988 — 2. ritorno da una vista figlia', () => {
  it('tab, figlia, ritorno + focusNewPage: la basis resta 22% col cursore in testata', () => {
    padreColTabAperto();
    vaiA(FIGLIA);
    mostra(PADRE);
    expect(basis()).toBe(22); // il ricordo c'e' gia' alla prima resa
    arrivo();
    expect(dom.active, 'il cursore va comunque sul campo della testata').toBe(pagina().testata);
    expect(basis()).toBe(22);
  });

  it('idem quando il cursore lo indica il server (currField)', () => {
    padreColTabAperto();
    vaiA(FIGLIA);
    vaiA(PADRE, `${PADRE.viewName}_numero`);
    expect(dom.active).toBe(pagina().testata);
    expect(basis()).toBe(22);
  });

  it('idem se la figlia e\' stata lavorata nella sua testata', () => {
    padreColTabAperto();
    vaiA(FIGLIA);
    clic(pagina().rigaTestata);
    expect(basis()).toBe(78);
    vaiA(PADRE);
    expect(basis()).toBe(22);
  });

  it('regge a due andate e ritorno di fila', () => {
    padreColTabAperto();
    vaiA(FIGLIA);
    vaiA(PADRE);
    expect(basis()).toBe(22);
    vaiA(FIGLIA);
    vaiA(PADRE);
    expect(basis()).toBe(22);
  });

  it('la figlia non eredita il 22% del padre: alla sua prima visita si apre al 78%', () => {
    padreColTabAperto();
    vaiA(FIGLIA);
    expect(basis()).toBe(78);
  });

  it('la figlia ricorda la SUA zona indipendentemente da quella del padre', () => {
    padreColTabAperto();
    vaiA(FIGLIA);
    clic(pagina().linguetta);
    expect(basis()).toBe(22);
    vaiA(PADRE);
    clic(pagina().rigaTestata);
    expect(basis()).toBe(78);
    vaiA(FIGLIA);
    expect(basis()).toBe(22);
    vaiA(PADRE);
    expect(basis()).toBe(78);
  });

  it('la memoria e\' per sessione: la stessa vista in un\'altra sessione riparte al 78%', () => {
    padreColTabAperto();
    const prima = sid;
    sid = `${prima}-altra`;
    vaiA(PADRE);
    expect(basis()).toBe(78);
    sid = prima;
    vaiA(PADRE);
    expect(basis()).toBe(22);
  });
});

describe('SXADV-5988 — 3. ritorno da una figlia nuovo record lasciata con Annulla', () => {
  it('la figlia nuovo record apre la sua testata; dopo Annulla il padre resta al 22%', () => {
    padreColTabAperto();
    vaiA(FIGLIA_NUOVA);
    expect(basis()).toBe(78);
    vaiA(PADRE);
    expect(dom.active).toBe(pagina().testata);
    expect(basis()).toBe(22);
  });

  it('guardia SXADV-5691: Nuovo sulla vista stessa apre comunque la testata al 78%', () => {
    padreColTabAperto();
    mostra({ ...PADRE, newRecord: true });
    expect(basis()).toBe(78);
  });
});

describe('SXADV-5988 — 4. trascinamento ricordato', () => {
  it('35% trascinato con la zona tab: sopravvive al ritorno con focusNewPage', () => {
    padreColTabAperto();
    trascinaA(35);
    vaiA(FIGLIA);
    mostra(PADRE);
    expect(basis()).toBeCloseTo(35, 5);
    arrivo();
    expect(dom.active).toBe(pagina().testata);
    expect(basis()).toBeCloseTo(35, 5);
  });

  it('35% trascinato con la zona testata: sopravvive anche lui', () => {
    vaiA(PADRE);
    expect(basis()).toBe(78);
    trascinaA(35);
    vaiA(FIGLIA);
    vaiA(PADRE);
    expect(basis()).toBeCloseTo(35, 5);
  });

  it('35% trascinato e figlia nuovo record lasciata con Annulla: sopravvive', () => {
    padreColTabAperto();
    trascinaA(35);
    vaiA(FIGLIA_NUOVA);
    vaiA(PADRE);
    expect(basis()).toBeCloseTo(35, 5);
  });
});

describe('SXADV-5988 — 5. guardia: il fuoco da tastiera vero decide ancora', () => {
  it('Tab su un campo della testata col tab aperto, senza navigare: 78%', () => {
    padreColTabAperto();
    tastiera(pagina().testata);
    expect(basis()).toBe(78);
  });

  it('dopo il ritorno: il cursore esce nell\'area tab e rientra da tastiera in testata: 78%', () => {
    padreColTabAperto();
    vaiA(FIGLIA);
    vaiA(PADRE);
    expect(basis()).toBe(22);
    tastiera(pagina().campoTab);
    expect(basis()).toBe(22);
    tastiera(pagina().testata);
    expect(basis()).toBe(78);
  });

  it('focusNewPage non lascia strascichi: il primo fuoco da tastiera su ALTRO campo conta', () => {
    ritornoAlPadre();
    const altro = campo('altro', ['.view-split-form']);
    altro.portaleNellaVista = true;
    tastiera(altro);
    expect(basis()).toBe(78);
  });

  it('il fuoco da tastiera su un campo del tab porta al 22%', () => {
    vaiA(PADRE);
    expect(basis()).toBe(78);
    tastiera(pagina().campoTab);
    expect(basis()).toBe(22);
  });

  it('il fuoco da tastiera che cambia area scarta il trascinamento', () => {
    padreColTabAperto();
    trascinaA(35);
    tastiera(pagina().testata);
    expect(basis()).toBe(78);
  });
});

describe('SXADV-5988 — 6. guardia: il clic in testata dopo il ritorno', () => {
  it('clic sul campo della testata col cursore gia\' sopra: torna al 78%', () => {
    padreColTabAperto();
    vaiA(FIGLIA);
    vaiA(PADRE);
    expect(dom.active).toBe(pagina().testata);
    expect(basis()).toBe(22);
    clic(pagina().testata);
    expect(basis()).toBe(78);
  });

  it('clic su un punto della testata che non prende il fuoco: torna al 78%', () => {
    padreColTabAperto();
    vaiA(FIGLIA);
    vaiA(PADRE);
    clic(pagina().rigaTestata);
    expect(basis()).toBe(78);
  });

  it('il clic si applica nel task dopo, non dentro il click (SXADV-5820)', () => {
    padreColTabAperto();
    vaiA(FIGLIA);
    vaiA(PADRE);
    premiERilascia(pagina().rigaTestata);
    expect(basis()).toBe(22);
    scaricaTimer();
    render();
    expect(basis()).toBe(78);
  });

  it('il clic sulla linguetta dopo il ritorno lascia il 22%', () => {
    padreColTabAperto();
    vaiA(FIGLIA);
    vaiA(PADRE);
    clic(pagina().linguetta);
    expect(basis()).toBe(22);
  });
});

describe('SXADV-5988 — a. padre ancora nuovo record', () => {
  const PADRE_NUOVO: Vista = { ...PADRE, newRecord: true };

  it('tab al 22%, figlia, ritorno: resta 22%', () => {
    vaiA(PADRE_NUOVO);
    expect(basis()).toBe(78);
    clic(pagina().linguetta);
    expect(basis()).toBe(22);
    vaiA(FIGLIA);
    mostra(PADRE_NUOVO);
    expect(basis()).toBe(22);
    arrivo();
    expect(dom.active).toBe(pagina().testata);
    expect(basis()).toBe(22);
  });

  it('trascinamento al 35%, figlia, ritorno: resta 35%', () => {
    vaiA(PADRE_NUOVO);
    trascinaA(35);
    vaiA(FIGLIA);
    vaiA(PADRE_NUOVO);
    expect(basis()).toBeCloseTo(35, 5);
  });
});

describe('SXADV-5988 — b. Nuovo e Annulla sulla stessa vista', () => {
  const NUOVO: Vista = { ...PADRE, newRecord: true };

  it('dal 22% Nuovo apre al 78%, Annulla sullo stesso record torna al 22%', () => {
    padreColTabAperto();
    vaiA(NUOVO);
    expect(basis()).toBe(78);
    vaiA(PADRE);
    expect(dom.active).toBe(pagina().testata);
    expect(basis()).toBe(22);
  });

  it('Annulla ripristina anche un trascinamento del record di partenza', () => {
    padreColTabAperto();
    trascinaA(35);
    vaiA(NUOVO);
    expect(basis()).toBe(78);
    vaiA(PADRE);
    expect(basis()).toBeCloseTo(35, 5);
  });

  it('SXADV-5691: un SECONDO Nuovo apre al 78%, anche se il primo era stato lasciato al 22%', () => {
    padreColTabAperto();
    vaiA(NUOVO);
    clic(pagina().linguetta);
    expect(basis()).toBe(22);
    vaiA(PADRE);
    vaiA(NUOVO);
    expect(basis()).toBe(78);
  });
});

describe('SXADV-5988 — c. salvataggio di un record nuovo', () => {
  // Vista mai vista in questa sessione: nessun ricordo per il record salvato.
  const NUOVO: Vista = { viewName: 'fattureDetail', path: 'S1-5', newRecord: true };
  const SALVATO: Vista = { viewName: 'fattureDetail', path: 'S1-5' };

  it('area tab al 22%: dopo il salvataggio resta 22%', () => {
    rimonta(NUOVO);
    arrivo();
    expect(basis()).toBe(78);
    clic(pagina().linguetta);
    expect(basis()).toBe(22);
    vaiA(SALVATO);
    expect(dom.active).toBe(pagina().testata);
    expect(basis()).toBe(22);
  });

  it('trascinamento al 35%: dopo il salvataggio resta 35%', () => {
    rimonta(NUOVO);
    arrivo();
    trascinaA(35);
    vaiA(SALVATO);
    expect(basis()).toBeCloseTo(35, 5);
  });

  it('testata al 78%: dopo il salvataggio resta 78%', () => {
    rimonta(NUOVO);
    arrivo();
    vaiA(SALVATO);
    expect(basis()).toBe(78);
  });
});

describe('SXADV-5988 — d. una lista in mezzo smonta la vista', () => {
  it('ritorno con lo stesso ui.path: area ricordata (22%)', () => {
    padreColTabAperto();
    rimonta(PADRE);
    expect(basis()).toBe(22); // gia' alla prima resa
    arrivo();
    expect(dom.active).toBe(pagina().testata);
    expect(basis()).toBe(22);
  });

  it('ritorno con lo stesso ui.path: trascinamento ricordato (35%)', () => {
    padreColTabAperto();
    trascinaA(35);
    rimonta(PADRE);
    arrivo();
    expect(basis()).toBeCloseTo(35, 5);
  });

  it('ingresso con un ui.path diverso: si riparte dal default, 78% dopo focusNewPage', () => {
    padreColTabAperto();
    rimonta({ ...PADRE, path: 'S1-9' });
    expect(basis()).toBe(50);
    arrivo();
    expect(dom.active).toBe(pagina().testata);
    expect(basis()).toBe(78);
  });

  it('un trascinamento su un altro record non si eredita', () => {
    padreColTabAperto();
    trascinaA(35);
    rimonta({ ...PADRE, path: 'S1-9' });
    arrivo();
    expect(basis()).toBe(78);
  });
});

describe('SXADV-5988 — e. il fuoco che torna da solo sul campo dell\'arrivo', () => {
  it('cambio di finestra (hasFocus falso) e ritorno sullo stesso campo: resta 22%', () => {
    ritornoAlPadre();
    lasciaFinestra();
    rientraInFinestra();
    expect(dom.active).toBe(pagina().testata);
    expect(basis()).toBe(22);
  });

  it('due cambi di finestra di fila: resta 22%', () => {
    ritornoAlPadre();
    lasciaFinestra();
    rientraInFinestra();
    lasciaFinestra();
    rientraInFinestra();
    expect(basis()).toBe(22);
  });

  it('dopo il cambio di finestra un Tab vero fuori e dentro la testata decide ancora: 78%', () => {
    ritornoAlPadre();
    lasciaFinestra();
    rientraInFinestra();
    tastiera(pagina().campoTab);
    tastiera(pagina().testata);
    expect(basis()).toBe(78);
  });

  it('blur verso .ant-modal-root (dialogo fuori dall\'albero della vista) e ritorno: resta 22%', () => {
    ritornoAlPadre();
    apriDialogo(false);
    tastiera(pagina().testata);
    expect(basis()).toBe(22);
  });

  it('dialogo in un portale figlio della vista: la chiusura ridà il fuoco al campo, resta 22%', () => {
    ritornoAlPadre();
    apriDialogo(true);
    tastiera(pagina().testata);
    expect(basis()).toBe(22);
  });

  it('blur dentro la pagina e Tab di ritorno sullo stesso campo: 78%', () => {
    ritornoAlPadre();
    fuocoSuToolbar();
    expect(basis()).toBe(22);
    tastiera(pagina().testata);
    expect(basis()).toBe(78);
  });
});
