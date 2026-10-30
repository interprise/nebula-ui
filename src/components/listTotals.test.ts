import { describe, it, expect } from 'vitest';
import type { ListColumn } from '../types/ui';
import { totalsCellText, buildTotalsRow, hasActiveTotals } from './listTotals';
import * as LT from './listTotals';

// SXADV-5490 — Somma e Media sulle colonne delle liste: le funzioni pure del
// client (contratto CORE/docs/20261027_SXADV-5490_totali_di_colonna.md §5, §6).
//
//   totalsCellText(col) -> { text, title? } | null
//     - colonna assente o senza aggregati attivi: null;
//     - `Σ <sum>` e/o `⌀ <avg>`, su due righe se entrambi;
//     - mixed (testo del server, «valute diverse», «unità diverse»): scritto com'è;
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
  allowed?: ('sum' | 'avg')[];
  mixed?: string;
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

  it('mixed: il testo del server, «valute diverse»', () => {
    const r = cell({ available: true, allowed: ['sum', 'avg'], active: ['sum'], mixed: 'valute diverse' });
    expect(r!.text).toBe('valute diverse');
  });

  it('mixed: «unità diverse» si scrive com\'è (non si traduce in «valute diverse»)', () => {
    const r = cell({ available: true, allowed: ['sum', 'avg'], active: ['sum'], mixed: 'unità diverse' });
    expect(r!.text).toBe('unità diverse');
    expect(r!.text).not.toContain('Σ');
  });

  it('mixed: un testo qualsiasi del controllo si scrive verbatim', () => {
    const r = cell({ available: true, allowed: ['avg'], active: ['avg'], mixed: 'valori non omogenei' });
    expect(r!.text).toBe('valori non omogenei');
  });

  it('mixed con entrambi attivi: il testo una volta sola, niente Σ/⌀', () => {
    const r = cell({ available: true, allowed: ['sum', 'avg'], active: ['sum', 'avg'], mixed: 'unità diverse' });
    expect(r!.text).toBe('unità diverse');
  });

  it('mixed con valori residui per errore: vince mixed', () => {
    const r = cell({ available: true, active: ['sum'], sum: '10', mixed: 'valute diverse' });
    expect(r!.text).toBe('valute diverse');
  });

  it('la vecchia bandierina mixedCurrencies non conta più: senza mixed si scrive il numero', () => {
    const old = { available: true, active: ['sum'], sum: '10', mixedCurrencies: true } as unknown as ColTotals;
    expect(cell(old)!.text).toBe('Σ 10');
  });

  it('mixed vuoto (stringa vuota): niente testo misto, si scrive il numero', () => {
    const r = cell({ available: true, active: ['sum'], sum: '10', mixed: '' });
    expect(r!.text).toBe('Σ 10');
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
      importo: { available: true, active: ['sum'], mixed: 'valute diverse' },
    }), columns);
    expect(cellText(r!.col_2)).toBe('valute diverse');
    expect(cellText(r!.col_1)).toBe('—');
    const title = cellTitle(r!, 'col_1');
    if (title !== undefined) expect(title).toBe(MSG_SOLO_PAGINA);
    else expect(JSON.stringify(r)).toContain(MSG_SOLO_PAGINA);
  });

  it('unità diverse su una colonna quantità passa nella riga verbatim', () => {
    const r = row(totals({
      quantita: { available: true, allowed: ['sum'], active: ['sum'], mixed: 'unità diverse' },
    }), columns);
    expect(cellText(r!.col_1)).toBe('unità diverse');
    expect(cellText(r!.col_0)).toBe('Totale');
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

// --- §7: liste con tracciato su più righe (30/10) ---------------------------------------
//
//   buildTotalsBandRows(totals, contHeaders) -> Array<{ band, cells }>
//     - una voce per banda b (indice in contHeaders) con almeno un item attivo, in ordine;
//     - cells: una per intestazione della banda, colspan copiato, text = totalsCellText
//       (Σ/⌀, mixed, «—» con title) nella posizione dell'item (trovato per `control`),
//       '' altrove; title solo se presente;
//     - vuoto se niente è attivo nelle bande (anche con attivi di prima riga).
//   hasActiveTotals: vero anche se l'unico attivo è di banda.
//   buildTotalsRow: con soli attivi di banda restituisce comunque la riga, con «Totale».

interface BandHeader { text: string; name?: string; tag?: string; control?: string; colspan?: number }
interface BandRow { band: number; cells: Array<{ text: string; title?: string; colspan?: number }> }
type BandFn = (t: Totals | undefined, h: BandHeader[][] | undefined) => BandRow[];
const bandRows = ((LT as Record<string, unknown>).buildTotalsBandRows ?? (() => {
  throw new Error('buildTotalsBandRows non esportata da listTotals.ts');
})) as BandFn;

type BandColTotals = ColTotals & { band?: number };
function btotals(columns: Record<string, BandColTotals>): Totals {
  return totals(columns as Record<string, ColTotals>);
}

// Due bande: [qta (colspan 2), descr], [prezzo, sconto (colspan 3)]; più un'intestazione
// di lista incorporata senza control (nota).
const contHeaders: BandHeader[][] = [
  [{ text: 'Qtà', name: 'qta', control: 'qta', colspan: 2 }, { text: 'Descrizione', name: 'descr', control: 'descr' }],
  [{ text: 'Prezzo', name: 'prezzo', control: 'prezzo' }, { text: 'Sconto', name: 'sconto', control: 'sconto', colspan: 3 },
    { text: 'Nota', name: 'nota' }],
];

describe('buildTotalsBandRows (SXADV-5490 §7)', () => {
  it('totals o contHeaders undefined: vuoto, nessuna eccezione', () => {
    expect(bandRows(undefined, contHeaders)).toEqual([]);
    expect(bandRows(btotals({ qta: { available: true, active: ['sum'], sum: '3', band: 1 } }), undefined)).toEqual([]);
  });

  it('niente attivo: vuoto', () => {
    expect(bandRows(btotals({
      qta: { available: true, active: [], band: 1 },
      prezzo: { available: true, active: [], band: 2 },
    }), contHeaders)).toEqual([]);
  });

  it('attivi solo di prima riga: nessuna banda dei totali', () => {
    expect(bandRows(btotals({
      importo: { available: true, active: ['sum'], sum: '10', band: 0 },
      qta: { available: true, active: [], band: 1 },
    }), contHeaders)).toEqual([]);
  });

  it('un item attivo nella prima banda: una voce, celle allineate alle intestazioni', () => {
    const r = bandRows(btotals({ qta: { available: true, active: ['sum'], sum: '3,00', band: 1 } }), contHeaders);
    expect(r).toHaveLength(1);
    expect(r[0].band).toBe(0);
    expect(r[0].cells).toHaveLength(2);
    expect(r[0].cells[0].text).toBe('Σ 3,00');
    expect(r[0].cells[0].colspan).toBe(2);
    expect(r[0].cells[1].text).toBe('');
    expect(r[0].cells[1].title).toBeUndefined();
    expect(r[0].cells[1].colspan ?? 1).toBe(1);
  });

  it('la banda si trova per indice in contHeaders, l\'item per control (non per name)', () => {
    const h: BandHeader[][] = [[{ text: 'A', name: '{espr}', tag: 'x', control: 'x' }]];
    const r = bandRows(btotals({ x: { available: true, active: ['avg'], avg: '1,5', band: 1 } }), h);
    expect(r).toHaveLength(1);
    expect(r[0].cells[0].text).toBe('⌀ 1,5');
    // name uguale a una chiave ma control diverso: non si aggancia
    const h2: BandHeader[][] = [[{ text: 'A', name: 'y', control: 'z' }]];
    expect(bandRows(btotals({ y: { available: true, active: ['sum'], sum: '9', band: 1 } }), h2)).toEqual([]);
  });

  it('intestazione senza control (lista incorporata): mai un totale', () => {
    const r = bandRows(btotals({
      prezzo: { available: true, active: ['avg'], avg: '5', band: 2 },
      nota: { available: true, active: ['sum'], sum: '77', band: 2 },
    }), contHeaders);
    expect(r).toHaveLength(1);
    expect(r[0].cells[2].text).toBe('');
    expect(JSON.stringify(r)).not.toContain('77');
  });

  it('solo la seconda banda attiva: una voce con band = 1, la prima non c\'è', () => {
    const r = bandRows(btotals({
      qta: { available: true, active: [], band: 1 },
      prezzo: { available: true, active: ['avg'], avg: '5,00', band: 2 },
    }), contHeaders);
    expect(r).toHaveLength(1);
    expect(r[0].band).toBe(1);
    expect(r[0].cells.map((c) => c.text)).toEqual(['⌀ 5,00', '', '']);
    expect(r[0].cells.map((c) => c.colspan ?? 1)).toEqual([1, 3, 1]);
  });

  it('due bande attive: due voci, in ordine di banda', () => {
    const r = bandRows(btotals({
      sconto: { available: true, active: ['sum'], sum: '2', band: 2 },
      descr: { available: true, active: ['sum'], sum: '4', band: 1 },
    }), contHeaders);
    expect(r.map((x) => x.band)).toEqual([0, 1]);
    expect(r[0].cells.map((c) => c.text)).toEqual(['', 'Σ 4']);
    expect(r[1].cells.map((c) => c.text)).toEqual(['', 'Σ 2', '']);
  });

  it('Σ e ⌀ sullo stesso item: due righe di testo nella cella', () => {
    const r = bandRows(btotals({ qta: { available: true, active: ['sum', 'avg'], sum: '6', avg: '2', band: 1 } }), contHeaders);
    expect(lines(r[0].cells[0].text)).toEqual(['Σ 6', '⌀ 2']);
  });

  it('mixed: il testo del server, senza title', () => {
    const r = bandRows(btotals({ prezzo: { available: true, active: ['sum'], mixed: 'valute diverse', band: 2 } }), contHeaders);
    expect(r[0].cells[0].text).toBe('valute diverse');
    expect(r[0].cells[0].title).toBeUndefined();
  });

  it('available=false: «—» con title = reason', () => {
    const r = bandRows(btotals({ prezzo: { available: false, reason: MSG_SOLO_PAGINA, active: ['avg'], band: 2 } }), contHeaders);
    expect(r[0].cells[0].text).toBe('—');
    expect(r[0].cells[0].title).toBe(MSG_SOLO_PAGINA);
  });

  it('error: «—» con title = error', () => {
    const r = bandRows(btotals({ sconto: { available: true, active: ['sum'], error: 'query fallita', band: 2 } }), contHeaders);
    expect(r[0].cells[1].text).toBe('—');
    expect(r[0].cells[1].title).toBe('query fallita');
  });

  it('item di banda totalizzabile ma non attivo, accanto a uno attivo: cella vuota', () => {
    const r = bandRows(btotals({
      prezzo: { available: true, active: [], band: 2 },
      sconto: { available: true, active: ['sum'], sum: '1', band: 2 },
    }), contHeaders);
    expect(r[0].cells[0].text).toBe('');
  });
});

describe('hasActiveTotals e buildTotalsRow con attivi di banda (SXADV-5490 §7)', () => {
  const columns = [col('descrizione', 'text'), col('importo', 'money')];

  it('hasActiveTotals: vero con il solo item di banda attivo', () => {
    expect(has(btotals({
      importo: { available: true, active: [], band: 0 },
      qta: { available: true, active: ['sum'], sum: '3', band: 1 },
    }))).toBe(true);
  });

  it('buildTotalsRow: soli attivi di banda -> riga con «Totale» e nessun valore', () => {
    const r = row(btotals({
      importo: { available: true, active: [], band: 0 },
      qta: { available: true, active: ['sum'], sum: '3', band: 1 },
    }), columns);
    expect(r).not.toBeNull();
    const texts = Object.keys(r!).filter((k) => /^col_\d+$/.test(k)).map((k) => cellText(r![k]));
    expect(texts).toContain('Totale');
    expect(texts.filter((t) => t && t !== 'Totale')).toEqual([]);
    expect(JSON.stringify(r)).not.toContain('Σ');
  });

  it('buildTotalsRow: attivi di prima riga e di banda insieme, il valore di banda non sale nella riga', () => {
    const r = row(btotals({
      importo: { available: true, active: ['sum'], sum: '10', band: 0 },
      qta: { available: true, active: ['sum'], sum: '3', band: 1 },
    }), columns);
    expect(cellText(r!.col_1)).toBe('Σ 10');
    expect(cellText(r!.col_0)).toBe('Totale');
    expect(JSON.stringify(r)).not.toContain('Σ 3');
  });
});
