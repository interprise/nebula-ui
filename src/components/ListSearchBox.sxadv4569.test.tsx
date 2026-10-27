import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';

// SXADV-4569 — ListSearchBox, il campo «Cerca» di una lista. Contratto:
//   - antd Input, placeholder "Cerca";
//   - Invio cerca tramite locate(params) (risposta del server, anche Promise);
//   - located.found -> onFound(position); non trovato -> feedback.info(...);
//   - located.more -> continua da solo (from=position, done=scanned);
//   - un secondo Invio con lo stesso testo riparte dall'ultimo rigo trovato;
//   - risposta senza located -> si ferma in silenzio;
//   - nessuna ricerca concorrente mentre una e' in corso.
//
// Niente DOM nel progetto (ne' jsdom ne' testing-library): un motore di hook
// minimo al posto di React (useState/useRef/useCallback/useMemo) e l'elemento
// restituito dal componente si legge come dato: le sue props onChange e
// onPressEnter si chiamano come farebbe antd.

type AnyFn = (...a: never[]) => unknown;

const rt = vi.hoisted(() => ({
  active: false,
  i: 0,
  slots: [] as { v: unknown; deps?: unknown[]; set?: unknown }[],
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
    useEffect: on(actual.useEffect as AnyFn, (() => undefined) as AnyFn),
    useLayoutEffect: on(actual.useLayoutEffect as AnyFn, (() => undefined) as AnyFn),
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
  let el: ReactElement<Record<string, unknown>>;
  const render = () => {
    rt.i = 0;
    rt.active = true;
    try {
      el = (ListSearchBox as unknown as (p: Props) => ReactElement<Record<string, unknown>>)(props);
    } finally {
      rt.active = false;
    }
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
const more = (position: number, scanned: number) => ({ located: { found: false, more: true, position, scanned } });

beforeEach(() => {
  for (const f of Object.values(fb)) f.mockReset();
});

describe('ListSearchBox (SXADV-4569)', () => {
  it('campo con placeholder "Cerca"', () => {
    const box = mount({ listPath: LIST, locate: vi.fn(), onFound: vi.fn() });
    expect(box.el.props.placeholder).toBe('Cerca');
    expect(typeof box.el.props.onPressEnter).toBe('function');
  });

  it('Invio a campo vuoto o di soli spazi: nessuna richiesta', async () => {
    const locate = vi.fn();
    const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
    box.enter();
    await flush();
    box.type('   ');
    box.enter();
    await flush();
    expect(locate).not.toHaveBeenCalled();
  });

  it('Invio: chiede dall\'inizio e su trovato chiama onFound(position)', async () => {
    const locate = vi.fn(async () => found(57));
    const onFound = vi.fn();
    const box = mount({ listPath: LIST, locate, onFound });
    box.type('rossi');
    box.enter();
    await flush();
    expect(locate).toHaveBeenCalledTimes(1);
    const p = callsOf(locate)[0][0] as Record<string, string>;
    expect(p.navpath).toBe(LIST);
    expect(p.option1).toBe('rossi');
    expect(p.from).toBe('-1');
    expect(p.done).toBeUndefined();
    expect(onFound).toHaveBeenCalledWith(57);
    expect(fb.info).not.toHaveBeenCalled();
  });

  it('risposta sincrona (non Promise) funziona uguale', async () => {
    const locate = vi.fn(() => found(3));
    const onFound = vi.fn();
    const box = mount({ listPath: LIST, locate, onFound });
    box.type('rossi');
    box.enter();
    await flush();
    expect(onFound).toHaveBeenCalledWith(3);
  });

  it('secondo Invio con lo stesso testo: riparte dall\'ultimo rigo trovato', async () => {
    const answers = [found(57), found(120)];
    const locate = vi.fn(async () => answers.shift());
    const onFound = vi.fn();
    const box = mount({ listPath: LIST, locate, onFound });
    box.type('rossi');
    box.enter();
    await flush();
    box.enter();
    await flush();
    expect(locate).toHaveBeenCalledTimes(2);
    expect((callsOf(locate)[1][0] as Record<string, string>).from).toBe('57');
    expect(onFound.mock.calls.map((c) => c[0])).toEqual([57, 120]);
  });

  it('stesso testo con spazi in piu\': e\' ancora "trova il successivo"', async () => {
    const answers = [found(57), found(120)];
    const locate = vi.fn(async () => answers.shift());
    const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
    box.type('rossi');
    box.enter();
    await flush();
    box.type(' rossi  ');
    box.enter();
    await flush();
    expect((callsOf(locate)[1][0] as Record<string, string>).from).toBe('57');
    expect((callsOf(locate)[1][0] as Record<string, string>).option1).toBe('rossi');
  });

  it('testo cambiato: ricomincia dall\'inizio', async () => {
    const answers = [found(57), found(8)];
    const locate = vi.fn(async () => answers.shift());
    const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
    box.type('rossi');
    box.enter();
    await flush();
    box.type('bianchi');
    box.enter();
    await flush();
    const p = callsOf(locate)[1][0] as Record<string, string>;
    expect(p.option1).toBe('bianchi');
    expect(p.from).toBe('-1');
  });

  it('non trovato: messaggio informativo, nessun onFound', async () => {
    const locate = vi.fn(async () => notFound(1000));
    const onFound = vi.fn();
    const box = mount({ listPath: LIST, locate, onFound });
    box.type('zzz');
    box.enter();
    await flush();
    expect(onFound).not.toHaveBeenCalled();
    expect(fb.info).toHaveBeenCalledTimes(1);
    expect(String(fb.info.mock.calls[0][0])).toContain('zzz');
  });

  it('dopo un "non trovato" lo stesso testo riparte dall\'inizio', async () => {
    const answers = [found(57), notFound(1000), found(57)];
    const locate = vi.fn(async () => answers.shift());
    const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
    box.type('rossi');
    box.enter();
    await flush();
    box.enter();
    await flush();
    box.enter();
    await flush();
    expect((callsOf(locate)[1][0] as Record<string, string>).from).toBe('57');
    expect((callsOf(locate)[2][0] as Record<string, string>).from).toBe('-1');
  });

  it('more: continua da solo con from=position e done=scanned, fino all\'esito', async () => {
    const answers = [more(199, 200), more(399, 400), found(450, 451)];
    const locate = vi.fn(async () => answers.shift());
    const onFound = vi.fn();
    const box = mount({ listPath: LIST, locate, onFound });
    box.type('rossi');
    box.enter();
    await flush();
    expect(locate).toHaveBeenCalledTimes(3);
    const calls = callsOf(locate).map((c) => c[0] as Record<string, string>);
    expect(calls[0].from).toBe('-1');
    expect(calls[0].done).toBeUndefined();
    expect(calls[1]).toMatchObject({ navpath: LIST, option1: 'rossi', from: '199', done: '200' });
    expect(calls[2]).toMatchObject({ navpath: LIST, option1: 'rossi', from: '399', done: '400' });
    expect(onFound).toHaveBeenCalledTimes(1);
    expect(onFound).toHaveBeenCalledWith(450);
    expect(fb.info).not.toHaveBeenCalled();
  });

  it('more seguito da non trovato: un solo messaggio, a fine giro', async () => {
    const answers = [more(199, 200), notFound(1000)];
    const locate = vi.fn(async () => answers.shift());
    const onFound = vi.fn();
    const box = mount({ listPath: LIST, locate, onFound });
    box.type('rossi');
    box.enter();
    await flush();
    expect(locate).toHaveBeenCalledTimes(2);
    expect(onFound).not.toHaveBeenCalled();
    expect(fb.info).toHaveBeenCalledTimes(1);
  });

  it('dopo una ricerca a giri, il "trova il successivo" parte dal rigo trovato, senza done', async () => {
    const answers = [more(199, 200), found(450, 451), found(700)];
    const locate = vi.fn(async () => answers.shift());
    const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
    box.type('rossi');
    box.enter();
    await flush();
    box.enter();
    await flush();
    const last = callsOf(locate)[2][0] as Record<string, string>;
    expect(last.from).toBe('450');
    expect(last.done).toBeUndefined();
  });

  it('risposta senza located: si ferma in silenzio', async () => {
    const locate = vi.fn(async () => ({ errors: [{ type: 'ERROR', message: 'x' }] }));
    const onFound = vi.fn();
    const box = mount({ listPath: LIST, locate, onFound });
    box.type('rossi');
    box.enter();
    await flush();
    expect(locate).toHaveBeenCalledTimes(1);
    expect(onFound).not.toHaveBeenCalled();
    expect(fb.info).not.toHaveBeenCalled();
    expect(fb.error).not.toHaveBeenCalled();
  });

  it('risposta undefined (richiesta rifiutata dalla Shell): si ferma in silenzio e non resta bloccato', async () => {
    const answers: unknown[] = [undefined, found(4)];
    const locate = vi.fn(async () => answers.shift());
    const onFound = vi.fn();
    const box = mount({ listPath: LIST, locate, onFound });
    box.type('rossi');
    box.enter();
    await flush();
    expect(onFound).not.toHaveBeenCalled();
    expect(fb.info).not.toHaveBeenCalled();
    box.enter();
    await flush();
    expect(locate).toHaveBeenCalledTimes(2);
    expect(onFound).toHaveBeenCalledWith(4);
  });

  it('nessuna ricerca concorrente: Invio durante una ricerca in corso non parte', async () => {
    let release: (v: unknown) => void = () => {};
    const locate = vi.fn(() => new Promise((r) => { release = r; }));
    const onFound = vi.fn();
    const box = mount({ listPath: LIST, locate, onFound });
    box.type('rossi');
    box.enter();
    box.enter();
    await flush();
    box.enter();
    await flush();
    expect(locate).toHaveBeenCalledTimes(1);
    release(found(9));
    await flush();
    expect(onFound).toHaveBeenCalledTimes(1);
    expect(onFound).toHaveBeenCalledWith(9);
    // Finita la ricerca, si cerca di nuovo.
    locate.mockImplementation(async () => found(12));
    box.enter();
    await flush();
    expect(locate).toHaveBeenCalledTimes(2);
    expect((callsOf(locate)[1][0] as Record<string, string>).from).toBe('9');
  });

  it('nessuna ricerca concorrente anche se intanto cambia il testo', async () => {
    let release: (v: unknown) => void = () => {};
    const locate = vi.fn(() => new Promise((r) => { release = r; }));
    const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
    box.type('rossi');
    box.enter();
    box.type('bianchi');
    box.enter();
    await flush();
    expect(locate).toHaveBeenCalledTimes(1);
    release(found(1));
    await flush();
  });

  it('un server che risponde sempre more non fa girare il client all\'infinito', async () => {
    let n = 0;
    const locate = vi.fn(async () => { n++; return more(n * 200 - 1, n * 200); });
    const onFound = vi.fn();
    const box = mount({ listPath: LIST, locate, onFound });
    box.type('rossi');
    box.enter();
    await flush();
    for (let k = 0; k < 20; k++) await flush();
    expect(callsOf(locate).length).toBeLessThan(1000);
    expect(onFound).not.toHaveBeenCalled();
    // e il campo non resta bloccato
    locate.mockImplementation(async () => found(2));
    box.type('x');
    box.enter();
    await flush();
    expect(onFound).toHaveBeenCalledWith(2);
  });

  // Un'eccezione da locate si mostra come richiesta fallita (feedback.failure).
  // Se diventasse una Promise rifiutata senza gestore, vitest la segnala da se'
  // come "Unhandled Rejection" e il giro fallisce.
  describe('locate che fallisce (eccezione)', () => {
    it('il campo non resta bloccato: l\'Invio successivo cerca di nuovo', async () => {
      const locate = vi.fn()
        .mockImplementationOnce(async () => { throw new Error('rete'); })
        .mockImplementation(async () => found(5));
      const onFound = vi.fn();
      const box = mount({ listPath: LIST, locate, onFound });
      box.type('rossi');
      box.enter();
      await flush();
      box.enter();
      await flush();
      expect(locate).toHaveBeenCalledTimes(2);
      expect(onFound).toHaveBeenCalledWith(5);
    });

    it('l\'eccezione si mostra come richiesta fallita, senza onFound ne\' info', async () => {
      const err = new Error('rete');
      const locate = vi.fn(async () => { throw err; });
      const onFound = vi.fn();
      const box = mount({ listPath: LIST, locate, onFound });
      box.type('rossi');
      box.enter();
      await flush();
      expect(fb.failure).toHaveBeenCalledTimes(1);
      expect(fb.failure).toHaveBeenCalledWith(err);
      expect(onFound).not.toHaveBeenCalled();
      expect(fb.info).not.toHaveBeenCalled();
    });

    it('eccezione a meta\' di una ricerca a giri: si ferma, una sola failure', async () => {
      const locate = vi.fn()
        .mockImplementationOnce(async () => more(199, 200))
        .mockImplementationOnce(async () => { throw new Error('rete'); });
      const onFound = vi.fn();
      const box = mount({ listPath: LIST, locate, onFound });
      box.type('rossi');
      box.enter();
      await flush();
      expect(locate).toHaveBeenCalledTimes(2);
      expect(fb.failure).toHaveBeenCalledTimes(1);
      expect(onFound).not.toHaveBeenCalled();
    });
  });

  describe('revisione: giri finiti, campo svuotato, accenti', () => {
    it('dopo MAX_CONTINUATIONS+1 risposte "more": messaggio di ricerca interrotta, nessun onFound', async () => {
      const { MAX_CONTINUATIONS, stoppedMessage } = await import('./listSearch');
      let n = 0;
      const locate = vi.fn(async () => { n++; return more(n * 200 - 1, n * 200); });
      const onFound = vi.fn();
      const box = mount({ listPath: LIST, locate, onFound });
      box.type('rossi');
      box.enter();
      for (let k = 0; k < 20; k++) await flush();
      expect(callsOf(locate)).toHaveLength(MAX_CONTINUATIONS + 1);
      expect(onFound).not.toHaveBeenCalled();
      expect(fb.info).toHaveBeenCalledTimes(1);
      expect(fb.info).toHaveBeenCalledWith(stoppedMessage('rossi'));
    });

    it('il prossimo Invio riparte dalla posizione dell\'ultimo "more", senza done', async () => {
      const { MAX_CONTINUATIONS } = await import('./listSearch');
      let n = 0;
      const locate = vi.fn(async () => { n++; return more(n * 200 - 1, n * 200); });
      const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
      box.type('rossi');
      box.enter();
      for (let k = 0; k < 20; k++) await flush();
      const lastMore = (MAX_CONTINUATIONS + 1) * 200 - 1;
      locate.mockImplementation(async () => found(lastMore + 10));
      box.enter();
      await flush();
      const p = callsOf(locate).at(-1)![0] as Record<string, string>;
      expect(p.from).toBe(String(lastMore));
      expect(p.done).toBeUndefined();
      expect(p.option1).toBe('rossi');
    });

    it('dopo l\'interruzione un testo diverso ricomincia dall\'inizio', async () => {
      let n = 0;
      const locate = vi.fn(async () => { n++; return more(n * 200 - 1, n * 200); });
      const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
      box.type('rossi');
      box.enter();
      for (let k = 0; k < 20; k++) await flush();
      locate.mockImplementation(async () => found(1));
      box.type('bianchi');
      box.enter();
      await flush();
      expect((callsOf(locate).at(-1)![0] as Record<string, string>).from).toBe('-1');
    });

    it('svuotando il campo la memoria si azzera: lo stesso testo riparte da -1', async () => {
      const answers = [found(57), found(57)];
      const locate = vi.fn(async () => answers.shift());
      const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
      box.type('rossi');
      box.enter();
      await flush();
      box.type('');
      box.type('rossi');
      box.enter();
      await flush();
      expect((callsOf(locate)[1][0] as Record<string, string>).from).toBe('-1');
    });

    it('un campo di soli spazi vale come svuotato', async () => {
      const answers = [found(57), found(57)];
      const locate = vi.fn(async () => answers.shift());
      const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
      box.type('rossi');
      box.enter();
      await flush();
      box.type('   ');
      box.type('rossi');
      box.enter();
      await flush();
      expect((callsOf(locate)[1][0] as Record<string, string>).from).toBe('-1');
    });

    it('svuotare dopo un\'interruzione: si riparte dall\'inizio, non dall\'ultimo "more"', async () => {
      let n = 0;
      const locate = vi.fn(async () => { n++; return more(n * 200 - 1, n * 200); });
      const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
      box.type('rossi');
      box.enter();
      for (let k = 0; k < 20; k++) await flush();
      locate.mockImplementation(async () => found(3));
      box.type('');
      box.type('rossi');
      box.enter();
      await flush();
      const p = callsOf(locate).at(-1)![0] as Record<string, string>;
      expect(p.from).toBe('-1');
      expect(p.done).toBeUndefined();
    });

    it('modificare il testo senza svuotarlo non azzera: tornando allo stesso testo e\' "trova il successivo"', async () => {
      const answers = [found(57), found(80)];
      const locate = vi.fn(async () => answers.shift());
      const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
      box.type('rossi');
      box.enter();
      await flush();
      box.type('ross');
      box.type('rossi');
      box.enter();
      await flush();
      expect((callsOf(locate)[1][0] as Record<string, string>).from).toBe('57');
    });

    it.each([['citta'], ['CITTÀ'], ['Città']])('«città» poi «%s»: stesso testo, trova il successivo', async (second) => {
      const answers = [found(57), found(90)];
      const locate = vi.fn(async () => answers.shift());
      const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
      box.type('città');
      box.enter();
      await flush();
      box.type(second);
      box.enter();
      await flush();
      expect((callsOf(locate)[1][0] as Record<string, string>).from).toBe('57');
    });
  });

  describe('il precedente (all\'indietro)', () => {
    const P = (k: number) => (locate: { mock: { calls: unknown } }) => callsOf(locate)[k][0] as Record<string, string>;

    it('Invio cerca in avanti: niente dir (o dir positivo)', async () => {
      const locate = vi.fn(async () => found(5));
      const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
      box.type('rossi');
      box.enter();
      await flush();
      const dir = P(0)(locate).dir;
      expect(dir === undefined || Number(dir) > 0).toBe(true);
    });

    it('Maiusc+Invio cerca all\'indietro: dir=-1, from=-1 al primo giro', async () => {
      const locate = vi.fn(async () => found(990));
      const onFound = vi.fn();
      const box = mount({ listPath: LIST, locate, onFound });
      box.type('rossi');
      box.enter(true);
      await flush();
      expect(P(0)(locate)).toMatchObject({ navpath: LIST, option1: 'rossi', from: '-1', dir: '-1' });
      expect(onFound).toHaveBeenCalledWith(990);
    });

    it('Invio poi Maiusc+Invio con lo stesso testo: il precedente parte dal rigo trovato', async () => {
      const answers = [found(57), found(12)];
      const locate = vi.fn(async () => answers.shift());
      const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
      box.type('rossi');
      box.enter();
      await flush();
      box.enter(true);
      await flush();
      expect(P(1)(locate)).toMatchObject({ from: '57', dir: '-1' });
    });

    it('Maiusc+Invio poi Invio: il successivo parte dal rigo trovato all\'indietro, in avanti', async () => {
      const answers = [found(40), found(57)];
      const locate = vi.fn(async () => answers.shift());
      const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
      box.type('rossi');
      box.enter(true);
      await flush();
      box.enter();
      await flush();
      const p = P(1)(locate);
      expect(p.from).toBe('40');
      expect(p.dir === undefined || Number(p.dir) > 0).toBe(true);
    });

    it('le continuazioni all\'indietro mantengono il verso', async () => {
      const answers = [more(800, 200), more(600, 400), found(450, 551)];
      const locate = vi.fn(async () => answers.shift());
      const onFound = vi.fn();
      const box = mount({ listPath: LIST, locate, onFound });
      box.type('rossi');
      box.enter(true);
      await flush();
      expect(callsOf(locate)).toHaveLength(3);
      expect(P(1)(locate)).toMatchObject({ from: '800', done: '200', dir: '-1' });
      expect(P(2)(locate)).toMatchObject({ from: '600', done: '400', dir: '-1' });
      expect(onFound).toHaveBeenCalledWith(450);
    });

    it('le continuazioni in avanti restano in avanti', async () => {
      const answers = [more(199, 200), found(300, 301)];
      const locate = vi.fn(async () => answers.shift());
      const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
      box.type('rossi');
      box.enter();
      await flush();
      const p = P(1)(locate);
      expect(p).toMatchObject({ from: '199', done: '200' });
      expect(p.dir === undefined || Number(p.dir) > 0).toBe(true);
    });

    it('pulsante «Rigo precedente» = Maiusc+Invio', async () => {
      const answers = [found(57), found(12)];
      const locate = vi.fn(async () => answers.shift());
      const onFound = vi.fn();
      const box = mount({ listPath: LIST, locate, onFound });
      box.type('rossi');
      box.click('Rigo precedente');
      await flush();
      expect(P(0)(locate)).toMatchObject({ option1: 'rossi', from: '-1', dir: '-1' });
      box.click('Rigo precedente');
      await flush();
      expect(P(1)(locate)).toMatchObject({ from: '57', dir: '-1' });
      expect(onFound.mock.calls.map((c) => c[0])).toEqual([57, 12]);
    });

    it('pulsante «Rigo successivo» = Invio', async () => {
      const answers = [found(57), found(80)];
      const locate = vi.fn(async () => answers.shift());
      const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
      box.type('rossi');
      box.click('Rigo successivo');
      await flush();
      box.click('Rigo successivo');
      await flush();
      const p0 = P(0)(locate);
      const p1 = P(1)(locate);
      expect(p0.from).toBe('-1');
      expect(p1.from).toBe('57');
      expect(p0.dir === undefined || Number(p0.dir) > 0).toBe(true);
      expect(p1.dir === undefined || Number(p1.dir) > 0).toBe(true);
    });

    it('i pulsanti sono disabilitati a campo vuoto (anche di soli spazi), abilitati con un testo', () => {
      const box = mount({ listPath: LIST, locate: vi.fn(), onFound: vi.fn() });
      expect(box.button('Rigo precedente').props.disabled).toBe(true);
      expect(box.button('Rigo successivo').props.disabled).toBe(true);
      box.type('   ');
      expect(box.button('Rigo precedente').props.disabled).toBe(true);
      expect(box.button('Rigo successivo').props.disabled).toBe(true);
      box.type('rossi');
      expect(box.button('Rigo precedente').props.disabled).toBeFalsy();
      expect(box.button('Rigo successivo').props.disabled).toBeFalsy();
      box.type('');
      expect(box.button('Rigo successivo').props.disabled).toBe(true);
    });

    it('il mousedown dei pulsanti non toglie il fuoco al campo (preventDefault)', () => {
      const box = mount({ listPath: LIST, locate: vi.fn(), onFound: vi.fn() });
      box.type('rossi');
      for (const label of ['Rigo precedente', 'Rigo successivo']) {
        const ev = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
        (box.button(label).props.onMouseDown as (e: unknown) => void)(ev);
        expect(ev.preventDefault).toHaveBeenCalled();
      }
    });

    it('nessuna ricerca concorrente anche mescolando pulsanti e tasti', async () => {
      let release: (v: unknown) => void = () => {};
      const locate = vi.fn(() => new Promise((r) => { release = r; }));
      const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
      box.type('rossi');
      box.enter();
      box.click('Rigo precedente');
      box.enter(true);
      box.click('Rigo successivo');
      await flush();
      expect(locate).toHaveBeenCalledTimes(1);
      release(found(1));
      await flush();
    });

    it('all\'indietro, non trovato: lo stesso messaggio, nessun onFound', async () => {
      const locate = vi.fn(async () => notFound(1000));
      const onFound = vi.fn();
      const box = mount({ listPath: LIST, locate, onFound });
      box.type('zzz');
      box.enter(true);
      await flush();
      expect(onFound).not.toHaveBeenCalled();
      expect(fb.info).toHaveBeenCalledTimes(1);
    });
  });

  describe('revisione: frecce durante la ricerca, scorciatoie dichiarate', () => {
    it('l\'input dichiara le scorciatoie Enter e Shift+Enter', () => {
      const box = mount({ listPath: LIST, locate: vi.fn(), onFound: vi.fn() });
      const keys = String(box.el.props['aria-keyshortcuts'] ?? '').split(/\s+/);
      expect(keys).toContain('Enter');
      expect(keys).toContain('Shift+Enter');
    });

    it('le frecce sono disabilitate mentre una ricerca e\' in corso, e tornano abilitate alla fine', async () => {
      let release: (v: unknown) => void = () => {};
      const locate = vi.fn(() => new Promise((r) => { release = r; }));
      const box = mount({ listPath: LIST, locate, onFound: vi.fn() });
      box.type('rossi');
      expect(box.button('Rigo successivo').props.disabled).toBeFalsy();
      box.enter();
      await flush();
      box.render();
      expect(box.button('Rigo precedente').props.disabled).toBe(true);
      expect(box.button('Rigo successivo').props.disabled).toBe(true);
      release(found(3));
      await flush();
      box.render();
      expect(box.button('Rigo precedente').props.disabled).toBeFalsy();
      expect(box.button('Rigo successivo').props.disabled).toBeFalsy();
    });
  });

  describe('la tendina «dove cercare»', () => {
    const COLS = [
      { name: 'codice', label: 'Codice' },
      { name: 'descrizione', label: 'Descrizione' },
      { name: 'citta', label: 'Città' },
    ];
    const selectOf = (root: AnyEl) => findEl(root, (e) => e.props['aria-label'] === 'Dove cercare');
    const choose = (box: ReturnType<typeof mount>, value: string) => {
      const sel = selectOf(box.root);
      if (!sel) throw new Error('tendina non trovata');
      (sel.props.onChange as (v: string, o?: unknown) => void)(value, undefined);
      box.render();
    };
    const lastParams = (locate: { mock: { calls: unknown } }) => callsOf(locate).at(-1)![0] as Record<string, string>;

    it('senza colonne, o con una sola: niente tendina, solo l\'Input', () => {
      for (const columns of [undefined, [], [COLS[0]]]) {
        const box = mount({ listPath: LIST, locate: vi.fn(), onFound: vi.fn(), columns });
        expect(selectOf(box.root)).toBeUndefined();
        expect(box.root.props.placeholder).toBe('Cerca');
      }
    });

    it('con due o piu\' colonne: tendina «Dove cercare», prima voce «Tutte le colonne» (value \'\')', () => {
      const box = mount({ listPath: LIST, locate: vi.fn(), onFound: vi.fn(), columns: COLS });
      const sel = selectOf(box.root);
      expect(sel).toBeDefined();
      const options = sel!.props.options as { value: string; label: unknown }[];
      expect(options[0]).toMatchObject({ value: '', label: 'Tutte le colonne' });
      expect(options.slice(1).map((o) => [o.value, o.label])).toEqual(COLS.map((c) => [c.name, c.label]));
      expect(sel!.props.value).toBe('');
    });

    it('a tutte le colonne non si manda col', async () => {
      const locate = vi.fn(async () => found(5));
      const box = mount({ listPath: LIST, locate, onFound: vi.fn(), columns: COLS });
      box.type('rossi');
      box.enter();
      await flush();
      expect(lastParams(locate).col).toBeUndefined();
    });

    it('scelta una colonna, le ricerche mandano col (anche all\'indietro e nelle continuazioni)', async () => {
      const answers = [found(5), more(800, 200), found(450, 551)];
      const locate = vi.fn(async () => answers.shift());
      const box = mount({ listPath: LIST, locate, onFound: vi.fn(), columns: COLS });
      choose(box, 'descrizione');
      expect(selectOf(box.root)!.props.value).toBe('descrizione');
      box.type('rossi');
      box.enter();
      await flush();
      expect(callsOf(locate)[0][0]).toMatchObject({ col: 'descrizione', from: '-1' });
      box.enter(true);
      await flush();
      expect(callsOf(locate)[1][0]).toMatchObject({ col: 'descrizione', from: '5', dir: '-1' });
      expect(callsOf(locate)[2][0]).toMatchObject({ col: 'descrizione', from: '800', done: '200', dir: '-1' });
    });

    it('scegliere una colonna azzera la memoria: lo stesso testo riparte da -1', async () => {
      const answers = [found(57), found(9)];
      const locate = vi.fn(async () => answers.shift());
      const box = mount({ listPath: LIST, locate, onFound: vi.fn(), columns: COLS });
      box.type('rossi');
      box.enter();
      await flush();
      choose(box, 'citta');
      box.enter();
      await flush();
      expect(lastParams(locate)).toMatchObject({ from: '-1', col: 'citta' });
    });

    it('tornare a «Tutte le colonne» azzera anche quello e non manda col', async () => {
      const answers = [found(57), found(9)];
      const locate = vi.fn(async () => answers.shift());
      const box = mount({ listPath: LIST, locate, onFound: vi.fn(), columns: COLS });
      choose(box, 'citta');
      box.type('rossi');
      box.enter();
      await flush();
      choose(box, '');
      box.enter();
      await flush();
      const p = lastParams(locate);
      expect(p.from).toBe('-1');
      expect(p.col).toBeUndefined();
    });

    it('scegliere una colonna rimette il fuoco nell\'input (dopo che la tendina si e\' chiusa)', async () => {
      const box = mount({ listPath: LIST, locate: vi.fn(), onFound: vi.fn(), columns: COLS });
      const ref = box.el.props.ref as { current: unknown } | undefined;
      expect(ref && typeof ref === 'object').toBe(true);
      const focus = vi.fn();
      ref!.current = { focus };
      choose(box, 'codice');
      await flush();
      expect(focus).toHaveBeenCalled();
    });

    it('segnaposto: «Cerca» a tutte le colonne, «Cerca in <etichetta>» con una colonna scelta', () => {
      const box = mount({ listPath: LIST, locate: vi.fn(), onFound: vi.fn(), columns: COLS });
      expect(box.el.props.placeholder).toBe('Cerca');
      choose(box, 'citta');
      expect(box.el.props.placeholder).toBe('Cerca in Città');
      choose(box, 'descrizione');
      expect(box.el.props.placeholder).toBe('Cerca in Descrizione');
      choose(box, '');
      expect(box.el.props.placeholder).toBe('Cerca');
    });

    it('segnaposto: la colonna scelta che sparisce torna a «Cerca»', () => {
      const props: Props = { listPath: LIST, locate: vi.fn(), onFound: vi.fn(), columns: COLS };
      const box = mount(props);
      choose(box, 'citta');
      props.columns = [COLS[0], COLS[1]];
      box.render();
      expect(box.el.props.placeholder).toBe('Cerca');
    });

    it('la colonna scelta sparisce dalle colonne: si torna a tutte, niente col', async () => {
      const locate = vi.fn(async () => found(1));
      const props: Props = { listPath: LIST, locate, onFound: vi.fn(), columns: COLS };
      const box = mount(props);
      choose(box, 'descrizione');
      props.columns = [COLS[0], COLS[2]];
      box.render();
      expect(selectOf(box.root)!.props.value).toBe('');
      box.type('rossi');
      box.enter();
      await flush();
      expect(lastParams(locate).col).toBeUndefined();
    });

    it('la colonna sparita che poi ricompare non torna scelta da sola (si era tornati a tutte)', async () => {
      const locate = vi.fn(async () => found(1));
      const props: Props = { listPath: LIST, locate, onFound: vi.fn(), columns: COLS };
      const box = mount(props);
      choose(box, 'descrizione');
      props.columns = [COLS[0], COLS[2]];
      box.render();
      props.columns = COLS;
      box.render();
      expect(selectOf(box.root)!.props.value).toBe('');
      box.type('rossi');
      box.enter();
      await flush();
      expect(lastParams(locate).col).toBeUndefined();
    });

    it('le colonne scese sotto due: la tendina sparisce e non si manda col', async () => {
      const locate = vi.fn(async () => found(1));
      const props: Props = { listPath: LIST, locate, onFound: vi.fn(), columns: COLS };
      const box = mount(props);
      choose(box, 'codice');
      props.columns = [COLS[1]];
      box.render();
      expect(selectOf(box.root)).toBeUndefined();
      box.type('rossi');
      box.enter();
      await flush();
      expect(lastParams(locate).col).toBeUndefined();
    });
  });
});
