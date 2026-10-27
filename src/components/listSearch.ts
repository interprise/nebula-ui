/**
 * «Cerca» di una lista (SXADV-4569): il campo nella banda dei comandi della
 * griglia trova il prossimo rigo che contiene un testo.
 *
 * La ricerca la fa il server (LocateRowCommand): le liste arrivano a pagine, e
 * una ricerca nel browser vedrebbe solo la pagina caricata — con mille contatti
 * nel tab Eventi di una campagna, dieci pagine da cento. Il server risponde come
 * a un cambio pagina, portando la lista sulla pagina del rigo trovato, e dice
 * dove sta il rigo (`located`). Qui ci sono le regole che non dipendono da
 * React: che cosa chiedere, come leggere la risposta, quale riga e' quella.
 */

/** La risposta del server alla ricerca, letta da `resp.located`. */
export interface LocateResult {
  /** Trovato un rigo che contiene il testo. */
  found: boolean;
  /** Il tetto di tempo e' scaduto prima della fine: la ricerca va continuata. */
  more: boolean;
  /** Posizione assoluta nel cursore del rigo trovato (o, con `more`, dell'ultimo guardato). */
  position: number;
  /** Righe guardate finora dalla stessa ricerca, compresi i giri precedenti. */
  scanned: number;
}

export function readLocated(resp: unknown): LocateResult | null {
  const raw = (resp as { located?: unknown } | null | undefined)?.located;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const position = typeof r.position === 'number' ? r.position : -1;
  return {
    found: r.found === true,
    more: r.more === true,
    position,
    scanned: typeof r.scanned === 'number' ? r.scanned : 0,
  };
}

/** Lo stato tra una ricerca e la successiva: testo e ultimo rigo trovato. */
export interface SearchMemory {
  text: string;
  /** Posizione dell'ultimo rigo trovato per questo testo, -1 se nessuno. */
  lastFound: number;
}

export const EMPTY_SEARCH: SearchMemory = { text: '', lastFound: -1 };

/** Il testo come lo confronta il server: spazi agli estremi non contano. */
export function searchKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * I parametri della richiesta. Lo stesso testo di prima riparte dal rigo dopo
 * l'ultimo trovato (Invio = «trova il successivo»); un testo nuovo ricomincia
 * dall'inizio della lista. `cont` e' la continuazione di una ricerca fermata
 * dal tetto di tempo. `backward` cerca il precedente (Maiusc+Invio): dal rigo
 * prima dell'ultimo trovato, e con un testo nuovo dal fondo della lista.
 */
export function locateParams(
  listPath: string,
  text: string,
  memory: SearchMemory,
  cont?: { position: number; scanned: number },
  backward = false,
): Record<string, string> {
  const key = searchKey(text);
  // Maiuscole e accenti non contano, come nel confronto del server.
  const same = foldKey(key) === foldKey(memory.text);
  const from = cont ? cont.position : same ? memory.lastFound : -1;
  const params: Record<string, string> = { navpath: listPath, option1: key, from: String(from) };
  if (cont) params.done = String(cont.scanned);
  if (backward) params.dir = '-1';
  return params;
}

function foldKey(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** La posizione in coda al percorso di riga: `S1-0.2,S1-3.57` -> 57. */
export function positionOfPath(path: string): number | null {
  const m = /\.(-?\d+)$/.exec(path);
  return m ? Number(m[1]) : null;
}

/** Il percorso della riga a quella posizione, fra quelli della pagina caricata. */
export function pathAtPosition(paths: readonly string[], position: number): string | undefined {
  return paths.find((p) => positionOfPath(p) === position);
}

/** Il messaggio quando non c'e' niente. */
export function notFoundMessage(text: string): string {
  return `Nessun rigo contiene «${searchKey(text)}».`;
}

/** Il messaggio quando la ricerca si ferma prima di aver guardato tutto l'elenco. */
export function stoppedMessage(text: string): string {
  return `Ricerca di «${searchKey(text)}» interrotta: l'elenco e' molto lungo. Invio continua.`;
}

/**
 * Il campo compare dove c'e' qualcosa da cercare: almeno due record. Su una
 * lista vuota o di un rigo solo non serve.
 */
export function showsListSearch(recordCount: number): boolean {
  return recordCount > 1;
}

/** Quante continuazioni al piu' segue il client per una sola ricerca. */
export const MAX_CONTINUATIONS = 50;
