import { describe, it, expect, beforeEach } from 'vitest';
import {
  rememberRow,
  recallRow,
  forgetAllRows,
  findRememberedRow,
} from './rowSelectionMemory';

// SXADV-5957: si clicca una riga di lista, si va al dettaglio, si torna con
// "« Ritorno un passo indietro": la riga da cui si era entrati deve tornare
// evidenziata (record-group-selected). Il client ricorda il percorso della
// riga per lista (chiave = sid + nome vista) e al ritorno lo cerca fra le
// righe ora in lista.
//
// 5957.2: in una lista incorporata in un tab il server ricrea il viewstate
// della lista al ritorno. Cliccato S1-0.7,S1-9.0,S1-10.1, al ritorno la stessa
// riga e' S1-0.7,S1-9.0,S1-21.1: cambia solo il viewstate dell'ULTIMO
// segmento, il padre resta uguale. Una lista di primo livello (un segmento)
// col viewstate cambiato e' invece un'altra ricerca: niente evidenza.

describe('rememberRow / recallRow', () => {
  beforeEach(() => forgetAllRows());

  it('ricorda il percorso per chiave', () => {
    rememberRow('S1:fattureList', 'S1-0.7');
    expect(recallRow('S1:fattureList')).toBe('S1-0.7');
  });

  it('una chiave mai vista non ha riga', () => {
    expect(recallRow('S1:mai')).toBeUndefined();
  });

  it('chiavi diverse non si mescolano (stessa vista in due sid, viste diverse)', () => {
    rememberRow('S1:fattureList', 'S1-0.7');
    rememberRow('S2:fattureList', 'S2-0.3');
    rememberRow('S1:righeFatturaList', 'S1-0.7,S1-9.0,S1-10.1');
    expect(recallRow('S1:fattureList')).toBe('S1-0.7');
    expect(recallRow('S2:fattureList')).toBe('S2-0.3');
    expect(recallRow('S1:righeFatturaList')).toBe('S1-0.7,S1-9.0,S1-10.1');
  });

  it("l'ultima riga ricordata sostituisce la precedente", () => {
    rememberRow('S1:fattureList', 'S1-0.7');
    rememberRow('S1:fattureList', 'S1-0.2');
    expect(recallRow('S1:fattureList')).toBe('S1-0.2');
  });

  it('rememberRow(null) dimentica la riga', () => {
    rememberRow('S1:fattureList', 'S1-0.7');
    rememberRow('S1:fattureList', null);
    expect(recallRow('S1:fattureList')).toBeUndefined();
  });

  it('rememberRow(undefined) dimentica la riga', () => {
    rememberRow('S1:fattureList', 'S1-0.7');
    rememberRow('S1:fattureList', undefined);
    expect(recallRow('S1:fattureList')).toBeUndefined();
  });

  it('dimenticare una chiave lascia stare le altre', () => {
    rememberRow('S1:fattureList', 'S1-0.7');
    rememberRow('S1:righeFatturaList', 'S1-0.7,S1-9.0,S1-10.1');
    rememberRow('S1:fattureList', null);
    expect(recallRow('S1:fattureList')).toBeUndefined();
    expect(recallRow('S1:righeFatturaList')).toBe('S1-0.7,S1-9.0,S1-10.1');
  });

  it('dimenticare una chiave mai vista non lancia', () => {
    expect(() => rememberRow('S1:mai', null)).not.toThrow();
    expect(recallRow('S1:mai')).toBeUndefined();
  });

  it('forgetAllRows svuota tutto', () => {
    rememberRow('S1:a', 'S1-0.1');
    rememberRow('S2:b', 'S2-0.2');
    forgetAllRows();
    expect(recallRow('S1:a')).toBeUndefined();
    expect(recallRow('S2:b')).toBeUndefined();
  });
});

describe('findRememberedRow — uguaglianza esatta', () => {
  it('primo livello: la stessa riga e\' ancora in lista', () => {
    expect(findRememberedRow('S1-0.7', ['S1-0.5', 'S1-0.6', 'S1-0.7', 'S1-0.8'])).toBe('S1-0.7');
  });

  it('incorporata: percorso identico', () => {
    const p = 'S1-0.7,S1-9.0,S1-10.1';
    expect(findRememberedRow(p, ['S1-0.7,S1-9.0,S1-10.0', p])).toBe(p);
  });

  it("l'esatto vince sul rilassato, qualunque sia l'ordine dei candidati", () => {
    const stored = 'S1-0.7,S1-9.0,S1-10.1';
    const relaxed = 'S1-0.7,S1-9.0,S1-21.1';
    expect(findRememberedRow(stored, [relaxed, stored])).toBe(stored);
    expect(findRememberedRow(stored, [stored, relaxed])).toBe(stored);
  });

  it("l'esatto vince anche quando i rilassati sarebbero piu' d'uno (niente ambiguita')", () => {
    const stored = 'S1-0.7,S1-9.0,S1-10.1';
    expect(
      findRememberedRow(stored, ['S1-0.7,S1-9.0,S1-21.1', stored, 'S1-0.7,S1-9.0,S1-22.1']),
    ).toBe(stored);
  });
});

describe('findRememberedRow — lista incorporata ricreata (5957.2)', () => {
  it('il percorso vero del ticket: 10 -> 21 nell\'ultimo segmento', () => {
    const stored = 'S1-0.7,S1-9.0,S1-10.1';
    const now = ['S1-0.7,S1-9.0,S1-21.0', 'S1-0.7,S1-9.0,S1-21.1', 'S1-0.7,S1-9.0,S1-21.2'];
    expect(findRememberedRow(stored, now)).toBe('S1-0.7,S1-9.0,S1-21.1');
  });

  it('funziona anche con due soli segmenti', () => {
    expect(findRememberedRow('S1-9.0,S1-10.3', ['S1-9.0,S1-21.2', 'S1-9.0,S1-21.3'])).toBe(
      'S1-9.0,S1-21.3',
    );
  });

  it('viewstate che cambia numero di cifre (9 -> 123)', () => {
    expect(findRememberedRow('S1-0.7,S1-9.1', ['S1-0.7,S1-123.1'])).toBe('S1-0.7,S1-123.1');
  });

  it('padre diverso nel primo segmento (altra fattura) -> null', () => {
    expect(findRememberedRow('S1-0.7,S1-9.0,S1-10.1', ['S1-0.8,S1-9.0,S1-21.1'])).toBeNull();
  });

  it('padre diverso nel segmento intermedio (S1-9.1) -> null', () => {
    expect(findRememberedRow('S1-0.7,S1-9.0,S1-10.1', ['S1-0.7,S1-9.1,S1-21.1'])).toBeNull();
  });

  it('segmento intermedio con viewstate diverso: il rilassamento vale solo per l\'ultimo -> null', () => {
    expect(findRememberedRow('S1-0.7,S1-9.0,S1-10.1', ['S1-0.7,S1-12.0,S1-21.1'])).toBeNull();
  });

  it('riga diversa nell\'ultimo segmento -> null', () => {
    expect(
      findRememberedRow('S1-0.7,S1-9.0,S1-10.1', ['S1-0.7,S1-9.0,S1-21.0', 'S1-0.7,S1-9.0,S1-21.2']),
    ).toBeNull();
  });

  it('sid diverso nell\'ultimo segmento -> null', () => {
    expect(findRememberedRow('S1-0.7,S1-9.0,S1-10.1', ['S1-0.7,S1-9.0,S2-21.1'])).toBeNull();
  });

  it('numero di segmenti diverso -> null', () => {
    const stored = 'S1-0.7,S1-9.0,S1-10.1';
    expect(findRememberedRow(stored, ['S1-0.7,S1-21.1'])).toBeNull();
    expect(findRememberedRow(stored, ['S1-0.7,S1-9.0,S1-10.1,S1-30.1'])).toBeNull();
    expect(findRememberedRow(stored, ['S1-21.1'])).toBeNull();
  });

  it('ambiguo: due candidati rilassati -> null', () => {
    expect(
      findRememberedRow('S1-0.7,S1-9.0,S1-10.1', ['S1-0.7,S1-9.0,S1-21.1', 'S1-0.7,S1-9.0,S1-22.1']),
    ).toBeNull();
  });

  it('indice di riga a piu\' cifre: .1 non corrisponde a .12 ne\' a .10', () => {
    const stored = 'S1-0.7,S1-9.0,S1-10.1';
    expect(
      findRememberedRow(stored, ['S1-0.7,S1-9.0,S1-21.12', 'S1-0.7,S1-9.0,S1-21.10']),
    ).toBeNull();
  });

  it('indice di riga a piu\' cifre: .12 trova .12 e non .1', () => {
    const stored = 'S1-0.7,S1-9.0,S1-10.12';
    expect(
      findRememberedRow(stored, ['S1-0.7,S1-9.0,S1-21.1', 'S1-0.7,S1-9.0,S1-21.12']),
    ).toBe('S1-0.7,S1-9.0,S1-21.12');
  });

  it('il padre si confronta per intero: S1-0.7 non corrisponde a S1-0.70', () => {
    expect(findRememberedRow('S1-0.7,S1-10.1', ['S1-0.70,S1-21.1'])).toBeNull();
  });

  it('sid a piu\' cifre: S1 non corrisponde a S11 nell\'ultimo segmento', () => {
    expect(findRememberedRow('S1-0.7,S1-10.1', ['S1-0.7,S11-21.1'])).toBeNull();
  });
});

describe('findRememberedRow — primo livello', () => {
  it('viewstate cambiato: e\' un\'altra ricerca, niente evidenza', () => {
    expect(findRememberedRow('S1-0.7', ['S1-3.6', 'S1-3.7', 'S1-3.8'])).toBeNull();
  });

  it('viewstate cambiato con una sola riga candidata (niente ambiguita\') resta null', () => {
    expect(findRememberedRow('S1-0.7', ['S1-3.7'])).toBeNull();
  });

  it('la riga ricordata non c\'e\' piu\' (fuori pagina) -> null', () => {
    expect(findRememberedRow('S1-0.7', ['S1-0.0', 'S1-0.1', 'S1-0.2'])).toBeNull();
  });

  it('.1 non corrisponde a .12', () => {
    expect(findRememberedRow('S1-0.1', ['S1-0.12', 'S1-0.10', 'S1-0.11'])).toBeNull();
  });
});

describe('findRememberedRow — candidati vuoti e input malformati', () => {
  it('nessun candidato -> null (primo livello)', () => {
    expect(findRememberedRow('S1-0.7', [])).toBeNull();
  });

  it('nessun candidato -> null (incorporata)', () => {
    expect(findRememberedRow('S1-0.7,S1-9.0,S1-10.1', [])).toBeNull();
  });

  it('percorso ricordato vuoto -> null senza lanciare', () => {
    expect(() => findRememberedRow('', ['S1-0.7'])).not.toThrow();
    expect(findRememberedRow('', ['S1-0.7'])).toBeNull();
  });

  it.each([
    ['ultimo segmento senza "-"', 'S1-0.7,S1'],
    ['ultimo segmento senza "."', 'S1-0.7,S1-10'],
    ['ultimo segmento senza "-" ne\' "."', 'S1-0.7,xyz'],
    ['segmento vuoto in coda', 'S1-0.7,'],
    ['solo virgole', ',,'],
  ])('ricordato malformato (%s) -> null senza lanciare', (_label, stored) => {
    const candidates = ['S1-0.7,S1-21.1', 'S1-0.7,S1-21', 'S1-0.7'];
    expect(() => findRememberedRow(stored, candidates)).not.toThrow();
    // Nessuno dei candidati e' uguale al ricordato, quindi l'unico esito
    // corretto e' null: il rilassamento non deve inventarsi una riga.
    expect(findRememberedRow(stored, candidates)).toBeNull();
  });

  it.each([
    ['vuoto', ''],
    ['senza "-"', 'S1-0.7,S121.1'],
    ['senza "."', 'S1-0.7,S1-211'],
    ['segmento vuoto in coda', 'S1-0.7,'],
    ['spazzatura', 'abc'],
  ])('candidato malformato (%s) accanto a quello buono: si trova il buono', (_label, bad) => {
    const stored = 'S1-0.7,S1-10.1';
    expect(() => findRememberedRow(stored, [bad, 'S1-0.7,S1-21.1'])).not.toThrow();
    expect(findRememberedRow(stored, [bad, 'S1-0.7,S1-21.1'])).toBe('S1-0.7,S1-21.1');
  });

  it.each([
    ['vuoto', ''],
    ['senza "-"', 'S1-0.7,S121.1'],
    ['senza "."', 'S1-0.7,S1-211'],
    ['spazzatura', 'abc'],
  ])('solo candidati malformati (%s) -> null senza lanciare', (_label, bad) => {
    expect(() => findRememberedRow('S1-0.7,S1-10.1', [bad])).not.toThrow();
    expect(findRememberedRow('S1-0.7,S1-10.1', [bad])).toBeNull();
  });
});

// Terzo parametro `incorporata`: chi chiama dice se la lista e' incorporata in
// un tab (viewstate ricreato al ritorno, vale il match rilassato) o a pagina
// intera. Una lista a pagina intera aperta da un dettaglio ha comunque un
// percorso a piu' segmenti, ma un viewstate diverso li' e' un'altra ricerca:
// con `incorporata` = false vale SOLO l'uguaglianza esatta.
describe('findRememberedRow — terzo parametro incorporata', () => {
  const stored = 'S1-0.7,S1-9.0,S1-10.1';
  const tornata = ['S1-0.7,S1-9.0,S1-21.0', 'S1-0.7,S1-9.0,S1-21.1', 'S1-0.7,S1-9.0,S1-21.2'];

  it('il percorso del ticket con false -> null (niente match rilassato)', () => {
    expect(findRememberedRow(stored, tornata, false)).toBeNull();
  });

  it('il percorso del ticket con true -> la riga col viewstate nuovo', () => {
    expect(findRememberedRow(stored, tornata, true)).toBe('S1-0.7,S1-9.0,S1-21.1');
  });

  it('omesso equivale a true sul percorso del ticket', () => {
    expect(findRememberedRow(stored, tornata)).toBe(findRememberedRow(stored, tornata, true));
    expect(findRememberedRow(stored, tornata)).toBe('S1-0.7,S1-9.0,S1-21.1');
  });

  it('omesso equivale a true anche quando la risposta e\' null (ambiguita\')', () => {
    const ambigui = ['S1-0.7,S1-9.0,S1-21.1', 'S1-0.7,S1-9.0,S1-22.1'];
    expect(findRememberedRow(stored, ambigui)).toBeNull();
    expect(findRememberedRow(stored, ambigui, true)).toBeNull();
  });

  it('esatto a piu\' segmenti con false -> trovato', () => {
    const candidates = ['S1-0.7,S1-9.0,S1-10.0', stored, 'S1-0.7,S1-9.0,S1-10.2'];
    expect(findRememberedRow(stored, candidates, false)).toBe(stored);
  });

  it('esatto a un segmento con false -> trovato', () => {
    expect(findRememberedRow('S1-0.7', ['S1-0.6', 'S1-0.7', 'S1-0.8'], false)).toBe('S1-0.7');
  });

  it('esatto con false vince anche se ci sono candidati che il rilassato accetterebbe', () => {
    const candidates = ['S1-0.7,S1-9.0,S1-21.1', stored];
    expect(findRememberedRow(stored, candidates, false)).toBe(stored);
  });

  it('a due segmenti con false: viewstate cambiato nell\'ultimo -> null', () => {
    expect(findRememberedRow('S1-0.7,S1-10.1', ['S1-0.7,S1-21.1'], false)).toBeNull();
  });

  it('a un segmento con false: viewstate cambiato -> null (come con true)', () => {
    expect(findRememberedRow('S1-0.7', ['S1-3.7'], false)).toBeNull();
    expect(findRememberedRow('S1-0.7', ['S1-3.7'], true)).toBeNull();
  });

  it('false con ricordato vuoto -> null senza lanciare', () => {
    expect(() => findRememberedRow('', ['S1-0.7'], false)).not.toThrow();
    expect(findRememberedRow('', ['S1-0.7'], false)).toBeNull();
  });

  it('false senza candidati -> null', () => {
    expect(findRememberedRow(stored, [], false)).toBeNull();
  });

  it.each([
    ['vuoto', ''],
    ['senza "-"', 'S1-0.7,S1-9.0,S121.1'],
    ['senza "."', 'S1-0.7,S1-9.0,S1-211'],
    ['segmento vuoto in coda', 'S1-0.7,S1-9.0,'],
    ['solo virgole', ',,'],
    ['spazzatura', 'abc'],
  ])('false con candidato malformato (%s) non lancia e non inventa una riga', (_label, bad) => {
    expect(() => findRememberedRow(stored, [bad], false)).not.toThrow();
    expect(findRememberedRow(stored, [bad], false)).toBeNull();
    // Accanto all'esatto, l'esatto si trova comunque.
    expect(findRememberedRow(stored, [bad, stored], false)).toBe(stored);
  });

  it.each([
    ['ultimo segmento senza "-"', 'S1-0.7,S1'],
    ['ultimo segmento senza "."', 'S1-0.7,S1-10'],
    ['segmento vuoto in coda', 'S1-0.7,'],
  ])('false con ricordato malformato (%s): null, o se stesso se c\'e\' uguale', (_label, bad) => {
    expect(() => findRememberedRow(bad, ['S1-0.7,S1-21.1'], false)).not.toThrow();
    expect(findRememberedRow(bad, ['S1-0.7,S1-21.1'], false)).toBeNull();
    expect(findRememberedRow(bad, [bad], false)).toBe(bad);
  });
});
