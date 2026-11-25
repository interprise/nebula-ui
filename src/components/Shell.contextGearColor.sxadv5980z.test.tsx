// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import * as ReactReal from 'react';
import { createRoot, type Root } from 'react-dom/client';

// SXADV-5980.z — durante il cambio di Azienda o Sede l'ingranaggio che gira
// (strato role="status", contenitore .context-change-gear) ha un colore FISSO:
// var(--app-context-gear), un grigio neutro che si legge sia sul chiaro sia
// sullo scuro (oggi l'area sotto l'ingranaggio e' sempre bianca, anche con
// data-theme="dark"; il tema scuro non e' ancora acceso). Non deve prendere il
// colore di testata dell'azienda da cui si parte (loginInfo.bkColor): con
// un'azienda rossa sembrava un errore. La testata invece continua a seguire
// bkColor.
//
// Motore: lo stesso di Shell.headerSelect.sxadv6137.test.tsx. La Shell si
// esegue come funzione con hook finti; si chiama l'onChange del selettore di
// testata (la promise di postAction2 resta pendente), si riesegue la Shell
// con lo stesso stato e dall'albero si prende lo strato dell'ingranaggio, che
// si monta con React vero in jsdom per leggerne lo stile inline.

const rt = vi.hoisted(() => ({
  active: false,
  i: 0,
  slots: [] as { v: unknown }[],
  effects: [] as (() => unknown)[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  type AnyFn = (...a: never[]) => unknown;
  const slot = (init: () => unknown) => {
    const i = rt.i++;
    if (!rt.slots[i]) rt.slots[i] = { v: init() };
    return rt.slots[i];
  };
  const on = <F extends AnyFn>(real: F, fake: AnyFn): F =>
    ((...a: never[]) => (rt.active ? fake(...a) : real(...a))) as unknown as F;
  const over = {
    useState: on(actual.useState as AnyFn, ((init: unknown) => {
      const s = slot(() => (typeof init === 'function' ? (init as () => unknown)() : init));
      const set = (nv: unknown) => {
        s.v = typeof nv === 'function' ? (nv as (p: unknown) => unknown)(s.v) : nv;
      };
      return [s.v, set];
    }) as AnyFn),
    useReducer: on(actual.useReducer as AnyFn, ((reducer: (s: unknown, a: unknown) => unknown, init: unknown) => {
      const s = slot(() => init);
      return [s.v, (a: unknown) => { s.v = reducer(s.v, a); }];
    }) as AnyFn),
    useRef: on(actual.useRef as AnyFn, ((init: unknown) => slot(() => ({ current: init })).v) as AnyFn),
    useCallback: on(actual.useCallback as AnyFn, ((fn: AnyFn) => fn) as AnyFn),
    useMemo: on(actual.useMemo as AnyFn, ((f: () => unknown) => f()) as AnyFn),
    useEffect: on(actual.useEffect as AnyFn, ((fn: () => unknown) => { rt.effects.push(fn); }) as AnyFn),
    useLayoutEffect: on(actual.useLayoutEffect as AnyFn, (() => {}) as AnyFn),
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

vi.mock('../hooks/feedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/feedback')>()),
  useFeedback: () => ({
    showServerMessages: () => {}, error: () => {}, warning: () => {}, info: () => {}, failure: () => {},
  }),
}));
vi.mock('../hooks/uiMode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/uiMode')>()),
  useUiMode: () => ({ immersive: false, setImmersive: () => {} }),
}));
vi.mock('../hooks/density', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/density')>()),
  useDensity: () => ({ density: 'normal', setDensity: () => {} }),
}));
vi.mock('../hooks/hotkeys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/hotkeys')>()),
  useHotkey: () => {},
}));
vi.mock('./BannerCard', () => ({ default: () => null }));
vi.mock('./CdmsTree', () => ({ default: () => null }));

const server = vi.hoisted(() => ({
  postAction2: [] as { action: string; params: Record<string, string> }[],
  pending: [] as ((v: unknown) => void)[],
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  postAction: async () => ({}),
  executeMenuItem: async () => ({}),
  // CambioAzienda / CambioSede restano pendenti finche' il test non le risolve.
  postAction2: (action: string, params: Record<string, string>) => {
    server.postAction2.push({ action, params: { ...params } });
    return new Promise((resolve) => { server.pending.push(resolve); });
  },
  subscribeInFlight: () => () => {},
}));

const { default: Shell } = await import('./Shell');
const { HeaderContextSelect } = await import('./HeaderContextSelect');
const { act } = ReactReal;

type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } };

const AZIENDE = [
  { value: '44', text: '44 - C.N.A. SERVIZI MODENA SRL' },
  { value: '45', text: '45 - C.N.A. SERVIZI REGGIO EMILIA' },
];
const SEDI = [
  { value: '01', text: '01 - SEDE CENTRALE' },
  { value: '02', text: '02 - FILIALE CARPI' },
];

const FIXED = 'var(--app-context-gear)';

function shellProps(loginInfo: Record<string, unknown>) {
  return {
    menuItems: [],
    loginInfo: { login: '44AMM', profile: 'AMM', customerKey: '44', sede: '01', aziende: AZIENDE, sedi: SEDI, ...loginInfo },
    onLogout: () => {},
    onReloadMenu: () => {},
  };
}

let tree: unknown;

/** Esegue la Shell. `fresh` azzera lo stato (primo giro); altrimenti lo riusa. */
function render(p: ReturnType<typeof shellProps>, fresh = true): void {
  if (fresh) rt.slots = [];
  rt.active = true;
  rt.i = 0;
  rt.effects = [];
  try {
    tree = (Shell as unknown as (p: unknown) => unknown)(p);
  } finally {
    rt.active = false;
  }
}

function elements(node: unknown, out: El[] = []): El[] {
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const n of node) elements(n, out);
    return out;
  }
  const el = node as El;
  if ((el as unknown as { $$typeof?: unknown }).$$typeof !== undefined && el.props) {
    out.push(el);
    elements(el.props.children, out);
  }
  return out;
}

const selettori = () => elements(tree).filter((e) => e.type === HeaderContextSelect);
const stratoCambio = () =>
  elements(tree).filter((e) => e.props.role === 'status' && e.props['aria-label'] === 'Cambio di azienda o sede in corso');

let root: Root | null = null;
let box: HTMLElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((q: string) => ({
    matches: false, media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});

beforeEach(() => {
  rt.slots = [];
  server.postAction2 = [];
  server.pending = [];
});

afterEach(async () => {
  act(() => { root?.unmount(); });
  root = null;
  box?.remove();
  box = null;
  // Chiude le richieste rimaste aperte, per non lasciare promise pendenti.
  for (const r of server.pending.splice(0)) r({});
  await new Promise((r) => setTimeout(r, 0));
});

/** Monta con React vero un elemento costruito dalla Shell. */
function monta(el: El): HTMLElement {
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => {
    root!.render(ReactReal.createElement(el.type as ReactReal.ComponentType<Record<string, unknown>>, el.props));
  });
  return box;
}

/**
 * Il colore inline dell'ingranaggio: quello dell'elemento piu' vicino all'svg
 * (svg compreso), dentro .context-change-gear, che dichiara un colore.
 */
function coloreIngranaggio(container: HTMLElement): string {
  const gear = container.querySelector<HTMLElement>('.context-change-gear');
  expect(gear, 'contenitore .context-change-gear presente').not.toBeNull();
  const svg = gear!.querySelector('span.anticon svg');
  expect(svg, 'icona antd (span.anticon > svg) dentro .context-change-gear').not.toBeNull();
  let n: Element | null = svg;
  while (n && n !== gear!.parentElement) {
    const c = (n as HTMLElement).style?.color;
    if (c) return c;
    n = n.parentElement;
  }
  return '';
}

type Cambio = 'azienda' | 'sede';

/** Avvia il cambio dal selettore e torna il colore dell'ingranaggio a schermo. */
function avviaCambio(bkColor: string | undefined, quale: Cambio): string {
  const p = shellProps(bkColor === undefined ? {} : { bkColor });
  render(p);
  expect(stratoCambio(), 'prima del cambio nessun ingranaggio').toHaveLength(0);
  const s = selettori();
  expect(s).toHaveLength(2);
  const [sel, nuovo] = quale === 'azienda' ? [s[0], '45'] : [s[1], '02'];
  (sel.props.onChange as (v: string) => void)(nuovo);
  render(p, false);
  const strato = stratoCambio();
  expect(strato, 'strato del cambio a schermo mentre la richiesta e\' pendente').toHaveLength(1);
  return coloreIngranaggio(monta(strato[0]));
}

const BK = ['#4D9C35', '#800080', 'FF0000', '#CC0000', undefined] as const;

describe('SXADV-5980.z — ingranaggio del cambio azienda/sede: colore fisso', () => {
  it('il cambio di azienda chiama CambioAzienda e mostra lo strato con l\'ingranaggio', () => {
    avviaCambio('#4D9C35', 'azienda');
    expect(server.postAction2.map((c) => c.action)).toEqual(['CambioAzienda']);
  });

  it('CambioAzienda: l\'ingranaggio ha il colore fisso var(--app-context-gear)', () => {
    expect(avviaCambio('#CC0000', 'azienda')).toBe(FIXED);
  });

  it('CambioSede: l\'ingranaggio ha il colore fisso var(--app-context-gear)', () => {
    const c = avviaCambio('#CC0000', 'sede');
    expect(server.postAction2.map((x) => x.action)).toEqual(['CambioSede']);
    expect(c).toBe(FIXED);
  });

  for (const quale of ['azienda', 'sede'] as Cambio[]) {
    it(`${quale}: bkColor diversi danno lo stesso colore d'ingranaggio, che non contiene il bkColor`, () => {
      const colori: string[] = [];
      for (const bk of BK) {
        const c = avviaCambio(bk, quale);
        // smonta e chiude la richiesta prima della Shell successiva
        act(() => { root?.unmount(); });
        root = null; box?.remove(); box = null;
        for (const r of server.pending.splice(0)) r({});
        colori.push(c);
        if (bk) {
          // jsdom scrive i colori come rgb(...): si confronta in quella forma
          const h = bk.replace('#', '');
          const rgb = `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
          expect(c.toLowerCase(), `bkColor ${bk} non deve finire nell'ingranaggio`).not.toContain(rgb);
          expect(c.toLowerCase()).not.toContain(h.toLowerCase());
        }
      }
      expect(new Set(colori).size, `colori visti: ${colori.join(', ')}`).toBe(1);
      expect(colori[0]).toBe(FIXED);
    });
  }
});

describe('SXADV-5980.z — la testata segue ancora bkColor', () => {
  const sfondiCon = (atteso: string) =>
    elements(tree).filter((e) => {
      const st = e.props.style as { background?: unknown } | undefined;
      return typeof st?.background === 'string' && st.background.toLowerCase() === atteso.toLowerCase();
    });

  for (const [bk, atteso] of [['#800080', '#800080'], ['FF0000', '#FF0000'], ['#4D9C35', '#4D9C35']] as const) {
    it(`bkColor ${bk}: banda di testata e testata del menu hanno sfondo ${atteso}`, () => {
      render(shellProps({ bkColor: bk }));
      // la Header e la banda in cima al menu laterale
      expect(sfondiCon(atteso).length).toBeGreaterThanOrEqual(2);
    });

    it(`bkColor ${bk}: anche durante il cambio la testata resta ${atteso}`, () => {
      const p = shellProps({ bkColor: bk });
      render(p);
      (selettori()[0].props.onChange as (v: string) => void)('45');
      render(p, false);
      expect(stratoCambio()).toHaveLength(1);
      expect(sfondiCon(atteso).length).toBeGreaterThanOrEqual(2);
    });
  }
});

describe('SXADV-5980.z — fine della richiesta: l\'ingranaggio sparisce', () => {
  for (const quale of ['azienda', 'sede'] as Cambio[]) {
    it(`${quale}: risolta la richiesta, lo strato del cambio non c'e' piu'`, async () => {
      const p = shellProps({ bkColor: '#CC0000' });
      render(p);
      const s = selettori();
      const [sel, nuovo] = quale === 'azienda' ? [s[0], '45'] : [s[1], '02'];
      (sel.props.onChange as (v: string) => void)(nuovo);
      render(p, false);
      expect(stratoCambio()).toHaveLength(1);
      expect(server.pending).toHaveLength(1);
      server.pending.shift()!({});
      await new Promise((r) => setTimeout(r, 0));
      render(p, false);
      expect(stratoCambio()).toHaveLength(0);
    });
  }
});

describe('SXADV-5980.z — il token --app-context-gear in tokens.css', () => {
  // Letto come testo: in jsdom le custom property non si risolvono.
  const blocco = (css: string, selettore: string): string => {
    const i = css.indexOf(selettore + ' {');
    expect(i, `blocco ${selettore} presente in tokens.css`).toBeGreaterThanOrEqual(0);
    const fine = css.indexOf('}', i);
    return css.slice(i, fine);
  };
  const leggi = async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    // vitest gira dalla cartella entrasp-ui; ?raw sui .css torna vuoto (css disattivato)
    const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
    // via i commenti, che potrebbero nominare il token senza definirlo
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
  };

  it('--app-context-gear e\' definito in :root', async () => {
    const root = blocco(await leggi(), ':root');
    expect(root).toMatch(/--app-context-gear\s*:\s*[^;]+;/);
  });

  // Il valore conta quanto il nome: un token rosso farebbe tornare il difetto.
  // Ogni definizione del token (in qualunque blocco, tema scuro compreso) deve
  // essere un grigio neutro con contrasto >= 3:1 (WCAG 1.4.11, elemento
  // grafico) su tutti gli sfondi che puo' avere sotto: bianco dell'area,
  // riquadro di benvenuto della Home (#f0f7ff -> #e6f4ff), quasi nero.
  const lum = (hex: string) => {
    const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrasto = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };

  it('ogni definizione di --app-context-gear e\' un grigio neutro leggibile su chiaro e scuro', async () => {
    const defs = [...(await leggi()).matchAll(/--app-context-gear\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(defs.length).toBeGreaterThanOrEqual(1);
    for (const v of defs) {
      const m = /^#([0-9a-f]{6})$/i.exec(v);
      expect(m, `valore ${v}: atteso #rrggbb`).not.toBeNull();
      const hex = m![1].toLowerCase();
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${v} non e' un grigio neutro`).toBeLessThanOrEqual(8);
      for (const sfondo of ['ffffff', 'f0f7ff', 'e6f4ff', 'f5f5f5', '141414']) {
        expect(contrasto(hex, sfondo), `${v} su #${sfondo}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
