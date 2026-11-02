import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerResponse } from '../types/ui';

// SXADV-6015 — lista multiEdit (anagraficheListSelCmp, colonna `selected`): la
// casella in griglia mette in formValues l'array della colonna, una voce per riga
// della pagina a schermo, sotto `selected.<lista>`. Il server lo legge per
// POSIZIONE sulle righe della pagina corrente. L'array parte col cambio pagina e
// li' finisce il suo valore: una risposta di sola pagina (`ui.pageOnly`) non deve
// lasciarlo nei formValues. Rimasto li', parte con la richiesta dopo e il server
// lo scrive sulla pagina NUOVA: la spunta della riga 2 di pagina 1 diventa la
// spunta della riga 2 di pagina 2, che nessuno ha toccato.
//
// Stesso motore di hook di Shell.sxadv5989z.test.tsx (niente DOM: la Shell si
// esegue come funzione, i gestori veri si riconoscono dal sorgente). Non e' montata
// la griglia: l'array entra da handleGridChange, dove lo spinge ListRenderer con
// pushColumnValues. Quel passaggio dentro AG Grid qui NON e' provato.

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

const handleGridChange = () =>
  handler<(name: string, values: string[]) => void>('tab.formValues[name] = values');

const LISTA = 'S1-7';
const CAMPO = `selected.${LISTA}`;

function riga(pos: number): unknown {
  return { id: `r${pos}`, cells: [{ elementType: 1, pos, control: { type: 'boolean', name: 'selected', id: `s${pos}` } }] };
}

function righe(da: number, quante: number): unknown[] {
  return Array.from({ length: quante }, (_, i) => riga(da + i));
}

/** Apertura della lista: resa intera. */
function lista(): unknown {
  return {
    ui: {
      viewName: 'anagraficheListSelCmp',
      viewType: 'list',
      pageType: 1,
      path: `${LISTA}.0`,
      multiEdit: true,
      listEdit: true,
      rows: righe(0, 3),
      paging: { page: 1, pages: 3 },
    },
    toolbar: [],
  };
}

/** Risposta di un cambio pagina (render mode P). */
function pagina(da: number, quante: number, page: number): unknown {
  return { ui: { pageOnly: true, path: `${LISTA}.${da}`, rows: righe(da, quante), paging: { page, pages: 3 } } };
}

async function esegui(action: string, params: Record<string, string> = {}) {
  render();
  await handleAction()(action, params);
  render();
  const last = server.postAction.at(-1);
  expect(last?.action).toBe(action);
  return last!;
}

function spunta(values: string[]): void {
  render();
  handleGridChange()(CAMPO, values);
  render();
}

beforeEach(() => {
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
  arriva(lista());
});

const CAMBI: [string, Record<string, string>][] = [
  ['NextPage', {}],
  ['PrevPage', {}],
  ['FirstPage', {}],
  ['LastPage', {}],
  ['GotoPage', { option1: '2' }],
  ['SetPageSize', { option1: '30' }],
];

describe('SXADV-6015: l\'array di spunte della pagina lasciata', () => {
  it.each(CAMBI)('%s porta al server l\'array della pagina a schermo', async (action, params) => {
    spunta(['false', 'true', 'false']);
    server.next.push(pagina(3, 2, 2));
    const sent = await esegui(action, params);
    expect(sent.fv?.[CAMPO]).toEqual(['false', 'true', 'false']);
  });

  it.each(CAMBI)('dopo %s non resta e non parte con la richiesta seguente', async (action, params) => {
    spunta(['false', 'true', 'false']);
    server.next.push(pagina(3, 2, 2));
    await esegui(action, params);
    const dopo = await esegui('NextPage');
    expect(dopo.fv?.[CAMPO]).toBeUndefined();
  });

  it('la lunghezza sbagliata: 3 voci non arrivano su una pagina di 2 righe', async () => {
    spunta(['false', 'true', 'false']);
    server.next.push(pagina(3, 2, 2));
    await esegui('NextPage');
    const dopo = await esegui('PrevPage');
    const inviato = dopo.fv?.[CAMPO];
    if (inviato) expect(inviato).toHaveLength(2);
  });

  it('l\'azione di lista (Crea Campagna) dopo un cambio pagina non scrive le spunte vecchie sulla pagina nuova', async () => {
    spunta(['false', 'true', 'false']);
    server.next.push(pagina(3, 3, 2));
    await esegui('NextPage');
    const azione = await esegui('CreaCampagna', { navpath: LISTA });
    expect(azione.fv?.[CAMPO]).toBeUndefined();
  });

  it('un campo battuto dopo il cambio pagina non fa rinascere l\'array', async () => {
    spunta(['false', 'true', 'false']);
    server.next.push(pagina(3, 2, 2));
    await esegui('NextPage');
    render();
    handler<(name: string, value: unknown) => void>('tab.formValues[name] = stored')('note.S1-99', 'x');
    const dopo = await esegui('NextPage');
    expect(dopo.fv?.['note.S1-99']).toBe('x');
    expect(dopo.fv?.[CAMPO]).toBeUndefined();
  });

  it('una spunta in un\'altra colonna dopo il cambio pagina non fa rinascere l\'array', async () => {
    spunta(['false', 'true', 'false']);
    server.next.push(pagina(3, 2, 2));
    await esegui('NextPage');
    render();
    handleGridChange()(`altra.${LISTA}`, ['1', '0']);
    const dopo = await esegui('NextPage');
    expect(dopo.fv?.[`altra.${LISTA}`]).toEqual(['1', '0']);
    expect(dopo.fv?.[CAMPO]).toBeUndefined();
  });

  it('una spunta messa sulla pagina nuova parte, con la lunghezza della pagina nuova', async () => {
    spunta(['false', 'true', 'false']);
    server.next.push(pagina(3, 2, 2));
    await esegui('NextPage');
    spunta(['true', 'false']);
    const sent = await esegui('NextPage');
    expect(sent.fv?.[CAMPO]).toEqual(['true', 'false']);
  });

  it('un cambio pagina respinto (ERROR): si resta sulla pagina, le spunte non si perdono', async () => {
    spunta(['false', 'true', 'false']);
    server.next.push({ errors: [{ type: 'ERROR', message: 'no', mnemonic: 'X' }] });
    await esegui('NextPage');
    const ritentato = await esegui('NextPage');
    expect(ritentato.fv?.[CAMPO]).toEqual(['false', 'true', 'false']);
  });

  it('una domanda di conferma sul cambio pagina: l\'array resta per il rigioco', async () => {
    spunta(['false', 'true', 'false']);
    server.next.push({ errors: [{ type: 'CONFIRMATION', message: 'sicuro?', mnemonic: 'X' }] });
    await esegui('NextPage');
    const dopo = await esegui('NextPage');
    expect(dopo.fv?.[CAMPO]).toEqual(['false', 'true', 'false']);
  });

  it('l\'array di un\'altra lista della scheda non si tocca: gli altri valori della scheda non si toccano', async () => {
    render();
    handleGridChange()('altro.S1-99', ['x', 'y']);
    spunta(['false', 'true', 'false']);
    server.next.push(pagina(3, 2, 2));
    await esegui('NextPage');
    const dopo = await esegui('NextPage');
    expect(dopo.fv?.['altro.S1-99']).toEqual(['x', 'y']);
  });
});

/** Lascia finire le promesse in volo (il rigioco della conferma non si attende). */
const settle = () => new Promise((r) => setTimeout(r, 0));

async function rispondi(): Promise<void> {
  const d = domande.at(-1)!;
  const prompt = d.errors.find((e) => e.type === 'CONFIRMATION');
  render();
  d.onAnswer(prompt, 'ok');
  await settle();
  render();
}

const CONFERMA = { errors: [{ type: 'CONFIRMATION', message: 'sicuro?', mnemonic: 'CONFERMA' }] };
const ERRORE = { errors: [{ type: 'ERROR', message: 'no', mnemonic: 'X' }] };

describe('SXADV-6015: rigioco dopo una CONFIRMATION su NextPage', () => {
  it('a pagina cambiata dal rigioco l\'array non resta', async () => {
    spunta(['false', 'true', 'false']);
    server.next.push(CONFERMA);
    await esegui('NextPage');
    server.next.push(pagina(3, 2, 2));
    await rispondi();
    const rigioco = server.postAction.at(-1)!;
    expect(rigioco.action).toBe('NextPage');
    expect(rigioco.params.messages).toBe('CONFERMA,');
    expect(rigioco.fv?.[CAMPO]).toEqual(['false', 'true', 'false']);
    const dopo = await esegui('NextPage');
    expect(dopo.fv?.[CAMPO]).toBeUndefined();
  });

  it('dopo il rigioco non rinasce neanche con un campo battuto', async () => {
    spunta(['false', 'true', 'false']);
    server.next.push(CONFERMA);
    await esegui('NextPage');
    server.next.push(pagina(3, 2, 2));
    await rispondi();
    render();
    handler<(name: string, value: unknown) => void>('tab.formValues[name] = stored')('note.S1-99', 'x');
    const dopo = await esegui('NextPage');
    expect(dopo.fv?.[CAMPO]).toBeUndefined();
  });

  it('il rigioco respinto (ERROR): la pagina non e\' cambiata, l\'array resta', async () => {
    spunta(['false', 'true', 'false']);
    server.next.push(CONFERMA);
    await esegui('NextPage');
    server.next.push(ERRORE);
    await rispondi();
    const dopo = await esegui('NextPage');
    expect(dopo.fv?.[CAMPO]).toEqual(['false', 'true', 'false']);
  });

  it('il rigioco fa un\'altra domanda: l\'array resta per la risposta', async () => {
    spunta(['false', 'true', 'false']);
    server.next.push(CONFERMA);
    await esegui('NextPage');
    server.next.push({ errors: [{ type: 'CONFIRMATION', message: 'davvero?', mnemonic: 'ANCORA' }] });
    await rispondi();
    server.next.push(pagina(3, 2, 2));
    await rispondi();
    expect(server.postAction.at(-1)!.fv?.[CAMPO]).toEqual(['false', 'true', 'false']);
    const dopo = await esegui('NextPage');
    expect(dopo.fv?.[CAMPO]).toBeUndefined();
  });
});

describe.each(['LocateRow', 'FilterRows'])('SXADV-6015: %s', (action) => {
  const params = { navpath: LISTA, option1: 'rossi' };

  it('porta l\'array e a risposta senza errori lo toglie', async () => {
    spunta(['false', 'true', 'false']);
    server.next.push(pagina(3, 2, 2));
    const sent = await esegui(action, params);
    expect(sent.fv?.[CAMPO]).toEqual(['false', 'true', 'false']);
    const dopo = await esegui('NextPage');
    expect(dopo.fv?.[CAMPO]).toBeUndefined();
  });

  it('con un errore lo tiene', async () => {
    spunta(['false', 'true', 'false']);
    server.next.push(ERRORE);
    await esegui(action, params);
    const dopo = await esegui('NextPage');
    expect(dopo.fv?.[CAMPO]).toEqual(['false', 'true', 'false']);
  });

  it('toglie solo gli array di quella lista', async () => {
    render();
    handleGridChange()('altro.S1-99', ['x', 'y']);
    spunta(['false', 'true', 'false']);
    server.next.push(pagina(3, 2, 2));
    await esegui(action, params);
    const dopo = await esegui('NextPage');
    expect(dopo.fv?.['altro.S1-99']).toEqual(['x', 'y']);
  });
});
