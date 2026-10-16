/**
 * Dove stanno i comandi di layout di una griglia (una-riga, zoom).
 *
 * Vivono nella banda `grid-actions` sopra la griglia, in coda a destra. Quando
 * quella banda non ha nient'altro — niente Nuovo/Excel/Stampa, niente nome
 * della griglia — e sotto c'e' la barra delle azioni di lista
 * (`ui.listActions`, es. "Check Fatture Elettroniche"), la banda sarebbe una
 * riga intera per un bottone solo: i comandi passano allora in coda alla barra
 * delle azioni, che la riga la occupa comunque. Senza barra delle azioni
 * restano nella loro banda.
 */
export type LayoutButtonsPlacement = 'none' | 'grid-band' | 'action-bar';

export interface LayoutButtonsPlacementInput {
  /** C'e' almeno un comando di layout da mostrare (una-riga o zoom). */
  hasLayoutButtons: boolean;
  /** La banda grid-actions ha contenuto proprio: bottoni di griglia o il suo nome. */
  gridBandHasContent: boolean;
  /** La lista ha azioni proprie (ui.listActions non vuoto). */
  hasListActions: boolean;
}

export function layoutButtonsPlacement({
  hasLayoutButtons,
  gridBandHasContent,
  hasListActions,
}: LayoutButtonsPlacementInput): LayoutButtonsPlacement {
  if (!hasLayoutButtons) return 'none';
  if (gridBandHasContent) return 'grid-band';
  return hasListActions ? 'action-bar' : 'grid-band';
}
