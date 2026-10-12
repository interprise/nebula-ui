/**
 * SXADV-62 · il risultato della trasformazione di un widget, come lo manda il server
 * (G9_contratto.md). Il client lo DISEGNA e basta: numero, gruppi, ordine e delta
 * arrivano gia' calcolati, e qui non si somma, non si riordina e non si confronta
 * niente. Due calcoli dello stesso numero, uno in Java e uno qui, prima o poi
 * divergerebbero senza che nessuno se ne accorga, perche' tutti e due resterebbero
 * plausibili.
 */
export interface Gruppo {
  k?: string;
  etichetta?: string;
  valore?: number | string | null;
  righe?: number;
}

export interface Risultato {
  gruppi?: Gruppo[];
  numero?: number | string | null;
  /**
   * La somma dei valori di TUTTI i gruppi superstiti, anche quelli in «altri» (SXADV-6013).
   * Solo con un raggruppamento e con conteggio o somma; altrimenti null.
   */
  totale?: number | string | null;
  delta?: number | string | null;
  altri?: { valore?: number | string | null; righe?: number; gruppi?: number } | null;
  gruppiTotali?: number;
  righeLette?: number;
  completo?: boolean;
  errore?: string | null;
  via?: string;
  /** La trasformazione e' cambiata dopo l'ultimo aggiornamento: ricalcolata al volo. */
  provvisorio?: boolean;
  /**
   * I gruppi tolti dal calcolo (SALESCENDE E4), nell'ordine della trasformazione;
   * `etichetta` null quando quel gruppo oggi nei dati non c'e'.
   */
  esclusi?: { k?: string; etichetta?: string | null; righe?: number }[];
}

export interface Trasformazione {
  group?: string[];
  agg?: string;
  col?: string;
  having?: { op?: string; value?: number | string } | null;
  outAgg?: string;
  topN?: number;
  resto?: string;
  /** Le CHIAVI (`k`) dei gruppi da togliere dal calcolo, non i testi (SALESCENDE E1). */
  escludi?: string[];
}

/** Che notizia e' un numero che sale o scende (SALESCENDE S1). */
export type Tono = 'bene' | 'attenzione' | 'neutro';

export interface Opzioni {
  /**
   * Il numero che sale e' una buona notizia, da tenere d'occhio o indifferente;
   * `male` e' il nome di prima di `attenzione`.
   */
  sale?: Tono | 'male' | '';
  /** Lo stesso per la discesa; assente = l'opposto di `sale`. */
  scende?: Tono | 'male' | '';
  /** La vista che apre il clic su una riga (SXADV-62, 27/09); assente = quella della lista. */
  vistaDettaglio?: string;
  /** Da quali aziende vengono i risultati (SXADV-6000); assente = l'azienda corrente. */
  aziende?: { modo?: 'corrente' | 'scelte' | 'tutte'; codici?: string[] };
}

const tono = (v: unknown): Tono | null =>
  v === 'bene' || v === 'attenzione' || v === 'neutro' ? v : v === 'male' ? 'attenzione' : null;

const opposto = (t: Tono): Tono => (t === 'bene' ? 'attenzione' : t === 'attenzione' ? 'bene' : 'neutro');

/**
 * Sale e scende risolti (SALESCENDE S2): `sale` assente e' neutro, come la Home li ha
 * sempre mostrati; `scende` assente e' l'opposto di `sale`. Cosi' i widget salvati prima
 * non cambiano aspetto.
 */
export const toniDi = (o: Opzioni | null | undefined): { sale: Tono; scende: Tono } => {
  const sale = tono(o?.sale) ?? 'neutro';
  return { sale, scende: tono(o?.scende) ?? opposto(sale) };
};

export const oppostoDi = opposto;

/** Il tono di un delta: sale se positivo, scende se negativo, neutro se nullo o zero. */
export const tonoDelta = (d: number | null, o: Opzioni | null | undefined): Tono => {
  if (d === null || d === 0) return 'neutro';
  const t = toniDi(o);
  return d > 0 ? t.sale : t.scende;
};

/** Raggruppamento sempre, anche a quattro cifre: vedi NUMERO in DashboardPanel. */
const formato = (decimali: number) => {
  const base = { minimumFractionDigits: decimali, maximumFractionDigits: decimali };
  try {
    return new Intl.NumberFormat('it-IT', {
      ...base,
      useGrouping: 'always',
    } as unknown as Intl.NumberFormatOptions);
  } catch {
    return new Intl.NumberFormat('it-IT', base);
  }
};
const INTERO = formato(0);
const DECIMALE = formato(2);

/** Il server manda i BigDecimal come numeri JSON, ma un testo non deve rompere niente. */
export const aNumero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Conteggi senza decimali, somme e medie con due. «Quanti» si riconosce dalla
 * trasformazione, non dal valore: una somma che per caso viene tonda resta una somma.
 */
export const conteggio = (t: Trasformazione | null | undefined, perGruppo: boolean) => {
  if (!t) return false;
  if (perGruppo) return (t.agg || 'count') === 'count';
  const raggruppata = (t.group || []).length > 0;
  if (raggruppata) {
    const out = t.outAgg || 'count';
    if (out === 'count') return true;
    if (out === 'avg') return false;
    return (t.agg || 'count') === 'count';
  }
  return (t.agg || 'count') === 'count';
};

export const scrivi = (v: unknown, intero: boolean) => {
  const n = aNumero(v);
  if (n === null) return '—';
  // Il meno tipografico: «−1.234,50» si legge meglio del trattino.
  return (intero ? INTERO : DECIMALE).format(n).replace(/^-/, '−');
};

export const conSegno = (v: number, intero: boolean) =>
  v > 0 ? `+${scrivi(v, intero)}` : scrivi(v, intero);

/** Il widget mostra un risultato al posto della lista? */
export const mostraRisultato = (forma: string | undefined, r: Risultato | null | undefined) =>
  !!r && !r.errore && (forma === 'kpi' || forma === 'bar');
