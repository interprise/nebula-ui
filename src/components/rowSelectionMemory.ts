import { disarmAllReturns } from '../services/rowReturn';

/** La riga da cui si e' usciti verso un dettaglio, per lista (chiave = sid +
 *  vista). Sta fuori dal componente perche' ListRenderer si rimonta entrando
 *  nel dettaglio e tornando: al ritorno la riga torna evidenziata e a vista
 *  (SXADV-5455.1C, SXADV-5957). */
const rememberedByList = new Map<string, string>();

export function rememberRow(key: string, path: string | null | undefined): void {
  if (path) rememberedByList.set(key, path);
  else rememberedByList.delete(key);
}

export function recallRow(key: string): string | undefined {
  return rememberedByList.get(key);
}

export function forgetAllRows(): void {
  rememberedByList.clear();
  disarmAllReturns();
}

// L'uscita armata verso un dettaglio sta nei servizi (la disarma anche l'API
// a un ingresso di primo livello); qui si riesporta accanto alla riga ricordata.
export {
  armReturn, armedReturn, disarmReturn, armedBySameMount, newListMount, registerListMount, ROW_RETURN_ATTR,
} from '../services/rowReturn';
export type { ReturnMode } from '../services/rowReturn';

/** La riga di dati piu' in basso: e' quella appena aggiunta col Nuovo, che CORE
 *  accoda alla collezione. */
export function lastRecordPath(nodes: readonly { path: string; rowIndex: number }[]): string | null {
  let last: { path: string; rowIndex: number } | null = null;
  for (const n of nodes) {
    if (!last || n.rowIndex > last.rowIndex) last = n;
  }
  return last ? last.path : null;
}

/** `S1-21.1` -> sid `S1`, riga `1`; il viewstate (21) resta fuori. */
const SEGMENT = /^([^-,]+)-\d+\.(\d+)$/;

/** Fra i percorsi delle righe in lista, quello della riga ricordata.
 *
 *  Il percorso e' viewstate + POSIZIONE. Una lista incorporata in un tab, al
 *  ritorno dal dettaglio di una sua riga, rinasce con un viewstate nuovo:
 *  `S1-0.7,S1-9.0,S1-10.1` torna come `S1-0.7,S1-9.0,S1-21.1` (5957.2). Si
 *  riconosce la riga se il padre e' identico e nell'ultimo segmento cambia
 *  solo il viewstate. Una lista a pagina intera con un viewstate diverso e'
 *  invece un'altra ricerca, anche se aperta da un dettaglio e quindi con un
 *  percorso a piu' segmenti: li' vale solo l'uguaglianza, e chi chiama lo dice
 *  con `incorporata` = false. */
export function findRememberedRow(
  stored: string,
  candidates: readonly string[],
  incorporata = true,
): string | null {
  if (!stored) return null;
  if (candidates.includes(stored)) return stored;
  if (!incorporata) return null;
  const cut = stored.lastIndexOf(',');
  if (cut < 0) return null;
  const parent = stored.slice(0, cut + 1);
  const last = SEGMENT.exec(stored.slice(cut + 1));
  if (!last) return null;
  let found: string | null = null;
  for (const c of candidates) {
    if (!c.startsWith(parent)) continue;
    const m = SEGMENT.exec(c.slice(parent.length));
    if (!m || m[1] !== last[1] || m[2] !== last[2]) continue;
    if (found !== null && found !== c) return null;
    found = c;
  }
  return found;
}

/** La pagina (da 1) su cui sta la riga ricordata di una lista incorporata,
 *  quando la lista e' la stessa ma la riga non e' sulla pagina mostrata.
 *
 *  Il server ricrea la lista del tab al ritorno dal dettaglio di un rigo e la
 *  rimanda da pagina 1 (5957.2B). La posizione nel percorso e' quella nella
 *  collezione, non nella pagina, quindi dice da sola su che pagina sta il rigo.
 *  Null se la riga e' gia' in lista, se la lista e' un'altra (padre o sid
 *  diversi, primo livello) o se mancano i dati per calcolarla. */
export function pageOfRememberedRow(
  stored: string,
  candidates: readonly string[],
  pageSize: number,
): number | null {
  if (!stored || !Number.isInteger(pageSize) || pageSize <= 0) return null;
  const cut = stored.lastIndexOf(',');
  if (cut < 0) return null;
  const parent = stored.slice(0, cut + 1);
  const last = SEGMENT.exec(stored.slice(cut + 1));
  if (!last) return null;
  const sameList = candidates.some((c) => {
    if (!c.startsWith(parent)) return false;
    const m = SEGMENT.exec(c.slice(parent.length));
    return !!m && m[1] === last[1];
  });
  if (!sameList || findRememberedRow(stored, candidates) !== null) return null;
  return Math.floor(Number(last[2]) / pageSize) + 1;
}

/** Il padre di un percorso di lista o di riga: tutto fino all'ultima virgola
 *  compresa (`S1-0.0,S1-11.0,S1-14.0` -> `S1-0.0,S1-11.0,`). E' lo stesso per
 *  le righe e per la lista, e resta lo stesso quando la lista incorporata
 *  rinasce con un viewstate nuovo; null per una lista di primo livello. */
export function listOwnerOf(path: string | null | undefined): string | null {
  if (!path) return null;
  const cut = path.lastIndexOf(',');
  return cut < 0 ? null : path.slice(0, cut + 1);
}

/** Sotto quale chiave una lista ricorda la riga e il ritorno armato.
 *
 *  `selKey` (sid + vista) persiste la riga attraverso il rimontaggio quando si
 *  entra in un dettaglio e si torna (5455.1C). Per una lista incorporata la
 *  proprietaria del ritorno e' il padre del suo percorso, che resta lo stesso
 *  quando la lista rinasce col viewstate nuovo: il dettaglio di un rigo puo'
 *  contenere una griglia della stessa vista (i Componenti del rigo, stessa
 *  selKey), che senza il padre consumava il ritorno e sovrascriveva la riga
 *  ricordata di Righe fattura (5957.2B). */
export function listReturnKey(
  sid: string | null | undefined,
  list: { viewName?: string; path?: string },
  embedded: boolean,
): { memKey: string; owner: string | null } {
  const selKey = `${sid ?? ''}|${list.viewName ?? list.path ?? ''}`;
  const owner = embedded ? listOwnerOf(list.path) : null;
  return { memKey: owner ? `${selKey}@${owner}` : selKey, owner };
}
