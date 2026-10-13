import { describe, it, expect, beforeEach } from 'vitest';
import {
  rememberRow,
  recallRow,
  forgetAllRows,
  armReturn,
  armedReturn,
  disarmReturn,
  lastRecordPath,
  ROW_RETURN_ATTR,
} from './rowSelectionMemory';

// SXADV-5927: in "Fatture - Dettaglio" la lista "Righe fattura" (tab in basso)
// ha il "Nuovo" che porta a una pagina di dettaglio a se'. Tornando con
// "« Ritorno un passo indietro" il cursore finiva sul primo campo della testata
// ("Tipo Doc. FE"), l'area dei tab si stringeva e la griglia restava in cima.
// Atteso: il fuoco resta nel tab, sulla riga nuova (l'ULTIMA), evidenziata e a
// vista; tornando dal dettaglio di una riga esistente (5957), su quella riga.
//
// Il ritorno si "arma" uscendo dalla lista: 'row' = clic su una riga che
// naviga, 'new' = "Nuovo" che naviga. Al rimontaggio la lista lo legge, mette
// fuoco ed evidenza e lo disarma.

describe('armReturn / armedReturn / disarmReturn', () => {
  beforeEach(() => forgetAllRows());

  it("una chiave mai armata non ha ritorno", () => {
    expect(armedReturn('S1:righeFatturaList')).toBeUndefined();
  });

  it("armato 'new' (Nuovo che naviga): si legge 'new'", () => {
    armReturn('S1:righeFatturaList', 'new');
    expect(armedReturn('S1:righeFatturaList')).toBe('new');
  });

  it("armato 'row' (clic su una riga che naviga): si legge 'row'", () => {
    armReturn('S1:righeFatturaList', 'row');
    expect(armedReturn('S1:righeFatturaList')).toBe('row');
  });

  it('leggere non consuma: due letture di fila danno lo stesso modo', () => {
    armReturn('S1:righeFatturaList', 'new');
    expect(armedReturn('S1:righeFatturaList')).toBe('new');
    expect(armedReturn('S1:righeFatturaList')).toBe('new');
  });

  it("riarmare la stessa chiave sostituisce il modo (row -> new)", () => {
    armReturn('S1:righeFatturaList', 'row');
    armReturn('S1:righeFatturaList', 'new');
    expect(armedReturn('S1:righeFatturaList')).toBe('new');
  });

  it("riarmare la stessa chiave sostituisce il modo (new -> row)", () => {
    armReturn('S1:righeFatturaList', 'new');
    armReturn('S1:righeFatturaList', 'row');
    expect(armedReturn('S1:righeFatturaList')).toBe('row');
  });

  it('disarmare toglie il ritorno', () => {
    armReturn('S1:righeFatturaList', 'new');
    disarmReturn('S1:righeFatturaList');
    expect(armedReturn('S1:righeFatturaList')).toBeUndefined();
  });

  it('disarmare una chiave mai armata non esplode e non tocca le altre', () => {
    armReturn('S1:righeFatturaList', 'row');
    expect(() => disarmReturn('S1:mai')).not.toThrow();
    expect(armedReturn('S1:righeFatturaList')).toBe('row');
  });

  it('disarmare due volte non esplode', () => {
    armReturn('S1:righeFatturaList', 'row');
    disarmReturn('S1:righeFatturaList');
    expect(() => disarmReturn('S1:righeFatturaList')).not.toThrow();
    expect(armedReturn('S1:righeFatturaList')).toBeUndefined();
  });

  it('dopo il disarmo si puo\' riarmare', () => {
    armReturn('S1:righeFatturaList', 'row');
    disarmReturn('S1:righeFatturaList');
    armReturn('S1:righeFatturaList', 'new');
    expect(armedReturn('S1:righeFatturaList')).toBe('new');
  });

  it('chiavi diverse non si mescolano (stessa vista in due sid, viste diverse)', () => {
    armReturn('S1:righeFatturaList', 'new');
    armReturn('S2:righeFatturaList', 'row');
    expect(armedReturn('S1:righeFatturaList')).toBe('new');
    expect(armedReturn('S2:righeFatturaList')).toBe('row');
    expect(armedReturn('S1:fattureList')).toBeUndefined();
    disarmReturn('S1:righeFatturaList');
    expect(armedReturn('S1:righeFatturaList')).toBeUndefined();
    expect(armedReturn('S2:righeFatturaList')).toBe('row');
  });

  it('forgetAllRows toglie anche tutti i ritorni armati', () => {
    armReturn('S1:righeFatturaList', 'new');
    armReturn('S2:fattureList', 'row');
    forgetAllRows();
    expect(armedReturn('S1:righeFatturaList')).toBeUndefined();
    expect(armedReturn('S2:fattureList')).toBeUndefined();
  });

  it('forgetAllRows toglie insieme righe ricordate e ritorni armati', () => {
    rememberRow('S1:righeFatturaList', 'S1-0.7,S1-9.0,S1-10.1');
    armReturn('S1:righeFatturaList', 'row');
    forgetAllRows();
    expect(recallRow('S1:righeFatturaList')).toBeUndefined();
    expect(armedReturn('S1:righeFatturaList')).toBeUndefined();
  });

  it('il ritorno armato e la riga ricordata sono indipendenti', () => {
    // Armare non inventa una riga ricordata, ricordare non arma.
    armReturn('S1:righeFatturaList', 'new');
    expect(recallRow('S1:righeFatturaList')).toBeUndefined();
    rememberRow('S1:fattureList', 'S1-0.7');
    expect(armedReturn('S1:fattureList')).toBeUndefined();
  });

  it('disarmare non dimentica la riga ricordata', () => {
    // Dopo il ritorno la riga resta evidenziata (5957): il disarmo riguarda
    // solo il fuoco una tantum.
    rememberRow('S1:righeFatturaList', 'S1-0.7,S1-9.0,S1-21.3');
    armReturn('S1:righeFatturaList', 'row');
    disarmReturn('S1:righeFatturaList');
    expect(recallRow('S1:righeFatturaList')).toBe('S1-0.7,S1-9.0,S1-21.3');
  });

  it('dimenticare la riga (rememberRow null) non disarma il ritorno', () => {
    armReturn('S1:righeFatturaList', 'new');
    rememberRow('S1:righeFatturaList', null);
    expect(armedReturn('S1:righeFatturaList')).toBe('new');
  });
});

describe('lastRecordPath: la riga nuova e\' l\'ultima', () => {
  it('lista vuota: nessuna riga', () => {
    expect(lastRecordPath([])).toBeNull();
  });

  it('una riga sola: e\' quella', () => {
    expect(lastRecordPath([{ path: 'S1-0.7,S1-9.0,S1-21.0', rowIndex: 0 }])).toBe('S1-0.7,S1-9.0,S1-21.0');
  });

  it('righe in ordine: l\'ultima', () => {
    expect(lastRecordPath([
      { path: 'S1-21.0', rowIndex: 0 },
      { path: 'S1-21.1', rowIndex: 1 },
      { path: 'S1-21.2', rowIndex: 2 },
    ])).toBe('S1-21.2');
  });

  it('righe in ordine sparso: conta rowIndex, non la posizione nell\'array', () => {
    expect(lastRecordPath([
      { path: 'S1-21.4', rowIndex: 4 },
      { path: 'S1-21.0', rowIndex: 0 },
      { path: 'S1-21.9', rowIndex: 9 },
      { path: 'S1-21.2', rowIndex: 2 },
    ])).toBe('S1-21.9');
  });

  it('il massimo in testa all\'array', () => {
    expect(lastRecordPath([
      { path: 'ultima', rowIndex: 7 },
      { path: 'prima', rowIndex: 0 },
      { path: 'media', rowIndex: 3 },
    ])).toBe('ultima');
  });

  it('conta rowIndex, non il percorso: il percorso "piu\' grande" non vince', () => {
    // Il percorso e' viewstate + posizione, e come stringa "S1-21.10" < "S1-21.9".
    expect(lastRecordPath([
      { path: 'S1-21.10', rowIndex: 10 },
      { path: 'S1-21.9', rowIndex: 9 },
    ])).toBe('S1-21.10');
  });

  it('rowIndex non contigui (bande di continuazione gia\' tolte dal chiamante)', () => {
    expect(lastRecordPath([
      { path: 'a', rowIndex: 0 },
      { path: 'b', rowIndex: 2 },
      { path: 'c', rowIndex: 5 },
    ])).toBe('c');
  });

  it('non modifica l\'array ricevuto', () => {
    const nodi = [
      { path: 'b', rowIndex: 1 },
      { path: 'a', rowIndex: 0 },
    ];
    const copia = nodi.map((n) => ({ ...n }));
    lastRecordPath(nodi);
    expect(nodi).toEqual(copia);
  });
});

describe('ROW_RETURN_ATTR', () => {
  it("e' l'attributo che focusNewPage cerca nella vista", () => {
    expect(ROW_RETURN_ATTR).toBe('data-row-return');
  });
});
