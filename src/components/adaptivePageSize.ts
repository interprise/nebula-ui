/* Adaptive page size (SXADV-5742): quante righe chiedere al server.
 *
 * La lista misura quanti record entrano nella griglia e lo dice al server
 * (SetPageSizeCommand). Qui sta solo la decisione, con la sua memoria; misure e
 * richiesta restano in ListRenderer. Bounds mirror SetPageSizeCommand's, which is
 * the authority — these only keep the client from asking for something the
 * server would clamp anyway. */
export const MIN_ADAPTIVE_PAGE_SIZE = 20;   // ToolView.STD_PAGE_SIZE
export const MAX_ADAPTIVE_PAGE_SIZE = 100;  // server caps at 200; stay well under it
/** Rows of difference below which a resize isn't worth a round-trip. */
export const ADAPTIVE_PAGE_SIZE_HYSTERESIS = 3;

/** Quello che la lista ricorda fra una misura e l'altra.
 *  - `listId`: la lista a cui si riferisce la memoria (id del viewstate).
 *  - `avail` / `sizes`: le taglie gia' chieste per questo spazio. Now that a
 *    record sizes to its content, the page size and the average record height
 *    feed each other — asking for 40 can load records that wrap, which measures
 *    back as 30, which measures back as 40 — so each size is asked at most once,
 *    until the space available genuinely changes (SXADV-5770.2).
 *  - `lastAsked`: l'ultima taglia chiesta, base dell'isteresi.
 *  - `afterPanel`: il pannello di riga e' stato aperto dall'ultima misura. */
export type AdaptiveMemory = {
  listId: string | null; avail: number; sizes: Set<number>; lastAsked: number | null; afterPanel: boolean;
};

export function newAdaptiveMemory(): AdaptiveMemory {
  return { listId: null, avail: 0, sizes: new Set<number>(), lastAsked: null, afterPanel: false };
}

/** La taglia da chiedere al server, o null. Aggiorna `mem`.
 *
 *  Due regole da SXADV-5982:
 *  - a pannello di riga aperto non si ricalcola niente: il pannello e' di
 *    passaggio, e la griglia che si accorcia lo farebbe sembrare un cambio di
 *    spazio. La pagina cambiava sotto le mani (22 con il pannello, 27 alla
 *    chiusura) e a pagina 2 comparivano altri record. Con il pannello aperto la
 *    griglia scorre. E alla chiusura, se lo spazio e' tornato quello di prima,
 *    non si rimisura: il passo dei record sarebbe quello della pagina che si sta
 *    guardando (a pagina 2 i record possono andare a capo meno che a pagina 1) e
 *    la pagina cambierebbe subito dopo Annulla. Se intanto la finestra e' cambiata
 *    davvero, si ricalcola;
 *  - una lista nuova (rientro dal menu, viewstate nuovo: il server riparte da
 *    20) azzera la memoria. Prima la memoria della lista precedente diceva "22
 *    l'ho gia' chiesto" e la pagina restava a 20 finche' un altro evento non la
 *    faceva ricalcolare, a lavoro in corso. */
export function decidePageSize(
  mem: AdaptiveMemory,
  input: { listId: string | null; avail: number; pitch: number | null; current: number; panelShown: boolean },
): number | null {
  if (input.panelShown) {
    mem.afterPanel = true;
    return null;
  }
  if (input.listId !== mem.listId) {
    mem.listId = input.listId;
    mem.avail = 0;
    mem.sizes.clear();
    mem.lastAsked = null;
    mem.afterPanel = false;
  }
  const { avail, pitch, current } = input;
  if (mem.afterPanel) {
    mem.afterPanel = false;
    if (Math.abs(mem.avail - avail) <= 8) return null;
  }
  if (Math.abs(mem.avail - avail) > 8) {
    mem.avail = avail;
    mem.sizes.clear();
  }
  if (!pitch || avail < pitch) return null;
  const fits = Math.floor(avail / pitch);
  const want = Math.max(MIN_ADAPTIVE_PAGE_SIZE, Math.min(MAX_ADAPTIVE_PAGE_SIZE, fits));
  if (want === current) return null;
  // The server clamps and may refuse, in which case the response comes back with
  // the old size — remembering what we asked for stops us asking again on every
  // resize.
  if (want === mem.lastAsked) return null;
  // Hysteresis applies to RESIZES, not to the first fit: the gap between the
  // fixed default and what fits is usually small (20 vs the 22 that fit on a
  // 1265px window) and that gap is the whole point. Once we've adapted, a couple
  // of rows is no longer worth a round-trip and a renumbered pager.
  if (mem.lastAsked !== null && Math.abs(want - mem.lastAsked) < ADAPTIVE_PAGE_SIZE_HYSTERESIS) return null;
  if (mem.sizes.has(want)) return null;
  mem.sizes.add(want);
  mem.lastAsked = want;
  return want;
}
