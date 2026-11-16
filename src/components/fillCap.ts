// Altezza della griglia incorporata che riempie lo spazio del riquadro che
// scorre (vedi ListRenderer, `fillCapHeight`). Estratta come funzione pura per
// SXADV-6146/6147: la misura riempiva fino al fondo del riquadro come se sotto
// il pannello del rigo non ci fosse nulla, e in coordinate di schermo.
//
// Il contenuto che segue il pannello (almeno il padding della cella della
// layout-table, 1-3px secondo la densita', piu' eventuali righe di form dopo la
// griglia) faceva traboccare il riquadro di pochi pixel: compariva la barra
// verticale, la larghezza calava di una barra, le tabelle dimensionate in pixel
// (righello del dettaglio, pannello del rigo) traboccavano in larghezza per un
// fotogramma, la barra orizzontale toglieva altezza, la griglia si accorciava,
// le barre sparivano e si ricominciava: il "loop grafico" del Micro-Detail.

/** Minimo sotto cui la griglia non scende comunque. */
export const FILL_CAP_MIN = 120;

/** Margine che assorbe gli arrotondamenti al pixel (scrollHeight e clientHeight
 *  sono interi, i rettangoli no). */
export const FILL_CAP_SLACK = 2;

export interface FillCapInput {
  /** Riquadro che scorre (il primo antenato con overflow-y auto/scroll). */
  scroller: {
    /** getBoundingClientRect().top */
    top: number;
    borderTop: number;
    paddingBottom: number;
    /** clientHeight: esclude la barra orizzontale e i bordi. */
    clientHeight: number;
    scrollTop: number;
  };
  /** getBoundingClientRect().bottom del contenuto del riquadro: `ownBottom` piu'
   *  quello che il riquadro tiene sotto il pannello (vedi `tailBelow`). NON
   *  scrollHeight, che con un contenuto piu' corto del riquadro vale clientHeight
   *  e farebbe contare come contenuto lo spazio vuoto sotto il pannello. */
  contentBottom: number;
  /** getBoundingClientRect().top di .list-container (o della griglia). */
  listTop: number;
  /** Altezza di .list-container che non e' griglia (titolo, banda, paginazione). */
  nonGridChrome: number;
  /** Altezza del pannello del rigo impilato sotto la lista; 0 se non c'e'. */
  panelHeight: number;
  /** getBoundingClientRect().bottom dell'ultimo elemento proprio della griglia:
   *  il pannello se c'e', altrimenti .list-container. */
  ownBottom: number;
}

/**
 * Altezza in pixel da dare alla griglia perche' griglia + pannello finiscano
 * sul fondo VISIBILE del riquadro quando questo e' scorso all'inizio, lasciando
 * posto a tutto il contenuto che il riquadro ha sotto il pannello.
 *
 * Contratto:
 * - non dipende da quanto il riquadro e' scorso: con lo stesso layout, cambiare
 *   `scrollTop` e spostare di conseguenza `listTop`/`ownBottom` (che sono in
 *   coordinate di schermo) da' lo stesso risultato;
 * - il contenuto sotto il pannello (`contentBottom - ownBottom`, entrambi in
 *   coordinate di schermo, quindi indipendente dallo scorrimento) si sottrae per
 *   intero: con la griglia all'altezza restituita il contenuto, piu' il padding
 *   inferiore del riquadro, non supera `clientHeight`;
 * - lo spazio vuoto sotto il contenuto non conta: con un contenuto corto il
 *   risultato non cambia;
 * - con niente sotto il pannello il risultato e' quello di prima:
 *   top + borderTop + clientHeight - paddingBottom - SLACK - panelHeight
 *   - listTop - nonGridChrome, arrotondato per difetto;
 * - un contenuto sotto il pannello negativo (arrotondamenti) conta zero;
 * - mai sotto FILL_CAP_MIN.
 */
export function computeFillCap(m: FillCapInput): number {
  const { scroller: s } = m;
  // Il fondo visibile del riquadro, in coordinate di schermo.
  const visibleBottom = s.top + s.borderTop + s.clientHeight - s.paddingBottom - FILL_CAP_SLACK;
  // Quello che il riquadro tiene sotto il pannello: entrambi i fondi sono in
  // coordinate di schermo, lo scorrimento si elide.
  const below = Math.max(0, m.contentBottom - m.ownBottom);
  // La lista come se il riquadro fosse scorso all'inizio.
  const listTopAtRest = m.listTop + s.scrollTop;
  return Math.max(
    FILL_CAP_MIN,
    Math.floor(visibleBottom - below - m.panelHeight - listTopAtRest - m.nonGridChrome),
  );
}

/** Quanto contenuto il riquadro tiene SOTTO `own` (il pannello del rigo, o la
 *  lista se il pannello non c'e'), in pixel. Si risale da `own` fino al
 *  riquadro sommando a ogni livello: il margine inferiore dell'elemento, le
 *  altezze (con i margini) dei fratelli successivi che stanno sotto di lui, e
 *  padding e bordo inferiori del genitore.
 *
 *  Non si guarda il fondo dei figli del riquadro: un antenato stirato (flex:1,
 *  height:100%) finisce sul fondo del riquadro qualunque sia il contenuto, e il
 *  suo spazio vuoto contato come contenuto accorcerebbe la griglia a ogni
 *  misura fino al minimo. I fratelli affiancati (celle della stessa riga di
 *  tabella, colonne flex) non contano: non stanno sotto. */
export function tailBelow(own: Element, scroller: Element): number {
  const px = (v: string) => parseFloat(v) || 0;
  let tail = 0;
  for (let el: Element = own; el !== scroller && el.parentElement; el = el.parentElement) {
    const elBottom = el.getBoundingClientRect().bottom;
    tail += px(getComputedStyle(el).marginBottom);
    for (let sib = el.nextElementSibling; sib; sib = sib.nextElementSibling) {
      const r = sib.getBoundingClientRect();
      if (r.height <= 0 || r.top < elBottom - 0.5) continue;
      const cs = getComputedStyle(sib);
      tail += r.height + px(cs.marginTop) + px(cs.marginBottom);
    }
    const parent = el.parentElement;
    if (parent === scroller) break;
    const pcs = getComputedStyle(parent);
    tail += px(pcs.paddingBottom) + px(pcs.borderBottomWidth);
  }
  return tail;
}
