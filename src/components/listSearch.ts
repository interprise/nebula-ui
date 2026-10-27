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
  column = '',
): Record<string, string> {
  const key = searchKey(text);
  // Maiuscole e accenti non contano, come nel confronto del server.
  const same = foldKey(key) === foldKey(memory.text);
  const from = cont ? cont.position : same ? memory.lastFound : -1;
  const params: Record<string, string> = { navpath: listPath, option1: key, from: String(from) };
  if (cont) params.done = String(cont.scanned);
  if (backward) params.dir = '-1';
  if (column) params.col = column;
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

/** Una colonna in cui si puo' cercare: `name` e' il content del ViewItem. */
export interface SearchColumn {
  name: string;
  label: string;
}

/**
 * Le colonne della tendina «dove cercare»: quelle della prima riga
 * d'intestazione con un nome e un'etichetta, una volta sola per nome, senza
 * quelle che il server non guarda (`searchable: false`, caselle Si'/No). `label` e' gia' il testo dell'intestazione senza markup.
 */
export function searchColumns(
  headers: readonly { name?: string; text?: string; type?: string; searchable?: boolean }[] | undefined,
  label: (raw: string) => string,
  isBoolean: (idx: number) => boolean,
): SearchColumn[] {
  const out: SearchColumn[] = [];
  const seen = new Set<string>();
  (headers ?? []).forEach((h, idx) => {
    // `searchable: false` lo dice il server: contenitori, Hint, colonne che
    // LocateRow salta.
    if (h.type === 'selector' || !h.name || h.searchable === false || seen.has(h.name) || isBoolean(idx)) return;
    const text = label(h.text ?? '').trim();
    if (!text) return;
    seen.add(h.name);
    out.push({ name: h.name, label: text });
  });
  return out;
}

/** La risposta al filtro (FilterRows), letta da `resp.filtered`. */
export interface FilterResult {
  /** Righi rimasti con il filtro messo (o tolto). */
  count?: number;
  /** Il filtro non si e' messo: l'elenco ha questi righi, troppi. */
  tooMany?: number;
  /** Il filtro non si e' messo: ci sono modifiche non salvate. */
  dirty?: boolean;
  /** Il filtro non si e' messo: lista fatta in memoria, non si rilegge. */
  unsupported?: boolean;
}

export function readFiltered(resp: unknown): FilterResult | null {
  const raw = (resp as { filtered?: unknown } | null | undefined)?.filtered;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    count: typeof r.count === 'number' ? r.count : undefined,
    tooMany: typeof r.tooMany === 'number' ? r.tooMany : undefined,
    ...(r.dirty === true ? { dirty: true } : {}),
    ...(r.unsupported === true ? { unsupported: true } : {}),
  };
}

/** I parametri di FilterRows: testo vuoto = togli il filtro. */
export function filterParams(listPath: string, text: string, column = ''): Record<string, string> {
  const params: Record<string, string> = { navpath: listPath, option1: searchKey(text) };
  if (column && params.option1) params.col = column;
  return params;
}

/** Il messaggio quando l'elenco e' troppo lungo per filtrarlo. */
export function tooManyMessage(rows: number): string {
  return `L'elenco ha ${rows.toLocaleString('it-IT')} righi: troppi per filtrarli. Restringi prima la ricerca, poi usa il filtro.`;
}

/** Il filtro rifiutato perche' ci sono modifiche non salvate. */
export const FILTER_DIRTY_MESSAGE = 'Ci sono modifiche non salvate: salva o annulla, poi usa il filtro.';

/** Il filtro rifiutato su una lista che non si rilegge. */
export const FILTER_UNSUPPORTED_MESSAGE = 'Questa lista non si puo\' filtrare: usa le frecce per trovare i righi.';

/** L'etichetta del filtro attivo: «rossi», o «rossi» in Cognome. */
export function filterLabel(text: string, columnLabel?: string): string {
  return columnLabel ? `«${text}» in ${columnLabel}` : `«${text}»`;
}

/** Quante continuazioni al piu' segue il client per una sola ricerca. */
export const MAX_CONTINUATIONS = 50;
