import { describe, it, expect } from 'vitest';
import { addedRowPath } from './addedRow';

// SXADV-6011: dopo "Nuovo" su una lista listEdit/multiEdit il pannello di riga
// deve aprirsi sulla riga che il server ha appena creato. Il server la dice col
// `currField` della risposta all'Add (`<campo>.<scope>`): la riga e' quella il
// cui ULTIMO scope del percorso e' lo scope di currField, a confronto esatto.
// Se currField manca o non corrisponde a nessuna riga -> fallback invariato.
// Contratto: docs/features/20261007_SXADV-6011_riga_nuova_pannello.md

const R0 = 'S1-0.0,S1-9.0';
const R1 = 'S1-0.0,S1-9.1';
const R2 = 'S1-0.0,S1-9.2';

describe('addedRowPath — caso reale (Prima Nota, Reg. contabili)', () => {
  it('seconda riga nuova: currField descrizione.S1-9.1 -> riga S1-9.1, non il fallback riga 1', () => {
    expect(addedRowPath([R0, R1], 'descrizione.S1-9.1', R0)).toBe(R1);
  });

  it('la riga indicata dal server vince anche se il fallback e una riga diversa ed esistente', () => {
    expect(addedRowPath([R0, R1, R2], 'descrizione.S1-9.2', R1)).toBe(R2);
  });

  it('se currField indica proprio la riga del fallback, il risultato e quella riga', () => {
    expect(addedRowPath([R0, R1], 'descrizione.S1-9.0', R0)).toBe(R0);
  });
});

describe('addedRowPath — posizione della riga nuova', () => {
  it('riga nuova in testa', () => {
    const rows = ['S1-0.0,S1-9.5', R0, R1];
    expect(addedRowPath(rows, 'importo.S1-9.5', R0)).toBe('S1-0.0,S1-9.5');
  });

  it('riga nuova in mezzo', () => {
    const rows = [R0, 'S1-0.0,S1-9.7', R1];
    expect(addedRowPath(rows, 'importo.S1-9.7', R0)).toBe('S1-0.0,S1-9.7');
  });

  it('riga nuova in coda con indici non consecutivi', () => {
    const rows = [R0, 'S1-0.0,S1-9.3', 'S1-0.0,S1-9.42'];
    expect(addedRowPath(rows, 'conto.S1-9.42', R0)).toBe('S1-0.0,S1-9.42');
  });

  it('una riga sola, ed e quella nuova', () => {
    expect(addedRowPath([R0], 'descrizione.S1-9.0', null)).toBe(R0);
  });
});

describe('addedRowPath — currField assente -> fallback', () => {
  it('null', () => {
    expect(addedRowPath([R0, R1], null, R0)).toBe(R0);
  });
  it('undefined', () => {
    expect(addedRowPath([R0, R1], undefined, R0)).toBe(R0);
  });
  it('stringa vuota', () => {
    expect(addedRowPath([R0, R1], '', R0)).toBe(R0);
  });
  it('stringa vuota con righe il cui ultimo scope e vuoto non deve agganciarle', () => {
    // percorso malformato con virgola finale: ultimo scope ''. Un currField
    // vuoto non e' "uno scope": deve restare il fallback.
    expect(addedRowPath(['S1-0.0,', R1], '', R1)).toBe(R1);
  });
});

describe('addedRowPath — currField che non e una riga -> fallback', () => {
  it('campo della testata (dataReg.S1-0) non e nessuna riga', () => {
    expect(addedRowPath([R0, R1], 'dataReg.S1-0', R0)).toBe(R0);
  });

  it('campo della testata con lo scope del primo anello del percorso (S1-0.0) non e una riga', () => {
    // S1-0.0 compare nei percorsi, ma come PRIMO scope, non come ultimo.
    expect(addedRowPath([R0, R1], 'numero.S1-0.0', R1)).toBe(R1);
  });

  it('scope di un altro view state che nessuna riga ha', () => {
    expect(addedRowPath([R0, R1], 'descrizione.S1-12.1', R0)).toBe(R0);
  });

  it('currField senza punto (solo nome di campo)', () => {
    expect(addedRowPath([R0, R1], 'descrizione', R0)).toBe(R0);
  });

  it('currField uguale allo scope nudo, senza campo davanti (manca il punto separatore)', () => {
    // il contratto chiede che currField termini con '.' + scope
    expect(addedRowPath([R0, R1], 'S1-9.1', R0)).toBe(R0);
  });

  it('currField che finisce con lo scope ma senza il punto separatore (xS1-9.1)', () => {
    expect(addedRowPath([R0, R1], 'descrizioneS1-9.1', R0)).toBe(R0);
  });

  it('currField = intero percorso di riga (non e la forma <campo>.<scope>)', () => {
    // 'x.S1-0.0,S1-9.1' termina con '.S1-9.1'? no: termina con ',S1-9.1'.
    expect(addedRowPath([R0, R1], 'x.S1-0.0,S1-9.0', R1)).toBe(R1);
  });
});

describe('addedRowPath — confronto esatto sullo scope intero', () => {
  it('currField S1-9.11 non e la riga S1-9.1', () => {
    expect(addedRowPath([R0, R1], 'x.S1-9.11', R0)).toBe(R0);
  });

  it('currField S1-9.1 non e la riga S1-9.11', () => {
    expect(addedRowPath([R0, 'S1-0.0,S1-9.11'], 'x.S1-9.1', R0)).toBe(R0);
  });

  it('S1-9.1 e S1-9.11 entrambe presenti: currField S1-9.11 -> S1-9.11', () => {
    const rows = [R1, 'S1-0.0,S1-9.11'];
    expect(addedRowPath(rows, 'x.S1-9.11', R1)).toBe('S1-0.0,S1-9.11');
  });

  it('S1-9.11 prima di S1-9.1 in lista: currField S1-9.1 -> S1-9.1', () => {
    const rows = ['S1-0.0,S1-9.11', R1];
    expect(addedRowPath(rows, 'x.S1-9.1', null)).toBe(R1);
  });

  it('S1-19.1 non e S1-9.1 (prefisso a sinistra dello scope)', () => {
    expect(addedRowPath([R0, 'S1-0.0,S1-19.1'], 'x.S1-9.1', R0)).toBe(R0);
  });

  it('S1-19.1 presente, currField S1-9.1 trova S1-9.1 e non S1-19.1', () => {
    const rows = ['S1-0.0,S1-19.1', R1];
    expect(addedRowPath(rows, 'x.S1-9.1', null)).toBe(R1);
  });

  it('S11-9.1 non e S1-9.1 (sid diverso)', () => {
    expect(addedRowPath([R0, 'S11-0.0,S11-9.1'], 'x.S1-9.1', R0)).toBe(R0);
  });

  it('scope diverso per maiuscole non corrisponde', () => {
    expect(addedRowPath([R0, R1], 'x.s1-9.1', R0)).toBe(R0);
  });
});

describe('addedRowPath — nomi di campo con punti', () => {
  it('conto.codice.S1-9.1 -> riga S1-9.1', () => {
    expect(addedRowPath([R0, R1], 'conto.codice.S1-9.1', R0)).toBe(R1);
  });

  it('campo a piu livelli a.b.c.d.S1-9.2', () => {
    expect(addedRowPath([R0, R1, R2], 'a.b.c.d.S1-9.2', R0)).toBe(R2);
  });

  it('nome di campo che contiene uno scope di riga: decide lo scope FINALE', () => {
    // il "campo" e' 'S1-9.0' (patologico), lo scope e' S1-9.1
    expect(addedRowPath([R0, R1], 'S1-9.0.S1-9.1', R0)).toBe(R1);
  });

  it('nome di campo che contiene uno scope di riga, scope finale di testata -> fallback', () => {
    expect(addedRowPath([R0, R1], 'S1-9.1.S1-0', R0)).toBe(R0);
  });
});

describe('addedRowPath — liste non incorporate (percorso a un solo scope)', () => {
  it('S1-3.2 trovato', () => {
    const rows = ['S1-3.0', 'S1-3.1', 'S1-3.2'];
    expect(addedRowPath(rows, 'importo.S1-3.2', 'S1-3.0')).toBe('S1-3.2');
  });

  it('S1-3.2 non confuso con S1-3.20', () => {
    const rows = ['S1-3.2', 'S1-3.20'];
    expect(addedRowPath(rows, 'importo.S1-3.20', 'S1-3.2')).toBe('S1-3.20');
    expect(addedRowPath(rows, 'importo.S1-3.2', 'S1-3.20')).toBe('S1-3.2');
  });

  it('nessuna corrispondenza -> fallback', () => {
    expect(addedRowPath(['S1-3.0', 'S1-3.1'], 'importo.S1-3', 'S1-3.0')).toBe('S1-3.0');
  });
});

describe('addedRowPath — percorsi annidati piu profondi', () => {
  it('tre anelli: decide solo l ultimo', () => {
    const rows = ['S1-0.0,S1-4.1,S1-9.0', 'S1-0.0,S1-4.1,S1-9.1'];
    expect(addedRowPath(rows, 'x.S1-9.1', rows[0])).toBe(rows[1]);
  });

  it('scope intermedio non e l ultimo: currField S1-4.1 -> fallback', () => {
    const rows = ['S1-0.0,S1-4.1,S1-9.0', 'S1-0.0,S1-4.1,S1-9.1'];
    expect(addedRowPath(rows, 'x.S1-4.1', rows[0])).toBe(rows[0]);
  });
});

describe('addedRowPath — bordi', () => {
  it('lista vuota -> fallback', () => {
    expect(addedRowPath([], 'descrizione.S1-9.1', R0)).toBe(R0);
  });

  it('lista vuota e fallback null -> null', () => {
    expect(addedRowPath([], 'descrizione.S1-9.1', null)).toBeNull();
  });

  it('fallback null e nessuna corrispondenza -> null (non undefined, non la prima riga)', () => {
    expect(addedRowPath([R0, R1], 'dataReg.S1-0', null)).toBeNull();
  });

  it('fallback null e currField assente -> null', () => {
    expect(addedRowPath([R0, R1], undefined, null)).toBeNull();
  });

  it('fallback null ma corrispondenza -> la riga', () => {
    expect(addedRowPath([R0, R1], 'descrizione.S1-9.1', null)).toBe(R1);
  });

  it('fallback restituito invariato anche se non e fra le righe', () => {
    expect(addedRowPath([R0, R1], 'dataReg.S1-0', 'S1-7.3')).toBe('S1-7.3');
  });

  it('fallback stringa vuota restituito invariato', () => {
    expect(addedRowPath([R0, R1], null, '')).toBe('');
  });
});

describe('addedRowPath — purezza', () => {
  it('non muta l array (congelato: nessuna eccezione, stesso contenuto)', () => {
    const rows = Object.freeze([R1, R0, R2]);
    const copy = [...rows];
    expect(() => addedRowPath(rows, 'descrizione.S1-9.0', R1)).not.toThrow();
    expect([...rows]).toEqual(copy);
  });

  it('non muta l array anche nel ramo fallback', () => {
    const rows = [R2, R1, R0];
    const copy = [...rows];
    addedRowPath(rows, 'dataReg.S1-0', R0);
    addedRowPath(rows, null, R0);
    expect(rows).toEqual(copy);
  });

  it('stessi argomenti -> stesso risultato (nessuno stato fra le chiamate)', () => {
    const rows = [R0, R1];
    const a = addedRowPath(rows, 'descrizione.S1-9.1', R0);
    const b = addedRowPath(rows, 'descrizione.S1-9.1', R0);
    const c = addedRowPath(rows, null, R0);
    const d = addedRowPath(rows, 'descrizione.S1-9.1', R0);
    expect([a, b, c, d]).toEqual([R1, R1, R0, R1]);
  });
});
