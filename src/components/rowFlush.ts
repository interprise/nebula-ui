/* Il digitato del pannello di riga parte prima di un'azione che non e' per la
 * sua riga (SXADV-6255, SXADV-6256).
 *
 * Un campo scritto nel micro-detail parte solo con una richiesta per la sua
 * riga (panelFieldScope.ts, MD-VALORI-RESIDUI-DOPO-SALVA). Il "Salva +" della
 * barra in alto pero' porta il navpath del DOCUMENTO, non della riga: il
 * digitato restava indietro, SaveAndNew salvava il documento con la riga nuova
 * ancora vuota (obbligatori mancanti, 6255) e il digitato partiva dopo, con un
 * Post sulla riga di un documento che il server aveva gia' lasciato ("Sessione
 * non valida", 6256). Il legacy spediva tutta la form con qualunque azione.
 *
 * Regola: se la riga aperta nel pannello ha digitato non ancora partito e
 * l'azione non e' per lei, prima un Post normale sulla riga (la stessa strada
 * del cambio rigo), poi l'azione, solo se il Post non ha dato errori. Vale anche
 * per le navigazioni di pagina/ordinamento/Refresh, che la riga la chiudono.
 * Non vale per chi il digitato lo butta via (Annulla, Cancella) ne' per il Post
 * stesso. */

/** Pagine, ordinamento, Refresh, pagine di una griglia incorporata, Cerca:
 *  dopo di loro la riga del pannello non vale piu'. */
const ROW_SCOPE_ENDING = new Set([
  'NextPage', 'PrevPage', 'FirstPage', 'LastPage', 'GotoPage', 'SortColumn', 'Refresh',
  'DetailPage', 'LocateRow', 'FilterRows',
]);

/** Azioni che il digitato della riga lo scartano, o lo sono gia' (Post), e
 *  richieste di servizio che partono da sole o non toccano il dato: la pagina
 *  adattata all'altezza (SetPageSize), l'aiuto del campo (NavigateHelp). */
const NO_FLUSH = new Set(['Post', 'Cancel', 'CancelRow', 'Delete', 'SetPageSize', 'NavigateHelp']);

/** L'azione chiude la riga del pannello (il suo digitato non ha piu' riga). */
export function endsRowScope(action: string): boolean {
  return ROW_SCOPE_ENDING.has(action);
}

export interface RowFlushInput {
  /** Il comando che sta per partire. */
  action: string;
  /** La riga a cui la richiesta da' i valori: il postPath per un Add, il
   *  navpath per tutto il resto. */
  rowTarget?: string | null;
  /** Il percorso della riga aperta nel pannello, se c'e'. */
  openRow?: string | null;
  /** La riga aperta ha campi scritti e non ancora partiti. */
  openRowDirty: boolean;
  /** La richiesta e' gia' quella che segue il Post di svuotamento. */
  afterFlush: boolean;
}

/** Prima di questa azione va mandato il digitato della riga aperta con un Post
 *  sulla riga stessa? */
export function rowFlushNeeded(input: RowFlushInput): boolean {
  const { action, rowTarget, openRow, openRowDirty, afterFlush } = input;
  if (!openRow || !openRowDirty || afterFlush) return false;
  if (NO_FLUSH.has(action)) return false;
  if (endsRowScope(action)) return true;
  return rowTarget !== openRow;
}
