import { createContext, useContext, useState } from 'react';

/**
 * "The form on screen was re-rendered from a server payload" signal.
 *
 * Controls keep the user's keystrokes in local state (see `useSyncedState`)
 * and cannot re-sync on `control.value` alone: a response that puts the SAME
 * value back on a field the user has edited leaves the prop unchanged, so the
 * stale local text survives what the server meant as a refresh. That is what
 * "Salva+" hit (SXADV-5014.1) — Save + Add answers with an all-null new record,
 * and every field the user had just filled had been null in the template too,
 * so the form kept showing the saved record's values while the tab's
 * formValues had already been reset to empty. Refresh/reload after typing had
 * the same shape.
 *
 * The counter changes once per applied payload, so a control can tell "React
 * re-rendered me" (keep typing) from "the server re-rendered the form"
 * (adopt the server value, identical or not). Shell bumps it only for
 * responses that actually carry the form's data — the slim merge responses
 * (rowUpdate / pageOnly / detailPageOnly) leave it alone, since they refresh a
 * grid page and must not revert pending edits elsewhere on the form.
 */
export const DataVersionContext = createContext<number>(0);

/** Version counter for a locally-produced payload (e.g. the listEdit panel
 *  tree, hydrated client-side on row selection): bumps whenever `payload`
 *  changes identity. */
export function usePayloadVersion(payload: unknown): number {
  // Ultimo payload visto + contatore in STATO, non in una ref. Un
  // aggiornamento di stato durante il render React lo assorbe rieseguendo
  // subito il componente prima di dipingere, e non lo conta due volte in
  // StrictMode; una ref scritta durante il render e' invece una mutazione che
  // sopravvive anche ai render che React butta via, quindi puo' far avanzare il
  // contatore per un render mai avvenuto.
  const [seen, setSeen] = useState<{ payload: unknown; version: number }>({ payload, version: 0 });
  if (seen.payload !== payload) {
    const next = seen.version + 1;
    setSeen({ payload, version: next });
    return next;
  }
  return seen.version;
}

/** Composed version for a nested payload: changes when either the enclosing
 *  view or the nested payload is re-rendered. Both terms only grow, so the sum
 *  changes whenever either does. */
export function useNestedDataVersion(payload: unknown): number {
  return useContext(DataVersionContext) + usePayloadVersion(payload);
}
