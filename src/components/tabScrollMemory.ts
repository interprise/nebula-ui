/** Posizione di scorrimento di una scheda di sessione, fotografata quando la
 *  si lascia e rimessa al ritorno (SXADV-6008).
 *
 *  La Shell disegna solo la scheda in primo piano: tornando su una sessione la
 *  vista rinasce, e AG Grid (come ogni altra area scorrevole) riparte da 0,0.
 *  Lo stato della sessione che sta nel TabState sopravvive (i valori scritti,
 *  SXADV-5989); lo scorrimento invece vive solo nel DOM, e qui lo si conserva
 *  per la scheda accanto a quello.
 *
 *  Gli elementi si riconoscono per POSIZIONE STRUTTURALE dentro l'area della
 *  scheda: la vista che si ridisegna e' la stessa, quindi lo e' anche la
 *  struttura. Ogni passo conta solo i fratelli dello stesso tag e della stessa
 *  prima classe, cosi' un velo di caricamento o una banda comparsa nel
 *  frattempo non spostano la chiave degli altri. */

/** `atBottom` / `atRight`: l'area era a fine corsa. Al ritorno ci torna anche
 *  se l'escursione e' cambiata di qualche pixel (un'intestazione misurata in
 *  modo diverso): chi era in fondo alla lista la ritrova in fondo. */
export interface ScrollEntry { key: string; top: number; left: number; atBottom?: boolean; atRight?: boolean }
export type ScrollSnapshot = ScrollEntry[];

/** Sull'area della scheda finche' il ripristino e' in corso: chi altrimenti
 *  scorrerebbe da se' (la riga ricordata della lista) lo lascia fare. */
export const SCROLL_RESTORE_ATTR = 'data-scroll-restore';

/** Quanto si insiste a rimettere la posizione mentre la vista si assesta: lo
 *  stesso tempo che la lista concede al riallineamento della riga ricordata. */
export const SCROLL_RESTORE_WINDOW_MS = 1500;

const signature = (el: Element): string => {
  const cls = el.classList?.[0];
  return cls ? `${el.tagName}.${cls}` : el.tagName;
};

const segment = (el: Element): string => {
  const sig = signature(el);
  let n = 0;
  for (let s = el.previousElementSibling; s; s = s.previousElementSibling) {
    if (signature(s) === sig) n++;
  }
  return `${sig}:${n}`;
};

export function scrollKey(root: Element, el: Element): string | null {
  const parts: string[] = [];
  for (let cur: Element | null = el; cur !== root; cur = cur.parentElement) {
    if (!cur) return null;
    parts.push(segment(cur));
  }
  return parts.reverse().join('/');
}

export function findByScrollKey(root: Element, key: string): HTMLElement | null {
  let cur: Element = root;
  if (key) {
    for (const part of key.split('/')) {
      const cut = part.lastIndexOf(':');
      const sig = part.slice(0, cut);
      let n = Number(part.slice(cut + 1));
      let next: Element | null = null;
      for (const c of Array.from(cur.children)) {
        if (signature(c) === sig && n-- === 0) { next = c; break; }
      }
      if (!next) return null;
      cur = next;
    }
  }
  return cur as HTMLElement;
}

const SCROLLABLE = /auto|scroll|overlay/;

/** Un'area scorrevole, non un contenuto che deborda: una cella troncata coi
 *  puntini (overflow hidden) ha escursione ma nessuno la scorre, e su una lista
 *  larga sarebbero centinaia di voci da rimettere a ogni passo. Senza
 *  getComputedStyle (fuori dal browser) vale la sola escursione. */
const scrolls = (el: Element): boolean => {
  if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) return false;
  const view = el.ownerDocument?.defaultView;
  if (!view?.getComputedStyle) return true;
  const cs = view.getComputedStyle(el);
  return SCROLLABLE.test(cs.overflowX) || SCROLLABLE.test(cs.overflowY) || SCROLLABLE.test(cs.overflow);
};

/** Ogni elemento dell'area che ha un'escursione di scorrimento, anche se e' a
 *  0,0: al ritorno lo zero va rimesso, la vista puo' rinascere riusando
 *  componenti della scheda appena lasciata. */
export function snapshotScroll(root: HTMLElement): ScrollSnapshot {
  const out: ScrollSnapshot = [];
  const take = (el: Element) => {
    if (!scrolls(el)) return;
    const key = scrollKey(root, el);
    if (key == null) return;
    const maxTop = el.scrollHeight - el.clientHeight;
    const maxLeft = el.scrollWidth - el.clientWidth;
    out.push({
      key, top: el.scrollTop, left: el.scrollLeft,
      atBottom: maxTop > 0 && el.scrollTop >= maxTop - 1,
      atRight: maxLeft > 0 && el.scrollLeft >= maxLeft - 1,
    });
  };
  take(root);
  root.querySelectorAll('*').forEach(take);
  return out;
}

/** Un passo di ripristino: true quando ogni elemento c'e' ed e' a posto. Si
 *  ripete finche' la vista si assesta (righe ad altezza automatica): un valore
 *  oltre l'escursione di adesso il browser lo tronca, e il passo dopo ritenta. */
export function applyScroll(root: HTMLElement, snap: ScrollSnapshot): boolean {
  let done = true;
  for (const e of snap) {
    const el = findByScrollKey(root, e.key);
    if (!el) { done = false; continue; }
    const top = e.atBottom ? Math.max(0, el.scrollHeight - el.clientHeight) : e.top;
    const left = e.atRight ? Math.max(0, el.scrollWidth - el.clientWidth) : e.left;
    if (Math.abs(el.scrollTop - top) >= 1) el.scrollTop = top;
    if (Math.abs(el.scrollLeft - left) >= 1) el.scrollLeft = left;
    if (Math.abs(el.scrollTop - top) >= 1 || Math.abs(el.scrollLeft - left) >= 1) done = false;
  }
  return done;
}

export function isRestoringScroll(el: Element | null): boolean {
  return !!el?.closest(`[${SCROLL_RESTORE_ATTR}]`);
}
