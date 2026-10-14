/**
 * SXADV-6001 .1ab .2 .3 .6 · la tabella del widget come la vuole chi guarda: ordine,
 * colonne nascoste, ordinamento e larghezze (contratto
 * docs/sxadv-62-prove/COLONNE_contratto.md). La vista sta sull'elemento della Home di chi
 * guarda; il server la normalizza con le stesse regole (VistaTabella.java), qui servono
 * per applicare subito a schermo una scelta prima che torni la risposta.
 *
 * Tutti gli indici sono indici in `colonne` del widget, quindi nelle celle delle righe.
 */

export interface Ordinamento {
  /** null = nessun ordinamento: l'ordine della ricerca. */
  colonna: number | null;
  verso?: 'asc' | 'desc';
}

export interface VistaTabella {
  ordineColonne?: number[];
  nascoste?: number[];
  ordinamento?: Ordinamento;
  larghezze?: Record<string, number>;
}

export const LARGHEZZA_MINIMA = 40;
export const LARGHEZZA_MASSIMA = 800;

const intero = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : null;

/** Gli indici interi in [0, n), senza doppioni, nell'ordine dato. */
function indiciBuoni(a: unknown, n: number): number[] {
  if (!Array.isArray(a)) return [];
  const visti = new Set<number>();
  for (const v of a) {
    const k = intero(v);
    if (k !== null && k >= 0 && k < n) visti.add(k);
  }
  return [...visti];
}

/**
 * V2: gli indici buoni di `ordine` nell'ordine dato, poi i mancanti in ordine crescente.
 * Senza indici buoni si parte da `riserva` (l'ordine di 6001.0).
 */
export function completaOrdine(ordine: unknown, n: number, riserva?: unknown): number[] {
  if (!Number.isInteger(n) || n <= 0) return [];
  let buoni = indiciBuoni(ordine, n);
  if (buoni.length === 0) buoni = indiciBuoni(riserva, n);
  const presenti = new Set(buoni);
  for (let i = 0; i < n; i++) if (!presenti.has(i)) buoni.push(i);
  return buoni;
}

/** px interi in 40..800; null se non e' un numero finito. */
export function larghezzaValida(px: unknown): number | null {
  if (typeof px !== 'number' || !Number.isFinite(px)) return null;
  return Math.max(LARGHEZZA_MINIMA, Math.min(LARGHEZZA_MASSIMA, Math.round(px)));
}

/** V2 per intero; null se non resta niente. Le chiavi vuote non si scrivono. */
export function normalizzaVista(vista: unknown, n: number): VistaTabella | null {
  if (!vista || typeof vista !== 'object' || Array.isArray(vista)) return null;
  if (!Number.isInteger(n) || n <= 0) return null;
  const v = vista as Record<string, unknown>;
  const o: VistaTabella = {};

  if (Array.isArray(v.ordineColonne)) {
    const completo = completaOrdine(v.ordineColonne, n);
    const identico = completo.every((k, i) => k === i);
    if (indiciBuoni(v.ordineColonne, n).length > 0 || !identico) o.ordineColonne = completo;
  }

  const nascoste = indiciBuoni(v.nascoste, n);
  // Almeno una colonna resta: nasconderle tutte vuol dire non nasconderne nessuna.
  if (nascoste.length > 0 && nascoste.length < n) o.nascoste = nascoste.sort((a, b) => a - b);

  const s = v.ordinamento;
  if (s && typeof s === 'object' && !Array.isArray(s)) {
    const so = s as Record<string, unknown>;
    if ('colonna' in so && so.colonna === null) o.ordinamento = { colonna: null };
    else {
      const c = intero(so.colonna);
      if (c !== null && c >= 0 && c < n && (so.verso === 'asc' || so.verso === 'desc'))
        o.ordinamento = { colonna: c, verso: so.verso };
    }
  }

  const l = v.larghezze;
  if (l && typeof l === 'object' && !Array.isArray(l)) {
    const buone: Record<string, number> = {};
    for (const [chiave, px] of Object.entries(l as Record<string, unknown>)) {
      if (!/^\d{1,9}$/.test(chiave)) continue;
      const i = Number(chiave);
      const w = larghezzaValida(px);
      if (i < n && w !== null) buone[String(i)] = w;
    }
    if (Object.keys(buone).length > 0) o.larghezze = buone;
  }
  return Object.keys(o).length > 0 ? o : null;
}

/** Gli indici a schermo: ordine completato meno le nascoste (almeno una resta). */
export function colonneMostrate(
  vista: VistaTabella | null | undefined,
  n: number,
  ordineIniziale?: unknown,
): number[] {
  const v = normalizzaVista(vista, n);
  const ordine = completaOrdine(v?.ordineColonne, n, ordineIniziale);
  const nascoste = new Set(v?.nascoste || []);
  return ordine.filter((i) => !nascoste.has(i));
}

/**
 * Il giro del clic sull'intestazione `colonna`: asc → desc → nessuno (l'ordine della
 * ricerca) → asc. Un'altra colonna ordinata riparte da asc.
 */
export function prossimoOrdinamento(
  attuale: Ordinamento | null | undefined,
  colonna: number,
): Ordinamento {
  if (attuale && attuale.colonna === colonna) {
    if (attuale.verso === 'asc') return { colonna, verso: 'desc' };
    if (attuale.verso === 'desc') return { colonna: null };
  }
  return { colonna, verso: 'asc' };
}

/**
 * Sposta a schermo: la colonna `da` prende il posto della colonna `su` (indici in
 * colonne); le altre scorrono. Un indice che non sta in `ordine` lascia tutto com'e'.
 */
export function spostaColonna(ordine: number[], da: number, su: number): number[] {
  const i = ordine.indexOf(da);
  const j = ordine.indexOf(su);
  if (i < 0 || j < 0 || i === j) return ordine.slice();
  const o = ordine.slice();
  o.splice(i, 1);
  o.splice(j, 0, da);
  return o;
}

/** L'ordinamento che vale: quello della vista se l'ha scelto, se no quello di 6001.0. */
export function ordinamentoEffettivo(
  vista: VistaTabella | null | undefined,
  ordinamentoLocale: Ordinamento | null | undefined,
): Ordinamento | null {
  if (vista?.ordinamento) return vista.ordinamento.colonna === null ? null : vista.ordinamento;
  return ordinamentoLocale || null;
}
