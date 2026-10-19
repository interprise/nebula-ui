import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ErrorItem, UITree } from '../types/ui';

// SXADV-5952 — clic su una voce di menu con modifiche non salvate. Il server
// risponde con una CONFIRMATION ("Ci sono modifiche non salvate. Si desidera
// vengano annullate TUTTE le modifiche?") e l'utente preme "Annulla": la
// navigazione non avviene e la scheda resta sulla videata di prima.
//
// Il difetto visto: handleMenuClick cambia SUBITO titolo, voce di menu e
// functionAction della scheda, ne svuota formValues/formCaptions e dimentica la
// riga in modifica del pannello (editNavpath) - PRIMA di sapere se la
// navigazione avviene. Dopo l'Annulla la scheda mostrava "Riaddebito costi ai
// clienti" sopra Eventi Clienti, con la voce nuova evidenziata nel menu, e i
// valori digitati e non ancora spediti erano persi.
//
// Il contratto: rifiutata la conferma (Annulla -> onCancel del feedback) o
// fallita la richiesta, la scheda torna ESATTAMENTE com'era prima del clic.
// Con OK la richiesta rigiocata va avanti e la scheda prende titolo e voce
// nuovi.
//
// Stesso motore di hook di Shell.staleTemplateKey.test.tsx (niente DOM: la
// Shell si esegue come funzione, i gestori veri si riconoscono dal sorgente).
// Il feedback e' finto e registra la finestra di conferma con i suoi gestori:
// "premere Annulla" = chiamare il suo onCancel, "premere OK" = onAnswer.

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

// Il feedback: la finestra di conferma non si disegna, se ne tengono i gestori.
type Handlers = { onCancel?: () => void; onAnswer?: (prompt: ErrorItem, answer: 'yes' | 'no') => void };
const dialogs = vi.hoisted(() => ({
  shown: [] as { errors: ErrorItem[]; handlers: Handlers }[],
  failures: [] as unknown[],
}));
vi.mock('../hooks/feedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/feedback')>()),
  useFeedback: () => ({
    showServerMessages: (errors: ErrorItem[], handlers: Handlers = {}) => { dialogs.shown.push({ errors, handlers }); },
    error: () => {}, warning: () => {}, info: () => {},
    failure: (e: unknown) => { dialogs.failures.push(e); },
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
// prepara. Un Error in coda = richiesta fallita (rete, HTTP 500).
const server = vi.hoisted(() => ({
  postAction: [] as { action: string; params: Record<string, string>; fv?: Record<string, string | string[]> }[],
  menu: [] as { menuId: string; sid?: string; extra?: Record<string, string> }[],
  next: [] as unknown[],
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  postAction: async (action: string, params: Record<string, string>, fv?: Record<string, string | string[]>) => {
    server.postAction.push({ action, params: { ...params }, fv: fv && { ...fv } });
    const r = server.next.shift();
    if (r instanceof Error) throw r;
    return r ?? {};
  },
  executeMenuItem: async (menuId: string, sid?: string, extra?: Record<string, string>) => {
    server.menu.push({ menuId, sid, extra: extra && { ...extra } });
    const r = server.next.shift();
    if (r instanceof Error) throw r;
    return r ?? {};
  },
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

/** Un disegno della Shell: aggiorna le chiusure dei gestori. */
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

const handleAction = () =>
  handler<(action: string, params?: Record<string, string>) => Promise<void>>('serverParams.hasTemplate = ');
const handleMenuClick = () =>
  handler<(menuId: string, label: string) => Promise<void>>('executeMenuItem(menuId, tab.sid)');
const handleFieldChange = () =>
  handler<(name: string, value: unknown, caption?: unknown) => void>('dirtyFieldsRef.current.add(name)');
const handleEditRow = () =>
  handler<(navpath: string | null) => void>('editNavpathRef.current = navpath');
const openFunctionByAction = () =>
  handler<(label: string, action: string, params?: Record<string, string>) => boolean>('functionAction: action');

type Tab = {
  key: string; sid: string; label: string; menuId?: string; functionAction?: string; loading?: boolean;
  ui?: UITree; formValues: Record<string, string | string[]>; formCaptions?: Record<string, unknown>;
};

/** La scheda di lavoro (sempre tab_1 / S1 in questi casi). */
function tab(): Tab {
  const tabs = rt.slots.find((s) => Array.isArray(s.v) && (s.v as { key?: string }[])[0]?.key === 'tab_1');
  return (tabs!.v as Tab[])[0];
}

/** Lascia finire le promesse in volo (il replay della conferma non si attende). */
const settle = () => new Promise((r) => setTimeout(r, 0));

async function cliccaMenu(menuId: string, label: string, resp: unknown): Promise<void> {
  server.next.push(resp);
  render();
  await handleMenuClick()(menuId, label);
  await settle();
  render();
}

/** Una videata qualunque (resa completa), come la manda ExecuteMenuItem. */
function videata(viewName: string, path: string) {
  return {
    ui: {
      rows: [{ id: 'r0', cells: [{ elementType: 1, control: { name: 'descrizione', id: 'descrizione', type: 'text', editable: true } }] }],
      pageType: 0,
      path,
      viewName,
      viewType: 'list',
    },
    toolbar: [],
  };
}

const MODIFICHE: ErrorItem = {
  type: 'CONFIRMATION',
  message: 'Ci sono modifiche non salvate. Si desidera vengano annullate TUTTE le modifiche?',
  mnemonic: 'CANCEL_ALL_CHANGES',
} as ErrorItem;

/** Fotografia di quello che il contratto chiede di ripristinare. */
function stato() {
  const t = tab();
  return {
    label: t.label,
    menuId: t.menuId,
    functionAction: t.functionAction,
    formValues: { ...t.formValues },
    formCaptions: { ...(t.formCaptions ?? {}) },
  };
}

/** Eventi Clienti aperta dal menu, un valore digitato nel pannello di riga
 *  (riga S1-6.3) e non ancora spedito, con la sua didascalia. */
async function preparaEventiClienti(): Promise<void> {
  await cliccaMenu('menu.eventiClienti', 'Eventi Clienti', videata('eventiClientiList', 'S1-6'));
  expect(tab().label).toBe('Eventi Clienti');
  render();
  handleEditRow()('S1-6.3');
  handleFieldChange()('importo.S1-6', '12,50');
  handleFieldChange()('tipoEvento.S1-6', 'TEL', [{ value: 'TEL', text: 'Telefonata' }]);
  render();
}

/** Clic su Riaddebito costi ai clienti: il server chiede conferma. */
async function cliccaRiaddebitoConConferma(): Promise<Handlers> {
  dialogs.shown = [];
  await cliccaMenu('menu.riaddebitoCosti', 'Riaddebito costi ai clienti', { errors: [MODIFICHE] });
  const conferma = dialogs.shown.find((d) => d.errors.some((e) => e.type === 'CONFIRMATION'));
  expect(conferma, 'la finestra di conferma deve essere stata aperta').toBeDefined();
  return conferma!.handlers;
}

beforeEach(() => {
  rt.slots = [];
  rt.callbacks = [];
  server.postAction = [];
  server.menu = [];
  server.next = [];
  dialogs.shown = [];
  dialogs.failures = [];
  clearTemplates();
  render();
  // Si parte dalla Home (SXADV-62): la scheda di lavoro diventa quella attiva.
  const active = rt.slots.find((s) => s.v === 'home');
  active!.v = 'tab_1';
  render();
});

// ───────────────────────────────────────────────────── Annulla sulla conferma
describe('SXADV-5952: menu + "modifiche non salvate" + Annulla -> la scheda torna com\'era', () => {
  it('titolo e voce di menu (evidenza nel menu) tornano quelli di prima', async () => {
    await preparaEventiClienti();
    const prima = stato();
    const conferma = await cliccaRiaddebitoConConferma();
    conferma.onCancel?.();
    render();
    expect(tab().label).toBe(prima.label);
    expect(tab().menuId).toBe(prima.menuId);
    expect(tab().loading).toBeFalsy();
  });

  it('i valori digitati e le loro didascalie restano nella scheda', async () => {
    await preparaEventiClienti();
    const prima = stato();
    const conferma = await cliccaRiaddebitoConConferma();
    conferma.onCancel?.();
    render();
    expect(tab().formValues).toEqual(prima.formValues);
    expect(tab().formCaptions ?? {}).toEqual(prima.formCaptions);
  });

  it('l\'azione successiva spedisce ancora i valori digitati prima del clic', async () => {
    await preparaEventiClienti();
    const conferma = await cliccaRiaddebitoConConferma();
    conferma.onCancel?.();
    render();
    await handleAction()('Save', {});
    render();
    const sent = server.postAction.at(-1)!;
    expect(sent.action).toBe('Save');
    expect(sent.fv).toMatchObject({ 'importo.S1-6': '12,50', 'tipoEvento.S1-6': 'TEL' });
  });

  it('l\'azione successiva porta ancora la riga del pannello (navpath e postPath)', async () => {
    await preparaEventiClienti();
    const conferma = await cliccaRiaddebitoConConferma();
    conferma.onCancel?.();
    render();
    await handleAction()('Save', {});
    render();
    const sent = server.postAction.at(-1)!;
    expect(sent.params.navpath).toBe('S1-6.3');
    expect(sent.params.postPath).toBe('S1-6.3');
  });

  it('una funzione aperta per azione (functionAction) torna la stessa, senza voce di menu', async () => {
    // Gestione Profili Menu: si apre per azione, niente voce di menu (SXADV-5784.1).
    server.next.push(videata('profiliMenuList', 'S1-7'));
    render();
    openFunctionByAction()('Gestione Profili Menu', 'GestioneProfiliMenu');
    await settle();
    render();
    expect(tab().functionAction).toBe('GestioneProfiliMenu');
    handleFieldChange()('descrizione.S1-7', 'bozza');
    render();
    const prima = stato();
    const conferma = await cliccaRiaddebitoConConferma();
    conferma.onCancel?.();
    render();
    expect(stato()).toEqual(prima);
    expect(tab().menuId).toBeUndefined();
    expect(tab().loading).toBeFalsy();
  });
});

// ──────────────────────────────────────────────────────── richiesta fallita
describe('SXADV-5952: menu + richiesta fallita -> la scheda torna com\'era', () => {
  it('titolo, voce, valori e riga del pannello ripristinati; niente attesa', async () => {
    await preparaEventiClienti();
    const prima = stato();
    await cliccaMenu('menu.riaddebitoCosti', 'Riaddebito costi ai clienti', new Error('rete'));
    expect(dialogs.failures).toHaveLength(1);
    expect(stato()).toEqual(prima);
    expect(tab().loading).toBeFalsy();
    await handleAction()('Save', {});
    render();
    const sent = server.postAction.at(-1)!;
    expect(sent.params.navpath).toBe('S1-6.3');
    expect(sent.fv).toMatchObject({ 'importo.S1-6': '12,50' });
  });
});

// ─────────────────────────────────────────────────────────── OK sulla conferma
describe('SXADV-5952: menu + conferma + OK -> la navigazione avviene', () => {
  it('la richiesta rigiocata porta la risposta e la scheda prende titolo e voce nuovi', async () => {
    await preparaEventiClienti();
    const conferma = await cliccaRiaddebitoConConferma();
    server.next.push(videata('riaddebitoCostiList', 'S1-8'));
    conferma.onAnswer?.(MODIFICHE, 'yes');
    await settle();
    render();
    const replay = server.menu.at(-1)!;
    expect(replay.menuId).toBe('menu.riaddebitoCosti');
    expect(replay.extra?.messages).toBe('CANCEL_ALL_CHANGES,');
    expect(tab().label).toBe('Riaddebito costi ai clienti');
    expect(tab().menuId).toBe('menu.riaddebitoCosti');
    expect(tab().functionAction).toBeUndefined();
    expect(tab().loading).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────── clic normale (invariato)
describe('SXADV-5952: clic sul menu senza conferma (comportamento di oggi)', () => {
  it('la scheda prende titolo e voce nuovi', async () => {
    await preparaEventiClienti();
    await cliccaMenu('menu.riaddebitoCosti', 'Riaddebito costi ai clienti', videata('riaddebitoCostiList', 'S1-8'));
    expect(tab().label).toBe('Riaddebito costi ai clienti');
    expect(tab().menuId).toBe('menu.riaddebitoCosti');
    expect(tab().loading).toBeFalsy();
    expect(dialogs.shown.filter((d) => d.errors.length > 0)).toHaveLength(0);
  });
});
