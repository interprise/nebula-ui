import { describe, it, expect } from 'vitest';
import { nearestVerticalDelta } from './focusRestore';

// SXADV-5922: il cursore sulla pagina nuova (SXADV-5803) porta il campo in vista
// solo in verticale; in orizzontale la maschera resta dall'inizio.

const box = { top: 100, bottom: 500 };

describe('nearestVerticalDelta', () => {
  it("campo gia' in vista: non si scorre", () => {
    expect(nearestVerticalDelta({ top: 200, bottom: 230 }, box)).toBe(0);
  });

  it("campo sotto il bordo: si scorre giu' del minimo", () => {
    expect(nearestVerticalDelta({ top: 520, bottom: 550 }, box)).toBe(50);
  });

  it('campo sopra il bordo: si scorre su', () => {
    expect(nearestVerticalDelta({ top: 60, bottom: 90 }, box)).toBe(-40);
  });

  it("campo piu' alto del contenitore: conta la sua cima", () => {
    expect(nearestVerticalDelta({ top: 300, bottom: 900 }, box)).toBe(200);
  });
});
