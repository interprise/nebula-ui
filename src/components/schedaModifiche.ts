import type { ToolbarItem } from '../types/ui';

/** Il testo della domanda del server (generic.properties, SAVE_BEFORE_NEW): la
 *  stessa che compare cambiando voce di menu o tornando indietro con modifiche
 *  in sospeso. */
export const DOMANDA_MODIFICHE_NON_SALVATE =
  'Ci sono modifiche non salvate. Si desidera vengano annullate TUTTE le modifiche?';

/** `doAction.createCallback('Cancel')`, con apici semplici o doppi e spazi liberi. */
const ANNULLA = /^\s*doAction\.createCallback\s*\(\s*(['"])Cancel\1\s*[,)]/;

/**
 * Vero se la scheda ha modifiche non salvate. Lo dice il server: il pulsante
 * «Annulla» della toolbar (RecordNavigator/TableNavigator) e' acceso solo con la
 * transazione sporca (`disabled = !session.isDirty()`). Chiudere la scheda manda
 * `CloseSession`, che quelle modifiche le butta via.
 */
export function schedaConModifiche(toolbar: ToolbarItem[] | undefined): boolean {
  if (!Array.isArray(toolbar)) return false;
  return toolbar.some(
    (it) =>
      it !== null &&
      typeof it === 'object' &&
      typeof it.handler === 'string' &&
      ANNULLA.test(it.handler) &&
      !it.disabled,
  );
}
