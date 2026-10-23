/** Un'uscita da una lista verso un dettaglio che aspetta il suo ritorno: 'row'
 *  dal clic su una riga, 'new' dal "Nuovo" della griglia. Al ritorno la lista
 *  prende il fuoco sulla riga (quella cliccata, o l'ultima per il Nuovo) invece
 *  di lasciarlo al primo campo della testata, che stringeva l'area dei tab e
 *  lasciava la griglia in cima (SXADV-5927). Vale un ritorno solo: la lista lo
 *  disarma appena l'ha applicato, e un ingresso di primo livello (voce di menu,
 *  `newTask`) li disarma tutti, perche' da li' non si torna piu' alla lista.
 *  Chiave = sid + vista, come la riga ricordata in rowSelectionMemory. */
export type ReturnMode = 'row' | 'new';
/** `owner` e' la lista che ha armato il ritorno (per una lista incorporata il
 *  padre del suo percorso, `listOwnerOf`): la chiave sid + vista non basta,
 *  perche' il dettaglio di un rigo puo' contenere una griglia della stessa
 *  vista (i Componenti di Righe fattura), che consumava il ritorno al posto
 *  della lista del tab (SXADV-5957.2B). Senza owner il ritorno vale per
 *  chiunque abbia la chiave. */
const armedByList = new Map<string, { mode: ReturnMode; owner: string | null }>();

export function armReturn(key: string, mode: ReturnMode, owner?: string | null): void {
  armedByList.set(key, { mode, owner: owner ?? null });
}

/** Il ritorno armato per questa lista: undefined se non c'e', o se l'ha armato
 *  un'altra lista con la stessa chiave. Non disarma. */
export function armedReturn(key: string, owner?: string | null): ReturnMode | undefined {
  const armed = armedByList.get(key);
  if (!armed) return undefined;
  if (armed.owner !== null && armed.owner !== (owner ?? null)) return undefined;
  return armed.mode;
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
