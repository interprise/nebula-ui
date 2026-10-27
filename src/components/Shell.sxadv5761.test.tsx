import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerResponse } from '../types/ui';

// SXADV-5761 — integrazione nella Shell: Save/Post con un file in attesa per
// il sid della scheda (services/pendingUpload, registrato dal campo `upload`)
// prima carica il file (uploadFile, multipart) e SOLO se va bene manda
// l'azione; con un errore l'azione non parte e gli errori si mostrano; con
// uiData.cdmsKey parte CdmsEdit navpath=<cdmsKey> al posto dell'azione.
// Legacy: ui.js ajaxDo -> doUpload -> cleanUpload.
//
// Stesso motore di hook di Shell.sxadv5989z.test.tsx (niente DOM: la Shell si
// esegue come funzione, i gestori veri si riconoscono dal sorgente). Il
// negozio dei file in attesa e' quello VERO; finto e' solo il server, che
// registra in un unico giornale upload, azioni e messaggi mostrati, in ordine.

const log = vi.hoisted(() => [] as Record<string, unknown>[]);
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
    showServerMessages: (e: unknown) => { log.push({ kind: 'messages', errors: e }); },
    error: (e: unknown) => { log.push({ kind: 'failure', error: e }); },
    failure: (e: unknown) => { log.push({ kind: 'failure', error: e }); },
    warning: () => {}, info: () => {},
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
  next: [] as unknown[],
  upload: [] as (() => Promise<unknown>)[],
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  postAction: async (action: string, params: Record<string, string>) => {
    log.push({ kind: 'action', action, params: { ...params } });
    return server.next.shift() ?? {};
  },
  executeMenuItem: async () => server.next.shift() ?? {},
  uploadFile: async (file: File, sid: string, params: Record<string, string> = {}, action = 'FileUpload') => {
    log.push({ kind: 'upload', file: file.name, sid, params: { ...params }, action });
    const next = server.upload.shift();
    return next ? next() : {};
  },
  subscribeInFlight: () => () => {},
}));

const { default: Shell } = await import('./Shell');
const { clearTemplates } = await import('../services/templateCache');
const storePath = '../services/pendingUpload';
const store = (await import(/* @vite-ignore */ storePath).catch(() => null)) as
  | typeof import('../services/pendingUpload')
  | null;
const S = () => {
  if (!store) throw new Error('src/services/pendingUpload.ts non esiste');
  return store;
};

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

async function esegui(action: string, params: Record<string, string> = {}) {
  render();
  await handleAction()(action, params);
  render();
}

const VIEW = 'caricaExcelDetail';
function vista(viewName = VIEW, path = 'S1-3') {
  return { ui: { rows: [], pageType: 2, path, viewName, viewType: 'detail' }, toolbar: [] };
}

/** Lo stato della scheda tab_1 com'e' nell'ultimo render. */
function tab(): { key: string; loading?: boolean } {
  for (const sl of rt.slots) {
    if (Array.isArray(sl.v)) {
      const t = (sl.v as { key?: string }[]).find((x) => x && x.key === 'tab_1');
      if (t) return t as { key: string; loading?: boolean };
    }
  }
  throw new Error('scheda tab_1 non trovata');
}

const xlsx = (name = 'listino.xlsx') => new File(['dati'], name);
function inAttesa(over: Record<string, unknown> = {}) {
  S().setPendingUpload('S1', {
    file: xlsx(), params: { option1: 'fileExcel', navpath: 'S1-3' }, action: 'FileUpload', ...over,
  } as import('../services/pendingUpload').PendingUpload);
}

const kinds = () => log.filter((e) => e.kind === 'upload' || e.kind === 'action').map((e) => (e.kind === 'upload' ? 'upload' : e.action));

beforeEach(() => {
  rt.slots = [];
  rt.callbacks = [];
  log.length = 0;
  server.next = [];
  server.upload = [];
  clearTemplates();
  if (store) for (const sid of ['S1', 'S2']) store.clearPendingUpload(sid);
  render();
  const active = rt.slots.find((s) => s.v === 'home');
  active!.v = 'tab_1';
  render();
  arriva(vista());
  log.length = 0;
});

describe('SXADV-5761: Salva con un file in attesa', () => {
  it.each(['Save', 'Post'])('%s: prima l\'upload del file (sid della scheda), poi l\'azione', async (action) => {
    inAttesa({ viewName: VIEW });
    await esegui(action);
    expect(kinds()).toEqual(['upload', action]);
    expect(log[0]).toMatchObject({ kind: 'upload', file: 'listino.xlsx', sid: 'S1', action: 'FileUpload',
      params: { option1: 'fileExcel', navpath: 'S1-3' } });
    expect(S().getPendingUpload('S1')).toBeUndefined();
  });

  it('il comando del file (CdmsUpload) va all\'upload', async () => {
    inAttesa({ action: 'CdmsUpload' });
    await esegui('Save');
    expect(log[0]).toMatchObject({ kind: 'upload', action: 'CdmsUpload' });
  });

  it('l\'upload aspetta: l\'azione parte solo a upload concluso', async () => {
    let release!: (v: unknown) => void;
    server.upload.push(() => new Promise((r) => { release = r; }));
    inAttesa();
    render();
    const pending = handleAction()('Save', {});
    await new Promise((r) => setTimeout(r, 0));
    expect(kinds()).toEqual(['upload']);
    release({});
    await pending;
    expect(kinds()).toEqual(['upload', 'Save']);
  });

  it('errore ERROR dall\'upload: nessuna azione, errori mostrati, il file resta', async () => {
    const errors = [{ type: 'ERROR', message: 'Formato non valido', mnemonic: 'BAD_FMT' }];
    server.upload.push(async () => ({ errors }));
    inAttesa();
    await esegui('Save');
    expect(kinds()).toEqual(['upload']);
    const shown = log.filter((e) => e.kind === 'messages');
    expect(shown).toHaveLength(1);
    expect(shown[0].errors).toEqual(errors);
    expect(S().getPendingUpload('S1')?.file.name).toBe('listino.xlsx');
  });

  it('eccezione dall\'upload: nessuna azione, errore segnalato', async () => {
    const boom = new Error('rete giu');
    server.upload.push(async () => { throw boom; });
    inAttesa();
    await esegui('Save');
    expect(kinds()).toEqual(['upload']);
    expect(log.some((e) => e.kind === 'failure' || e.kind === 'messages')).toBe(true);
  });

  it('dopo un errore, il Salva successivo rimanda il file e poi salva', async () => {
    server.upload.push(async () => ({ errors: [{ type: 'ERROR', message: 'no' }] }));
    inAttesa();
    await esegui('Save');
    await esegui('Save');
    expect(kinds()).toEqual(['upload', 'upload', 'Save']);
  });

  it('Post di un campo (blur) con file in attesa e subito Salva: upload, Post, Save — il Salva non si perde', async () => {
    let release!: (v: unknown) => void;
    server.upload.push(() => new Promise((r) => { release = r; }));
    inAttesa();
    render();
    const post = handleAction()('Post', {});
    await new Promise((r) => setTimeout(r, 0));
    render();
    const save = handleAction()('Save', {});
    await new Promise((r) => setTimeout(r, 0));
    expect(kinds()).toEqual(['upload']);
    release({});
    await Promise.all([post, save]);
    render();
    expect(kinds()).toEqual(['upload', 'Post', 'Save']);
  });

  it('la scheda non va in loading durante l\'upload (un Salva cliccato intanto non verrebbe scartato)', async () => {
    let release!: (v: unknown) => void;
    server.upload.push(() => new Promise((r) => { release = r; }));
    inAttesa();
    render();
    const post = handleAction()('Post', {});
    await new Promise((r) => setTimeout(r, 0));
    render();
    expect(tab().loading).toBeFalsy();
    release({});
    await post;
  });

  it('cdmsKey nella risposta dell\'upload: parte CdmsEdit navpath=<cdmsKey> al posto del Salva', async () => {
    server.upload.push(async () => ({ uiData: { cdmsKey: 'CDMS-42' } }));
    inAttesa();
    await esegui('Post');
    expect(kinds()).toEqual(['upload', 'CdmsEdit']);
    const sent = log.find((e) => e.kind === 'action') as { params: Record<string, string> };
    expect(sent.params.navpath).toBe('CDMS-42');
    // Nessun aggancio a mano di handleActionRef qui: il CdmsEdit parte nella
    // stessa chiamata. E la scheda non resta in loading.
    expect(tab().loading).toBeFalsy();
  });
});

describe('SXADV-5761: quando la Shell non carica niente', () => {
  it('Salva senza file in attesa: solo l\'azione', async () => {
    await esegui('Save');
    expect(kinds()).toEqual(['Save']);
  });

  it.each(['ExecuteQuery', 'Add'])('%s con un file in attesa: nessun upload, il file resta', async (action) => {
    inAttesa();
    await esegui(action);
    expect(kinds()).toEqual([action]);
    expect(S().getPendingUpload('S1')).toBeDefined();
  });

  it('file scelto, poi l\'utente passa a un\'altra vista: il Salva di quella non carica il file', async () => {
    inAttesa({ viewName: VIEW });
    arriva(vista('altraVistaDetail'));
    await esegui('Save');
    expect(kinds()).toEqual(['Save']);
    expect(S().getPendingUpload('S1')).toBeUndefined();
  });

  it('file in attesa su un altro sid: il Salva della scheda S1 non lo tocca', async () => {
    S().setPendingUpload('S2', { file: xlsx('altrui.xlsx'), params: {}, action: 'FileUpload' });
    await esegui('Save');
    expect(kinds()).toEqual(['Save']);
    expect(S().getPendingUpload('S2')?.file.name).toBe('altrui.xlsx');
  });
});

describe('SXADV-5761: quando il file in attesa si scarta', () => {
  it('Annulla (Cancel) scarta il file; il Salva dopo non carica niente', async () => {
    inAttesa();
    await esegui('Cancel');
    expect(S().getPendingUpload('S1')).toBeUndefined();
    await esegui('Save');
    expect(kinds()).toEqual(['Cancel', 'Save']);
  });

  it('risposta sulla stessa vista con un altro path (altro record): file scartato', async () => {
    inAttesa({ viewName: VIEW });
    arriva(vista(VIEW, 'S1-4'));
    expect(S().getPendingUpload('S1')).toBeUndefined();
    await esegui('Save');
    expect(kinds()).toEqual(['Save']);
  });

  it('risposta sulla stessa vista e stesso path (es. ricalcolo di un Post): il file resta', async () => {
    inAttesa({ viewName: VIEW });
    arriva(vista(VIEW, 'S1-3'));
    expect(S().getPendingUpload('S1')?.file.name).toBe('listino.xlsx');
    await esegui('Save');
    expect(kinds()).toEqual(['upload', 'Save']);
  });
});
