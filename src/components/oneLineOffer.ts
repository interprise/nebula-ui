/* Quando offrire il bottone "un record per riga" di una lista (SXADV-5965).

   Il bottone mette il record su una linea sola, toglie l'a-capo del testo e
   blocca a sinistra le prime colonne. Nasce per le liste con bande di
   continuazione, ma serve altrettanto dove il record sta già su una riga e le
   colonne sono troppe per la finestra (Domino > Tessere, ~60 colonne): lì si
   scorre in orizzontale e ciò che identifica il record esce di vista. Una
   lista stretta, con poche colonne, non lo riceve: sarebbe un bottone inutile. */

/** Le colonne superano lo spazio della griglia? Un pixel di tolleranza per gli
 *  arrotondamenti sub-pixel; una griglia non ancora misurata (o nascosta) non
 *  sfora. */
export function columnsOverflow(columnWidths: readonly number[], viewportWidth: number): boolean {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return false;
  let total = 0;
  for (const w of columnWidths) {
    if (Number.isFinite(w) && w > 0) total += w;
  }
  return total > viewportWidth + 1;
}

export interface OneLineOfferInput {
  gridId: string | null | undefined;
  hasContinuationBands: boolean;
  columnsOverflow: boolean;
  /** Modalità già attiva: l'offerta resta, altrimenti chi l'ha accesa non
   *  potrebbe più spegnerla quando la misura cambia (finestra allargata). */
  oneLineOn: boolean;
}

export function canOfferOneLine({ gridId, hasContinuationBands, columnsOverflow, oneLineOn }: OneLineOfferInput): boolean {
  if (!gridId) return false;
  return hasContinuationBands || columnsOverflow || oneLineOn;
}
