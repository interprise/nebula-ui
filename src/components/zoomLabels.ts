/**
 * Tooltip dei bottoni di ingrandimento e di layout delle griglie, con le
 * parole chieste dal collaudo (SXADV-5749.3). Un posto solo, perché lo stesso
 * gesto ha due bottoni — lo zoom della griglia (ListRenderer) e quello
 * dell'area inferiore (ViewRenderer) — e devono dire la stessa cosa.
 */

/** Ingrandimento della sezione: Esc la riduce, quindi lo si scrive. */
export function sectionZoomTooltip(zoomed: boolean): string {
  return zoomed ? 'Riduce sezione (Esc)' : 'Ingrandisce sezione';
}

/** Layout alternativo della lista: dal record su più righe si "riduce" a un
 *  record per riga; da lì si torna "ingrandendo" il layout. */
export function layoutToggleTooltip(oneLine: boolean): string {
  return oneLine ? 'Ingrandisce layout' : 'Riduce layout';
}
