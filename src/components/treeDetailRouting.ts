import type { UITree } from '../types/ui';

/** Albero+dettaglio: la scheda e' dell'albero finche' ci resta sopra una vista
 *  `type="tree"` con una `navigateView` (il dettaglio che apre il pannello di
 *  destra). Altrimenti non c'e' niente da instradare. */
export function treeHoldingTab(existing: UITree | undefined): UITree | undefined {
  return existing?.viewType === 'tree' && existing.navigateView ? existing : undefined;
}

/** La risposta e' il DETTAGLIO dell'albero che tiene la scheda: va nel pannello
 *  di destra e la scheda resta l'albero (SXADV-5650). Tutto il resto - un'altra
 *  vista dal menu, un link, un indietro - sostituisce l'albero come al solito.
 *
 *  Un record nuovo del dettaglio stesso ne resta fuori: il pannello rientra in
 *  modifica rinavigando sul nodo SELEZIONATO, cosa che un record ancora senza
 *  chiave non puo' fare, e il suo "Nuovo" si apre a pagina intera. Il Nuovo di
 *  una lista INCORPORATA nel dettaglio non e' un record nuovo del dettaglio: la
 *  risposta e' il dettaglio di sempre, con una riga in piu' nella lista. */
export function routesToTreePane(
  treeUi: UITree | undefined,
  ui: UITree,
  newRecord: boolean,
): boolean {
  return !!treeUi?.navigateView &&
    !newRecord &&
    ui.viewType !== 'tree' &&
    !ui.treeNodes &&
    // Emesso a ogni resa METADATA/FULL (sta anche nel template in cache, quindi
    // lo porta anche una vista idratata).
    ui.viewName === treeUi.navigateView;
}

/** La scheda albero con il dettaglio da mettere nel pannello di destra.
 *  `keepsEdit`: la risposta lascia il pannello in modifica sullo STESSO view
 *  state (un Nuovo o un Salva+ di riga andato a buon fine), quindi non serve
 *  rientrarci (SXADV-6052). */
export function paneDetail(treeUi: UITree, detail: UITree, keepsEdit: boolean): UITree {
  // La scheda viene dalla risposta precedente, che dopo un Nuovo porta ancora
  // il segno: ereditato, il Salva successivo non rientrerebbe in modifica.
  const { _detailKeepsEdit: _inherited, ...tree } = treeUi as unknown as Record<string, unknown>;
  void _inherited;
  return {
    ...tree,
    _detailResponse: detail,
    ...(keepsEdit ? { _detailKeepsEdit: true } : {}),
  } as unknown as UITree;
}

/** Il pannello deve rientrare in modifica con un LocateAndNavigate? Si', salvo
 *  dopo un Nuovo di riga: quel giro rifaceva il dettaglio su view state NUOVI,
 *  quindi la pagina si riscriveva due volte, la riga nuova nominata dal
 *  currField dell'Add non esisteva piu' (al secondo Nuovo il pannello si
 *  chiudeva) e il server restava con l'edit path sul view state vecchio, dove
 *  finiva il digitato (SXADV-6052). Il rientro serve dopo il Salva (b50afcf). */
export function paneReentersEdit(ui: UITree): boolean {
  return (ui as unknown as Record<string, unknown>)._detailKeepsEdit !== true;
}
