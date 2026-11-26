import { describe, it, expect } from 'vitest';
import { applyRowEcho, nameContinuationCells } from './rowEcho';
import type { EchoEntry, RowEcho } from './rowEcho';
import type { ListColumn } from '../types/ui';

// SXADV-6294: l'eco del pannello "Gestione riga" (SXADV-6048) arrivava solo alla
// prima riga del record. I campi che stanno sulle righe 2..n del layout (le bande di
// continuazione) non si vedevano fino al Salva. Le celle di banda non portano il nome
// del controllo: lo danno le intestazioni di banda (`ui.continuationHeaders[banda]`),
// allineate alle celle per UNITA' di colonna (colspan cumulato, colspan assente = 1).

const VS = 'S1-9';

function entry(name: string, text: string): EchoEntry {
  return { wire: `${name}.${VS}`, text };
}

function deepCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

const MAIN_COLUMNS = [
  { elementType: 5 },
  { elementType: 1, control: { name: 'descrizione', type: 'text' } },
] as unknown as ListColumn[];

/** Banda 0 come la manda il server vero. */
const REAL_HEADERS = [
  { colspan: 4, control: 'prompt' },
  { colspan: 14, control: 'content' },
  { colspan: 2, control: 'size' },
];
const REAL_CELLS = [
  { colspan: 4, text: 'Condizione di Pagamento' },
  { colspan: 14, text: 'coalesce(...)' },
  { colspan: 2, text: '30', cls: 'number' },
];

// --- nameContinuationCells -------------------------------------------------------------

describe('nameContinuationCells', () => {
  it('caso reale del server: ogni cella prende il control dell\'intestazione che parte alla stessa unita\'', () => {
    const out = nameContinuationCells(REAL_CELLS, REAL_HEADERS);
    expect(out.map((c) => c.name)).toEqual(['prompt', 'content', 'size']);
    // il resto della cella resta com'era
    expect(out[2]).toEqual({ colspan: 2, text: '30', cls: 'number', name: 'size' });
  });

  it('non modifica le celle ne\' le intestazioni ricevute', () => {
    const cells = deepCopy(REAL_CELLS);
    const headers = deepCopy(REAL_HEADERS);
    nameContinuationCells(cells, headers);
    expect(cells).toEqual(REAL_CELLS);
    expect(headers).toEqual(REAL_HEADERS);
  });

  it('intestazioni assenti: celle restituite senza nome', () => {
    const out = nameContinuationCells(REAL_CELLS, undefined);
    expect(out).toHaveLength(3);
    out.forEach((c, i) => {
      expect('name' in c).toBe(false);
      expect(c).toEqual(REAL_CELLS[i]);
    });
  });

  it('colspan assente vale 1, sia sulle celle sia sulle intestazioni', () => {
    const cells = [{ text: 'a' }, { text: 'b' }, { colspan: 2, text: 'c' }];
    const headers = [{ control: 'x' }, { control: 'y' }, { colspan: 2, control: 'z' }];
    expect(nameContinuationCells(cells, headers).map((c) => c.name)).toEqual(['x', 'y', 'z']);
  });

  it('allineamento per unita\', non per indice: intestazione larga sopra due celle', () => {
    // intestazioni: [0..3] a, [4] b ; celle: [0..1], [2..3], [4]
    const cells = [{ colspan: 2, text: '1' }, { colspan: 2, text: '2' }, { text: '3' }];
    const headers = [{ colspan: 4, control: 'a' }, { control: 'b' }];
    const out = nameContinuationCells(cells, headers);
    expect(out[0].name).toBe('a');
    // la seconda cella parte all'unita' 2: nessuna intestazione parte li'
    expect('name' in out[1]).toBe(false);
    // la terza parte all'unita' 4, come "b" (non all'indice 2, che non esiste)
    expect(out[2].name).toBe('b');
  });

  it('allineamento per unita\': cella larga sopra due intestazioni', () => {
    const cells = [{ colspan: 3, text: 'tutto' }, { text: 'coda' }];
    const headers = [{ control: 'a' }, { colspan: 2, control: 'b' }, { control: 'c' }];
    const out = nameContinuationCells(cells, headers);
    expect(out[0].name).toBe('a');
    // la cella "coda" parte all'unita' 3, dove parte "c" (non "b", che e' l'indice 1)
    expect(out[1].name).toBe('c');
  });

  it('intestazione senza control: la cella resta senza nome', () => {
    const cells = [{ text: 'a' }, { text: 'b' }];
    const headers = [{ text: 'Etichetta' } as { colspan?: number; control?: string }, { control: 'b' }];
    const out = nameContinuationCells(cells, headers);
    expect('name' in out[0]).toBe(false);
    expect(out[1].name).toBe('b');
  });

  it('piu\' celle che intestazioni: le celle oltre la fine restano senza nome', () => {
    const cells = [{ text: 'a' }, { text: 'b' }, { text: 'c' }];
    const headers = [{ control: 'a' }];
    const out = nameContinuationCells(cells, headers);
    expect(out[0].name).toBe('a');
    expect('name' in out[1]).toBe(false);
    expect('name' in out[2]).toBe(false);
  });

  it('restituisce un array nuovo', () => {
    const cells = deepCopy(REAL_CELLS);
    expect(nameContinuationCells(cells, REAL_HEADERS)).not.toBe(cells);
  });
});

// --- applyRowEcho sulla riga di continuazione -------------------------------------------

type Cell = { text?: string; html?: string; colspan?: number; control?: unknown; cls?: string; name?: string };

function contRow(cells: Cell[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _isContinuationRow: true,
    _selectorPath: 'S1-0.0,S1-9.0',
    _continuationCells: cells,
    ...extra,
  };
}

function cellsOf(row: Record<string, unknown>): Cell[] {
  return row._continuationCells as Cell[];
}

describe('applyRowEcho: riga di continuazione (SXADV-6294)', () => {
  it('la cella col nome nell\'eco mostra il testo digitato', () => {
    const cells: Cell[] = [
      { colspan: 4, text: 'Condizione di Pagamento', name: 'prompt' },
      { colspan: 14, text: 'vecchio', name: 'content' },
      { colspan: 2, text: '30', cls: 'number', name: 'size' },
    ];
    const data = contRow(cells);
    const echo: RowEcho = { content: entry('content', 'nuovo') };
    const out = applyRowEcho(data, echo, MAIN_COLUMNS);
    expect(out).not.toBe(data);
    expect(out._continuationCells).not.toBe(cells);
    expect(cellsOf(out)[1]).toEqual({ colspan: 14, text: 'nuovo', name: 'content' });
  });

  it('le celle non toccate conservano l\'identita\'', () => {
    const cells: Cell[] = [
      { colspan: 4, text: 'Etichetta', name: 'prompt' },
      { colspan: 14, text: 'vecchio', name: 'content' },
      { colspan: 2, text: '30', name: 'size' },
    ];
    const data = contRow(cells);
    const out = applyRowEcho(data, { content: entry('content', 'nuovo') }, MAIN_COLUMNS);
    expect(cellsOf(out)[0]).toBe(cells[0]);
    expect(cellsOf(out)[2]).toBe(cells[2]);
    expect(cellsOf(out)[1]).not.toBe(cells[1]);
  });

  it('non modifica la riga ne\' le celle ricevute', () => {
    const cells: Cell[] = [{ text: 'vecchio', html: '<b>vecchio</b>', name: 'content' }];
    const data = contRow(cells);
    const snapshot = deepCopy(data);
    applyRowEcho(data, { content: entry('content', 'nuovo') }, MAIN_COLUMNS);
    expect(data).toEqual(snapshot);
  });

  it('la cella con html: il testo dell\'eco prende il posto, html tolto', () => {
    const cells: Cell[] = [{ colspan: 3, html: '<span>vecchio</span>', text: 'vecchio', name: 'note' }];
    const out = applyRowEcho(contRow(cells), { note: entry('note', 'scritto ora') }, MAIN_COLUMNS);
    const cell = cellsOf(out)[0];
    expect(cell.text).toBe('scritto ora');
    expect('html' in cell).toBe(false);
    expect(cell.colspan).toBe(3);
    expect(cell.name).toBe('note');
  });

  it('una cella con control (renderer personalizzato) resta com\'e\'', () => {
    const cells: Cell[] = [{ text: 'vecchio', name: 'content', control: { type: 'button' } }];
    const data = contRow(cells);
    const out = applyRowEcho(data, { content: entry('content', 'nuovo') }, MAIN_COLUMNS);
    expect(out).toBe(data);
    expect(cellsOf(out)[0]).toBe(cells[0]);
  });

  it('nessun nome nell\'eco: stessa riga', () => {
    const cells: Cell[] = [{ text: 'vecchio', name: 'content' }, { text: 'x' }];
    const data = contRow(cells);
    expect(applyRowEcho(data, { altro: entry('altro', 'y') }, MAIN_COLUMNS)).toBe(data);
  });

  it('eco vuota {}: stessa riga', () => {
    const cells: Cell[] = [{ text: 'vecchio', name: 'content' }];
    const data = contRow(cells);
    expect(applyRowEcho(data, {}, MAIN_COLUMNS)).toBe(data);
  });

  it('celle senza nome: l\'eco non le tocca anche se il testo coincide con un nome', () => {
    const cells: Cell[] = [{ text: 'content' }];
    const data = contRow(cells);
    expect(applyRowEcho(data, { content: entry('content', 'nuovo') }, MAIN_COLUMNS)).toBe(data);
  });

  it('piu\' campi della banda nell\'eco: tutti riflessi', () => {
    const cells: Cell[] = [
      { colspan: 4, text: 'Etichetta', name: 'prompt' },
      { colspan: 14, text: 'a', name: 'content' },
      { colspan: 2, text: '30', cls: 'number', name: 'size' },
    ];
    const echo: RowEcho = { content: entry('content', 'b'), size: entry('size', '60') };
    const out = applyRowEcho(contRow(cells), echo, MAIN_COLUMNS);
    expect(cellsOf(out).map((c) => c.text)).toEqual(['Etichetta', 'b', '60']);
    expect(cellsOf(out)[2].cls).toBe('number');
  });

  it('il resto della riga (selettore, flag) resta nella copia', () => {
    const cells: Cell[] = [{ text: 'a', name: 'content' }];
    const data = contRow(cells, { _bandIndex: 0 });
    const out = applyRowEcho(data, { content: entry('content', 'b') }, MAIN_COLUMNS);
    expect(out._isContinuationRow).toBe(true);
    expect(out._selectorPath).toBe('S1-0.0,S1-9.0');
    expect(out._bandIndex).toBe(0);
  });

  it('una banda dei totali (_isTotalsRow) resta com\'e\'', () => {
    const cells: Cell[] = [{ text: '100', name: 'content' }];
    const data = contRow(cells, { _isTotalsRow: true });
    expect(applyRowEcho(data, { content: entry('content', '200') }, MAIN_COLUMNS)).toBe(data);
  });

  it('nomi presi da nameContinuationCells: l\'eco arriva sulla cella giusta del caso reale', () => {
    const cells = nameContinuationCells(REAL_CELLS, REAL_HEADERS) as Cell[];
    const out = applyRowEcho(contRow(cells), { size: entry('size', '90') }, MAIN_COLUMNS);
    expect(cellsOf(out)[2]).toEqual({ colspan: 2, text: '90', cls: 'number', name: 'size' });
    expect(cellsOf(out)[0]).toBe(cells[0]);
    expect(cellsOf(out)[1]).toBe(cells[1]);
  });
});

// --- applyRowEcho in modalita' una-riga ------------------------------------------------

describe('applyRowEcho: riga principale in modalita\' una-riga (SXADV-6294)', () => {
  function oneLineRow(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      _selectorPath: 'S1-0.0,S1-9.0',
      col_1: 'Fattura 12',
      cont_0_0: 'Condizione di Pagamento',
      _contname_cont_0_0: 'prompt',
      cont_0_4: 'vecchio',
      _contname_cont_0_4: 'content',
      cont_0_18: '30',
      _contname_cont_0_18: 'size',
      ...extra,
    };
  }

  it('il campo di banda col nome nell\'eco prende il testo digitato', () => {
    const data = oneLineRow();
    const out = applyRowEcho(data, { content: entry('content', 'nuovo') }, MAIN_COLUMNS);
    expect(out).not.toBe(data);
    expect(out.cont_0_4).toBe('nuovo');
    expect(out.cont_0_0).toBe('Condizione di Pagamento');
    expect(out.cont_0_18).toBe('30');
    expect(out._contname_cont_0_4).toBe('content');
  });

  it('non modifica la riga ricevuta', () => {
    const data = oneLineRow();
    const snapshot = deepCopy(data);
    applyRowEcho(data, { content: entry('content', 'nuovo') }, MAIN_COLUMNS);
    expect(data).toEqual(snapshot);
  });

  it('campo di banda vuoto (assente) ma col nome: l\'eco lo riempie', () => {
    const data = oneLineRow({ cont_1_2: undefined, _contname_cont_1_2: 'note' });
    delete data.cont_1_2;
    const out = applyRowEcho(data, { note: entry('note', 'scritto') }, MAIN_COLUMNS);
    expect(out.cont_1_2).toBe('scritto');
  });

  it('valore gia\' uguale: stessa riga', () => {
    const data = oneLineRow();
    expect(applyRowEcho(data, { content: entry('content', 'vecchio') }, MAIN_COLUMNS)).toBe(data);
  });

  it('eco su colonna principale e campo di banda insieme', () => {
    const data = oneLineRow();
    const echo: RowEcho = {
      descrizione: entry('descrizione', 'Fattura 13'),
      size: entry('size', '60'),
    };
    const out = applyRowEcho(data, echo, MAIN_COLUMNS);
    expect(out.col_1).toBe('Fattura 13');
    expect(out.cont_0_18).toBe('60');
  });

  it('nome non nell\'eco: stessa riga', () => {
    const data = oneLineRow();
    expect(applyRowEcho(data, { altro: entry('altro', 'x') }, MAIN_COLUMNS)).toBe(data);
  });
});

// --- righe che l'eco non tocca ---------------------------------------------------------

describe('applyRowEcho: righe di rottura e totali restano com\'erano (SXADV-6294)', () => {
  it('riga di rottura: stessa identita\'', () => {
    const data = {
      _isBreakRow: true,
      col_1: 'Gruppo',
      cont_0_4: 'x',
      _contname_cont_0_4: 'content',
    };
    expect(applyRowEcho(data, { descrizione: entry('descrizione', 'y'), content: entry('content', 'z') }, MAIN_COLUMNS)).toBe(data);
  });

  it('riga dei totali principale: stessa identita\'', () => {
    const data = { _isTotalsRow: true, col_1: '100', cont_0_4: '5', _contname_cont_0_4: 'content' };
    expect(applyRowEcho(data, { descrizione: entry('descrizione', 'y'), content: entry('content', 'z') }, MAIN_COLUMNS)).toBe(data);
  });

  it('banda di continuazione dei totali: stessa identita\'', () => {
    const data = contRow([{ text: '5', name: 'content' }], { _isTotalsRow: true });
    expect(applyRowEcho(data, { content: entry('content', 'z') }, MAIN_COLUMNS)).toBe(data);
  });
});
