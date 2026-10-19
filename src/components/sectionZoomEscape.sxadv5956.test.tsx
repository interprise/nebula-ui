import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UITree } from '../types/ui';

// SXADV-5956 — vista di dettaglio a due zone (testata + area a tab). Il
// pulsante "Ingrandisce sezione" sulla barra dei tab ingrandisce l'area: la
// testata sparisce (niente .view-split-form) e il tooltip diventa
// "Riduce sezione (Esc)". Col fuoco in un campo di testo dell'area, Esc non
// faceva niente: la guardia di digitazione del dispatcher saltava l'uscita.
//
// Si prova il percorso vero: ViewRenderer → DetailFormView → la sua uscita da
// tastiera, col registro dei tasti (useHotkeyRegistry) e lo stato dello zoom
// (useUiModeStore) VERI, gli stessi che monta UiModeProvider. Niente DOM nei
// test del progetto (né jsdom né testing-library installati), quindi:
//  - un motore di hook minimo al posto di React, come in Shell.*.test.tsx, che
//    però ESEGUE gli effetti (è lì che si registrano i tasti e il listener);
//  - l'albero restituito da DetailFormView si visita come dati: il pulsante si
//    trova per aria-label e si "clicca" chiamandone onClick, la testata si
//    cerca per className, e i componenti dell'albero che registrano tasti
//    (sorgente con `useHotkey`) si eseguono come componenti figli;
//  - window/document finti: il keydown arriva al listener che il registro ha
//    messo su window, con l'elemento finto col fuoco come target. È la fase di
//    bubbling: un handler locale che ha già chiamato preventDefault si simula
//    passando l'evento con defaultPrevented.

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

const { default: ViewRenderer } = await import('./ViewRenderer');
const { useHotkeyRegistry, useHotkey, HotkeyRegistryContext, HotkeyPriority } = await import('../hooks/hotkeys');
const { useUiModeStore, UiModeStoreContext, ZoomScopeContext, PANEL_ZOOM_ID } = await import('../hooks/uiMode');

/* ── Browser finto ──────────────────────────────────────────────────────── */

type Listener = (e: unknown) => void;
const keyListeners = new Set<Listener>();
const browser = { overlay: false };

Object.assign(globalThis, {
  window: {
    addEventListener: (type: string, l: Listener) => { if (type === 'keydown') keyListeners.add(l); },
    removeEventListener: (type: string, l: Listener) => { if (type === 'keydown') keyListeners.delete(l); },
    setTimeout: (f: () => void) => { f(); return 0; },
    clearTimeout: () => {},
  },
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
});
Object.assign(globalThis, {
  document: {
    body: { style: {} },
    activeElement: null,
    getElementById: () => null,
    // Misura delle etichette: nessun canvas, ViewRenderer stima dai caratteri.
    createElement: () => ({ getContext: () => null, style: {} }),
    // Un overlay antd aperto: qualunque selettore che nomini il dropdown della Select.
    querySelector: (sel: string) =>
      browser.overlay && sel.includes('.ant-select-dropdown:not(.ant-select-dropdown-hidden)') ? {} : null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  },
});

type Fake = { tagName: string; isContentEditable: boolean; closest: (sel: string) => unknown };
function elemento(tagName: string, dentro: string[] = []): Fake {
  return {
    tagName,
    isContentEditable: false,
    closest: (sel: string) =>
      sel.split(',').map((s) => s.trim()).some((s) => dentro.includes(s)) ? {} : null,
  };
}
const CAMPO_TESTO = () => elemento('INPUT', ['.view-split-bottom', '.tab-content']);
const AREA_TESTO = () => elemento('TEXTAREA', ['.view-split-bottom', '.tab-content']);
const BOTTONE = () => elemento('BUTTON', ['.view-split-bottom']);
const RIGA_GRIGLIA = () => elemento('DIV', ['.ag-row', '.view-split-bottom']);
const EDITOR_CELLA = () => elemento('INPUT', ['.ag-cell-inline-editing', '.ag-row', '.view-split-bottom']);

interface Evento {
  key: string; target: unknown; isComposing: boolean; repeat: boolean;
  ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean;
  defaultPrevented: boolean; preventDefault: () => void; stopPropagation: () => void;
}
/** keydown Escape col fuoco su `target`, risalito fino a window. */
function premiEsc(target: unknown, init: Partial<Evento> = {}): Evento {
  const e: Evento = {
    key: 'Escape', target, isComposing: false, repeat: false,
    ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
    defaultPrevented: false,
    preventDefault() { e.defaultPrevented = true; },
    stopPropagation() {},
    ...init,
  };
  for (const l of [...keyListeners]) l(e);
  render();
  return e;
}

/* ── Applicazione: provider veri + vista ────────────────────────────────── */

const SCOPE = 'S1|ordiniDetail';

/** Dettaglio a due zone: una riga di testata (campo con group, quindi riga di
 *  testata) e in coda un Tab, il cui contenuto ha un campo di testo e una
 *  textarea — il caso del ticket. */
function vista(): UITree {
  return {
    viewName: 'ordiniDetail',
    pageType: 2,
    path: 'S1-1',
    title: 'Ordine',
    rows: [
      { id: 'h0', cells: [
        { elementType: 0, prompt: 'Numero:' },
        { elementType: 1, control: { type: 'text', name: 'numero', id: 'numero', group: 'testata', value: '12' } },
      ] },
      { id: 'b0', cells: [{
        elementType: 1,
        control: {
          type: 'tab', name: 'schede', id: 'schede', controlName: 'schede', navpath: 'S1-1',
          tabs: [{ name: 'generale', prompt: 'Generale', selected: true }],
          contentRows: [
            { id: 'c0', cells: [
              { elementType: 0, prompt: 'Riferimento:' },
              { elementType: 1, control: { type: 'text', name: 'riferimento', id: 'riferimento' } },
            ] },
            { id: 'c1', cells: [
              { elementType: 0, prompt: 'Note:' },
              { elementType: 1, control: { type: 'textarea', name: 'note', id: 'note' } },
            ] },
          ],
        },
      }] },
    ],
  } as unknown as UITree;
}

const nuova = (): Inst => ({ slots: [], i: 0, effects: [], ei: 0 });

function esegui<T>(inst: Inst, fn: () => T): T {
  const prev = rt.inst;
  rt.inst = inst;
  inst.i = 0;
  inst.ei = 0;
  rt.active++;
  let out: T;
  try { out = fn(); } finally { rt.active--; rt.inst = prev; }
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

/** Componenti dell'albero che registrano tasti: si eseguono come figli. */
const registraTasti = (t: unknown) =>
  typeof t === 'function' && t.toString().includes('useHotkey');

let app: {
  registry: Inst; store: Inst; view: Inst; extra: Inst;
  figli: Map<unknown, Inst>;
  tree: unknown;
  storeValue: ReturnType<typeof useUiModeStore>;
  pannello: { aperto: boolean; chiusure: number };
};

function render(): void {
  for (let pass = 0; pass < 30; pass++) {
    rt.dirty = false;
    const reg = esegui(app.registry, () => useHotkeyRegistry());
    (HotkeyRegistryContext as unknown as { _currentValue: unknown })._currentValue = reg;
    app.storeValue = esegui(app.store, () => useUiModeStore());
    (UiModeStoreContext as unknown as { _currentValue: unknown })._currentValue = app.storeValue;
    (ZoomScopeContext as unknown as { _currentValue: unknown })._currentValue = SCOPE;
    // Pannello di modifica di una lista listEdit (priorità editPanel), quando aperto.
    esegui(app.extra, () => useHotkey('Escape', () => {
      app.pannello.chiusure++;
      app.pannello.aperto = false;
      rt.dirty = true;
    }, { priority: HotkeyPriority.editPanel, allowWhileTyping: true, enabled: app.pannello.aperto }));

    app.tree = esegui(app.view, () => {
      const el = (ViewRenderer as unknown as (p: unknown) => El)({
        ui: vista(), onAction: () => {}, onChange: () => {}, onGridChange: () => {},
      });
      return typeof el?.type === 'function' ? (el.type as (p: unknown) => unknown)(el.props) : el;
    });

    const visti = new Set<unknown>();
    visita(app.tree, (el) => {
      if (!registraTasti(el.type) || visti.has(el.type)) return;
      visti.add(el.type);
      let inst = app.figli.get(el.type);
      if (!inst) { inst = nuova(); app.figli.set(el.type, inst); }
      esegui(inst, () => (el.type as (p: unknown) => unknown)(el.props));
    });
    for (const [t, inst] of app.figli) {
      if (!visti.has(t)) { smonta(inst); app.figli.delete(t); }
    }
    if (!rt.dirty) return;
  }
  throw new Error('render: non si stabilizza');
}

/* ── Interrogazioni sull'albero ─────────────────────────────────────────── */

function cerca(pred: (el: El) => boolean): El[] {
  const out: El[] = [];
  visita(app.tree, (el) => { if (pred(el)) out.push(el); });
  return out;
}
const conClasse = (cls: string) => (el: El) =>
  typeof el.props.className === 'string' && el.props.className.split(/\s+/).includes(cls);
const testataVisibile = () => cerca(conClasse('view-split-form')).length > 0;
const pulsante = (label: string) => cerca((el) => el.props['aria-label'] === label);
const zoomCorrente = () => app.storeValue.zoomByScope[SCOPE] ?? null;

function ingrandisciSezione(): void {
  const [b] = pulsante('Ingrandisce sezione');
  expect(b, 'pulsante "Ingrandisce sezione" sulla barra dei tab').toBeDefined();
  (b.props.onClick as () => void)();
  render();
  expect(zoomCorrente()).toBe(PANEL_ZOOM_ID);
  expect(testataVisibile()).toBe(false);
  expect(pulsante('Riduce sezione (Esc)')).toHaveLength(1);
}

function zoomGriglia(id = 'righeOrdineList'): void {
  app.storeValue.setZoomForScope(SCOPE, id);
  render();
  expect(zoomCorrente()).toBe(id);
  expect(testataVisibile()).toBe(false);
}

beforeEach(() => {
  keyListeners.clear();
  browser.overlay = false;
  app = {
    registry: nuova(), store: nuova(), view: nuova(), extra: nuova(),
    figli: new Map(), tree: null,
    storeValue: undefined as unknown as ReturnType<typeof useUiModeStore>,
    pannello: { aperto: false, chiusure: 0 },
  };
  render();
});

afterEach(() => {
  for (const inst of [app.extra, ...app.figli.values(), app.view, app.store, app.registry]) smonta(inst);
});

/* ── Prove ──────────────────────────────────────────────────────────────── */

describe('fixture (prerequisito)', () => {
  it('la vista si apre a due zone, testata visibile e pulsante d\'ingrandimento', () => {
    expect(testataVisibile()).toBe(true);
    expect(pulsante('Ingrandisce sezione')).toHaveLength(1);
    expect(zoomCorrente()).toBeNull();
    expect(keyListeners.size).toBe(1);
  });
});

describe('SXADV-5956 — Esc riduce la sezione ingrandita', () => {
  it('1a. fuoco in un <input> di testo dell\'area: Esc toglie lo zoom e la testata torna', () => {
    ingrandisciSezione();
    const e = premiEsc(CAMPO_TESTO());
    expect(zoomCorrente()).toBeNull();
    expect(testataVisibile()).toBe(true);
    expect(pulsante('Ingrandisce sezione')).toHaveLength(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('1b. fuoco in una <textarea>: Esc toglie lo zoom', () => {
    ingrandisciSezione();
    premiEsc(AREA_TESTO());
    expect(zoomCorrente()).toBeNull();
    expect(testataVisibile()).toBe(true);
  });

  it('2a. fuoco su un bottone: Esc toglie lo zoom (già funzionava)', () => {
    ingrandisciSezione();
    premiEsc(BOTTONE());
    expect(zoomCorrente()).toBeNull();
    expect(testataVisibile()).toBe(true);
  });

  it('2b. fuoco su una riga di griglia: Esc toglie lo zoom (già funzionava)', () => {
    ingrandisciSezione();
    premiEsc(RIGA_GRIGLIA());
    expect(zoomCorrente()).toBeNull();
  });

  it('3. fuoco nell\'editor di cella AG Grid: Esc è dell\'editor, lo zoom resta', () => {
    ingrandisciSezione();
    premiEsc(EDITOR_CELLA());
    expect(zoomCorrente()).toBe(PANEL_ZOOM_ID);
    expect(testataVisibile()).toBe(false);
  });

  it('4. composizione IME in corso (isComposing): lo zoom resta', () => {
    ingrandisciSezione();
    premiEsc(CAMPO_TESTO(), { isComposing: true });
    expect(zoomCorrente()).toBe(PANEL_ZOOM_ID);
    // finita la composizione, la Esc successiva riduce
    premiEsc(CAMPO_TESTO());
    expect(zoomCorrente()).toBeNull();
  });

  it('5. un handler locale ha già fermato Esc (preventDefault, es. combo che ripristina): lo zoom resta', () => {
    ingrandisciSezione();
    premiEsc(CAMPO_TESTO(), { defaultPrevented: true });
    expect(zoomCorrente()).toBe(PANEL_ZOOM_ID);
  });

  it('6. overlay antd aperto (dropdown di una Select): Esc è dell\'overlay, lo zoom resta', () => {
    ingrandisciSezione();
    browser.overlay = true;
    premiEsc(CAMPO_TESTO());
    expect(zoomCorrente()).toBe(PANEL_ZOOM_ID);
    premiEsc(BOTTONE());
    expect(zoomCorrente()).toBe(PANEL_ZOOM_ID);
    // chiuso l'overlay, Esc torna a ridurre
    browser.overlay = false;
    premiEsc(CAMPO_TESTO());
    expect(zoomCorrente()).toBeNull();
  });

  it('8. pannello di modifica aperto (editPanel, allowWhileTyping): la prima Esc chiude solo lui', () => {
    ingrandisciSezione();
    app.pannello.aperto = true;
    render();
    premiEsc(CAMPO_TESTO());
    expect(app.pannello.chiusure).toBe(1);
    expect(zoomCorrente()).toBe(PANEL_ZOOM_ID);
    // la pressione dopo riduce la sezione
    premiEsc(CAMPO_TESTO());
    expect(app.pannello.chiusure).toBe(1);
    expect(zoomCorrente()).toBeNull();
  });
});

describe('SXADV-5956 — campo FUORI dall\'area ingrandita (punto 10)', () => {
  // "Cerca nel menu..." della sidebar: un input che non sta in .view-split-bottom.
  const CERCA_MENU = () => elemento('INPUT', ['.app-sidebar']);
  const TEXTAREA_FUORI = () => elemento('TEXTAREA', []);

  it('10a. fuoco nella ricerca del menu: Esc non riduce la sezione', () => {
    ingrandisciSezione();
    premiEsc(CERCA_MENU());
    expect(zoomCorrente()).toBe(PANEL_ZOOM_ID);
    expect(testataVisibile()).toBe(false);
  });

  it('10b. fuoco in una textarea fuori dall\'area: Esc non riduce la sezione', () => {
    ingrandisciSezione();
    premiEsc(TEXTAREA_FUORI());
    expect(zoomCorrente()).toBe(PANEL_ZOOM_ID);
  });

  it('10c. fuoco su un elemento non di digitazione fuori dall\'area (body): Esc riduce, come prima', () => {
    ingrandisciSezione();
    premiEsc(elemento('BODY', []));
    expect(zoomCorrente()).toBeNull();
    expect(testataVisibile()).toBe(true);
  });

  it('10d. fuoco su un bottone fuori dall\'area (toolbar): Esc riduce, come prima', () => {
    ingrandisciSezione();
    premiEsc(elemento('BUTTON', ['.toolbar']));
    expect(zoomCorrente()).toBeNull();
  });
});

describe('SXADV-5956 — zoom di una GRIGLIA: comportamento invariato', () => {
  it('7. fuoco in un input: la rete di sicurezza resta con la guardia di digitazione, lo zoom resta', () => {
    zoomGriglia();
    premiEsc(CAMPO_TESTO());
    expect(zoomCorrente()).toBe('righeOrdineList');
    premiEsc(AREA_TESTO());
    expect(zoomCorrente()).toBe('righeOrdineList');
  });

  it('7b. fuoco su un bottone: la rete di sicurezza toglie lo zoom come prima', () => {
    zoomGriglia();
    premiEsc(BOTTONE());
    expect(zoomCorrente()).toBeNull();
    expect(testataVisibile()).toBe(true);
  });
});
