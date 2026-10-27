/**
 * Somma e Media sulle colonne delle liste (SXADV-5490).
 *
 * Il server decide tutto — quali colonne li hanno, se si possono calcolare, i
 * numeri già formattati (CORE ListTotals.describe); qui si traduce `totals` nel
 * testo delle celle della riga fissata in fondo alla griglia.
 * Contratto: CORE/docs/20261027_SXADV-5490_totali_di_colonna.md, §6.
 */
import type { ListColumn, ListColumnTotals, ListTotals } from '../types/ui';

export const TOTALS_LABEL = 'Totale';
export const MIXED_CURRENCIES_TEXT = 'valute diverse';
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
  if (col.mixedCurrencies) return { text: MIXED_CURRENCIES_TEXT };
  const lines: string[] = [];
  if (col.active.includes('sum')) lines.push(`${SUM_PREFIX} ${col.sum ?? ''}`.trimEnd());
  if (col.active.includes('avg')) lines.push(`${AVG_PREFIX} ${col.avg ?? ''}`.trimEnd());
  return { text: lines.join('\n') };
}

/** Quante righe di testo porta la riga totali (per l'altezza). */
export function totalsRowLines(totals: ListTotals | undefined): number {
  if (!totals?.columns) return 1;
  let n = 1;
  for (const c of Object.values(totals.columns)) {
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
