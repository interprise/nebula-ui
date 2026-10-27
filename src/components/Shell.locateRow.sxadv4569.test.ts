import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerResponse } from '../types/ui';

// SXADV-4569 — il «Cerca» (LocateRow) sulla Shell, con il pannello di riga
// aperto. Contratto:
//   - LocateRow chiude l'ambito del rigo come i comandi di pagina: se il
//     pannello ha digitato non spedito, prima parte un Post sul rigo del
//     pannello, poi LocateRow;
//   - LocateRow non porta postPath (ne' navpath) del rigo del pannello: il
//     server non deve postare li' ne' posizionarsi li';
//   - dopo LocateRow il rigo in modifica e' azzerato: un Post successivo senza
//     navpath non si porta dietro il rigo di prima (il rigo trovato, se ha il
//     pannello, lo riapre ListRenderer con onSelectRecord).
//
// Impianto copiato da Shell.addWait.mdnuovoinvolo.test.ts (motore di hook,
// effetti spenti). Con gli effetti spenti handleActionRef resterebbe al suo
// valore iniziale: render() lo collega a handleAction come fa l'effetto.

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
const handleEditRow = () =>
  handler<(navpath: string | null, releasing?: string) => void>('releasing !== void 0');
const markPanelFieldEdit = () =>
  handler<(name: string, rowPath: string) => void>('panelFieldRows(tab.key), name, rowPath');
const handleFieldChange = () =>
  handler<(name: string, value: unknown) => void>('dirtyFieldsRef.current.add(name)');

function arriva(resp: unknown): void {
  render();
  processResponseInner()('tab_1', resp as ServerResponse);
  render();
}

/** Lista listEdit con due righi, il pannello sul rigo 3. */
const LIST = 'S1-9';
const ROW = 'S1-9.3';
function lista() {
  return {
    ui: {
      rows: [
        { id: 'r0', props: { path: 'S1-9.0' }, cells: [{ elementType: 1, text: 'a' }] },
        { id: 'r3', props: { path: ROW }, cells: [{ elementType: 1, text: 'b' }] },
      ],
      pageType: 1,
      listEdit: true,
      path: LIST,
      viewName: 'eventiList',
      viewType: 'list',
    },
    toolbar: [],
  };
}

/** Apre il pannello sul rigo: e' quello che fa ListView.onSelectRecord. */
function apriPannello(): void {
  render();
  handleEditRow()(ROW);
  render();
}

/** Scrive nel pannello un campo del rigo, non ancora spedito. */
function scriviNelPannello(name: string, value: string): void {
  render();
  markPanelFieldEdit()(name, ROW);
  handleFieldChange()(name, value);
  render();
}

async function azione(action: string, params: Record<string, string> = {}): Promise<unknown> {
  render();
  const r = await handleAction()(action, params);
  render();
  return r;
}

const locateParams = { navpath: LIST, option1: 'rossi', from: '-1' };

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
  arriva(lista());
  server.postAction = [];
});

describe('Shell: LocateRow col pannello di riga aperto (SXADV-4569)', () => {
  it('impianto: un Post senza navpath porta il rigo del pannello', async () => {
    apriPannello();
    await azione('Post');
    const post = server.postAction.at(-1)!;
    expect(post.action).toBe('Post');
    expect(post.params.navpath).toBe(ROW);
  });

  it('LocateRow non porta postPath ne\' navpath del rigo del pannello', async () => {
    apriPannello();
    await azione('LocateRow', locateParams);
    const calls = server.postAction.filter((c) => c.action === 'LocateRow');
    expect(calls).toHaveLength(1);
    expect(calls[0].params.postPath).toBeUndefined();
    expect(calls[0].params.navpath).toBe(LIST);
    expect(calls[0].params.option1).toBe('rossi');
    expect(calls[0].params.from).toBe('-1');
  });

  it('niente digitato: nessun Post prima di LocateRow', async () => {
    apriPannello();
    await azione('LocateRow', locateParams);
    expect(server.postAction.map((c) => c.action)).toEqual(['LocateRow']);
  });

  it('digitato non spedito: prima un Post sul rigo del pannello, poi LocateRow senza postPath', async () => {
    apriPannello();
    scriviNelPannello('esito.S1-9', 'OK');
    await azione('LocateRow', locateParams);
    expect(server.postAction.map((c) => c.action)).toEqual(['Post', 'LocateRow']);
    expect(server.postAction[0].params.navpath).toBe(ROW);
    const loc = server.postAction[1].params;
    expect(loc.postPath).toBeUndefined();
    expect(loc.navpath).toBe(LIST);
    expect(loc._afterFlush).toBeUndefined();
  });

  it('il flush non parte una seconda volta con LocateRow', async () => {
    apriPannello();
    scriviNelPannello('esito.S1-9', 'OK');
    await azione('LocateRow', locateParams);
    expect(server.postAction.filter((c) => c.action === 'Post')).toHaveLength(1);
  });

  it('flush bloccato da un ERROR: LocateRow non parte', async () => {
    apriPannello();
    scriviNelPannello('esito.S1-9', 'OK');
    server.next.push({ errors: [{ type: 'ERROR', message: 'Esito obbligatorio' }] });
    await azione('LocateRow', locateParams);
    expect(server.postAction.map((c) => c.action)).toEqual(['Post']);
  });

  it('dopo LocateRow il rigo in modifica e\' azzerato: un Post successivo non porta il rigo di prima', async () => {
    apriPannello();
    await azione('LocateRow', locateParams);
    await azione('Post');
    const post = server.postAction.at(-1)!;
    expect(post.action).toBe('Post');
    expect(post.params.navpath).toBeUndefined();
    expect(post.params.postPath).toBeUndefined();
  });

  it('LocateRow restituisce la risposta del server (serve al Cerca)', async () => {
    const resp = { located: { found: true, more: false, position: 3, scanned: 4 } };
    server.next.push(resp);
    const r = await azione('LocateRow', locateParams);
    expect((r as { located?: unknown })?.located).toEqual(resp.located);
  });

  it('con flush, la risposta restituita e\' quella di LocateRow, non del Post', async () => {
    apriPannello();
    scriviNelPannello('esito.S1-9', 'OK');
    const resp = { located: { found: true, more: false, position: 3, scanned: 4 } };
    server.next.push({}, resp);
    const r = await azione('LocateRow', locateParams);
    expect((r as { located?: unknown })?.located).toEqual(resp.located);
  });
});

// FilterRows come LocateRow: chiude l'ambito del rigo e azzera il rigo del pannello.
describe('Shell: FilterRows col pannello di riga aperto (SXADV-4569)', () => {
  const filterParams = { navpath: LIST, option1: 'rossi' };

  it('niente digitato: FilterRows da solo, senza postPath, col navpath della lista', async () => {
    apriPannello();
    await azione('FilterRows', filterParams);
    expect(server.postAction.map((c) => c.action)).toEqual(['FilterRows']);
    expect(server.postAction[0].params.postPath).toBeUndefined();
    expect(server.postAction[0].params.navpath).toBe(LIST);
  });

  it('digitato non spedito: prima Post sul rigo del pannello, poi FilterRows senza postPath', async () => {
    apriPannello();
    scriviNelPannello('esito.S1-9', 'OK');
    await azione('FilterRows', filterParams);
    expect(server.postAction.map((c) => c.action)).toEqual(['Post', 'FilterRows']);
    expect(server.postAction[0].params.navpath).toBe(ROW);
    expect(server.postAction[1].params.postPath).toBeUndefined();
    expect(server.postAction[1].params._afterFlush).toBeUndefined();
  });

  it('flush bloccato da un ERROR: FilterRows non parte', async () => {
    apriPannello();
    scriviNelPannello('esito.S1-9', 'OK');
    server.next.push({ errors: [{ type: 'ERROR', message: 'Esito obbligatorio' }] });
    await azione('FilterRows', filterParams);
    expect(server.postAction.map((c) => c.action)).toEqual(['Post']);
  });

  it('dopo FilterRows il rigo del pannello e\' azzerato', async () => {
    apriPannello();
    await azione('FilterRows', filterParams);
    await azione('Post');
    const post = server.postAction.at(-1)!;
    expect(post.params.navpath).toBeUndefined();
    expect(post.params.postPath).toBeUndefined();
  });

  it('restituisce la risposta di FilterRows (anche dopo il flush)', async () => {
    apriPannello();
    scriviNelPannello('esito.S1-9', 'OK');
    const resp = { filtered: { count: 3 } };
    server.next.push({}, resp);
    const r = await azione('FilterRows', filterParams);
    expect((r as { filtered?: unknown })?.filtered).toEqual(resp.filtered);
  });
});

