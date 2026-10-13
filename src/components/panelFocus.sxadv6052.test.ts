import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { firstPanelField, focusFirstPanelField } from './panelFocus';

// SXADV-6052.1: dopo il "Nuovo" di una riga il fuoco restava su <body>: nessuno
// lo metteva nel pannello "Gestione riga". Ora EditPanel chiama
// focusFirstPanelField sul pannello: primo campo utilizzabile dentro
// `.edit-panel-body` (stesso criterio del fuoco sulla pagina nuova, SXADV-5803),
// focus con preventScroll, testo selezionato negli input di testo, scorrimento
// solo verticale (SXADV-5922), qualche fotogramma di attesa se il campo arriva
// tardi (al massimo 10), niente se c'e' una finestra modale aperta. Restituisce
// una funzione che annulla i tentativi pendenti.
//
// L'ambiente dei test e' node: niente DOM vero. Qui un DOM finto con alberi di
// elementi, `closest`/`querySelector(All)` per selettori semplici (tag, classi,
// discendenti) e i fotogrammi fatti avanzare a mano.

const g = globalThis as Record<string, unknown>;
const CHIAVI = [
  'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
];
const salvati: Record<string, unknown> = {};

// --- selettori minimi -------------------------------------------------------
// Un composto e' `tag`, `.classe`, `tag.classe`...; attributi e pseudo-classi
// si ignorano (l'insieme diventa piu' largo: il filtro vero e' isUsableField).
function matchesCompound(el: FintoEl, compound: string): boolean {
  const pulito = compound.replace(/\[[^\]]*\]/g, '').replace(/:[a-z-]+(\([^)]*\))?/g, '');
  const m = pulito.match(/^([a-z0-9-]*)((?:\.[\w-]+)*)$/i);
  if (!m) return false;
  const [, tag, classi] = m;
  if (tag && tag !== '*' && el.tag !== tag.toLowerCase()) return false;
  for (const c of classi.split('.').filter(Boolean)) if (!el.classes.has(c)) return false;
  return true;
}

function matchesComplex(el: FintoEl, complex: string): boolean {
  const parti = complex.replace(/>/g, ' ').trim().split(/\s+/);
  if (!matchesCompound(el, parti[parti.length - 1])) return false;
  let i = parti.length - 2;
  for (let a = el.parentElement; a && i >= 0; a = a.parentElement) {
    if (matchesCompound(a, parti[i])) i--;
  }
  return i < 0;
}

// Come nel DOM vero, gli antenati si cercano in tutto il documento, anche
// fuori dall'elemento su cui si chiama querySelectorAll.
function matches(el: FintoEl, sel: string): boolean {
  return sel.split(',').some((s) => matchesComplex(el, s.trim()));
}

class FintoEl {
  tag: string;
  classes: Set<string>;
  id = '';
  children: FintoEl[] = [];
  parentElement: FintoEl | null = null;
  visible = true;
  display = 'block';
  overflowY = 'visible';
  scrollTop = 0;
  scrollLeft = 0;
  scrollHeight = 0;
  clientHeight = 0;
  top = 0;
  height = 24;
  constructor(tag = 'div', cls = '') {
    this.tag = tag;
    this.classes = new Set(cls.split(/\s+/).filter(Boolean));
  }
  get classList() {
    return { contains: (c: string) => this.classes.has(c) };
  }
  get className() { return Array.from(this.classes).join(' '); }
  append(...figli: FintoEl[]): this {
    for (const f of figli) { f.parentElement = this; this.children.push(f); }
    return this;
  }
  *descendants(): Generator<FintoEl> {
    for (const c of this.children) { yield c; yield* c.descendants(); }
  }
  contains(n: unknown): boolean {
    for (let a = n as FintoEl | null; a; a = a.parentElement) if (a === this) return true;
    return false;
  }
  matches(sel: string): boolean { return matches(this, sel); }
  closest(sel: string): FintoEl | null {
    if (matches(this, sel)) return this;
    for (let a = this.parentElement; a; a = a.parentElement) if (matches(a, sel)) return a;
    return null;
  }
  querySelectorAll(sel: string): FintoEl[] {
    return Array.from(this.descendants()).filter((d) => matches(d, sel));
  }
  querySelector(sel: string): FintoEl | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  getClientRects() { return this.visible ? [{}] : []; }
  getBoundingClientRect() {
    return { top: this.top, bottom: this.top + this.height, left: 0, right: 100, width: 100, height: this.height };
  }
}

class FintoCampo extends FintoEl {
  tabIndex = 0;
  disabled = false;
  readOnly = false;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- la firma registra le opzioni
  focus = vi.fn((_opts?: unknown) => { doc.activeElement = this; });
  select = vi.fn();
  scrollIntoView = vi.fn();
}
class FintoInput extends FintoCampo {
  type = 'text';
  constructor(cls = '') { super('input', cls); }
}
class FintoTextArea extends FintoCampo {
  constructor(cls = '') { super('textarea', cls); }
}
class FintoSelect extends FintoCampo {
  constructor(cls = '') { super('select', cls); }
}

// --- documento e fotogrammi ---------------------------------------------------
const root = new FintoEl('html');
const body = new FintoEl('body');
root.append(body);
const doc: Record<string, unknown> & { activeElement: unknown } = {
  activeElement: body,
  body,
  documentElement: root,
  querySelector: (sel: string) => root.querySelector(sel),
  querySelectorAll: (sel: string) => root.querySelectorAll(sel),
  getElementById: (id: string) => Array.from(root.descendants()).find((e) => e.id === id) ?? null,
};

let fotogrammi: Array<{ id: number; f: () => void }> = [];
let prossimoId = 1;
let chiamateRaf = 0;

/** Esegue i fotogrammi in coda (e quelli che questi accodano), con un tetto. */
function avanza(max = 30): void {
  for (let i = 0; i < max && fotogrammi.length; i++) {
    const q = fotogrammi;
    fotogrammi = [];
    q.forEach((x) => x.f());
  }
}

function input(extra: Partial<FintoInput> = {}, cls = ''): FintoInput {
  return Object.assign(new FintoInput(cls), extra);
}

/** Pannello "Gestione riga": testa con un campo suo, corpo `.edit-panel-body`. */
function pannello(campiCorpo: FintoEl[], campiTesta: FintoEl[] = []): { panel: FintoEl; corpo: FintoEl } {
  const panel = new FintoEl('div', 'edit-panel');
  const testa = new FintoEl('div', 'edit-panel-header').append(...campiTesta);
  const corpo = new FintoEl('div', 'edit-panel-body').append(...campiCorpo);
  panel.append(testa, corpo);
  body.append(panel);
  return { panel, corpo };
}

beforeEach(() => {
  for (const k of CHIAVI) salvati[k] = g[k];
  g.HTMLElement = FintoEl;
  g.HTMLInputElement = FintoInput;
  g.HTMLTextAreaElement = FintoTextArea;
  g.HTMLSelectElement = FintoSelect;
  g.getComputedStyle = (el: FintoEl) => ({ display: el.display, overflowY: el.overflowY, overflowX: 'visible' });
  fotogrammi = [];
  prossimoId = 1;
  chiamateRaf = 0;
  g.requestAnimationFrame = (f: () => void) => {
    chiamateRaf++;
    const id = prossimoId++;
    fotogrammi.push({ id, f });
    return id;
  };
  g.cancelAnimationFrame = (id: number) => { fotogrammi = fotogrammi.filter((x) => x.id !== id); };
  g.document = doc;
  body.children = [];
  doc.activeElement = body;
});

afterEach(() => {
  for (const k of CHIAVI) {
    if (salvati[k] === undefined) delete g[k]; else g[k] = salvati[k];
  }
});

describe('firstPanelField: il primo campo utilizzabile del corpo del pannello', () => {
  it('panel null -> null, senza errori', () => {
    expect(() => firstPanelField(null)).not.toThrow();
    expect(firstPanelField(null)).toBeNull();
  });

  it('il primo campo buono del corpo', () => {
    const a = input({ id: 'a' });
    const b = input({ id: 'b' });
    const { panel } = pannello([a, b]);
    expect(firstPanelField(panel as unknown as HTMLElement)).toBe(a);
  });

  it('salta disabilitato, sola lettura, hidden, button, reset, submit, tabIndex -1, invisibile', () => {
    const buono = input({ id: 'buono' });
    const { panel } = pannello([
      input({ id: 'dis', disabled: true }),
      input({ id: 'ro', readOnly: true }),
      input({ id: 'hid', type: 'hidden' }),
      input({ id: 'btn', type: 'button' }),
      input({ id: 'rst', type: 'reset' }),
      input({ id: 'sub', type: 'submit' }),
      input({ id: 'tab', tabIndex: -1 }),
      input({ id: 'inv', visible: false }),
      buono,
    ]);
    expect(firstPanelField(panel as unknown as HTMLElement)).toBe(buono);
  });

  it('nessun campo utilizzabile -> null', () => {
    const { panel } = pannello([input({ disabled: true }), input({ readOnly: true })]);
    expect(firstPanelField(panel as unknown as HTMLElement)).toBeNull();
  });

  it('pannello senza .edit-panel-body -> null', () => {
    const panel = new FintoEl('div', 'edit-panel').append(input({ id: 'fuori' }));
    body.append(panel);
    expect(firstPanelField(panel as unknown as HTMLElement)).toBeNull();
  });

  it('combo antd: input readOnly dentro .ant-select NON disabilitata e\' utilizzabile', () => {
    const combo = input({ id: 'combo', readOnly: true });
    const sel = new FintoEl('div', 'ant-select').append(new FintoEl('span', 'ant-select-selector').append(combo));
    const { panel } = pannello([input({ id: 'ro', readOnly: true }), sel, input({ id: 'dopo' })]);
    expect(firstPanelField(panel as unknown as HTMLElement)).toBe(combo);
  });

  it('combo antd disabilitata: si salta', () => {
    const combo = input({ id: 'combo', readOnly: true });
    const sel = new FintoEl('div', 'ant-select ant-select-disabled').append(combo);
    const dopo = input({ id: 'dopo' });
    const { panel } = pannello([sel, dopo]);
    expect(firstPanelField(panel as unknown as HTMLElement)).toBe(dopo);
  });

  it('textarea e select contano come campi', () => {
    const ta = new FintoTextArea();
    const { panel } = pannello([input({ disabled: true }), ta]);
    expect(firstPanelField(panel as unknown as HTMLElement)).toBe(ta);

    body.children = [];
    const s = new FintoSelect();
    const { panel: p2 } = pannello([s]);
    expect(firstPanelField(p2 as unknown as HTMLElement)).toBe(s);
  });

  it('i campi della testa del pannello (fuori da .edit-panel-body) non contano', () => {
    const inTesta = input({ id: 'testa' });
    const nelCorpo = input({ id: 'corpo' });
    const { panel } = pannello([nelCorpo], [inTesta]);
    expect(firstPanelField(panel as unknown as HTMLElement)).toBe(nelCorpo);
  });

  it('solo campi nella testa -> null', () => {
    const { panel } = pannello([], [input({ id: 'testa' })]);
    expect(firstPanelField(panel as unknown as HTMLElement)).toBeNull();
  });

  it('il campo annidato in profondita\' nel corpo si trova', () => {
    const dentro = input({ id: 'annidato' });
    const riga = new FintoEl('div', 'row').append(new FintoEl('div', 'cell').append(dentro));
    const { panel } = pannello([riga]);
    expect(firstPanelField(panel as unknown as HTMLElement)).toBe(dentro);
  });

  it('i campi di un altro pannello nel documento non contano', () => {
    pannello([input({ id: 'altro' })]);
    const { panel } = pannello([]);
    expect(firstPanelField(panel as unknown as HTMLElement)).toBeNull();
  });
});

describe('focusFirstPanelField: il fuoco nel pannello dopo il Nuovo', () => {
  it('panel null: nessun errore, nessun fuoco, restituisce comunque una funzione', () => {
    let annulla: unknown;
    expect(() => { annulla = focusFirstPanelField(null); }).not.toThrow();
    expect(typeof annulla).toBe('function');
    expect(() => avanza()).not.toThrow();
    expect(doc.activeElement).toBe(body);
    expect(() => (annulla as () => void)()).not.toThrow();
  });

  it('mette il fuoco sul primo campo utilizzabile, con preventScroll', () => {
    const ro = input({ id: 'ro', readOnly: true });
    const a = input({ id: 'a' });
    const { panel } = pannello([ro, a], [input({ id: 'testa' })]);
    focusFirstPanelField(panel as unknown as HTMLElement);
    avanza();
    expect(doc.activeElement).toBe(a);
    expect(a.focus).toHaveBeenCalledWith(expect.objectContaining({ preventScroll: true }));
    expect(ro.focus).not.toHaveBeenCalled();
  });

  it('input di testo: il testo viene selezionato', () => {
    const a = input({ id: 'a' });
    const { panel } = pannello([a]);
    focusFirstPanelField(panel as unknown as HTMLElement);
    avanza();
    expect(a.select).toHaveBeenCalled();
  });

  it('textarea: fuoco si\', select no', () => {
    const ta = new FintoTextArea();
    const { panel } = pannello([ta]);
    focusFirstPanelField(panel as unknown as HTMLElement);
    avanza();
    expect(doc.activeElement).toBe(ta);
    expect(ta.select).not.toHaveBeenCalled();
  });

  it('select: fuoco si\', select() no', () => {
    const s = new FintoSelect();
    const { panel } = pannello([s]);
    focusFirstPanelField(panel as unknown as HTMLElement);
    avanza();
    expect(doc.activeElement).toBe(s);
    expect(s.select).not.toHaveBeenCalled();
  });

  it('combo antd (input readOnly in .ant-select): fuoco si\', nessuna selezione del testo', () => {
    // L'input di una Select antd e' type="search" e readOnly: e' solo l'appiglio del fuoco.
    const combo = input({ id: 'combo', readOnly: true, type: 'search' });
    const sel = new FintoEl('div', 'ant-select').append(combo);
    const { panel } = pannello([sel]);
    focusFirstPanelField(panel as unknown as HTMLElement);
    avanza();
    expect(doc.activeElement).toBe(combo);
    expect(combo.select).not.toHaveBeenCalled();
  });

  it('scorre solo in verticale il contenitore del pannello fino al campo', () => {
    const a = input({ id: 'a', top: 900 });
    const { panel, corpo } = pannello([a]);
    Object.assign(corpo, { overflowY: 'auto', scrollHeight: 2000, clientHeight: 400, top: 0, height: 400 });
    corpo.scrollLeft = 0;
    focusFirstPanelField(panel as unknown as HTMLElement);
    avanza();
    expect(doc.activeElement).toBe(a);
    // 900..924 in un riquadro 0..400: si scende di 524 (block: 'nearest').
    expect(corpo.scrollTop).toBe(524);
    expect(corpo.scrollLeft).toBe(0);
    // Niente scrollIntoView: scorrerebbe anche in orizzontale (SXADV-5922).
    expect(a.scrollIntoView).not.toHaveBeenCalled();
  });

  it('campo gia\' in vista: nessuno scorrimento', () => {
    const a = input({ id: 'a', top: 100 });
    const { panel, corpo } = pannello([a]);
    Object.assign(corpo, { overflowY: 'auto', scrollHeight: 2000, clientHeight: 400, top: 0, height: 400 });
    focusFirstPanelField(panel as unknown as HTMLElement);
    avanza();
    expect(doc.activeElement).toBe(a);
    expect(corpo.scrollTop).toBe(0);
  });

  it('campo che compare qualche fotogramma dopo: il fuoco arriva lo stesso', () => {
    const { panel, corpo } = pannello([]);
    focusFirstPanelField(panel as unknown as HTMLElement);
    avanza(3);
    expect(doc.activeElement).toBe(body);
    const tardivo = input({ id: 'tardivo' });
    corpo.append(tardivo);
    avanza();
    expect(doc.activeElement).toBe(tardivo);
  });

  it('campo che compare al settimo fotogramma: ancora dentro il limite', () => {
    const { panel, corpo } = pannello([]);
    focusFirstPanelField(panel as unknown as HTMLElement);
    avanza(7);
    expect(doc.activeElement).toBe(body);
    const tardivo = input({ id: 'tardivo' });
    corpo.append(tardivo);
    avanza();
    expect(doc.activeElement).toBe(tardivo);
  });

  it('il campo non arriva mai: al massimo 10 fotogrammi, poi smette', () => {
    const { panel, corpo } = pannello([]);
    focusFirstPanelField(panel as unknown as HTMLElement);
    avanza(50);
    expect(fotogrammi).toHaveLength(0);
    expect(chiamateRaf).toBeLessThanOrEqual(10);
    expect(chiamateRaf).toBeGreaterThan(1);
    // Arriva quando ha gia' smesso: nessuno lo mette a fuoco.
    const troppoTardi = input({ id: 'tardi' });
    corpo.append(troppoTardi);
    avanza();
    expect(troppoTardi.focus).not.toHaveBeenCalled();
    expect(doc.activeElement).toBe(body);
  });

  it('trovato il campo, non si accodano altri tentativi', () => {
    const a = input({ id: 'a' });
    const { panel } = pannello([a]);
    focusFirstPanelField(panel as unknown as HTMLElement);
    avanza();
    expect(fotogrammi).toHaveLength(0);
    expect(a.focus).toHaveBeenCalledTimes(1);
  });

  it('la funzione restituita annulla i tentativi pendenti: il fuoco non arriva', () => {
    const { panel, corpo } = pannello([]);
    const annulla = focusFirstPanelField(panel as unknown as HTMLElement);
    avanza(2);
    annulla();
    const tardivo = input({ id: 'tardivo' });
    corpo.append(tardivo);
    avanza();
    expect(tardivo.focus).not.toHaveBeenCalled();
    expect(doc.activeElement).toBe(body);
  });

  it('annullare dopo che il fuoco e\' arrivato non esplode, e chiamarla due volte nemmeno', () => {
    const a = input({ id: 'a' });
    const { panel } = pannello([a]);
    const annulla = focusFirstPanelField(panel as unknown as HTMLElement);
    avanza();
    expect(() => { annulla(); annulla(); }).not.toThrow();
    expect(doc.activeElement).toBe(a);
  });

  it('finestra modale aperta: il fuoco non si sposta', () => {
    body.append(new FintoEl('div', 'ant-modal-wrap'));
    const a = input({ id: 'a' });
    const { panel } = pannello([a]);
    focusFirstPanelField(panel as unknown as HTMLElement);
    avanza();
    expect(a.focus).not.toHaveBeenCalled();
    expect(doc.activeElement).toBe(body);
  });

  it('modale presente ma nascosta (display none): il fuoco va nel pannello', () => {
    const wrap = new FintoEl('div', 'ant-modal-wrap');
    wrap.display = 'none';
    body.append(wrap);
    const a = input({ id: 'a' });
    const { panel } = pannello([a]);
    focusFirstPanelField(panel as unknown as HTMLElement);
    avanza();
    expect(doc.activeElement).toBe(a);
  });
});

// SXADV-6052: `onFocused` (secondo argomento, facoltativo) dice a EditPanel che il
// cursore e' arrivato, cosi' il contatore `focusRequest` torna a 0 e un pannello
// che si rimonta dopo non porta via il cursore. Si chiama una volta sola, e solo
// se il cursore arriva davvero.
describe('focusFirstPanelField: onFocused', () => {
  it('campo presente: chiamato una volta, a fuoco gia\' arrivato', () => {
    const a = input({ id: 'a' });
    const { panel } = pannello([a]);
    let fuocoAlMomento: unknown = null;
    const onFocused = vi.fn(() => { fuocoAlMomento = doc.activeElement; });
    focusFirstPanelField(panel as unknown as HTMLElement, onFocused);
    avanza();
    expect(onFocused).toHaveBeenCalledTimes(1);
    expect(fuocoAlMomento).toBe(a);
  });

  it('campo che compare qualche fotogramma dopo: chiamato una volta, quando arriva', () => {
    const { panel, corpo } = pannello([]);
    const onFocused = vi.fn();
    focusFirstPanelField(panel as unknown as HTMLElement, onFocused);
    avanza(3);
    expect(onFocused).not.toHaveBeenCalled();
    corpo.append(input({ id: 'tardivo' }));
    avanza();
    expect(onFocused).toHaveBeenCalledTimes(1);
  });

  it('il campo non arriva mai: non chiamato', () => {
    const { panel, corpo } = pannello([]);
    const onFocused = vi.fn();
    focusFirstPanelField(panel as unknown as HTMLElement, onFocused);
    avanza(50);
    corpo.append(input({ id: 'troppoTardi' }));
    avanza();
    expect(onFocused).not.toHaveBeenCalled();
  });

  it('solo campi non utilizzabili: non chiamato', () => {
    const { panel } = pannello([input({ disabled: true }), input({ readOnly: true })], [input({ id: 'testa' })]);
    const onFocused = vi.fn();
    focusFirstPanelField(panel as unknown as HTMLElement, onFocused);
    avanza(50);
    expect(onFocused).not.toHaveBeenCalled();
  });

  it('panel null: non chiamato', () => {
    const onFocused = vi.fn();
    focusFirstPanelField(null, onFocused);
    avanza(50);
    expect(onFocused).not.toHaveBeenCalled();
  });

  it('finestra modale aperta: non chiamato', () => {
    body.append(new FintoEl('div', 'ant-modal-wrap'));
    const { panel } = pannello([input({ id: 'a' })]);
    const onFocused = vi.fn();
    focusFirstPanelField(panel as unknown as HTMLElement, onFocused);
    avanza(50);
    expect(onFocused).not.toHaveBeenCalled();
  });

  it('tentativi annullati prima che il campo arrivi: non chiamato', () => {
    const { panel, corpo } = pannello([]);
    const onFocused = vi.fn();
    const annulla = focusFirstPanelField(panel as unknown as HTMLElement, onFocused);
    avanza(2);
    annulla();
    corpo.append(input({ id: 'tardivo' }));
    avanza(50);
    expect(onFocused).not.toHaveBeenCalled();
  });

  it('annullare dopo l\'arrivo non lo richiama, e un secondo giro di fotogrammi nemmeno', () => {
    const { panel } = pannello([input({ id: 'a' })]);
    const onFocused = vi.fn();
    const annulla = focusFirstPanelField(panel as unknown as HTMLElement, onFocused);
    avanza();
    annulla();
    avanza(50);
    expect(onFocused).toHaveBeenCalledTimes(1);
  });

  it('senza onFocused il fuoco arriva lo stesso (argomento facoltativo)', () => {
    const a = input({ id: 'a' });
    const { panel } = pannello([a]);
    expect(() => { focusFirstPanelField(panel as unknown as HTMLElement); avanza(); }).not.toThrow();
    expect(doc.activeElement).toBe(a);
  });
});
