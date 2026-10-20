import { describe, it, expect } from 'vitest';
import { markPanelField, scopePanelValues, type PanelFieldRows } from './panelFieldScope';

// MD-VALORI-RESIDUI-DOPO-SALVA (difetto trovato provando SXADV-5982): il digitato
// del pannello di riga restava nei valori della scheda e partiva con richieste per
// un'altra riga (o per nessuna). Contratto: un valore del pannello parte solo per la
// sua riga; per altro si scarta. I valori fuori dal pannello passano invariati.

const RIGO_A = 'S1-2.3';
const RIGO_B = 'S1-2.4';

function righe(...coppie: [string, string][]): PanelFieldRows {
  const rows: PanelFieldRows = new Map();
  for (const [nome, riga] of coppie) markPanelField(rows, nome, riga);
  return rows;
}

describe('markPanelField', () => {
  it('registra campo -> riga', () => {
    const rows = righe(['descrizione.S1-2', RIGO_B]);
    expect(rows.get('descrizione.S1-2')).toBe(RIGO_B);
  });

  it("stesso campo due volte con righe diverse: vale l'ultima", () => {
    const rows: PanelFieldRows = new Map();
    markPanelField(rows, 'descrizione.S1-2', RIGO_B);
    markPanelField(rows, 'descrizione.S1-2', RIGO_A);
    expect(rows.size).toBe(1);
    expect(rows.get('descrizione.S1-2')).toBe(RIGO_A);
    const out = scopePanelValues({ 'descrizione.S1-2': 'x' }, rows, RIGO_B);
    expect(out.values).toEqual({});
    expect(out.dropped).toEqual(['descrizione.S1-2']);
    const out2 = scopePanelValues({ 'descrizione.S1-2': 'x' }, rows, RIGO_A);
    expect(out2.values).toEqual({ 'descrizione.S1-2': 'x' });
    expect(out2.sent).toEqual(['descrizione.S1-2']);
  });
});

describe('scopePanelValues: lo scenario del difetto', () => {
  it('valori scritti sul rigo B, Save per il rigo A: i valori di B non partono', () => {
    const values = { 'descrizione.S1-2': 'testo di B', 'importo.S1-2': '12,50' };
    const rows = righe(['descrizione.S1-2', RIGO_B], ['importo.S1-2', RIGO_B]);
    const out = scopePanelValues(values, rows, RIGO_A);
    expect(out.values).toEqual({});
    expect(out.sent).toEqual([]);
    expect([...out.dropped].sort()).toEqual(['descrizione.S1-2', 'importo.S1-2']);
  });

  it('richiesta per la stessa riga: i valori partono e sono in sent', () => {
    const values = { 'descrizione.S1-2': 'testo di B', 'importo.S1-2': '12,50' };
    const rows = righe(['descrizione.S1-2', RIGO_B], ['importo.S1-2', RIGO_B]);
    const out = scopePanelValues(values, rows, RIGO_B);
    expect(out.values).toEqual(values);
    expect([...out.sent].sort()).toEqual(['descrizione.S1-2', 'importo.S1-2']);
    expect(out.dropped).toEqual([]);
  });

  it('righe miste: parte solo il campo della riga della richiesta', () => {
    const values = { 'descrizione.S1-2': 'A', 'importo.S1-2': 'B' };
    const rows = righe(['descrizione.S1-2', RIGO_A], ['importo.S1-2', RIGO_B]);
    const out = scopePanelValues(values, rows, RIGO_A);
    expect(out.values).toEqual({ 'descrizione.S1-2': 'A' });
    expect(out.sent).toEqual(['descrizione.S1-2']);
    expect(out.dropped).toEqual(['importo.S1-2']);
  });

  it('riga che e\' prefisso di un\'altra non conta come la stessa riga', () => {
    const rows = righe(['descrizione.S1-2', 'S1-2.31']);
    const out = scopePanelValues({ 'descrizione.S1-2': 'x' }, rows, 'S1-2.3');
    expect(out.values).toEqual({});
    expect(out.dropped).toEqual(['descrizione.S1-2']);
  });
});

describe('scopePanelValues: richieste senza riga (PrevPage / NextPage)', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['stringa vuota', ''],
  ])('target %s: nessun valore del pannello parte', (_n, target) => {
    const values = { 'descrizione.S1-2': 'testo', 'codice.S1-1': 'principale' };
    const rows = righe(['descrizione.S1-2', RIGO_B]);
    const out = scopePanelValues(values, rows, target as string | null | undefined);
    expect(out.values).toEqual({ 'codice.S1-1': 'principale' });
    expect(out.sent).toEqual([]);
    expect(out.dropped).toEqual(['descrizione.S1-2']);
  });
});

describe('scopePanelValues: valori fuori dal pannello', () => {
  it.each([
    ['stessa riga', RIGO_B],
    ['altra riga', RIGO_A],
    ['nessuna riga', null],
  ])('%s: mappa principale e array di colonna invariati', (_n, target) => {
    const colonna = ['1', '2', '3'];
    const values = {
      'codice.S1-1': 'principale',
      'qta.S1-5': colonna,
      'descrizione.S1-2': 'pannello',
    };
    const rows = righe(['descrizione.S1-2', RIGO_B]);
    const out = scopePanelValues(values, rows, target);
    expect(out.values['codice.S1-1']).toBe('principale');
    expect(out.values['qta.S1-5']).toEqual(['1', '2', '3']);
    expect(out.sent).not.toContain('qta.S1-5');
    expect(out.dropped).not.toContain('qta.S1-5');
    expect(out.sent).not.toContain('codice.S1-1');
    expect(out.dropped).not.toContain('codice.S1-1');
  });

  it('campo del pannello con valore array: segue la regola della riga', () => {
    const values = { 'tag.S1-2': ['a', 'b'] };
    const rows = righe(['tag.S1-2', RIGO_B]);
    expect(scopePanelValues(values, rows, RIGO_B).values).toEqual({ 'tag.S1-2': ['a', 'b'] });
    expect(scopePanelValues(values, rows, RIGO_A).values).toEqual({});
  });

  it('rows vuota: valori invariati, sent e dropped vuoti', () => {
    const values = { 'codice.S1-1': 'x', 'qta.S1-5': ['1'] };
    for (const target of [RIGO_A, null, undefined, '']) {
      const out = scopePanelValues(values, new Map(), target);
      expect(out.values).toEqual(values);
      expect(out.sent).toEqual([]);
      expect(out.dropped).toEqual([]);
    }
  });
});

describe('scopePanelValues: campi marcati ma assenti dai valori', () => {
  it('stessa riga: in sent, nessuna chiave aggiunta', () => {
    const rows = righe(['descrizione.S1-2', RIGO_B]);
    const out = scopePanelValues({ 'codice.S1-1': 'x' }, rows, RIGO_B);
    expect(out.sent).toEqual(['descrizione.S1-2']);
    expect(out.dropped).toEqual([]);
    expect(out.values).toEqual({ 'codice.S1-1': 'x' });
    expect('descrizione.S1-2' in out.values).toBe(false);
  });

  it('altra riga: in dropped', () => {
    const rows = righe(['descrizione.S1-2', RIGO_B]);
    const out = scopePanelValues({ 'codice.S1-1': 'x' }, rows, RIGO_A);
    expect(out.sent).toEqual([]);
    expect(out.dropped).toEqual(['descrizione.S1-2']);
    expect(out.values).toEqual({ 'codice.S1-1': 'x' });
  });
});

describe('scopePanelValues: immutabilita\' degli input', () => {
  it('non modifica values ne\' rows, e restituisce un oggetto nuovo', () => {
    const colonna = ['1', '2'];
    const values = { 'descrizione.S1-2': 'B', 'codice.S1-1': 'x', 'qta.S1-5': colonna };
    const rows = righe(['descrizione.S1-2', RIGO_B]);
    const valuesPrima = structuredClone(values);
    const rowsPrima = new Map(rows);

    const scartati = scopePanelValues(values, rows, RIGO_A);
    const spediti = scopePanelValues(values, rows, RIGO_B);

    expect(values).toEqual(valuesPrima);
    expect(colonna).toEqual(['1', '2']);
    expect(rows).toEqual(rowsPrima);
    expect(scartati.values).not.toBe(values);
    expect(spediti.values).not.toBe(values);

    // mutare il risultato non tocca l'input
    (scartati.values as Record<string, string>)['nuovo'] = 'y';
    expect('nuovo' in values).toBe(false);
  });
});
