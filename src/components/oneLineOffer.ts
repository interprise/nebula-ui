/* Quando offrire il bottone "un record per riga" di una lista (SXADV-5965).

   Il bottone mette il record su una linea sola, toglie l'a-capo del testo e
   blocca a sinistra le prime colonne. Nasce per le liste con bande di
   continuazione, ma serve altrettanto dove il record sta già su una riga e le
   colonne sono troppe per la finestra (Domino > Tessere, ~60 colonne): lì si
   scorre in orizzontale e ciò che identifica il record esce di vista. Una
   lista stretta, con poche colonne, non lo riceve: sarebbe un bottone inutile —
   a meno che i suoi record vadano a capo per un a capo di markup (Clienti,
   SXADV-6012): lì la modalità li mette su una riga e allarga le colonne al
   contenuto, e la lista torna a scorrere in orizzontale. */

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
  /** Un record della pagina va a capo per un a capo di markup (Indirizzo e
   *  Contatti di Clienti, Fornitori, Anagrafica Unica — SXADV-6012): la
   *  modalità lo mette su una riga col separatore. */
  recordsWrap?: boolean;
  /** Modalità già attiva: l'offerta resta, altrimenti chi l'ha accesa non
   *  potrebbe più spegnerla quando la misura cambia (finestra allargata). */
  oneLineOn: boolean;
}

export function canOfferOneLine({ gridId, hasContinuationBands, columnsOverflow, recordsWrap = false, oneLineOn }: OneLineOfferInput): boolean {
  if (!gridId) return false;
  return hasContinuationBands || columnsOverflow || recordsWrap || oneLineOn;
}
