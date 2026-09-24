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
  delta?: number | string | null;
  altri?: { valore?: number | string | null; righe?: number; gruppi?: number } | null;
  gruppiTotali?: number;
  righeLette?: number;
  completo?: boolean;
  errore?: string | null;
  via?: string;
  /** La trasformazione e' cambiata dopo l'ultimo aggiornamento: ricalcolata al volo. */
  provvisorio?: boolean;
}

export interface Trasformazione {
  group?: string[];
  agg?: string;
  col?: string;
  having?: { op?: string; value?: number | string } | null;
  outAgg?: string;
  topN?: number;
  resto?: string;
}

export interface Opzioni {
  /** Il numero che sale e' una buona notizia o da tenere d'occhio. */
  sale?: 'bene' | 'male';
}

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
