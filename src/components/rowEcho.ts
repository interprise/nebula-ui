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
  if (BOOLEAN_TYPES.has(type)) return undefined;
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

/** La riga di AG Grid con l'eco applicata alle colonne con lo stesso nome di
 *  controllo. Stesso oggetto se non cambia niente; mai modificato sul posto. */
export function applyRowEcho(
  data: Record<string, unknown>,
  echo: RowEcho,
  columns: readonly ListColumn[] | undefined,
): Record<string, unknown> {
  if (!columns || data._isContinuationRow || data._isBreakRow) return data;
  let out: Record<string, unknown> | null = null;
  columns.forEach((col, i) => {
    const name = col?.control?.name;
    if (!name || !Object.prototype.hasOwnProperty.call(echo, name)) return;
    const text = (col.control?.type ?? '').toLowerCase() === 'html' ? escapeHtml(echo[name].text) : echo[name].text;
    const colKey = `col_${i}`;
    const displayKey = `_display_${i}`;
    const hasDisplay = Object.prototype.hasOwnProperty.call(data, displayKey);
    if (data[colKey] === text && (!hasDisplay || data[displayKey] === text)) return;
    out ??= { ...data };
    out[colKey] = text;
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
