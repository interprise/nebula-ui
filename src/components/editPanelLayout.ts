import type { UIControl } from '../types/ui';
import { javaToDayjsFormat, moneyWidthForSize, numberWidthForSize, pickerWidthForFormat } from '../controls/helpers';

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

/** Padding orizzontale di una cella del pannello (`.edit-panel-td`: 4px per lato). */
const PANEL_CELL_CHROME = 8;
/** La stella dell'obbligatorio accanto al campo: icona al corpo piccolo piu' lo
 *  stacco di `.post-decorations`, con un pixel di franco. */
const MANDATORY_MARK = 18;

/** Lo spazio minimo che una cella del pannello deve avere per il suo controllo.
 *
 *  Le colonne uguali di {@link panelTableUnits} danno a un campo di colspan 1 su
 *  27 una quarantina di pixel: per un numero con la stella dell'obbligatorio
 *  restavano 0 px all'input, il valore c'era ma non si vedeva ("Prog Evento" in
 *  Eventi commerciali > Azioni, trovato provando SXADV-5952). Numeri e date non
 *  si possono stringere senza perdere cifre: chiedono la larghezza che il
 *  controllo stesso si da'. Testo, aree di testo e combo restano a 0: si
 *  stringono da soli (`max-width: 100%`, ellissi). */
export function panelCellFloor(control: UIControl | undefined): number {
  if (!control || !control.editable) return 0;
  let width: number;
  switch (control.type) {
    case 'number':
      width = numberWidthForSize(control.size);
      break;
    case 'money':
      // Il simbolo della valuta sta accanto al campo, nella stessa cella.
      width = moneyWidthForSize(control.size);
      break;
    case 'date':
      width = pickerWidthForFormat(javaToDayjsFormat(control.format) || 'DD/MM/YYYY', 10);
      break;
    case 'time':
      width = pickerWidthForFormat('HH:mm', 5);
      break;
    case 'timestamp':
      width = pickerWidthForFormat(javaToDayjsFormat(control.format) || 'DD/MM/YYYY HH:mm', 16);
      break;
    default:
      return 0;
  }
  return width + PANEL_CELL_CHROME + (control.mandatory ? MANDATORY_MARK : 0);
}

/** Larghezza in pixel di ognuna delle `units` colonne di layout del pannello.
 *
 *  Ogni riga elenca le sue celle da sinistra con colspan e pavimento
 *  ({@link panelCellFloor}); una cella chiede per ogni colonna che copre la sua
 *  quota di pavimento, e il pavimento di una colonna e' il massimo fra le righe.
 *  Riempimento ad acqua: le colonne la cui parte uguale starebbe sotto il
 *  pavimento prendono il pavimento, le altre si dividono IN PARTI UGUALI quello
 *  che resta — cosi' la proporzione dei colspan (SXADV-5918) vale ovunque possa
 *  valere. Se i pavimenti da soli superano la larghezza, ogni colonna ha il suo
 *  pavimento e il corpo del pannello scorre. */
export function panelUnitWidths(
  rows: Array<Array<{ span?: number; floor: number }>>,
  units: number,
  width: number,
): number[] {
  const floors = new Array<number>(Math.max(units, 0)).fill(0);
  for (const row of rows) {
    let col = 0;
    for (const cell of row) {
      const span = cell.span != null && cell.span > 0 ? cell.span : 1;
      const share = cell.floor > 0 ? cell.floor / span : 0;
      for (let i = col; i < col + span && i < floors.length; i++) {
        if (share > floors[i]) floors[i] = share;
      }
      col += span;
    }
  }
  if (!Number.isFinite(width) || width <= 0) return floors;
  const fixed = new Array<boolean>(floors.length).fill(false);
  let free = width;
  let open = floors.length;
  for (;;) {
    if (open === 0) break;
    const share = free / open;
    let changed = false;
    for (let i = 0; i < floors.length; i++) {
      if (!fixed[i] && floors[i] > share) {
        fixed[i] = true;
        free -= floors[i];
        open--;
        changed = true;
      }
    }
    if (!changed) break;
  }
  if (free < 0 || open === 0) return floors;
  const share = free / open;
  return floors.map((f, i) => (fixed[i] ? f : share));
}
