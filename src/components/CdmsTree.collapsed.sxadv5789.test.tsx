import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';

// SXADV-5789 — col menu compresso l'albero del documentale non deve sparire: resta
// raggiungibile da un pulsante («Albero del documentale») che lo apre in un riquadro,
// e scegliere una cartella chiude il riquadro.
//
// Il progetto non ha jsdom ne' Testing Library: il componente si esegue con un motore
// di hook finto (come ritornoWidget.home.sxadv5999.test.tsx), effetti compresi, e
// l'albero di elementi si visita come dati. Per non legare la prova a COME e' fatto
// il riquadro: i sottocomponenti locali si eseguono anch'essi, e il contenuto di un
// sovrapposto (Popover `content`, Dropdown `popupRender`...) conta come visibile solo
// con `open` vero; l'albero e' l'elemento che ha la prop `treeData`.

const rt = vi.hoisted(() => ({
  active: false,
  i: 0,
  dirty: false,
  slots: [] as { v: unknown; set?: unknown }[],
  effects: [] as { st: { first: boolean; deps?: unknown[]; cleanup?: unknown }; fn: () => unknown; deps?: unknown[] }[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  type AnyFn = (...a: never[]) => unknown;
  const slot = (init: () => unknown) => {
    const i = rt.i++;
    if (!rt.slots[i]) rt.slots[i] = { v: init() };
    return rt.slots[i];
  };
  const same = (a?: unknown[], b?: unknown[]) =>
    !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
  const on = <F extends AnyFn>(real: F, fake: AnyFn): F =>
    ((...a: never[]) => (rt.active ? fake(...a) : real(...a))) as unknown as F;
  const effect = ((fn: () => unknown, deps?: unknown[]) => {
    const s = slot(() => ({ first: true, deps: undefined, cleanup: undefined }));
    const st = s.v as { first: boolean; deps?: unknown[]; cleanup?: unknown };
    if (st.first || !deps || !same(st.deps, deps)) rt.effects.push({ st, fn, deps });
  }) as AnyFn;
  const memo = (f: () => unknown, deps?: unknown[]) => {
    const s = slot(() => ({ deps: undefined, val: undefined, ok: false }));
    const st = s.v as { deps?: unknown[]; val: unknown; ok: boolean };
    if (!st.ok || !deps || !same(st.deps, deps)) {
      st.val = f();
      st.deps = deps;
      st.ok = true;
    }
    return st.val;
  };
  const over = {
    useState: on(actual.useState as AnyFn, ((init: unknown) => {
      const s = slot(() => (typeof init === 'function' ? (init as () => unknown)() : init));
      s.set ??= (nv: unknown) => {
        const n = typeof nv === 'function' ? (nv as (p: unknown) => unknown)(s.v) : nv;
        if (!Object.is(n, s.v)) { s.v = n; rt.dirty = true; }
      };
      return [s.v, s.set];
    }) as AnyFn),
    useRef: on(actual.useRef as AnyFn, ((init: unknown) => slot(() => ({ current: init })).v) as AnyFn),
    useCallback: on(actual.useCallback as AnyFn, ((fn: AnyFn, deps?: unknown[]) => memo(() => fn, deps)) as AnyFn),
    useMemo: on(actual.useMemo as AnyFn, memo as AnyFn),
    useEffect: on(actual.useEffect as AnyFn, effect),
    useLayoutEffect: on(actual.useLayoutEffect as AnyFn, effect),
    useContext: on(actual.useContext as AnyFn, ((c: { _currentValue: unknown }) => c._currentValue) as AnyFn),
    useId: on(actual.useId as AnyFn, (() => ':t:') as AnyFn),
  };
  return { ...actual, ...over, default: { ...actual, ...over } };
});

// antd e' fuori dal grafo mockato: il suo useApp userebbe il React vero.
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  const App = Object.assign(() => null, actual.App, {
    useApp: () => ({ modal: { confirm: () => ({}) }, message: {}, notification: {} }),
  });
  return { ...actual, App };
});

vi.mock('../hooks/feedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/feedback')>()),
  useFeedback: () => ({ error: () => {}, warning: () => {}, info: () => {}, failure: () => {}, showServerMessages: () => {} }),
}));

const server = vi.hoisted(() => ({ radici: 0, figli: [] as string[] }));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  cdmsGetRoots: async () => {
    server.radici++;
    return {
      admin: false,
      nodes: [
        { cdmsId: 'ROOT|anno', text: 'ANNO', leaf: false },
        { cdmsId: 'ROOT|tipo', text: 'TIPO DOCUMENTO', leaf: false },
      ],
    };
  },
  cdmsGetChildren: async (id: string) => {
    server.figli.push(id);
    return [{ cdmsId: `${id}|2026`, text: '2026', leaf: true }];
  },
}));

const noop = () => {};
const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;
g.document ??= {
  body: { style: {} },
  activeElement: null,
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: noop,
  removeEventListener: noop,
};
g.addEventListener ??= noop;
g.removeEventListener ??= noop;

const antd = await import('antd');
const { default: CdmsTree } = await import('./CdmsTree');

const DA_ANTD = new Set<unknown>(Object.values(antd));
const SOVRAPPOSTI = ['content', 'overlay', 'popupRender', 'dropdownRender'];

type El = ReactElement<Record<string, unknown>>;
type Nodo = { key: string; title: string; children?: Nodo[] };
type Props = { collapsed: boolean; onFolderClick: (id: string, nome: string) => void };

// I sottocomponenti eseguiti hanno ciascuno i propri slot di hook.
const banchi = new Map<unknown, { v: unknown }[]>();
let props: Props;
let visibili: El[] = [];
let genitori = new Map<El, El | undefined>();

function esegui(comp: (p: unknown) => unknown, p: unknown): unknown {
  const slots = rt.slots;
  const i = rt.i;
  if (!banchi.has(comp)) banchi.set(comp, []);
  rt.slots = banchi.get(comp)!;
  rt.i = 0;
  try {
    return comp(p);
  } finally {
    rt.slots = slots;
    rt.i = i;
  }
}

/** Solo quello che l'utente vede: un sovrapposto chiuso conta per il suo innesco. */
function visita(node: unknown, padre?: El): void {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) visita(n, padre);
    return;
  }
  const el = node as El;
  if (!el.props) return;
  if ((el.props.style as { display?: string } | undefined)?.display === 'none') return;
  const tipo = el.type as unknown;
  if (typeof tipo === 'function' && !DA_ANTD.has(tipo)) {
    visita(esegui(tipo as (p: unknown) => unknown, el.props), padre);
    return;
  }
  if ((tipo === antd.Modal || tipo === antd.Drawer) && !el.props.open) return;
  visibili.push(el);
  genitori.set(el, padre);
  visita(el.props.children, el);
  if (el.props.open === true) {
    for (const k of SOVRAPPOSTI) {
      const v = el.props[k];
      visita(typeof v === 'function' ? (v as (x: unknown) => unknown)(null) : v, el);
    }
  }
}

function disegna(): void {
  for (let giro = 0; giro < 40; giro++) {
    rt.dirty = false;
    rt.effects = [];
    rt.active = true;
    rt.i = 0;
    visibili = [];
    genitori = new Map();
    try {
      visita((CdmsTree as unknown as (p: Props) => unknown)(props));
    } finally {
      rt.active = false;
    }
    const daFare = rt.effects;
    rt.effects = [];
    for (const e of daFare) {
      if (typeof e.st.cleanup === 'function') (e.st.cleanup as () => void)();
      e.st.cleanup = e.fn();
      e.st.deps = e.deps;
      e.st.first = false;
    }
    if (!rt.dirty) return;
  }
  throw new Error('il componente non si stabilizza');
}

async function assesta(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    disegna();
    await new Promise((r) => setTimeout(r, 0));
  }
  disegna();
}

const pulsante = () => visibili.find((e) => e.props['aria-label'] === 'Albero del documentale');
const albero = () => visibili.find((e) => Array.isArray(e.props.treeData));
const radici = () => (albero()!.props.treeData as Nodo[]).map((n) => n.title);

/** Un clic: l'onClick del pulsante, o l'apertura del sovrapposto di cui e' l'innesco. */
async function clicPulsante(): Promise<void> {
  const b = pulsante();
  expect(b, 'il pulsante «Albero del documentale»').toBeDefined();
  if (typeof b!.props.onClick === 'function') {
    (b!.props.onClick as (e: unknown) => void)({ stopPropagation: noop, preventDefault: noop });
  } else {
    let su = genitori.get(b!);
    while (su && typeof su.props.onOpenChange !== 'function') su = genitori.get(su);
    expect(su, 'il sovrapposto del pulsante').toBeDefined();
    (su!.props.onOpenChange as (o: boolean) => void)(true);
  }
  await assesta();
}

async function seleziona(nodo: Nodo): Promise<void> {
  (albero()!.props.onSelect as (k: string[], i: { node: Nodo }) => void)([nodo.key], { node: nodo });
  await assesta();
}

// Riclicando la cartella gia' selezionata antd la deseleziona: onSelect con keys vuote.
async function riclicca(nodo: Nodo): Promise<void> {
  (albero()!.props.onSelect as (k: string[], i: { node: Nodo }) => void)([], { node: nodo });
  await assesta();
}

const onFolderClick = vi.fn();

async function monta(collapsed: boolean): Promise<void> {
  props = { collapsed, onFolderClick };
  await assesta();
}

beforeEach(() => {
  rt.slots = [];
  rt.effects = [];
  banchi.clear();
  server.radici = 0;
  server.figli.length = 0;
  onFolderClick.mockClear();
});

describe('SXADV-5789: albero del documentale col menu compresso', () => {
  it('8. c\'e\' il pulsante e, prima di cliccarlo, l\'albero non si vede', async () => {
    await monta(true);
    expect(pulsante()).toBeDefined();
    expect(albero()).toBeUndefined();
  });

  it('8. cliccandolo appare l\'albero con le radici', async () => {
    await monta(true);
    await clicPulsante();
    expect(albero(), 'l\'albero nel riquadro').toBeDefined();
    expect(radici()).toEqual(['ANNO', 'TIPO DOCUMENTO']);
  });

  it('8. scegliendo una cartella si chiama onFolderClick(cdmsId, testo) e il riquadro si chiude', async () => {
    await monta(true);
    await clicPulsante();
    const [anno] = albero()!.props.treeData as Nodo[];
    await seleziona(anno);
    expect(onFolderClick).toHaveBeenCalledTimes(1);
    expect(onFolderClick).toHaveBeenCalledWith('ROOT|anno', 'ANNO');
    expect(albero(), 'il riquadro chiuso').toBeUndefined();
    expect(pulsante(), 'il pulsante resta').toBeDefined();
  });

  it('8. il riquadro si riapre, con le radici gia\' caricate', async () => {
    await monta(true);
    await clicPulsante();
    const [anno] = albero()!.props.treeData as Nodo[];
    await seleziona(anno);
    await clicPulsante();
    expect(radici()).toEqual(['ANNO', 'TIPO DOCUMENTO']);
    expect(server.radici).toBe(1);
  });

  it('8. espandere un ramo non chiude il riquadro: la cartella figlia si puo\' scegliere', async () => {
    await monta(true);
    await clicPulsante();
    const [anno] = albero()!.props.treeData as Nodo[];
    (albero()!.props.onExpand as (k: string[]) => void)([anno.key]);
    await (albero()!.props.loadData as (n: Nodo) => Promise<void>)(anno);
    await assesta();
    expect(server.figli).toEqual(['ROOT|anno']);
    expect(albero(), 'il riquadro resta aperto').toBeDefined();
    const figlio = (albero()!.props.treeData as Nodo[])[0].children![0];
    expect(figlio.title).toBe('2026');
    await seleziona(figlio);
    expect(onFolderClick).toHaveBeenCalledWith('ROOT|anno|2026', '2026');
    expect(albero()).toBeUndefined();
  });
});

describe('SXADV-5789: albero del documentale col menu aperto', () => {
  it('9. l\'albero e\' visibile direttamente, senza il pulsante', async () => {
    await monta(false);
    expect(pulsante()).toBeUndefined();
    expect(albero()).toBeDefined();
    expect(radici()).toEqual(['ANNO', 'TIPO DOCUMENTO']);
  });

  it('9. scegliere una cartella chiama onFolderClick e l\'albero resta', async () => {
    await monta(false);
    const [, tipo] = albero()!.props.treeData as Nodo[];
    await seleziona(tipo);
    expect(onFolderClick).toHaveBeenCalledWith('ROOT|tipo', 'TIPO DOCUMENTO');
    expect(albero()).toBeDefined();
  });
});

describe('SXADV-5789: riclicco sulla cartella gia\' selezionata (keys vuote)', () => {
  it('F. col riquadro: chiama comunque onFolderClick e chiude il riquadro', async () => {
    await monta(true);
    await clicPulsante();
    const [anno] = albero()!.props.treeData as Nodo[];
    await seleziona(anno);
    await clicPulsante();
    onFolderClick.mockClear();
    await riclicca((albero()!.props.treeData as Nodo[])[0]);
    expect(onFolderClick).toHaveBeenCalledTimes(1);
    expect(onFolderClick).toHaveBeenCalledWith('ROOT|anno', 'ANNO');
    expect(albero(), 'il riquadro chiuso').toBeUndefined();
  });

  it('F. a menu aperto: chiama onFolderClick e la cartella resta evidenziata', async () => {
    await monta(false);
    const [anno] = albero()!.props.treeData as Nodo[];
    await seleziona(anno);
    onFolderClick.mockClear();
    await riclicca((albero()!.props.treeData as Nodo[])[0]);
    expect(onFolderClick).toHaveBeenCalledWith('ROOT|anno', 'ANNO');
    expect(albero()!.props.selectedKeys).toEqual(['ROOT|anno']);
  });
});
