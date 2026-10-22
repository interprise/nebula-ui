import { describe, it, expect } from 'vitest';
import { centroIngranaggio, type Rettangolo } from './contextChangeGear';

// SXADV-5980.a: durante il cambio Azienda/Sede lo Shell mostra un velo
// trasparente con un ingranaggio che gira. L'ingranaggio era centrato sulla
// FINESTRA, quindi fuori asse rispetto ai testi della Home, che sono centrati
// nell'area dei contenuti (.tab-content, a destra della barra laterale e sotto
// testata e schede). centroIngranaggio() da' il centro della parte VISIBILE
// del rettangolo dell'area; senza area visibile ripiega sul centro finestra.

const FHD = { width: 1920, height: 1080 };

describe('centroIngranaggio: layout reale', () => {
  it('area a destra della barra laterale (350px) e sotto la testata (85px)', () => {
    const area: Rettangolo = { left: 350, top: 85, width: 1570, height: 995 };
    // x = 350 + 1570/2 = 1135; y = 85 + 995/2 = 582.5 -> 583
    expect(centroIngranaggio(area, FHD)).toEqual({ x: 1135, y: 583 });
  });

  it('non coincide con il centro della finestra (il difetto del ticket)', () => {
    const area: Rettangolo = { left: 350, top: 85, width: 1570, height: 995 };
    const c = centroIngranaggio(area, FHD);
    expect(c.x).not.toBe(960);
    expect(c.y).not.toBe(540);
  });

  it('area che coincide con la finestra = centro della finestra', () => {
    expect(centroIngranaggio({ left: 0, top: 0, width: 1920, height: 1080 }, FHD))
      .toEqual({ x: 960, y: 540 });
  });
});

describe('centroIngranaggio: area parzialmente fuori dalla finestra', () => {
  it('sporge a sinistra: conta solo la parte da x=0', () => {
    // visibile [0,300] x [0,200]
    expect(centroIngranaggio({ left: -100, top: 0, width: 400, height: 200 }, FHD))
      .toEqual({ x: 150, y: 100 });
  });

  it('sporge a destra: conta solo la parte fino a width', () => {
    // visibile [1800,1920] x [100,300]
    expect(centroIngranaggio({ left: 1800, top: 100, width: 400, height: 200 }, FHD))
      .toEqual({ x: 1860, y: 200 });
  });

  it('sporge in alto: conta solo la parte da y=0', () => {
    // visibile [100,300] x [0,200]
    expect(centroIngranaggio({ left: 100, top: -50, width: 200, height: 250 }, FHD))
      .toEqual({ x: 200, y: 100 });
  });

  it('sporge in basso: conta solo la parte fino a height', () => {
    // visibile [100,300] x [1000,1080]
    expect(centroIngranaggio({ left: 100, top: 1000, width: 200, height: 200 }, FHD))
      .toEqual({ x: 200, y: 1040 });
  });

  it('area piu\' grande della finestra su tutti i lati = centro della finestra', () => {
    expect(centroIngranaggio({ left: -100, top: -100, width: 3000, height: 3000 }, FHD))
      .toEqual({ x: 960, y: 540 });
  });

  it('area piu\' grande della finestra, sbilanciata: si taglia sul viewport', () => {
    // visibile [350,1920] x [85,1080] -> x 1135, y 582.5 -> 583
    expect(centroIngranaggio({ left: 350, top: 85, width: 5000, height: 5000 }, FHD))
      .toEqual({ x: 1135, y: 583 });
  });
});

describe('centroIngranaggio: ripiego sul centro della finestra', () => {
  it('spazio null', () => {
    expect(centroIngranaggio(null, FHD)).toEqual({ x: 960, y: 540 });
  });

  it('spazio undefined', () => {
    expect(centroIngranaggio(undefined, FHD)).toEqual({ x: 960, y: 540 });
  });

  it('area interamente a destra della finestra', () => {
    expect(centroIngranaggio({ left: 2000, top: 100, width: 300, height: 300 }, FHD))
      .toEqual({ x: 960, y: 540 });
  });

  it('area interamente a sinistra della finestra', () => {
    expect(centroIngranaggio({ left: -500, top: 100, width: 400, height: 300 }, FHD))
      .toEqual({ x: 960, y: 540 });
  });

  it('area interamente sopra la finestra', () => {
    expect(centroIngranaggio({ left: 100, top: -400, width: 300, height: 300 }, FHD))
      .toEqual({ x: 960, y: 540 });
  });

  it('area interamente sotto la finestra', () => {
    expect(centroIngranaggio({ left: 100, top: 1200, width: 300, height: 300 }, FHD))
      .toEqual({ x: 960, y: 540 });
  });

  it('area che tocca solo il bordo (parte visibile di larghezza zero)', () => {
    expect(centroIngranaggio({ left: 1920, top: 100, width: 100, height: 300 }, FHD))
      .toEqual({ x: 960, y: 540 });
  });

  it('area di larghezza zero (es. elemento nascosto)', () => {
    expect(centroIngranaggio({ left: 350, top: 85, width: 0, height: 995 }, FHD))
      .toEqual({ x: 960, y: 540 });
  });

  it('area di altezza zero', () => {
    expect(centroIngranaggio({ left: 350, top: 85, width: 1570, height: 0 }, FHD))
      .toEqual({ x: 960, y: 540 });
  });

  it('area tutta a zero (display:none -> getBoundingClientRect vuoto)', () => {
    expect(centroIngranaggio({ left: 0, top: 0, width: 0, height: 0 }, FHD))
      .toEqual({ x: 960, y: 540 });
  });

  it('dimensioni negative', () => {
    expect(centroIngranaggio({ left: 500, top: 500, width: -10, height: 100 }, FHD))
      .toEqual({ x: 960, y: 540 });
  });

  it('il ripiego e\' arrotondato anche con finestra dispari', () => {
    // 1365/2 = 682.5 -> 683; 767/2 = 383.5 -> 384
    expect(centroIngranaggio(null, { width: 1365, height: 767 })).toEqual({ x: 683, y: 384 });
  });
});

describe('centroIngranaggio: arrotondamento', () => {
  it('dimensioni dispari: Math.round sul mezzo pixel', () => {
    // 101/2 = 50.5 -> 51; 51/2 = 25.5 -> 26
    expect(centroIngranaggio({ left: 0, top: 0, width: 101, height: 51 }, FHD))
      .toEqual({ x: 51, y: 26 });
  });

  it('coordinate frazionarie (zoom del browser)', () => {
    // x = 10.25 + 20.5/2 = 20.5 -> 21; y = 7.4 + 3.2/2 = 9.0 -> 9
    expect(centroIngranaggio({ left: 10.25, top: 7.4, width: 20.5, height: 3.2 }, FHD))
      .toEqual({ x: 21, y: 9 });
  });

  it('il risultato e\' sempre fatto di interi', () => {
    const c = centroIngranaggio({ left: 349.7, top: 84.3, width: 1570.6, height: 995.1 }, FHD);
    expect(Number.isInteger(c.x)).toBe(true);
    expect(Number.isInteger(c.y)).toBe(true);
  });
});
