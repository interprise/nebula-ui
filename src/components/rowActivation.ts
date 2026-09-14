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
