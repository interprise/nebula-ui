import { describe, it, expect } from 'vitest';
import { colonneMostrate, colonneAzione, type VistaTabella } from './vistaTabella';

// SXADV-6100.1 C4 — `colonneMostrate(vista, n, ordineIniziale, escluse?)` toglie `escluse`
// (le colonne di comando); se le `nascoste` spegnerebbero tutte le colonne rimaste, le
// `nascoste` non contano (almeno una resta). `colonneAzione(colonne)` da' l'insieme degli
// indici marcati `azione`.
//
// Oracolo: docs/sxadv-62-prove/SXADV6100_contratto.md (C2, C4, C5) e, per quello che 6100
// non cambia, COLONNE_contratto.md (V2: ordine completato, nascoste, almeno una resta).
// Chi prova non e' chi implementa.
//
// Decisioni della prova (dichiarate):
//   - «escluse» e' un insieme di indici in `colonne`; un indice fuori da [0, n) non toglie
//     niente e non fa esplodere.
//   - Con `escluse` assente o vuoto il risultato e' quello di prima del 6100.
//   - Il caso degenere «tutte le colonne sono di comando» il contratto non lo dice: la prova
//     accetta [] (niente da mostrare) e rifiuta solo che ricompaia un comando.

const S = (...i: number[]) => new Set<number>(i);
const v = (o: VistaTabella) => o;

describe('SXADV-6100.1 colonneAzione', () => {
  it('gli indici marcati azione: true, e solo quelli', () => {
    const cs: Array<{ item: string; azione?: boolean }> = [
      { item: 'a' },
      { item: 'b', azione: true },
      { item: 'c', azione: false },
      { item: 'd', azione: true },
    ];
    expect([...colonneAzione(cs)].sort()).toEqual([1, 3]);
  });

  it('nessuna marcata: insieme vuoto (anche su lista vuota)', () => {
    expect(colonneAzione([{ item: 'a' }, { item: 'b' }] as Array<{ item: string; azione?: boolean }>).size).toBe(0);
    expect(colonneAzione([]).size).toBe(0);
  });

  it('colonne null o undefined non esplodono e non contano', () => {
    expect([...colonneAzione([null, { azione: true }, undefined])]).toEqual([1]);
  });

  it('solo il booleano true conta (il server scrive "azione": true)', () => {
    const cs = [{ azione: true }, {}, { azione: undefined }] as Array<{ azione?: boolean }>;
    expect([...colonneAzione(cs)]).toEqual([0]);
  });
});

describe('SXADV-6100.1 C4 colonneMostrate con escluse', () => {
  it('senza escluse: come prima (ordine della lista)', () => {
    expect(colonneMostrate(null, 4)).toEqual([0, 1, 2, 3]);
    expect(colonneMostrate(null, 4, undefined, S())).toEqual([0, 1, 2, 3]);
  });

  it('le escluse spariscono, le altre restano nel loro ordine', () => {
    expect(colonneMostrate(null, 5, undefined, S(1, 3))).toEqual([0, 2, 4]);
  });

  it('con un ordine di chi guarda: le escluse spariscono anche se l\'ordine le nomina', () => {
    expect(colonneMostrate(v({ ordineColonne: [3, 1, 0, 2] }), 4, undefined, S(1))).toEqual([3, 0, 2]);
  });

  it('con ordineIniziale (6001.0): stesso ordine, meno le escluse', () => {
    expect(colonneMostrate(null, 4, [2, 3, 0, 1], S(3))).toEqual([2, 0, 1]);
  });

  it('la vista vince su ordineIniziale, e le escluse restano fuori', () => {
    expect(colonneMostrate(v({ ordineColonne: [1, 0, 2, 3] }), 4, [3, 2, 1, 0], S(0))).toEqual([1, 2, 3]);
  });

  it('nascoste ed escluse insieme: si tolgono tutte e due', () => {
    expect(colonneMostrate(v({ nascoste: [0] }), 4, undefined, S(2))).toEqual([1, 3]);
  });

  it('C2: gli indici restano quelli di colonne (nessuno slittamento dopo una esclusa)', () => {
    // colonna 1 di comando: le colonne 2 e 3 restano 2 e 3, non diventano 1 e 2
    const r = colonneMostrate(v({ nascoste: [3] }), 4, undefined, S(1));
    expect(r).toEqual([0, 2]);
  });

  it('almeno una resta: nascoste tutte le colonne non di comando -> le nascoste non contano', () => {
    // 3 colonne, la 2 e' un comando, l'utente ha nascosto 0 e 1
    const r = colonneMostrate(v({ nascoste: [0, 1] }), 3, undefined, S(2));
    expect(r).toEqual([0, 1]);
    expect(r).not.toContain(2);
  });

  it('tutte nascoste tranne una di comando: non ricompare il comando, tornano le colonne-dato', () => {
    const r = colonneMostrate(v({ nascoste: [0, 2, 3] }), 4, undefined, S(1));
    expect(r).not.toContain(1);
    expect(r).toEqual([0, 2, 3]);
  });

  it('almeno una resta, con un ordine di chi guarda: si torna a quell\'ordine meno le escluse', () => {
    const r = colonneMostrate(v({ ordineColonne: [2, 0, 1], nascoste: [0, 2] }), 3, undefined, S(1));
    expect(r).toEqual([2, 0]);
  });

  it('una sola colonna-dato e nascosta: resta lei', () => {
    expect(colonneMostrate(v({ nascoste: [0] }), 3, undefined, S(1, 2))).toEqual([0]);
  });

  it('escluse fuori campo (negativi, >= n, non interi) non tolgono niente e non esplodono', () => {
    expect(colonneMostrate(null, 3, undefined, S(-1, 3, 99, 1.5))).toEqual([0, 1, 2]);
  });

  it('vista null o undefined con escluse', () => {
    expect(colonneMostrate(null, 3, undefined, S(0))).toEqual([1, 2]);
    expect(colonneMostrate(undefined, 3, undefined, S(0))).toEqual([1, 2]);
  });

  it('vista illeggibile (non oggetto) con escluse: come senza vista', () => {
    expect(colonneMostrate('x' as unknown as VistaTabella, 3, undefined, S(2))).toEqual([0, 1]);
    expect(colonneMostrate([] as unknown as VistaTabella, 3, undefined, S(2))).toEqual([0, 1]);
  });

  it('ordineIniziale illeggibile o fuori campo: si torna all\'ordine della lista, meno le escluse', () => {
    expect(colonneMostrate(null, 3, 'boh', S(1))).toEqual([0, 2]);
    expect(colonneMostrate(null, 3, [7, 8, 9], S(1))).toEqual([0, 2]);
  });

  it('n = 0: niente colonne, niente errori', () => {
    expect(colonneMostrate(null, 0, undefined, S(0))).toEqual([]);
  });

  it('degenere: tutte le colonne sono comandi -> nessun comando a video', () => {
    const r = colonneMostrate(null, 2, undefined, S(0, 1));
    expect(r.filter((i) => i === 0 || i === 1)).toEqual([]);
  });

  it('non cambia gli argomenti (escluse, vista, ordineIniziale)', () => {
    const esc = S(1);
    const vista = v({ ordineColonne: [2, 1, 0], nascoste: [0] });
    const ini = [0, 1, 2];
    const prima = JSON.stringify(vista);
    colonneMostrate(vista, 3, ini, esc);
    expect([...esc]).toEqual([1]);
    expect(JSON.stringify(vista)).toBe(prima);
    expect(ini).toEqual([0, 1, 2]);
  });

  it('colonneAzione + colonneMostrate insieme: il giro che fa TabellaWidget', () => {
    const colonne = [
      { item: 'numDoc' },
      { item: 'visualizzaFE', tipo: 'SingleAction', azione: true },
      { item: 'cliente' },
      { item: 'print', tipo: 'ReportBar', azione: true },
    ];
    expect(colonneMostrate(null, colonne.length, undefined, colonneAzione(colonne))).toEqual([0, 2]);
  });
});
