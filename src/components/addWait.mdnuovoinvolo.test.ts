import { describe, it, expect } from 'vitest';
import {
  ADD_WAIT_MAX_MS,
  addWaitReducer,
  isAddWaiting,
  panelRowSwitch,
  editPanelWaitAttrs,
  respondsLater,
  type AddWait,
  type AddWaitEvent,
} from './addWait';

// MD-NUOVO-IN-VOLO (difetto trovato sul micro-detail): pannello di riga aperto
// su un rigo ESISTENTE, l'utente preme "Nuovo" (Add / SaveAndNew). Finche' la
// risposta non arriva il pannello mostra ancora il rigo vecchio e ci si puo'
// scrivere; all'arrivo la lista seleziona il rigo nuovo in un frame e
// `onSelectRecord(path, {fromAdd:true})` faceva flushEdits(prev): il digitato
// in volo finiva sul rigo VECCHIO, o spariva in silenzio.
//
// Contratto (modulo puro addWait.ts):
// - addWaitReducer: l'attesa nasce col `send`, si chiude con una risposta in
//   errore/domanda, un `failure`, il `settled` della scheda o lo `expire` dopo
//   la risposta; eventi di altre richieste o altre schede non la toccano, e un
//   evento che non cambia niente restituisce lo STESSO oggetto.
// - isAddWaiting: in attesa sia in volo sia a risposta arrivata, solo per la
//   scheda che ha mandato il Nuovo.
// - panelRowSwitch: al cambio di rigo, 'none' / 'discard' (fromAdd) / 'flush'.
// - editPanelWaitAttrs: classe, inert e aria-busy del pannello in attesa.
// - respondsLater: la risposta dice "la vera arriva dal polling" (job).
//
// REVISIONE 1: `settled` chiude solo a risposta arrivata; '' come prev = nessun
// rigo precedente.

const SCHEDA = 'tab_1';
const ALTRA = 'tab_2';
const RIGA_VECCHIA = 'S1-0.0,S1-9.0'; // rigo aperto nel pannello
const RIGA_NUOVA = 'S1-0.0,S1-9.1'; // rigo creato dal Nuovo

const send = (token: number, tabKey = SCHEDA): AddWaitEvent => ({ type: 'send', tabKey, token });
const response = (token: number, ...types: string[]): AddWaitEvent =>
  types.length ? { type: 'response', token, errors: types.map((type) => ({ type })) } : { type: 'response', token };

/** Applica in fila una sequenza di eventi partendo da `state`. */
function run(state: AddWait | null, ...evs: AddWaitEvent[]): AddWait | null {
  return evs.reduce<AddWait | null>((s, ev) => addWaitReducer(s, ev), state);
}

describe('ADD_WAIT_MAX_MS', () => {
  it('il tetto dopo la risposta e\' di 3 secondi', () => {
    expect(ADD_WAIT_MAX_MS).toBe(3000);
  });
});

// ───────────────────────────────────────────────────────────────── send
describe('addWaitReducer: send', () => {
  it('da null apre l\'attesa in volo per la scheda e il token', () => {
    expect(addWaitReducer(null, send(1))).toEqual({ tabKey: SCHEDA, token: 1, answered: false });
  });

  it('sostituisce un\'attesa in volo precedente (token nuovo, answered azzerato)', () => {
    const s = run(null, send(1));
    expect(addWaitReducer(s, send(2))).toEqual({ tabKey: SCHEDA, token: 2, answered: false });
  });

  it('sostituisce anche un\'attesa gia\' risposta', () => {
    const s = run(null, send(1), response(1));
    expect(s?.answered).toBe(true);
    expect(addWaitReducer(s, send(2))).toEqual({ tabKey: SCHEDA, token: 2, answered: false });
  });

  it('un Nuovo da un\'altra scheda prende il posto di quello in corso', () => {
    const s = run(null, send(1, SCHEDA));
    expect(addWaitReducer(s, send(2, ALTRA))).toEqual({ tabKey: ALTRA, token: 2, answered: false });
  });

  it('non muta lo stato precedente', () => {
    const s = run(null, send(1))!;
    const copia = { ...s };
    addWaitReducer(s, send(2));
    expect(s).toEqual(copia);
  });
});

// ───────────────────────────────────────────────────────────── response
describe('addWaitReducer: response dello stesso token', () => {
  it('senza errori: risposta arrivata, l\'attesa resta fino al cambio di rigo', () => {
    const s = run(null, send(1));
    expect(addWaitReducer(s, response(1))).toEqual({ tabKey: SCHEDA, token: 1, answered: true });
  });

  it('con errors vuoto vale come risposta normale', () => {
    const s = run(null, send(1));
    expect(addWaitReducer(s, { type: 'response', token: 1, errors: [] })).toEqual({
      tabKey: SCHEDA, token: 1, answered: true,
    });
  });

  it.each([['WARNING'], ['INFO']])('con soli %s vale come risposta normale (la riga c\'e\')', (t) => {
    const s = run(null, send(1));
    expect(addWaitReducer(s, response(1, t))?.answered).toBe(true);
  });

  it('con ERROR: la riga non e\' stata creata, l\'attesa si chiude', () => {
    expect(run(null, send(1), response(1, 'ERROR'))).toBeNull();
  });

  it('ERROR insieme ad avvisi chiude lo stesso', () => {
    expect(run(null, send(1), response(1, 'WARNING', 'ERROR'))).toBeNull();
  });

  it.each([['CONFIRMATION'], ['YESNOCANCEL']])('con %s (domanda del server) l\'attesa si chiude', (t) => {
    expect(run(null, send(1), response(1, t))).toBeNull();
  });

  it('la risposta che arriva su un\'attesa gia\' risposta non cambia niente (stessa identita\')', () => {
    const s = run(null, send(1), response(1));
    expect(addWaitReducer(s, response(1))).toBe(s);
  });

  it('non muta lo stato precedente', () => {
    const s = run(null, send(1))!;
    addWaitReducer(s, response(1));
    expect(s.answered).toBe(false);
  });
});

describe('addWaitReducer: response di un\'altra richiesta', () => {
  it('token diverso (Post di ricalcolo partito prima): stato invariato, stessa identita\'', () => {
    const s = run(null, send(5));
    expect(addWaitReducer(s, response(4))).toBe(s);
  });

  it('token diverso con ERROR: non chiude l\'attesa del Nuovo', () => {
    const s = run(null, send(5));
    expect(addWaitReducer(s, response(4, 'ERROR'))).toBe(s);
  });

  it('token diverso con CONFIRMATION: non chiude l\'attesa del Nuovo', () => {
    const s = run(null, send(5));
    expect(addWaitReducer(s, response(6, 'CONFIRMATION'))).toBe(s);
  });

  it('token vecchio dopo la risposta del Nuovo: invariato', () => {
    const s = run(null, send(5), response(5));
    expect(addWaitReducer(s, response(3, 'ERROR'))).toBe(s);
  });

  it('la risposta del Nuovo precedente non segna come arrivata quella del Nuovo successivo', () => {
    const s = run(null, send(1), send(2));
    expect(addWaitReducer(s, response(1))).toBe(s);
    expect(s?.answered).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────── failure
describe('addWaitReducer: failure', () => {
  it('stesso token in volo: l\'attesa si chiude', () => {
    expect(run(null, send(1), { type: 'failure', token: 1 })).toBeNull();
  });

  it('token diverso: invariato, stessa identita\'', () => {
    const s = run(null, send(2));
    expect(addWaitReducer(s, { type: 'failure', token: 1 })).toBe(s);
  });

  it('token diverso dopo la risposta: invariato', () => {
    const s = run(null, send(2), response(2));
    expect(addWaitReducer(s, { type: 'failure', token: 9 })).toBe(s);
  });
});

// ───────────────────────────────────────────────────────────── settled
describe('addWaitReducer: settled', () => {
  it('stessa scheda dopo la risposta: l\'attesa si chiude', () => {
    expect(run(null, send(1), response(1), { type: 'settled', tabKey: SCHEDA })).toBeNull();
  });

  it('stessa scheda PRIMA che la risposta sia arrivata: invariato, stessa identita\'', () => {
    // REVISIONE 1: con il Nuovo premuto due volte il rigo del primo Add arriva
    // mentre il secondo e' in volo; il pannello non deve sbloccarsi li'.
    const s = run(null, send(1));
    expect(addWaitReducer(s, { type: 'settled', tabKey: SCHEDA })).toBe(s);
  });

  it('altra scheda: invariato, stessa identita\'', () => {
    const s = run(null, send(1), response(1));
    expect(addWaitReducer(s, { type: 'settled', tabKey: ALTRA })).toBe(s);
  });

  it('altra scheda in volo: invariato', () => {
    const s = run(null, send(1));
    expect(addWaitReducer(s, { type: 'settled', tabKey: ALTRA })).toBe(s);
  });
});

// ───────────────────────────────────────────────────────────── expire
describe('addWaitReducer: expire', () => {
  it('stesso token a risposta arrivata: il tetto chiude l\'attesa', () => {
    expect(run(null, send(1), response(1), { type: 'expire', token: 1 })).toBeNull();
  });

  it('stesso token PRIMA della risposta: l\'attesa resta (stessa identita\')', () => {
    const s = run(null, send(1));
    expect(addWaitReducer(s, { type: 'expire', token: 1 })).toBe(s);
  });

  it('timer di un Nuovo vecchio: non chiude l\'attesa del Nuovo successivo gia\' risposto', () => {
    const s = run(null, send(1), response(1), send(2), response(2));
    expect(addWaitReducer(s, { type: 'expire', token: 1 })).toBe(s);
  });

  it('timer di un Nuovo vecchio: non chiude il Nuovo successivo in volo', () => {
    const s = run(null, send(1), response(1), send(2));
    expect(addWaitReducer(s, { type: 'expire', token: 1 })).toBe(s);
  });
});

// ───────────────────────────────────────────────────────────── stato null
describe('addWaitReducer: senza attesa', () => {
  it.each<[string, AddWaitEvent]>([
    ['response', { type: 'response', token: 1 }],
    ['response con ERROR', { type: 'response', token: 1, errors: [{ type: 'ERROR' }] }],
    ['failure', { type: 'failure', token: 1 }],
    ['settled', { type: 'settled', tabKey: SCHEDA }],
    ['expire', { type: 'expire', token: 1 }],
  ])('%s su null resta null', (_n, ev) => {
    expect(addWaitReducer(null, ev)).toBeNull();
  });
});

// ───────────────────────────────────────────── conferma poi rigiocata
describe('conferma del server e richiesta rigiocata', () => {
  it('CONFIRMATION chiude, la ri-giocata dopo la risposta manda un nuovo send che riapre', () => {
    let s = run(null, send(1), response(1, 'CONFIRMATION'));
    expect(s).toBeNull();
    expect(isAddWaiting(s, SCHEDA)).toBe(false);
    s = addWaitReducer(s, send(2));
    expect(s).toEqual({ tabKey: SCHEDA, token: 2, answered: false });
    expect(isAddWaiting(s, SCHEDA)).toBe(true);
    s = addWaitReducer(s, response(2));
    expect(s).toEqual({ tabKey: SCHEDA, token: 2, answered: true });
    expect(run(s, { type: 'settled', tabKey: SCHEDA })).toBeNull();
  });

  it('una risposta ritardataria al token della domanda non tocca la ri-giocata', () => {
    const s = run(null, send(1), response(1, 'YESNOCANCEL'), send(2));
    expect(addWaitReducer(s, response(1))).toBe(s);
  });
});

// ───────────────────────────────────────────────────────────── isAddWaiting
describe('isAddWaiting', () => {
  it('null: nessuna scheda in attesa', () => {
    expect(isAddWaiting(null, SCHEDA)).toBe(false);
  });

  it('in volo: la scheda che ha mandato il Nuovo e\' in attesa', () => {
    expect(isAddWaiting(run(null, send(1)), SCHEDA)).toBe(true);
  });

  it('a risposta arrivata resta in attesa fino al cambio di rigo', () => {
    expect(isAddWaiting(run(null, send(1), response(1)), SCHEDA)).toBe(true);
  });

  it('un\'altra scheda non e\' in attesa', () => {
    expect(isAddWaiting(run(null, send(1)), ALTRA)).toBe(false);
  });

  it('tabKey undefined: false', () => {
    expect(isAddWaiting(run(null, send(1)), undefined)).toBe(false);
    expect(isAddWaiting(null, undefined)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────── panelRowSwitch
describe('panelRowSwitch', () => {
  it.each([[false], [true]])('prev null: none (fromAdd=%s)', (fromAdd) => {
    expect(panelRowSwitch(null, RIGA_NUOVA, fromAdd)).toBe('none');
  });

  it.each([[false], [true]])('prev uguale a next: none (fromAdd=%s)', (fromAdd) => {
    expect(panelRowSwitch(RIGA_VECCHIA, RIGA_VECCHIA, fromAdd)).toBe('none');
  });

  it.each([[false], [true]])('prev stringa vuota = nessun rigo precedente: none (fromAdd=%s)', (fromAdd) => {
    expect(panelRowSwitch('', RIGA_NUOVA, fromAdd)).toBe('none');
  });

  it('rigo diverso da un clic dell\'utente: flush (il digitato va al rigo che si lascia)', () => {
    expect(panelRowSwitch(RIGA_VECCHIA, RIGA_NUOVA, false)).toBe('flush');
  });

  it('rigo diverso dopo il Nuovo: discard (lo sporco e\' stato scritto dopo l\'invio)', () => {
    expect(panelRowSwitch(RIGA_VECCHIA, RIGA_NUOVA, true)).toBe('discard');
  });
});

// ───────────────────────────────────────────────────────────── editPanelWaitAttrs
describe('editPanelWaitAttrs', () => {
  it('fuori attesa: solo la classe base, niente inert ne\' aria-busy veri', () => {
    const a = editPanelWaitAttrs(false);
    expect(a.className).toBe('edit-panel');
    expect(a.inert).toBeFalsy();
    expect(a['aria-busy']).toBeFalsy();
  });

  it('in attesa: classe di attesa, inert e aria-busy', () => {
    expect(editPanelWaitAttrs(true)).toEqual({
      className: 'edit-panel edit-panel--waiting',
      inert: true,
      'aria-busy': 'true',
    });
  });

  it('la classe di attesa non compare fuori attesa', () => {
    expect(editPanelWaitAttrs(false).className.split(/\s+/)).not.toContain('edit-panel--waiting');
  });
});

// ───────────────────────────────────────────────── il difetto, in sequenza
describe('MD-NUOVO-IN-VOLO: Nuovo con un Post di ricalcolo in mezzo', () => {
  it('l\'attesa copre tutto il volo, il cambio di rigo scarta, settled la chiude', () => {
    // Pannello sul rigo vecchio; l'utente esce da un campo (Post di ricalcolo,
    // token 7) e subito preme Nuovo (token 8).
    let s: AddWait | null = null;
    expect(isAddWaiting(s, SCHEDA)).toBe(false);
    expect(editPanelWaitAttrs(isAddWaiting(s, SCHEDA)).className).toBe('edit-panel');

    s = addWaitReducer(s, send(8));
    expect(isAddWaiting(s, SCHEDA)).toBe(true);
    expect(editPanelWaitAttrs(isAddWaiting(s, SCHEDA)).inert).toBe(true);

    // Risponde prima il Post di ricalcolo: non e' la risposta al Nuovo.
    const inVolo = s;
    s = addWaitReducer(s, response(7));
    expect(s).toBe(inVolo);
    expect(isAddWaiting(s, SCHEDA)).toBe(true);

    // Un tetto scaduto prima della risposta non libera il pannello.
    s = addWaitReducer(s, { type: 'expire', token: 8 });
    expect(s).toBe(inVolo);

    // Arriva la risposta al Nuovo: il pannello resta in attesa del cambio rigo.
    s = addWaitReducer(s, response(8));
    expect(s).toEqual({ tabKey: SCHEDA, token: 8, answered: true });
    expect(isAddWaiting(s, SCHEDA)).toBe(true);

    // La lista seleziona il rigo nuovo con fromAdd: niente flush sul vecchio.
    expect(panelRowSwitch(RIGA_VECCHIA, RIGA_NUOVA, true)).toBe('discard');

    // Il pannello e' passato al rigo nuovo: attesa chiusa, pannello libero.
    s = addWaitReducer(s, { type: 'settled', tabKey: SCHEDA });
    expect(s).toBeNull();
    expect(isAddWaiting(s, SCHEDA)).toBe(false);
    expect(editPanelWaitAttrs(isAddWaiting(s, SCHEDA)).className).toBe('edit-panel');

    // Il timer del tetto, partito alla risposta, scatta dopo: non riapre niente.
    expect(addWaitReducer(s, { type: 'expire', token: 8 })).toBeNull();
  });

  it('se il cambio di rigo non arriva, il tetto chiude l\'attesa', () => {
    const s = run(null, send(8), response(7), response(8));
    expect(isAddWaiting(s, SCHEDA)).toBe(true);
    expect(run(s, { type: 'expire', token: 8 })).toBeNull();
  });

  it('un clic normale su un altro rigo, a Nuovo finito, torna a scrivere sul rigo lasciato', () => {
    const s = run(null, send(8), response(8), { type: 'settled', tabKey: SCHEDA });
    expect(s).toBeNull();
    expect(panelRowSwitch(RIGA_NUOVA, RIGA_VECCHIA, false)).toBe('flush');
  });
});

describe('MD-NUOVO-IN-VOLO: Nuovo premuto due volte (REVISIONE 1)', () => {
  it('il rigo del primo Nuovo non sblocca il pannello mentre il secondo e\' in volo', () => {
    let s: AddWait | null = run(null, send(1), send(2));
    expect(s).toEqual({ tabKey: SCHEDA, token: 2, answered: false });

    // Arriva la risposta al primo: non e' quella attesa, ignorata.
    const secondo = s;
    s = addWaitReducer(s, response(1));
    expect(s).toBe(secondo);

    // La lista passa al rigo del primo Nuovo: il pannello resta in attesa.
    s = addWaitReducer(s, { type: 'settled', tabKey: SCHEDA });
    expect(s).toBe(secondo);
    expect(isAddWaiting(s, SCHEDA)).toBe(true);

    // Risposta al secondo, poi il cambio di rigo vero: attesa chiusa.
    s = addWaitReducer(s, response(2));
    expect(s).toEqual({ tabKey: SCHEDA, token: 2, answered: true });
    s = addWaitReducer(s, { type: 'settled', tabKey: SCHEDA });
    expect(s).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────── respondsLater
describe('respondsLater', () => {
  it.each<[string, Parameters<typeof respondsLater>[0]]>([
    ['uiData.showProgress', { uiData: { showProgress: true } }],
    ['uiData.trackAsynchJob', { uiData: { trackAsynchJob: true } }],
    ['trackAsynchJob in radice', { trackAsynchJob: true }],
    ['piu\' segnali insieme', { trackAsynchJob: true, uiData: { showProgress: true } }],
  ])('%s senza ui: la risposta vera arriva dal polling', (_n, resp) => {
    expect(respondsLater(resp)).toBe(true);
  });

  it.each<[string, Parameters<typeof respondsLater>[0]]>([
    ['uiData.showProgress', { uiData: { showProgress: true }, ui: { rows: [] } }],
    ['uiData.trackAsynchJob', { uiData: { trackAsynchJob: true }, ui: { rows: [] } }],
    ['trackAsynchJob in radice', { trackAsynchJob: true, ui: { rows: [] } }],
  ])('%s CON ui: e\' gia\' la risposta', (_n, resp) => {
    expect(respondsLater(resp)).toBe(false);
  });

  it.each<[string, Parameters<typeof respondsLater>[0]]>([
    ['risposta vuota', {}],
    ['uiData senza segnali', { uiData: {} }],
    ['segnali a false', { trackAsynchJob: false, uiData: { showProgress: false, trackAsynchJob: false } }],
    ['solo ui', { ui: { rows: [] } }],
  ])('nessun segnale (%s): false', (_n, resp) => {
    expect(respondsLater(resp)).toBe(false);
  });
});
