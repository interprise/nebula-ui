import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerResponse, UIRow } from '../types/ui';

// SXADV-6015 — Elimina dal pannello di una lista: Shell toglie dalla griglia il
// record cancellato (removeListRow, armato da `_removeRow`) con le sue righe di
// continuazione. Un record su due righe la cui seconda riga parte dalla colonna
// 0 non ha la cella DUMMY in testa: il server marca con `props.path` solo la
// riga primaria, e la riga senza path che la segue e' lo stesso record. Va tolta
// con lui, e le righe che seguono vanno rinumerate.
// Guardia di regressione: la forma con la DUMMY in testa (gia' gestita).
//
// Motore di hook copiato da Shell.sxadv6015b.test.tsx (niente DOM).

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

const tabs = () => {
  const s = rt.slots.find((x) => Array.isArray(x.v) && (x.v as { key?: string }[]).some((t) => t?.key === 'tab_1'));
  if (!s) throw new Error('stato delle schede non trovato');
  return s.v as { key: string; ui?: { rows?: UIRow[] } }[];
};
const rowsOfTab = () => tabs().find((t) => t.key === 'tab_1')!.ui!.rows!;

const UI_PATH = 'S1-7.0,S1-8';
const rowPath = (pos: number) => `${UI_PATH}.${pos}`;

function primary(pos: number): unknown {
  return {
    id: `p${pos}`,
    props: { path: rowPath(pos), canDelete: true },
    cells: [
      { elementType: 1, control: { value: false, displayValue: 'No', editable: true } },
      { elementType: 1, colspan: 3, control: { value: `44|14866${pos}`, displayValue: `CLIENTE ${pos}` } },
    ],
  };
}
function second(pos: number): unknown {
  return {
    cells: [
      { elementType: 1, colspan: 2, control: { value: `Tipo ${pos}`, editable: false } },
      { elementType: 1, colspan: 2, control: { value: `1280${pos}` } },
    ],
  };
}
function secondDummy(pos: number): unknown {
  return {
    cells: [
      { elementType: 9 },
      { elementType: 1, colspan: 3, control: { value: `Tipo ${pos}`, editable: false } },
    ],
  };
}

function lista(make2: (pos: number) => unknown): unknown {
  return {
    ui: {
      viewName: 'sollecitiScadenzeList',
      viewType: 'list',
      pageType: 1,
      path: UI_PATH,
      multiEdit: true,
      listEdit: true,
      rows: [0, 1, 2].flatMap((p) => [primary(p), make2(p)]),
      paging: { page: 1, pages: 1, totalRows: 3 },
    },
    toolbar: [],
  };
}

function apri(make2: (pos: number) => unknown): void {
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
  arriva(lista(make2));
}

async function cancella(pos: number) {
  server.next.push({});
  render();
  await handleAction()('Delete', { navpath: rowPath(pos), _removeRow: rowPath(pos) });
  render();
}

const textOf = (r: UIRow) => r.cells.map((c) => String((c.control as { value?: unknown } | undefined)?.value ?? '')).join('|');

beforeEach(() => { clearTemplates(); });

describe('SXADV-6015: Elimina toglie anche la seconda riga senza DUMMY', () => {
  it('cancellato il record 1: restano 4 righe, nessuna del record 1', async () => {
    apri(second);
    expect(rowsOfTab()).toHaveLength(6);
    await cancella(1);
    const rows = rowsOfTab();
    expect(rows).toHaveLength(4);
    expect(rows.map(textOf).some((t) => t.includes('Tipo 1'))).toBe(false);
  });

  it('dopo la cancellazione ogni record e\' ancora primaria + seconda, rinumerato', async () => {
    apri(second);
    await cancella(1);
    const rows = rowsOfTab();
    expect(rows.map((r) => r.props?.path)).toEqual([rowPath(0), undefined, rowPath(1), undefined]);
    expect(textOf(rows[3])).toContain('Tipo 2');
  });

  it('cancellato l\'ultimo record: non resta la sua seconda riga', async () => {
    apri(second);
    await cancella(2);
    const rows = rowsOfTab();
    expect(rows).toHaveLength(4);
    expect(rows.map(textOf).some((t) => t.includes('Tipo 2'))).toBe(false);
  });
});

describe('SXADV-6015: seconda riga col DUMMY (gia\' gestita)', () => {
  it('cancellato il record 1: restano 4 righe, nessuna del record 1', async () => {
    apri(secondDummy);
    await cancella(1);
    const rows = rowsOfTab();
    expect(rows).toHaveLength(4);
    expect(rows.map(textOf).some((t) => t.includes('Tipo 1'))).toBe(false);
    expect(rows.map((r) => r.props?.path)).toEqual([rowPath(0), undefined, rowPath(1), undefined]);
  });
});
