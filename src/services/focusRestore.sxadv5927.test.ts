import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { focusNewPage, focusAfterResponse } from './focusRestore';

// SXADV-5927: tornando con "« Ritorno un passo indietro" dal dettaglio di una
// riga (o dal "Nuovo") della lista "Righe fattura", la risposta passa per
// pagina nuova e focusNewPage metteva il cursore sul primo campo della testata
// ("Tipo Doc. FE"): l'area dei tab si stringeva a ~120px e la riga nuova non
// si vedeva. Ora la lista, finche' ha un ritorno armato, mette sul suo
// contenitore l'attributo `data-row-return`: se la vista VISIBILE
// (`.tab-content .view-container`) contiene un elemento con quell'attributo,
// focusNewPage non sposta il fuoco — lo mette la lista sulla riga. Altrimenti
// tutto come prima (SXADV-5803, 5969.1).
//
// Niente DOM vero (ambiente node): un DOM finto con quello che focusNewPage
// tocca, come in focusRestore.test.ts. Il finto risponde ai selettori con
// l'attributo sia chiesti alla vista sia chiesti al documento con la vista nel
// selettore; un selettore SENZA la vista, chiesto al documento, trova per
// primo il marcatore di un'altra vista (non visibile): chi cerca cosi' sbaglia.

const ATTR = 'data-row-return';

describe('focusNewPage con un ritorno di riga armato (SXADV-5927)', () => {
  const g = globalThis as Record<string, unknown>;
  const CHIAVI = [
    'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement',
    'getComputedStyle', 'requestAnimationFrame',
  ];
  const salvati: Record<string, unknown> = {};

  class FintoHTMLElement {
    id = '';
    parentElement: FintoHTMLElement | null = null;
    attrs: Record<string, string> = {};
    closest(): null { return null; }
    hasAttribute(n: string) { return n in this.attrs; }
    getAttribute(n: string) { return this.attrs[n] ?? null; }
  }
  class FintoInput extends FintoHTMLElement {
    type = 'text';
    tabIndex = 0;
    disabled = false;
    readOnly = false;
    top = 0;
    focus = vi.fn(() => { doc.activeElement = this; });
    select = vi.fn();
    scrollIntoView = vi.fn();
    getClientRects() { return [{}]; }
    getBoundingClientRect() { return { top: this.top, bottom: this.top + 24 }; }
  }
  class FintoTextArea extends FintoHTMLElement {}
  class FintoSelect extends FintoHTMLElement {}

  class Scorrevole extends FintoHTMLElement {
    scrollTop = 0;
    scrollHeight = 2000;
    clientHeight = 400;
    getBoundingClientRect() { return { top: 0, bottom: 400 }; }
  }

  /** Il contenitore della griglia: porta l'attributo finche' il ritorno e' armato. */
  function griglia(armata: boolean): FintoHTMLElement {
    const el = new FintoHTMLElement();
    if (armata) el.attrs[ATTR] = '';
    return el;
  }

  let campi: FintoInput[] = [];
  /** Elementi della vista visibile diversi dai campi (griglia, celle). */
  let altri: FintoHTMLElement[] = [];
  /** Elementi di un'ALTRA vista, non visibile (un'altra scheda). */
  let altraVista: FintoHTMLElement[] = [];
  let scroller: Scorrevole;
  let fotogrammi: Array<() => void> = [];

  const conAttr = (els: FintoHTMLElement[]) => els.filter((e) => e.hasAttribute(ATTR));

  const view = {
    contains: (n: unknown) => campi.includes(n as FintoInput) || altri.includes(n as FintoHTMLElement),
    querySelectorAll: (sel: string) => (sel.includes(ATTR) ? conAttr(altri) : campi),
    querySelector: (sel: string) => (sel.includes(ATTR) ? conAttr(altri)[0] ?? null : campi[0] ?? null),
  };
  const body = new FintoHTMLElement();
  const doc: Record<string, unknown> & { activeElement: unknown } = {
    activeElement: body,
    body,
    querySelector: (sel: string) => {
      if (sel === '.tab-content .view-container') return view;
      if (sel.includes(ATTR)) {
        // Selettore con la vista: solo la vista visibile. Senza: prima l'altra.
        return sel.includes('.view-container')
          ? conAttr(altri)[0] ?? null
          : [...conAttr(altraVista), ...conAttr(altri)][0] ?? null;
      }
      return null;
    },
    querySelectorAll: (sel: string) => {
      if (sel.includes(ATTR)) {
        return sel.includes('.view-container') ? conAttr(altri) : [...conAttr(altraVista), ...conAttr(altri)];
      }
      return [];
    },
    getElementById: (id: string) => campi.find((c) => c.id === id) ?? null,
  };

  function campo(id: string, top: number, extra: Partial<FintoInput> = {}): FintoInput {
    const c = new FintoInput();
    Object.assign(c, { id, top, ...extra });
    c.parentElement = scroller;
    return c;
  }

  function avanza(max = 20): void {
    for (let i = 0; i < max && fotogrammi.length; i++) {
      const q = fotogrammi;
      fotogrammi = [];
      q.forEach((f) => f());
    }
  }

  /** La pagina della fattura: testata con "Tipo Doc. FE" primo campo modificabile. */
  function testata(): FintoInput[] {
    return [campo('numDoc', 40, { readOnly: true }), campo('tipoDocFE', 70), campo('dataDoc', 100)];
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
    altri = [];
    altraVista = [];
  });

  afterEach(() => {
    for (const k of CHIAVI) {
      if (salvati[k] === undefined) delete g[k]; else g[k] = salvati[k];
    }
  });

  it('griglia con il ritorno armato nella vista: il fuoco NON va su "Tipo Doc. FE"', () => {
    campi = testata();
    altri = [griglia(true)];
    focusNewPage();
    avanza();
    expect(doc.activeElement).toBe(body);
    campi.forEach((c) => expect(c.focus).not.toHaveBeenCalled());
  });

  it('ritorno armato: nemmeno il currField del server prende il fuoco', () => {
    campi = testata();
    altri = [griglia(true)];
    focusNewPage('tipoDocFE');
    avanza();
    expect(doc.activeElement).toBe(body);
    expect(campi[1].focus).not.toHaveBeenCalled();
    expect(campi[1].select).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(0);
  });

  it("l'attributo su un elemento annidato (non figlio diretto della vista) basta", () => {
    const tab = new FintoHTMLElement();
    const contenitore = griglia(true);
    contenitore.parentElement = tab;
    campi = testata();
    altri = [tab, contenitore];
    focusNewPage();
    avanza();
    expect(doc.activeElement).toBe(body);
  });

  it('senza attributo: come prima, fuoco sul primo campo modificabile', () => {
    campi = testata();
    altri = [griglia(false)];
    focusNewPage();
    avanza();
    expect(doc.activeElement).toBe(campi[1]);
  });

  it('senza attributo, col currField: come prima, fuoco li\'', () => {
    campi = testata();
    altri = [griglia(false)];
    focusNewPage('dataDoc');
    avanza();
    expect(doc.activeElement).toBe(campi[2]);
  });

  it("l'attributo in un'ALTRA vista, non visibile, non blocca: il fuoco va sulla testata", () => {
    campi = testata();
    altri = [griglia(false)];
    altraVista = [griglia(true)];
    focusNewPage();
    avanza();
    expect(doc.activeElement).toBe(campi[1]);
  });

  it('nessuna vista visibile ma un marcatore altrove: non esplode', () => {
    const salvaQS = doc.querySelector;
    altraVista = [griglia(true)];
    doc.querySelector = (sel: string) => (sel.includes(ATTR) && !sel.includes('.view-container')
      ? altraVista[0] : null);
    try {
      expect(() => { focusNewPage(); avanza(); }).not.toThrow();
      expect(doc.activeElement).toBe(body);
    } finally {
      doc.querySelector = salvaQS;
    }
  });

  it('campi montati tardi con ritorno armato: nessun fotogramma mette il fuoco sulla testata', () => {
    altri = [griglia(true)];
    focusNewPage('tipoDocFE');
    avanza(3);
    campi = testata();
    avanza();
    expect(doc.activeElement).toBe(body);
    campi.forEach((c) => expect(c.focus).not.toHaveBeenCalled());
  });

  it('attributo che arriva dopo il primo fotogramma, prima dei campi: non si muove', () => {
    // La griglia si monta un attimo dopo (AG Grid), insieme o prima dei campi.
    focusNewPage();
    avanza(2);
    altri = [griglia(true)];
    campi = testata();
    avanza();
    expect(doc.activeElement).toBe(body);
  });

  it("la lista mette il fuoco sulla riga e disarma: focusNewPage non lo riprende", () => {
    campi = testata();
    const g1 = griglia(true);
    const cella = new FintoHTMLElement();
    altri = [g1, cella];
    focusNewPage();
    avanza(1);
    // La lista: setFocusedCell sulla riga nuova, poi togli l'attributo.
    doc.activeElement = cella;
    delete g1.attrs[ATTR];
    avanza();
    expect(doc.activeElement).toBe(cella);
    campi.forEach((c) => expect(c.focus).not.toHaveBeenCalled());
  });

  it('a ritorno non armato, campi tardivi: il fuoco arriva lo stesso (come prima)', () => {
    altri = [griglia(false)];
    focusNewPage();
    avanza(2);
    campi = testata();
    avanza();
    expect(doc.activeElement).toBe(campi[1]);
  });

  it('focusAfterResponse di una pagina nuova con ritorno armato: fuoco fermo', () => {
    campi = testata();
    altri = [griglia(true)];
    focusAfterResponse(null, { templateKey: 'fattureDetail', currField: 'tipoDocFE' }, true);
    avanza();
    expect(doc.activeElement).toBe(body);
    expect(campi[1].focus).not.toHaveBeenCalled();
  });

  it('focusAfterResponse di una pagina nuova senza ritorno armato: come prima', () => {
    campi = testata();
    altri = [griglia(false)];
    focusAfterResponse(null, { templateKey: 'fattureDetail', currField: 'tipoDocFE' }, true);
    avanza();
    expect(doc.activeElement).toBe(campi[1]);
  });

  it("focusAfterResponse di un ricaricamento armato: ripristino del campo anche se c'e' l'attributo", () => {
    // Il ricaricamento e' la stessa pagina: l'attributo riguarda solo la pagina nuova.
    campi = testata();
    altri = [griglia(true)];
    focusAfterResponse({ restoreId: 'dataDoc' }, { templateKey: 'fattureDetail' }, true);
    avanza();
    expect(campi[2].focus).toHaveBeenCalled();
  });
});
