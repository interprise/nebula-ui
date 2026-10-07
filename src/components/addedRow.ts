// La riga che "Nuovo" ha appena creato, fra quelle di una lista listEdit/multiEdit.
//
// La lista non basta a dirlo: in una multiEdit TUTTE le righe hanno celle
// modificabili, e in un documento nuovo tutte sono `isNew`, quindi "la prima riga
// in modifica" e' sempre la riga 1. Il server invece la riga nuova la nomina: il
// `currField` della risposta all'Add e' un campo nel suo scope
// (`descrizione.S1-9.1` per la riga `S1-0.0,S1-9.1`). Senza questo il pannello
// restava sulla riga 1 e si scriveva li' (SXADV-6011).
// Contratto: docs/features/20261007_SXADV-6011_riga_nuova_pannello.md

export function addedRowPath(
  rowPaths: readonly string[],
  currField: string | null | undefined,
  fallback: string | null,
): string | null {
  if (!currField) return fallback;
  for (const path of rowPaths) {
    const scope = path.slice(path.lastIndexOf(',') + 1);
    if (scope && currField.endsWith(`.${scope}`)) return path;
  }
  return fallback;
}
