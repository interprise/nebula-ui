// Gli array di colonna (`descrizione.S1-9 = [riga1, riga2, ...]`) valgono solo
// per il giro POSIZIONALE di una lista multiEdit, quello che il server fa quando
// la richiesta non punta nessuna riga. Se il navpath punta una riga di quella
// lista, il server scrive solo quella riga e legge l'istanza 0, cioe' il valore
// della riga 1: la riga puntata si prendeva i valori della prima (trovato con
// SXADV-6011, dopo F5 + Nuovo). Quegli array quindi non partono.
// Contratto: docs/features/20261007_SXADV-6011_valori_posizionali.md

const ROW_SEGMENT = /^(.+)\.-?\d+$/;

export function withoutPositionalArrays(
  values: Record<string, string | string[]>,
  navpath: string | null | undefined,
): Record<string, string | string[]> {
  if (!navpath) return values;
  const targeted: string[] = [];
  for (const segment of navpath.split(',')) {
    const m = ROW_SEGMENT.exec(segment.trim());
    if (m) targeted.push(`.${m[1]}`);
  }
  if (targeted.length === 0) return values;
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value) && targeted.some((suffix) => key.endsWith(suffix))) continue;
    out[key] = value;
  }
  return out;
}
