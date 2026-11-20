import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServerResponse } from '../types/ui';

// SXADV-6255 (domande sul Post di svuotamento): il Post della riga che precede
// l'azione della pagina puo' rispondere con una CONFIRMATION / YESNOCANCEL. Si
// risponde rigiocando lo STESSO Post con messages=<mnemonic>, (o :S, / :N,); solo
// quando il rigioco passa pulito parte l'azione originale, una volta sola.
//
// Base copiata da Shell.rowFlush.sxadv6255.test.tsx:
//
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
  // Effetti dichiarati nel disegno corrente con dipendenze cambiate: girano a
  // fine disegno (prima i layout, poi gli altri), come in React.
  pendingLayout: [] as (() => void)[],
  pendingEffects: [] as (() => void)[],
  effectErrors: [] as unknown[],
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
  // Slot per indice: dipendenze dell'ultimo giro e cleanup. Senza dipendenze
  // l'effetto gira a ogni disegno; confronto Object.is per posizione.
  const effect = (queue: () => (() => void)[]) => ((fn: () => unknown, deps?: unknown[]) => {
    const s = slot(() => ({ deps: undefined as unknown[] | undefined, cleanup: undefined as unknown, ran: false })).v as
      { deps: unknown[] | undefined; cleanup: unknown; ran: boolean };
    const changed = !s.ran || !deps || !s.deps || deps.length !== s.deps.length
      || deps.some((d, k) => !Object.is(d, s.deps![k]));
    if (!changed) return;
    s.ran = true;
    s.deps = deps;
    queue().push(() => {
      if (typeof s.cleanup === 'function') (s.cleanup as () => void)();
      s.cleanup = fn();
    });
  }) as AnyFn;
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
    useEffect: on(actual.useEffect as AnyFn, effect(() => rt.pendingEffects)),
    useLayoutEffect: on(actual.useLayoutEffect as AnyFn, effect(() => rt.pendingLayout)),
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

// Le domande mostrate: errori e callback, per rispondere come farebbe l'utente.
type Handlers = { onAnswer?: (p: unknown, a: 'yes' | 'no') => void; onCancel?: () => void };
const dialogs = vi.hoisted(() => [] as { errors: unknown[]; handlers: Handlers }[]);

// Hook della Shell che passano da antd o dal browser: estranei alla prova.
vi.mock('../hooks/feedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/feedback')>()),
  useFeedback: () => ({
    showServerMessages: (errors: unknown[], handlers?: unknown) => {
      dialogs.push({ errors, handlers: (handlers ?? {}) as Handlers });
    },
    error: () => {}, warning: () => {}, info: () => {}, failure: () => {}, confirm: () => {},
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
  // Gli effetti della Shell (che qui girano) si abbonano a eventi di finestra.
  window: (globalThis as { window?: unknown }).window ?? {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    innerWidth: 1280,
    innerHeight: 800,
    setTimeout: (f: () => void, ms?: number) => setTimeout(f, ms),
    clearTimeout: (h: ReturnType<typeof setTimeout>) => clearTimeout(h),
  },
});



const props = { menuItems: [], loginInfo: { login: '44AMM' }, onLogout: () => {}, onReloadMenu: () => {} };

function render(): void {
  rt.active = true;
  rt.i = 0;
  rt.callbacks = [];
  rt.pendingLayout = [];
  rt.pendingEffects = [];
  try {
    (Shell as unknown as (p: typeof props) => unknown)(props);
  } finally {
    rt.active = false;
  }
  // La ref di handleAction si riconosce dal valore iniziale: cercata prima che
  // l'effetto `handleActionRef.current = handleAction` la riempia.
  refSlot ??= rt.slots.find((sl) => {
    const v = sl.v as { current?: unknown } | null;
    return !!v && typeof v === 'object' && 'current' in v && typeof v.current === 'function'
      && /^async\(\)=>(undefined|void0)$/.test(String(v.current).replace(/\s+/g, ''));
  });
  // Gli effetti della Shell, come in React a fine disegno. Un effetto che tocca
  // il browser (assente: ambiente node) non deve far cadere la prova: il suo
  // errore si conserva in rt.effectErrors, gli altri effetti girano comunque.
  for (const run of [...rt.pendingLayout, ...rt.pendingEffects]) {
    try { run(); } catch (e) { rt.effectErrors.push(e); }
  }
  // L'effetto `handleActionRef.current = handleAction` (effetti spenti qui), fatto a
  // mano a ogni disegno come in Shell.totals.sxadv5490.test.ts: lo svuotamento del
  // pannello passa da quella ref.
  const ha = handleAction();
  if (!refSlot) throw new Error('handleActionRef non trovata');
  (refSlot.v as { current: unknown }).current = ha;
}

let refSlot: { v: unknown } | undefined;
/** Lo slot di useState della scheda attiva (trovato in beforeEach). */
let activeSlot: { v: unknown };

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
  dialogs.length = 0;
  rt.effectErrors = [];
  clearTemplates();
  render();
  const active = rt.slots.find((s) => s.v === 'home');
  active!.v = 'tab_1';
  activeSlot = active!;
  render();
  arriva(documento());
  server.postAction = [];
});


/** Lascia correre promise e setTimeout(0), ridisegnando fra un giro e l'altro. */
async function settle(): Promise<void> {
  for (let k = 0; k < 10; k++) {
    render();
    await new Promise((r) => setTimeout(r, 0));
  }
  render();
}

const azioni = () => server.postAction.map((p) => p.action);
const conferma = (mnemonic: string) => ({ errors: [{ type: 'CONFIRMATION', message: 'Confermi?', mnemonic }] });
const yesNo = (mnemonic: string) => ({ errors: [{ type: 'YESNOCANCEL', message: 'Procedo?', mnemonic }] });

/** L'ultima domanda mostrata (la sola con callback di risposta). */
function ultimaDomanda(): { errors: unknown[]; handlers: Handlers } {
  const d = dialogs.filter((x) => x.handlers.onAnswer || x.handlers.onCancel).at(-1);
  if (!d) throw new Error('nessuna domanda mostrata con onAnswer/onCancel');
  return d;
}
async function rispondi(answer: 'yes' | 'no'): Promise<void> {
  const d = ultimaDomanda();
  d.handlers.onAnswer?.(d.errors[0], answer);
  await settle();
}
async function annulla(): Promise<void> {
  ultimaDomanda().handlers.onCancel?.();
  await settle();
}

/** Salva+ della pagina con digitato nel pannello; il Post della riga risponde `resp`. */
async function salvaPiuConDomanda(resp: unknown): Promise<void> {
  scriviNelPannello('5');
  server.next.push(resp);
  await salvaPiu();
  await settle();
}

describe('SXADV-6255: domanda del server sul Post di svuotamento della riga', () => {
  it('la domanda del Post della riga si mostra con le callback di risposta', async () => {
    await salvaPiuConDomanda(conferma('M1'));
    expect(azioni()).toEqual(['Post']);
    const d = ultimaDomanda();
    expect(d.errors).toEqual([expect.objectContaining({ type: 'CONFIRMATION', mnemonic: 'M1' })]);
    expect(typeof d.handlers.onAnswer).toBe('function');
  });

  it('CONFIRMATION confermata: rigioca il Post della riga con messages="M1,"', async () => {
    await salvaPiuConDomanda(conferma('M1'));
    await rispondi('yes');
    const replay = server.postAction[1];
    expect(replay?.action).toBe('Post');
    expect(replay?.params.navpath).toBe(ROW);
    expect(replay?.params.messages).toBe('M1,');
  });

  it('CONFIRMATION confermata e rigioco pulito: parte poi la SaveAndNew del documento, una volta sola', async () => {
    await salvaPiuConDomanda(conferma('M1'));
    await rispondi('yes');
    await settle();
    expect(azioni()).toEqual(['Post', 'Post', 'SaveAndNew']);
    expect(server.postAction[2].params.navpath).toBe(DOC);
  });

  it('YESNOCANCEL risposta no: rigioco con "M1:N," e poi la SaveAndNew parte comunque', async () => {
    await salvaPiuConDomanda(yesNo('M1'));
    await rispondi('no');
    await settle();
    expect(server.postAction[1]?.params.messages).toBe('M1:N,');
    expect(server.postAction[1]?.params.navpath).toBe(ROW);
    expect(azioni()).toEqual(['Post', 'Post', 'SaveAndNew']);
    expect(server.postAction[2].params.navpath).toBe(DOC);
  });

  it('YESNOCANCEL risposta si: rigioco con "M1:S," e poi la SaveAndNew', async () => {
    await salvaPiuConDomanda(yesNo('M1'));
    await rispondi('yes');
    await settle();
    expect(server.postAction[1]?.params.messages).toBe('M1:S,');
    expect(azioni()).toEqual(['Post', 'Post', 'SaveAndNew']);
  });

  it('YESNOCANCEL annullata: niente rigioco, la SaveAndNew non parte', async () => {
    await salvaPiuConDomanda(yesNo('M1'));
    await annulla();
    expect(azioni()).toEqual(['Post']);
  });

  it('CONFIRMATION annullata: niente rigioco, la SaveAndNew non parte', async () => {
    await salvaPiuConDomanda(conferma('M1'));
    await annulla();
    expect(azioni()).toEqual(['Post']);
  });

  it('dopo un Annulla, un\'azione successiva non fa partire la SaveAndNew in ritardo', async () => {
    await salvaPiuConDomanda(conferma('M1'));
    await annulla();
    render();
    await handleAction()('Refresh', { navpath: DOC });
    await settle();
    expect(azioni().filter((a) => a === 'SaveAndNew')).toEqual([]);
  });

  it('dopo un Annulla, la risposta a un\'altra domanda non fa partire la SaveAndNew in ritardo', async () => {
    await salvaPiuConDomanda(conferma('M1'));
    await annulla();
    // Altra richiesta, altra domanda, confermata. Il pannello e' ancora sporco:
    // anche la Save passa prima da un Post sulla riga, che e' quello che chiede.
    server.next.push(conferma('M9'));
    render();
    await handleAction()('Save', { navpath: DOC });
    await settle();
    await rispondi('yes');
    await settle();
    expect(azioni().filter((a) => a === 'SaveAndNew')).toEqual([]);
    expect(azioni().at(-1)).toBe('Save');
  });

  it('il Post rigiocato risponde ERROR: la SaveAndNew non parte', async () => {
    await salvaPiuConDomanda(conferma('M1'));
    server.next.push({ errors: [{ type: 'ERROR', message: 'Quantita obbligatoria', mnemonic: 'MANDATORY' }] });
    await rispondi('yes');
    await settle();
    expect(azioni()).toEqual(['Post', 'Post']);
  });

  it('il Post rigiocato fa una seconda domanda: la SaveAndNew aspetta', async () => {
    await salvaPiuConDomanda(conferma('M1'));
    server.next.push(conferma('M2'));
    await rispondi('yes');
    await settle();
    expect(azioni()).toEqual(['Post', 'Post']);
  });

  it('seconda domanda confermata: rigioco con "M1,M2," e poi la SaveAndNew, una volta sola', async () => {
    await salvaPiuConDomanda(conferma('M1'));
    server.next.push(conferma('M2'));
    await rispondi('yes');
    await rispondi('yes');
    await settle();
    expect(server.postAction[2]?.action).toBe('Post');
    expect(server.postAction[2]?.params.navpath).toBe(ROW);
    expect(server.postAction[2]?.params.messages).toBe('M1,M2,');
    expect(azioni()).toEqual(['Post', 'Post', 'Post', 'SaveAndNew']);
    expect(server.postAction[3].params.navpath).toBe(DOC);
  });

  it('domanda di una richiesta normale (Save senza pannello sporco) confermata: solo il rigioco', async () => {
    server.next.push(conferma('M1'));
    render();
    await handleAction()('Save', { navpath: DOC });
    await settle();
    await rispondi('yes');
    await settle();
    expect(azioni()).toEqual(['Save', 'Save']);
    expect(server.postAction[1].params.messages).toBe('M1,');
    expect(server.postAction[1].params.navpath).toBe(DOC);
  });

  it('il parametro interno della concatenazione non arriva mai al server', async () => {
    await salvaPiuConDomanda(conferma('M1'));
    server.next.push(conferma('M2'));
    await rispondi('yes');
    await rispondi('yes');
    await settle();
    expect(server.postAction.length).toBeGreaterThan(1);
    for (const p of server.postAction) {
      expect(Object.keys(p.params).filter((k) => k.startsWith('_'))).toEqual([]);
    }
  });

  it('la risposta del rigioco arriva senza ridisegni (closure con la scheda in caricamento): la SaveAndNew parte al disegno dopo', async () => {
    await salvaPiuConDomanda(conferma('M1'));
    const d = ultimaDomanda();
    d.handlers.onAnswer?.(d.errors[0], 'yes');
    // Nessun disegno mentre il rigioco viaggia e i timer scattano: i gestori in
    // uso sono quelli del disegno in cui la scheda era ancora in caricamento.
    for (let k = 0; k < 10; k++) await new Promise((r) => setTimeout(r, 0));
    await settle();
    expect(azioni()).toEqual(['Post', 'Post', 'SaveAndNew']);
    expect(server.postAction[2].params.navpath).toBe(DOC);
  });

  it('rigioco riuscito ma nel frattempo e\' attiva un\'altra scheda: la SaveAndNew non parte, nemmeno tornando', async () => {
    await salvaPiuConDomanda(conferma('M1'));
    const d = ultimaDomanda();
    d.handlers.onAnswer?.(d.errors[0], 'yes');
    // Un'altra scheda di documento, quella su cui l'azione, se partisse, finirebbe.
    aggiungiScheda('tab_2');
    activeSlot.v = 'tab_2';
    await settle();
    expect(azioni()).toEqual(['Post', 'Post']);
    activeSlot.v = 'tab_1';
    await settle();
    expect(azioni()).toEqual(['Post', 'Post']);
  });

  it('rigioco riuscito con la scheda lasciata in caricamento: la SaveAndNew aspetta e parte a caricamento finito, una volta sola', async () => {
    await salvaPiuConDomanda(conferma('M1'));
    const d = ultimaDomanda();
    d.handlers.onAnswer?.(d.errors[0], 'yes');
    // La risposta del rigioco arriva (nessun disegno in mezzo) e un lavoro
    // asincrono partito da li' tiene la scheda in caricamento.
    for (let k = 0; k < 10; k++) await new Promise((r) => setTimeout(r, 0));
    impostaLoading(true);
    await settle();
    expect(azioni()).toEqual(['Post', 'Post']);
    impostaLoading(false);
    await settle();
    await settle();
    expect(azioni()).toEqual(['Post', 'Post', 'SaveAndNew']);
    expect(server.postAction[2].params.navpath).toBe(DOC);
  });

  it('Annulla su un\'altra scheda non butta l\'azione in attesa di questa', async () => {
    await salvaPiuConDomanda(conferma('M1'));
    const mia = ultimaDomanda();
    // Una domanda nata su un'altra scheda, annullata.
    render();
    processResponseInner()('home', conferma('MX') as unknown as ServerResponse);
    render();
    const suAltra = ultimaDomanda();
    expect(suAltra).not.toBe(mia);
    suAltra.handlers.onCancel?.();
    await settle();
    mia.handlers.onAnswer?.(mia.errors[0], 'yes');
    await settle();
    await settle();
    expect(azioni()).toEqual(['Post', 'Post', 'SaveAndNew']);
  });
});

/** Mette la scheda tab_1 in (o fuori da) caricamento, come farebbe un lavoro asincrono. */
function impostaLoading(loading: boolean): void {
  const tabsSlot = rt.slots.find((sl) => Array.isArray(sl.v)
    && (sl.v as { key?: unknown }[]).some((t) => t && typeof t === 'object' && t.key === 'tab_1'));
  if (!tabsSlot) throw new Error('stato delle schede non trovato');
  tabsSlot.v = (tabsSlot.v as { key: string }[]).map((t) => (t.key === 'tab_1' ? { ...t, loading } : t));
}

/** Una seconda scheda col documento, copia di tab_1 su un'altra sessione. */
function aggiungiScheda(key: string): void {
  const tabsSlot = rt.slots.find((sl) => Array.isArray(sl.v)
    && (sl.v as { key?: unknown }[]).some((t) => t && typeof t === 'object' && t.key === 'tab_1'));
  if (!tabsSlot) throw new Error('stato delle schede non trovato');
  const tabs = tabsSlot.v as { key: string; sid?: string }[];
  const t1 = tabs.find((t) => t.key === 'tab_1')!;
  tabsSlot.v = [...tabs, { ...t1, key, sid: 'S9', loading: false }];
}

afterEach(() => {
  // Un effetto della Shell che cade (browser assente) va visto, non taciuto.
  expect(rt.effectErrors).toEqual([]);
});
