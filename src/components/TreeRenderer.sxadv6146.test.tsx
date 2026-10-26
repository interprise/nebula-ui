import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UITree } from '../types/ui';

// SXADV-6146.1: albero con dettaglio (Piano dei conti e simili). Si apre un
// nodo, il pannello di destra si carica (LocateAndNavigate); si passa a
// un'altra scheda e si torna: albero richiuso, nessun nodo scelto, pannello
// sparito. Nella Shell e' montata solo la vista della scheda corrente, quindi
// TreeRenderer SMONTA lasciando la scheda e RIMONTA tornando, con lo stesso
// oggetto `ui`. Il contratto:
//
//  - rimontato con lo stesso `ui`: riparte da dov'era (nodi aperti e caricati,
//    dati dell'albero, ricerca, nodo scelto, pannello, valori del pannello)
//    SENZA chiedere niente al server;
//  - montato con un `ui` nuovo (funzione riaperta dal menu): come prima,
//    niente scelto, niente pannello.
//
// Come si prova. Nel progetto non c'e' un DOM (niente jsdom ne'
// testing-library), quindi lo stesso motore di hook di
// Shell.staleTemplateKey.test.tsx: il componente si esegue come funzione,
// stato e ref vivono per ordine di chiamata. In piu', qui, gli EFFETTI girano
// (dopo ogni disegno, se le dipendenze cambiano) e smontare chiama le loro
// pulizie e butta via lo stato: e' quello che fa React lasciando la scheda.
// Dal JSX restituito si leggono le props vere di <Tree>, <Input> e del
// pannello, e si guidano i loro gestori come farebbe l'utente.

const rt = vi.hoisted(() => ({
  active: false,
  i: 0,
  slots: [] as { v: unknown }[],
  pending: [] as (() => void)[],
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
  const changed = (a: unknown[] | undefined, b: unknown[] | undefined) =>
    !a || !b || a.length !== b.length || a.some((x, k) => !Object.is(x, b[k]));
  // Effetto: gira dopo il disegno se le dipendenze sono cambiate; la pulizia
  // precedente prima, come React.
  const effect = (fn: () => void | (() => void), deps?: unknown[]) => {
    const s = slot(() => ({ deps: undefined as unknown[] | undefined, cleanup: undefined as unknown, first: true }));
    const st = s.v as { deps?: unknown[]; cleanup?: unknown; first: boolean };
    if (st.first || changed(st.deps, deps)) {
      st.first = false;
      st.deps = deps;
      rt.pending.push(() => {
        if (typeof st.cleanup === 'function') (st.cleanup as () => void)();
        st.cleanup = fn();
      });
    }
  };
  const memo = (f: () => unknown, deps?: unknown[]) => {
    const s = slot(() => ({ deps: undefined as unknown[] | undefined, v: undefined as unknown, first: true }));
    const st = s.v as { deps?: unknown[]; v: unknown; first: boolean };
    if (st.first || changed(st.deps, deps)) {
      st.first = false;
      st.deps = deps;
      st.v = f();
    }
    return st.v;
  };
  const over = {
    useState: on(actual.useState as AnyFn, ((init: unknown) => {
      const s = slot(() => (typeof init === 'function' ? (init as () => unknown)() : init));
      const set = (nv: unknown) => {
        s.v = typeof nv === 'function' ? (nv as (p: unknown) => unknown)(s.v) : nv;
      };
      return [s.v, set];
    }) as AnyFn),
    useRef: on(actual.useRef as AnyFn, ((init: unknown) => slot(() => ({ current: init })).v) as AnyFn),
    useCallback: on(actual.useCallback as AnyFn, ((fn: AnyFn, deps?: unknown[]) => memo(() => fn, deps)) as AnyFn),
    useMemo: on(actual.useMemo as AnyFn, memo as AnyFn),
    useEffect: on(actual.useEffect as AnyFn, effect as AnyFn),
    useLayoutEffect: on(actual.useLayoutEffect as AnyFn, effect as AnyFn),
    useContext: on(actual.useContext as AnyFn, ((c: { _currentValue: unknown }) => c._currentValue) as AnyFn),
  };
  return { ...actual, ...over, default: { ...actual, ...over } };
});

// ViewRenderer e' enorme ed estraneo: qui servono i contesti e il pannello,
// che resta un segnaposto riconoscibile nel JSX.
const pane = vi.hoisted(() => ({
  Pane: function DetailPaneStub() { return null; },
  toolbars: [] as unknown[],
  // i valori della scheda, come li legge il getter di FormValuesContext
  formValues: {} as Record<string, string | string[]>,
}));
vi.mock('./ViewRenderer', () => ({
  SidContext: { _currentValue: 'S1' },
  PaneToolbarContext: { _currentValue: (tb: unknown) => { pane.toolbars.push(tb); } },
  PendingAddContext: { _currentValue: () => false },
  FormValuesContext: { _currentValue: () => pane.formValues },
  useIsTabLabelEcho: () => false,
  default: pane.Pane,
}));

// Il server: si registra cosa parte, si risponde quello che il caso prepara.
const server = vi.hoisted(() => ({
  calls: [] as { action: string; params: Record<string, string> }[],
  reply: (() => ({})) as (action: string, params: Record<string, string>) => unknown,
}));
vi.mock('../services/api', () => ({
  postAction: async (action: string, params: Record<string, string>) => {
    server.calls.push({ action, params: { ...params } });
    return server.reply(action, params);
  },
}));

const { default: TreeRenderer } = await import('./TreeRenderer');
const { Tree, Input } = await import('antd');

Object.assign(globalThis, {
  document: (globalThis as { document?: unknown }).document ?? { body: { style: {} } },
});

// ───────────────────────────────────────────────────────── motore di montaggio
type El = { type: unknown; props: Record<string, unknown> };

let tree: El | null = null;
const noop = () => {};
// onChange della scheda: come la Shell, scrive nei formValues della scheda.
const tabOnChange = (name: string, value: unknown) => {
  pane.formValues[name] = value == null ? '' : String(value);
};
const props = (ui: UITree) => ({ ui, onAction: noop, onChange: tabOnChange });

function render(ui: UITree): void {
  rt.active = true;
  rt.i = 0;
  try {
    tree = (TreeRenderer as unknown as (p: ReturnType<typeof props>) => El)(props(ui));
  } finally {
    rt.active = false;
  }
  const run = rt.pending;
  rt.pending = [];
  run.forEach((f) => f());
}

/** Monta da zero: stato nuovo, come React rientrando sulla scheda. */
function mount(ui: UITree): void {
  rt.slots = [];
  render(ui);
}

/** Smonta: pulizie degli effetti e stato buttato. */
function unmount(): void {
  for (const s of rt.slots) {
    const st = s.v as { cleanup?: unknown } | null;
    if (st && typeof st === 'object' && 'cleanup' in st && typeof st.cleanup === 'function') {
      (st.cleanup as () => void)();
    }
  }
  rt.slots = [];
  tree = null;
}

function find(node: unknown, type: unknown): El | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = find(n, type);
      if (f) return f;
    }
    return undefined;
  }
  const el = node as El;
  if (el.type === type) return el;
  return el.props ? find(el.props.children, type) : undefined;
}

const treeEl = () => find(tree, Tree);
const paneEl = () => find(tree, pane.Pane);
const inputEl = () => find(tree, Input);

/** Il disegno dopo un gestore: le promesse girano, poi si ridisegna. */
async function settle(ui: UITree): Promise<void> {
  for (let k = 0; k < 5; k++) await Promise.resolve();
  render(ui);
}

// ───────────────────────────────────────────────────────────── dati tipo
function treeUi(): UITree {
  return {
    rows: [],
    path: 'S1-3',
    viewName: 'pianoContiTree',
    navigateView: 'pianoContiDetail',
    title: 'Piano dei conti',
    treeNodes: [
      { key: 'S1-3.0', title: 'Attivita' },
      { key: 'S1-3.1', title: 'Passivita' },
    ],
  } as unknown as UITree;
}

function paneUi(key: string): UITree {
  return {
    rows: [{
      id: 'r0',
      cells: [{ elementType: 1, control: { name: 'descrizione', id: 'descrizione', type: 'text', editable: true, value: `Conto ${key}` } }],
    }],
    path: 'S1-4',
    viewName: 'pianoContiDetail',
    title: `Conto ${key}`,
  } as unknown as UITree;
}

beforeEach(() => {
  server.calls = [];
  pane.toolbars = [];
  pane.formValues = {};
  server.reply = (action, params) => {
    if (action === 'LocateAndNavigate') return { ui: paneUi(params.navpath), toolbar: [{ id: 'save', text: 'Salva' }] };
    if (action === 'LoadTreeChildren') {
      return { ui: { treeChildren: [{ key: `${params.option1}.0`, title: 'Cassa', isLeaf: true }] } };
    }
    if (action === 'FilterTree') {
      return { ui: { treeNodes: [{ key: 'S1-3.0', title: 'Attivita', children: [{ key: 'S1-3.0.0', title: 'Cassa', isLeaf: true, matched: true }] }] } };
    }
    return {};
  };
});

afterEach(() => {
  vi.useRealTimers();
  unmount();
});

/** Apre un nodo: clic sull'albero, risposta del pannello, ridisegno. */
async function clicNodo(ui: UITree, key: string): Promise<void> {
  const onSelect = treeEl()!.props.onSelect as (keys: string[]) => Promise<void>;
  await onSelect([key]);
  await settle(ui);
}

// ───────────────────────────────────────────────────────────── i casi
describe('TreeRenderer: stato dell\'albero fra una scheda e l\'altra (SXADV-6146.1)', () => {
  it('prima volta: niente scelto, niente pannello (come prima)', () => {
    mount(treeUi());
    expect(treeEl()!.props.selectedKeys).toEqual([]);
    expect(treeEl()!.props.expandedKeys).toEqual([]);
    expect(paneEl()).toBeUndefined();
    expect(server.calls).toEqual([]);
  });

  it('il clic su un nodo carica il pannello (premessa)', async () => {
    const ui = treeUi();
    mount(ui);
    await clicNodo(ui, 'S1-3.1');
    expect(server.calls.map((c) => c.action)).toEqual(['LocateAndNavigate']);
    expect(treeEl()!.props.selectedKeys).toEqual(['S1-3.1']);
    expect((paneEl()!.props.ui as UITree).title).toBe('Conto S1-3.1');
  });

  it('via e ritorno con lo stesso ui: stesso nodo, stesso pannello, nessuna richiesta', async () => {
    const ui = treeUi();
    mount(ui);
    await clicNodo(ui, 'S1-3.1');
    const pannello = paneEl()!.props.ui;
    unmount();

    server.calls = [];
    mount(ui);
    await settle(ui);
    expect(treeEl()!.props.selectedKeys).toEqual(['S1-3.1']);
    expect(paneEl()).toBeDefined();
    expect(paneEl()!.props.ui).toBe(pannello);
    expect(server.calls).toEqual([]);
  });

  it('nodi aperti e figli caricati restano; nessun LoadTreeChildren al ritorno', async () => {
    const ui = treeUi();
    mount(ui);
    const t = treeEl()!;
    (t.props.onExpand as (k: string[]) => void)(['S1-3.0']);
    render(ui);
    await (treeEl()!.props.loadData as (n: { key: string }) => Promise<void>)({ key: 'S1-3.0' });
    await settle(ui);
    expect(treeEl()!.props.loadedKeys).toEqual(['S1-3.0']);
    unmount();

    server.calls = [];
    mount(ui);
    await settle(ui);
    const back = treeEl()!;
    expect(back.props.expandedKeys).toEqual(['S1-3.0']);
    expect(back.props.loadedKeys).toEqual(['S1-3.0']);
    const data = back.props.treeData as { key: string; children?: { key: string }[] }[];
    expect(data[0].children?.map((c) => c.key)).toEqual(['S1-3.0.0']);
    expect(server.calls).toEqual([]);
  });

  it('la ricerca resta: testo nel campo e albero filtrato', async () => {
    vi.useFakeTimers();
    const ui = treeUi();
    mount(ui);
    (inputEl()!.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'cas' } });
    await vi.advanceTimersByTimeAsync(500);
    await settle(ui);
    expect(server.calls.map((c) => c.action)).toEqual(['FilterTree']);
    unmount();

    server.calls = [];
    mount(ui);
    await settle(ui);
    expect(inputEl()!.props.value).toBe('cas');
    const data = treeEl()!.props.treeData as { key: string; children?: { key: string }[] }[];
    expect(data.map((n) => n.key)).toEqual(['S1-3.0']);
    expect(data[0].children?.map((c) => c.key)).toEqual(['S1-3.0.0']);
    expect(treeEl()!.props.expandedKeys).toEqual(['S1-3.0']);
    expect(server.calls).toEqual([]);
  });

  it('i valori del pannello, anche quelli battuti, tornano con la scheda', async () => {
    const { recallTree } = await import('./treeMemory');
    const ui = treeUi();
    mount(ui);
    await clicNodo(ui, 'S1-3.0');
    expect(recallTree(ui)?.detailFormValues).toEqual({ descrizione: 'Conto S1-3.0' });
    // l'utente batte nel pannello
    (paneEl()!.props.onChange as (n: string, v: unknown) => void)('descrizione', 'Cassa contanti');
    render(ui);
    unmount();

    mount(ui);
    await settle(ui);
    expect(recallTree(ui)?.detailFormValues).toEqual({ descrizione: 'Cassa contanti' });
    expect(paneEl()).toBeDefined();
  });

  it('due nodi di fila: al ritorno c\'e\' l\'ultimo', async () => {
    const ui = treeUi();
    mount(ui);
    await clicNodo(ui, 'S1-3.0');
    await clicNodo(ui, 'S1-3.1');
    unmount();

    mount(ui);
    await settle(ui);
    expect(treeEl()!.props.selectedKeys).toEqual(['S1-3.1']);
    expect((paneEl()!.props.ui as UITree).title).toBe('Conto S1-3.1');
  });

  it('ui nuovo (funzione riaperta dal menu), anche identico: si riparte da zero', async () => {
    const ui = treeUi();
    mount(ui);
    (treeEl()!.props.onExpand as (k: string[]) => void)(['S1-3.0']);
    render(ui);
    await clicNodo(ui, 'S1-3.1');
    unmount();

    const nuovo = treeUi();
    server.calls = [];
    mount(nuovo);
    await settle(nuovo);
    expect(treeEl()!.props.selectedKeys).toEqual([]);
    expect(treeEl()!.props.expandedKeys).toEqual([]);
    expect(paneEl()).toBeUndefined();
    expect(server.calls).toEqual([]);
  });

  it('dopo aver riaperto dal menu, tornare sulla scheda vecchia non resuscita il pannello nella nuova', async () => {
    const ui = treeUi();
    mount(ui);
    await clicNodo(ui, 'S1-3.1');
    unmount();
    const nuovo = treeUi();
    mount(nuovo);
    await settle(nuovo);
    unmount();
    mount(nuovo);
    await settle(nuovo);
    expect(paneEl()).toBeUndefined();
    expect(treeEl()!.props.selectedKeys).toEqual([]);
  });
});

// ───────────────────────────────────────────── contratto A: il digitato a video
// Pannello con un testo, una scelta da elenco remoto (didascalia stringa), una
// scelta multipla (didascalia array) e un campo in sola lettura.
type Ctrl = { name: string; value?: unknown; displayText?: string; selectedItems?: unknown };

function richPaneUi(key: string): UITree {
  const cell = (control: Record<string, unknown>) => ({ elementType: 1, control });
  return {
    rows: [
      { id: 'r0', cells: [cell({ name: 'descrizione', id: 'descrizione', type: 'text', editable: true, value: `Conto ${key}` })] },
      { id: 'r1', cells: [cell({ name: 'conto', id: 'conto', type: 'combo', editable: true, value: '0101', displayText: '0101 - Cassa' })] },
      { id: 'r2', cells: [cell({ name: 'centri', id: 'centri', type: 'multiselect', editable: true, value: 'A', selectedItems: [{ value: 'A', text: 'Centro A' }] })] },
      { id: 'r3', cells: [cell({ name: 'codice', id: 'codice', type: 'text', editable: true, value: key })] },
    ],
    path: 'S1-4',
    viewName: 'pianoContiDetail',
    title: `Conto ${key}`,
  } as unknown as UITree;
}

function ctrlOf(ui: unknown, name: string): Ctrl {
  for (const row of (ui as UITree).rows ?? []) {
    for (const c of row.cells) {
      const ctrl = c.control as unknown as Ctrl | undefined;
      if (ctrl?.name === name) return ctrl;
    }
  }
  throw new Error(`controllo ${name} assente`);
}

describe('TreeRenderer: il pannello ritrovato mostra il digitato non salvato (SXADV-6146.1 A)', () => {
  beforeEach(() => {
    server.reply = (action, params) =>
      action === 'LocateAndNavigate' ? { ui: richPaneUi(params.navpath), toolbar: [] } : {};
  });

  it('valore battuto e non salvato: il pannello rimontato lo mostra', async () => {
    const ui = treeUi();
    mount(ui);
    await clicNodo(ui, 'S1-3.0');
    (paneEl()!.props.onChange as (n: string, v: unknown) => void)('descrizione', 'Cassa contanti');
    render(ui);
    unmount();

    mount(ui);
    await settle(ui);
    expect(ctrlOf(paneEl()!.props.ui, 'descrizione').value).toBe('Cassa contanti');
    expect(server.calls.filter((c) => c.action === 'LocateAndNavigate')).toHaveLength(1);
  });

  it('i valori della scheda letti al montaggio vincono (anche scritti mentre si era via)', async () => {
    const ui = treeUi();
    mount(ui);
    await clicNodo(ui, 'S1-3.0');
    unmount();
    // la scheda tiene i suoi formValues: e' quello che il getter restituisce
    pane.formValues = { ...pane.formValues, descrizione: 'Battuto altrove' };

    mount(ui);
    await settle(ui);
    expect(ctrlOf(paneEl()!.props.ui, 'descrizione').value).toBe('Battuto altrove');
  });

  it('scelta da elenco remoto: torna il codice e la didascalia (displayText)', async () => {
    const ui = treeUi();
    mount(ui);
    await clicNodo(ui, 'S1-3.0');
    (paneEl()!.props.onChange as (n: string, v: unknown, c?: unknown) => void)('conto', '0202', '0202 - Banca');
    render(ui);
    unmount();

    mount(ui);
    await settle(ui);
    const conto = ctrlOf(paneEl()!.props.ui, 'conto');
    expect(conto.value).toBe('0202');
    expect(conto.displayText).toBe('0202 - Banca');
  });

  it('scelta multipla: torna la lista delle voci scelte (selectedItems)', async () => {
    const ui = treeUi();
    mount(ui);
    await clicNodo(ui, 'S1-3.0');
    const scelte = [{ value: 'A', text: 'Centro A' }, { value: 'B', text: 'Centro B' }];
    (paneEl()!.props.onChange as (n: string, v: unknown, c?: unknown) => void)('centri', 'A,B', scelte);
    render(ui);
    unmount();

    mount(ui);
    await settle(ui);
    const centri = ctrlOf(paneEl()!.props.ui, 'centri');
    expect(centri.value).toBe('A,B');
    expect(centri.selectedItems).toEqual(scelte);
  });

  it('valore uguale a quello del server: il controllo resta com\'era', async () => {
    const ui = treeUi();
    mount(ui);
    await clicNodo(ui, 'S1-3.0');
    const prima = paneEl()!.props.ui;
    // la scheda ha i valori del server (come dopo la risposta), niente di battuto
    pane.formValues = { descrizione: 'Conto S1-3.0', conto: '0101', centri: 'A', codice: 'S1-3.0' };
    unmount();

    mount(ui);
    await settle(ui);
    const dopo = paneEl()!.props.ui;
    for (const n of ['descrizione', 'conto', 'centri', 'codice']) {
      expect(ctrlOf(dopo, n)).toEqual(ctrlOf(prima, n));
    }
    expect(ctrlOf(dopo, 'conto').displayText).toBe('0101 - Cassa');
  });

  it('solo i campi cambiati prendono il valore della scheda', async () => {
    const ui = treeUi();
    mount(ui);
    await clicNodo(ui, 'S1-3.0');
    (paneEl()!.props.onChange as (n: string, v: unknown, c?: unknown) => void)('conto', '0202', '0202 - Banca');
    render(ui);
    unmount();

    mount(ui);
    await settle(ui);
    const dopo = paneEl()!.props.ui;
    expect(ctrlOf(dopo, 'descrizione').value).toBe('Conto S1-3.0');
    expect(ctrlOf(dopo, 'codice').value).toBe('S1-3.0');
    expect(ctrlOf(dopo, 'centri').selectedItems).toEqual([{ value: 'A', text: 'Centro A' }]);
  });

  it('didascalia di un nodo precedente non si incolla al pannello del nodo nuovo', async () => {
    const ui = treeUi();
    mount(ui);
    await clicNodo(ui, 'S1-3.0');
    (paneEl()!.props.onChange as (n: string, v: unknown, c?: unknown) => void)('conto', '0202', '0202 - Banca');
    render(ui);
    await clicNodo(ui, 'S1-3.1');
    // la scheda, alla risposta del nodo nuovo, torna ai valori del server
    pane.formValues = { descrizione: 'Conto S1-3.1', conto: '0101', centri: 'A', codice: 'S1-3.1' };
    unmount();

    mount(ui);
    await settle(ui);
    const conto = ctrlOf(paneEl()!.props.ui, 'conto');
    expect(conto.value).toBe('0101');
    expect(conto.displayText).toBe('0101 - Cassa');
  });
});

// ───────────────────────────────────── contratto B: uscita con richiesta in volo
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('TreeRenderer: uscita con una richiesta del pannello in volo (SXADV-6146.1 B)', () => {
  it('clic su un nodo e via prima della risposta: al ritorno niente selezione, niente pannello', async () => {
    const ui = treeUi();
    mount(ui);
    (treeEl()!.props.onExpand as (k: string[]) => void)(['S1-3.0']);
    render(ui);
    await clicNodo(ui, 'S1-3.0'); // primo pannello, arrivato

    const d = deferred<unknown>();
    server.reply = () => d.promise;
    const inVolo = (treeEl()!.props.onSelect as (k: string[]) => Promise<void>)(['S1-3.1']);
    render(ui);
    unmount();
    d.resolve({ ui: paneUi('S1-3.1'), toolbar: [] });
    await inVolo;

    server.calls = [];
    mount(ui);
    await settle(ui);
    expect(treeEl()!.props.selectedKeys).toEqual([]);
    expect(paneEl()).toBeUndefined();
    expect(treeEl()!.props.expandedKeys).toEqual(['S1-3.0']);
    expect(server.calls).toEqual([]);
  });

  it('in volo durante una ricerca: la ricerca resta', async () => {
    vi.useFakeTimers();
    const ui = treeUi();
    mount(ui);
    (inputEl()!.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'cas' } });
    await vi.advanceTimersByTimeAsync(500);
    await settle(ui);

    const d = deferred<unknown>();
    server.reply = () => d.promise;
    const inVolo = (treeEl()!.props.onSelect as (k: string[]) => Promise<void>)(['S1-3.0.0']);
    render(ui);
    unmount();
    d.resolve({ ui: paneUi('S1-3.0.0'), toolbar: [] });
    await inVolo;

    mount(ui);
    await settle(ui);
    expect(inputEl()!.props.value).toBe('cas');
    expect((treeEl()!.props.treeData as { key: string }[]).map((n) => n.key)).toEqual(['S1-3.0']);
    expect(treeEl()!.props.selectedKeys).toEqual([]);
    expect(paneEl()).toBeUndefined();
  });

  it('rientro in modifica dopo un Salva ancora in volo: al ritorno niente pannello', async () => {
    const ui = treeUi();
    mount(ui);
    await clicNodo(ui, 'S1-3.0');

    // Salva dal pannello: la Shell ridisegna la stessa resa con il dettaglio
    // allegato (stesso oggetto ui: la scheda lo tiene)
    const d = deferred<unknown>();
    server.reply = () => d.promise;
    (ui as unknown as Record<string, unknown>)._detailResponse = paneUi('S1-3.0');
    server.calls = [];
    render(ui);
    expect(server.calls.map((c) => c.action)).toEqual(['LocateAndNavigate']);
    unmount();
    d.resolve({ ui: paneUi('S1-3.0'), toolbar: [] });
    for (let k = 0; k < 5; k++) await Promise.resolve();

    mount(ui);
    expect(treeEl()!.props.selectedKeys).toEqual([]);
    expect(paneEl()).toBeUndefined();
  });

  it('richiesta finita prima di uscire: si ritrova tutto come al solito', async () => {
    const ui = treeUi();
    mount(ui);
    const d = deferred<unknown>();
    server.reply = () => d.promise;
    const inVolo = (treeEl()!.props.onSelect as (k: string[]) => Promise<void>)(['S1-3.1']);
    d.resolve({ ui: paneUi('S1-3.1'), toolbar: [] });
    await inVolo;
    await settle(ui);
    unmount();

    mount(ui);
    await settle(ui);
    expect(treeEl()!.props.selectedKeys).toEqual(['S1-3.1']);
    expect((paneEl()!.props.ui as UITree).title).toBe('Conto S1-3.1');
  });

  it('due clic, il primo arrivato e il secondo in volo all\'uscita: niente pannello vecchio col nodo nuovo', async () => {
    const ui = treeUi();
    mount(ui);
    const d1 = deferred<unknown>();
    const d2 = deferred<unknown>();
    const coda = [d1, d2];
    server.reply = () => coda.shift()!.promise;
    const p1 = (treeEl()!.props.onSelect as (k: string[]) => Promise<void>)(['S1-3.0']);
    render(ui);
    const p2 = (treeEl()!.props.onSelect as (k: string[]) => Promise<void>)(['S1-3.1']);
    d1.resolve({ ui: paneUi('S1-3.0'), toolbar: [] });
    await p1;
    render(ui);
    unmount();
    d2.resolve({ ui: paneUi('S1-3.1'), toolbar: [] });
    await p2;

    mount(ui);
    await settle(ui);
    expect(treeEl()!.props.selectedKeys).toEqual([]);
    expect(paneEl()).toBeUndefined();
  });
});

// ─────────────────────── contratto A con la radice vera del pannello
// La resa di LocateAndNavigate porta in RADICE pageType 2, layoutType
// 'vertical' e listEdit true (il flag della sua lista incorporata). Una radice
// cosi' sembra una lista, e una lista non si ritocca: dal vivo il digitato non
// tornava. Il pannello ritrovato deve mostrarlo E tenere i tre flag.
function realRootPaneUi(key: string): UITree {
  return { ...(richPaneUi(key) as unknown as Record<string, unknown>), pageType: 2, layoutType: 'vertical', listEdit: true } as unknown as UITree;
}

function rootFlags(ui: unknown) {
  const u = ui as { pageType?: unknown; layoutType?: unknown; listEdit?: unknown };
  return { pageType: u.pageType, layoutType: u.layoutType, listEdit: u.listEdit };
}

describe('TreeRenderer: pannello con la radice vera (pageType 2, vertical, listEdit) (SXADV-6146.1 A)', () => {
  beforeEach(() => {
    server.reply = (action, params) =>
      action === 'LocateAndNavigate' ? { ui: realRootPaneUi(params.navpath), toolbar: [] } : {};
  });

  it('valore battuto: il pannello rimontato lo mostra e tiene i flag della radice', async () => {
    const ui = treeUi();
    mount(ui);
    await clicNodo(ui, 'S1-3.0');
    (paneEl()!.props.onChange as (n: string, v: unknown) => void)('descrizione', 'Cassa contanti');
    render(ui);
    unmount();

    mount(ui);
    await settle(ui);
    const dopo = paneEl()!.props.ui;
    expect(ctrlOf(dopo, 'descrizione').value).toBe('Cassa contanti');
    expect(rootFlags(dopo)).toEqual({ pageType: 2, layoutType: 'vertical', listEdit: true });
  });

  it('scelta da elenco remoto: codice e didascalia tornano, flag intatti', async () => {
    const ui = treeUi();
    mount(ui);
    await clicNodo(ui, 'S1-3.0');
    (paneEl()!.props.onChange as (n: string, v: unknown, c?: unknown) => void)('conto', '0202', '0202 - Banca');
    render(ui);
    unmount();

    mount(ui);
    await settle(ui);
    const dopo = paneEl()!.props.ui;
    expect(ctrlOf(dopo, 'conto').value).toBe('0202');
    expect(ctrlOf(dopo, 'conto').displayText).toBe('0202 - Banca');
    expect(ctrlOf(dopo, 'descrizione').value).toBe('Conto S1-3.0');
    expect(rootFlags(dopo)).toEqual({ pageType: 2, layoutType: 'vertical', listEdit: true });
  });

  it('niente in sospeso: il pannello ritrovato e\' lo stesso oggetto ricordato', async () => {
    const ui = treeUi();
    mount(ui);
    await clicNodo(ui, 'S1-3.0');
    const prima = paneEl()!.props.ui;
    pane.formValues = { descrizione: 'Conto S1-3.0', conto: '0101', centri: 'A', codice: 'S1-3.0' };
    unmount();

    mount(ui);
    await settle(ui);
    expect(paneEl()!.props.ui).toBe(prima);
    expect(rootFlags(paneEl()!.props.ui)).toEqual({ pageType: 2, layoutType: 'vertical', listEdit: true });
  });
});
