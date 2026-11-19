import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerResponse } from '../types/ui';

// SXADV-6255/6256 (integrazione): con il pannello di riga aperto su S1-5.0,S1-6.6 e un
// campo digitato, il "Salva+" della barra della pagina (SaveAndNew col navpath del
// documento S1-5.0) deve far partire PRIMA un Post sulla riga col digitato, POI la
// SaveAndNew; se il Post risponde con un errore la SaveAndNew non parte.
//
// Motore di hook copiato da Shell.sxadv5989z.test.tsx (niente DOM: la Shell si esegue
// come funzione, i gestori veri si riconoscono dal sorgente). Il pannello non e'
// montato: la riga aperta entra da handleEditRow (EditRowContext), il campo da
// markPanelFieldEdit (PanelFieldContext) e handleFieldChange.

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
  // L'effetto `handleActionRef.current = handleAction` (effetti spenti qui), fatto a
  // mano a ogni disegno come in Shell.totals.sxadv5490.test.ts: lo svuotamento del
  // pannello passa da quella ref.
  const ha = handleAction();
  refSlot ??= rt.slots.find((sl) => {
    const v = sl.v as { current?: unknown } | null;
    return !!v && typeof v === 'object' && 'current' in v && typeof v.current === 'function'
      && /^async\(\)=>(undefined|void0)$/.test(String(v.current).replace(/\s+/g, ''));
  });
  if (!refSlot) throw new Error('handleActionRef non trovata');
  (refSlot.v as { current: unknown }).current = ha;
}

let refSlot: { v: unknown } | undefined;

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

const markPanelFieldEdit = () =>
  handler<(name: string, rowPath: string) => void>('panelFieldRows(tab.key), name, rowPath)');
const handleEditRow = () =>
  handler<(navpath: string | null, releasing?: string) => void>('releasedEditRow)(editNavpathRef.current, releasing)');
const handleFieldChange = () =>
  handler<(name: string, value: unknown) => void>('tab.formValues[name] = stored');

const ROW = 'S1-5.0,S1-6.6';
const DOC = 'S1-5.0';
const CAMPO = 'quantita.S1-6';

/** Un documento con una lista di righe: basta che la scheda abbia un contenuto. */
function documento(): unknown {
  return {
    ui: {
      viewName: 'documentiDetail',
      viewType: 'detail',
      pageType: 1,
      path: 'S1-5',
      rows: [{ id: 'r0', cells: [
        { elementType: 0, prompt: 'Numero:' },
        { elementType: 1, control: { type: 'text', name: 'numero.S1-5', id: 'numero', editable: true, value: '12' } },
      ] }],
    },
    toolbar: [],
  };
}

/** Apre il pannello sulla riga e ci scrive un campo, come fa EditPanel. */
function scriviNelPannello(value: string): void {
  render();
  handleEditRow()(ROW);
  markPanelFieldEdit()(CAMPO, ROW);
  handleFieldChange()(CAMPO, value);
  render();
}

async function salvaPiu(): Promise<void> {
  render();
  await handleAction()('SaveAndNew', { navpath: DOC });
  render();
}

beforeEach(() => {
  rt.slots = [];
  refSlot = undefined;
  rt.callbacks = [];
  server.postAction = [];
  server.next = [];
  clearTemplates();
  render();
  const active = rt.slots.find((s) => s.v === 'home');
  active!.v = 'tab_1';
  render();
  arriva(documento());
  server.postAction = [];
});

describe('SXADV-6255/6256: Salva+ della pagina con digitato nel pannello di riga', () => {
  it('prima un Post sulla riga col digitato, poi la SaveAndNew', async () => {
    scriviNelPannello('5');
    await salvaPiu();
    const azioni = server.postAction.map((p) => p.action);
    expect(azioni).toEqual(['Post', 'SaveAndNew']);
    const post = server.postAction[0];
    expect(post.params.navpath).toBe(ROW);
    expect(post.fv?.[CAMPO]).toBe('5');
  });

  it('la SaveAndNew porta il navpath del documento', async () => {
    scriviNelPannello('5');
    await salvaPiu();
    expect(server.postAction.at(-1)?.params.navpath).toBe(DOC);
  });

  it('se il Post risponde con un errore la SaveAndNew non parte', async () => {
    scriviNelPannello('5');
    server.next.push({ errors: [{ type: 'ERROR', message: 'Quantita obbligatoria', mnemonic: 'MANDATORY' }] });
    await salvaPiu();
    expect(server.postAction.map((p) => p.action)).toEqual(['Post']);
  });

  it('senza digitato nel pannello parte solo la SaveAndNew', async () => {
    render();
    handleEditRow()(ROW);
    render();
    await salvaPiu();
    expect(server.postAction.map((p) => p.action)).toEqual(['SaveAndNew']);
  });

  it('Salva+ del pannello stesso (navpath della riga): niente Post prima', async () => {
    scriviNelPannello('5');
    render();
    await handleAction()('SaveAndNew', { navpath: ROW });
    render();
    expect(server.postAction.map((p) => p.action)).toEqual(['SaveAndNew']);
    expect(server.postAction[0].fv?.[CAMPO]).toBe('5');
  });
});
