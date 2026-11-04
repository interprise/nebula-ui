import { ELTYPE_DUMMY, type UIRow } from '../types/ui';

/**
 * Il riconoscitore delle righe di continuazione di una lista: le righe che
 * proseguono il record della riga che le precede (un record disteso su più
 * righe di layout, una per `newLine` della view).
 *
 * Due segni, e basta uno:
 *  - la prima cella è DUMMY: la riga comincia più a destra della colonna 0;
 *  - la riga non porta `props.path` in una lista dove le righe lo portano. Il
 *    server lo emette sempre sulla riga PRIMARIA del record e mai sulle altre
 *    (LayoutManager, "Navpath della riga"), quindi è il segno che vale anche
 *    quando la seconda riga comincia dalla colonna 0 e la DUMMY non c'è.
 *
 * Senza il secondo segno quella riga diventava un record a sé: disegnata nelle
 * colonne della prima (il "Tipo documento" sotto la colonna Sì/No di "Sel.") e
 * contata negli array di colonna di una multiEdit, che uscivano lunghi il
 * doppio dei record e davano a ogni record il valore di un altro (SXADV-6015,
 * Batch solleciti, tab Scadenze).
 *
 * Una lista le cui righe non portano nessun percorso (fixture, liste fuori dal
 * modo dati) resta alla sola regola della DUMMY.
 */
export function continuationTest(rows: readonly UIRow[]): (row: UIRow) => boolean {
  const withPaths = rows.some(hasPath);
  return (row) => {
    if (row.cells.length > 0 && row.cells[0].elementType === ELTYPE_DUMMY) return true;
    return withPaths && row.cls !== 'breakRow' && !hasPath(row);
  };
}

function hasPath(row: UIRow): boolean {
  const p = row.props?.path;
  return typeof p === 'string' && p.length > 0;
}
