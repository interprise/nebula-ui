import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  nearestVerticalDelta, captureFocusBeforeReload, consumePendingFocus, discardPendingFocus, focusNewPage,
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
    // Dal SXADV-5958 il ritorno e' un oggetto { restoreId }: null = niente armato.
    expect(consumePendingFocus()).toEqual({ restoreId: 'campoReload' });
    expect(consumePendingFocus()).toBeNull();
  });

  it('consumare con il fuoco posato su un campo con id restituisce quel campo, una volta', () => {
    captureFocusBeforeReload('campoReload');
    attivo = new FintoElemento('campoSuccessivo');
    expect(consumePendingFocus()).toEqual({ restoreId: 'campoSuccessivo' });
    expect(consumePendingFocus()).toBeNull();
  });

  it('dopo uno scarto il segno si riarma e funziona come prima', () => {
    captureFocusBeforeReload('primo');
    discardPendingFocus();
    captureFocusBeforeReload('secondo');
    expect(consumePendingFocus()).toEqual({ restoreId: 'secondo' });
  });

  it('un segno riarmato prima della risposta vale il ripiego piu\' recente', () => {
    // Due campi con reload di seguito, la prima richiesta ancora in volo: il
    // segno e' uno solo e lo consuma la risposta che arriva, col ripiego
    // dell'ultimo campo lasciato.
    captureFocusBeforeReload('primo');
    captureFocusBeforeReload('secondo');
    expect(consumePendingFocus()).toEqual({ restoreId: 'secondo' });
    expect(consumePendingFocus()).toBeNull();
  });
});

// SXADV-5969.1: sulla pagina nuova il cursore va sul `currField` del server se
// e' usabile, altrimenti sul primo campo modificabile della vista. Si scorre
// fino al campo SOLO quando e' quello indicato dal server: il primo campo
// modificabile puo' stare sotto la prima schermata (Iscritti: la testata
// anagrafica e' in sola lettura, il primo campo e' 320px piu' in basso) e la
// pagina nuova deve aprirsi dall'inizio, col fuoco li' ma senza scorrere.
//
// Anche qui niente DOM vero: un DOM finto con quello che focusNewPage tocca
// (vista, contenitore che scorre, campi con la loro posizione), e i fotogrammi
// si fanno avanzare a mano.
describe('focusNewPage: il cursore sulla pagina nuova (SXADV-5969.1)', () => {
  const g = globalThis as Record<string, unknown>;
  const CHIAVI = [
    'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement',
    'getComputedStyle', 'requestAnimationFrame',
  ];
  const salvati: Record<string, unknown> = {};

  class FintoHTMLElement {
    id = '';
    parentElement: FintoHTMLElement | null = null;
    closest(): null { return null; }
  }
  class FintoInput extends FintoHTMLElement {
    type = 'text';
    tabIndex = 0;
    disabled = false;
    readOnly = false;
    top = 0;
    focus = vi.fn(() => { doc.activeElement = this; });
    select = vi.fn();
    getClientRects() { return [{}]; }
    getBoundingClientRect() { return { top: this.top, bottom: this.top + 24 }; }
  }
  class FintoTextArea extends FintoHTMLElement {}
  class FintoSelect extends FintoHTMLElement {}

  /** Il contenitore che scorre: 400px visibili su 2000 di contenuto. */
  class Scorrevole extends FintoHTMLElement {
    scrollTop = 0;
    scrollHeight = 2000;
    clientHeight = 400;
    getBoundingClientRect() { return { top: 0, bottom: 400 }; }
  }

  let campi: FintoInput[] = [];
  let scroller: Scorrevole;
  let fotogrammi: Array<() => void> = [];
  const view = {
    contains: (n: unknown) => campi.includes(n as FintoInput),
    querySelectorAll: () => campi,
  };
  const body = new FintoHTMLElement();
  const doc: Record<string, unknown> & { activeElement: unknown } = {
    activeElement: body,
    body,
    querySelector: (sel: string) => (sel === '.tab-content .view-container' ? view : null),
    querySelectorAll: () => [],
    getElementById: (id: string) => campi.find((c) => c.id === id) ?? null,
  };

  function campo(id: string, top: number, extra: Partial<FintoInput> = {}): FintoInput {
    const c = new FintoInput();
    Object.assign(c, { id, top, ...extra });
    c.parentElement = scroller;
    return c;
  }

  /** Esegue i fotogrammi in coda (e quelli che questi accodano), con un tetto. */
  function avanza(max = 20): void {
    for (let i = 0; i < max && fotogrammi.length; i++) {
      const q = fotogrammi;
      fotogrammi = [];
      q.forEach((f) => f());
    }
  }

  beforeEach(() => {
    for (const k of CHIAVI) salvati[k] = g[k];
    g.HTMLElement = FintoHTMLElement;
    g.HTMLInputElement = FintoInput;
    g.HTMLTextAreaElement = FintoTextArea;
    g.HTMLSelectElement = FintoSelect;
    g.getComputedStyle = () => ({ overflowY: 'auto', display: 'block' });
    g.requestAnimationFrame = (f: () => void) => { fotogrammi.push(f); return fotogrammi.length; };
    g.document = doc;
    doc.activeElement = body;
    fotogrammi = [];
    scroller = new Scorrevole();
    campi = [];
  });

  afterEach(() => {
    for (const k of CHIAVI) {
      if (salvati[k] === undefined) delete g[k]; else g[k] = salvati[k];
    }
  });

  it('senza currField: fuoco sul primo campo modificabile sotto la piega, senza scorrere', () => {
    campi = [
      campo('cognome', 40, { readOnly: true }),
      campo('nome', 70, { readOnly: true }),
      campo('dataIscrizioneCna', 900),
    ];
    focusNewPage();
    avanza();
    expect(doc.activeElement).toBe(campi[2]);
    expect(campi[2].focus).toHaveBeenCalledWith(expect.objectContaining({ preventScroll: true }));
    expect(scroller.scrollTop).toBe(0);
  });

  it('il testo del primo campo resta selezionato, come focusInputField', () => {
    campi = [campo('primo', 40)];
    focusNewPage();
    avanza();
    expect(campi[0].select).toHaveBeenCalled();
  });

  it('currField del server sotto la piega: fuoco li\' e si scorre quanto basta a vederlo', () => {
    campi = [
      campo('primo', 40),
      campo('indicato', 900),
    ];
    focusNewPage('indicato');
    avanza();
    expect(doc.activeElement).toBe(campi[1]);
    expect(campi[1].focus).toHaveBeenCalledWith(expect.objectContaining({ preventScroll: true }));
    // 900..924 in un riquadro 0..400: si scende di 524 (block: 'nearest').
    expect(scroller.scrollTop).toBe(524);
  });

  it('currField del server gia\' in vista: fuoco li\', niente scorrimento', () => {
    campi = [campo('primo', 40), campo('indicato', 200)];
    focusNewPage('indicato');
    avanza();
    expect(doc.activeElement).toBe(campi[1]);
    expect(scroller.scrollTop).toBe(0);
  });

  it('currField del server che coincide col primo campo modificabile: si scorre comunque', () => {
    campi = [campo('ro', 40, { readOnly: true }), campo('indicato', 900)];
    focusNewPage('indicato');
    avanza();
    expect(doc.activeElement).toBe(campi[1]);
    expect(scroller.scrollTop).toBeGreaterThan(0);
  });

  it.each([
    ['in sola lettura', { readOnly: true }],
    ['disabilitato', { disabled: true }],
    ['fuori dal TAB', { tabIndex: -1 }],
    ['nascosto', { type: 'hidden' }],
  ])('currField %s: si ripiega sul primo campo modificabile, senza scorrere', (_nome, extra) => {
    campi = [
      campo('indicato', 50, extra as Partial<FintoInput>),
      campo('primoBuono', 900),
    ];
    focusNewPage('indicato');
    avanza();
    expect(doc.activeElement).toBe(campi[1]);
    expect(scroller.scrollTop).toBe(0);
  });

  it('currField che non esiste nella vista: ripiego sul primo campo, senza scorrere', () => {
    campi = [campo('ro', 40, { readOnly: true }), campo('primoBuono', 900)];
    focusNewPage('nonCe');
    avanza();
    expect(doc.activeElement).toBe(campi[1]);
    expect(scroller.scrollTop).toBe(0);
  });

  it('campi montati qualche fotogramma dopo: il fuoco arriva lo stesso', () => {
    focusNewPage('tardivo');
    avanza(2);
    expect(doc.activeElement).toBe(body);
    campi = [campo('tardivo', 900)];
    avanza();
    expect(doc.activeElement).toBe(campi[0]);
    expect(scroller.scrollTop).toBe(524);
  });

  it('l\'utente e\' gia\' su un campo della vista: non si sposta niente', () => {
    campi = [campo('primo', 40), campo('suo', 300)];
    doc.activeElement = campi[1];
    focusNewPage('primo');
    avanza();
    expect(doc.activeElement).toBe(campi[1]);
    expect(campi[0].focus).not.toHaveBeenCalled();
  });
});
