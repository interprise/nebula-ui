// La riga che "Nuovo" ha appena creato, fra quelle di una lista listEdit/multiEdit.
//
// La lista non basta a dirlo: in una multiEdit TUTTE le righe hanno celle
// modificabili, e in un documento nuovo tutte sono `isNew`, quindi "la prima riga
// in modifica" e' sempre la riga 1. Il server invece la riga nuova la nomina: il
// `currField` della risposta all'Add e' un campo nel suo scope
// (`descrizione.S1-9.1` per la riga `S1-0.0,S1-9.1`). Senza questo il pannello
// restava sulla riga 1 e si scriveva li' (SXADV-6011).
// Contratto: docs/features/20261007_SXADV-6011_riga_nuova_pannello.md
//
// Il numero in coda al currField NON e' la posizione del percorso: e' il
// contatore dei record dalla CIMA DELLA PAGINA (CORE UIControl.getControlId ->
// RenderItemState.getCurrRec), che conta anche i record scartati da un filtro di
// riga (ToolViewRenderer: mCurrRec++ anche quando la riga non si disegna). La
// posizione nel percorso e' quindi inizio pagina + n. Sulla prima pagina le due
// coincidono; a pagina 3 di Prezzi Sede il rigo nuovo e' `S1-2.57` e il currField
// dice `articoloVariante.S1-2.17` (inizio pagina 40). Letto senza inizio pagina
// non si trovava, si ripiegava sul primo rigo in modifica - il rigo nuovo di
// prima, non ancora salvato - e ogni "Nuovo" del pannello aggiungeva un rigo
// vuoto lasciando il pannello fermo (SXADV-6258).

/** `S1-0.0,S1-9.1` -> `{ vs: 'S1-9', pos: 1 }`: lo scope del rigo. */
function scopeOf(path: string): { vs: string; pos: number } | null {
  const scope = path.slice(path.lastIndexOf(',') + 1);
  const dot = scope.lastIndexOf('.');
  if (dot <= 0) return null;
  const tail = scope.slice(dot + 1);
  if (!/^\d+$/.test(tail)) return null;
  return { vs: scope.slice(0, dot), pos: Number(tail) };
}

/** `articoloVariante.S1-2.17` -> `{ vs: 'S1-2', n: 17 }`. L'id del viewstate
 *  (senza punti) e' fra il penultimo e l'ultimo punto: il nome del campo prima
 *  puo' averne (`conto.codice.S1-9.1`). */
function currFieldScope(currField: string): { vs: string; n: number } | null {
  const last = currField.lastIndexOf('.');
  const prev = last > 0 ? currField.lastIndexOf('.', last - 1) : -1;
  if (prev < 0) return null;
  const tail = currField.slice(last + 1);
  if (!/^\d+$/.test(tail)) return null;
  return { vs: currField.slice(prev + 1, last), n: Number(tail) };
}

/** Il rigo nominato dal currField dell'Add. `pageStart` e' la posizione del
 *  primo record della pagina mostrata ((pagina - 1) * dimensione), 0 senza
 *  paginazione. Se il currField manca o non nomina un rigo della lista,
 *  `fallback`. */
export function addedRowPath(
  rowPaths: readonly string[],
  currField: string | null | undefined,
  fallback: string | null,
  pageStart = 0,
): string | null {
  if (!currField) return fallback;
  const cf = currFieldScope(currField);
  if (!cf) return fallback;
  const pos = pageStart + cf.n;
  for (const path of rowPaths) {
    const sc = scopeOf(path);
    if (sc && sc.vs === cf.vs && sc.pos === pos) return path;
  }
  return fallback;
}
