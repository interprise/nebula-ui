import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerResponse, UITree } from '../types/ui';

// SXADV-5490 — la Shell aggiorna `totals` insieme alle righe (contratto
// CORE/docs/20261027_SXADV-5490_totali_di_colonna.md §4, §5, §6):
//   - lista di primo livello: ListTotals (e il cambio pagina) rispondono
//     `ui.pageOnly` con `ui.totals`: i totali nuovi sostituiscono quelli in
//     cache, come le righe; colonne/intestazioni restano;
//   - `ui.rowUpdate` porta anche lui `ui.totals`: sostituisce;
//   - lista incorporata: `ui.detailPageOnly` con `ui.totals`; i totali
//     vanno nel `control.totals` della griglia incorporata con quel path.
//
// Impianto copiato da Shell.locateRow.sxadv4569.test.ts (motore di hook,
// effetti spenti, processResponseInner riconosciuto dal sorgente). Lo stato
// delle schede si legge dallo slot di `tabs` (l'array con la scheda tab_1).
//
// Non detto dal contratto, e quindi NON provato: che cosa succede a `totals`
// quando una risposta pageOnly/rowUpdate NON lo porta (lista senza colonne
// totalizzabili: describe = null). Sostituire con undefined e tenere il vecchio
// sono entrambe letture possibili.

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

// Il server: si registra cosa la scheda manda, si risponde quello che il caso
// prepara (di default una risposta vuota, che non tocca la scheda).
const server = vi.hoisted(() => ({
  postAction: [] as { action: string; params: Record<string, string> }[],
  next: [] as unknown[],
  // Risposte del polling di un job (api.checkProgress), in ordine.
  progress: [] as unknown[],
  progressCalls: 0,
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  postAction: async (action: string, params: Record<string, string>) => {
    server.postAction.push({ action, params: { ...params } });
    return server.next.shift() ?? {};
  },
  executeMenuItem: async () => server.next.shift() ?? {},
  subscribeInFlight: () => () => {},
  checkProgress: async () => {
    server.progressCalls++;
    return server.progress.shift() ?? {};
  },
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

/** Un disegno della Shell: aggiorna le chiusure dei gestori. */
function render(): void {
  rt.active = true;
  rt.i = 0;
  rt.callbacks = [];
  try {
    (Shell as unknown as (p: typeof props) => unknown)(props);
  } finally {
    rt.active = false;
  }
  // L'effetto `handleActionRef.current = handleAction`, fatto a mano a ogni
  // disegno: la ref si riconosce dal valore iniziale (una funzione vuota).
  const ha = handleAction();
  refSlot ??= rt.slots.find((sl) => {
    const v = sl.v as { current?: unknown } | null;
    return !!v && typeof v === 'object' && 'current' in v && typeof v.current === 'function'
      && /^async\(\)=>(undefined|void0)$/.test(String(v.current).replace(/\s+/g, ''));
  });
  if (!refSlot) throw new Error('handleActionRef non trovata');
  (refSlot.v as { current: unknown }).current = ha;
}

/** Lo slot di handleActionRef, trovato al primo disegno. */
let refSlot: { v: unknown } | undefined;

/** Il gestore della Shell riconosciuto da un pezzo del suo sorgente. */
function handler<F>(marker: string): F {
  const found = rt.callbacks.filter((f) => f.toString().includes(marker));
  if (found.length !== 1) throw new Error(`gestore "${marker}": trovati ${found.length}`);
  return found[0] as unknown as F;
}

const processResponseInner = () =>
  handler<(tabKey: string, resp: ServerResponse) => void>('Sessione scaduta. Effettuare nuovamente il login.');
const handleAction = () =>
  handler<(action: string, params?: Record<string, string>) => Promise<unknown>>('serverParams.hasTemplate = ');

function arriva(resp: unknown): void {
  render();
  processResponseInner()('tab_1', resp as ServerResponse);
  render();
}


// ── fixture ─────────────────────────────────────────────────────────────────
const LIST = 'S1-0';
const EMBED = 'S1-0.0,S1-4';

interface ColTotals { available: boolean; active: string[]; sum?: string; avg?: string }
interface Totals { command: string; path: string; scope?: string; rows?: number; columns: Record<string, ColTotals> }
const tot = (path: string, sum: string | null): Totals => ({
  command: 'ListTotals',
  path,
  ...(sum != null ? { scope: 'page', rows: 2 } : {}),
  columns: { importo: sum != null ? { available: true, active: ['sum'], sum } : { available: true, active: [] } },
});

function riga(pos: number, text: string) {
  return {
    id: `r${pos}`,
    props: { path: `${LIST}.${pos}` },
    cells: [
      { elementType: 5, pos },
      { elementType: 1, text, control: { name: `importo.${LIST}.${pos}`, id: 'importo', type: 'money', value: text } },
    ],
  };
}

/** Lista di primo livello con i totali spenti. */
function lista(totals: Totals = tot(LIST, null)) {
  return {
    ui: {
      rows: [riga(0, '1,00 €'), riga(1, '2,00 €')],
      pageType: 1,
      path: LIST,
      viewName: 'documentiList',
      viewType: 'list',
      headers: [{ text: '' }, { text: 'Importo' }],
      columns: [
        { elementType: 5, selector: { command: 'NavigateDetail', basePath: LIST } },
        { elementType: 1, control: { name: 'importo', id: 'importo', type: 'money' } },
      ],
      paging: { currentPage: 1, totalPages: 2, totalRows: 40 },
      totals,
    },
    toolbar: [],
  };
}

/** Dettaglio con una griglia incorporata (detailView) che porta control.totals. */
function dettaglio(totals: Totals = tot(EMBED, null)) {
  return {
    ui: {
      rows: [{
        id: 'd0',
        cells: [{
          elementType: 1,
          control: {
            name: 'righe', id: 'righe', type: 'detailView', path: EMBED,
            headers: [{ text: 'Importo' }],
            columns: [{ elementType: 1, control: { name: 'importo', id: 'importo', type: 'money' } }],
            rows: [riga(0, '5,00 €')],
            paging: { currentPage: 1, totalPages: 3, totalRows: 60 },
            totals,
          },
        }],
      }],
      pageType: 2,
      path: 'S1-0.0',
      viewName: 'documentiDetail',
      viewType: 'detail',
    },
    toolbar: [],
  };
}

/** La ui che la scheda tab_1 tiene adesso. */
function tabUi(): UITree & { totals?: Totals } {
  const slot = rt.slots.find((s) => Array.isArray(s.v)
    && (s.v as { key?: string }[]).some((t) => t && typeof t === 'object' && t.key === 'tab_1'));
  if (!slot) throw new Error('stato delle schede non trovato');
  const tab = (slot.v as { key: string; ui?: UITree }[]).find((t) => t.key === 'tab_1')!;
  if (!tab.ui) throw new Error('la scheda non ha ui');
  return tab.ui as UITree & { totals?: Totals };
}

/** Il control della griglia incorporata con quel path, ovunque sia. */
function embedded(ui: UITree, path: string): Record<string, unknown> | undefined {
  let found: Record<string, unknown> | undefined;
  const walk = (n: unknown, d = 0) => {
    if (found || !n || typeof n !== 'object' || d > 40) return;
    if (Array.isArray(n)) { n.forEach((x) => walk(x, d + 1)); return; }
    const o = n as Record<string, unknown>;
    if (o.type === 'detailView' && o.path === path) { found = o; return; }
    for (const v of Object.values(o)) walk(v, d + 1);
  };
  walk(ui.rows);
  return found;
}

beforeEach(() => {
  refSlot = undefined;
  rt.slots = [];
  rt.callbacks = [];
  server.postAction = [];
  server.next = [];
  server.progress = [];
  server.progressCalls = 0;
  clearTemplates();
  render();
  const active = rt.slots.find((s) => s.v === 'home');
  active!.v = 'tab_1';
  render();
});

describe('Shell: totals sulle risposte di lista (SXADV-5490)', () => {
  it('impianto: la resa completa mette ui.totals nella scheda', () => {
    arriva(lista());
    expect(tabUi().totals).toEqual(tot(LIST, null));
  });

  it('pageOnly con totals: i totali nuovi sostituiscono quelli in cache', () => {
    arriva(lista());
    const nuovi = tot(LIST, '3,00 €');
    arriva({ ui: { pageOnly: true, path: LIST, rows: [riga(0, '1,00 €'), riga(1, '2,00 €')], paging: { currentPage: 1, totalPages: 2, totalRows: 40 }, totals: nuovi } });
    const ui = tabUi();
    expect(ui.totals).toEqual(nuovi);
    // Il resto resta quello della resa completa.
    expect(ui.headers).toEqual(lista().ui.headers);
    expect(ui.columns).toEqual(lista().ui.columns);
  });

  it('pageOnly con totals spenti dopo totals accesi: si spengono', () => {
    arriva(lista(tot(LIST, '3,00 €')));
    arriva({ ui: { pageOnly: true, path: LIST, rows: [riga(0, '1,00 €')], paging: { currentPage: 2, totalPages: 2, totalRows: 40 }, totals: tot(LIST, null) } });
    expect(tabUi().totals).toEqual(tot(LIST, null));
  });

  it('pageOnly: le righe arrivano insieme ai totali', () => {
    arriva(lista());
    arriva({ ui: { pageOnly: true, path: LIST, rows: [riga(0, '9,00 €')], paging: { currentPage: 2, totalPages: 2, totalRows: 40 }, totals: tot(LIST, '9,00 €') } });
    const ui = tabUi();
    expect(ui.rows).toHaveLength(1);
    expect(ui.totals?.columns.importo.sum).toBe('9,00 €');
  });

  it('rowUpdate con totals: i totali nuovi sostituiscono quelli in cache', () => {
    arriva(lista());
    const nuovi = tot(LIST, '7,00 €');
    arriva({ ui: { rowUpdate: true, path: LIST, position: 1, rows: [riga(1, '6,00 €')], totals: nuovi } });
    const ui = tabUi();
    expect(ui.totals).toEqual(nuovi);
    expect(ui.rows).toHaveLength(2);
  });
});

describe('Shell: totals della griglia incorporata (SXADV-5490)', () => {
  it('impianto: il dettaglio porta control.totals sulla griglia', () => {
    arriva(dettaglio());
    expect(embedded(tabUi(), EMBED)?.totals).toEqual(tot(EMBED, null));
  });

  it('detailPageOnly con ui.totals: vanno nel control.totals della griglia con quel path', () => {
    arriva(dettaglio());
    const nuovi = tot(EMBED, '15,00 €');
    arriva({ ui: { detailPageOnly: true, path: EMBED, rows: [riga(0, '5,00 €')], paging: { currentPage: 1, totalPages: 3, totalRows: 60 }, totals: nuovi } });
    const grid = embedded(tabUi(), EMBED);
    expect(grid).toBeDefined();
    expect(grid!.totals).toEqual(nuovi);
  });

  it('detailPageOnly per un\'altra griglia: i totali di questa non cambiano', () => {
    arriva(dettaglio(tot(EMBED, '1,00 €')));
    arriva({ ui: { detailPageOnly: true, path: 'S1-0.0,S1-9', rows: [], paging: { currentPage: 1, totalPages: 1, totalRows: 0 }, totals: tot('S1-0.0,S1-9', '99,00 €') } });
    expect(embedded(tabUi(), EMBED)?.totals).toEqual(tot(EMBED, '1,00 €'));
  });

  it('detailPageOnly: i totali non finiscono sulla radice della scheda', () => {
    arriva(dettaglio());
    arriva({ ui: { detailPageOnly: true, path: EMBED, rows: [riga(0, '5,00 €')], paging: { currentPage: 1, totalPages: 3, totalRows: 60 }, totals: tot(EMBED, '15,00 €') } });
    expect(tabUi().totals).toBeUndefined();
  });
});
