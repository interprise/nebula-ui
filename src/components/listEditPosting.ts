// Pure helpers for the wire-format details of multiEdit/listEdit list posting.
// Extracted out of ListRenderer.tsx so the exact key/navpath construction —
// the part that was silently broken (SXADV-5648) — is directly unit-testable
// without mounting AG Grid.
//
// Server-side counterpart: CORE's UIControl.getValue() looks up posted values
// by `controlName + "." + pVS.getId()` (the viewstate's bare id, NOT its full
// navpath/path which carries a row-position suffix — see
// ToolViewState.getCurrentEditPosition, which treats a row-position suffix as
// "this request targets one specific row").

/** Wire field name for a multiEdit column-value array post: controlName + "."
 *  + the bare list viewstate id (selectorBasePath). This is the key CORE's
 *  ToolViewState.postData page-wide walk actually looks up. Using ui.path
 *  (which carries a row-position suffix) instead would either miss the
 *  server's lookup entirely or, worse, get misread as one targeted row. */
export function buildColumnFieldName(controlName: string, selectorBasePath: string): string {
  return `${controlName}.${selectorBasePath}`;
}

/** Navpath for a reload-triggered commit fired from a grid cell value change
 *  (ListRenderer's handleCellValueChanged).
 *  - multiEdit: MUST stay bulk/page-wide — it carries the column array just
 *    pushed by pushColumnValues (in practice, only ever the selection
 *    checkbox now). Bare selectorBasePath, never a row-position suffix, or
 *    CORE's getCurrentEditPosition would misread the request as targeting one
 *    row and the rest of the page's array would be silently dropped.
 *  - plain listEdit (not multiEdit): unchanged, existing ui.path-based
 *    behaviour — every in-grid-editable column there is a boolean/checkbox
 *    field (see makeEditableCallback), not a panel-routed field. */
export function resolveReloadNavpath(opts: {
  isMultiEdit: boolean;
  selectorBasePath: string;
  uiPath?: string;
}): string | undefined {
  if (opts.isMultiEdit) return opts.selectorBasePath || undefined;
  return opts.uiPath;
}

/** L'id NUDO del viewstate contenuto in un percorso di riga.
 *
 *  Un percorso e' `parentId.pos,...,id.pos` (CORE `ToolViewState.getPath`),
 *  quindi l'ultimo segmento separato da virgola e' `id.pos` e l'id e' quello
 *  che sta prima del punto. Serve al pannello di modifica riga: il suo template
 *  e' in cache per nome di VISTA ma i `bindings` che porta dentro hanno l'id
 *  della pagina in cui fu costruito, e comporre i nomi di campo con quello
 *  faceva scartare il post in silenzio (SXADV-5887). Il percorso della riga
 *  selezionata e' invece sempre quello vivo - e' lo stesso che parte come
 *  navpath - quindi l'id si prende da li'.
 */
export function viewstateIdOf(rowPath: string): string {
  const last = rowPath.slice(rowPath.lastIndexOf(',') + 1);
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(0, dot) : last;
}

/** L'id NUDO del viewstate di una lista, base dei nomi di campo del post
 *  page-wide di una multiEdit (`buildColumnFieldName`).
 *
 *  Finora arrivava solo dalla colonna selettore (`col.selector.basePath`), e una
 *  lista dichiarata `selector="false"` quella colonna non ce l'ha: le spunte
 *  partivano come `selected.` e CORE, che cerca `selected.<id>`, non vedeva
 *  nessuna riga selezionata. Crea Campagna nasceva senza Eventi e Aggancia
 *  Campagna lasciava `getContatti()` a null (SXADV-5995, SXADV-5996, vista
 *  anagraficheListSelCmp). Senza selettore l'id si prende dal percorso vivo
 *  della lista o, in mancanza, da quello della prima riga: e' lo stesso id, e
 *  arriva a ogni risposta (mai da un template in cache, vedi SXADV-5887).
 */
export function resolveListBasePath(opts: {
  selectorBasePath?: string;
  uiPath?: string;
  rowPaths?: (string | undefined)[];
}): string {
  if (opts.selectorBasePath) return opts.selectorBasePath;
  if (opts.uiPath) return viewstateIdOf(opts.uiPath);
  const first = opts.rowPaths?.find((p) => !!p);
  return first ? viewstateIdOf(first) : '';
}
