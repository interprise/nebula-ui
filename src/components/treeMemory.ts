import type { UITree, TreeNode } from '../types/ui';
import type { PendingCaption } from './pendingEdits';

/** Lo stato di un albero con dettaglio che il server non ridisegna: nodi aperti
 *  e caricati, ricerca, nodo selezionato, pannello di destra. */
export interface TreeSnapshot {
  expandedKeys: string[];
  loadedKeys: string[];
  treeData: TreeNode[];
  filteredData: TreeNode[] | null;
  searchText: string;
  selectedKey: string | null;
  detailUi: UITree | null;
  detailFormValues: Record<string, string>;
  /** Didascalie delle scelte fatte nel pannello da un elenco remoto: i valori
   *  della scheda sono solo codici. */
  detailCaptions: Record<string, PendingCaption>;
}

/** Lo stato vive in TreeRenderer, che smonta quando si passa a un'altra
 *  scheda: al ritorno l'albero era chiuso e il pannello sparito, mentre la
 *  scheda teneva la toolbar e i valori del pannello (SXADV-6146.1). Si ricorda
 *  per la resa dell'albero (l'oggetto `ui` della scheda): tornando sulla scheda
 *  e' lo stesso oggetto e lo stato torna; una risposta nuova (la funzione
 *  riaperta dal menu, una ricarica) e' un oggetto nuovo e riparte da zero. */
const remembered = new WeakMap<object, TreeSnapshot>();

export function rememberTree(ui: object, snapshot: TreeSnapshot): void {
  remembered.set(ui, snapshot);
}

export function recallTree(ui: object): TreeSnapshot | undefined {
  return remembered.get(ui);
}
