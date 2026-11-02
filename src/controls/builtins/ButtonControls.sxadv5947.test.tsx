import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UIControl } from '../../types/ui';

// SXADV-5947 — download dalla scheda giusta. Con un Bilancio nella seconda
// scheda partiva sid=S1 con navpath=S2-0.0: 200 a corpo vuoto e un file da 0
// byte, senza messaggi. I controlli devono usare il sid del SidContext e un
// download vuoto deve arrivare all'utente come errore via useFeedback.
//
// Impianto come ButtonControls.sxadv5761.test.tsx: niente DOM, motore di hook
// minimo, albero visitato come dati. services/api NON e' finto: si guarda cio'
// che parte davvero sul fetch e cosa viene salvato.

type AnyFn = (...a: never[]) => unknown;
const rt = vi.hoisted(() => ({
  active: false,
  i: 0,
  slots: [] as { v: unknown; deps?: unknown[]; cleanup?: (() => void) | void }[],
  effects: [] as (() => void)[],
  dirty: false,
  sid: 'S1',
  sidCtx: null as unknown,
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const slot = (init: () => unknown) => {
    const i = rt.i++;
    if (!rt.slots[i]) rt.slots[i] = { v: init() };
    return rt.slots[i];
  };
  const changed = (a?: unknown[], b?: unknown[]) =>
    !a || !b || a.length !== b.length || a.some((x, k) => !Object.is(x, b[k]));
  const on = <F extends AnyFn>(real: F, fake: AnyFn): F =>
    ((...a: never[]) => (rt.active ? fake(...a) : real(...a))) as unknown as F;
  const effect = ((fn: () => (() => void) | void, deps?: unknown[]) => {
    const s = slot(() => undefined);
    const first = !('deps' in s);
    if (first || changed(s.deps as unknown[] | undefined, deps)) {
      const prev = s.cleanup;
      s.deps = deps;
      if (first) s.deps = deps ?? undefined;
      rt.effects.push(() => {
        if (typeof prev === 'function') prev();
        s.cleanup = fn();
      });
    }
  }) as AnyFn;
  const over = {
    useState: on(actual.useState as AnyFn, ((init: unknown) => {
      const s = slot(() => (typeof init === 'function' ? (init as () => unknown)() : init));
      const set = (nv: unknown) => {
        const v = typeof nv === 'function' ? (nv as (p: unknown) => unknown)(s.v) : nv;
        if (!Object.is(v, s.v)) { s.v = v; rt.dirty = true; }
      };
      return [s.v, set];
    }) as AnyFn),
    useReducer: on(actual.useReducer as AnyFn, ((reducer: (s: unknown, a: unknown) => unknown, init: unknown) => {
      const s = slot(() => init);
      return [s.v, (a: unknown) => { s.v = reducer(s.v, a); rt.dirty = true; }];
    }) as AnyFn),
    useRef: on(actual.useRef as AnyFn, ((init: unknown) => slot(() => ({ current: init })).v) as AnyFn),
    useCallback: on(actual.useCallback as AnyFn, ((fn: AnyFn) => fn) as AnyFn),
    useMemo: on(actual.useMemo as AnyFn, ((f: () => unknown) => f()) as AnyFn),
    useEffect: on(actual.useEffect as AnyFn, effect),
    useLayoutEffect: on(actual.useLayoutEffect as AnyFn, effect),
    useInsertionEffect: on(actual.useInsertionEffect as AnyFn, (() => {}) as AnyFn),
    useImperativeHandle: on(actual.useImperativeHandle as AnyFn, (() => {}) as AnyFn),
    useDebugValue: on(actual.useDebugValue as AnyFn, (() => {}) as AnyFn),
    useContext: on(actual.useContext as AnyFn, ((c: { _currentValue: unknown }) =>
      (c === rt.sidCtx ? rt.sid : c._currentValue)) as AnyFn),
    useId: on(actual.useId as AnyFn, (() => ':t:') as AnyFn),
    useSyncExternalStore: on(actual.useSyncExternalStore as AnyFn, ((subscribe: (cb: () => void) => () => void, get: () => unknown) => {
      const s = slot(() => ({ sub: subscribe, off: subscribe(() => { rt.dirty = true; }) }));
      const cur = s.v as { sub: unknown; off: () => void };
      if (cur.sub !== subscribe) {
        cur.off();
        s.v = { sub: subscribe, off: subscribe(() => { rt.dirty = true; }) };
      }
      return get();
    }) as AnyFn),
    useTransition: on(actual.useTransition as AnyFn, (() => [false, (f: () => void) => f()]) as AnyFn),
    useDeferredValue: on(actual.useDeferredValue as AnyFn, ((v: unknown) => v) as AnyFn),
  };
  return { ...actual, ...over, default: { ...actual, ...over } };
});

const fb = vi.hoisted(() => ({ shown: [] as unknown[], errors: [] as unknown[] }));
vi.mock('../../hooks/feedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/feedback')>()),
  useFeedback: () => ({
    showServerMessages: (e: unknown) => { fb.shown.push(e); },
    error: (e: unknown) => { fb.errors.push(e); },
    failure: (e: unknown) => { fb.errors.push(e); },
    warning: () => {}, info: () => {},
  }),
}));

const { DownloadControl } = await import('./ButtonControls');
const { AttachmentsControl } = await import('./MiscControls');
const { SidContext } = await import('../../components/ViewRenderer');
const antd = await import('antd');
const antdTypes = new Set<unknown>(Object.values(antd as Record<string, unknown>));
rt.sidCtx = SidContext;

/* ── esecuzione dei componenti ─────────────────────────────────────────── */

interface El { type: unknown; props: Record<string, unknown> }
const isEl = (x: unknown): x is El => !!x && typeof x === 'object' && 'props' in (x as object) && 'type' in (x as object);

function expand(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(expand);
  if (!isEl(node)) return node;
  const t = node.type;
  if (typeof t === 'function' && !antdTypes.has(t)) {
    return expand((t as (p: unknown) => unknown)(node.props));
  }
  const children = node.props.children;
  return { ...node, props: { ...node.props, children: children === undefined ? undefined : expand(children) } };
}

function mount(Comp: unknown, control: Partial<UIControl>, sid: string): unknown {
  const props = { control: control as UIControl, onAction: () => {}, onChange: () => {} };
  rt.slots = [];
  let tree: unknown = null;
  for (let n = 0; n < 20; n++) {
    rt.active = true;
    rt.i = 0;
    rt.dirty = false;
    rt.sid = sid;
    rt.effects = [];
    try {
      tree = expand((Comp as (p: unknown) => unknown)(props));
    } finally {
      rt.active = false;
    }
    const eff = rt.effects;
    rt.effects = [];
    for (const e of eff) e();
    if (!rt.dirty) return tree;
  }
  throw new Error('render non si stabilizza');
}

function find(node: unknown, pred: (e: El) => boolean): El | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = find(n, pred);
      if (r) return r;
    }
    return null;
  }
  if (!isEl(node)) return null;
  return pred(node) ? node : find(node.props.children, pred);
}

/** Clicca il primo elemento con onClick che soddisfa pred e lascia finire la catena. */
async function click(tree: unknown, pred: (e: El) => boolean = () => true) {
  const el = find(tree, (e) => typeof e.props.onClick === 'function' && pred(e));
  if (!el) throw new Error('nessun elemento cliccabile nell\'albero');
  const ev = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
  await (el.props.onClick as (e: unknown) => unknown)(ev);
  // Il link degli allegati non restituisce la promessa: si aspetta a giro.
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  return ev;
}

/* ── rete e salvataggio finti ──────────────────────────────────────────── */

let fetchMock: ReturnType<typeof vi.fn>;
let saved: { name: string }[];

const sent = (n = 0) => new URLSearchParams(String((fetchMock.mock.calls[n][1] as RequestInit).body));
const sentUrl = (n = 0) => fetchMock.mock.calls[n][0] as string;
const realFile = (cd = 'attachment; filename="Bilancio.xls"') =>
  new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-disposition': cd } });

beforeEach(() => {
  fb.shown = [];
  fb.errors = [];
  rt.slots = [];
  saved = [];
  fetchMock = vi.fn(async () => realFile());
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:t');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('document', {
    createElement: () => {
      const a = {
        href: '', download: '', style: {},
        setAttribute: () => {}, remove: () => {},
        click: () => { saved.push({ name: a.download }); },
      };
      return a;
    },
    body: { appendChild: () => {}, removeChild: () => {} },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ── DownloadControl ───────────────────────────────────────────────────── */

describe('SXADV-5947: DownloadControl', () => {
  const inS2 = {
    type: 'download', id: 'downloadXls', command: 'FileDownload',
    navpath: 'S2-0.0', controlName: 'downloadXls.S2-0', prompt: 'Download bilancio (Excel)',
  } as Partial<UIControl>;

  it('in S1 parte sid=S1', async () => {
    await click(mount(DownloadControl, { ...inS2, navpath: 'S1-0.0', controlName: 'downloadXls.S1-0' }, 'S1'));
    expect(sent().get('sid')).toBe('S1');
  });

  it('in S2 parte sid=S2, con navpath e option1 del descrittore (il caso del ticket)', async () => {
    await click(mount(DownloadControl, inS2, 'S2'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const b = sent();
    expect(b.get('action')).toBe('FileDownload');
    expect(b.get('sid')).toBe('S2');
    expect(b.get('navpath')).toBe('S2-0.0');
    expect(b.get('option1')).toBe('downloadXls.S2-0');
  });

  it('sid ripetuto una volta sola nel corpo', async () => {
    await click(mount(DownloadControl, inS2, 'S2'));
    expect(sent().getAll('sid')).toEqual(['S2']);
  });

  it('`action` del descrittore al posto di `command`', async () => {
    await click(mount(DownloadControl, { ...inS2, command: undefined, action: 'AltroDownload' }, 'S3'));
    expect(sent().get('action')).toBe('AltroDownload');
    expect(sent().get('sid')).toBe('S3');
  });

  it('senza navpath e controlName: le chiavi non partono, il sid si', async () => {
    await click(mount(DownloadControl, { command: 'FileDownload' }, 'S2'));
    const b = sent();
    expect(b.has('navpath')).toBe(false);
    expect(b.has('option1')).toBe(false);
    expect(b.get('sid')).toBe('S2');
  });

  it('file vero: salvato col nome della content-disposition, nessun errore', async () => {
    await click(mount(DownloadControl, inS2, 'S2'));
    expect(saved.map((s) => s.name)).toEqual(['Bilancio.xls']);
    expect(fb.errors).toEqual([]);
  });

  it('200 a corpo vuoto: errore via useFeedback e nessun file', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 200 }));
    await click(mount(DownloadControl, inS2, 'S2'));
    expect(saved).toEqual([]);
    expect(fb.errors).toHaveLength(1);
    expect(String(fb.errors[0]).trim()).not.toBe('');
  });

  it('busta errors: il messaggio del server via useFeedback', async () => {
    fetchMock.mockImplementation(async () => new Response(
      JSON.stringify({ errors: [{ type: 'ERROR', message: 'Bilancio non calcolato' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    await click(mount(DownloadControl, inS2, 'S2'));
    expect(fb.errors).toEqual(['Bilancio non calcolato']);
    expect(saved).toEqual([]);
  });

  it('messaggio del server vuoto: l\'utente legge comunque un testo', async () => {
    fetchMock.mockImplementation(async () => new Response(
      JSON.stringify({ errors: [{ message: '' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    await click(mount(DownloadControl, inS2, 'S2'));
    expect(fb.errors).toHaveLength(1);
    expect(String(fb.errors[0]).trim()).not.toBe('');
  });

  it('invisibile o senza comando: niente pulsante', () => {
    expect(mount(DownloadControl, { ...inS2, visible: false }, 'S2')).toBeNull();
    expect(mount(DownloadControl, { navpath: 'S2-0.0' }, 'S2')).toBeNull();
  });
});

/* ── AttachmentsControl ────────────────────────────────────────────────── */

describe('SXADV-5947: link di download di AttachmentsControl', () => {
  const control = {
    type: 'attachments', downloadCommand: 'DocDownload',
    items: [{ key: 'K1', fileName: 'contratto.pdf' }, { key: 'K2', fileName: 'visura.pdf' }],
  } as unknown as Partial<UIControl>;
  const isLink = (e: El) => e.type === 'a';

  it('in S2 parte sid=S2, non S1', async () => {
    await click(mount(AttachmentsControl, control, 'S2'), isLink);
    expect(sent().get('sid')).toBe('S2');
  });

  it('in S1 parte sid=S1', async () => {
    await click(mount(AttachmentsControl, control, 'S1'), isLink);
    expect(sent().get('sid')).toBe('S1');
  });

  it('il comando, la key della riga e /controller2 restano', async () => {
    await click(mount(AttachmentsControl, control, 'S2'), isLink);
    const b = sent();
    expect(b.get('action')).toBe('DocDownload');
    expect(b.get('key')).toBe('K1');
    expect(sentUrl()).toBe('/entrasp/controller2');
  });

  it('il clic non segue href="#"', async () => {
    const ev = await click(mount(AttachmentsControl, control, 'S2'), isLink);
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('senza content-disposition il file prende il nome dell\'allegato', async () => {
    fetchMock.mockImplementation(async () => new Response(new Uint8Array([1]), { status: 200 }));
    await click(mount(AttachmentsControl, control, 'S2'), isLink);
    expect(saved.map((s) => s.name)).toEqual(['contratto.pdf']);
  });

  it('200 a corpo vuoto: errore via useFeedback e nessun file', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 200 }));
    await click(mount(AttachmentsControl, control, 'S2'), isLink);
    expect(saved).toEqual([]);
    expect(fb.errors).toHaveLength(1);
    expect(String(fb.errors[0]).trim()).not.toBe('');
  });

  it('invisibile o senza righe: niente; senza comando: nessun link', () => {
    expect(mount(AttachmentsControl, { ...control, visible: false }, 'S2')).toBeNull();
    expect(mount(AttachmentsControl, { ...control, items: [] } as Partial<UIControl>, 'S2')).toBeNull();
    const senza = mount(AttachmentsControl, { ...control, downloadCommand: undefined } as Partial<UIControl>, 'S2');
    expect(find(senza, isLink)).toBeNull();
  });
});
