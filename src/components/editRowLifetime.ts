// Quanto vive la riga in modifica (il navpath che Shell manda come navpath e
// postPath): quanto la lista che la mostra. Il server la cerca fra i viewstate
// della pagina corrente, e una riga di una lista che non c'e' piu' gli arriva
// come una sessione persa: "Sessione non valida. Riprovare." (SXADV-6144: Nuovo
// documento dopo il Salva del precedente, la lista nuova e' vuota; SXADV-6146:
// la lista lascia lo schermo col cambio di scheda o con il nodo dell'albero
// riselezionato, e torna con viewstate nuovi).

/** La riga selezionata della lista va lasciata: non e' (piu') fra le righe
 *  della lista, compresa la lista vuota di un documento nuovo. Con una
 *  rimozione in attesa decide la risposta del server, non questa. */
export function staleSelection(
  selected: string | null,
  recordPaths: readonly string[],
  removalPending: boolean,
): boolean {
  if (!selected || removalPending) return false;
  return !recordPaths.includes(selected);
}

/** La riga in modifica della scheda dopo che una lista che mostrava
 *  `releasing` se ne e' andata: si azzera solo se e' ancora la sua, perche'
 *  nel frattempo un'altra lista puo' averne scelta una. */
export function releasedEditRow(current: string | null, releasing: string | null): string | null {
  return releasing !== null && current === releasing ? null : current;
}
