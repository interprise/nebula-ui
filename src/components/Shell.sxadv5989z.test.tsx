import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerResponse, UITree } from '../types/ui';

// SXADV-5989.Z — ricerca Fatture attive: la Sede sta nella testata incorporata
// in linea (content="this", `documentiHeaderQuery`), lo Stato al primo livello.
// Primo "Esegui": nessun risultato (INFO NO_DATA_FOUND) e la maschera torna a
// due fasi (template + values). Secondo "Esegui": la richiesta deve portare
// ANCORA entrambi i filtri. Dal vivo partiva solo lo Stato... e il server, senza
// la Sede, perdeva poi anche lo Stato.
//
// Stesso motore di hook di Shell.staleTemplateKey.test.tsx (niente DOM: la
// Shell si esegue come funzione, i gestori veri si riconoscono dal sorgente);
// la chiamata finta al server registra anche i formValues spediti.

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

/** Esegue un'azione della scheda e restituisce cio' che e' partito (formValues compresi). */
async function esegui(action = 'ExecuteQuery') {
  render();
  await handleAction()(action, {});
  render();
  const last = server.postAction.at(-1);
  expect(last?.action).toBe(action);
  return last!;
}

// ───────────────────────────────────────────────────────── la ricerca
const KEY = 'documentiQuery:0';

/** Template della ricerca: nomi nudi, editable a segnaposto, testata
 *  content="this" come cella contenitore con `bind` e senza `scope`. */
function template(): UITree {
  return {
    viewName: 'documentiQuery',
    viewType: 'query',
    pageType: 0,
    path: 'S1-5',
    rows: [
      { id: 'r0', cells: [
        { elementType: 0, prompt: 'Stato:' },
        { elementType: 1, control: { type: 'combo', name: 'stato', id: 'stato', editable: '?i0' } },
      ] },
      { id: 'r1', cells: [{
        elementType: 2,
        bind: 'this@documentiHeaderQuery',
        rows: [{ id: 'h0', cells: [
          { elementType: 0, prompt: 'Sede:' },
          { elementType: 1, control: { type: 'combo', name: 'sedeEmissione', id: 'sedeEmissione', remote: true, editable: '?i1' } },
        ] }],
      }] },
    ],
  } as unknown as UITree;
}

function metadata(withTemplate = true) {
  return {
    templateKey: KEY,
    ...(withTemplate ? { template: template() } : {}),
    values: {
      stato: { value: 'C', displayText: 'Contabilizzato' },
      sedeEmissione: { value: '44|008', displayText: '008 - CASTELVETRO' },
    },
    dynProps: { i0: true, i1: true },
    bindings: { '': 'S1-5', 'this@documentiHeaderQuery': 'S1-6' },
    scopePaths: { '': 'S1-5', 'this@documentiHeaderQuery': 'S1-5' },
    toolbar: [],
  };
}

const NESSUN_RISULTATO = { type: 'INFO', message: 'Nessun dato trovato', mnemonic: 'NO_DATA_FOUND' };

beforeEach(() => {
  rt.slots = [];
  rt.callbacks = [];
  server.postAction = [];
  server.next = [];
  clearTemplates();
  render();
  const active = rt.slots.find((s) => s.v === 'home');
  active!.v = 'tab_1';
  render();
});

describe('SXADV-5989.Z: il secondo Esegui porta ancora la Sede della testata', () => {
  it('apertura METADATA: il primo Esegui spedisce Stato e Sede', async () => {
    arriva(metadata());
    const sent = await esegui();
    expect(sent.fv).toMatchObject({ 'stato.S1-5': 'C', 'sedeEmissione.S1-6': '44|008' });
  });

  it('Esegui -> NO_DATA_FOUND con template+values -> Esegui: Stato E Sede', async () => {
    arriva(metadata());
    server.next.push({ ...metadata(), errors: [NESSUN_RISULTATO] });
    await esegui();
    const second = await esegui();
    expect(second.fv?.['stato.S1-5']).toBe('C');
    expect(second.fv?.['sedeEmissione.S1-6']).toBe('44|008');
  });

  it('stessa cosa quando la risposta omette il template (mode MC, chiave gia\' in cache)', async () => {
    arriva(metadata());
    server.next.push({ ...metadata(false), errors: [NESSUN_RISULTATO] });
    await esegui();
    const second = await esegui();
    expect(second.fv).toMatchObject({ 'stato.S1-5': 'C', 'sedeEmissione.S1-6': '44|008' });
  });

  it('risposta DATA-only sullo stesso template: la Sede resta nei formValues', async () => {
    arriva(metadata());
    server.next.push({
      ui: { dataOnly: true, templateKey: KEY, values: metadata().values, dynProps: metadata().dynProps },
      bindings: metadata().bindings,
      errors: [NESSUN_RISULTATO],
    });
    await esegui();
    const second = await esegui();
    expect(second.fv).toMatchObject({ 'stato.S1-5': 'C', 'sedeEmissione.S1-6': '44|008' });
  });
});
