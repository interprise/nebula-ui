/* Il rigo in gestione nel pannello resta a vista quando arrivano righe nuove
 * (SXADV-6261).
 *
 * Due casi su un tab con molti righi (Configurazione caricamenti -> Elenco
 * campi): dopo "Nuovo" il rigo nuovo, in fondo, restava sotto il bordo - la
 * griglia lo portava a vista una volta sola, e le righe ad altezza automatica
 * crescevano dopo, spingendolo fuori; dopo "Salva" la griglia riceveva le righe
 * nuove e tornava in cima. Chi sta scrivendo in un rigo deve vederlo.
 *
 * Il record e' il rigo principale (quello col percorso) piu' le sue bande di
 * continuazione, che lo seguono senza percorso proprio. */

export interface DisplayedRow {
  /** Percorso del record sul rigo principale; assente sulle bande. */
  path?: string | null;
  /** Banda di continuazione del record precedente. */
  continuation?: boolean;
}

/** Indici (nell'ordine mostrato) del primo e dell'ultimo rigo del record
 *  `path`, bande comprese; null se il record non c'e'. */
export function recordRowSpan(rows: readonly DisplayedRow[], path: string): { first: number; last: number } | null {
  const first = rows.findIndex((r) => !r.continuation && r.path === path);
  if (first < 0) return null;
  let last = first;
  while (last + 1 < rows.length && rows[last + 1].continuation) last++;
  return { first, last };
}

/** Come portare a vista il record dati i bordi (in px, stesse coordinate) del
 *  suo primo e ultimo rigo e della finestra della griglia: niente se e' gia'
 *  tutto a vista; il fondo se sborda sotto e ci sta intero; altrimenti la
 *  cima, che e' il rigo principale, quello dei campi del pannello. */
export function alignRecord(
  record: { top: number; bottom: number },
  viewport: { top: number; bottom: number },
): 'none' | 'bottom' | 'top' {
  const tol = 1;
  if (record.top >= viewport.top - tol && record.bottom <= viewport.bottom + tol) return 'none';
  const fitsHeight = record.bottom - record.top <= viewport.bottom - viewport.top + tol;
  return fitsHeight && record.top >= viewport.top - tol ? 'bottom' : 'top';
}

/** Lo scrollTop che porta a vista il record (bordi nelle coordinate del
 *  contenuto scorrevole), o null se e' gia' a vista. */
export function scrollTopFor(
  record: { top: number; bottom: number },
  scrollTop: number,
  clientHeight: number,
): number | null {
  const how = alignRecord(record, { top: scrollTop, bottom: scrollTop + clientHeight });
  if (how === 'none') return null;
  return how === 'bottom' ? Math.max(0, record.bottom - clientHeight) : Math.max(0, record.top);
}
