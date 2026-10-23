import { describe, it, expect } from 'vitest';
import { listOwnerOf } from './rowSelectionMemory';

// SXADV-5957.2B: il proprietario di una lista e' il padre del suo percorso,
// tutto fino all'ULTIMA virgola compresa. Lo condividono la lista e i suoi
// righi (S1-...-14.0 e S1-...-14.126), e anche la lista ricreata al ritorno
// con un viewstate nuovo (S1-...-16.0): cambia solo l'ultimo segmento. Una
// griglia annidata nel dettaglio di un rigo ha invece per padre il rigo stesso
// (S1-14.126,), quindi un proprietario diverso. Una lista di primo livello non
// ha padre: nessun proprietario.

describe('listOwnerOf: il padre fino all\'ultima virgola', () => {
  it.each([
    ['lista Righe', 'S1-0.0,S1-11.0,S1-14.0', 'S1-0.0,S1-11.0,'],
    ['rigo della lista Righe', 'S1-0.0,S1-11.0,S1-14.126', 'S1-0.0,S1-11.0,'],
    ['lista Righe ricreata', 'S1-0.0,S1-11.0,S1-16.0', 'S1-0.0,S1-11.0,'],
    ['griglia Componenti annidata', 'S1-14.126,S1-15.0', 'S1-14.126,'],
    ['due segmenti', 'S1-0.7,S1-9.0', 'S1-0.7,'],
    ['sid a due cifre', 'S12-0.7,S12-9.3', 'S12-0.7,'],
  ])('%s: %s -> %s', (_nome, path, owner) => {
    expect(listOwnerOf(path)).toBe(owner);
  });
});

describe('listOwnerOf: stessa lista, stesso proprietario', () => {
  it('lista e suo rigo', () => {
    expect(listOwnerOf('S1-0.0,S1-11.0,S1-14.126')).toBe(listOwnerOf('S1-0.0,S1-11.0,S1-14.0'));
  });

  it('lista e lista ricreata con viewstate nuovo', () => {
    expect(listOwnerOf('S1-0.0,S1-11.0,S1-16.0')).toBe(listOwnerOf('S1-0.0,S1-11.0,S1-14.0'));
  });

  it('rigo cliccato e lista ricreata', () => {
    expect(listOwnerOf('S1-0.0,S1-11.0,S1-14.126')).toBe(listOwnerOf('S1-0.0,S1-11.0,S1-16.0'));
  });
});

describe('listOwnerOf: liste diverse, proprietari diversi', () => {
  it('la griglia annidata non e\' la lista del rigo', () => {
    expect(listOwnerOf('S1-14.126,S1-15.0')).not.toBe(listOwnerOf('S1-0.0,S1-11.0,S1-14.0'));
  });

  it('griglia annidata sotto il rigo, col percorso completo, non e\' la lista del rigo', () => {
    expect(listOwnerOf('S1-0.0,S1-11.0,S1-14.126,S1-15.0'))
      .not.toBe(listOwnerOf('S1-0.0,S1-11.0,S1-14.0'));
  });

  it('documento diverso', () => {
    expect(listOwnerOf('S1-0.0,S1-12.0,S1-14.0')).not.toBe(listOwnerOf('S1-0.0,S1-11.0,S1-14.0'));
  });

  it.each([
    ['S1-0.7, contro S1-0.70,', 'S1-0.7,S1-9.0', 'S1-0.70,S1-9.0'],
    ['S1-0.70, contro S1-0.7,', 'S1-0.70,S1-9.0', 'S1-0.7,S1-9.0'],
    ['S1 contro S11', 'S1-0.7,S1-9.0', 'S11-0.7,S11-9.0'],
    ['padre che ha l\'altro come suffisso', 'S1-0.7,S1-9.0', 'S1-0.3,S1-0.7,S1-9.0'],
  ])('trappola di prefisso: %s', (_nome, a, b) => {
    expect(listOwnerOf(a)).not.toBe(listOwnerOf(b));
    expect(listOwnerOf(a)).not.toBeNull();
    expect(listOwnerOf(b)).not.toBeNull();
  });
});

describe('listOwnerOf: niente proprietario -> null', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['stringa vuota', ''],
    ['lista di primo livello', 'S1-3.0'],
    ['rigo di primo livello', 'S1-3.42'],
  ])('%s', (_nome, path) => {
    expect(listOwnerOf(path as string | null | undefined)).toBeNull();
  });
});
