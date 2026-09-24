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
