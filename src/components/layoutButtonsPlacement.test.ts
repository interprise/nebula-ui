import { describe, it, expect } from 'vitest';
import { layoutButtonsPlacement, type LayoutButtonsPlacement } from './layoutButtonsPlacement';

// I comandi di layout di una lista (una-riga, zoom) non devono occupare una
// riga da soli: se la banda grid-actions non ha altro e c'e' la barra delle
// azioni di lista, passano nella barra. Senza barra restano nella banda come
// prima; se la banda ha contenuto proprio, restano li'. Senza comandi: 'none'.

const B = [false, true] as const;

type Row = [hasLayoutButtons: boolean, gridBandHasContent: boolean, hasListActions: boolean, expected: LayoutButtonsPlacement];

const truthTable: Row[] = [
  [false, false, false, 'none'],
  [false, false, true, 'none'],
  [false, true, false, 'none'],
  [false, true, true, 'none'],
  [true, false, false, 'grid-band'],
  [true, false, true, 'action-bar'],
  [true, true, false, 'grid-band'],
  [true, true, true, 'grid-band'],
];

describe('layoutButtonsPlacement: tabella di verita completa', () => {
  it.each(truthTable)(
    'comandi=%s, banda con contenuto=%s, azioni di lista=%s -> %s',
    (hasLayoutButtons, gridBandHasContent, hasListActions, expected) => {
      expect(layoutButtonsPlacement({ hasLayoutButtons, gridBandHasContent, hasListActions })).toBe(expected);
    },
  );
});

describe('layoutButtonsPlacement: invarianti', () => {
  const all = B.flatMap((l) => B.flatMap((g) => B.map((a) => ({ hasLayoutButtons: l, gridBandHasContent: g, hasListActions: a }))));

  it('senza comandi di layout il risultato e sempre none', () => {
    for (const input of all.filter((i) => !i.hasLayoutButtons)) {
      expect(layoutButtonsPlacement(input)).toBe('none');
    }
  });

  it('con comandi di layout il risultato non e mai none', () => {
    for (const input of all.filter((i) => i.hasLayoutButtons)) {
      expect(layoutButtonsPlacement(input)).not.toBe('none');
    }
  });

  it('mai action-bar senza azioni di lista', () => {
    for (const input of all.filter((i) => !i.hasListActions)) {
      expect(layoutButtonsPlacement(input)).not.toBe('action-bar');
    }
  });

  it('mai action-bar se la banda ha contenuto proprio (condivide gia la riga)', () => {
    for (const input of all.filter((i) => i.gridBandHasContent)) {
      expect(layoutButtonsPlacement(input)).not.toBe('action-bar');
    }
  });

  it('action-bar esattamente quando: comandi, banda vuota, azioni di lista', () => {
    for (const input of all) {
      const isActionBar = layoutButtonsPlacement(input) === 'action-bar';
      expect(isActionBar).toBe(input.hasLayoutButtons && !input.gridBandHasContent && input.hasListActions);
    }
  });

  it('senza barra delle azioni il comportamento e quello di prima (sempre la banda)', () => {
    for (const g of B) {
      expect(layoutButtonsPlacement({ hasLayoutButtons: true, gridBandHasContent: g, hasListActions: false })).toBe('grid-band');
    }
  });

  it('il risultato e sempre uno dei tre valori ammessi', () => {
    for (const input of all) {
      expect(['none', 'grid-band', 'action-bar']).toContain(layoutButtonsPlacement(input));
    }
  });

  it('funzione pura: stesso ingresso, stessa uscita, ingresso non modificato', () => {
    const input = { hasLayoutButtons: true, gridBandHasContent: false, hasListActions: true };
    const snapshot = { ...input };
    expect(layoutButtonsPlacement(input)).toBe(layoutButtonsPlacement(input));
    expect(input).toEqual(snapshot);
  });
});
