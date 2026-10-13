import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerResponse } from '../types/ui';

// MD-NUOVO-IN-VOLO, flusso sulla Shell: dal momento in cui parte un Nuovo
// (Add / SaveAndNew) la scheda e' in attesa - il valore `waiting` che la Shell
// fornisce ad AddWaitContext e' vero - finche' il pannello non passa al rigo
// nuovo (settle) o la risposta dice che il rigo non c'e' (ERROR) o fa una
// domanda (CONFIRMATION). Le altre azioni (Post, Save...) non la aprono.
//
// Stesso motore di hook di Shell.staleTemplateKey.test.tsx (niente DOM: la
// Shell si esegue come funzione, stato e ref conservati per ordine di
// chiamata, effetti spenti). Il valore del contesto si legge nell'albero di
// elementi che la Shell restituisce: si cerca il Provider di AddWaitContext.

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
  postAction: [] as { action: string; params: Record<string, string> }[],
  next: [] as unknown[],
  // Risposte del polling di un job (api.checkProgress), in ordine.
  progress: [] as unknown[],
  progressCalls: 0,
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  postAction: async (action: string, params: Record<string, string>) => {
    server.postAction.push({ action, params: { ...params } });
    return server.next.shift() ?? {};
  },
  executeMenuItem: async () => server.next.shift() ?? {},
  subscribeInFlight: () => () => {},
  checkProgress: async () => {
    server.progressCalls++;
    return server.progress.shift() ?? {};
  },
}));

const { default: Shell } = await import('./Shell');
const { clearTemplates } = await import('../services/templateCache');
const { AddWaitContext } = await import('./ViewRenderer');

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

/** L'albero di elementi dell'ultimo disegno. */
let albero: unknown = null;

/** Un disegno della Shell: aggiorna le chiusure dei gestori. */
function render(): void {
  rt.active = true;
  rt.i = 0;
  rt.callbacks = [];
  try {
    albero = (Shell as unknown as (p: typeof props) => unknown)(props);
  } finally {
    rt.active = false;
  }
}

/** Il gestore della Shell riconosciuto da un pezzo del suo sorgente (senza
 *  apici: il sorgente trasformato li riscrive doppi). */
function handler<F>(marker: string): F {
  const found = rt.callbacks.filter((f) => f.toString().includes(marker));
  if (found.length !== 1) throw new Error(`gestore "${marker}": trovati ${found.length}`);
  return found[0] as unknown as F;
}

const processResponseInner = () =>
  handler<(tabKey: string, resp: ServerResponse) => void>('Sessione scaduta. Effettuare nuovamente il login.');
const handleAction = () =>
  handler<(action: string, params?: Record<string, string>) => Promise<void>>('serverParams.hasTemplate = ');

/** I valori forniti ad AddWaitContext nell'ultimo disegno (Provider classico
 *  o, in React 19, il contesto usato direttamente come componente). Si visita
 *  ogni prop, non solo children: antd mette parte dell'albero in `items`. */
function valoriAddWait(): { waiting: boolean }[] {
  const out: { waiting: boolean }[] = [];
  const visti = new Set<unknown>();
  const visita = (n: unknown, prof: number): void => {
    if (!n || typeof n !== 'object' || visti.has(n) || prof > 200) return;
    visti.add(n);
    if (Array.isArray(n)) { n.forEach((x) => visita(x, prof + 1)); return; }
    const el = n as { type?: unknown; props?: Record<string, unknown>; $$typeof?: unknown };
    if (el.$$typeof && el.props) {
      if (el.type === AddWaitContext.Provider || el.type === AddWaitContext) {
        out.push(el.props.value as { waiting: boolean });
      }
      for (const v of Object.values(el.props)) visita(v, prof + 1);
      return;
    }
    // Oggetti semplici (es. le voci `items` dei Tabs): si scende nei valori.
    if (Object.getPrototypeOf(n) === Object.prototype) {
      for (const v of Object.values(n)) visita(v, prof + 1);
    }
  };
  visita(albero, 0);
  return out;
}

/** Chiama settle() dal valore di contesto dell'ultimo disegno, come il pannello. */
function settle(): void {
  const v = valoriAddWait() as unknown as { settle: () => void }[];
  if (v.length === 0) throw new Error('AddWaitContext non fornito nell\'albero della Shell');
  v[0].settle();
  render();
}

/** Lascia girare le microtask (catena di promesse del polling). */
async function scorri(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  render();
}

/** La scheda e' in attesa? Fallisce chiaro se la Shell non fornisce il contesto. */
function inAttesa(): boolean {
  const v = valoriAddWait();
  if (v.length === 0) throw new Error('AddWaitContext non fornito nell\'albero della Shell');
  return v.some((x) => x.waiting === true);
}

/** Applica una risposta del server alla scheda, come all'arrivo. */
function arriva(resp: unknown): void {
  render();
  processResponseInner()('tab_1', resp as ServerResponse);
  render();
}

/** Una risposta del server tenuta in mano dal caso: la richiesta resta in volo. */
function inVolo(): { risposta: (r: unknown) => void } {
  let risolvi!: (r: unknown) => void;
  server.next.push(new Promise((r) => { risolvi = r; }));
  return { risposta: (r) => risolvi(r) };
}

/** Lancia un'azione della scheda senza aspettarla; restituisce la promessa. */
function lancia(action: string): Promise<void> {
  render();
  const p = handleAction()(action, {});
  render();
  return p;
}

/** Lista listEdit a resa completa: la scheda ha una videata su cui agire. */
function lista() {
  return {
    ui: {
      rows: [{ id: 'r0', cells: [{ elementType: 1, control: { name: 'descrizione', id: 'descrizione', type: 'text', editable: true } }] }],
      pageType: 1,
      path: 'S1-9',
      viewName: 'righeList',
      viewType: 'list',
    },
    toolbar: [],
  };
}

beforeEach(() => {
  rt.slots = [];
  rt.callbacks = [];
  server.postAction = [];
  server.next = [];
  server.progress = [];
  server.progressCalls = 0;
  clearTemplates();
  render();
  const active = rt.slots.find((s) => s.v === 'home');
  active!.v = 'tab_1';
  render();
  arriva(lista());
});

describe('Shell: il Nuovo mette la scheda in attesa', () => {
  it('prima di ogni Nuovo la scheda non e\' in attesa', () => {
    expect(inAttesa()).toBe(false);
  });

  it.each([['Add'], ['SaveAndNew']])('%s: in attesa dall\'invio, e resta dopo una risposta normale', async (azione) => {
    const volo = inVolo();
    const p = lancia(azione);
    expect(server.postAction.at(-1)?.action).toBe(azione);
    expect(inAttesa()).toBe(true);
    volo.risposta({});
    await p;
    render();
    // Risposta senza errori: si aspetta il cambio di rigo (settle) o il tetto.
    expect(inAttesa()).toBe(true);
  });

  it('una risposta con ERROR chiude l\'attesa', async () => {
    const volo = inVolo();
    const p = lancia('Add');
    expect(inAttesa()).toBe(true);
    volo.risposta({ errors: [{ type: 'ERROR', message: 'Riga non creata' }] });
    await p;
    render();
    expect(inAttesa()).toBe(false);
  });

  it('una risposta con CONFIRMATION chiude l\'attesa', async () => {
    const volo = inVolo();
    const p = lancia('Add');
    volo.risposta({ errors: [{ type: 'CONFIRMATION', message: 'Continuare?', mnemonic: 'X' }] });
    await p;
    render();
    expect(inAttesa()).toBe(false);
  });

  it('settle dal contesto chiude l\'attesa', async () => {
    const volo = inVolo();
    const p = lancia('Add');
    volo.risposta({});
    await p;
    render();
    expect(inAttesa()).toBe(true);
    const v = valoriAddWait().find((x) => x.waiting) as unknown as { settle: () => void };
    v.settle();
    render();
    expect(inAttesa()).toBe(false);
  });
});

describe('Shell: le altre azioni non toccano l\'attesa', () => {
  it.each([['Post'], ['Save']])('%s non apre l\'attesa', async (azione) => {
    const volo = inVolo();
    const p = lancia(azione);
    expect(inAttesa()).toBe(false);
    volo.risposta({});
    await p;
    render();
    expect(inAttesa()).toBe(false);
  });

  it('un Post che risponde mentre il Nuovo e\' in volo non la chiude', async () => {
    // Il Post parte prima, il Nuovo dopo; risponde prima il Post (con ERROR,
    // per giunta: e' la risposta di un'altra richiesta).
    const post = inVolo();
    const pPost = lancia('Post');
    const add = inVolo();
    const pAdd = lancia('Add');
    expect(inAttesa()).toBe(true);
    post.risposta({ errors: [{ type: 'ERROR', message: 'ricalcolo' }] });
    await pPost;
    render();
    expect(inAttesa()).toBe(true);
    add.risposta({});
    await pAdd;
    render();
    expect(inAttesa()).toBe(true);
  });
});

describe('Shell: REVISIONE 1', () => {
  it('settle prima della risposta all\'Add non chiude l\'attesa; dopo la risposta si\'', async () => {
    const volo = inVolo();
    const p = lancia('Add');
    expect(inAttesa()).toBe(true);
    // Il pannello passa a un rigo (es. quello di un Nuovo precedente) mentre
    // l'Add e' ancora in volo: il pannello resta bloccato.
    settle();
    expect(inAttesa()).toBe(true);
    volo.risposta({});
    await p;
    render();
    expect(inAttesa()).toBe(true);
    settle();
    expect(inAttesa()).toBe(false);
  });

  it('Add diventato job (trackAsynchJob senza ui): l\'attesa resta, settle non la chiude', async () => {
    // Il polling resta in volo: la risposta vera non e' ancora arrivata.
    let finePolling!: (r: unknown) => void;
    server.progress.push(new Promise((r) => { finePolling = r; }));
    const volo = inVolo();
    const p = lancia('Add');
    volo.risposta({ trackAsynchJob: true });
    await p;
    await scorri();
    expect(inAttesa()).toBe(true);
    expect(server.progressCalls).toBeGreaterThan(0);
    settle();
    expect(inAttesa()).toBe(true);

    // Risposta finale del polling (job finito): ora il cambio di rigo chiude.
    finePolling({ progress: 100 });
    await scorri();
    expect(inAttesa()).toBe(true);
    settle();
    expect(inAttesa()).toBe(false);
  });

  it('Add diventato job, polling finito con ERROR: l\'attesa si chiude', async () => {
    server.progress.push({ progress: 100, errors: [{ type: 'ERROR', message: 'job fallito' }] });
    const volo = inVolo();
    const p = lancia('Add');
    volo.risposta({ uiData: { showProgress: true } });
    await p;
    await scorri();
    expect(server.progressCalls).toBeGreaterThan(0);
    expect(inAttesa()).toBe(false);
  });

  it('Add diventato job, polling che fallisce (rete): l\'attesa si chiude', async () => {
    // pollProgress rilancia l'errore e processResponse non lo aspetta (gia'
    // cosi' prima di MD-NUOVO-IN-VOLO): il rigetto resta senza gestore. Qui lo
    // si raccoglie, perche' non sporchi l'esecuzione, e si controlla che sia il
    // nostro.
    const rigetti: unknown[] = [];
    const raccogli = (e: unknown) => { rigetti.push(e); };
    // L'ambiente dei test e' node, ma tsconfig.app non ne ha i tipi.
    const processo = (globalThis as unknown as {
      process: { on(ev: string, f: (e: unknown) => void): void; off(ev: string, f: (e: unknown) => void): void };
    }).process;
    processo.on('unhandledRejection', raccogli);
    try {
      server.progress.push(Promise.reject(new Error('rete')));
      const volo = inVolo();
      const p = lancia('Add');
      volo.risposta({ trackAsynchJob: true });
      await p.catch(() => {});
      await scorri();
      await new Promise((r) => setTimeout(r, 0));
      expect(server.progressCalls).toBeGreaterThan(0);
      expect(inAttesa()).toBe(false);
      expect(rigetti.map((e) => (e as Error).message)).toEqual(['rete']);
    } finally {
      processo.off('unhandledRejection', raccogli);
    }
  });
});
