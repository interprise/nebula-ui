import { describe, it, expect } from 'vitest';
import { panelTableUnits } from './editPanelLayout';

// SXADV-5918: nel pannello di modifica riga un campo di testo con size enorme
// (colonna del DB: 240 o 2147483647) allargava la tabella e nascondeva i campi
// successivi. Il pannello passa a `table-layout: fixed` con un <colgroup> di
// `panelTableUnits(righe)` colonne di pari larghezza: ogni campo prende una quota
// proporzionale al suo colspan e nessuno puo' allargare la tabella.
//
// Ogni riga passata e' l'elenco dei colspan delle celle RESE di quella riga
// (header, riga principale, continuazioni, header di continuazione).

describe('panelTableUnits (SXADV-5918)', () => {
  it('caso Job: header e riga principale [5,30,20,5,10,5] -> 75', () => {
    const riga = [5, 30, 20, 5, 10, 5];
    expect(panelTableUnits([riga, [...riga]])).toBe(75);
  });

  it('una riga sola -> la sua somma', () => {
    expect(panelTableUnits([[5, 30, 20, 5, 10, 5]])).toBe(75);
  });

  it('righe con somme diverse (bande di continuazione) -> il massimo', () => {
    expect(
      panelTableUnits([
        [5, 30, 20], // header: 55
        [5, 30, 20], // riga principale: 55
        [40, 40], // continuazione piu' larga: 80
        [10], // header di continuazione: 10
      ]),
    ).toBe(80);
  });

  it('il massimo non dipende dall\'ordine delle righe', () => {
    expect(panelTableUnits([[80], [5, 30], [20, 20, 20]])).toBe(80);
    expect(panelTableUnits([[5, 30], [20, 20, 20], [80]])).toBe(80);
  });

  it('colspan undefined conta 1', () => {
    expect(panelTableUnits([[undefined, undefined, 3]])).toBe(5);
  });

  it('colspan 0 conta 1', () => {
    expect(panelTableUnits([[0, 0, 0]])).toBe(3);
  });

  it('colspan negativo conta 1', () => {
    expect(panelTableUnits([[-4, 2]])).toBe(3);
  });

  it('i colspan mancanti possono decidere quale riga e\' la piu\' larga', () => {
    // [undefined x5] = 5 contro [4] = 4
    expect(
      panelTableUnits([[undefined, undefined, undefined, undefined, undefined], [4]]),
    ).toBe(5);
  });

  it('nessuna riga -> 0', () => {
    expect(panelTableUnits([])).toBe(0);
  });

  it('solo righe vuote -> 0', () => {
    expect(panelTableUnits([[], []])).toBe(0);
  });

  it('righe vuote accanto a righe piene non contano', () => {
    expect(panelTableUnits([[], [2, 3], []])).toBe(5);
  });

  it('non modifica le righe ricevute', () => {
    const righe: Array<Array<number | undefined>> = [[undefined, 0, 2], [7]];
    const copia = JSON.parse(JSON.stringify(righe));
    panelTableUnits(righe);
    expect(JSON.parse(JSON.stringify(righe))).toEqual(copia);
  });
});
