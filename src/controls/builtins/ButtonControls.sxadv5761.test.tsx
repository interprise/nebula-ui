import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UIControl } from '../../types/ui';

// SXADV-5761 — campo file di "Carica da File Excel" (tipo `upload`,
// FileUploadUIControl). Legacy: scegliere il file NON manda niente; il file
// sale col Salva. Qui: la scelta registra il file in attesa per il sid
// (services/pendingUpload) e ne mostra il nome; il nome segue il negozio.
// `uploadButton` (UploadButtonUIControl, archivio documentale) resta com'e':
// carica subito e poi Post / CdmsEdit.
//
// Niente DOM nel progetto (ne' jsdom ne' testing-library): i componenti si
// eseguono con un motore di hook minimo che esegue anche gli effetti e
// useSyncExternalStore; l'albero restituito si visita come dati. La scelta del
// file si simula chiamando il beforeUpload dell'<Upload> antd (o, se il
// componente cambiasse strada, onChange di Upload / di un <input type=file>).

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

const api = vi.hoisted(() => ({
  calls: [] as { file: File; sid: string; params: Record<string, string>; action: string }[],
  next: [] as unknown[],
}));
vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  uploadFile: async (file: File, sid: string, params: Record<string, string> = {}, action = 'FileUpload') => {
    api.calls.push({ file, sid, params: { ...params }, action });
    return api.next.shift() ?? {};
  },
}));

const { UploadControl, UploadButtonControl } = await import('./ButtonControls');
const { SidContext } = await import('../../components/ViewRenderer');
const antd = await import('antd');
// Componenti antd: si lasciano come dati, non si eseguono.
const antdTypes = new Set<unknown>(Object.values(antd as Record<string, unknown>));
rt.sidCtx = SidContext;
// Percorso in variabile: se il modulo manca, falliscono solo i casi che lo usano.
const storePath = '../../services/pendingUpload';
const store = (await import(/* @vite-ignore */ storePath).catch(() => null)) as
  | typeof import('../../services/pendingUpload')
  | null;
const S = () => {
  if (!store) throw new Error('src/services/pendingUpload.ts non esiste');
  return store;
};

/* ── esecuzione dei componenti ─────────────────────────────────────────── */

interface El { type: unknown; props: Record<string, unknown> }
const isEl = (x: unknown): x is El => !!x && typeof x === 'object' && 'props' in (x as object) && 'type' in (x as object);

/** Esegue Comp e, dentro l'albero, i componenti-funzione "di casa" (non antd:
 *  quelli sono oggetti forwardRef/memo e non si eseguono). */
function expand(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(expand);
  if (!isEl(node)) return node;
  const t = node.type as { name?: string } | string;
  if (typeof t === 'function' && !antdTypes.has(t)) {
    return expand((t as unknown as (p: unknown) => unknown)(node.props));
  }
  const children = node.props.children;
  return { ...node, props: { ...node.props, children: children === undefined ? undefined : expand(children) } };
}

interface Mounted {
  tree: unknown;
  render: () => void;
  unmount: () => void;
  actions: { action: string; params?: Record<string, string> }[];
}

function mount(Comp: unknown, control: Partial<UIControl>, sid = 'S1'): Mounted {
  const actions: Mounted['actions'] = [];
  const full = { name: 'fileExcel.S1-3', id: 'fileExcel', ...control } as UIControl;
  const props = { control: full, onAction: (action: string, params?: Record<string, string>) => { actions.push({ action, params }); }, onChange: () => {} };
  const m: Mounted = {
    tree: null,
    actions,
    render: () => {
      for (let n = 0; n < 20; n++) {
        rt.active = true;
        rt.i = 0;
        rt.dirty = false;
        rt.sid = sid;
        rt.effects = [];
        try {
          m.tree = expand((Comp as (p: unknown) => unknown)(props));
        } finally {
          rt.active = false;
        }
        const eff = rt.effects;
        rt.effects = [];
        for (const e of eff) e();
        if (!rt.dirty) return;
      }
      throw new Error('render non si stabilizza');
    },
    unmount: () => {
      for (const s of rt.slots) {
        if (typeof s.cleanup === 'function') s.cleanup();
        const v = s.v as { off?: () => void } | undefined;
        if (v && typeof v === 'object' && typeof v.off === 'function') v.off();
      }
      rt.slots = [];
    },
  };
  rt.slots = [];
  m.render();
  return m;
}

function walk(node: unknown, f: (e: El) => void) {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, f)); return; }
  if (!isEl(node)) return;
  f(node);
  walk(node.props.children, f);
}

function textOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (isEl(node)) return textOf(node.props.children);
  return '';
}

/** Sceglie un file come farebbe l'input nascosto di antd Upload. */
async function choose(m: Mounted, file: File) {
  let done = false;
  const tasks: Promise<unknown>[] = [];
  walk(m.tree, (e) => {
    if (done) return;
    const p = e.props;
    if (typeof p.beforeUpload === 'function') {
      done = true;
      tasks.push(Promise.resolve((p.beforeUpload as AnyFn)(...([file, [file]] as never[]))));
      // Se beforeUpload non lo ferma, antd chiamerebbe onChange.
      if (typeof p.onChange === 'function') {
        tasks.push(Promise.resolve((p.onChange as AnyFn)(...([{ file: { originFileObj: file, name: file.name, status: 'done' }, fileList: [] }] as never[]))));
      }
    } else if (typeof p.customRequest === 'function') {
      done = true;
      tasks.push(Promise.resolve((p.customRequest as AnyFn)(...([{ file, onSuccess: () => {}, onError: () => {} }] as never[]))));
    } else if (e.type === 'input' && p.type === 'file' && typeof p.onChange === 'function') {
      done = true;
      tasks.push(Promise.resolve((p.onChange as AnyFn)(...([{ target: { files: [file], value: '' }, currentTarget: { files: [file], value: '' } }] as never[]))));
    }
  });
  if (!done) throw new Error('nessun punto di scelta del file trovato nell\'albero');
  await Promise.all(tasks);
  await new Promise((r) => setTimeout(r, 0));
  m.render();
}

const xlsx = (name = 'listino.xlsx') => new File(['dati'], name);

beforeEach(() => {
  api.calls = [];
  api.next = [];
  fb.shown = [];
  fb.errors = [];
  rt.slots = [];
  if (store) for (const sid of ['S1', 'S2']) store.clearPendingUpload(sid);
});

/* ── upload (FileUploadUIControl) ──────────────────────────────────────── */

describe('SXADV-5761: campo `upload` — la scelta non spedisce', () => {
  const control = { type: 'upload', controlName: 'fileExcel', navpath: 'S1-3', prompt: 'Scegli File' } as Partial<UIControl>;

  it('scelto il file: nessun uploadFile, nessuna onAction', async () => {
    const m = mount(UploadControl, control);
    await choose(m, xlsx());
    expect(api.calls).toHaveLength(0);
    expect(m.actions).toHaveLength(0);
  });

  it('scelto il file: registrato in attesa per il sid, con option1/navpath e FileUpload', async () => {
    const m = mount(UploadControl, control);
    const f = xlsx();
    await choose(m, f);
    const p = S().getPendingUpload('S1');
    expect(p?.file).toBe(f);
    expect(p?.params).toEqual({ option1: 'fileExcel', navpath: 'S1-3' });
    expect(p?.action).toBe('FileUpload');
  });

  it('il comando del controllo (uploadAction) sostituisce FileUpload', async () => {
    const m = mount(UploadControl, { ...control, uploadAction: 'CdmsUpload' } as Partial<UIControl>);
    await choose(m, xlsx());
    expect(S().getPendingUpload('S1')?.action).toBe('CdmsUpload');
  });

  it('solo le chiavi presenti: senza controlName/navpath i params sono vuoti', async () => {
    const m = mount(UploadControl, { type: 'upload' } as Partial<UIControl>);
    await choose(m, xlsx());
    const params = S().getPendingUpload('S1')?.params;
    expect(params).toEqual({});
  });

  it('il file va nel sid del SidContext, non in S1', async () => {
    const m = mount(UploadControl, control, 'S2');
    await choose(m, xlsx());
    expect(S().getPendingUpload('S2')?.file.name).toBe('listino.xlsx');
    expect(S().getPendingUpload('S1')).toBeUndefined();
  });

  it('un secondo file sostituisce il primo', async () => {
    const m = mount(UploadControl, control);
    await choose(m, xlsx('primo.xlsx'));
    await choose(m, xlsx('secondo.xlsx'));
    expect(S().getPendingUpload('S1')?.file.name).toBe('secondo.xlsx');
    expect(textOf(m.tree)).toContain('secondo.xlsx');
    expect(textOf(m.tree)).not.toContain('primo.xlsx');
  });

  it('mostra il nome del file scelto', async () => {
    const m = mount(UploadControl, control);
    expect(textOf(m.tree)).not.toContain('listino.xlsx');
    await choose(m, xlsx());
    expect(textOf(m.tree)).toContain('listino.xlsx');
  });

  it('il nome segue il negozio: tolto il file in attesa, il nome sparisce', async () => {
    const m = mount(UploadControl, control);
    await choose(m, xlsx());
    expect(textOf(m.tree)).toContain('listino.xlsx');
    S().clearPendingUpload('S1');
    m.render();
    expect(textOf(m.tree)).not.toContain('listino.xlsx');
  });

  it('il nome sparisce dopo un Salva riuscito (flush)', async () => {
    const m = mount(UploadControl, control);
    await choose(m, xlsx());
    const r = await S().flushPendingUpload('S1', 'Save', {});
    expect(r.ok).toBe(true);
    expect(api.calls).toHaveLength(1);
    m.render();
    expect(textOf(m.tree)).not.toContain('listino.xlsx');
  });

  it('rimontato con un file ancora in attesa per il suo sid: il nome ricompare', async () => {
    const m = mount(UploadControl, control);
    await choose(m, xlsx());
    m.unmount();
    const again = mount(UploadControl, control);
    expect(textOf(again.tree)).toContain('listino.xlsx');
  });

  it('file in attesa su un ALTRO sid: il nome non compare', () => {
    S().setPendingUpload('S2', { file: xlsx('altrui.xlsx'), params: {}, action: 'FileUpload' });
    const m = mount(UploadControl, control, 'S1');
    expect(textOf(m.tree)).not.toContain('altrui.xlsx');
  });

  it('la scelta impedisce l\'upload xhr di antd (beforeUpload non lascia passare)', async () => {
    const m = mount(UploadControl, control);
    let ret: unknown = 'non chiamato';
    walk(m.tree, (e) => {
      if (typeof e.props.beforeUpload === 'function' && ret === 'non chiamato') {
        ret = (e.props.beforeUpload as AnyFn)(...([xlsx(), []] as never[]));
      }
    });
    if (ret === 'non chiamato') return; // strada diversa da beforeUpload: niente xhr antd
    const v = await Promise.resolve(ret);
    expect(v === false || v === (await import('antd')).Upload.LIST_IGNORE).toBe(true);
  });
});

/* ── uploadButton (UploadButtonUIControl) ──────────────────────────────── */

describe('SXADV-5761: `uploadButton` resta com\'era — carica subito', () => {
  const control = { type: 'uploadButton', controlName: 'documento', navpath: 'S1-7' } as Partial<UIControl>;

  it('scelto il file: uploadFile subito, poi onAction(Post)', async () => {
    const m = mount(UploadButtonControl, control);
    const f = xlsx('doc.pdf');
    await choose(m, f);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ file: f, sid: 'S1', params: { option1: 'documento', navpath: 'S1-7' }, action: 'FileUpload' });
    expect(m.actions).toEqual([{ action: 'Post', params: undefined }]);
  });

  it('uploadAction del controllo usato come comando dell\'upload', async () => {
    const m = mount(UploadButtonControl, { ...control, uploadAction: 'CdmsUpload' } as Partial<UIControl>);
    await choose(m, xlsx('doc.pdf'));
    expect(api.calls[0].action).toBe('CdmsUpload');
  });

  it('cdmsKey nella risposta: onAction(CdmsEdit, {navpath})', async () => {
    api.next.push({ uiData: { cdmsKey: 'K-9' } });
    const m = mount(UploadButtonControl, control);
    await choose(m, xlsx('doc.pdf'));
    expect(m.actions).toEqual([{ action: 'CdmsEdit', params: { navpath: 'K-9' } }]);
  });

  it('errore dall\'upload: messaggi mostrati, nessuna onAction', async () => {
    api.next.push({ errors: [{ type: 'ERROR', message: 'troppo grande' }] });
    const m = mount(UploadButtonControl, control);
    await choose(m, xlsx('doc.pdf'));
    expect(m.actions).toHaveLength(0);
    expect(fb.shown).toHaveLength(1);
  });

  it('non registra un file in attesa', async () => {
    const m = mount(UploadButtonControl, control);
    await choose(m, xlsx('doc.pdf'));
    if (store) expect(store.getPendingUpload('S1')).toBeUndefined();
  });

  it('nel sid del SidContext', async () => {
    const m = mount(UploadButtonControl, control, 'S2');
    await choose(m, xlsx('doc.pdf'));
    expect(api.calls[0].sid).toBe('S2');
  });
});
