/**
 * Una cella vuota di una riga in modifica prende il segno di modificabile: il
 * server non manda il valore di un campo senza dato. Ma una cella SENZA
 * `control` non e' vuota: e' un campo invisibile su QUESTO record (UIControl.render
 * lo omette). Marcata modificabile, una colonna booleana mostrava la spunta anche
 * dove il legacy non mostra niente: `flagEsclRitenute` con `isVisible` falso sulle
 * righe delle fatture passive (SXADV-5934.1).
 */
export function emptyCellTakesEdit(
  cell: { control?: unknown } | undefined,
  value: unknown,
): boolean {
  return !!cell?.control && (value === undefined || value === '');
}
