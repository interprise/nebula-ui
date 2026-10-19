import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UIControl } from '../../types/ui';

// SXADV-5641 — il combo (lookup remoto «Cliente» nel detail fattura, e il ramo
// con elenco statico) deve comportarsi come la combo ExtJS del legacy:
//
//  C. Scelto un elemento, si esce dal campo e si rientra: la didascalia e' nel
//     campo tutta selezionata (selectOnFocus). UN SOLO Canc, oppure un solo
//     Backspace, oppure la Barra spaziatrice SVUOTANO il valore (commit del
//     vuoto). Oggi il primo Canc cancella solo il testo dell'input e serve un
//     secondo Canc. Se invece l'utente sta scrivendo un filtro suo, o ha
//     selezionato solo una PARTE del testo, i tasti modificano il testo e il
//     valore resta. A campo vuoto non c'e' niente da svuotare.
//  D. Digitata una stringa (tendina aperta coi risultati), la FINESTRA perde il
//     fuoco (ALT+TAB / CTRL+TAB): il browser manda blur all'input, ma
//     document.hasFocus() diventa false e activeElement resta l'input. Tornando,
//     la stringa deve essere ancora nel campo e la tendina aperta. Un blur
//     vero (fuoco a un altro campo) resta quello di oggi.
//  B. Fuoco nel campo valorizzato, tendina chiusa: un mousedown sul corpo serve
//     a selezionare col mouse una parte del testo, quindi non apre la lista,
//     non chiama preventDefault e non cambia il testo dell'input. (Il resto
//     dipende da antd e si verifica a schermo.)
//
// Niente DOM: stesso motore di hook di Shell.sxadv5989z.test.tsx. Il Select di
// antd e' un finto di cui si leggono le props; il componente si esegue come
// funzione, i setState scrivono negli slot e si "ridisegna" a mano, cosi' lo
// stato (testo di ricerca, tendina, valore) sopravvive fra un gesto e l'altro.
// L'input e' un oggetto semplice: valore, selezione, select().

const rt = vi.hoisted(() => ({
  active: false,
  i: 0,
  slots: [] as { v: unknown }[],
  effects: [] as (() => unknown)[],
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
    useCallback: on(actual.useCallback as AnyFn, ((fn: AnyFn) => fn) as AnyFn),
    useMemo: on(actual.useMemo as AnyFn, ((f: () => unknown) => f()) as AnyFn),
    // Gli effetti girano dopo ogni "ridisegno" (senza confronto delle
    // dipendenze: quelli del combo sono idempotenti).
    useEffect: on(actual.useEffect as AnyFn, ((f: () => unknown) => { rt.effects.push(f); }) as AnyFn),
    useLayoutEffect: on(actual.useLayoutEffect as AnyFn, ((f: () => unknown) => { rt.effects.push(f); }) as AnyFn),
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

// Il Select finto: lo si riconosce nell'albero per identita'.
const fake = vi.hoisted(() => ({ Select: null as unknown }));
vi.mock('antd', async (importOriginal) => {
  const real = await importOriginal<typeof import('antd')>();
  const Select = () => null;
  fake.Select = Select;
  return { ...real, Select };
});

// Il server del lookup: risponde con le voci che il caso prepara.
const server = vi.hoisted(() => ({ rows: [] as { value: string; text: string }[] }));
vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  fetchComboOptions: async () => server.rows,
}));

const { default: ComboControl } = await import('./ComboControl');

/* Il minimo di browser ------------------------------------------------------ */

interface FintoInput {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  select: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
}

function nuovoInput(): FintoInput {
  const input: FintoInput = {
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    select: vi.fn(() => {
      input.selectionStart = 0;
      input.selectionEnd = input.value.length;
    }),
    focus: vi.fn(),
  };
  return input;
}

const altroCampo = { nome: 'un altro campo della pagina' };
const doc = { activeElement: null as unknown, hasFocus: () => true };
let fotogrammi: (() => void)[] = [];
Object.assign(globalThis, {
  document: doc,
  requestAnimationFrame: (f: () => void) => { fotogrammi.push(f); return fotogrammi.length; },
  cancelAnimationFrame: () => {},
});
function flushFrames() {
  const f = fotogrammi;
  fotogrammi = [];
  f.forEach((x) => x());
}

/* Il motore: esegue ComboControl (e RemoteCombo) e ne raccoglie il Select ---- */

type Props = Record<string, unknown>;
type El = { type?: unknown; props?: Props } | null | undefined;

function trovaSelect(node: unknown): Props | undefined {
  if (node == null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const n of node) {
      const p = trovaSelect(n);
      if (p) return p;
    }
    return undefined;
  }
  const el = node as El;
  if (!el?.props) return undefined;
  if (el.type === fake.Select) return el.props;
  // Fra i componenti si esegue solo RemoteCombo; il resto (decorazioni) si
  // attraversa senza eseguirlo.
  if (typeof el.type === 'function' && (el.type as { name?: string }).name === 'RemoteCombo') {
    return trovaSelect((el.type as (p: Props) => unknown)(el.props));
  }
  return trovaSelect(el.props.children);
}

const NAME = 'cliente.S1-0';

interface Banco {
  props: Props;
  input: FintoInput;
  onChange: ReturnType<typeof vi.fn>;
  render: () => Props;
}

function banco(control: Partial<UIControl>): Banco {
  rt.slots = [];
  const input = nuovoInput();
  const onChange = vi.fn();
  const c = {
    type: 'combo', name: NAME, id: 'cliente', editable: true, controlName: 'cliente', navpath: 'S1-0',
    ...control,
  } as UIControl;
  const b: Banco = {
    props: {},
    input,
    onChange,
    render: () => {
      rt.active = true;
      rt.i = 0;
      rt.effects = [];
      try {
        const out = (ComboControl as unknown as (p: Props) => unknown)({
          control: c, pageType: 2, onAction: () => {}, onChange,
        });
        const props = trovaSelect(out);
        if (!props) throw new Error('il Select non e\' stato reso');
        rt.effects.forEach((f) => f());
        b.props = props;
      } finally {
        rt.active = false;
      }
      // Il ref del Select punta all'input finto (inputEl() di useComboTextField).
      const ref = b.props.ref as { current: unknown } | undefined;
      if (ref && !ref.current) {
        ref.current = { nativeElement: { querySelector: () => input }, focus: () => {}, blur: () => {} };
      }
      return b.props;
    },
  };
  b.render();
  return b;
}

const remoto = (over: Partial<UIControl> = {}) =>
  banco({ remote: true, value: 'C01', displayText: 'ROSSI MARIO', ...over });
const statico = (over: Partial<UIControl> = {}) =>
  banco({
    remote: false,
    value: 'A',
    options: [{ value: 'A', text: 'ALFA' }, { value: 'B', text: 'BETA' }],
    ...over,
  } as Partial<UIControl>);

/** Il fuoco entra nel campo (TAB o clic): antd chiama onFocus, il campo si
 *  ridisegna con la didascalia nell'input, al fotogramma dopo la seleziona. */
function entra(b: Banco) {
  doc.activeElement = b.input;
  (b.props.onFocus as (e: unknown) => void)({ target: b.input });
  b.render();
  b.input.value = String(b.props.searchValue ?? '');
  b.input.selectionStart = b.input.selectionEnd = b.input.value.length;
  flushFrames();
}

/** L'utente digita: antd chiama onSearch con il testo dell'input. */
function digita(b: Banco, testo: string) {
  (b.props.onSearch as (q: string) => void)(testo);
  b.render();
  b.input.value = String(b.props.searchValue ?? '');
  b.input.selectionStart = b.input.selectionEnd = b.input.value.length;
}

/** Chiusura della tendina come la fa rc-select: onOpenChange(false) e, quando
 *  la tendina si e' chiusa davvero, l'effetto che ripulisce il testo di
 *  ricerca con onSearch('') (BaseSelect: "Clean up search value when the
 *  dropdown is closed"; solo se il testo non e' gia' vuoto). */
function chiudeAntd(b: Banco) {
  const openChange = (b.props.onOpenChange ?? b.props.onDropdownVisibleChange) as ((v: boolean) => void) | undefined;
  openChange?.(false);
  b.render();
  if (!b.props.open && b.props.searchValue) {
    (b.props.onSearch as (q: string) => void)('');
    b.render();
  }
}

/** Blur dell'input.
 *  - `campo`: il fuoco va a un altro campo della pagina. rc-select, in un
 *    macrotask, chiede di chiudere la tendina (onRootBlur).
 *  - `finestra`: la finestra perde il fuoco (ALT+TAB, CTRL+TAB). hasFocus()
 *    diventa false e activeElement resta l'input: rc-select annulla da se' la
 *    chiusura (cancelFun = isInside(..., document.activeElement)), quindi
 *    onOpenChange(false) NON arriva. Arriva solo il nostro onBlur. */
function esce(b: Banco, modo: 'campo' | 'finestra') {
  if (modo === 'finestra') {
    doc.hasFocus = () => false;
    doc.activeElement = b.input;
  } else {
    doc.hasFocus = () => true;
    doc.activeElement = altroCampo;
  }
  (b.props.onBlur as (e: unknown) => void)({ target: b.input, relatedTarget: modo === 'campo' ? altroCampo : null });
  b.render();
  if (modo === 'campo' && b.props.open) chiudeAntd(b);
}

/** Si torna sulla finestra: il browser ridà il fuoco all'input. */
function tornaNellaFinestra(b: Banco) {
  doc.hasFocus = () => true;
  doc.activeElement = b.input;
  (b.props.onFocus as (e: unknown) => void)({ target: b.input });
  b.render();
  flushFrames();
}

function tasto(b: Banco, key: string, over: Record<string, unknown> = {}) {
  const e = {
    key,
    code: key === ' ' ? 'Space' : key,
    ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    target: b.input,
    currentTarget: b.input,
    ...over,
  };
  (b.props.onKeyDown as (ev: unknown) => void)(e);
  b.render();
  return e;
}

/** Il valore e' stato svuotato: il commit del vuoto e' arrivato a Shell. */
function svuotato(b: Banco) {
  expect(b.onChange).toHaveBeenCalled();
  const last = b.onChange.mock.calls.at(-1)!;
  expect(last[0]).toBe(NAME);
  expect(last[1] ?? '').toBe('');
}

beforeEach(() => {
  doc.activeElement = null;
  doc.hasFocus = () => true;
  fotogrammi = [];
  server.rows = [];
  // Solo i timer: requestAnimationFrame resta quello finto qui sopra.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});
afterEach(() => {
  vi.useRealTimers();
});

/* Premessa: il rimedio del 09/09 (SXADV-5641.1) ------------------------------ */

describe('premessa: al rientro la didascalia e\' nell\'input, tutta selezionata', () => {
  it('lookup remoto: searchValue = didascalia, select() sull\'input', () => {
    const b = remoto();
    entra(b);
    expect(b.props.searchValue).toBe('ROSSI MARIO');
    expect(b.props.open).toBe(false);
    expect(b.input.select).toHaveBeenCalled();
    expect([b.input.selectionStart, b.input.selectionEnd]).toEqual([0, 'ROSSI MARIO'.length]);
  });
});

/* 5641C ---------------------------------------------------------------------- */

describe('SXADV-5641C: didascalia tutta selezionata, un solo tasto svuota il valore', () => {
  for (const [nome, key] of [['Canc', 'Delete'], ['Backspace', 'Backspace'], ['Barra spaziatrice', ' ']] as const) {
    it(`lookup remoto: un solo ${nome} svuota il valore`, () => {
      const b = remoto();
      entra(b);
      const e = tasto(b, key);
      svuotato(b);
      // La didascalia del vuoto (contratto SXADV-5989): niente nominativo di prima.
      expect(b.onChange.mock.calls.at(-1)![2]).toBe('');
      // Il tasto e' consumato: il browser non deve ANCHE cancellare il testo o
      // scriverci uno spazio (che con onSearch(' ') aprirebbe la lista).
      expect(e.preventDefault).toHaveBeenCalled();
      // Il campo resta vuoto davvero: niente valore, niente didascalia nell'input.
      expect(b.props.value ?? undefined).toBeUndefined();
      expect(b.props.searchValue ?? '').toBe('');
      expect(b.props.open).toBe(false);
    });
  }

  it('lookup remoto, percorso intero: scelta, uscita, rientro, un solo Canc', async () => {
    server.rows = [{ value: 'C02', text: 'VERDI LUCA' }];
    const b = remoto();
    entra(b);
    digita(b, 'ver');
    await vi.advanceTimersByTimeAsync(300); // debounce della ricerca + risposta
    b.render();
    (b.props.onChange as (v: unknown, o: unknown) => void)('C02', { value: 'C02', label: 'VERDI LUCA' });
    b.render();
    chiudeAntd(b); // la scelta chiude la tendina
    expect(b.onChange.mock.calls.at(-1)!.slice(0, 3)).toEqual([NAME, 'C02', 'VERDI LUCA']);
    esce(b, 'campo');
    entra(b);
    expect(b.props.searchValue).toBe('VERDI LUCA');
    b.onChange.mockClear();
    tasto(b, 'Delete');
    svuotato(b);
    expect(b.onChange).toHaveBeenCalledTimes(1);
  });

  for (const [nome, key] of [['Canc', 'Delete'], ['Backspace', 'Backspace'], ['Barra spaziatrice', ' ']] as const) {
    it(`elenco statico: un solo ${nome} svuota il valore`, () => {
      const b = statico();
      entra(b);
      expect(b.props.searchValue).toBe('ALFA');
      const e = tasto(b, key);
      svuotato(b);
      expect(e.preventDefault).toHaveBeenCalled();
      expect(b.props.value ?? undefined).toBeUndefined();
      expect(b.props.searchValue ?? '').toBe('');
    });
  }

  it('selezione PARZIALE della didascalia (solo "ROSSI"): Canc modifica il testo, il valore resta', () => {
    const b = remoto();
    entra(b);
    b.input.selectionStart = 0;
    b.input.selectionEnd = 5;
    const e = tasto(b, 'Delete');
    expect(b.onChange).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('selezione PARZIALE: Backspace e Barra non svuotano', () => {
    const b = remoto();
    entra(b);
    b.input.selectionStart = 6;
    b.input.selectionEnd = 11; // "MARIO"
    tasto(b, 'Backspace');
    tasto(b, ' ');
    expect(b.onChange).not.toHaveBeenCalled();
  });

  it('cursore senza selezione in fondo alla didascalia: Backspace toglie un carattere, il valore resta', () => {
    const b = remoto();
    entra(b);
    b.input.selectionStart = b.input.selectionEnd = b.input.value.length;
    const e = tasto(b, 'Backspace');
    expect(b.onChange).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('filtro scritto dall\'utente, tutto selezionato: Canc lo modifica, il valore resta', () => {
    const b = remoto();
    entra(b);
    digita(b, 'ros');
    b.input.selectionStart = 0;
    b.input.selectionEnd = 3;
    const e = tasto(b, 'Delete');
    expect(b.onChange).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('filtro scritto dall\'utente: la Barra e\' uno spazio del filtro ("rossi m"), non uno svuotamento', () => {
    const b = remoto();
    entra(b);
    digita(b, 'rossi');
    const e = tasto(b, ' ');
    expect(b.onChange).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('campo gia\' vuoto: niente da svuotare (Canc, Backspace, Barra)', () => {
    const b = remoto({ value: null, displayText: undefined });
    entra(b);
    tasto(b, 'Delete');
    tasto(b, 'Backspace');
    tasto(b, ' ');
    expect(b.onChange).not.toHaveBeenCalled();
  });

  it('regressione: input vuoto con un valore (didascalia fuori dall\'input) — Canc svuota come prima', () => {
    const b = remoto();
    // Nessun onFocus: searchValue vuoto, l'input e' vuoto.
    tasto(b, 'Delete');
    svuotato(b);
  });

  it('regressione: Ctrl+Spazio apre la lista e non svuota', () => {
    const b = remoto();
    entra(b);
    tasto(b, ' ', { ctrlKey: true });
    expect(b.onChange).not.toHaveBeenCalled();
    expect(b.props.open).toBe(true);
  });
});

/* 5641D ---------------------------------------------------------------------- */

describe('SXADV-5641D: la finestra perde il fuoco mentre si digita', () => {
  it('lookup remoto: tornando, la stringa digitata e\' ancora nel campo', () => {
    const b = remoto();
    entra(b);
    digita(b, 'ros');
    expect(b.props.open).toBe(true);
    esce(b, 'finestra');
    tornaNellaFinestra(b);
    expect(b.props.searchValue).toBe('ros');
  });

  it('lookup remoto: tornando, la tendina e\' ancora aperta', () => {
    const b = remoto();
    entra(b);
    digita(b, 'ros');
    esce(b, 'finestra');
    tornaNellaFinestra(b);
    expect(b.props.open).toBe(true);
  });

  it('lookup remoto: anche prima del ritorno (finestra in secondo piano) il testo non e\' azzerato', () => {
    const b = remoto();
    entra(b);
    digita(b, 'ros');
    esce(b, 'finestra');
    expect(b.props.searchValue).toBe('ros');
  });

  it('lookup remoto: perdere la finestra non fa commit di nulla', () => {
    const b = remoto();
    entra(b);
    digita(b, 'ros');
    esce(b, 'finestra');
    tornaNellaFinestra(b);
    expect(b.onChange).not.toHaveBeenCalled();
  });

  it('elenco statico: tornando, il filtro digitato e\' ancora nel campo', () => {
    const b = statico();
    entra(b);
    digita(b, 'be');
    esce(b, 'finestra');
    tornaNellaFinestra(b);
    expect(b.props.searchValue).toBe('be');
    expect(b.props.open).toBe(true);
  });

  it('senza digitazione: tornando nella finestra la didascalia e\' di nuovo nell\'input', () => {
    const b = remoto();
    entra(b);
    esce(b, 'finestra');
    tornaNellaFinestra(b);
    expect(b.props.searchValue).toBe('ROSSI MARIO');
    expect(b.props.open).toBe(false);
  });

  it('tornati nella finestra, il filtro (anche tutto selezionato) si modifica col Canc: il valore resta', () => {
    const b = remoto();
    entra(b);
    digita(b, 'ros');
    esce(b, 'finestra');
    tornaNellaFinestra(b);
    b.input.value = String(b.props.searchValue ?? '');
    b.input.selectionStart = 0;
    b.input.selectionEnd = b.input.value.length;
    tasto(b, 'Delete');
    expect(b.onChange).not.toHaveBeenCalled();
  });

  it('si torna cliccando DIRETTAMENTE un altro campo: la tendina si chiude e il testo se ne va, nessun commit', () => {
    const b = remoto();
    entra(b);
    digita(b, 'ros');
    esce(b, 'finestra');
    // Il mousedown fuori dal Select lo intercetta rc-select (useSelectTriggerControl)
    // e chiude la tendina; l'input non riceve un altro blur.
    doc.hasFocus = () => true;
    doc.activeElement = altroCampo;
    chiudeAntd(b);
    expect(b.props.open).toBe(false);
    expect(b.props.searchValue ?? '').toBe('');
    expect(b.onChange).not.toHaveBeenCalled();
    // Rientrando nel campo torna la didascalia del valore, tutta selezionata.
    entra(b);
    expect(b.props.searchValue).toBe('ROSSI MARIO');
    expect([b.input.selectionStart, b.input.selectionEnd]).toEqual([0, 'ROSSI MARIO'.length]);
  });

  it('regressione: blur vero (fuoco a un altro campo) azzera il testo e chiude la tendina', () => {
    const b = remoto();
    entra(b);
    digita(b, 'ros');
    esce(b, 'campo');
    expect(b.props.searchValue ?? '').toBe('');
    expect(b.props.open).toBe(false);
  });

  it('regressione: dopo un blur vero, rientrando torna la didascalia del valore (non il filtro)', () => {
    const b = remoto();
    entra(b);
    digita(b, 'ros');
    esce(b, 'campo');
    entra(b);
    expect(b.props.searchValue).toBe('ROSSI MARIO');
    expect(b.props.open).toBe(false);
  });
});

/* 5641B ---------------------------------------------------------------------- */

describe('SXADV-5641B: col mouse si seleziona una parte del testo', () => {
  function mousedown(b: Banco) {
    const e = { button: 0, target: b.input, currentTarget: b.input, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    (b.props.onMouseDown as ((ev: unknown) => void) | undefined)?.(e);
    b.render();
    return e;
  }

  it('lookup remoto valorizzato, fuoco dentro, tendina chiusa: il mousedown non apre e non tocca il testo', () => {
    const b = remoto();
    entra(b);
    const prima = b.props.searchValue;
    const e = mousedown(b);
    expect(b.props.open).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(b.props.searchValue).toBe(prima);
    expect(b.onChange).not.toHaveBeenCalled();
  });

  it('elenco statico valorizzato: idem', () => {
    const b = statico();
    entra(b);
    const e = mousedown(b);
    expect(b.props.open).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(b.props.searchValue).toBe('ALFA');
  });

  it('il secondo clic (fuoco gia\' dentro) non riseleziona tutto: niente select() oltre a quella del rientro', () => {
    const b = remoto();
    entra(b);
    b.input.select.mockClear();
    b.input.selectionStart = 6;
    b.input.selectionEnd = 11; // l'utente ha trascinato su "MARIO"
    mousedown(b);
    flushFrames();
    expect(b.input.select).not.toHaveBeenCalled();
  });
});
