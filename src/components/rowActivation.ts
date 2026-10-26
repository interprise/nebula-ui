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

/** Il «Nuovo» della lista apre una pagina di dettaglio a se'?
 *
 *  Specchio di CORE AddCommand (`!isInlineEdited()`), come il legacy. Le liste
 *  non listEdit si', sempre. Una listEdit in linea (anche multiEdit) aggiunge il
 *  rigo nella lista, cioe' nel micro-detail; il dettaglio esteso si apre dal
 *  selettore del rigo o dal bottone «Dettaglio» del pannello. Una listEdit con
 *  `inlineEdit="false"` e una `detailViewName` apre la pagina di dettaglio: era
 *  il caso delle Righe fattura passive su ALFA 2.021, dove tornando dalla pagina
 *  il fuoco finiva sulla testata perche' il ritorno non era armato (SXADV-5927).
 *  Verificato a schermo sul legacy il 26/10/2026.
 */
export function addOpensDetail(list: {
  isListEdit: boolean;
  inlineEdit?: boolean;
  hasDetailView?: boolean;
}): boolean {
  if (!list.isListEdit) return true;
  return list.inlineEdit === false && !!list.hasDetailView;
}

/** Il «>» (o il clic che naviga) di un rigo apre una pagina di dettaglio?
 *
 *  CORE NavigateDetailCommand cambia pagina solo se la lista non si modifica in
 *  linea o e' multiEdit; su un micro-detail (listEdit in linea, non multiEdit)
 *  sposta soltanto il percorso di post e la pagina resta. Solo dove la pagina
 *  cambia si arma il ritorno sul rigo (SXADV-5927, revisione indipendente).
 */
export function detailOpensPage(list: {
  isListEdit: boolean;
  isMultiEdit: boolean;
  inlineEdit?: boolean;
}): boolean {
  if (!list.isListEdit) return true;
  return list.inlineEdit === false || list.isMultiEdit;
}

export const ROW_ACTIVATABLE_CLASS = 'row-activatable';

/** Classe dei righi il cui clic fa qualcosa: il cursore a mano sta solo li'
 *  (SXADV-5921). Nelle liste di selezione il clic non naviga (SXADV-6014) e il
 *  dettaglio sta sul ">": un rigo che sembrasse cliccabile come quelli di una
 *  lista che naviga sarebbe proprio il disorientamento del ticket. La regola e'
 *  quella del clic, `rowClickOutcome`, cosi' il cursore non promette un clic
 *  che non fa niente e non ne nasconde uno che agisce. */
export function rowActivatableClass(
  data: Record<string, unknown> | undefined,
  list: Omit<Parameters<typeof rowClickOutcome>[0], 'command'>,
  panelOpensOn?: (path: string) => boolean,
): string | undefined {
  // Senza percorso il clic si ferma prima di decidere (activateRow).
  const path = data?._selectorPath as string | undefined;
  if (!data || data._isBreakRow || !path) return undefined;
  const outcome = rowClickOutcome({ ...list, command: data._selectorCommand as string | undefined });
  if (outcome === 'none') return undefined;
  // Il pannello si apre solo se sul rigo c'e' qualcosa da scrivere
  // (ListView.panelIsEditable): altrimenti il clic evidenzia e basta, come sui
  // Dettagli Fatturabili dove la sola colonna aperta e' la spunta in griglia.
  if (outcome === 'panel' && panelOpensOn && !panelOpensOn(path)) return undefined;
  return ROW_ACTIVATABLE_CLASS;
}
