import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  snapshotScroll,
  scrollKey,
  findByScrollKey,
  applyScroll,
  isRestoringScroll,
  SCROLL_RESTORE_ATTR,
  type ScrollSnapshot,
} from './tabScrollMemory';

// SXADV-6008 (collaudo): due sessioni applicative, S1 con la lista Fatture
// scorsa in fondo e tutta a destra; si passa a S2 e si torna su S1: le barre
// di scorrimento sono tornate in alto a sinistra. Nel legacy restano dove
// erano. La Shell fotografa lo scorrimento di `.tab-content` lasciando la
// scheda e lo riapplica tornando, quando il DOM e' rinato da capo: nodi
// nuovi, stessa struttura. Il modulo puro tabScrollMemory fa la fotografia e
// la riapplicazione; qui si prova quello che PROMETTE:
//
//  - snapshotScroll: una voce per ogni elemento con escursione di scorrimento
//    (root compreso), anche se e' a 0,0; nessuna per chi non scorre;
//  - scrollKey / findByScrollKey: chiave strutturale relativa al root, che
//    regge fratelli di ALTRA classe/tag inseriti o tolti prima (il velo di
//    caricamento), distingue fratelli della stessa classe per ordine e
//    risolve allo stesso posto in un DOM ricostruito identico;
//  - applyScroll: imposta i valori salvati dove differiscono, true solo se
//    tutto e' stato trovato ed e' ai valori salvati (false finche', per
//    esempio, la griglia non e' ancora abbastanza alta: e' il motivo della
//    finestra di ripetizione nella Shell);
//  - fine corsa: una voce a fine corsa (entro 1px, con escursione > 0) porta
//    atBottom/atRight, e applyScroll la rimette a fine corsa dell'escursione
//    ATTUALE, non al pixel fotografato; "gia' a posto" vale entro 1px;
//  - isRestoringScroll: l'attributo SCROLL_RESTORE_ATTR su el o un antenato.
//
// Chi prova non e' chi implementa. L'ambiente dei test e' node: niente DOM
// vero, ne' jsdom. Qui un DOM finto abbastanza largo da non imporre
// all'implementazione un modo di percorrerlo: figli/fratelli/genitori,
// classList, attributi, closest/matches/querySelector(All) con i selettori
// comuni (tag, #id, .classe, [attr], :scope, :nth-child, :nth-of-type,
// discendente e figlio). Un selettore che il DOM finto non sa leggere LANCIA,
// con il selettore nel messaggio: se un caso fallisce cosi', e' il banco di
// prova da allargare, non necessariamente il modulo.
// Le metriche di scorrimento sono quelle del browser: scrollTop/scrollLeft
// stanno fra 0 e (scrollHeight - clientHeight) / (scrollWidth - clientWidth),
// e ogni scrittura si conta.

// ─────────────────────────────────────────────────────────── il DOM finto
type Pred = (el: FintoEl) => boolean;

/** Come DOMTokenList: indicizzabile (`classList[0]`), iterabile, e coi metodi. */
function listaClassi(el: FintoEl) {
  const set = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  const scrivi = (xs: string[]) => el.setAttribute('class', xs.join(' '));
  return Object.assign(set.slice(), {
    contains: (c: string) => set.includes(c),
    add: (...cs: string[]) => scrivi([...set, ...cs.filter((c) => !set.includes(c))]),
    remove: (...cs: string[]) => scrivi(set.filter((c) => !cs.includes(c))),
    toggle: (c: string, force?: boolean) => {
      const on = force ?? !set.includes(c);
      scrivi(on ? [...set.filter((x) => x !== c), c] : set.filter((x) => x !== c));
      return on;
    },
    item: (i: number) => set[i] ?? null,
    value: set.join(' '),
    toString: () => set.join(' '),
  });
}

function collezione(arr: FintoEl[]): FintoEl[] & { item(i: number): FintoEl | null } {
  const c = arr.slice() as FintoEl[] & { item(i: number): FintoEl | null };
  c.item = (i: number) => c[i] ?? null;
  return c;
}

let scritture = 0;
/** Scritture di scrollTop/scrollLeft per elemento. */
const scrittureDi = new Map<FintoEl, number>();
const conta = (e: FintoEl) => { scritture += 1; scrittureDi.set(e, (scrittureDi.get(e) ?? 0) + 1); };

class FintoEl {
  readonly nodeType = 1;
  readonly localName: string;
  private attrs = new Map<string, string>();
  private kids: FintoEl[] = [];
  parentElement: FintoEl | null = null;
  readonly style: Record<string, string> = {};
  // metriche di scorrimento
  scrollHeight = 0;
  clientHeight = 0;
  scrollWidth = 0;
  clientWidth = 0;
  offsetHeight = 0;
  offsetWidth = 0;
  private _top = 0;
  private _left = 0;
  overflow = 'visible';

  constructor(tag = 'div', cls = '') {
    this.localName = tag.toLowerCase();
    if (cls) this.setAttribute('class', cls);
  }

  get classList() { return listaClassi(this); }
  get tagName() { return this.localName.toUpperCase(); }
  get nodeName() { return this.tagName; }
  get id() { return this.getAttribute('id') || ''; }
  set id(v: string) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v: string) { this.setAttribute('class', v); }

  getAttribute(n: string) { return this.attrs.has(n) ? this.attrs.get(n)! : null; }
  setAttribute(n: string, v: string) { this.attrs.set(n, String(v)); }
  hasAttribute(n: string) { return this.attrs.has(n); }
  removeAttribute(n: string) { this.attrs.delete(n); }
  toggleAttribute(n: string, force?: boolean) {
    const on = force ?? !this.attrs.has(n);
    if (on) this.attrs.set(n, ''); else this.attrs.delete(n);
    return on;
  }
  getAttributeNames() { return Array.from(this.attrs.keys()); }
  get attributes() { return Array.from(this.attrs, ([name, value]) => ({ name, value })); }
  get dataset(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.attrs) if (k.startsWith('data-')) out[k.slice(5).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())] = v;
    return out;
  }

  // ── albero
  get parentNode() { return this.parentElement; }
  get children() { return collezione(this.kids); }
  get childNodes() { return collezione(this.kids); }
  get childElementCount() { return this.kids.length; }
  get firstElementChild() { return this.kids[0] ?? null; }
  get lastElementChild() { return this.kids[this.kids.length - 1] ?? null; }
  get firstChild() { return this.firstElementChild; }
  get lastChild() { return this.lastElementChild; }
  private get sibs() { return this.parentElement ? this.parentElement.kids : [this]; }
  get nextElementSibling() { const s = this.sibs; return s[s.indexOf(this) + 1] ?? null; }
  get previousElementSibling() { const s = this.sibs; return s[s.indexOf(this) - 1] ?? null; }
  get nextSibling() { return this.nextElementSibling; }
  get previousSibling() { return this.previousElementSibling; }
  get isConnected() { return true; }
  get ownerDocument() { return documentoFinto; }
  getRootNode(): FintoEl { return this.parentElement ? this.parentElement.getRootNode() : this; }

  private stacca(f: FintoEl) {
    if (f.parentElement) { const s = f.parentElement.kids; s.splice(s.indexOf(f), 1); }
    f.parentElement = this;
  }
  appendChild(f: FintoEl) { this.stacca(f); this.kids.push(f); return f; }
  append(...fs: FintoEl[]) { for (const f of fs) this.appendChild(f); }
  prepend(...fs: FintoEl[]) { fs.slice().reverse().forEach((f) => { this.stacca(f); this.kids.unshift(f); }); }
  insertBefore(f: FintoEl, ref: FintoEl | null) {
    if (!ref) return this.appendChild(f);
    this.stacca(f);
    this.kids.splice(this.kids.indexOf(ref), 0, f);
    return f;
  }
  removeChild(f: FintoEl) { this.kids.splice(this.kids.indexOf(f), 1); f.parentElement = null; return f; }
  remove() { this.parentElement?.removeChild(this); }
  contains(o: unknown): boolean {
    for (let n = o as FintoEl | null; n; n = n.parentElement) if (n === this) return true;
    return false;
  }
  compareDocumentPosition(o: FintoEl) { return this.contains(o) ? 20 : o.contains(this) ? 10 : 0; }

  *discendenti(): Generator<FintoEl> {
    for (const k of this.kids) { yield k; yield* k.discendenti(); }
  }

  // ── selettori
  matches(sel: string) { return compila(sel, this)(this); }
  closest(sel: string): FintoEl | null {
    const p = compila(sel, this);
    if (p(this)) return this;
    return this.parentElement ? this.parentElement.closest(sel) : null;
  }
  querySelectorAll(sel: string) {
    const p = compila(sel, this);
    return collezione(Array.from(this.discendenti()).filter(p));
  }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? null; }
  getElementsByTagName(t: string) { return this.querySelectorAll(t); }
  getElementsByClassName(c: string) { return this.querySelectorAll(c.split(/\s+/).map((x) => '.' + x).join('')); }

  // ── scorrimento, con i limiti del browser
  private maxTop() { return Math.max(0, this.scrollHeight - this.clientHeight); }
  private maxLeft() { return Math.max(0, this.scrollWidth - this.clientWidth); }
  get scrollTop() { return this._top; }
  set scrollTop(v: number) { conta(this); this._top = Math.min(Math.max(0, Number(v) || 0), this.maxTop()); }
  get scrollLeft() { return this._left; }
  set scrollLeft(v: number) { conta(this); this._left = Math.min(Math.max(0, Number(v) || 0), this.maxLeft()); }
  scrollTo(a?: number | { top?: number; left?: number }, b?: number) {
    if (typeof a === 'object' && a) {
      if (a.top !== undefined) this.scrollTop = a.top;
      if (a.left !== undefined) this.scrollLeft = a.left;
    } else {
      if (a !== undefined) this.scrollLeft = a;
      if (b !== undefined) this.scrollTop = b;
    }
  }
  scroll(a?: number | { top?: number; left?: number }, b?: number) { this.scrollTo(a, b); }
  scrollBy(a?: number | { top?: number; left?: number }, b?: number) {
    if (typeof a === 'object' && a) this.scrollTo({ top: this._top + (a.top ?? 0), left: this._left + (a.left ?? 0) });
    else this.scrollTo(this._left + (a ?? 0), this._top + (b ?? 0));
  }
  getBoundingClientRect() {
    return { top: 0, left: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight, x: 0, y: 0 };
  }
  getClientRects() { return [this.getBoundingClientRect()]; }
}

/** Selettori: lista separata da virgole di catene di composti uniti da
 *  discendente o `>`. Un composto: tag|*, #id, .classe, [attr], [attr=v],
 *  [attr~=v], [attr^=v], [attr$=v], [attr*=v], :scope, :root, :first-child,
 *  :last-child, :only-child, :nth-child(n), :nth-of-type(n), :not(composto). */
function compila(selettore: string, scope: FintoEl): Pred {
  const alternative = dividi(selettore, ',').map((s) => catena(s.trim(), scope, selettore));
  return (el) => alternative.some((p) => p(el));
}

function dividi(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '', q = '';
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function catena(s: string, scope: FintoEl, intero: string): Pred {
  // token: composti e combinatori
  const parti: string[] = [];
  let depth = 0, cur = '', q = '';
  const spingi = () => { if (cur) { parti.push(cur); cur = ''; } };
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~')) {
      spingi();
      if (ch !== ' ') parti.push(ch);
      continue;
    }
    cur += ch;
  }
  spingi();
  if (!parti.length) throw new Error(`DOM finto: selettore vuoto in "${intero}"`);
  // [composto, comb, composto, comb, composto]; combinatore implicito = ' '
  const comp: Pred[] = [];
  const comb: string[] = [];
  let atteso = 'c';
  for (const p of parti) {
    if (p === '>' || p === '+' || p === '~') {
      if (p !== '>') throw new Error(`DOM finto: combinatore "${p}" non supportato in "${intero}"`);
      comb[comp.length - 1] = '>';
      atteso = 'c';
      continue;
    }
    if (atteso === 'x') comb[comp.length - 1] = comb[comp.length - 1] ?? ' ';
    comp.push(composto(p, scope, intero));
    atteso = 'x';
  }
  const prova = (el: FintoEl, i: number): boolean => {
    if (!comp[i](el)) return false;
    if (i === 0) return true;
    const c = comb[i - 1] ?? ' ';
    if (c === '>') return !!el.parentElement && prova(el.parentElement, i - 1);
    for (let a = el.parentElement; a; a = a.parentElement) if (prova(a, i - 1)) return true;
    return false;
  };
  return (el) => prova(el, comp.length - 1);
}

function composto(s: string, scope: FintoEl, intero: string): Pred {
  const preds: Pred[] = [];
  let i = 0;
  const leggiIdent = () => { const m = /^-?[\w-]+|^\*/.exec(s.slice(i)); if (!m) throw new Error(`DOM finto: selettore non supportato "${intero}"`); i += m[0].length; return m[0]; };
  if (s[0] !== '.' && s[0] !== '#' && s[0] !== '[' && s[0] !== ':') {
    const t = leggiIdent().toLowerCase();
    if (t !== '*') preds.push((el) => el.localName === t);
  }
  while (i < s.length) {
    const ch = s[i];
    if (ch === '.') { i++; const c = unescape(leggiIdent()); preds.push((el) => el.classList.contains(c)); }
    else if (ch === '#') { i++; const id = leggiIdent(); preds.push((el) => el.id === id); }
    else if (ch === '[') {
      const fine = s.indexOf(']', i);
      const corpo = s.slice(i + 1, fine);
      i = fine + 1;
      const m = /^\s*([\w-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*$/.exec(corpo);
      if (!m) throw new Error(`DOM finto: attributo non supportato "${intero}"`);
      const [, nome, op, v1, v2, v3] = m;
      const val = v1 ?? v2 ?? v3 ?? '';
      preds.push((el) => {
        const a = el.getAttribute(nome);
        if (a === null) return false;
        switch (op) {
          case undefined: return true;
          case '=': return a === val;
          case '~=': return a.split(/\s+/).includes(val);
          case '^=': return a.startsWith(val);
          case '$=': return a.endsWith(val);
          case '*=': return a.includes(val);
          case '|=': return a === val || a.startsWith(val + '-');
          default: return false;
        }
      });
    } else if (ch === ':') {
      i++;
      const nome = leggiIdent();
      let arg = '';
      if (s[i] === '(') {
        let d = 0, j = i;
        for (; j < s.length; j++) { if (s[j] === '(') d++; if (s[j] === ')') { d--; if (!d) break; } }
        arg = s.slice(i + 1, j);
        i = j + 1;
      }
      const sib = (el: FintoEl) => (el.parentElement ? Array.from(el.parentElement.children) : [el]);
      switch (nome) {
        case 'scope': preds.push((el) => el === scope); break;
        case 'root': preds.push((el) => !el.parentElement); break;
        case 'first-child': preds.push((el) => sib(el)[0] === el); break;
        case 'last-child': preds.push((el) => { const x = sib(el); return x[x.length - 1] === el; }); break;
        case 'only-child': preds.push((el) => sib(el).length === 1); break;
        case 'nth-child': { const n = Number(arg); if (!Number.isInteger(n)) throw new Error(`DOM finto: :nth-child(${arg}) non supportato`); preds.push((el) => sib(el).indexOf(el) + 1 === n); break; }
        case 'nth-of-type': { const n = Number(arg); if (!Number.isInteger(n)) throw new Error(`DOM finto: :nth-of-type(${arg}) non supportato`); preds.push((el) => sib(el).filter((x) => x.localName === el.localName).indexOf(el) + 1 === n); break; }
        case 'not': { const p = compila(arg, scope); preds.push((el) => !p(el)); break; }
        default: throw new Error(`DOM finto: pseudo-classe :${nome} non supportata in "${intero}"`);
      }
    } else throw new Error(`DOM finto: selettore non supportato "${intero}"`);
  }
  return (el) => preds.every((p) => p(el));
}
function unescape(s: string) { return s.replace(/\\(.)/g, '$1'); }

const documentoFinto = {
  get body() { return corpoDocumento; },
  get documentElement() { return corpoDocumento; },
  createElement: (t: string) => new FintoEl(t),
  querySelector: (s: string) => corpoDocumento.querySelector(s),
  querySelectorAll: (s: string) => corpoDocumento.querySelectorAll(s),
  contains: (n: unknown) => corpoDocumento.contains(n),
};
const corpoDocumento = new FintoEl('body');

const g = globalThis as Record<string, unknown>;
const CHIAVI = ['document', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'window'];
const salvati: Record<string, unknown> = {};
beforeAll(() => {
  for (const k of CHIAVI) salvati[k] = g[k];
  g.document = documentoFinto;
  g.HTMLElement = FintoEl;
  g.Element = FintoEl;
  g.Node = FintoEl;
  g.getComputedStyle = (el: FintoEl) => ({
    overflow: el.overflow, overflowX: el.overflow, overflowY: el.overflow,
    getPropertyValue: (p: string) => (p.startsWith('overflow') ? el.overflow : ''),
  });
  g.window = g;
});
afterAll(() => {
  for (const k of CHIAVI) g[k] = salvati[k];
});

// ─────────────────────────────────────────────────────────── costruzione
/** Un elemento; `figli` si appendono in ordine. */
function el(tag: string, cls: string, ...figli: FintoEl[]): FintoEl {
  const e = new FintoEl(tag, cls);
  e.append(...figli);
  return e;
}
/** Rende scorrevole l'elemento: escursione verticale e/o orizzontale. */
function scorre(e: FintoEl, o: { h?: number; w?: number; top?: number; left?: number } = {}): FintoEl {
  e.clientHeight = 400; e.clientWidth = 800;
  e.scrollHeight = o.h ?? 400; e.scrollWidth = o.w ?? 800;
  e.offsetHeight = 400; e.offsetWidth = 800;
  e.overflow = 'auto';
  e.scrollTop = o.top ?? 0; e.scrollLeft = o.left ?? 0;
  return e;
}
/** Un elemento che NON scorre: contenuto uguale al riquadro. */
function fermo(e: FintoEl): FintoEl {
  e.clientHeight = 300; e.scrollHeight = 300; e.clientWidth = 600; e.scrollWidth = 600;
  e.offsetHeight = 300; e.offsetWidth = 600;
  return e;
}
const H = (e: FintoEl) => e as unknown as HTMLElement;
/** Identita' di elemento. Non si passa l'elemento a expect: su un errore
 *  vitest confronterebbe in profondita' due alberi finti con i genitori
 *  (cicli) e non tornerebbe piu'. Si confrontano due descrizioni. */
function descrivi(e: unknown): string {
  if (!e) return String(e);
  const parti: string[] = [];
  for (let n = e as FintoEl | null; n; n = n.parentElement) {
    const fr = n.parentElement ? Array.from(n.parentElement.children).indexOf(n) : 0;
    parti.unshift(`${n.localName}.${n.className.replace(/\s+/g, '.')}[${fr}]`);
  }
  return parti.join(' > ');
}
const idDi = new WeakMap<object, number>();
let prossimoId = 1;
const ident = (e: unknown) => {
  if (!e || typeof e !== 'object') return `${String(e)}`;
  if (!idDi.has(e)) idDi.set(e, prossimoId++);
  return `#${idDi.get(e)} ${descrivi(e)}`;
};
function stesso(got: unknown, want: FintoEl) {
  expect(ident(got)).toBe(ident(want));
}
const voceDi = (root: FintoEl, snap: ScrollSnapshot, e: FintoEl) =>
  snap.find((v) => findByScrollKey(H(root), v.key) === H(e));

/** La scheda di una lista a pagina intera, alla AG Grid:
 *  .tab-content > [breadcrumb, toolbar, .list-wrap > .ag-root-wrapper >
 *  [.ag-header, .ag-body > .ag-body-viewport, .ag-body-horizontal-scroll >
 *  .ag-body-horizontal-scroll-viewport]] */
function schedaLista() {
  const vp = scorre(el('div', 'ag-body-viewport'), { h: 6000, w: 800 });
  const hvp = scorre(el('div', 'ag-body-horizontal-scroll-viewport'), { h: 400, w: 4000 });
  const header = fermo(el('div', 'ag-header'));
  const grid = el('div', 'ag-root-wrapper',
    header,
    el('div', 'ag-body', vp),
    el('div', 'ag-body-horizontal-scroll', hvp));
  const root = scorre(el('div', 'tab-content'), { h: 450, w: 800 }); // un filo di escursione, fermo a 0,0
  root.append(
    fermo(el('div', 'breadcrumb-band')),
    fermo(el('div', 'toolbar')),
    el('div', 'list-wrap', grid),
  );
  return { root, vp, hvp, header, grid };
}

/** Un dettaglio con due griglie incorporate, sorelle della stessa classe. */
function schedaDettaglio() {
  const g1 = scorre(el('div', 'ag-body-viewport'), { h: 3000 });
  const g2 = scorre(el('div', 'ag-body-viewport'), { h: 3000 });
  const tab1 = el('div', 'embedded-grid', el('div', 'ag-root-wrapper', g1));
  const tab2 = el('div', 'embedded-grid', el('div', 'ag-root-wrapper', g2));
  const root = scorre(el('div', 'tab-content'), { h: 2400 });
  root.append(el('div', 'view-form', fermo(el('table', 'layout-table'))), tab1, tab2);
  return { root, g1, g2, tab1, tab2 };
}

// ─────────────────────────────────────────────────────────────────── prove
describe('snapshotScroll', () => {
  it('una voce per ogni area con escursione, root compreso, anche se a 0,0', () => {
    const { root, vp, hvp } = schedaLista();
    vp.scrollTop = 5600;
    hvp.scrollLeft = 3200;
    const snap = snapshotScroll(H(root));
    expect(snap).toHaveLength(3);
    expect(voceDi(root, snap, root)).toMatchObject({ top: 0, left: 0 });
    expect(voceDi(root, snap, vp)).toMatchObject({ top: 5600, left: 0 });
    expect(voceDi(root, snap, hvp)).toMatchObject({ top: 0, left: 3200 });
  });

  it('nessuna voce per chi non ha escursione, anche con overflow auto', () => {
    const { root, header } = schedaLista();
    header.overflow = 'auto';
    const snap = snapshotScroll(H(root));
    expect(voceDi(root, snap, header)).toBeUndefined();
    for (const v of snap) expect(typeof v.key).toBe('string');
  });

  it('il root senza escursione non ha voce; un nipote che scorre si', () => {
    const root = fermo(el('div', 'tab-content'));
    const nipote = scorre(el('div', 'view-body'), { h: 1000, top: 250 });
    root.append(el('div', 'wrap', nipote));
    const snap = snapshotScroll(H(root));
    expect(snap).toHaveLength(1);
    expect(voceDi(root, snap, nipote)).toMatchObject({ top: 250, left: 0 });
    expect(voceDi(root, snap, root)).toBeUndefined();
  });

  it('il root stesso scorrevole (dettaglio piu\' alto dello schermo) e\' fotografato', () => {
    const root = scorre(el('div', 'tab-content'), { h: 2400, top: 900 });
    root.append(fermo(el('div', 'view-form')));
    const snap = snapshotScroll(H(root));
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ top: 900, left: 0 });
    stesso(findByScrollKey(H(root), snap[0].key), root);
  });

  it('niente che scorre: fotografia vuota', () => {
    const root = fermo(el('div', 'tab-content'));
    root.append(fermo(el('div', 'x')));
    expect(snapshotScroll(H(root))).toEqual([]);
  });

  it('la fotografia e\' un valore: scorrere dopo non la cambia', () => {
    const { root, vp } = schedaLista();
    vp.scrollTop = 1000;
    const snap = snapshotScroll(H(root));
    vp.scrollTop = 3000;
    expect(voceDi(root, snap, vp)?.top).toBe(1000);
  });
});

describe('scrollKey / findByScrollKey', () => {
  it('andata e ritorno su ogni area, root compreso', () => {
    const { root, vp, hvp, header } = schedaLista();
    for (const e of [root, vp, hvp, header]) {
      const k = scrollKey(H(root), H(e));
      expect(k).not.toBeNull();
      stesso(findByScrollKey(H(root), k!), e);
    }
  });

  it('un elemento fuori dal root non ha chiave', () => {
    const { root } = schedaLista();
    const fuori = el('div', 'ag-body-viewport');
    el('div', 'altrove', fuori);
    expect(scrollKey(H(root), H(fuori))).toBeNull();
    // ...nemmeno un antenato del root
    const padre = el('div', 'content', root);
    expect(scrollKey(H(root), H(padre))).toBeNull();
  });

  it('una chiave che nel root non porta da nessuna parte risolve a null', () => {
    const { root, vp } = schedaLista();
    const k = scrollKey(H(root), H(vp))!;
    const vuoto = el('div', 'tab-content', fermo(el('div', 'toolbar')));
    expect(findByScrollKey(H(vuoto), k)).toBeNull();
  });

  it('regge il velo di caricamento inserito come primo figlio del root', () => {
    const { root, vp, hvp } = schedaLista();
    const kv = scrollKey(H(root), H(vp))!;
    const kh = scrollKey(H(root), H(hvp))!;
    const velo = el('div', 'loading-overlay');
    root.prepend(velo);
    stesso(findByScrollKey(H(root), kv), vp);
    stesso(findByScrollKey(H(root), kh), hvp);
    // e la chiave presa CON il velo vale anche dopo che il velo se n'e' andato
    const kvVelo = scrollKey(H(root), H(vp))!;
    velo.remove();
    stesso(findByScrollKey(H(root), kvVelo), vp);
  });

  it('regge un fratello di altro tag/classe inserito subito prima dell\'elemento', () => {
    const { root, vp } = schedaLista();
    const k = scrollKey(H(root), H(vp))!;
    const body = vp.parentElement!;
    body.insertBefore(el('span', 'ag-overlay'), vp);
    body.insertBefore(el('div', 'ag-pinned-left-cols-container'), vp);
    stesso(findByScrollKey(H(root), k), vp);
  });

  it('regge un fratello di altra classe tolto prima di un antenato', () => {
    const { root, vp } = schedaLista();
    const k = scrollKey(H(root), H(vp))!;
    root.querySelector('.breadcrumb-band')!.remove();
    stesso(findByScrollKey(H(root), k), vp);
  });

  it('due fratelli della stessa classe sono distinti per ordine', () => {
    const { root, g1, g2, tab1, tab2 } = schedaDettaglio();
    const k1 = scrollKey(H(root), H(g1))!;
    const k2 = scrollKey(H(root), H(g2))!;
    expect(k1).not.toBe(k2);
    stesso(findByScrollKey(H(root), k1), g1);
    stesso(findByScrollKey(H(root), k2), g2);
    expect(scrollKey(H(root), H(tab1))).not.toBe(scrollKey(H(root), H(tab2)));
  });

  it('i fratelli della stessa classe restano distinti anche col velo davanti', () => {
    const { root, g1, g2 } = schedaDettaglio();
    const k1 = scrollKey(H(root), H(g1))!;
    const k2 = scrollKey(H(root), H(g2))!;
    root.prepend(el('div', 'loading-overlay'));
    stesso(findByScrollKey(H(root), k1), g1);
    stesso(findByScrollKey(H(root), k2), g2);
  });

  it('un DOM ricostruito identico (nodi nuovi) risolve le stesse chiavi agli elementi corrispondenti', () => {
    const a = schedaLista();
    const b = schedaLista();
    expect(b.vp).not.toBe(a.vp);
    stesso(findByScrollKey(H(b.root), scrollKey(H(a.root), H(a.vp))!), b.vp);
    stesso(findByScrollKey(H(b.root), scrollKey(H(a.root), H(a.hvp))!), b.hvp);
    stesso(findByScrollKey(H(b.root), scrollKey(H(a.root), H(a.root))!), b.root);
    const da = schedaDettaglio();
    const db = schedaDettaglio();
    stesso(findByScrollKey(H(db.root), scrollKey(H(da.root), H(da.g2))!), db.g2);
    stesso(findByScrollKey(H(db.root), scrollKey(H(da.root), H(da.g1))!), db.g1);
  });

  it('la chiave dipende dalla struttura, non dal root fisico: stessa chiave su due DOM identici', () => {
    const a = schedaLista();
    const b = schedaLista();
    expect(scrollKey(H(a.root), H(a.vp))).toBe(scrollKey(H(b.root), H(b.vp)));
  });
});

describe('applyScroll', () => {
  it('riporta ogni area alla posizione fotografata su un DOM rinato, e dice true', () => {
    const a = schedaLista();
    a.vp.scrollTop = 5600;
    a.hvp.scrollLeft = 3200;
    const snap = snapshotScroll(H(a.root));
    const b = schedaLista();
    expect(applyScroll(H(b.root), snap)).toBe(true);
    expect(b.vp.scrollTop).toBe(5600);
    expect(b.hvp.scrollLeft).toBe(3200);
    expect(b.root.scrollTop).toBe(0);
  });

  it('posizione a meta\', in entrambe le direzioni sulla stessa area', () => {
    const root = fermo(el('div', 'tab-content'));
    const area = scorre(el('div', 'ag-body-viewport'), { h: 5000, w: 3000, top: 1234, left: 567 });
    root.append(area);
    const snap = snapshotScroll(H(root));
    const root2 = fermo(el('div', 'tab-content'));
    const area2 = scorre(el('div', 'ag-body-viewport'), { h: 5000, w: 3000 });
    root2.append(area2);
    expect(applyScroll(H(root2), snap)).toBe(true);
    expect([area2.scrollTop, area2.scrollLeft]).toEqual([1234, 567]);
  });

  it('il root stesso scorrevole torna a meta\'', () => {
    const root = scorre(el('div', 'tab-content'), { h: 2400, top: 900 });
    const snap = snapshotScroll(H(root));
    const root2 = scorre(el('div', 'tab-content'), { h: 2400 });
    expect(applyScroll(H(root2), snap)).toBe(true);
    expect(root2.scrollTop).toBe(900);
  });

  it('il velo davanti non impedisce il ripristino', () => {
    const a = schedaLista();
    a.vp.scrollTop = 2000;
    const snap = snapshotScroll(H(a.root));
    const b = schedaLista();
    b.root.prepend(el('div', 'loading-overlay'));
    expect(applyScroll(H(b.root), snap)).toBe(true);
    expect(b.vp.scrollTop).toBe(2000);
  });

  it('voce non trovata -> false, ma le altre si applicano lo stesso', () => {
    const a = schedaLista();
    a.vp.scrollTop = 2000;
    a.hvp.scrollLeft = 1000;
    const snap = snapshotScroll(H(a.root));
    // Il DOM nuovo non ha (ancora) la barra orizzontale.
    const b = schedaLista();
    b.hvp.parentElement!.remove();
    expect(applyScroll(H(b.root), snap)).toBe(false);
    expect(b.vp.scrollTop).toBe(2000);
  });

  it('area ancora troppo corta (la griglia sta disegnando) -> false; cresciuta -> true', () => {
    const a = schedaLista();
    a.vp.scrollTop = 3000; // a meta': non e' fine corsa, conta il pixel
    const snap = snapshotScroll(H(a.root));
    const b = schedaLista();
    b.vp.scrollHeight = 1000; // solo le prime righe disegnate: massimo 600
    expect(applyScroll(H(b.root), snap)).toBe(false);
    expect(b.vp.scrollTop).toBe(600);
    b.vp.scrollHeight = 6000;
    expect(applyScroll(H(b.root), snap)).toBe(true);
    expect(b.vp.scrollTop).toBe(3000);
  });

  it('scrollTop frazionario entro 1px: e\' gia\' a posto, true senza riscrivere', () => {
    const a = schedaLista();
    a.vp.scrollTop = 2000;
    const snap = snapshotScroll(H(a.root));
    const b = schedaLista();
    b.vp.scrollTop = 2000.4;
    scrittureDi.clear();
    expect(applyScroll(H(b.root), snap)).toBe(true);
    expect(scrittureDi.get(b.vp) ?? 0).toBe(0);
  });

  it('valori gia\' giusti -> true senza riscrivere niente', () => {
    const a = schedaLista();
    a.vp.scrollTop = 2000;
    a.hvp.scrollLeft = 1500;
    const snap = snapshotScroll(H(a.root));
    expect(applyScroll(H(a.root), snap)).toBe(true);
    const b = schedaLista();
    applyScroll(H(b.root), snap);
    scritture = 0;
    expect(applyScroll(H(b.root), snap)).toBe(true);
    expect(scritture).toBe(0);
  });

  it('scrive solo dove differisce', () => {
    const a = schedaLista();
    a.vp.scrollTop = 2000;
    const snap = snapshotScroll(H(a.root));
    const b = schedaLista();
    scrittureDi.clear();
    expect(applyScroll(H(b.root), snap)).toBe(true);
    // root e barra orizzontale sono gia' a 0,0: non si toccano; la griglia si'
    expect(scrittureDi.get(b.root) ?? 0).toBe(0);
    expect(scrittureDi.get(b.hvp) ?? 0).toBe(0);
    expect(scrittureDi.get(b.vp) ?? 0).toBeGreaterThan(0);
  });

  it('fotografia vuota: true, niente scritture', () => {
    const { root } = schedaLista();
    scritture = 0;
    expect(applyScroll(H(root), [])).toBe(true);
    expect(scritture).toBe(0);
  });

  it('riporta indietro anche un\'area scorsa OLTRE il valore salvato (verso 0)', () => {
    const a = schedaLista();
    const snap = snapshotScroll(H(a.root)); // tutto a 0,0
    const b = schedaLista();
    b.vp.scrollTop = 3000;
    b.hvp.scrollLeft = 900;
    expect(applyScroll(H(b.root), snap)).toBe(true);
    expect([b.vp.scrollTop, b.hvp.scrollLeft]).toEqual([0, 0]);
  });
});

describe('fine corsa (atBottom / atRight)', () => {
  it('in fondo e tutto a destra: la fotografia lo dice', () => {
    const { root, vp, hvp } = schedaLista();
    vp.scrollTop = 5600; // massimo: 6000 - 400
    hvp.scrollLeft = 3200; // massimo: 4000 - 800
    const snap = snapshotScroll(H(root));
    expect(voceDi(root, snap, vp)?.atBottom).toBe(true);
    expect(voceDi(root, snap, hvp)?.atRight).toBe(true);
  });

  it('entro 1px dalla fine e\' ancora fine corsa (scrollTop frazionari)', () => {
    const { root, vp } = schedaLista();
    vp.scrollTop = 5599.5;
    expect(voceDi(root, snapshotScroll(H(root)), vp)?.atBottom).toBe(true);
  });

  it('a meta\' o a 0 non e\' fine corsa; senza escursione in quel verso nemmeno', () => {
    const { root, vp, hvp } = schedaLista();
    vp.scrollTop = 3000;
    const snap = snapshotScroll(H(root));
    expect(voceDi(root, snap, vp)?.atBottom).toBeFalsy();
    expect(voceDi(root, snap, vp)?.atRight).toBeFalsy(); // nessuna escursione orizzontale
    expect(voceDi(root, snap, hvp)?.atRight).toBeFalsy(); // a 0 su 3200
    expect(voceDi(root, snap, hvp)?.atBottom).toBeFalsy(); // nessuna escursione verticale
    expect(voceDi(root, snap, root)?.atBottom).toBeFalsy(); // 0 su 0
  });

  it('fine corsa si riapplica sulla corsa ATTUALE, non sul pixel fotografato', () => {
    const a = schedaLista();
    a.vp.scrollTop = 5600;
    a.hvp.scrollLeft = 3200;
    const snap = snapshotScroll(H(a.root));
    // Al ritorno le righe ad altezza automatica rendono la griglia piu' alta,
    // e le colonne un po' piu' larghe: il fondo e' piu' in la'.
    const b = schedaLista();
    b.vp.scrollHeight = 7000;
    b.hvp.scrollWidth = 4500;
    expect(applyScroll(H(b.root), snap)).toBe(true);
    expect(b.vp.scrollTop).toBe(6600);
    expect(b.hvp.scrollLeft).toBe(3700);
  });

  it('fine corsa su una corsa piu\' corta di quella fotografata: in fondo lo stesso', () => {
    const a = schedaLista();
    a.vp.scrollTop = 5600;
    const snap = snapshotScroll(H(a.root));
    const b = schedaLista();
    b.vp.scrollHeight = 3000;
    applyScroll(H(b.root), snap);
    expect(b.vp.scrollTop).toBe(2600);
  });

  it('gia\' in fondo alla corsa attuale: true senza riscrivere', () => {
    const a = schedaLista();
    a.vp.scrollTop = 5600;
    const snap = snapshotScroll(H(a.root));
    const b = schedaLista();
    b.vp.scrollHeight = 7000;
    b.vp.scrollTop = 6600;
    scrittureDi.clear();
    expect(applyScroll(H(b.root), snap)).toBe(true);
    expect(scrittureDi.get(b.vp) ?? 0).toBe(0);
  });

  it('la griglia cresce dopo il primo ripristino: si rincorre il fondo', () => {
    const a = schedaLista();
    a.vp.scrollTop = 5600;
    const snap = snapshotScroll(H(a.root));
    const b = schedaLista();
    b.vp.scrollHeight = 2000;
    applyScroll(H(b.root), snap);
    expect(b.vp.scrollTop).toBe(1600);
    b.vp.scrollHeight = 6500;
    // Non piu' in fondo: il ripristino non e' finito
    expect(applyScroll(H(b.root), snap)).toBe(true);
    expect(b.vp.scrollTop).toBe(6100);
  });
});

describe('isRestoringScroll', () => {
  it('null e elementi senza l\'attributo: false', () => {
    const { root, vp } = schedaLista();
    expect(isRestoringScroll(null)).toBe(false);
    expect(isRestoringScroll(H(vp))).toBe(false);
    expect(isRestoringScroll(H(root))).toBe(false);
  });

  it('l\'attributo sul root: vale per il root e per ogni discendente', () => {
    const { root, vp, hvp } = schedaLista();
    root.setAttribute(SCROLL_RESTORE_ATTR, '');
    expect(isRestoringScroll(H(root))).toBe(true);
    expect(isRestoringScroll(H(vp))).toBe(true);
    expect(isRestoringScroll(H(hvp))).toBe(true);
    root.removeAttribute(SCROLL_RESTORE_ATTR);
    expect(isRestoringScroll(H(vp))).toBe(false);
  });

  it('l\'attributo su un ramo non vale per un ramo fratello', () => {
    const { root, g1, g2, tab1 } = schedaDettaglio();
    tab1.setAttribute(SCROLL_RESTORE_ATTR, '1');
    expect(isRestoringScroll(H(g1))).toBe(true);
    expect(isRestoringScroll(H(g2))).toBe(false);
    expect(isRestoringScroll(H(root))).toBe(false);
  });

  it('il nome dell\'attributo e\' quello promesso', () => {
    expect(SCROLL_RESTORE_ATTR).toBe('data-scroll-restore');
  });
});
