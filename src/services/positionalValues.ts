// Gli array di colonna (`descrizione.S1-9 = [riga1, riga2, ...]`) valgono solo
// per il giro POSIZIONALE di una lista multiEdit, quello che il server fa quando
// la richiesta non punta nessuna riga. Se il navpath punta una riga di quella
// lista, il server scrive solo quella riga e legge l'istanza 0, cioe' il valore
// della riga 1: la riga puntata si prendeva i valori della prima (trovato con
// SXADV-6011, dopo F5 + Nuovo). Quegli array quindi non partono.
// Contratto: docs/features/20261007_SXADV-6011_valori_posizionali.md

const ROW_SEGMENT = /^(.+)\.-?\d+$/;

// Azioni che lasciano la pagina di una lista e il cui navpath e' il percorso
// della LISTA (ui.path), non di un suo rigo: gli array di quella lista devono
// partire, il server li applica alla pagina lasciata col giro posizionale
// (SXADV-6015). Gli altri segmenti del percorso restano come sopra.
export const LIST_PAGE_ACTIONS: ReadonlySet<string> = new Set(['LocateRow', 'FilterRows', 'DetailPage', 'SortColumn']);

export function withoutPositionalArrays(
  values: Record<string, string | string[]>,
  navpath: string | null | undefined,
  // Il controllo che ha chiesto la richiesta (option1): un suo array non e' una colonna
  // di lista, sono i valori che lui stesso manda, una voce per riga (SXADV-5983).
  sender?: string,
  // true: l'ultimo segmento e' la lista stessa (LIST_PAGE_ACTIONS), i suoi array partono.
  listScope = false,
): Record<string, string | string[]> {
  if (!navpath) return values;
  const targeted: string[] = [];
  const segments = navpath.split(',');
  if (listScope) segments.pop();
  for (const segment of segments) {
    const m = ROW_SEGMENT.exec(segment.trim());
    if (m) targeted.push(`.${m[1]}`);
  }
  if (targeted.length === 0) return values;
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value) && key !== sender && targeted.some((suffix) => key.endsWith(suffix))) continue;
    out[key] = value;
  }
  return out;
}

// Un cambio pagina consuma gli array della lista: il server li ha gia' applicati
// alla pagina lasciata. Rimasti nei valori, la richiesta successiva li avrebbe
// applicati per posizione alla pagina nuova, spuntando le righe sbagliate
// (SXADV-6015). `listPath` e' il percorso della lista, con o senza posizione.
export function withoutPagedArrays(
  values: Record<string, string | string[]>,
  listPath: string | null | undefined,
): Record<string, string | string[]> {
  if (!listPath) return values;
  const last = listPath.split(',').pop()!.trim().replace(/\.-?\d+$/, '');
  const suffix = `.${last}`;
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value) && key.endsWith(suffix)) continue;
    out[key] = value;
  }
  return out;
}
