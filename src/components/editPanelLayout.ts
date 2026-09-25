/** Quante colonne di layout occupa la tabella del pannello di riga.
 *
 *  Ogni riga e' l'elenco dei colspan delle celle RESE (intestazioni, riga
 *  principale, bande di continuazione e loro intestazioni). I colspan vengono
 *  dal layout della lista, cioe' dal `size` dichiarato nella view: dividere la
 *  riga in `units` colonne uguali da' a ogni campo una quota proporzionale al
 *  suo dato, e con `table-layout: fixed` nessun campo puo' allargare la tabella
 *  e spingere fuori i successivi (SXADV-5918). Un colspan mancante o non
 *  positivo vale 1, come per il browser. */
export function panelTableUnits(rows: Array<Array<number | undefined>>): number {
  let units = 0;
  for (const row of rows) {
    let sum = 0;
    for (const span of row) sum += span != null && span > 0 ? span : 1;
    if (sum > units) units = sum;
  }
  return units;
}
