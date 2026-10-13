import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerResponse, UITree } from '../types/ui';

// La chiave del template di una scheda descrive la videata a schermo, e la
// scheda la rimanda al server (`templateKey=`) a ogni richiesta perche' possa
// rispondere a soli dati. Una RESA COMPLETA (legacy: `ui` senza `dataOnly`, non
// una pezza di riga/pagina, nessun `templateKey` in radice) non viene da un
// template: dopo di lei la scheda deve dimenticare chiave, bindings e
// scopePaths della videata di prima.
//
// Il difetto visto: scheda ripristinata dopo F5 come dettaglio a due fasi
// (`anagraficheStatisticheDetail:2`), poi dal menu si riapre la funzione, che
// e' un albero (resa completa); il Salva del pannello di destra mandava ancora
// `templateKey=anagraficheStatisticheDetail:2` e il server rispondeva
// "Sessione non valida".
//
// Come si prova. Nel progetto non c'e' un DOM (niente jsdom), quindi la Shell
// non si monta per davvero: la si esegue come funzione dentro un piccolo
// motore di hook (stato e ref conservati per ordine di chiamata fra un
// "disegno" e l'altro, effetti spenti). Dopo ogni disegno si prendono i
// gestori VERI della Shell - riconosciuti dal loro sorgente - e si guidano come
// farebbe l'utente: risposta del server applicata, voce di menu, azione. Le
// chiamate al server sono finte e si leggono i parametri che la scheda manda.

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
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  postAction: async (action: string, params: Record<string, string>) => {
    server.postAction.push({ action, params: { ...params } });
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
}

/** Il gestore della Shell riconosciuto da un pezzo del suo sorgente (senza
 *  apici: il sorgente trasformato li riscrive doppi). */
function handler<F>(marker: string): F {
  const found = rt.callbacks.filter((f) => f.toString().includes(marker));
  if (found.length !== 1) throw new Error(`gestore "${marker}": trovati ${found.length}`);
  return found[0] as unknown as F;
}

const processResponseInner = () =>
  handler<(tabKey: string, resp: ServerResponse) => void>('Sessione scaduta. Effettuare nuovamente il login.');
const handleAction = () =>
  handler<(action: string, params?: Record<string, string>) => Promise<void>>('serverParams.hasTemplate = ');
const handleMenuClick = () =>
  handler<(menuId: string, label: string) => Promise<void>>('executeMenuItem(menuId, tab.sid)');
const loadRestoredTab = () =>
  handler<(tab: { key: string; sid: string }) => Promise<void>>('{ full: ');

/** La scheda di lavoro (sempre tab_1 / S1 in questi casi). */
function tab(): { key: string; sid: string; templateKey?: string; bindings?: unknown; scopePaths?: unknown; ui?: UITree } {
  const tabs = rt.slots.find((s) => Array.isArray(s.v) && (s.v as { key?: string }[])[0]?.key === 'tab_1');
  return (tabs!.v as ReturnType<typeof tab>[])[0];
}

/** Applica una risposta del server alla scheda, come all'arrivo. */
function arriva(resp: unknown): void {
  render();
  processResponseInner()('tab_1', resp as ServerResponse);
  render();
}

/** Parametri della richiesta successiva della scheda (un Salva). */
async function prossimaRichiesta(action = 'Save'): Promise<Record<string, string>> {
  render();
  await handleAction()(action, {});
  render();
  const last = server.postAction.at(-1);
  expect(last?.action).toBe(action);
  return last!.params;
}

// ───────────────────────────────────────────────────────────── risposte tipo
const DETAIL_KEY = 'anagraficheStatisticheDetail:2';
const LIST_KEY = 'anagraficheStatisticheList:1';

function template(viewName: string, viewType: string, pageType: number): UITree {
  return {
    rows: [{ id: 'r0', cells: [{ elementType: 1, control: { name: 'descrizione', id: 'descrizione', type: 'text', editable: true } }] }],
    pageType,
    path: 'S1-4',
    viewName,
    viewType,
  } as unknown as UITree;
}

/** METADATA+DATA: template, chiave e manifesto. */
function metadata(key: string, viewName: string, viewType = 'detail', pageType = 2) {
  return {
    templateKey: key,
    template: template(viewName, viewType, pageType),
    values: { descrizione: 'Categoria A' },
    dynProps: {},
    bindings: { '': 'S1-4' },
    scopePaths: { '': 'S1-4' },
    toolbar: [],
  };
}

/** Resa COMPLETA di un albero (tree+detail), come la manda ExecuteMenuItem. */
function alberoCompleto() {
  return {
    ui: {
      rows: [],
      pageType: 0,
      path: 'S1-5',
      viewName: 'anagraficheStatisticheTree',
      viewType: 'tree',
      navigateView: 'anagraficheStatisticheDetail',
      treeNodes: [{ id: 'n1', text: 'Categoria A' }],
    },
    toolbar: [],
  };
}

/** Resa COMPLETA di una videata qualunque (non un albero). */
function dettaglioCompleto() {
  return {
    ui: { ...template('festivitaDetail', 'detail', 2), path: 'S1-6' },
    toolbar: [],
  };
}

beforeEach(() => {
  rt.slots = [];
  rt.callbacks = [];
  server.postAction = [];
  server.next = [];
  clearTemplates();
  render();
  // Si parte dalla Home (SXADV-62): la scheda di lavoro diventa quella attiva.
  const active = rt.slots.find((s) => s.v === 'home');
  active!.v = 'tab_1';
  render();
});

// ─────────────────────────────────────────────────────────────────── il difetto
describe('resa completa: la scheda dimentica il template della videata di prima', () => {
  it('F5 su un dettaglio a due fasi, poi l\'albero dal menu: il Salva non porta templateKey', async () => {
    // Ripristino dopo F5: Refresh full=1 sulla Session, risposta METADATA+DATA.
    server.next.push(metadata(DETAIL_KEY, 'anagraficheStatisticheDetail'));
    render();
    await loadRestoredTab()(tab());
    render();
    expect(tab().templateKey).toBe(DETAIL_KEY);

    // Dal menu si riapre la funzione: e' un albero, resa completa.
    server.next.push(alberoCompleto());
    render();
    await handleMenuClick()('m1', 'Categorie Statistiche');
    render();
    expect(tab().ui?.viewType).toBe('tree');

    const params = await prossimaRichiesta('Save');
    expect(params.templateKey).toBeUndefined();
  });

  it('senza F5: dettaglio a due fasi, poi albero dal menu', async () => {
    arriva(metadata(DETAIL_KEY, 'anagraficheStatisticheDetail'));
    server.next.push(alberoCompleto());
    render();
    await handleMenuClick()('m1', 'Categorie Statistiche');
    render();
    expect((await prossimaRichiesta()).templateKey).toBeUndefined();
  });

  it('senza F5: lista a due fasi, poi albero (resa completa)', async () => {
    arriva(metadata(LIST_KEY, 'anagraficheStatisticheList', 'list', 1));
    arriva(alberoCompleto());
    expect((await prossimaRichiesta()).templateKey).toBeUndefined();
  });

  it('la resa completa di una videata che non e\' un albero vale lo stesso', async () => {
    arriva(metadata(DETAIL_KEY, 'anagraficheStatisticheDetail'));
    arriva(dettaglioCompleto());
    expect((await prossimaRichiesta()).templateKey).toBeUndefined();
  });

  it('con la chiave se ne vanno anche bindings e scopePaths', () => {
    arriva(metadata(DETAIL_KEY, 'anagraficheStatisticheDetail'));
    expect(tab().bindings).toEqual({ '': 'S1-4' });
    arriva(alberoCompleto());
    expect(tab().templateKey).toBeUndefined();
    expect(tab().bindings).toBeUndefined();
    expect(tab().scopePaths).toBeUndefined();
  });

  it('nell\'albero, il dettaglio a due fasi del pannello non rimette la chiave nella scheda', async () => {
    arriva(metadata(DETAIL_KEY, 'anagraficheStatisticheDetail'));
    arriva(alberoCompleto());
    // Il pannello di destra: risposta METADATA+DATA della navigateView.
    arriva(metadata(DETAIL_KEY, 'anagraficheStatisticheDetail'));
    expect(tab().ui?.viewType).toBe('tree');
    expect((await prossimaRichiesta()).templateKey).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────── contro-casi
describe('contro-casi: la chiave resta dove deve restare', () => {
  it('dopo METADATA+DATA la richiesta successiva porta la sua chiave', async () => {
    arriva(metadata(DETAIL_KEY, 'anagraficheStatisticheDetail'));
    expect((await prossimaRichiesta()).templateKey).toBe(DETAIL_KEY);
  });

  it('dopo una resa completa, un METADATA+DATA torna a portare la chiave', async () => {
    arriva(alberoCompleto());
    arriva(metadata(LIST_KEY, 'anagraficheStatisticheList', 'list', 1));
    expect((await prossimaRichiesta()).templateKey).toBe(LIST_KEY);
  });

  it.each([
    ['rowUpdate', { rowUpdate: true, position: 0, rows: [{ id: 'r0', cells: [] }] }],
    ['pageOnly', { pageOnly: true, rows: [], paging: {} }],
    ['detailPageOnly', { detailPageOnly: true, path: 'S1-4.0', rows: [], paging: {} }],
  ])('una risposta slim (%s) non azzera la chiave', async (_n, slim) => {
    arriva(metadata(LIST_KEY, 'anagraficheStatisticheList', 'list', 1));
    arriva({ ui: slim });
    expect(tab().templateKey).toBe(LIST_KEY);
    expect(tab().bindings).toEqual({ '': 'S1-4' });
    expect((await prossimaRichiesta()).templateKey).toBe(LIST_KEY);
  });

  it('una risposta DATA-only sullo stesso template mantiene la chiave', async () => {
    arriva(metadata(DETAIL_KEY, 'anagraficheStatisticheDetail'));
    arriva({ ui: { dataOnly: true, templateKey: DETAIL_KEY, values: { descrizione: 'B' }, dynProps: {} } });
    expect(tab().templateKey).toBe(DETAIL_KEY);
    expect((await prossimaRichiesta()).templateKey).toBe(DETAIL_KEY);
  });

  it('una risposta DATA-only su un altro template in cache aggiorna la chiave', async () => {
    arriva(metadata(LIST_KEY, 'anagraficheStatisticheList', 'list', 1));
    arriva(metadata(DETAIL_KEY, 'anagraficheStatisticheDetail'));
    arriva({ ui: { dataOnly: true, templateKey: LIST_KEY, values: {}, dynProps: {} }, bindings: { '': 'S1-7' } });
    expect(tab().templateKey).toBe(LIST_KEY);
    expect(tab().bindings).toEqual({ '': 'S1-7' });
    expect((await prossimaRichiesta()).templateKey).toBe(LIST_KEY);
  });
});
