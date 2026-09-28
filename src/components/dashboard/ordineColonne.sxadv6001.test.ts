import { describe, it, expect, afterEach } from 'vitest';
import {
  nomiInOrdine,
  permuta,
  registraOrdineColonne,
  leggiOrdineColonne,
} from './ordineColonne';

// SXADV-6001.0: il widget creato da una lista conserva l'ordine delle colonne che
// l'utente ha dato trascinandole in AG Grid.

describe('SXADV-6001 nomiInOrdine', () => {
  const nomi = ['a', 'b', 'c', 'd'];

  it('ordine invariato (indici crescenti) → null', () => {
    expect(nomiInOrdine(['col_0', 'col_1', 'col_2', 'col_3'], nomi)).toBeNull();
  });

  it('crescente con buchi → null', () => {
    expect(nomiInOrdine(['col_0', 'col_2', 'col_3'], nomi)).toBeNull();
  });

  it('colonne spostate → nomi nell\'ordine a video', () => {
    expect(nomiInOrdine(['col_2', 'col_0', 'col_1', 'col_3'], nomi)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('id non col_<n> ignorati', () => {
    expect(
      nomiInOrdine(
        ['_selnav', 'col_1', 'cont_1_2', 'col_x', 'col_0', 'col_-1', 'col_1a', 'col_+2', 'col_ 2', 'col_1.0'],
        nomi,
      ),
    ).toEqual(['b', 'a']);
  });

  it('solo id estranei → null', () => {
    expect(nomiInOrdine(['_selnav', 'cont_1_2', 'col_x'], nomi)).toBeNull();
  });

  it('nessun campo → null', () => {
    expect(nomiInOrdine([], nomi)).toBeNull();
  });

  it('nome mancante/vuoto/fuori intervallo: colonna saltata', () => {
    const n = ['a', undefined, null, '', 'e'];
    expect(nomiInOrdine(['col_4', 'col_1', 'col_2', 'col_3', 'col_9', 'col_0'], n)).toEqual(['e', 'a']);
  });

  it('la crescenza si giudica sulle sole colonne tenute', () => {
    // col_3 (senza nome) sta davanti ma e' saltata: restano 0,2 crescenti
    expect(nomiInOrdine(['col_3', 'col_0', 'col_2'], ['a', 'b', 'c', undefined])).toBeNull();
  });

  it('nessuna colonna con nome → null', () => {
    expect(nomiInOrdine(['col_1', 'col_0'], [undefined, null])).toBeNull();
  });

  it('una sola colonna → null (niente da spostare)', () => {
    expect(nomiInOrdine(['col_2'], nomi)).toBeNull();
  });

  it('indice a piu\' cifre letto in decimale', () => {
    const molti = Array.from({ length: 12 }, (_, i) => `n${i}`);
    expect(nomiInOrdine(['col_10', 'col_2'], molti)).toEqual(['n10', 'n2']);
    expect(nomiInOrdine(['col_2', 'col_10'], molti)).toBeNull();
  });

  it('non muta gli argomenti', () => {
    const campi = Object.freeze(['col_1', 'col_0']);
    const n = Object.freeze(['a', 'b']);
    expect(nomiInOrdine(campi, n)).toEqual(['b', 'a']);
    expect(campi).toEqual(['col_1', 'col_0']);
    expect(n).toEqual(['a', 'b']);
  });
});

describe('SXADV-6001 permuta', () => {
  const el = ['a', 'b', 'c'];

  it('permutazione valida applicata', () => {
    expect(permuta(el, [2, 0, 1])).toEqual(['c', 'a', 'b']);
  });

  it('identita\' → copia uguale, non lo stesso array', () => {
    const r = permuta(el, [0, 1, 2]);
    expect(r).toEqual(el);
    expect(r).not.toBe(el);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['lunghezza diversa', [0, 1]],
    ['troppo lunga', [0, 1, 2, 0]],
    ['duplicati', [0, 0, 1]],
    ['fuori intervallo', [0, 1, 3]],
    ['negativo', [-1, 0, 1]],
    ['non intero', [0, 1.5, 2]],
    ['NaN', [0, NaN, 2]],
  ])('ordine non valido (%s) → copia invariata', (_n, ordine) => {
    const r = permuta(el, ordine as readonly number[] | null | undefined);
    expect(r).toEqual(['a', 'b', 'c']);
    expect(r).not.toBe(el);
  });

  it('elementi vuoti → []', () => {
    expect(permuta([], [])).toEqual([]);
    expect(permuta([], null)).toEqual([]);
    expect(permuta([], [0])).toEqual([]);
  });

  it('non muta gli argomenti', () => {
    const e = Object.freeze(['a', 'b']);
    const o = Object.freeze([1, 0]);
    expect(permuta(e, o)).toEqual(['b', 'a']);
    expect(e).toEqual(['a', 'b']);
    expect(o).toEqual([1, 0]);
  });

  it('copia superficiale: stessi oggetti', () => {
    const x = { v: 1 };
    const y = { v: 2 };
    const r = permuta([x, y], [1, 0]);
    expect(r[0]).toBe(y);
    expect(r[1]).toBe(x);
  });
});

describe('SXADV-6001 registro per sid', () => {
  const rimuovi: Array<() => void> = [];
  afterEach(() => {
    while (rimuovi.length) rimuovi.pop()!();
  });
  const reg = (sid: string, f: () => string[] | null) => {
    const u = registraOrdineColonne(sid, f);
    rimuovi.push(u);
    return u;
  };

  it('niente registrato → null', () => {
    expect(leggiOrdineColonne('S_mai')).toBeNull();
  });

  it('valore letto al momento della chiamata', () => {
    let attuale: string[] | null = ['a'];
    reg('S1', () => attuale);
    expect(leggiOrdineColonne('S1')).toEqual(['a']);
    attuale = ['b', 'a'];
    expect(leggiOrdineColonne('S1')).toEqual(['b', 'a']);
    attuale = null;
    expect(leggiOrdineColonne('S1')).toBeNull();
  });

  it('getter che lancia → null', () => {
    reg('S2', () => {
      throw new Error('griglia smontata');
    });
    expect(leggiOrdineColonne('S2')).toBeNull();
  });

  it('la seconda registrazione sostituisce la prima', () => {
    reg('S3', () => ['vecchio']);
    reg('S3', () => ['nuovo']);
    expect(leggiOrdineColonne('S3')).toEqual(['nuovo']);
  });

  it('deregistrare toglie la voce', () => {
    const u = registraOrdineColonne('S4', () => ['x']);
    u();
    expect(leggiOrdineColonne('S4')).toBeNull();
  });

  it('il deregistra vecchio non toglie la registrazione nuova', () => {
    const vecchio = registraOrdineColonne('S5', () => ['vecchio']);
    reg('S5', () => ['nuovo']);
    vecchio();
    expect(leggiOrdineColonne('S5')).toEqual(['nuovo']);
  });

  it('sid indipendenti', () => {
    reg('S6', () => ['sei']);
    const u7 = registraOrdineColonne('S7', () => ['sette']);
    expect(leggiOrdineColonne('S6')).toEqual(['sei']);
    expect(leggiOrdineColonne('S7')).toEqual(['sette']);
    u7();
    expect(leggiOrdineColonne('S7')).toBeNull();
    expect(leggiOrdineColonne('S6')).toEqual(['sei']);
  });
});
