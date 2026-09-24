import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fr from './focusRestore';

// SXADV-5958: sulla mappa "Fatture attive" il filtro Stato SDI (MultiSelect con
// reload, SENZA id sul controllo) fa partire un Post alla Conferma del pannello
// e alla X di una pastiglia. La risposta e' un ricaricamento della STESSA
// pagina, ma porta `templateKey` alla radice: il client la prendeva per una
// pagina nuova e mandava il cursore sul primo campo ("ID DOC"), riportando la
// mappa in cima. Contratto:
//   - reload armato  => mai focusNewPage; si ridà il fuoco a restoreId se c'e',
//                       altrimenti il fuoco resta dov'e';
//   - nessun reload + templateKey + scheda attiva + niente errori bloccanti
//                    => pagina nuova (SXADV-5803): cursore su currField o sul
//                       primo campo modificabile;
//   - altrimenti niente.
//
// Ambiente node, niente DOM: un DOM finto con quello che focusRestore tocca.
// Effetti osservabili: chi riceve focus() e se lo scrollTop del contenitore
// cambia. I fotogrammi si fanno avanzare a mano.

type Pending = ReturnType<typeof fr.consumePendingFocus>;
type Resp = { templateKey?: string; currField?: string | null; errors?: { type: string }[] };
const focusAfterResponse = (p: Pending, r: Resp, attiva: boolean) =>
  (fr as unknown as { focusAfterResponse: (p: Pending, r: Resp, a: boolean) => void })
    .focusAfterResponse(p, r, attiva);

const g = globalThis as Record<string, unknown>;
const CHIAVI = [
  'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement',
  'getComputedStyle', 'requestAnimationFrame',
];
const salvati: Record<string, unknown> = {};

class FintoHTMLElement {
  id = '';
  parentElement: FintoHTMLElement | null = null;
  /** Dentro il pannello di un popup antd (calendario/tendina). */
  inDropdown = false;
  top = 0;
  closest(sel: string): unknown {
    if (this.inDropdown && /ant-(picker|select)-dropdown/.test(sel)) return {};
    return null;
  }
  focus = vi.fn(() => { doc.activeElement = this; });
  scrollIntoView = vi.fn();
  getClientRects() { return [{}]; }
  getBoundingClientRect() { return { top: this.top, bottom: this.top + 24 }; }
}
class FintoInput extends FintoHTMLElement {
  type = 'text';
  tabIndex = 0;
  disabled = false;
  readOnly = false;
  select = vi.fn();
}
class FintoTextArea extends FintoHTMLElement {}
class FintoSelect extends FintoHTMLElement {}

/** Il .view-body: 400px visibili su 2000, gia' scorso fino a Stato SDI. */
class Scorrevole extends FintoHTMLElement {
  scrollTop = 900;
  scrollHeight = 2000;
  clientHeight = 400;
  getBoundingClientRect() { return { top: 0, bottom: 400 }; }
}

let campi: FintoHTMLElement[] = [];
let scroller: Scorrevole;
let fotogrammi: Array<() => void> = [];
const body = new FintoHTMLElement();
const view = {
  contains: (n: unknown) => campi.includes(n as FintoHTMLElement),
  querySelectorAll: () => campi.filter((c) => c instanceof FintoInput),
};
const doc: Record<string, unknown> & { activeElement: unknown } = {
  activeElement: body,
  body,
  querySelector: (sel: string) => (sel === '.tab-content .view-container' ? view : null),
  querySelectorAll: () => [],
  getElementById: (id: string) => campi.find((c) => c.id === id) ?? null,
};

function nel<T extends FintoHTMLElement>(el: T, id: string, top: number, extra: Partial<T> = {}): T {
  Object.assign(el, { id, top, ...extra });
  el.parentElement = scroller;
  campi.push(el);
  return el;
}

function avanza(max = 20): void {
  for (let i = 0; i < max && fotogrammi.length; i++) {
    const q = fotogrammi;
    fotogrammi = [];
    q.forEach((f) => f());
  }
}

// La mappa: ID DOC in cima (primo campo modificabile), Stato SDI in basso, con
// il suo bottone (senza id, come il controllo che non ha id nel JSON).
let idDoc: FintoInput;
let altroCampo: FintoInput;
let pickerBtn: FintoHTMLElement;
const M_RESP: Resp = { templateKey: 'docCliQuery:S8-0', currField: undefined, errors: [] };

beforeEach(() => {
  for (const k of CHIAVI) salvati[k] = g[k];
  g.HTMLElement = FintoHTMLElement;
  g.HTMLInputElement = FintoInput;
  g.HTMLTextAreaElement = FintoTextArea;
  g.HTMLSelectElement = FintoSelect;
  g.getComputedStyle = () => ({ overflowY: 'auto', display: 'block' });
  g.requestAnimationFrame = (f: () => void) => { fotogrammi.push(f); return fotogrammi.length; };
  g.document = doc;
  fotogrammi = [];
  campi = [];
  scroller = new Scorrevole();
  idDoc = nel(new FintoInput(), 'idDocumento.S8-0', 40);
  altroCampo = nel(new FintoInput(), 'dataRegDa.S8-0', 1080);
  pickerBtn = nel(new FintoHTMLElement(), '', 1100);
  doc.activeElement = body;
  fr.discardPendingFocus();
});

afterEach(() => {
  fr.discardPendingFocus();
  for (const k of CHIAVI) {
    if (salvati[k] === undefined) delete g[k]; else g[k] = salvati[k];
  }
});

describe('consumePendingFocus: nuovo ritorno { restoreId } (SXADV-5958)', () => {
  it('niente armato: null', () => {
    expect(fr.consumePendingFocus()).toBeNull();
  });

  it('armato senza ripiego, fuoco su <body>: oggetto con restoreId null (NON null)', () => {
    fr.captureFocusBeforeReload();
    expect(fr.consumePendingFocus()).toEqual({ restoreId: null });
  });

  it('armato col ripiego, fuoco su <body>: restoreId = ripiego', () => {
    fr.captureFocusBeforeReload('stSdi.S8-0');
    expect(fr.consumePendingFocus()).toEqual({ restoreId: 'stSdi.S8-0' });
  });

  it('armato, fuoco dentro un popup antd: restoreId = ripiego', () => {
    const opzione = nel(new FintoHTMLElement(), 'opz', 0, { inDropdown: true });
    doc.activeElement = opzione;
    fr.captureFocusBeforeReload('campoData');
    expect(fr.consumePendingFocus()).toEqual({ restoreId: 'campoData' });
  });

  it('armato, fuoco posato su un campo con id: restoreId = quel campo', () => {
    doc.activeElement = altroCampo;
    fr.captureFocusBeforeReload('altro');
    expect(fr.consumePendingFocus()).toEqual({ restoreId: 'dataRegDa.S8-0' });
  });

  it('armato, fuoco posato su un elemento senza id (bottone del MultiSelect): restoreId null', () => {
    doc.activeElement = pickerBtn;
    fr.captureFocusBeforeReload('ripiego');
    expect(fr.consumePendingFocus()).toEqual({ restoreId: null });
  });

  it('consumare disarma', () => {
    fr.captureFocusBeforeReload();
    expect(fr.consumePendingFocus()).not.toBeNull();
    expect(fr.consumePendingFocus()).toBeNull();
  });
});

describe('focusAfterResponse: tabella delle decisioni (SXADV-5958)', () => {
  it('esiste ed e\' una funzione', () => {
    expect(typeof (fr as Record<string, unknown>).focusAfterResponse).toBe('function');
  });

  it('IL DIFETTO: reload armato senza bersaglio + risposta con templateKey => il fuoco non si muove, niente scorrimento', () => {
    fr.captureFocusBeforeReload(); // MultiSelect senza id
    const pending = fr.consumePendingFocus();
    focusAfterResponse(pending, M_RESP, true);
    avanza();
    expect(idDoc.focus).not.toHaveBeenCalled();
    expect(doc.activeElement).toBe(body);
    expect(scroller.scrollTop).toBe(900);
  });

  it('IL DIFETTO, con currField del server sul primo campo: nemmeno cosi\' si torna in cima', () => {
    fr.captureFocusBeforeReload();
    const pending = fr.consumePendingFocus();
    focusAfterResponse(pending, { ...M_RESP, currField: 'idDocumento.S8-0' }, true);
    avanza();
    expect(idDoc.focus).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(900);
  });

  it('reload armato, fuoco sul bottone del MultiSelect (senza id): resta li\'', () => {
    doc.activeElement = pickerBtn;
    fr.captureFocusBeforeReload();
    const pending = fr.consumePendingFocus();
    focusAfterResponse(pending, M_RESP, true);
    avanza();
    expect(doc.activeElement).toBe(pickerBtn);
    expect(idDoc.focus).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(900);
  });

  it('reload armato con bersaglio: quel campo riprende il fuoco, senza scorrere', () => {
    doc.activeElement = altroCampo;
    fr.captureFocusBeforeReload('x');
    const pending = fr.consumePendingFocus();
    doc.activeElement = body; // il ridisegno lo ha perso
    focusAfterResponse(pending, M_RESP, true);
    avanza();
    expect(altroCampo.focus).toHaveBeenCalledWith(expect.objectContaining({ preventScroll: true }));
    expect(doc.activeElement).toBe(altroCampo);
    expect(idDoc.focus).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(900);
  });

  it('reload armato con bersaglio: il fuoco arriva nel fotogramma, non prima', () => {
    fr.captureFocusBeforeReload('dataRegDa.S8-0');
    const pending = fr.consumePendingFocus();
    focusAfterResponse(pending, M_RESP, true);
    expect(altroCampo.focus).not.toHaveBeenCalled();
    avanza();
    expect(altroCampo.focus).toHaveBeenCalled();
  });

  it('reload armato su scheda NON attiva, con templateKey: niente focusNewPage', () => {
    fr.captureFocusBeforeReload();
    focusAfterResponse(fr.consumePendingFocus(), M_RESP, false);
    avanza();
    expect(idDoc.focus).not.toHaveBeenCalled();
  });

  it('nessun reload + templateKey + scheda attiva: pagina nuova, fuoco sul primo campo modificabile (SXADV-5803)', () => {
    scroller.scrollTop = 0;
    focusAfterResponse(null, M_RESP, true);
    avanza();
    expect(doc.activeElement).toBe(idDoc);
    expect(idDoc.focus).toHaveBeenCalledWith(expect.objectContaining({ preventScroll: true }));
  });

  it('nessun reload + templateKey + currField: pagina nuova, fuoco su currField', () => {
    scroller.scrollTop = 0;
    focusAfterResponse(null, { ...M_RESP, currField: 'dataRegDa.S8-0' }, true);
    avanza();
    expect(doc.activeElement).toBe(altroCampo);
  });

  it('errori solo INFO/NOTIFICATION: e\' ancora una pagina nuova', () => {
    focusAfterResponse(null, { ...M_RESP, errors: [{ type: 'INFO' }, { type: 'NOTIFICATION' }] }, true);
    avanza();
    expect(doc.activeElement).toBe(idDoc);
  });

  it('scheda non attiva: niente', () => {
    focusAfterResponse(null, M_RESP, false);
    avanza();
    expect(idDoc.focus).not.toHaveBeenCalled();
    expect(doc.activeElement).toBe(body);
  });

  it.each(['ERROR', 'WARNING', 'CONFIRMATION'])('errore bloccante %s: niente (il fuoco e\' della finestra)', (type) => {
    focusAfterResponse(null, { ...M_RESP, errors: [{ type }] }, true);
    avanza();
    expect(idDoc.focus).not.toHaveBeenCalled();
  });

  it('senza templateKey (D: ridisegno della stessa pagina) e senza reload: niente', () => {
    focusAfterResponse(null, { errors: [] }, true);
    avanza();
    expect(idDoc.focus).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(900);
  });

  it('reload armato e poi scartato: la risposta dopo e\' una pagina nuova', () => {
    fr.captureFocusBeforeReload();
    fr.discardPendingFocus();
    const pending = fr.consumePendingFocus();
    expect(pending).toBeNull();
    focusAfterResponse(pending, M_RESP, true);
    avanza();
    expect(doc.activeElement).toBe(idDoc);
  });

  it('dopo un reload consumato, la pagina nuova seguente torna al comportamento SXADV-5803', () => {
    fr.captureFocusBeforeReload();
    focusAfterResponse(fr.consumePendingFocus(), M_RESP, true);
    avanza();
    expect(idDoc.focus).not.toHaveBeenCalled();
    focusAfterResponse(fr.consumePendingFocus(), M_RESP, true);
    avanza();
    expect(doc.activeElement).toBe(idDoc);
  });
});
