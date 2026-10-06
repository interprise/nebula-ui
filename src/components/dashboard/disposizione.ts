/**
 * SXADV-62 F2 · Disposizione della Home: le misure dei widget sulla griglia e la
 * collocazione di quelli mai disposti (contratto DISPOSIZIONE, U1-U3 e C2; piano F1 §6.1).
 *
 * Funzioni pure: la griglia (GrigliaWidget) le usa per costruire il layout che passa a
 * react-grid-layout.
 */
import { moveElement, verticalCompactor, type Layout, type LayoutItem } from 'react-grid-layout';
import { sortLayoutItemsByRowCol } from 'react-grid-layout/core';

/** 12 colonne, righe da 24 px (U1). */
export const COLONNE = 12;
export const ALTEZZA_RIGA = 24;
/** Righe al massimo per un widget: lo stesso tetto del server (DisposizioneCommand). */
export const ALTEZZA_MASSIMA = 200;
/** Sotto questa larghezza utile i widget vanno in una colonna (C5). */
export const LARGHEZZA_STRETTA = 760;

/**
 * Misura proposta e minima per forma, in colonne × righe (U2). La stessa tabella sta in
 * `MisureWidget.java`: se cambia qui, cambia anche li'.
 */
const MISURE: Record<string, { proposta: [number, number]; minima: [number, number] }> = {
  list: { proposta: [8, 11], minima: [4, 6] },
  kpi: { proposta: [3, 7], minima: [2, 6] },
  bar: { proposta: [4, 11], minima: [3, 7] },
  col: { proposta: [5, 10], minima: [3, 8] },
  pie: { proposta: [4, 10], minima: [4, 8] },
};
const ALTRE = { proposta: [5, 10] as [number, number], minima: [3, 8] as [number, number] };

export const misure = (forma: string | undefined) => (forma && MISURE[forma]) || ALTRE;

/** Quello che serve di un widget per disporlo. */
export interface Posto {
  idWidget: number;
  forma?: string;
  posX?: number;
  posY?: number;
  larghezza?: number;
  altezza?: number;
}

const intero = (n: unknown, d: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : d;

const collide = (a: LayoutItem, b: LayoutItem) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Il layout della Home, dato l'elenco nell'ordine di `dashboard.Get`. I widget disposti
 * tengono posizione e misura (riportate dentro le 12 colonne); quelli mai disposti (sotto la
 * minima della forma, cioe' i 4 × 4 di prima) prendono la proposta e il primo spazio libero
 * dopo gli altri (C2). Il risultato e' compattato in verticale (C1).
 */
export function layoutDa(widget: Posto[]): Layout {
  const disposti: LayoutItem[] = [];
  const daCollocare: LayoutItem[] = [];
  for (const w of widget) {
    const m = misure(w.forma);
    const larghezza = intero(w.larghezza, 0);
    const altezza = intero(w.altezza, 0);
    const base = {
      i: String(w.idWidget),
      minW: m.minima[0],
      minH: m.minima[1],
      maxW: COLONNE,
      maxH: ALTEZZA_MASSIMA,
    };
    if (larghezza >= m.minima[0] && altezza >= m.minima[1]) {
      const wv = Math.min(larghezza, COLONNE);
      disposti.push({
        ...base,
        w: wv,
        h: altezza,
        x: Math.max(0, Math.min(intero(w.posX, 0), COLONNE - wv)),
        y: Math.max(0, intero(w.posY, 0)),
      });
    } else {
      daCollocare.push({ ...base, w: m.proposta[0], h: m.proposta[1], x: 0, y: 0 });
    }
  }
  const messi: LayoutItem[] = [...disposti];
  for (const it of daCollocare) {
    let posto: LayoutItem | null = null;
    for (let y = 0; !posto; y++)
      for (let x = 0; x + it.w <= COLONNE && !posto; x++) {
        const prova = { ...it, x, y };
        if (!messi.some((m) => collide(prova, m))) posto = prova;
      }
    messi.push(posto as LayoutItem);
  }
  return verticalCompactor.compact(messi, COLONNE);
}

/**
 * La bozza della modalita' «Disposizione» dopo una rilettura (C4): resta com'e', ma i widget
 * spariti escono, quelli comparsi entrano dove li mette il server, e chi ha cambiato forma
 * prende le minime nuove (e la misura, se sta sotto).
 */
export function aggiornaBozza(bozza: Layout, daServer: Layout, widget: Posto[]): Layout {
  const forma = new Map(widget.map((w) => [String(w.idWidget), w.forma]));
  const tenuti = bozza
    .filter((l) => forma.has(l.i))
    .map((l) => {
      const m = misure(forma.get(l.i)).minima;
      const w = Math.max(l.w, m[0]);
      return { ...l, minW: m[0], minH: m[1], w, h: Math.max(l.h, m[1]), x: Math.min(l.x, COLONNE - w) };
    });
  const nuovi = daServer.filter((l) => !bozza.some((b) => b.i === l.i));
  return verticalCompactor.compact([...tenuti, ...nuovi], COLONNE);
}

/** I widget nell'ordine riga-colonna della disposizione (C5, schermi stretti). */
export function ordineRigaColonna(layout: Layout): string[] {
  return [...layout].sort((a, b) => a.y - b.y || a.x - b.x).map((l) => l.i);
}

/**
 * Sposta (dx, dy) o ridimensiona (dw, dh) un widget da tastiera, entro la griglia e non
 * sotto la minima; gli altri si fanno da parte e la griglia si ricompatta (C3).
 */
export function daTastiera(
  layout: Layout,
  id: string,
  d: { dx?: number; dy?: number; dw?: number; dh?: number },
): Layout {
  const it = layout.find((l) => l.i === id);
  if (!it) return layout;
  const w = Math.max(it.minW ?? 1, Math.min(COLONNE, it.w + (d.dw || 0)));
  const h = Math.max(it.minH ?? 1, it.h + (d.dh || 0));
  const x = Math.max(0, Math.min(COLONNE - w, it.x + (d.dx || 0)));
  const y = it.y;
  const passo = (yy: number) => {
    // Lo stesso passo del trascinamento: moveElement fa da parte chi e' in mezzo, poi la
    // griglia si compatta.
    const copia = layout.map((l) => (l.i === id ? { ...l, w, h } : { ...l }));
    const mosso = copia.find((l) => l.i === id) as LayoutItem;
    return verticalCompactor.compact(
      moveElement(copia, mosso, x, yy, true, false, 'vertical', COLONNE),
      COLONNE,
    );
  };
  if (!d.dy) return passo(y);
  // In verticale una riga sola non basta: la compattazione riporterebbe il widget dov'era.
  // Si allunga il passo finche' il widget cambia davvero posto (scavalca il vicino), o
  // finche' non c'e' piu' dove andare.
  const prima = sortLayoutItemsByRowCol(layout).map((l) => l.i).join('|');
  for (let k = 1; k <= 400; k++) {
    const yy = Math.max(0, it.y + d.dy * k);
    const dopo = passo(yy);
    const ordine = sortLayoutItemsByRowCol(dopo).map((l) => l.i).join('|');
    if (ordine !== prima) return dopo;
    if (yy === 0) break;
  }
  return layout;
}
