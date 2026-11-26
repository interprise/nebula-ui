// L'eco nella griglia di quello che si scrive nel pannello di riga (SXADV-6048):
// la riga in gestione mostra subito i valori digitati, senza aspettare il
// server. I campi che calcola il server (Saldo contabile) si aggiornano solo
// alla risposta.
// Contratto: docs/features/20261008_SXADV-6048_riga_attiva.md

import type { ListColumn } from '../types/ui';
import type { FieldCaption } from '../controls/types';

/** Testo da mostrare nella riga per un campo del pannello, con il nome a filo
 *  del campo (serve a sapere se e' ancora non spedito). */
export interface EchoEntry { wire: string; text: string }
/** Eco della riga in gestione: nome NUDO del controllo -> voce. */
export type RowEcho = Record<string, EchoEntry>;

/** `descrizione.S1-9` -> `descrizione`: il nome con cui la colonna della lista
 *  conosce lo stesso campo. */
export function bareFieldName(wireName: string, vsId: string): string {
  if (!vsId) return wireName;
  const suffix = '.' + vsId;
  return wireName.endsWith(suffix)
    ? wireName.slice(0, -suffix.length)
    : wireName;
}

/** Il simbolo di valuta arriva come entita' HTML (`&#x20AC;`). Decodifica
 *  senza DOM: la funzione resta pura e provabile fuori dal browser. */
const NAMED_ENTITIES: Record<string, string> = { euro: '€', dollar: '$', pound: '£', yen: '¥', amp: '&', nbsp: '\u00a0' };
function decodeSymbol(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** `1234,5` -> `1.234,5`: il campo scrive l'importo in italiano ma senza
 *  separatore delle migliaia sotto le cinque cifre, la lista lo mette sempre.
 *  Si tocca solo la parte intera di un numero senza punti; i decimali restano
 *  quelli scritti (al ridisegno del server diventano quelli della colonna). */
function groupThousands(s: string): string {
  const m = /^(-?)(\d+)(,\d*)?$/.exec(s);
  if (!m || m[2].length <= 3) return s;
  return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (m[3] ?? '');
}

const BOOLEAN_TYPES = new Set(['checkbox', 'boolean', 'bool']);
const CHOICE_TYPE = /combo|lookup|select/;

const YES = 'S\u00ec';
const NO = 'No';

/** Il valore di una casella come lo scrive la lista: `true` Si', `false` No,
 *  niente (tre stati, non ancora scelto) vuoto, altro (non riconosciuto) nessuna eco. */
function booleanText(value: unknown): string | undefined {
  if (value === true || value === 'true') return YES;
  if (value === false || value === 'false') return NO;
  if (value == null || value === '') return '';
  // Un valore che non so leggere: resta la cella del server.
  return undefined;
}

/** Il valore di cella di una colonna booleana per il testo dell'eco: la cella
 *  legge `true`/`false` dal valore (la casella di una multiEdit guarda
 *  `value === true`), non il testo. */
function booleanCellValue(text: string): boolean | null {
  if (text === YES) return true;
  if (text === NO) return false;
  return null;
}

/** Testo scritto dall'utente dentro una colonna resa come HTML: si mostra
 *  com'e', non come markup. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Il testo della cella per un valore appena scritto nel pannello, o
 *  `undefined` se il campo non si riflette (resta la cella del server). */
export function echoText(
  ctrl: { type?: string; currencySymbol?: string } | undefined,
  value: unknown,
  caption?: FieldCaption,
): string | undefined {
  const type = (ctrl?.type ?? '').toLowerCase();
  // Una casella si legge Si'/No, come la colonna della lista (BOOLEAN_CODE_TABLE):
  // senza eco la spunta data nel pannello non si vedeva sul rigo finche' non
  // si salvava (SXADV-6262).
  if (BOOLEAN_TYPES.has(type)) return booleanText(value);
  if (typeof caption === 'string') return caption;
  if (Array.isArray(caption)) return caption.map((c) => c.listText ?? c.text).join(', ');
  // Una scelta da elenco senza didascalia (Esc che rimette il valore di prima)
  // darebbe il codice al posto della voce: meglio la cella del server.
  if (CHOICE_TYPE.test(type) && value != null && value !== '') return undefined;
  if (value == null || value === '') return '';
  if (Array.isArray(value)) return value.map((v) => (v == null ? '' : String(v))).join(', ');
  if (type === 'money') {
    const symbol = ctrl?.currencySymbol ? decodeSymbol(String(ctrl.currencySymbol)) : '';
    return `${groupThousands(String(value))} ${symbol || '€'}`;
  }
  return String(value);
}

/** Prefisso del campo che porta, nella riga principale in modalita' una-riga,
 *  il nome del controllo di una cella di banda promossa a colonna. */
export const CONT_NAME_PREFIX = '_contname_';

/** Le celle di una banda di continuazione col nome del loro controllo
 *  (SXADV-6294). Nei dati di lista le celle non lo portano: lo portano le
 *  etichette della banda (`ui.continuationHeaders[banda]`), allineate alle
 *  celle per UNITA' di colonna (colspan cumulativo, da 0). Una cella prende il
 *  nome dell'etichetta che comincia nella sua stessa unita'. */
export function nameContinuationCells<T extends { colspan?: number; text?: string; html?: string; control?: unknown }>(
  cells: T[],
  headers: ReadonlyArray<{ colspan?: number; control?: string }> | undefined,
): Array<T & { name?: string }> {
  if (!headers || headers.length === 0) return cells.map((c) => ({ ...c }));
  const byUnit = new Map<number, string>();
  let u = 0;
  for (const h of headers) {
    if (h.control) byUnit.set(u, h.control);
    u += h.colspan || 1;
  }
  let unit = 0;
  return cells.map((c) => {
    const name = byUnit.get(unit);
    unit += c.colspan || 1;
    return name ? { ...c, name } : { ...c };
  });
}

type EchoCell = { name?: string; text?: string; html?: string; control?: unknown };

/** La banda di continuazione con l'eco sulle celle che hanno un nome nell'eco.
 *  I controlli personalizzati (cella con `control`) restano dei loro. */
function applyContinuationEcho(data: Record<string, unknown>, echo: RowEcho): Record<string, unknown> {
  const cells = data._continuationCells as EchoCell[] | undefined;
  if (!Array.isArray(cells)) return data;
  let next: EchoCell[] | null = null;
  cells.forEach((cell, i) => {
    const name = cell?.name;
    if (!name || cell.control || !Object.prototype.hasOwnProperty.call(echo, name)) return;
    const text = echo[name].text;
    if (cell.text === text && cell.html === undefined) return;
    next ??= cells.slice();
    const { html: _html, ...rest } = cell;
    void _html;
    next[i] = { ...rest, text };
  });
  return next ? { ...data, _continuationCells: next } : data;
}

/** La riga di AG Grid con l'eco applicata alle colonne con lo stesso nome di
 *  controllo; per una banda di continuazione, alle sue celle (SXADV-6294).
 *  Stesso oggetto se non cambia niente; mai modificato sul posto. */
export function applyRowEcho(
  data: Record<string, unknown>,
  echo: RowEcho,
  columns: readonly ListColumn[] | undefined,
): Record<string, unknown> {
  if (data._isBreakRow || data._isTotalsRow) return data;
  if (data._isContinuationRow) return applyContinuationEcho(data, echo);
  let out: Record<string, unknown> | null = null;
  // Una-riga: le celle delle bande sono colonne `cont_<banda>_<unita'>` della
  // riga principale, col nome del controllo in `_contname_<campo>` (SXADV-6294).
  for (const key of Object.keys(data)) {
    if (!key.startsWith(CONT_NAME_PREFIX)) continue;
    const name = data[key];
    if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(echo, name)) continue;
    const field = key.slice(CONT_NAME_PREFIX.length);
    const text = echo[name].text;
    // La colonna promossa si disegna da `_contcell_<campo>` (FlatContinuationRenderer):
    // il solo campo piatto (ordinamento, copia) a schermo non si vedeva.
    const cellKey = `_contcell_${field}`;
    const cell = data[cellKey] as EchoCell | undefined;
    if (cell?.control) continue;
    if (data[field] === text && cell?.text === text && cell.html === undefined) continue;
    out ??= { ...data };
    out[field] = text;
    const { html: _html, ...rest } = cell ?? {};
    void _html;
    out[cellKey] = { ...rest, text };
  }
  if (!columns) return out ?? data;
  columns.forEach((col, i) => {
    const name = col?.control?.name;
    if (!name || !Object.prototype.hasOwnProperty.call(echo, name)) return;
    const colType = (col.control?.type ?? '').toLowerCase();
    const text = colType === 'html' ? escapeHtml(echo[name].text) : echo[name].text;
    const cellValue: unknown = BOOLEAN_TYPES.has(colType) ? booleanCellValue(text) : text;
    const colKey = `col_${i}`;
    const displayKey = `_display_${i}`;
    const hasDisplay = Object.prototype.hasOwnProperty.call(data, displayKey);
    if (data[colKey] === cellValue && (!hasDisplay || data[displayKey] === text)) return;
    out ??= { ...data };
    out[colKey] = cellValue;
    if (hasDisplay) out[displayKey] = text;
  });
  return out ?? data;
}

/** All'arrivo di righe nuove: restano solo le voci non ancora spedite. */
export function pruneEcho(echo: RowEcho, isDirty: (wire: string) => boolean): RowEcho | null {
  const keep = Object.entries(echo).filter(([, e]) => isDirty(e.wire) === true);
  if (keep.length === 0) return null;
  if (keep.length === Object.keys(echo).length) return echo;
  return Object.fromEntries(keep);
}
