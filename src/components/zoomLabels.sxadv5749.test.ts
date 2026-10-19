import { describe, it, expect } from 'vitest';
import { layoutToggleTooltip, sectionZoomTooltip } from './zoomLabels';

// SXADV-5749: le etichette dei bottoni di zoom. Lo stesso testo per lo zoom
// della griglia (ListRenderer) e per lo zoom dell'area inferiore
// (ViewRenderer); il bottone una-riga di una lista ha le sue.

describe('sectionZoomTooltip', () => {
  it('non zoomato: invita a ingrandire', () => {
    expect(sectionZoomTooltip(false)).toBe('Ingrandisce sezione');
  });

  it('zoomato: invita a ridurre, con Esc', () => {
    expect(sectionZoomTooltip(true)).toBe('Riduce sezione (Esc)');
  });

  it('solo lo stato zoomato annuncia Esc', () => {
    expect(sectionZoomTooltip(false)).not.toContain('Esc');
  });
});

describe('layoutToggleTooltip', () => {
  it('in una-riga propone di ingrandire il layout', () => {
    expect(layoutToggleTooltip(true)).toBe('Ingrandisce layout');
  });

  it('fuori da una-riga propone di ridurlo', () => {
    expect(layoutToggleTooltip(false)).toBe('Riduce layout');
  });

  it('le due etichette sono diverse da quelle dello zoom di sezione', () => {
    for (const b of [true, false]) {
      expect(layoutToggleTooltip(b)).not.toBe(sectionZoomTooltip(b));
      expect(layoutToggleTooltip(b)).not.toBe(sectionZoomTooltip(!b));
    }
  });
});
