/**
 * SXADV-6001.0 · la posizione delle colonne, dalla lista al widget.
 *
 * Le colonne si spostano trascinandole nella griglia, e di questo il server non sa
 * niente: l'ordine vive solo in AG Grid. Chi crea un widget dalla lista lo legge qui e
 * lo manda a `dashboard.AddWidget`, che lo salva come permutazione degli indici delle
 * colonne; il widget lo applica solo al disegno.
 */

const COLONNA = /^col_(0|[1-9]\d*)$/;

/**
 * I nomi delle colonne (il `content` del ViewItem) nell'ordine in cui si vedono.
 *
 * @param campi i colId delle colonne mostrate, nell'ordine a video. Contano solo le
 *        `col_<n>`: il selettore e le bande di continuazione diventate colonne non
 *        sono colonne della vista di lista.
 * @param nomi il nome di ogni intestazione, per indice.
 * @return null se non c'e' niente da riportare: nessun nome, o l'ordine della vista.
 */
export function nomiInOrdine(
  campi: readonly string[],
  nomi: readonly (string | undefined | null)[],
): string[] | null {
  const indici: number[] = [];
  const out: string[] = [];
  for (const campo of campi) {
    const m = COLONNA.exec(campo);
    if (!m) continue;
    const i = Number(m[1]);
    const nome = i < nomi.length ? nomi[i] : undefined;
    if (!nome) continue;
    indici.push(i);
    out.push(nome);
  }
  if (out.length === 0) return null;
  const spostate = indici.some((v, k) => k > 0 && v <= indici[k - 1]);
  return spostate ? out : null;
}

/** `ordine` e' una permutazione di 0..n-1? */
const permutazione = (ordine: readonly number[], n: number) => {
  if (ordine.length !== n) return false;
  const visti = new Set<number>();
  for (const i of ordine) {
    if (!Number.isInteger(i) || i < 0 || i >= n || visti.has(i)) return false;
    visti.add(i);
  }
  return true;
};

/**
 * Gli elementi nell'ordine dato, se l'ordine e' una permutazione valida; altrimenti
 * nell'ordine in cui sono. Sempre un array nuovo.
 */
export function permuta<T>(elementi: readonly T[], ordine: readonly number[] | null | undefined): T[] {
  if (!ordine || !permutazione(ordine, elementi.length)) return elementi.slice();
  return ordine.map((i) => elementi[i]);
}

/* La lista a video di ogni scheda (sid) registra come leggere il suo ordine; la
   finestra «Aggiungi alla dashboard» lo legge al momento del salvataggio. */
type Lettore = () => string[] | null;
const lettori = new Map<string, Lettore>();

/** Registra il lettore della lista della scheda; restituisce la funzione che lo toglie. */
export function registraOrdineColonne(sid: string, leggi: Lettore): () => void {
  lettori.set(sid, leggi);
  return () => {
    // Una lista che si smonta dopo che la successiva si e' gia' registrata non deve
    // portarsi via la registrazione nuova.
    if (lettori.get(sid) === leggi) lettori.delete(sid);
  };
}

/** L'ordine delle colonne della lista a video nella scheda, o null. */
export function leggiOrdineColonne(sid: string): string[] | null {
  const leggi = lettori.get(sid);
  if (!leggi) return null;
  try {
    return leggi();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------------------
 * L'ordinamento cliccato su una lista che sta tutta in una pagina. Li' ordina AG Grid
 * nel browser (`allDataLocal`) e il cursore del server resta com'era: senza questo il
 * widget nascerebbe nell'ordine della vista. Su una lista a piu' pagine ordina il
 * server, e quell'ordinamento arriva gia' con la sorgente.
 * ---------------------------------------------------------------------------------- */

export interface OrdinamentoLocale {
  /** Il nome della colonna (il `content` del ViewItem). */
  nome: string;
  verso: 'asc' | 'desc';
}

/**
 * La colonna su cui la griglia ordina, dallo stato delle colonne di AG Grid. Conta la
 * prima col `sort` impostato (per `sortIndex`, se ce n'e' piu' d'una) fra le `col_<n>`
 * con un nome.
 */
export function ordinamentoVisualizzato(
  stato: readonly { colId: string; sort?: string | null; sortIndex?: number | null }[],
  nomi: readonly (string | undefined | null)[],
): OrdinamentoLocale | null {
  const ordinate = stato
    .filter((s) => s.sort === 'asc' || s.sort === 'desc')
    .slice()
    .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
  for (const s of ordinate) {
    const m = COLONNA.exec(s.colId);
    if (!m) continue;
    const i = Number(m[1]);
    const nome = i < nomi.length ? nomi[i] : undefined;
    if (!nome) continue;
    return { nome, verso: s.sort as 'asc' | 'desc' };
  }
  return null;
}

/** Una cella della fotografia: il testo formattato e, se c'e', il valore grezzo. */
export interface CellaFoto {
  t?: string;
  v?: unknown;
}

const confrontoTesto = new Intl.Collator('it', { numeric: true, sensitivity: 'base' });

/** Il valore su cui ordinare: numero, data ISO o booleano dal grezzo, se no il testo. */
const chiave = (c: CellaFoto | undefined): number | string | null => {
  if (!c) return null;
  const v = c.v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  // Date e ore arrivano ISO (yyyy-MM-dd...): in ordine alfabetico sono gia' in ordine.
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}|^\d{2}:\d{2}:\d{2}$/.test(v)) return v;
  const t = (c.t ?? '').trim();
  return t === '' ? null : t;
};

/**
 * Le righe ordinate sulla colonna `colonna` (indice nelle celle), come le ordinava la
 * griglia. Stabile; le celle vuote in fondo in tutti e due i versi. Un indice fuori
 * dalle celle lascia l'ordine com'e'. Sempre un array nuovo.
 */
export function ordinaRighe<R extends { c?: readonly CellaFoto[] }>(
  righe: readonly R[],
  colonna: number | null | undefined,
  verso: 'asc' | 'desc' | null | undefined,
): R[] {
  if (colonna === null || colonna === undefined || !Number.isInteger(colonna) || colonna < 0
      || (verso !== 'asc' && verso !== 'desc'))
    return righe.slice();
  const segno = verso === 'desc' ? -1 : 1;
  return righe
    .map((r, i) => ({ r, i, k: chiave(r.c?.[colonna]) }))
    .sort((a, b) => {
      if (a.k === null || b.k === null) {
        if (a.k === b.k) return a.i - b.i;
        return a.k === null ? 1 : -1;
      }
      let d: number;
      if (typeof a.k === 'number' && typeof b.k === 'number') d = a.k - b.k;
      else d = confrontoTesto.compare(String(a.k), String(b.k));
      return d !== 0 ? d * segno : a.i - b.i;
    })
    .map((x) => x.r);
}

type LettoreOrdinamento = () => OrdinamentoLocale | null;
const lettoriOrdinamento = new Map<string, LettoreOrdinamento>();

/** Come `registraOrdineColonne`, per l'ordinamento locale della griglia. */
export function registraOrdinamentoLocale(sid: string, leggi: LettoreOrdinamento): () => void {
  lettoriOrdinamento.set(sid, leggi);
  return () => {
    if (lettoriOrdinamento.get(sid) === leggi) lettoriOrdinamento.delete(sid);
  };
}

/** L'ordinamento locale della lista a video nella scheda, o null. */
export function leggiOrdinamentoLocale(sid: string): OrdinamentoLocale | null {
  const leggi = lettoriOrdinamento.get(sid);
  if (!leggi) return null;
  try {
    return leggi();
  } catch {
    return null;
  }
}
