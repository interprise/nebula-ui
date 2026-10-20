/** Un clic, una sola attivazione di riga.
 *
 *  Su una banda di continuazione (riga a tutta larghezza) lo stesso clic arriva
 *  a DUE gestori: `onRowClicked` di AG Grid, che dalla 35 lo emette anche per le
 *  righe a tutta larghezza, e `handleGridClick` sul contenitore, che c'era per
 *  quando AG Grid non lo faceva. Tutti e due attivavano la riga, e su una lista
 *  che naviga partivano due NavigateDetail con lo stesso navpath: il primo apriva
 *  il dettaglio, il secondo trovava la pagina gia' cambiata e CORE rispondeva
 *  "Sessione non valida" (SXADV-5920). Il blocco su `tab.loading` in Shell non
 *  lo ferma: i due gestori girano nello stesso evento, prima che React abbia
 *  aggiornato lo stato.
 *
 *  I due gestori ricevono lo STESSO oggetto evento nativo (AG Grid lo passa in
 *  `event.event`, React in `e.nativeEvent`), ed e' quello a dire che si tratta
 *  dello stesso gesto: il primo che lo vede attiva, il secondo no. Senza evento
 *  (tastiera, attivazioni da codice) si attiva sempre.
 */
export function oncePerEvent(): (event: Event | undefined) => boolean {
  let last: Event | undefined;
  return (event) => {
    if (!event) return true;
    if (event === last) return false;
    last = event;
    return true;
  };
}

export type RowClickOutcome = 'panel' | 'navigate' | 'none';

/** Cosa fa il clic su una riga di lista, oltre a evidenziarla.
 *
 *  - Pannello di riga (listEdit + pannello mandato dal server): lo apre, se la
 *    riga si puo' modificare; altrimenti la riga resta solo evidenziata.
 *  - multiEdit senza pannello ma con una casella spuntabile in griglia: e' una
 *    lista di SELEZIONE (spunta piu' azioni di lista). Il clic non naviga mai:
 *    chi sta spuntando righe e sbaglia mira perderebbe la pagina. Il dettaglio
 *    resta sul ">" (SXADV-6014). Una multiEdit senza caselle (docLottiList) non
 *    e' una selezione e naviga come le altre.
 *  - Gli altri: navigano col comando della riga, se c'e'.
 */
export function rowClickOutcome(o: {
  isListEdit: boolean;
  isMultiEdit: boolean;
  hasGridCheckbox: boolean;
  hasPanelTemplate: boolean;
  command?: string;
  canEdit: boolean;
  canUpdate: boolean;
}): RowClickOutcome {
  if (o.isListEdit && o.hasPanelTemplate) return o.canEdit && o.canUpdate ? 'panel' : 'none';
  if (o.isMultiEdit && o.hasGridCheckbox) return 'none';
  return o.command ? 'navigate' : 'none';
}
