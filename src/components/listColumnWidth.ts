import { isBooleanType } from '../controls/cellEditors';

/** Pavimento di una colonna Sì/No: il valore più largo ("No") con il padding
 *  della cella, e la casella dell'editor (16px) quando la riga è in modifica. */
export const BOOLEAN_COLUMN_MIN_WIDTH = 40;

export interface ListColumnWidthInput {
  /** Etichetta dell'intestazione misurata (parola più lunga) + icone che le stanno accanto. */
  headerMinWidth: number;
  /** Tipo del controllo della colonna; assente per le colonne di riempimento. */
  ctrlType?: string;
  /** `size` dichiarato nella view, in caratteri. */
  size?: number;
  /** Controllo registrato che si disegna da sé (non testo). */
  isCustom: boolean;
  /** Colonna di riempimento, senza controllo. */
  isFiller: boolean;
  /** Unità che il server assegna alla colonna (`size / gridSize`). */
  colspan: number;
  /** Pixel per unità (`ui.totalWidth / ui.totalCols`), 0 se il server non li manda. */
  perUnit: number;
  /** Quanto chiedono le etichette delle bande di continuazione sotto la colonna. */
  secondaryMinWidth?: number;
}

/** Larghezza di partenza e minima di una colonna di lista.
 *
 *  Di norma la colonna parte dalla proporzione del server (colspan × pixel per
 *  unità), con un pavimento che fa stare intestazione e contenuto dichiarato.
 *  Una colonna Sì/No no: il suo `size` è quello della maschera (spesso 30,
 *  pensato per l'etichetta accanto alla casella) e il colspan ne discende, ma
 *  in lista la cella mostra "Sì"/"No". Prenderne la larghezza lasciava colonne
 *  da 240px quasi vuote e spingeva fuori vista le ultime (SXADV-5847, tab
 *  Privacy dell'Anagrafica Unica). La sua larghezza è quella dell'intestazione. */
export function listColumnWidth(i: ListColumnWidthInput): { width: number; minWidth: number } {
  const secondary = i.secondaryMinWidth || 0;
  if (isBooleanType(i.ctrlType)) {
    const min = Math.max(i.headerMinWidth, BOOLEAN_COLUMN_MIN_WIDTH, secondary);
    return { width: min, minWidth: Math.min(40, min) };
  }
  const colspan = i.colspan || 1;
  // Almeno il contenuto dichiarato, come nella maschera. Le colonne di
  // riempimento portano comunque pixel, altrimenti le celle delle bande di
  // continuazione che vi cadono sotto finirebbero a 0px.
  let contentMin = 0;
  if (i.size) {
    const perChar = i.isCustom ? 8 : 6.3;
    contentMin = Math.round(Math.min(i.size * perChar + 16, 500));
  } else if (i.isFiller) {
    contentMin = Math.round(colspan * 6.3);
  }
  // Una data formattata deve starci anche sotto un'intestazione corta ("Dal"/"Al") (5455.5).
  if (i.ctrlType === 'date' || i.ctrlType === 'timestamp') {
    contentMin = Math.max(contentMin, i.ctrlType === 'timestamp' ? 130 : 88);
  }
  const min = Math.max(i.headerMinWidth, contentMin, secondary);
  const colspanWidth = i.perUnit > 0 ? Math.round(colspan * i.perUnit) : 0;
  return { width: Math.max(min, colspanWidth), minWidth: Math.min(40, min) };
}
