import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';

// SXADV-6242 — Invio nel «Cerca» FILTRA la lista (FilterRows) quando la lista
// sa filtrare e il filtro attivo non e' gia' quel testo in quella colonna; con
// lo stesso filtro gia' attivo, Invio passa al rigo successivo (LocateRow),
// Maiusc+Invio al precedente. Le frecce nel campo cercano sempre. Un filtro
// rifiutato (troppi righi, modifiche non salvate, lista non filtrabile) dice
// perche' e ripiega sul primo rigo trovato; zero righi = «nessun rigo». Il
// pulsante a imbuto dice se un filtro e' attivo (aria-pressed).
//
// Impianto copiato da ListSearchBox.sxadv4569.test.tsx: niente DOM, un motore
// di hook minimo, l'elemento restituito si legge come dato.

type AnyFn = (...a: never[]) => unknown;

const rt = vi.hoisted(() => ({
  active: false,
  i: 0,
  slots: [] as { v: unknown; deps?: unknown[]; set?: unknown }[],
  /** Effetti da eseguire dopo il disegno (deps cambiate), come fa React. */
  pending: [] as (() => unknown)[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const slot = (init: () => unknown) => {
    const i = rt.i++;
    if (!rt.slots[i]) rt.slots[i] = { v: init() };
    return rt.slots[i];
  };
  const same = (a?: unknown[], b?: unknown[]) =>
    !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
  const memo = (f: () => unknown, deps?: unknown[]) => {
    const i = rt.i++;
    const s = rt.slots[i];
    if (s && deps && same(s.deps, deps)) return s.v;
    rt.slots[i] = { v: f(), deps };
    return rt.slots[i].v;
  };
  const effect = (fn: () => unknown, deps?: unknown[]) => {
    const i = rt.i++;
    const s = rt.slots[i] as { v: unknown; deps?: unknown[] } | undefined;
    if (s && deps && same(s.deps, deps)) return;
    if (s && typeof s.v === 'function') { const c = s.v as () => void; rt.pending.push(() => { c(); return undefined; }); }
    const holder = { v: undefined as unknown, deps };
    rt.slots[i] = holder;
    rt.pending.push(() => { holder.v = fn(); return undefined; });
  };
  const on = <F extends AnyFn>(real: F, fake: AnyFn): F =>
    ((...a: never[]) => (rt.active ? fake(...a) : real(...a))) as unknown as F;
  const over = {
    useState: on(actual.useState as AnyFn, ((init: unknown) => {
      const s = slot(() => (typeof init === 'function' ? (init as () => unknown)() : init));
      s.set ??= (nv: unknown) => {
        s.v = typeof nv === 'function' ? (nv as (p: unknown) => unknown)(s.v) : nv;
      };
      return [s.v, s.set];
    }) as AnyFn),
    useRef: on(actual.useRef as AnyFn, ((init: unknown) => slot(() => ({ current: init })).v) as AnyFn),
    useCallback: on(actual.useCallback as AnyFn, ((fn: unknown, deps?: unknown[]) => memo(() => fn, deps)) as AnyFn),
    useMemo: on(actual.useMemo as AnyFn, memo as AnyFn),
    // Gli effetti girano davvero (dopo il disegno), solo quando le deps cambiano:
    // serve alla regola «la memoria si dimentica quando cambia il filtro».
    useEffect: on(actual.useEffect as AnyFn, effect as AnyFn),
    useLayoutEffect: on(actual.useLayoutEffect as AnyFn, effect as AnyFn),
  };
  return { ...actual, ...over, default: { ...actual, ...over } };
});

const fb = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  failure: vi.fn(),
  confirm: vi.fn(),
  showServerMessages: vi.fn(),
}));
vi.mock('../hooks/feedback', () => ({ useFeedback: () => fb }));

const { default: ListSearchBox } = await import('./ListSearchBox');

const LIST = 'S1-0.2,S1-3';

interface Props {
  listPath: string;
  locate: (params: Record<string, string>) => unknown;
  onFound: (position: number) => void;
  columns?: readonly { name: string; label: string }[];
  applyFilter?: (params: Record<string, string>) => unknown;
  filter?: { text: string; col?: string } | null;
}

type AnyEl = ReactElement<Record<string, unknown>>;

/** Il primo elemento dell'albero che soddisfa `pred` (figli, suffix, prefix). */
function findEl(n: unknown, pred: (e: AnyEl) => boolean): AnyEl | undefined {
  if (!n || typeof n !== 'object') return undefined;
  if (Array.isArray(n)) { for (const x of n) { const f = findEl(x, pred); if (f) return f; } return undefined; }
  const e = n as AnyEl;
  if (!e.props) return undefined;
  if (pred(e)) return e;
  for (const k of ['children', 'suffix', 'prefix', 'addonBefore', 'addonAfter']) {
    const f = findEl(e.props[k], pred);
    if (f) return f;
  }
  return undefined;
}

/** L'Input «Cerca», alla radice o dentro il gruppo con la tendina. */
const inputOf = (root: AnyEl): AnyEl => {
  // Da aria-label: il segnaposto cambia con la colonna scelta.
  const i = findEl(root, (e) => e.props['aria-label'] === 'Cerca nella lista');
  if (!i) throw new Error('Input «Cerca» non trovato');
  return i;
};

/** Un'istanza montata: render() rilegge l'elemento dopo ogni cambio di stato. */
function mount(props: Props) {
  rt.slots = [];
  rt.pending = [];
  let el: ReactElement<Record<string, unknown>>;
  const render = () => {
    rt.i = 0;
    rt.active = true;
    try {
      el = (ListSearchBox as unknown as (p: Props) => ReactElement<Record<string, unknown>>)(props);
    } finally {
      rt.active = false;
    }
    for (const f of rt.pending.splice(0)) f();
    return el;
  };
  render();
  return {
    /** L'Input «Cerca» (non la radice, se c'e' la tendina). */
    get el() { return inputOf(el); },
    get root() { return el; },
    type(text: string) {
      (inputOf(el).props.onChange as (e: unknown) => void)({ target: { value: text } });
      render();
    },
    enter(shiftKey = false) {
      const ev = { preventDefault: vi.fn(), stopPropagation: vi.fn(), key: 'Enter', shiftKey };
      (inputOf(el).props.onPressEnter as (e: unknown) => void)(ev);
      render();
      return ev;
    },
    /** Il pulsante con quell'aria-label, cercato nell'albero del suffix. */
    button(label: string): ReactElement<Record<string, unknown>> {
      const seek = (n: unknown): ReactElement<Record<string, unknown>> | undefined => {
        if (!n || typeof n !== 'object') return undefined;
        if (Array.isArray(n)) { for (const x of n) { const f = seek(x); if (f) return f; } return undefined; }
        const e = n as ReactElement<Record<string, unknown>>;
        if (e.props?.['aria-label'] === label) return e;
        return seek(e.props?.children);
      };
      const inp = inputOf(el);
      const b = seek(inp.props.suffix) ?? seek(inp.props.addonAfter) ?? seek(inp.props.prefix);
      if (!b) throw new Error(`pulsante "${label}" non trovato`);
      return b;
    },
    click(label: string) {
      (this.button(label).props.onClick as (e?: unknown) => void)({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
      render();
    },
    render,
  };
}

/** Le chiamate di un mock, come dati (i vi.fn() senza tipo hanno tuple vuote). */
const callsOf = (fn: { mock: { calls: unknown } }) => fn.mock.calls as unknown[][];

const flush = async () => {
  for (let k = 0; k < 5; k++) await new Promise((r) => setTimeout(r, 0));
};

const found = (position: number, scanned = position + 1) =>
  ({ located: { found: true, more: false, position, scanned } });
const notFound = (scanned: number) => ({ located: { found: false, more: false, position: -1, scanned } });

beforeEach(() => {
  for (const f of Object.values(fb)) f.mockReset();
});


const COLS = [
  { name: 'codice', label: 'Codice' },
  { name: 'descrizione', label: 'Descrizione' },
];
type Box = ReturnType<typeof mount>;
const byLabel = (box: Box, label: string) => findEl(box.root, (e) => e.props['aria-label'] === label);
const press = (box: Box, label: string) => {
  const b = byLabel(box, label);
  if (!b) throw new Error(`pulsante "${label}" non trovato`);
  (b.props.onClick as (e?: unknown) => void)({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
  box.render();
};
const choose = (box: Box, value: string) => {
  const sel = findEl(box.root, (e) => e.props['aria-label'] === 'Dove cercare');
  (sel!.props.onChange as (v: string, o?: unknown) => void)(value, undefined);
  box.render();
};
const param = (fn: { mock: { calls: unknown } }, k = 0) => callsOf(fn)[k][0] as Record<string, string>;

describe('SXADV-6242 — Invio filtra se il filtro non e\' gia\' quello', () => {
  it('nessun filtro attivo: Invio manda filterParams(listPath, T, \'\') e non cerca', async () => {
    const { filterParams } = await import('./listSearch');
    const locate = vi.fn(async () => found(1));
    const applyFilter = vi.fn(async () => ({ filtered: { count: 3 } }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter, filter: null });
    box.type('rossi');
    box.enter();
    await flush();
    expect(applyFilter).toHaveBeenCalledTimes(1);
    expect(param(applyFilter)).toEqual(filterParams(LIST, 'rossi', ''));
    expect(param(applyFilter)).toEqual({ navpath: LIST, option1: 'rossi' });
    expect(locate).not.toHaveBeenCalled();
  });

  it('filtro assente (prop non passata, lista che sa filtrare): Invio filtra', async () => {
    const locate = vi.fn(async () => found(1));
    const applyFilter = vi.fn(async () => ({ filtered: { count: 3 } }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter });
    box.type('rossi');
    box.enter();
    await flush();
    expect(applyFilter).toHaveBeenCalledTimes(1);
    expect(locate).not.toHaveBeenCalled();
  });

  it('testo con spazi: option1 normalizzato come filterParams', async () => {
    const { filterParams } = await import('./listSearch');
    const applyFilter = vi.fn(async () => ({ filtered: { count: 3 } }));
    const box = mount({ listPath: LIST, locate: vi.fn(), onFound: vi.fn(), applyFilter });
    box.type('  mario   rossi ');
    box.enter();
    await flush();
    expect(param(applyFilter)).toEqual(filterParams(LIST, '  mario   rossi ', ''));
    expect(param(applyFilter).option1).toBe('mario rossi');
  });

  it('colonna scelta: filterParams con col', async () => {
    const { filterParams } = await import('./listSearch');
    const locate = vi.fn();
    const applyFilter = vi.fn(async () => ({ filtered: { count: 3 } }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter, columns: COLS });
    choose(box, 'descrizione');
    box.type('rossi');
    box.enter();
    await flush();
    expect(param(applyFilter)).toEqual(filterParams(LIST, 'rossi', 'descrizione'));
    expect(param(applyFilter)).toEqual({ navpath: LIST, option1: 'rossi', col: 'descrizione' });
    expect(locate).not.toHaveBeenCalled();
  });

  it('filtro attivo su un altro testo: Invio filtra col testo nuovo', async () => {
    const locate = vi.fn();
    const applyFilter = vi.fn(async () => ({ filtered: { count: 2 } }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter, filter: { text: 'bianchi' } });
    box.type('rossi');
    box.enter();
    await flush();
    expect(param(applyFilter)).toEqual({ navpath: LIST, option1: 'rossi' });
    expect(locate).not.toHaveBeenCalled();
  });

  it('filtro attivo sullo stesso testo ma in un\'altra colonna: Invio filtra', async () => {
    const locate = vi.fn();
    const applyFilter = vi.fn(async () => ({ filtered: { count: 2 } }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter, columns: COLS, filter: { text: 'rossi', col: 'codice' } });
    choose(box, 'descrizione');
    box.type('rossi');
    box.enter();
    await flush();
    expect(param(applyFilter)).toEqual({ navpath: LIST, option1: 'rossi', col: 'descrizione' });
    expect(locate).not.toHaveBeenCalled();
  });

  it('filtro attivo in una colonna, ora «tutte le colonne»: Invio filtra senza col', async () => {
    const locate = vi.fn();
    const applyFilter = vi.fn(async () => ({ filtered: { count: 2 } }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter, columns: COLS, filter: { text: 'rossi', col: 'descrizione' } });
    box.type('rossi');
    box.enter();
    await flush();
    expect(param(applyFilter)).toEqual({ navpath: LIST, option1: 'rossi' });
    expect(locate).not.toHaveBeenCalled();
  });

  it('Maiusc+Invio senza filtro attivo: filtra anche lui (non cerca all\'indietro)', async () => {
    const locate = vi.fn();
    const applyFilter = vi.fn(async () => ({ filtered: { count: 2 } }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter });
    box.type('rossi');
    box.enter(true);
    await flush();
    expect(param(applyFilter)).toEqual({ navpath: LIST, option1: 'rossi' });
    expect(locate).not.toHaveBeenCalled();
  });

  it('Invio fa preventDefault e stopPropagation (il fuoco resta nel campo, il tasto non arriva alla pagina)', async () => {
    const applyFilter = vi.fn(async () => ({ filtered: { count: 2 } }));
    const box = mount({ listPath: LIST, locate: vi.fn(), onFound: vi.fn(), applyFilter });
    box.type('rossi');
    const ev = box.enter();
    await flush();
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(ev.stopPropagation).toHaveBeenCalled();
  });

  it('count > 0: nessun messaggio, nessun locate', async () => {
    const locate = vi.fn();
    const onFound = vi.fn();
    const applyFilter = vi.fn(async () => ({ filtered: { count: 4 } }));
    const box = mount({ listPath: LIST, locate, onFound, applyFilter });
    box.type('rossi');
    box.enter();
    await flush();
    expect(fb.info).not.toHaveBeenCalled();
    expect(locate).not.toHaveBeenCalled();
    expect(onFound).not.toHaveBeenCalled();
  });

  it('Invio a campo vuoto: nessuna richiesta', async () => {
    const locate = vi.fn();
    const applyFilter = vi.fn(async () => ({ filtered: { count: 4 } }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter });
    box.type('   ');
    box.enter();
    await flush();
    expect(applyFilter).not.toHaveBeenCalled();
    expect(locate).not.toHaveBeenCalled();
  });
});

describe('SXADV-6242 — con lo stesso filtro gia\' attivo Invio cerca il rigo', () => {
  it('filtro uguale (T, tutte le colonne): Invio manda locateParams da -1, niente filtro', async () => {
    const { locateParams, EMPTY_SEARCH } = await import('./listSearch');
    const locate = vi.fn(async () => found(4));
    const onFound = vi.fn();
    const applyFilter = vi.fn();
    const box = mount({ listPath: LIST, locate, onFound, applyFilter, filter: { text: 'rossi' } });
    box.type('rossi');
    box.enter();
    await flush();
    expect(applyFilter).not.toHaveBeenCalled();
    expect(locate).toHaveBeenCalledTimes(1);
    expect(param(locate)).toEqual(locateParams(LIST, 'rossi', EMPTY_SEARCH));
    expect(onFound).toHaveBeenCalledWith(4);
  });

  it.each([
    ['maiuscole', 'ROSSI', 'rossi'],
    ['accenti', 'rossì', 'rossi'],
    ['accenti e maiuscole al contrario', 'rossi', 'RÒSSÌ'],
    ['spazi in eccesso', '  mario   rossi ', 'mario rossi'],
  ])('uguaglianza a meno di %s: Invio cerca', async (_n, filterText, typed) => {
    const locate = vi.fn(async () => found(1));
    const applyFilter = vi.fn();
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter, filter: { text: filterText } });
    box.type(typed);
    box.enter();
    await flush();
    expect(applyFilter).not.toHaveBeenCalled();
    expect(locate).toHaveBeenCalledTimes(1);
  });

  it('filtro uguale in una colonna, stessa colonna scelta: Invio cerca in quella colonna', async () => {
    const locate = vi.fn(async () => found(2));
    const applyFilter = vi.fn();
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter, columns: COLS, filter: { text: 'rossi', col: 'descrizione' } });
    choose(box, 'descrizione');
    box.type('rossi');
    box.enter();
    await flush();
    expect(applyFilter).not.toHaveBeenCalled();
    expect(param(locate)).toEqual({ navpath: LIST, option1: 'rossi', from: '-1', col: 'descrizione' });
  });

  it('filter.col vuoto vale come «tutte le colonne»', async () => {
    const locate = vi.fn(async () => found(2));
    const applyFilter = vi.fn();
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter, columns: COLS, filter: { text: 'rossi', col: '' } });
    box.type('rossi');
    box.enter();
    await flush();
    expect(applyFilter).not.toHaveBeenCalled();
    expect(locate).toHaveBeenCalledTimes(1);
  });

  it('Invio consecutivi: ognuno riparte dall\'ultimo rigo trovato', async () => {
    const answers = [found(4), found(9), found(15)];
    const locate = vi.fn(async () => answers.shift());
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter: vi.fn(), filter: { text: 'rossi' } });
    box.type('rossi');
    box.enter();
    await flush();
    box.enter();
    await flush();
    box.enter();
    await flush();
    expect(callsOf(locate).map((c) => (c[0] as Record<string, string>).from)).toEqual(['-1', '4', '9']);
  });

  it('Maiusc+Invio: indietro (dir -1) dall\'ultimo trovato', async () => {
    const answers = [found(9), found(4)];
    const locate = vi.fn(async () => answers.shift());
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter: vi.fn(), filter: { text: 'rossi' } });
    box.type('rossi');
    box.enter();
    await flush();
    box.enter(true);
    await flush();
    expect(param(locate, 1)).toEqual({ navpath: LIST, option1: 'rossi', from: '9', dir: '-1' });
  });

  it('primo Invio filtra; arrivato il filtro (prop filter), Invio successivi cercano dal primo rigo in avanti', async () => {
    const answers = [found(0), found(3)];
    const locate = vi.fn(async () => answers.shift());
    const applyFilter = vi.fn(async () => ({ filtered: { count: 5 } }));
    const props: Props = { listPath: LIST, locate, onFound: vi.fn(), applyFilter, filter: null };
    const box = mount(props);
    box.type('rossi');
    box.enter();
    await flush();
    expect(applyFilter).toHaveBeenCalledTimes(1);
    expect(locate).not.toHaveBeenCalled();
    // Il server ha messo il filtro: la lista lo ridice.
    props.filter = { text: 'rossi' };
    box.render();
    box.enter();
    await flush();
    box.enter();
    await flush();
    expect(applyFilter).toHaveBeenCalledTimes(1);
    expect(callsOf(locate).map((c) => (c[0] as Record<string, string>).from)).toEqual(['-1', '0']);
  });

  it('testo cambiato dopo il filtro: Invio filtra di nuovo col testo nuovo', async () => {
    const locate = vi.fn(async () => found(1));
    const applyFilter = vi.fn(async () => ({ filtered: { count: 2 } }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter, filter: { text: 'rossi' } });
    box.type('rossi');
    box.enter();
    await flush();
    box.type('bianchi');
    box.enter();
    await flush();
    expect(locate).toHaveBeenCalledTimes(1);
    expect(applyFilter).toHaveBeenCalledTimes(1);
    expect(param(applyFilter)).toEqual({ navpath: LIST, option1: 'bianchi' });
  });
});

describe('SXADV-6242 — le frecce nel campo cercano sempre', () => {
  it('senza filtro attivo: «Rigo successivo» cerca (locate), non filtra', async () => {
    const locate = vi.fn(async () => found(4));
    const applyFilter = vi.fn(async () => ({ filtered: { count: 2 } }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter });
    box.type('rossi');
    press(box, 'Rigo successivo');
    await flush();
    expect(applyFilter).not.toHaveBeenCalled();
    expect(param(locate)).toEqual({ navpath: LIST, option1: 'rossi', from: '-1' });
  });

  it('senza filtro attivo: «Rigo precedente» cerca all\'indietro', async () => {
    const locate = vi.fn(async () => found(4));
    const applyFilter = vi.fn(async () => ({ filtered: { count: 2 } }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter });
    box.type('rossi');
    press(box, 'Rigo precedente');
    await flush();
    expect(applyFilter).not.toHaveBeenCalled();
    expect(param(locate)).toEqual({ navpath: LIST, option1: 'rossi', from: '-1', dir: '-1' });
  });

  it('con filtro attivo: le frecce continuano dall\'ultimo trovato', async () => {
    const answers = [found(4), found(9), found(4)];
    const locate = vi.fn(async () => answers.shift());
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter: vi.fn(), filter: { text: 'rossi' } });
    box.type('rossi');
    press(box, 'Rigo successivo');
    await flush();
    press(box, 'Rigo successivo');
    await flush();
    press(box, 'Rigo precedente');
    await flush();
    expect(callsOf(locate).map((c) => [(c[0] as Record<string, string>).from, (c[0] as Record<string, string>).dir])).toEqual([
      ['-1', undefined], ['4', undefined], ['9', '-1'],
    ]);
  });
});

describe('SXADV-6242 — filtro rifiutato: messaggio e primo rigo trovato', () => {
  it.each([
    ['tooMany', { tooMany: 25000 }, 'T'],
    ['dirty', { dirty: true }, 'D'],
    ['unsupported', { unsupported: true }, 'U'],
  ])('%s: lo stesso messaggio del pulsante a imbuto, poi locate da -1', async (_n, filtered, which) => {
    const ls = await import('./listSearch');
    const expected = {
      U: ls.FILTER_UNSUPPORTED_MESSAGE,
      D: ls.FILTER_DIRTY_MESSAGE,
      T: ls.tooManyMessage(25000),
    }[which as 'U' | 'D' | 'T'];
    const locate = vi.fn(async () => found(12));
    const onFound = vi.fn();
    const applyFilter = vi.fn(async () => ({ filtered }));
    const box = mount({ listPath: LIST, locate, onFound, applyFilter });
    box.type('rossi');
    box.enter();
    await flush();
    expect(applyFilter).toHaveBeenCalledTimes(1);
    expect(fb.info).toHaveBeenCalledWith(expected);
    expect(locate).toHaveBeenCalledTimes(1);
    expect(param(locate)).toEqual({ navpath: LIST, option1: 'rossi', from: '-1' });
    expect(onFound).toHaveBeenCalledWith(12);
  });

  it('il messaggio e\' identico a quello del pulsante a imbuto per la stessa risposta', async () => {
    for (const filtered of [{ tooMany: 25000 }, { dirty: true }, { unsupported: true }]) {
      fb.info.mockReset();
      const viaButton = mount({ listPath: LIST, locate: vi.fn(async () => found(1)), onFound: vi.fn(), applyFilter: vi.fn(async () => ({ filtered })) });
      viaButton.type('rossi');
      press(viaButton, 'Filtra la lista');
      await flush();
      const fromButton = fb.info.mock.calls.map((c) => c[0]);
      fb.info.mockReset();
      const viaEnter = mount({ listPath: LIST, locate: vi.fn(async () => found(1)), onFound: vi.fn(), applyFilter: vi.fn(async () => ({ filtered })) });
      viaEnter.type('rossi');
      viaEnter.enter();
      await flush();
      expect(fb.info.mock.calls.map((c) => c[0])).toEqual(fromButton);
    }
  });

  it('rifiuto con colonna scelta: il ripiego cerca nella stessa colonna', async () => {
    const locate = vi.fn(async () => found(3));
    const applyFilter = vi.fn(async () => ({ filtered: { tooMany: 25000 } }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter, columns: COLS });
    choose(box, 'descrizione');
    box.type('rossi');
    box.enter();
    await flush();
    expect(param(locate)).toEqual({ navpath: LIST, option1: 'rossi', from: '-1', col: 'descrizione' });
  });

  // Decisione del coordinatore: dopo un rifiuto per (T, C), Invio con lo stesso
  // (T, C) non riprova il filtro: continua col locate dall'ultimo trovato.
  describe('dopo un rifiuto, Invio con lo stesso testo e colonna non riprova il filtro', () => {
    it.each([
      ['tooMany', { tooMany: 25000 }],
      ['dirty', { dirty: true }],
      ['unsupported', { unsupported: true }],
    ])('%s: il secondo e il terzo Invio cercano dall\'ultimo trovato', async (_n, filtered) => {
      const answers = [found(3), found(8), found(12)];
      const locate = vi.fn(async () => answers.shift());
      const applyFilter = vi.fn(async () => ({ filtered }));
      const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter });
      box.type('rossi');
      box.enter();
      await flush();
      box.enter();
      await flush();
      box.enter();
      await flush();
      expect(applyFilter).toHaveBeenCalledTimes(1);
      expect(callsOf(locate).map((c) => (c[0] as Record<string, string>).from)).toEqual(['-1', '3', '8']);
      expect(fb.info).toHaveBeenCalledTimes(1);
    });

    it('Maiusc+Invio dopo il rifiuto: indietro dall\'ultimo trovato, senza filtro', async () => {
      const answers = [found(5), found(2)];
      const locate = vi.fn(async () => answers.shift());
      const applyFilter = vi.fn(async () => ({ filtered: { tooMany: 25000 } }));
      const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter });
      box.type('rossi');
      box.enter();
      await flush();
      box.enter(true);
      await flush();
      expect(applyFilter).toHaveBeenCalledTimes(1);
      expect(param(locate, 1)).toEqual({ navpath: LIST, option1: 'rossi', from: '5', dir: '-1' });
    });

    it('stesso testo a meno di maiuscole/accenti/spazi: e\' lo stesso, niente nuovo filtro', async () => {
      const answers = [found(5), found(9)];
      const locate = vi.fn(async () => answers.shift());
      const applyFilter = vi.fn(async () => ({ filtered: { tooMany: 25000 } }));
      const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter });
      box.type('rossi');
      box.enter();
      await flush();
      box.type(' RÒSSI ');
      box.enter();
      await flush();
      expect(applyFilter).toHaveBeenCalledTimes(1);
      expect(param(locate, 1).from).toBe('5');
    });

    it('con una colonna: il secondo Invio cerca nella colonna dall\'ultimo trovato', async () => {
      const answers = [found(4), found(7)];
      const locate = vi.fn(async () => answers.shift());
      const applyFilter = vi.fn(async () => ({ filtered: { dirty: true } }));
      const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter, columns: COLS });
      choose(box, 'descrizione');
      box.type('rossi');
      box.enter();
      await flush();
      box.enter();
      await flush();
      expect(applyFilter).toHaveBeenCalledTimes(1);
      expect(param(locate, 1)).toEqual({ navpath: LIST, option1: 'rossi', from: '4', col: 'descrizione' });
    });

    it('un testo diverso riprova il filtro', async () => {
      const locate = vi.fn(async () => found(3));
      const applyFilter = vi.fn(async () => ({ filtered: { tooMany: 25000 } }));
      const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter });
      box.type('rossi');
      box.enter();
      await flush();
      box.type('bianchi');
      box.enter();
      await flush();
      expect(applyFilter).toHaveBeenCalledTimes(2);
      expect(param(applyFilter, 1)).toEqual({ navpath: LIST, option1: 'bianchi' });
    });

    it('una colonna diversa riprova il filtro', async () => {
      const locate = vi.fn(async () => found(3));
      const applyFilter = vi.fn(async () => ({ filtered: { tooMany: 25000 } }));
      const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter, columns: COLS });
      box.type('rossi');
      box.enter();
      await flush();
      choose(box, 'codice');
      box.enter();
      await flush();
      expect(applyFilter).toHaveBeenCalledTimes(2);
      expect(param(applyFilter, 1)).toEqual({ navpath: LIST, option1: 'rossi', col: 'codice' });
    });

    it('il pulsante a imbuto riprova sempre il filtro, anche dopo il rifiuto', async () => {
      const locate = vi.fn(async () => found(3));
      const applyFilter = vi.fn(async () => ({ filtered: { tooMany: 25000 } }));
      const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter });
      box.type('rossi');
      box.enter();
      await flush();
      press(box, 'Filtra la lista');
      await flush();
      expect(applyFilter).toHaveBeenCalledTimes(2);
      expect(param(applyFilter, 1)).toEqual({ navpath: LIST, option1: 'rossi' });
    });

    it('tornati al testo rifiutato dopo un altro testo: e\' un altro tentativo, riprova il filtro', async () => {
      // Assunzione: «stesso (T, C)» = l'ultimo rifiuto, non uno qualsiasi del passato.
      const locate = vi.fn(async () => found(3));
      const applyFilter = vi.fn(async () => ({ filtered: { tooMany: 25000 } }));
      const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter });
      box.type('rossi');
      box.enter();
      await flush();
      box.type('bianchi');
      box.enter();
      await flush();
      box.type('rossi');
      box.enter();
      await flush();
      expect(applyFilter).toHaveBeenCalledTimes(3);
    });
  });

  it('rifiuto, ripiego senza nulla: notFoundMessage', async () => {
    const ls = await import('./listSearch');
    const locate = vi.fn(async () => notFound(25000));
    const applyFilter = vi.fn(async () => ({ filtered: { tooMany: 25000 } }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter });
    box.type('rossi');
    box.enter();
    await flush();
    expect(locate).toHaveBeenCalledTimes(1);
    expect(fb.info).toHaveBeenCalledWith(ls.notFoundMessage('rossi'));
  });

  it('il pulsante a imbuto, rifiutato, NON ripiega sul locate (solo Invio lo fa)', async () => {
    const locate = vi.fn(async () => found(3));
    const applyFilter = vi.fn(async () => ({ filtered: { tooMany: 25000 } }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter });
    box.type('rossi');
    press(box, 'Filtra la lista');
    await flush();
    expect(locate).not.toHaveBeenCalled();
  });
});

describe('SXADV-6242 — filtro a zero righi', () => {
  it('count 0: notFoundMessage(T), nessun locate', async () => {
    const ls = await import('./listSearch');
    const locate = vi.fn(async () => found(1));
    const applyFilter = vi.fn(async () => ({ filtered: { count: 0 } }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter });
    box.type('  rossi ');
    box.enter();
    await flush();
    expect(fb.info).toHaveBeenCalledTimes(1);
    expect(fb.info).toHaveBeenCalledWith(ls.notFoundMessage('rossi'));
    expect(locate).not.toHaveBeenCalled();
  });

  it('risposta senza filtered (errore gia\' mostrato): ne\' messaggio ne\' locate', async () => {
    const locate = vi.fn(async () => found(1));
    const applyFilter = vi.fn(async () => undefined);
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter });
    box.type('rossi');
    box.enter();
    await flush();
    expect(fb.info).not.toHaveBeenCalled();
    expect(locate).not.toHaveBeenCalled();
  });

  it('errore del filtro su Invio: failure, e il campo non resta bloccato', async () => {
    const applyFilter = vi.fn()
      .mockImplementationOnce(async () => { throw new Error('rete'); })
      .mockImplementation(async () => ({ filtered: { count: 1 } }));
    const box = mount({ listPath: LIST, locate: vi.fn(), onFound: vi.fn(), applyFilter });
    box.type('rossi');
    box.enter();
    await flush();
    expect(fb.failure).toHaveBeenCalledTimes(1);
    box.enter();
    await flush();
    expect(applyFilter).toHaveBeenCalledTimes(2);
  });
});

describe('SXADV-6242 — senza applyFilter Invio cerca come prima', () => {
  it('Invio = locate da -1, Maiusc+Invio = indietro', async () => {
    const answers = [found(5), found(2)];
    const locate = vi.fn(async () => answers.shift());
    const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
    box.type('rossi');
    box.enter();
    await flush();
    box.enter(true);
    await flush();
    expect(param(locate, 0)).toEqual({ navpath: LIST, option1: 'rossi', from: '-1' });
    expect(param(locate, 1)).toEqual({ navpath: LIST, option1: 'rossi', from: '5', dir: '-1' });
  });

  it('anche con un filter passato ma senza applyFilter: cerca', async () => {
    const locate = vi.fn(async () => found(5));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), filter: { text: 'bianchi' } });
    box.type('rossi');
    box.enter();
    await flush();
    expect(locate).toHaveBeenCalledTimes(1);
  });
});

// aria-pressed si legge dalle props: antd/React lo scrive nel DOM come stringa,
// quindi vale sia il booleano sia la stringa.
describe('SXADV-6242 — il pulsante a imbuto dice se il filtro e\' attivo', () => {
  it('nessun filtro: aria-pressed="false"', () => {
    const box = mount({ listPath: LIST, locate: vi.fn(), onFound: vi.fn(), applyFilter: vi.fn(), filter: null });
    box.type('rossi');
    expect(String(byLabel(box, 'Filtra la lista')!.props['aria-pressed'])).toBe('false');
  });

  it('filter non passato: aria-pressed="false"', () => {
    const box = mount({ listPath: LIST, locate: vi.fn(), onFound: vi.fn(), applyFilter: vi.fn() });
    expect(String(byLabel(box, 'Filtra la lista')!.props['aria-pressed'])).toBe('false');
  });

  it('filtro attivo: aria-pressed="true", anche a campo vuoto o con un altro testo', () => {
    const box = mount({ listPath: LIST, locate: vi.fn(), onFound: vi.fn(), applyFilter: vi.fn(), filter: { text: 'rossi' } });
    expect(String(byLabel(box, 'Filtra la lista')!.props['aria-pressed'])).toBe('true');
    box.type('bianchi');
    expect(String(byLabel(box, 'Filtra la lista')!.props['aria-pressed'])).toBe('true');
  });

  it('il filtro tolto (prop a null): torna "false"', () => {
    const props: Props = { listPath: LIST, locate: vi.fn(), onFound: vi.fn(), applyFilter: vi.fn(), filter: { text: 'rossi' } };
    const box = mount(props);
    expect(String(byLabel(box, 'Filtra la lista')!.props['aria-pressed'])).toBe('true');
    props.filter = null;
    box.render();
    expect(String(byLabel(box, 'Filtra la lista')!.props['aria-pressed'])).toBe('false');
  });

  it('il clic applica ancora il filtro del testo corrente, anche con un filtro attivo', async () => {
    const applyFilter = vi.fn(async () => ({ filtered: { count: 2 } }));
    const locate = vi.fn();
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter, columns: COLS, filter: { text: 'rossi' } });
    choose(box, 'codice');
    box.type('bianchi');
    press(box, 'Filtra la lista');
    await flush();
    expect(param(applyFilter)).toEqual({ navpath: LIST, option1: 'bianchi', col: 'codice' });
    expect(locate).not.toHaveBeenCalled();
  });
});

describe('SXADV-6242 — memoria del filtro appena messo o rifiutato', () => {
  it('(1) filtro riuscito, prop filter non ancora aggiornata: il secondo Invio cerca, niente secondo filtro', async () => {
    const locate = vi.fn(async () => found(0));
    const applyFilter = vi.fn(async () => ({ filtered: { count: 5 } }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter, filter: null });
    box.type('rossi');
    box.enter();
    await flush();
    box.enter();
    await flush();
    expect(applyFilter).toHaveBeenCalledTimes(1);
    expect(locate).toHaveBeenCalledTimes(1);
    expect(param(locate)).toEqual({ navpath: LIST, option1: 'rossi', from: '-1' });
  });

  it('(1) con una colonna: il secondo Invio cerca nella colonna', async () => {
    const locate = vi.fn(async () => found(0));
    const applyFilter = vi.fn(async () => ({ filtered: { count: 5 } }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter, columns: COLS });
    choose(box, 'descrizione');
    box.type('rossi');
    box.enter();
    await flush();
    box.enter(true);
    await flush();
    expect(applyFilter).toHaveBeenCalledTimes(1);
    expect(param(locate)).toEqual({ navpath: LIST, option1: 'rossi', from: '-1', dir: '-1', col: 'descrizione' });
  });

  it('(1) filtro riuscito, poi un testo diverso: filtra di nuovo', async () => {
    const locate = vi.fn(async () => found(0));
    const applyFilter = vi.fn(async () => ({ filtered: { count: 5 } }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter });
    box.type('rossi');
    box.enter();
    await flush();
    box.type('bianchi');
    box.enter();
    await flush();
    expect(applyFilter).toHaveBeenCalledTimes(2);
    expect(locate).not.toHaveBeenCalled();
  });

  it.each([
    ['tooMany', { tooMany: 25000 }, 'T'],
    ['dirty', { dirty: true }, 'D'],
    ['unsupported', { unsupported: true }, 'U'],
  ])('(2) %s con un ALTRO filtro attivo: messaggio, nessun ripiego sul locate', async (_n, filtered, which) => {
    const ls = await import('./listSearch');
    const expected = {
      U: ls.FILTER_UNSUPPORTED_MESSAGE,
      D: ls.FILTER_DIRTY_MESSAGE,
      T: ls.tooManyMessage(25000),
    }[which as 'U' | 'D' | 'T'];
    const locate = vi.fn(async () => found(3));
    const applyFilter = vi.fn(async () => ({ filtered }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter, filter: { text: 'bianchi' } });
    box.type('rossi');
    box.enter();
    await flush();
    expect(applyFilter).toHaveBeenCalledTimes(1);
    expect(fb.info).toHaveBeenCalledWith(expected);
    expect(locate).not.toHaveBeenCalled();
  });

  it('(2) altro filtro attivo sullo stesso testo ma in un\'altra colonna: rifiuto senza ripiego', async () => {
    const locate = vi.fn(async () => found(3));
    const applyFilter = vi.fn(async () => ({ filtered: { tooMany: 25000 } }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn(), applyFilter, columns: COLS, filter: { text: 'rossi', col: 'codice' } });
    choose(box, 'descrizione');
    box.type('rossi');
    box.enter();
    await flush();
    expect(applyFilter).toHaveBeenCalledTimes(1);
    expect(locate).not.toHaveBeenCalled();
  });

  /** Un rifiuto per «rossi»: dopo, Invio con «rossi» cerca invece di filtrare. */
  const refused = async (props: Props) => {
    const box = mount(props);
    box.type('rossi');
    box.enter();
    await flush();
    box.enter();
    await flush();
    expect(props.applyFilter).toHaveBeenCalledTimes(1);
    return box;
  };

  it('(3) rifiuto dimenticato quando il filtro cambia testo: Invio riprova il filtro', async () => {
    const props: Props = { listPath: LIST, locate: vi.fn(async () => found(3)), onFound: vi.fn(), applyFilter: vi.fn(async () => ({ filtered: { tooMany: 25000 } })), filter: null };
    const box = await refused(props);
    props.filter = { text: 'bianchi' };
    box.render();
    box.enter();
    await flush();
    expect(props.applyFilter).toHaveBeenCalledTimes(2);
  });

  it('(3) rifiuto dimenticato quando il filtro attivo sparisce (prop a null)', async () => {
    const props: Props = { listPath: LIST, locate: vi.fn(async () => found(3)), onFound: vi.fn(), applyFilter: vi.fn(async () => ({ filtered: { dirty: true } })), filter: { text: 'bianchi' } };
    const box = mount(props);
    box.type('rossi');
    box.enter();
    await flush();
    box.enter();
    await flush();
    expect(props.applyFilter).toHaveBeenCalledTimes(1);
    props.filter = null;
    box.render();
    box.enter();
    await flush();
    expect(props.applyFilter).toHaveBeenCalledTimes(2);
  });

  it('(3) rifiuto dimenticato quando il filtro cambia colonna', async () => {
    const props: Props = { listPath: LIST, locate: vi.fn(async () => found(3)), onFound: vi.fn(), applyFilter: vi.fn(async () => ({ filtered: { tooMany: 25000 } })), columns: COLS, filter: { text: 'bianchi', col: 'codice' } };
    const box = await refused(props);
    props.filter = { text: 'bianchi', col: 'descrizione' };
    box.render();
    box.enter();
    await flush();
    expect(props.applyFilter).toHaveBeenCalledTimes(2);
  });

  it('(3) rifiuto dimenticato quando cambia listPath', async () => {
    const props: Props = { listPath: LIST, locate: vi.fn(async () => found(3)), onFound: vi.fn(), applyFilter: vi.fn(async () => ({ filtered: { tooMany: 25000 } })) };
    const box = await refused(props);
    props.listPath = 'S1-0.2,S1-4';
    box.render();
    box.enter();
    await flush();
    expect(props.applyFilter).toHaveBeenCalledTimes(2);
    expect(param(props.applyFilter as never, 1)).toEqual({ navpath: 'S1-0.2,S1-4', option1: 'rossi' });
  });

  it('(3) un nuovo oggetto filter con lo stesso valore NON fa dimenticare il rifiuto', async () => {
    const props: Props = { listPath: LIST, locate: vi.fn(async () => found(3)), onFound: vi.fn(), applyFilter: vi.fn(async () => ({ filtered: { tooMany: 25000 } })), columns: COLS, filter: { text: 'bianchi', col: 'codice' } };
    const box = await refused(props);
    props.filter = { text: 'bianchi', col: 'codice' };
    box.render();
    box.enter();
    await flush();
    expect(props.applyFilter).toHaveBeenCalledTimes(1);
  });

  it('(3) un ridisegno qualsiasi (stessa prop) NON fa dimenticare il rifiuto', async () => {
    const props: Props = { listPath: LIST, locate: vi.fn(async () => found(3)), onFound: vi.fn(), applyFilter: vi.fn(async () => ({ filtered: { tooMany: 25000 } })), filter: null };
    const box = await refused(props);
    box.render();
    box.render();
    box.enter();
    await flush();
    expect(props.applyFilter).toHaveBeenCalledTimes(1);
  });

  it('(3) «appena messo» dimenticato quando cambia listPath: Invio filtra di nuovo', async () => {
    const props: Props = { listPath: LIST, locate: vi.fn(async () => found(0)), onFound: vi.fn(), applyFilter: vi.fn(async () => ({ filtered: { count: 5 } })), filter: null };
    const box = mount(props);
    box.type('rossi');
    box.enter();
    await flush();
    props.listPath = 'S1-0.2,S1-4';
    box.render();
    box.enter();
    await flush();
    expect(props.applyFilter).toHaveBeenCalledTimes(2);
    expect(props.locate).not.toHaveBeenCalled();
  });

  it('(3) «appena messo» dimenticato quando il filtro cambia in un altro valore: Invio filtra di nuovo', async () => {
    const props: Props = { listPath: LIST, locate: vi.fn(async () => found(0)), onFound: vi.fn(), applyFilter: vi.fn(async () => ({ filtered: { count: 5 } })), filter: { text: 'bianchi' } };
    const box = mount(props);
    box.type('rossi');
    box.enter();
    await flush();
    // Il server ha poi un filtro diverso da «rossi» (es. ridisegno da un'altra azione).
    props.filter = { text: 'verdi' };
    box.render();
    box.enter();
    await flush();
    expect(props.applyFilter).toHaveBeenCalledTimes(2);
    expect(props.locate).not.toHaveBeenCalled();
  });

  it('(3) «appena messo» e poi la prop arriva uguale: Invio cerca (vale la prop)', async () => {
    const props: Props = { listPath: LIST, locate: vi.fn(async () => found(0)), onFound: vi.fn(), applyFilter: vi.fn(async () => ({ filtered: { count: 5 } })), filter: null };
    const box = mount(props);
    box.type('rossi');
    box.enter();
    await flush();
    props.filter = { text: 'rossi' };
    box.render();
    box.enter();
    await flush();
    expect(props.applyFilter).toHaveBeenCalledTimes(1);
    expect(props.locate).toHaveBeenCalledTimes(1);
  });
});
