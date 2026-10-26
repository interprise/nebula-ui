import { describe, it, expect } from 'vitest';
import { staleSelection, releasedEditRow } from './editRowLifetime';

// SXADV-6144/6146: la riga in modifica (pannello di riga) viaggia come navpath e
// postPath. Se punta a una riga di una lista non piu' a schermo (documento nuovo
// con lista vuota, cambio scheda, nodo d'albero riselezionato) il server risponde
// "Sessione non valida". Questi due helper dicono quando lasciarla andare.

const R0 = 'S1-0.0,S1-9.0';
const R1 = 'S1-0.0,S1-9.1';
const R2 = 'S1-0.0,S1-9.2';
const ALTRA = 'S1-0.0,S1-12.0'; // riga di un'altra lista

describe('staleSelection: selezione da lasciare', () => {
  it('nessuna selezione: mai stantia', () => {
    expect(staleSelection(null, [R0, R1], false)).toBe(false);
    expect(staleSelection(null, [], false)).toBe(false);
    expect(staleSelection(null, [], true)).toBe(false);
  });

  it('riga selezionata ancora nella lista: resta', () => {
    expect(staleSelection(R1, [R0, R1, R2], false)).toBe(false);
  });

  it('riga selezionata non piu nella lista: stantia', () => {
    expect(staleSelection(R2, [R0, R1], false)).toBe(true);
  });

  it('lista vuota (documento nuovo) con selezione: stantia', () => {
    expect(staleSelection(R0, [], false)).toBe(true);
  });

  it('riga di un\'altra lista: stantia', () => {
    expect(staleSelection(ALTRA, [R0, R1], false)).toBe(true);
  });

  it('cancellazione in attesa del server: mai stantia', () => {
    expect(staleSelection(R2, [R0, R1], true)).toBe(false);
    expect(staleSelection(R0, [], true)).toBe(false);
    expect(staleSelection(R1, [R0, R1], true)).toBe(false);
  });

  it('confronto esatto: un prefisso o un percorso piu lungo non basta', () => {
    // S1-9.1 non e' S1-9.10 ne' S1-9.1 con un livello in piu'
    expect(staleSelection('S1-0.0,S1-9.1', ['S1-0.0,S1-9.10'], false)).toBe(true);
    expect(staleSelection('S1-0.0,S1-9.1', ['S1-0.0,S1-9.1,S1-14.0'], false)).toBe(true);
    expect(staleSelection('S1-0.0,S1-9.10', ['S1-0.0,S1-9.1'], false)).toBe(true);
  });

  it('stessa riga di un\'altra sessione: stantia', () => {
    expect(staleSelection('S2-0.0,S2-9.0', ['S1-0.0,S1-9.0'], false)).toBe(true);
  });

  it('non tocca l\'array dei percorsi', () => {
    const paths = Object.freeze([R0, R1]);
    expect(staleSelection(R2, paths, false)).toBe(true);
    expect(paths).toEqual([R0, R1]);
  });

  it('stessi argomenti, stesso esito', () => {
    const a = staleSelection(R2, [R0, R1], false);
    const b = staleSelection(R2, [R0, R1], false);
    expect(a).toBe(b);
  });
});

describe('releasedEditRow: la lista che se ne va', () => {
  it('libera la riga che mostrava: null', () => {
    expect(releasedEditRow(R1, R1)).toBeNull();
  });

  it('un\'altra lista ha selezionato nel frattempo: la riga resta', () => {
    expect(releasedEditRow(ALTRA, R1)).toBe(ALTRA);
  });

  it('nessuna riga in modifica: resta null', () => {
    expect(releasedEditRow(null, R1)).toBeNull();
    expect(releasedEditRow(null, null)).toBeNull();
  });

  it('lista senza riga da liberare (null): non cambia niente', () => {
    expect(releasedEditRow(R1, null)).toBe(R1);
  });

  it('confronto esatto, non per prefisso', () => {
    expect(releasedEditRow('S1-0.0,S1-9.10', 'S1-0.0,S1-9.1')).toBe('S1-0.0,S1-9.10');
    expect(releasedEditRow('S12-0.0,S12-9.1', 'S1-0.0,S1-9.1')).toBe('S12-0.0,S12-9.1');
  });

  it('idempotente: liberare due volte da lo stesso esito', () => {
    const una = releasedEditRow(R1, R1);
    expect(releasedEditRow(una, R1)).toBeNull();
    const altra = releasedEditRow(ALTRA, R1);
    expect(releasedEditRow(altra, R1)).toBe(ALTRA);
  });
});
