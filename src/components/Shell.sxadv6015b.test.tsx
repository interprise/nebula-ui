import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerResponse } from '../types/ui';

// SXADV-6015 — griglia multiEdit INCORPORATA in un dettaglio (es. le righe di un
// documento con la colonna di spunta `selected`). La casella mette in formValues
// l'array della colonna `selected.<griglia>`, una voce per riga della pagina a
// schermo della griglia. Il cambio pagina della griglia e' DetailPage (navpath =
// ui.path della griglia, "S1-5.2,S1-8.0"): il server applica l'array alla pagina
// lasciata. Dopo una risposta senza errori l'array e' consumato e non deve restare
// nei formValues ne' partire con la richiesta seguente (sarebbe applicato per
// posizione alla pagina NUOVA). Con un errore la pagina non e' cambiata: resta.
// Prima della correzione Shell lo toglieva solo per NextPage/PrevPage/.../
// SetPageSize/LocateRow/FilterRows/Refresh, non per DetailPage.
//
// Motore di hook copiato da Shell.sxadv6015.test.tsx (niente DOM). Non e' montata
// la griglia: l'array entra da handleGridChange. postAction e' mockato: che l'array
// PARTA davvero col DetailPage (e non sia tolto da withoutPositionalArrays) lo
// prova services/api.postAction.sxadv6015.test.ts.

const domande = vi.hoisted(() => [] as { errors: { type: string; mnemonic?: string }[]; onAnswer: (prompt: unknown, answer: string) => void }[]);

const rt = vi.hoisted(() => ({
  active: false,
  i: 0,
  slots: [] as { v: unknown }[],
  callbacks: [] as ((...a: never[]) => unknown)[],
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
    useCallback: on(actual.useCallback as AnyFn, ((fn: AnyFn) => { rt.callbacks.push(fn); return fn; }) as AnyFn),
    useMemo: on(actual.useMemo as AnyFn, ((f: () => unknown) => f()) as AnyFn),
    useEffect: on(actual.useEffect as AnyFn, (() => {}) as AnyFn),
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

// Hook della Shell che passano da antd o dal browser: estranei alla prova.
vi.mock('../hooks/feedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/feedback')>()),
  useFeedback: () => ({
    showServerMessages: (errors: { type: string; mnemonic?: string }[], handlers?: { onAnswer?: (prompt: unknown, answer: string) => void }) => {
      if (handlers?.onAnswer) domande.push({ errors, onAnswer: handlers.onAnswer });
    },
    error: () => {}, warning: () => {}, info: () => {}, failure: () => {},
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

// Il server: si registra cosa la scheda manda, si risponde quello che il caso
// prepara (di default una risposta vuota, che non tocca la scheda).
const server = vi.hoisted(() => ({
  postAction: [] as { action: string; params: Record<string, string>; fv?: Record<string, string | string[]> }[],
  next: [] as unknown[],
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  postAction: async (action: string, params: Record<string, string>, fv?: Record<string, string | string[]>) => {
    server.postAction.push({ action, params: { ...params }, fv: fv && { ...fv } });
    return server.next.shift() ?? {};
  },
  executeMenuItem: async () => server.next.shift() ?? {},
  subscribeInFlight: () => () => {},
}));

const { default: Shell } = await import('./Shell');
const { clearTemplates } = await import('../services/templateCache');

// Il minimo di browser che i gestori toccano (cursore, fuoco). Messo DOPO gli
// import: alcuni moduli, al caricamento, scrivono sul documento se c'e'.
class FakeHTMLElement {}
Object.assign(globalThis, {
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  HTMLElement: (globalThis as { HTMLElement?: unknown }).HTMLElement ?? FakeHTMLElement,
  document: (globalThis as { document?: unknown }).document ?? {
    body: { style: {} },
    activeElement: null,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  },
});



const props = { menuItems: [], loginInfo: { login: '44AMM' }, onLogout: () => {}, onReloadMenu: () => {} };

function render(): void {
  rt.active = true;
  rt.i = 0;
  rt.callbacks = [];
  try {
    (Shell as unknown as (p: typeof props) => unknown)(props);
  } finally {
    rt.active = false;
  }
}

function handler<F>(marker: string): F {
  const found = rt.callbacks.filter((f) => f.toString().includes(marker));
  if (found.length !== 1) throw new Error(`gestore "${marker}": trovati ${found.length}`);
  return found[0] as unknown as F;
}

const processResponseInner = () =>
  handler<(tabKey: string, resp: ServerResponse) => void>('Sessione scaduta. Effettuare nuovamente il login.');
const handleAction = () =>
  handler<(action: string, params?: Record<string, string>) => Promise<void>>('serverParams.hasTemplate = ');

function arriva(resp: unknown): void {
  render();
  processResponseInner()('tab_1', resp as ServerResponse);
  render();
}

const handleGridChange = () =>
  handler<(name: string, values: string[]) => void>('tab.formValues[name] = values');

const DETTAGLIO = 'S1-5';
const GRIGLIA = 'S1-8';
const GRID_PATH = `${DETTAGLIO}.2,${GRIGLIA}.0`;
const CAMPO = `selected.${GRIGLIA}`;

function riga(pos: number): unknown {
  return { id: `r${pos}`, cells: [{ elementType: 1, pos, control: { type: 'boolean', name: 'selected', id: `s${pos}` } }] };
}

function righe(da: number, quante: number): unknown[] {
  return Array.from({ length: quante }, (_, i) => riga(da + i));
}

/** Apertura del dettaglio: resa intera, con dentro la griglia. */
function dettaglio(): unknown {
  return {
    ui: {
      viewName: 'documentiDetail',
      viewType: 'detail',
      pageType: 2,
      path: `${DETTAGLIO}.2`,
      rows: [
        {
          id: 'g',
          cells: [
            {
              elementType: 1,
              control: {
                type: 'list',
                name: 'righe',
                id: 'righe',
                path: GRID_PATH,
                multiEdit: true,
                listEdit: true,
                rows: righe(0, 3),
                paging: { page: 1, pages: 3 },
              },
            },
          ],
        },
      ],
    },
    toolbar: [],
  };
}

/** Risposta di DetailPage: la sola pagina della griglia. */
function paginaGriglia(da: number, quante: number, page: number): unknown {
  return {
    ui: {
      detailPageOnly: true,
      path: `${DETTAGLIO}.2,${GRIGLIA}.${da}`,
      rows: righe(da, quante),
      paging: { page, pages: 3 },
    },
  };
}

async function esegui(action: string, params: Record<string, string> = {}) {
  render();
  await handleAction()(action, params);
  render();
  const last = server.postAction.at(-1);
  expect(last?.action).toBe(action);
  return last!;
}

function spunta(values: string[], campo = CAMPO): void {
  render();
  handleGridChange()(campo, values);
  render();
}

beforeEach(() => {
  rt.slots = [];
  rt.callbacks = [];
  server.postAction = [];
  server.next = [];
  domande.length = 0;
  clearTemplates();
  render();
  const active = rt.slots.find((s) => s.v === 'home');
  active!.v = 'tab_1';
  render();
  arriva(dettaglio());
});

const ERRORE = { errors: [{ type: 'ERROR', message: 'no', mnemonic: 'X' }] };
const CONFERMA = { errors: [{ type: 'CONFIRMATION', message: 'sicuro?', mnemonic: 'CONFERMA' }] };

const PAGINE: [string, Record<string, string>][] = [
  ['page=2', { page: '2' }],
  ['dir=next', { dir: 'next' }],
];

describe('SXADV-6015: DetailPage su una griglia incorporata multiEdit', () => {
  it.each(PAGINE)('%s porta l\'array della pagina a schermo', async (_n, p) => {
    spunta(['false', 'true', 'false']);
    server.next.push(paginaGriglia(3, 3, 2));
    const sent = await esegui('DetailPage', { navpath: GRID_PATH, ...p });
    expect(sent.fv?.[CAMPO]).toEqual(['false', 'true', 'false']);
  });

  it.each(PAGINE)('%s senza errori: l\'array non parte con la richiesta seguente', async (_n, p) => {
    spunta(['false', 'true', 'false']);
    server.next.push(paginaGriglia(3, 3, 2));
    await esegui('DetailPage', { navpath: GRID_PATH, ...p });
    const dopo = await esegui('Save');
    expect(dopo.fv?.[CAMPO]).toBeUndefined();
  });

  it('senza errori: l\'array non parte neanche col DetailPage seguente', async () => {
    spunta(['false', 'true', 'false']);
    server.next.push(paginaGriglia(3, 3, 2));
    await esegui('DetailPage', { navpath: GRID_PATH, page: '2' });
    const dopo = await esegui('DetailPage', { navpath: `${DETTAGLIO}.2,${GRIGLIA}.3`, page: '3' });
    expect(dopo.fv?.[CAMPO]).toBeUndefined();
  });

  it('senza errori: un campo battuto dopo non fa rinascere l\'array', async () => {
    spunta(['false', 'true', 'false']);
    server.next.push(paginaGriglia(3, 3, 2));
    await esegui('DetailPage', { navpath: GRID_PATH, page: '2' });
    render();
    handler<(name: string, value: unknown) => void>('tab.formValues[name] = stored')(`note.${DETTAGLIO}`, 'x');
    const dopo = await esegui('Save');
    expect(dopo.fv?.[`note.${DETTAGLIO}`]).toBe('x');
    expect(dopo.fv?.[CAMPO]).toBeUndefined();
  });

  it('una spunta sulla pagina nuova parte, con la lunghezza della pagina nuova', async () => {
    spunta(['false', 'true', 'false']);
    server.next.push(paginaGriglia(3, 2, 2));
    await esegui('DetailPage', { navpath: GRID_PATH, page: '2' });
    spunta(['true', 'false']);
    const dopo = await esegui('Save');
    expect(dopo.fv?.[CAMPO]).toEqual(['true', 'false']);
  });

  it('toglie solo gli array di quella griglia', async () => {
    spunta(['x', 'y'], 'selected.S1-99');
    spunta(['false', 'true', 'false']);
    server.next.push(paginaGriglia(3, 3, 2));
    await esegui('DetailPage', { navpath: GRID_PATH, page: '2' });
    const dopo = await esegui('Save');
    expect(dopo.fv?.['selected.S1-99']).toEqual(['x', 'y']);
  });

  it('con un ERROR la pagina non e\' cambiata: l\'array resta', async () => {
    spunta(['false', 'true', 'false']);
    server.next.push(ERRORE);
    await esegui('DetailPage', { navpath: GRID_PATH, page: '2' });
    const dopo = await esegui('Save');
    expect(dopo.fv?.[CAMPO]).toEqual(['false', 'true', 'false']);
  });

  it('con una CONFIRMATION l\'array resta per il rigioco', async () => {
    spunta(['false', 'true', 'false']);
    server.next.push(CONFERMA);
    await esegui('DetailPage', { navpath: GRID_PATH, page: '2' });
    const dopo = await esegui('Save');
    expect(dopo.fv?.[CAMPO]).toEqual(['false', 'true', 'false']);
  });
});
