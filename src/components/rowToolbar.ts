// I bottoni Salva / Salva+ / Annulla / Nuovo del pannello di riga (SXADV-6010,
// Annulla SXADV-6045): la
// toolbar della pagina replicata sulla riga. I permessi e il comando di
// salvataggio vengono dalla toolbar che il server ha appena mandato per la
// pagina; il navpath e' quello della riga, cosi' il comando lavora sul suo view
// state e il pannello ci resta sopra.
// Contratto: docs/features/20261007_SXADV-6010_toolbar_di_riga.md e
// docs/features/20261008_SXADV-6045_gestione_riga.md

import type { ToolbarItem } from '../types/ui';

export interface RowToolbarInput {
  /** La toolbar della PAGINA, come la manda il server (tab.toolbar). */
  pageToolbar: readonly unknown[] | undefined;
  /** gridActions.addCommand della lista (assente se non si puo' inserire). */
  addCommand?: string;
  /** La lista e' incorporata (il server le manda gridActions). Solo una lista
   *  che e' la pagina stessa ripiega sul Nuovo della toolbar della pagina: su
   *  una incorporata quel Nuovo creerebbe un DOCUMENTO, e un addCommand assente
   *  vuol dire che inserire righe non si puo'. */
  embedded?: boolean;
  /** Percorso della lista (gridActions.path, o ui.path): navpath del Nuovo. */
  listPath?: string;
  /** Percorso della riga nel pannello: navpath di Salva e Salva+. */
  rowPath: string;
}

export interface RowToolbarAction {
  key: 'save' | 'saveNew' | 'cancel' | 'new';
  label: string;
  icon: string;
  action: string;
  params: Record<string, string>;
  disabled: boolean;
}

/** Argomenti di `doAction.createCallback('X')` / `doAction2.createCallback('X', 'P')`.
 *  Si leggono fra apici, non spezzando sulle virgole: un navpath ne contiene
 *  (`S1-0.0,S1-9`). */
function callbackArgs(handler: string | undefined): string[] | null {
  if (!handler) return null;
  const m = /^doAction2?\.createCallback\((.*)\)$/.exec(handler.trim());
  if (!m) return null;
  return [...m[1].matchAll(/'([^']*)'/g)].map((a) => a[1]);
}

function pageItem(toolbar: readonly unknown[] | undefined, match: (id: string) => boolean): ToolbarItem | undefined {
  for (const raw of toolbar ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as ToolbarItem;
    if (typeof item.id === 'string' && match(item.id)) return item;
  }
  return undefined;
}

export function rowToolbarActions(input: RowToolbarInput): RowToolbarAction[] {
  const { pageToolbar, addCommand, embedded, listPath, rowPath } = input;

  let add: { action: string; params: Record<string, string> } | null = null;
  if (addCommand) {
    add = { action: addCommand, params: listPath ? { navpath: listPath } : {} };
  } else if (!embedded) {
    const item = pageItem(pageToolbar, (id) => id.startsWith('newRecord'));
    const args = item && !item.disabled && item.handler?.trim().startsWith('doAction2')
      ? callbackArgs(item.handler) : null;
    if (args && args[0] && args[1]) add = { action: args[0], params: { navpath: args[1] } };
  }

  const out: RowToolbarAction[] = [];
  const saveItem = pageItem(pageToolbar, (id) => id.startsWith('save') && !id.startsWith('saveNew'));
  const saveCommand = callbackArgs(saveItem?.handler)?.[0];
  if (saveItem && saveCommand) {
    const disabled = !!saveItem.disabled;
    out.push({ key: 'save', label: 'Salva', icon: 'database_save.png', action: saveCommand, params: { navpath: rowPath }, disabled });
    if (add) {
      out.push({ key: 'saveNew', label: 'Salva+', icon: 'database_add.png', action: 'SaveAndNew', params: { navpath: rowPath }, disabled });
    }
    // Sempre acceso: l'Annulla in alto e' spento quando la Session non ha
    // modifiche, ma la riga puo' avere valori digitati e non ancora spediti, e
    // cosa c'e' da annullare lo sa il server (CancelRowCommand).
    if (pageItem(pageToolbar, (id) => id.startsWith('cancel'))) {
      out.push({ key: 'cancel', label: 'Annulla', icon: 'undo', action: 'CancelRow', params: { navpath: rowPath }, disabled: false });
    }
  }
  if (add) out.push({ key: 'new', label: 'Nuovo', icon: 'add.png', action: add.action, params: add.params, disabled: false });
  return out;
}

/** Quale riga mostra il pannello dopo che `removedPath` e' stata tolta (Cancella,
 *  o Annulla di una riga nuova). `paths` sono le righe della lista dopo la
 *  risposta. I percorsi sono posizionali (`<prefisso>.<n>`): se la posizione
 *  esiste ancora ci e' scivolata la riga successiva (o la riga non e' stata
 *  tolta), altrimenti si va alla precedente; null = il pannello si chiude. */
export function pathAfterRemoval(removedPath: string, paths: readonly string[]): string | null {
  if (paths.includes(removedPath)) return removedPath;
  const m = /^(.*\.)(\d+)$/.exec(removedPath);
  if (!m) return null;
  const [, prefix, idx] = m;
  const removed = Number(idx);
  let best: string | null = null;
  let bestIdx = -1;
  for (const p of paths) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    if (!/^\d+$/.test(rest)) continue;
    const n = Number(rest);
    if (n < removed && n > bestIdx) { best = p; bestIdx = n; }
  }
  return best;
}
