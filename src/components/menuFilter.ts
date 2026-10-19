import type { MenuItem } from '../types/ui';

/** Filtro della ricerca nel menu a sinistra: tiene le voci la cui descrizione
 *  contiene il testo (maiuscole e minuscole indifferenti) e i rami che portano
 *  a una voce trovata. */
export function filterMenuTree(items: MenuItem[], filter: string): MenuItem[] {
  const lowerFilter = filter.toLowerCase();
  const result: MenuItem[] = [];
  for (const item of items) {
    // Una voce senza descrizione arriva davvero (azienda Domino, SXADV-5969):
    // senza il ripiego la ricerca nel menu faceva crollare l'intera app.
    const textMatches = (item.description ?? '').toLowerCase().includes(lowerFilter);
    const filteredChildren = item.children ? filterMenuTree(item.children, filter) : [];
    if (textMatches || filteredChildren.length > 0) {
      result.push({
        ...item,
        children: filteredChildren.length > 0 ? filteredChildren : item.children,
      });
    }
  }
  return result;
}

/** Il filtro che vale davvero. Col menu compresso la casella di ricerca non si
 *  vede, ma il testo restava attivo: il menu restava filtrato e i rami trovati
 *  forzati aperti, che compresso vuol dire sottomenu a comparsa aperti da soli
 *  sopra la mappa, a prendersi i clic diretti ai campi (trovato provando
 *  SXADV-5952). Compresso si ignora; il testo resta e torna a valere quando il
 *  menu si riapre. */
export function effectiveMenuFilter(filter: string, collapsed: boolean): string {
  return collapsed ? '' : filter;
}
