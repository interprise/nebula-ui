/**
 * SXADV-6105: le date mobili di un widget, dalla parte del client: le voci, il testo
 * che si legge sul filtro, e che giorno vale oggi una scelta (solo da mostrare).
 */

/** Un criterio data della ricerca, come lo descrive il server (SorgenteWidget.criteriData). */
export interface CriterioData {
  chiave: string;
  /** Il nome del campo, lo stesso dei filtri: abbina la data al suo filtro. */
  campo?: string;
  etichetta: string;
  /** La data battuta nella ricerca. */
  valore: string;
  modoProposto?: string;
  /** Che giorno vale adesso ogni modo mobile, piu' `oggiIso` (DateMobili.valoriOggi). */
  oggiVale?: Record<string, string>;
}

export interface SceltaData {
  modo: string;
  giorni: number;
}

/**
 * Come si muove una data del widget. Le voci sono quelle di DateMobili, lato server, e
 * le parole sono le stesse che DateMobili.etichetta scrive sui filtri del widget nella
 * Home (SXADV-6105.2): tutte riferite a «oggi», che e' il giorno di ogni aggiornamento.
 */
export const MODI_DATA = [
  { value: 'fissa', label: 'sempre la stessa data' },
  { value: 'oggi', label: 'oggi' },
  { value: 'ieri', label: 'ieri' },
  { value: 'inizioMese', label: 'il primo del mese in corso' },
  { value: 'fineMesePrecedente', label: "l'ultimo giorno del mese scorso" },
  { value: 'inizioAnno', label: "il primo gennaio dell'anno in corso" },
  { value: 'oggiMenoGiorni', label: 'oggi meno N giorni' },
];

/** Il testo del modo come si legge sul filtro: «oggi meno 30 giorni», non «N». */
export const testoDelModo = (s: SceltaData): string => {
  if (s.modo === 'oggiMenoGiorni') return `oggi meno ${s.giorni} ${s.giorni === 1 ? 'giorno' : 'giorni'}`;
  return MODI_DATA.find((m) => m.value === s.modo)?.label || s.modo;
};

/** `oggiIso` meno N giorni, gg/mm/aaaa. Solo da mostrare: il conto vero e' del server. */
const menoGiorni = (iso: string | undefined, giorni: number): string | null => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - giorni));
  const due = (n: number) => String(n).padStart(2, '0');
  return `${due(d.getUTCDate())}/${due(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};

/** Che giorno vale oggi la scelta, se si sa. */
export const valeOggi = (c: CriterioData, s: SceltaData): string | null => {
  if (s.modo === 'oggiMenoGiorni') return menoGiorni(c.oggiVale?.oggiIso, s.giorni);
  return c.oggiVale?.[s.modo] || null;
};
