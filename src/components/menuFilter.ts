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
