import { describe, it, expect } from 'vitest';
import type { ListColumn } from '../types/ui';
import { totalsCellText, buildTotalsRow, hasActiveTotals } from './listTotals';

// SXADV-5490 — Somma e Media sulle colonne delle liste: le funzioni pure del
// client (contratto CORE/docs/20261027_SXADV-5490_totali_di_colonna.md §5, §6).
//
//   totalsCellText(col) -> { text, title? } | null
//     - colonna assente o senza aggregati attivi: null;
//     - `Σ <sum>` e/o `⌀ <avg>`, su due righe se entrambi;
//     - mixedCurrencies: «valute diverse»;
//     - available=false (con aggregati attivi): «—» con title = reason;
//     - error: «—» con title = error.
//   buildTotalsRow(totals, columns) -> riga per pinnedBottomRowData | null
//     - chiavi col_<idx>, l'indice e' quello di columns, il legame e' per nome
//       (columns[idx].control.name = chiave di totals.columns);
//     - null se nessuna colonna e' attiva;
//     - «Totale» nella prima colonna senza totali.
//   hasActiveTotals(totals) -> almeno una colonna con active non vuoto.
//
// Il tipo del VALORE in col_<idx> il contratto non lo dice (testo? l'oggetto
// {text,title}?): qui si accettano entrambi, si legge il testo con cellText().

// I tipi del contratto, scritti qui per non dipendere da dove l'implementazione
// li dichiara (types/ui.ts o listTotals.ts).
interface ColTotals {
  available: boolean;
  active: ('sum' | 'avg')[];
  sum?: string;
  avg?: string;
  mixedCurrencies?: boolean;
  reason?: string;
  error?: string;
}
interface Totals {
  command: string;
  path: string;
  scope?: 'page' | 'query';
  rows?: number;
  columns: Record<string, ColTotals>;
}

type CellFn = (c: ColTotals | undefined) => { text: string; title?: string } | null;
type RowFn = (t: Totals | undefined, c: ListColumn[] | undefined) => Record<string, unknown> | null;
type HasFn = (t: Totals | undefined) => boolean;
const cell = totalsCellText as unknown as CellFn;
const row = buildTotalsRow as unknown as RowFn;
const has = hasActiveTotals as unknown as HasFn;

const MSG_SOLO_PAGINA = 'Il totale di questa colonna si calcola solo quando la ricerca sta in una pagina: '
  + 'restringi i filtri, oppure esporta in Excel, dove il totale c\'è.';

const lines = (t: string) => t.split(/\r?\n/);

/** Il testo di una cella della riga totali, qualunque forma abbia il valore. */
function cellText(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && typeof (v as { text?: unknown }).text === 'string') return (v as { text: string }).text;
  return String(v);
}
/** Dove sta il suggerimento: nel valore-oggetto, o in una chiave a parte della riga. */
function cellTitle(r: Record<string, unknown>, key: string): string | undefined {
  const v = r[key];
  if (v && typeof v === 'object' && typeof (v as { title?: unknown }).title === 'string') return (v as { title: string }).title;
  // Ripiego: qualunque stringa della riga che sia il suggerimento atteso lo
  // contiene; chi chiama confronta con toContain sul JSON della riga.
  return undefined;
}

function col(name: string | undefined, type = 'number'): ListColumn {
  return (name == null
    ? { elementType: 5 }
    : { elementType: 1, control: { name, id: name, type } }) as unknown as ListColumn;
}
function totals(columns: Record<string, ColTotals>, extra: Partial<Totals> = {}): Totals {
  return { command: 'ListTotals', path: 'S1-0', columns, ...extra };
}

describe('totalsCellText (SXADV-5490)', () => {
  it('colonna assente: null', () => {
    expect(cell(undefined)).toBeNull();
  });

  it('nessun aggregato attivo: null', () => {
    expect(cell({ available: true, active: [] })).toBeNull();
  });

  it('non disponibile ma nemmeno attiva: null (nessuna cella da scrivere)', () => {
    expect(cell({ available: false, reason: MSG_SOLO_PAGINA, active: [] })).toBeNull();
  });

  it('solo somma: «Σ <sum>», senza title', () => {
    const r = cell({ available: true, active: ['sum'], sum: '1.234,56 €' });
    expect(r).not.toBeNull();
    expect(r!.text).toBe('Σ 1.234,56 €');
    expect(r!.title).toBeUndefined();
  });

  it('solo media: «⌀ <avg>»', () => {
    const r = cell({ available: true, active: ['avg'], avg: '68,59 €' });
    expect(r!.text).toBe('⌀ 68,59 €');
  });

  it('entrambi: due righe, prima la somma poi la media', () => {
    const r = cell({ available: true, active: ['sum', 'avg'], sum: '1.234,56 €', avg: '68,59 €' });
    expect(lines(r!.text)).toEqual(['Σ 1.234,56 €', '⌀ 68,59 €']);
  });

  it('entrambi, active in ordine avg, sum: sempre prima Σ', () => {
    const r = cell({ available: true, active: ['avg', 'sum'], sum: '10', avg: '5' });
    expect(lines(r!.text)).toEqual(['Σ 10', '⌀ 5']);
  });

  it('il testo del server si scrive com\'e\' (niente riformattazione)', () => {
    const r = cell({ available: true, active: ['sum'], sum: '-0,50' });
    expect(r!.text).toBe('Σ -0,50');
  });

  it('somma attiva ma un aggregato non attivo presente per errore: si mostra solo l\'attivo', () => {
    const r = cell({ available: true, active: ['sum'], sum: '10', avg: '5' });
    expect(r!.text).toBe('Σ 10');
  });

  it('attivi entrambi, nessun valore presente (sum/avg assenti): niente numero, niente «—»', () => {
    // Regola 6: nessun valore presente = cella vuota, non zero. Il contratto non
    // dice se vuota = null o testo vuoto: si accettano entrambi.
    const r = cell({ available: true, active: ['sum', 'avg'] });
    if (r !== null) {
      expect(r.text.replace(/[Σ⌀\s]/g, '')).toBe('');
      expect(r.text).not.toContain('—');
      expect(r.text).not.toContain('0');
    }
  });

  it('attivi entrambi, solo la somma presente: la media non compare con un numero', () => {
    const r = cell({ available: true, active: ['sum', 'avg'], sum: '10' });
    expect(r!.text.trim().startsWith('Σ 10')).toBe(true);
    expect(r!.text).not.toMatch(/⌀\s*\S/);
  });

  it('mixedCurrencies: «valute diverse»', () => {
    const r = cell({ available: true, active: ['sum'], mixedCurrencies: true });
    expect(r!.text).toBe('valute diverse');
  });

  it('mixedCurrencies con entrambi attivi: una volta sola «valute diverse»', () => {
    const r = cell({ available: true, active: ['sum', 'avg'], mixedCurrencies: true });
    expect(r!.text).toBe('valute diverse');
  });

  it('non disponibile con aggregato attivo: «—» con title = reason', () => {
    const r = cell({ available: false, reason: MSG_SOLO_PAGINA, active: ['sum'] });
    expect(r!.text).toBe('—');
    expect(r!.title).toBe(MSG_SOLO_PAGINA);
  });

  it('errore della query: «—» con title = error', () => {
    const r = cell({ available: true, active: ['sum', 'avg'], error: 'Timeout della query' });
    expect(r!.text).toBe('—');
    expect(r!.title).toBe('Timeout della query');
  });

  it('errore con valori residui: vince l\'errore', () => {
    const r = cell({ available: true, active: ['sum'], sum: '10', error: 'boom' });
    expect(r!.text).toBe('—');
    expect(r!.title).toBe('boom');
  });
});

describe('hasActiveTotals (SXADV-5490)', () => {
  it('undefined: false', () => {
    expect(has(undefined)).toBe(false);
  });
  it('nessuna colonna: false', () => {
    expect(has(totals({}))).toBe(false);
  });
  it('colonne tutte con active vuoto: false', () => {
    expect(has(totals({
      a: { available: true, active: [] },
      b: { available: false, reason: MSG_SOLO_PAGINA, active: [] },
    }))).toBe(false);
  });
  it('una colonna attiva: true', () => {
    expect(has(totals({
      a: { available: true, active: [] },
      b: { available: true, active: ['avg'], avg: '1' },
    }))).toBe(true);
  });
  it('attiva ma non disponibile: true (la riga serve, per il «—»)', () => {
    expect(has(totals({ a: { available: false, reason: MSG_SOLO_PAGINA, active: ['sum'] } }))).toBe(true);
  });
});

describe('buildTotalsRow (SXADV-5490)', () => {
  const columns = [col('descrizione', 'text'), col('quantita', 'number'), col('importo', 'money')];

  it('totals undefined: null', () => {
    expect(row(undefined, columns)).toBeNull();
  });

  it('nessuna colonna attiva: null', () => {
    expect(row(totals({
      quantita: { available: true, active: [] },
      importo: { available: true, active: [] },
    }), columns)).toBeNull();
  });

  it('chiave col_<idx> trovata per nome, non per posizione nella mappa', () => {
    // importo prima di quantita nella mappa, ma e' la colonna 2.
    const r = row(totals({
      importo: { available: true, active: ['sum'], sum: '10,00 €' },
      quantita: { available: true, active: ['avg'], avg: '2,5' },
    }), columns);
    expect(r).not.toBeNull();
    expect(cellText(r!.col_2)).toBe('Σ 10,00 €');
    expect(cellText(r!.col_1)).toBe('⌀ 2,5');
  });

  it('«Totale» nella prima colonna senza totali', () => {
    const r = row(totals({ importo: { available: true, active: ['sum'], sum: '10' } }), columns);
    expect(cellText(r!.col_0)).toBe('Totale');
  });

  it('colonna totalizzabile ma non attiva: nessun testo di totale', () => {
    const r = row(totals({
      quantita: { available: true, active: [] },
      importo: { available: true, active: ['sum'], sum: '10' },
    }), columns);
    const t = cellText(r!.col_1);
    expect(t === undefined || t === '' || t === 'Totale').toBe(true);
    expect(t ?? '').not.toContain('Σ');
  });

  it('«Totale» una volta sola', () => {
    const many = [col('codice', 'text'), col('descrizione', 'text'), col('importo', 'money')];
    const r = row(totals({ importo: { available: true, active: ['sum'], sum: '10' } }), many);
    const labels = Object.keys(r!).filter((k) => /^col_\d+$/.test(k) && cellText(r![k]) === 'Totale');
    expect(labels).toEqual(['col_0']);
  });

  it('la prima colonna ha i totali: «Totale» va sulla prima che non li ha', () => {
    const cols = [col('importo', 'money'), col('descrizione', 'text'), col('note', 'text')];
    const r = row(totals({ importo: { available: true, active: ['sum'], sum: '10' } }), cols);
    expect(cellText(r!.col_0)).toBe('Σ 10');
    expect(cellText(r!.col_1)).toBe('Totale');
    expect(cellText(r!.col_2)).not.toBe('Totale');
  });

  it('colonna senza controllo (selettore) non intercetta i totali di nessuno', () => {
    const cols = [col(undefined), col('descrizione', 'text'), col('importo', 'money')];
    const r = row(totals({ importo: { available: true, active: ['sum'], sum: '10' } }), cols);
    expect(cellText(r!.col_2)).toBe('Σ 10');
  });

  it('due aggregati sulla stessa colonna: due righe di testo', () => {
    const r = row(totals({ importo: { available: true, active: ['sum', 'avg'], sum: '10', avg: '5' } }), columns);
    expect(lines(cellText(r!.col_2)!)).toEqual(['Σ 10', '⌀ 5']);
  });

  it('valute diverse e «—» passano nella riga, col suggerimento', () => {
    const r = row(totals({
      quantita: { available: false, reason: MSG_SOLO_PAGINA, active: ['sum'] },
      importo: { available: true, active: ['sum'], mixedCurrencies: true },
    }), columns);
    expect(cellText(r!.col_2)).toBe('valute diverse');
    expect(cellText(r!.col_1)).toBe('—');
    const title = cellTitle(r!, 'col_1');
    if (title !== undefined) expect(title).toBe(MSG_SOLO_PAGINA);
    else expect(JSON.stringify(r)).toContain(MSG_SOLO_PAGINA);
  });

  it('una voce di totals che non corrisponde a nessuna colonna: ignorata, nessuna chiave inventata', () => {
    const r = row(totals({
      importo: { available: true, active: ['sum'], sum: '10' },
      sparita: { available: true, active: ['sum'], sum: '99' },
    }), columns);
    const keys = Object.keys(r!).filter((k) => /^col_\d+$/.test(k));
    for (const k of keys) expect(Number(k.slice(4))).toBeLessThan(columns.length);
    expect(JSON.stringify(r)).not.toContain('99');
  });

  it('la riga totali non porta l\'identita\' di una riga (niente navpath ne\' comando del selettore)', () => {
    const r = row(totals({ importo: { available: true, active: ['sum'], sum: '10' } }), columns);
    expect(r!._selectorPath).toBeUndefined();
    expect(r!._selectorCommand).toBeUndefined();
  });

  it('columns undefined: nessuna eccezione', () => {
    expect(() => row(totals({ importo: { available: true, active: ['sum'], sum: '10' } }), undefined)).not.toThrow();
  });
});
