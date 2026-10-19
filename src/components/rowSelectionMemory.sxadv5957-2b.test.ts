import { describe, it, expect } from 'vitest';
import { pageOfRememberedRow } from './rowSelectionMemory';

// SXADV-5957.2B: una lista incorporata in un tab (Righe fattura) e' paginata
// dal server. Il percorso di una riga e' viewstate + POSIZIONE ASSOLUTA nella
// collezione: S1-0.7,S1-9.0,S1-10.106 e' il rigo in posizione 106 (0-based)
// della lista con viewstate 10, sotto il documento S1-9.0. Con pageSize 100
// sta a pagina 2. L'utente va a pagina 2, apre il rigo e torna con "Ritorno
// un passo indietro": il server ricrea la lista con un viewstate nuovo (21) e
// la rimanda da pagina 1. findRememberedRow non trova il rigo, perche' non e'
// sulla pagina mostrata: pageOfRememberedRow dice su quale pagina sta, cosi'
// chi chiama puo' richiederla.

const PADRE = 'S1-0.7,S1-9.0,';

/** Le righe di una pagina: percorsi `<padre><sid>-<vs>.<pos>` per pos in [da, a]. */
function righe(vs: number, da: number, a: number, padre = PADRE, sid = 'S1'): string[] {
  const out: string[] = [];
  for (let p = da; p <= a; p++) out.push(`${padre}${sid}-${vs}.${p}`);
  return out;
}

/** Pagina 1 della lista ricreata col viewstate 21, pageSize 100. */
const PAGINA1_RICREATA = righe(21, 0, 99);

describe('pageOfRememberedRow: il caso di Elena', () => {
  it('rigo a pagina 2, lista ricreata (viewstate 21) mostrata da pagina 1 -> 2', () => {
    expect(pageOfRememberedRow('S1-0.7,S1-9.0,S1-10.106', PAGINA1_RICREATA, 100)).toBe(2);
  });

  it('rigo a pagina 3, lista ricreata mostrata da pagina 1 -> 3', () => {
    expect(pageOfRememberedRow('S1-0.7,S1-9.0,S1-10.250', PAGINA1_RICREATA, 100)).toBe(3);
  });

  it('rigo a pagina 11 (posizione 1050) -> 11', () => {
    expect(pageOfRememberedRow('S1-0.7,S1-9.0,S1-10.1050', PAGINA1_RICREATA, 100)).toBe(11);
  });

  it('stesso viewstate ma pagina diversa (lista NON ricreata) -> 2', () => {
    expect(pageOfRememberedRow('S1-0.7,S1-9.0,S1-10.106', righe(10, 0, 99), 100)).toBe(2);
  });

  it('lista mostrata a pagina 2, rigo ricordato a pagina 1 -> 1', () => {
    // Chi chiama confronta con la pagina corrente: qui la funzione dice solo dove sta.
    expect(pageOfRememberedRow('S1-0.7,S1-9.0,S1-10.5', righe(21, 100, 199), 100)).toBe(1);
  });

  it('pagina oltre le righe mostrate: non la limita (lo fa chi conosce totalPages)', () => {
    // Pagina mostrata con 37 righe, rigo ricordato in posizione 5000.
    expect(pageOfRememberedRow('S1-0.7,S1-9.0,S1-10.5000', righe(21, 0, 36), 100)).toBe(51);
  });
});

describe('pageOfRememberedRow: bordi di pagina (pageSize 100)', () => {
  // Pagina mostrata: righe 300..399 (pagina 4), cosi' nessuno dei ricordati e' gia' a video.
  const mostrata = righe(21, 300, 399);
  it.each([
    [0, 1],
    [99, 1],
    [100, 2],
    [199, 2],
    [200, 3],
    [299, 3],
  ])('posizione %i -> pagina %i', (pos, pagina) => {
    expect(pageOfRememberedRow(`${PADRE}S1-10.${pos}`, mostrata, 100)).toBe(pagina);
  });
});

describe('pageOfRememberedRow: pageSize diversi', () => {
  it('pageSize 20: posizione 19 -> 1, 20 -> 2, 45 -> 3', () => {
    const mostrata = righe(21, 100, 119);
    expect(pageOfRememberedRow(`${PADRE}S1-10.19`, mostrata, 20)).toBe(1);
    expect(pageOfRememberedRow(`${PADRE}S1-10.20`, mostrata, 20)).toBe(2);
    expect(pageOfRememberedRow(`${PADRE}S1-10.45`, mostrata, 20)).toBe(3);
  });

  it('pageSize 1: la pagina e\' la posizione + 1', () => {
    const mostrata = righe(21, 0, 0);
    expect(pageOfRememberedRow(`${PADRE}S1-10.1`, mostrata, 1)).toBe(2);
    expect(pageOfRememberedRow(`${PADRE}S1-10.7`, mostrata, 1)).toBe(8);
  });

  it('pageSize 50 col caso di Elena: posizione 106 -> 3', () => {
    expect(pageOfRememberedRow(`${PADRE}S1-10.106`, righe(21, 0, 49), 50)).toBe(3);
  });
});

describe('pageOfRememberedRow: rigo gia\' sulla pagina mostrata -> null', () => {
  it('stesso percorso esatto fra i candidati', () => {
    expect(pageOfRememberedRow(`${PADRE}S1-10.106`, righe(10, 100, 199), 100)).toBeNull();
  });

  it('stessa posizione con viewstate nuovo (lista ricreata ma gia\' sulla pagina giusta)', () => {
    expect(pageOfRememberedRow(`${PADRE}S1-10.106`, righe(21, 100, 199), 100)).toBeNull();
  });

  it('rigo a pagina 1 e lista ricreata mostrata da pagina 1', () => {
    expect(pageOfRememberedRow(`${PADRE}S1-10.42`, PAGINA1_RICREATA, 100)).toBeNull();
  });

  it('gia\' presente anche con un pageSize che direbbe un\'altra pagina', () => {
    // La presenza vince sul conto: se la riga e' a video non c'e' pagina da chiedere.
    expect(pageOfRememberedRow(`${PADRE}S1-10.106`, righe(21, 100, 199), 20)).toBeNull();
  });
});

describe('pageOfRememberedRow: un\'altra lista o un altro documento -> null', () => {
  it('documento diverso (padre diverso)', () => {
    expect(
      pageOfRememberedRow('S1-0.7,S1-9.0,S1-10.106', righe(21, 0, 99, 'S1-0.7,S1-9.1,'), 100),
    ).toBeNull();
  });

  it('padre diverso al primo segmento', () => {
    expect(
      pageOfRememberedRow('S1-0.7,S1-9.0,S1-10.106', righe(21, 0, 99, 'S1-0.8,S1-9.0,'), 100),
    ).toBeNull();
  });

  it('sid diverso nell\'ultimo segmento', () => {
    expect(
      pageOfRememberedRow('S1-0.7,S1-9.0,S1-10.106', righe(21, 0, 99, PADRE, 'S2'), 100),
    ).toBeNull();
  });

  it('candidati con un segmento in piu\' (una lista annidata sotto una riga)', () => {
    const annidati = righe(30, 0, 99, 'S1-0.7,S1-9.0,S1-21.0,');
    expect(pageOfRememberedRow('S1-0.7,S1-9.0,S1-10.106', annidati, 100)).toBeNull();
  });

  it('candidati con un segmento in meno (la lista del livello sopra)', () => {
    const sopra = righe(9, 0, 99, 'S1-0.7,');
    expect(pageOfRememberedRow('S1-0.7,S1-9.0,S1-10.106', sopra, 100)).toBeNull();
  });

  it('basta un candidato della stessa lista fra altri estranei', () => {
    const misti = ['S2-0.1', 'S1-0.7,S1-9.1,S1-21.0', `${PADRE}S1-21.0`, `${PADRE}S1-21.1`];
    expect(pageOfRememberedRow(`${PADRE}S1-10.106`, misti, 100)).toBe(2);
  });
});

describe('pageOfRememberedRow: trappole di prefisso -> null', () => {
  it('padre S1-0.7, non e\' S1-0.70,', () => {
    expect(
      pageOfRememberedRow('S1-0.7,S1-10.106', righe(21, 0, 99, 'S1-0.70,'), 100),
    ).toBeNull();
  });

  it('padre S1-0.70, non e\' S1-0.7,', () => {
    expect(
      pageOfRememberedRow('S1-0.70,S1-10.106', righe(21, 0, 99, 'S1-0.7,'), 100),
    ).toBeNull();
  });

  it('padre S1-0.7, non e\' S11-0.7,', () => {
    expect(
      pageOfRememberedRow('S1-0.7,S1-10.106', righe(21, 0, 99, 'S11-0.7,'), 100),
    ).toBeNull();
  });

  it('sid S1 non e\' S11', () => {
    expect(
      pageOfRememberedRow('S1-0.7,S1-10.106', righe(21, 0, 99, 'S1-0.7,', 'S11'), 100),
    ).toBeNull();
  });

  it('sid S11 non e\' S1', () => {
    expect(
      pageOfRememberedRow('S1-0.7,S11-10.106', righe(21, 0, 99, 'S1-0.7,', 'S1'), 100),
    ).toBeNull();
  });

  it('padre che contiene quello ricordato come suffisso non e\' lo stesso padre', () => {
    expect(
      pageOfRememberedRow('S1-0.7,S1-10.106', righe(21, 0, 99, 'S1-0.3,S1-0.7,'), 100),
    ).toBeNull();
  });
});

describe('pageOfRememberedRow: lista di primo livello -> null', () => {
  it('un solo segmento: un viewstate diverso e\' un\'altra ricerca', () => {
    const cand = Array.from({ length: 100 }, (_, i) => `S1-21.${i}`);
    expect(pageOfRememberedRow('S1-10.106', cand, 100)).toBeNull();
  });

  it('un solo segmento anche con lo stesso viewstate', () => {
    const cand = Array.from({ length: 100 }, (_, i) => `S1-10.${i}`);
    expect(pageOfRememberedRow('S1-10.106', cand, 100)).toBeNull();
  });
});

describe('pageOfRememberedRow: input malformati -> null', () => {
  it('stored vuoto', () => {
    expect(pageOfRememberedRow('', PAGINA1_RICREATA, 100)).toBeNull();
  });

  it.each([
    ['ultimo segmento senza posizione', 'S1-0.7,S1-9.0,S1-10'],
    ['ultimo segmento senza viewstate', 'S1-0.7,S1-9.0,S1-.106'],
    ['ultimo segmento senza sid', 'S1-0.7,S1-9.0,-10.106'],
    ['posizione non numerica', 'S1-0.7,S1-9.0,S1-10.abc'],
    ['viewstate non numerico', 'S1-0.7,S1-9.0,S1-x.106'],
    ['ultimo segmento vuoto (virgola finale)', 'S1-0.7,S1-9.0,'],
    ['ultimo segmento senza trattino', 'S1-0.7,S1-9.0,S110.106'],
    ['posizione negativa', 'S1-0.7,S1-9.0,S1-10.-1'],
    ['coda dopo la posizione', 'S1-0.7,S1-9.0,S1-10.106x'],
  ])('%s', (_nome, stored) => {
    expect(pageOfRememberedRow(stored, PAGINA1_RICREATA, 100)).toBeNull();
  });

  it.each([
    ['zero', 0],
    ['negativo', -100],
    ['NaN', Number.NaN],
  ])('pageSize %s', (_nome, size) => {
    expect(pageOfRememberedRow('S1-0.7,S1-9.0,S1-10.106', PAGINA1_RICREATA, size)).toBeNull();
  });

  it('candidati vuoti', () => {
    expect(pageOfRememberedRow('S1-0.7,S1-9.0,S1-10.106', [], 100)).toBeNull();
  });

  it('candidati della stessa lista ma con ultimo segmento malformato', () => {
    const malformati = [`${PADRE}S1-21`, `${PADRE}S1-21.x`, `${PADRE}S1-.3`];
    expect(pageOfRememberedRow('S1-0.7,S1-9.0,S1-10.106', malformati, 100)).toBeNull();
  });
});
