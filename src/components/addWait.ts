/**
 * Il "Nuovo" (o "Salva+") di riga mentre la risposta e' in volo (MD-NUOVO-IN-VOLO).
 *
 * Fino all'arrivo della risposta il pannello di riga mostra ancora il rigo da
 * cui si e' partiti, e ci si poteva scrivere. I nomi dei campi del pannello non
 * dicono la riga (`descrizione.S1-9`, la riga la dice il navpath): quello che si
 * batteva in volo spariva con la risposta, e un tasto battuto fra la resa della
 * risposta e il frame in cui la lista seleziona il rigo nuovo partiva con il
 * Post del rigo che si lasciava, cioe' finiva sul rigo VECCHIO.
 *
 * Rimedio: dall'invio del Nuovo finche' il pannello non e' passato al rigo
 * nuovo la scheda e' "in attesa" e il pannello non si puo' toccare (inert,
 * attenuato). E quando il pannello passa al rigo nuovo, quello che risultasse
 * ancora sporco non si manda al rigo che si lascia: e' stato scritto dopo
 * l'invio del Nuovo, quindi non e' suo.
 */

/** Tetto all'attesa dopo che la risposta e' arrivata. Se il pannello non passa
 *  al rigo nuovo (la risposta ha portato altrove, la lista non l'ha trovato)
 *  nessuno chiude l'attesa: senza tetto il pannello resterebbe bloccato. */
export const ADD_WAIT_MAX_MS = 3000;

export interface AddWait {
  /** Scheda che ha mandato il Nuovo. */
  tabKey: string;
  /** Identifica la richiesta: le risposte di altre richieste non la chiudono. */
  token: number;
  /** Risposta arrivata e applicata: si aspetta solo il cambio di rigo. */
  answered: boolean;
}

export type AddWaitEvent =
  | { type: 'send'; tabKey: string; token: number }
  | { type: 'response'; token: number; errors?: readonly { type: string }[] }
  | { type: 'failure'; token: number }
  | { type: 'settled'; tabKey: string }
  | { type: 'expire'; token: number };

export function addWaitReducer(state: AddWait | null, ev: AddWaitEvent): AddWait | null {
  if (ev.type === 'send') return { tabKey: ev.tabKey, token: ev.token, answered: false };
  if (!state) return null;
  switch (ev.type) {
    case 'response': {
      if (ev.token !== state.token) return state;
      const types = (ev.errors ?? []).map((e) => e.type);
      // ERROR: la riga non c'e'. Domanda del server: la modale blocca, e la
      // richiesta rigiocata con la risposta riapre l'attesa con un altro send.
      if (types.includes('ERROR') || types.includes('CONFIRMATION') || types.includes('YESNOCANCEL')) return null;
      return state.answered ? state : { ...state, answered: true };
    }
    case 'failure':
      return ev.token === state.token ? null : state;
    // Solo a risposta arrivata: col Nuovo premuto due volte il rigo del primo
    // arriva mentre il secondo e' ancora in volo, e sbloccare li' lasciava
    // scrivere su un rigo che il secondo avrebbe poi lasciato.
    case 'settled':
      return ev.tabKey === state.tabKey && state.answered ? null : state;
    case 'expire':
      return ev.token === state.token && state.answered ? null : state;
  }
}

/** Risposta che non e' ancora quella vera: il comando e' diventato un job e
 *  la risposta finale arriva dal polling (stessa condizione di
 *  Shell.processResponse). */
export function respondsLater(resp: {
  ui?: unknown;
  trackAsynchJob?: unknown;
  uiData?: { showProgress?: unknown; trackAsynchJob?: unknown };
}): boolean {
  return !!(resp.uiData?.showProgress || resp.uiData?.trackAsynchJob || resp.trackAsynchJob) && !resp.ui;
}

export function isAddWaiting(state: AddWait | null, tabKey: string | undefined): boolean {
  return !!state && tabKey !== undefined && state.tabKey === tabKey;
}

export type PanelRowSwitch = 'flush' | 'discard' | 'none';

/** Cosa fare del digitato del pannello quando passa da `prev` a `next`. */
export function panelRowSwitch(prev: string | null, next: string, fromAdd: boolean): PanelRowSwitch {
  if (!prev || prev === next) return 'none';
  return fromAdd ? 'discard' : 'flush';
}

export function editPanelWaitAttrs(waiting: boolean): {
  className: string;
  inert?: boolean;
  'aria-busy'?: 'true';
} {
  return waiting
    ? { className: 'edit-panel edit-panel--waiting', inert: true, 'aria-busy': 'true' }
    : { className: 'edit-panel' };
}
