import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  nearestVerticalDelta, captureFocusBeforeReload, consumePendingFocus, discardPendingFocus,
} from './focusRestore';

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

// Il ripristino del fuoco armato da un campo con reload appartiene alla SUA
// risposta. Se la richiesta non arriva a una risposta (sessione scaduta,
// redirect, errore di rete) il segno va scartato: lasciato armato lo prendeva
// la risposta dopo — anche una pagina nuova dal menu — e il cursore non andava
// sul primo campo della maschera nuova (SXADV-5803).
//
// L'ambiente dei test e' node: niente DOM. consumePendingFocus, quando il segno
// e' armato, legge document.activeElement e fa `instanceof HTMLElement`: qui
// si mette un DOM minimo, solo quello che quella lettura tocca.
describe('discardPendingFocus: il segno armato si puo\' scartare', () => {
  class FintoElemento {
    id: string;
    constructor(id = '') { this.id = id; }
    closest(): null { return null; }
  }
  const g = globalThis as Record<string, unknown>;
  const salvati: Record<string, unknown> = {};
  const body = new FintoElemento();
  let attivo: FintoElemento = body;

  beforeEach(() => {
    for (const k of ['document', 'HTMLElement']) salvati[k] = g[k];
    g.HTMLElement = FintoElemento;
    attivo = body;
    g.document = { get activeElement() { return attivo; }, body };
    // Stato di partenza pulito: un segno lasciato da un caso precedente non
    // deve decidere l'esito di questo.
    discardPendingFocus();
  });

  afterEach(() => {
    for (const k of ['document', 'HTMLElement']) {
      if (salvati[k] === undefined) delete g[k]; else g[k] = salvati[k];
    }
  });

  it('armato e poi scartato: la risposta dopo non trova niente da ripristinare', () => {
    captureFocusBeforeReload('campoReload');
    discardPendingFocus();
    expect(consumePendingFocus()).toBeNull();
  });

  it('scartare senza niente di armato non esplode', () => {
    expect(() => discardPendingFocus()).not.toThrow();
    expect(() => discardPendingFocus()).not.toThrow();
    expect(consumePendingFocus()).toBeNull();
  });

  it('scartare non legge il fuoco (si puo\' chiamare anche senza DOM)', () => {
    captureFocusBeforeReload('campoReload');
    delete g.document;
    delete g.HTMLElement;
    expect(() => discardPendingFocus()).not.toThrow();
    g.HTMLElement = FintoElemento;
    g.document = { get activeElement() { return attivo; }, body };
    expect(consumePendingFocus()).toBeNull();
  });

  it('consumare due volte: la seconda risposta non trova il segno', () => {
    captureFocusBeforeReload('campoReload');
    // Fuoco sospeso su <body>: si torna al campo che ha lanciato il reload.
    expect(consumePendingFocus()).toBe('campoReload');
    expect(consumePendingFocus()).toBeNull();
  });

  it('consumare con il fuoco posato su un campo con id restituisce quel campo, una volta', () => {
    captureFocusBeforeReload('campoReload');
    attivo = new FintoElemento('campoSuccessivo');
    expect(consumePendingFocus()).toBe('campoSuccessivo');
    expect(consumePendingFocus()).toBeNull();
  });

  it('dopo uno scarto il segno si riarma e funziona come prima', () => {
    captureFocusBeforeReload('primo');
    discardPendingFocus();
    captureFocusBeforeReload('secondo');
    expect(consumePendingFocus()).toBe('secondo');
  });

  it('un segno riarmato prima della risposta vale il ripiego piu\' recente', () => {
    // Due campi con reload di seguito, la prima richiesta ancora in volo: il
    // segno e' uno solo e lo consuma la risposta che arriva, col ripiego
    // dell'ultimo campo lasciato.
    captureFocusBeforeReload('primo');
    captureFocusBeforeReload('secondo');
    expect(consumePendingFocus()).toBe('secondo');
    expect(consumePendingFocus()).toBeNull();
  });
});
