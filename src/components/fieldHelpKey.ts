/** Identita' della '?' di aiuto (FieldHelpIcon): vista radice, item e
 *  revisione dei testi. Un altro campo, o un testo cambiato, e' un'icona nuova
 *  e non quella di prima col testo gia' scaricato. */
export function helpIconKey(h: { viewName: string; itemId: string; rev?: number }): string {
  return `${h.viewName}|${h.itemId}|${h.rev ?? 0}`;
}
