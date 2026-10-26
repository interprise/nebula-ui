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
const armedByList = new Map<string, { mode: ReturnMode; owner: string | null; mount: number | null; page: number }>();

/** Le pagine cambiate in ogni sessione (sid): Shell lo fa avanzare quando una
 *  risposta porta una pagina diversa. Un ritorno ricorda a che punto era
 *  armato; se la risposta della sua richiesta resta sulla stessa pagina (Nuovo
 *  o Salva+ respinto, conferma annullata, richiesta fallita), quel ritorno non
 *  arrivera' mai e Shell lo toglie (`settleReturns`). Lo decide la risposta,
 *  non le righe: righe nuove possono essere la risposta di un'altra richiesta
 *  (seconda e terza revisione indipendente). */
const pageBySid = new Map<string, number>();

/** La sessione di una chiave di lista: `sid|vista[@padre]` (listReturnKey). */
function sidOfKey(key: string): string {
  const cut = key.indexOf('|');
  return cut < 0 ? '' : key.slice(0, cut);
}

/** Una risposta ha portato una pagina diversa nella sessione `sid`. */
export function notePageChange(sid: string): void {
  pageBySid.set(sid, (pageBySid.get(sid) ?? 0) + 1);
}

/** Una risposta finale e' rimasta sulla pagina: i ritorni armati su questa
 *  pagina della sessione `sid` non si useranno piu'. Quelli armati prima, in
 *  attesa del rientro da un dettaglio, restano. */
export function settleReturns(sid: string): void {
  const page = pageBySid.get(sid) ?? 0;
  for (const [key, armed] of armedByList) {
    if (sidOfKey(key) === sid && armed.page === page) armedByList.delete(key);
  }
}

/** La lista montata adesso sotto ogni chiave. Il ritorno si arma quando parte
 *  la richiesta, ma la pagina cambia solo se la risposta naviga: un Nuovo o un
 *  Salva+ che il server respinge (campo obbligatorio, conferma annullata) lascia
 *  la lista dov'e', e il suo ridisegno consumava il ritorno come se si fosse
 *  tornati - griglia scorsa in fondo, ultima riga evidenziata col pannello su
 *  un'altra, fuoco alla testata. Il ritorno vale solo per un montaggio NUOVO
 *  della lista: quello che l'ha armato non lo vede (revisione indipendente);
 *  a toglierlo e' poi `settleReturns`. */
const liveMount = new Map<string, number>();
let mountSeq = 0;

/** Un'identita' nuova per un montaggio di lista. */
export function newListMount(): number {
  return ++mountSeq;
}

/** Il montaggio `mount` e' la lista viva sotto `key`; restituisce la funzione
 *  che lo toglie (allo smontaggio, o quando la chiave cambia). */
export function registerListMount(key: string, mount: number): () => void {
  liveMount.set(key, mount);
  return () => {
    if (liveMount.get(key) === mount) liveMount.delete(key);
  };
}

export function armReturn(key: string, mode: ReturnMode, owner?: string | null): void {
  armedByList.set(key, {
    mode, owner: owner ?? null, mount: liveMount.get(key) ?? null, page: pageBySid.get(sidOfKey(key)) ?? 0,
  });
}

/** Il ritorno armato per questa lista: undefined se non c'e', se l'ha armato
 *  un'altra lista con la stessa chiave, o se a chiederlo e' lo stesso montaggio
 *  che l'ha armato (`mount`: la pagina non e' cambiata). Non disarma. */
export function armedReturn(key: string, owner?: string | null, mount?: number): ReturnMode | undefined {
  const armed = armedByList.get(key);
  if (!armed) return undefined;
  if (armed.owner !== null && armed.owner !== (owner ?? null)) return undefined;
  if (mount !== undefined && armed.mount === mount) return undefined;
  return armed.mode;
}

/** Il ritorno l'ha armato proprio questo montaggio: la pagina non e' cambiata. */
export function armedBySameMount(key: string, mount: number): boolean {
  return armedByList.get(key)?.mount === mount;
}

export function disarmReturn(key: string): void {
  armedByList.delete(key);
}

export function disarmAllReturns(): void {
  armedByList.clear();
  pageBySid.clear();
}

/** Lo mette una lista sul suo contenitore finche' aspetta il ritorno:
 *  `focusNewPage` lo vede e non porta il cursore in testata. */
export const ROW_RETURN_ATTR = 'data-row-return';
