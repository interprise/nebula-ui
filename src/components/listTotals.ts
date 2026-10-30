/**
 * Somma e Media sulle colonne delle liste (SXADV-5490).
 *
 * Il server decide tutto — quali colonne li hanno, se si possono calcolare, i
 * numeri già formattati (CORE ListTotals.describe); qui si traduce `totals` nel
 * testo delle celle della riga fissata in fondo alla griglia.
 * Contratto: CORE/docs/20261027_SXADV-5490_totali_di_colonna.md, §6.
 */
import type { ListColumn, ListColumnTotals, ListHeader, ListTotals } from '../types/ui';

export const TOTALS_LABEL = 'Totale';
export const SUM_PREFIX = 'Σ';
export const AVG_PREFIX = '⌀';

/** Almeno una colonna con Somma o Media accesa. */
export function hasActiveTotals(totals: ListTotals | undefined): boolean {
  if (!totals?.columns) return false;
  return Object.values(totals.columns).some((c) => (c?.active?.length ?? 0) > 0);
}

/** Il testo della cella totali di una colonna; null se lì non c'è niente di acceso. */
export function totalsCellText(col: ListColumnTotals | undefined): { text: string; title?: string } | null {
  if (!col || !col.active || col.active.length === 0) return null;
  if (!col.available) return { text: '—', title: col.reason };
  if (col.error) return { text: '—', title: col.error };
  if (col.mixed) return { text: col.mixed };
  const lines: string[] = [];
  if (col.active.includes('sum')) lines.push(`${SUM_PREFIX} ${col.sum ?? ''}`.trimEnd());
  if (col.active.includes('avg')) lines.push(`${AVG_PREFIX} ${col.avg ?? ''}`.trimEnd());
  return { text: lines.join('\n') };
}

/** Quante righe di testo porta la riga «Totale» (per l'altezza): solo le colonne della griglia. */
export function totalsRowLines(totals: ListTotals | undefined): number {
  if (!totals?.columns) return 1;
  let n = 1;
  for (const c of Object.values(totals.columns)) {
    // Gli item delle bande hanno la loro riga dei totali (§7).
    if ((c?.band ?? 0) !== 0) continue;
    const t = totalsCellText(c);
    if (t) n = Math.max(n, t.text.split('\n').length);
  }
  return n;
}

/**
 * I dati della riga fissata: `col_<idx>` come le righe normali, `_totalsTitle_<idx>`
 * per il suggerimento, `_isTotalsRow`. Null se nessuna colonna è accesa.
 * L'etichetta «Totale» va nella prima colonna di contenuto senza totali.
 */
export function buildTotalsRow(
  totals: ListTotals | undefined,
  columns: ListColumn[] | undefined,
): Record<string, unknown> | null {
  if (!hasActiveTotals(totals) || !columns) return null;
  const row: Record<string, unknown> = { _isTotalsRow: true };
  let labelled = false;
  columns.forEach((col, idx) => {
    const name = col?.control?.name;
    const t = name ? totalsCellText(totals!.columns[name]) : null;
    if (t) {
      row[`col_${idx}`] = t.text;
      if (t.title) row[`_totalsTitle_${idx}`] = t.title;
    } else if (!labelled && col?.control) {
      row[`col_${idx}`] = TOTALS_LABEL;
      labelled = true;
    }
  });
  return row;
}

/** Una banda dei totali: le celle allineate alle intestazioni della banda `band`. */
export interface TotalsBandRow {
  band: number;
  cells: Array<{ text: string; title?: string; colspan?: number }>;
}

/**
 * Le bande dei totali sotto la riga «Totale» (§7): una per banda di continuazione
 * con almeno un item acceso, in ordine di banda. Le celle seguono le intestazioni
 * della banda (stesso colspan), cosi' il valore sta sotto l'etichetta del suo item;
 * l'item si trova per `control`, la chiave di `totals.columns`.
 */
export function buildTotalsBandRows(
  totals: ListTotals | undefined,
  contHeaders: ListHeader[][] | undefined,
): TotalsBandRow[] {
  const out: TotalsBandRow[] = [];
  if (!totals?.columns || !contHeaders) return out;
  contHeaders.forEach((hdrs, band) => {
    let any = false;
    const cells = (hdrs ?? []).map((h) => {
      const t = h?.control ? totalsCellText(totals.columns[h.control]) : null;
      if (t) any = true;
      const cell: { text: string; title?: string; colspan?: number } = { text: t?.text ?? '' };
      if (t?.title) cell.title = t.title;
      if (h?.colspan) cell.colspan = h.colspan;
      return cell;
    });
    if (any) out.push({ band, cells });
  });
  return out;
}
