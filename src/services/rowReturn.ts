/** Un'uscita da una lista verso un dettaglio che aspetta il suo ritorno: 'row'
 *  dal clic su una riga, 'new' dal "Nuovo" della griglia. Al ritorno la lista
 *  prende il fuoco sulla riga (quella cliccata, o l'ultima per il Nuovo) invece
 *  di lasciarlo al primo campo della testata, che stringeva l'area dei tab e
 *  lasciava la griglia in cima (SXADV-5927). Vale un ritorno solo: la lista lo
 *  disarma appena l'ha applicato, e un ingresso di primo livello (voce di menu,
 *  `newTask`) li disarma tutti, perche' da li' non si torna piu' alla lista.
 *  Chiave = sid + vista, come la riga ricordata in rowSelectionMemory. */
export type ReturnMode = 'row' | 'new';
const armedByList = new Map<string, ReturnMode>();

export function armReturn(key: string, mode: ReturnMode): void {
  armedByList.set(key, mode);
}

export function armedReturn(key: string): ReturnMode | undefined {
  return armedByList.get(key);
}

export function disarmReturn(key: string): void {
  armedByList.delete(key);
}

export function disarmAllReturns(): void {
  armedByList.clear();
}

/** Lo mette una lista sul suo contenitore finche' aspetta il ritorno:
 *  `focusNewPage` lo vede e non porta il cursore in testata. */
export const ROW_RETURN_ATTR = 'data-row-return';
