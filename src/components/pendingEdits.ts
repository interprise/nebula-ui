import type { UIControl, UIRow, UITree } from '../types/ui';
import { negationFieldName } from '../controls/helpers';
import type { FieldCaption } from '../controls/types';

export type PendingCaption = FieldCaption;

/** Controllo che finisce nella richiesta: modificabile, spedito, non spento. */
function isPosted(ctrl: UIControl): boolean {
  return !!ctrl.editable && !ctrl.noPost && !ctrl.disabled;
}

/** Valori dei controlli modificabili cosi' come li ha disegnati il server: la
 *  base dei `formValues` di una scheda a ogni risposta. I controlli in sola
 *  lettura restano fuori, il server il loro stato ce l'ha gia'. */
export function extractFormValues(ui: UITree): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {};
  const walkRows = (rows: UIRow[]) => {
    for (const row of rows) {
      for (const cell of row.cells) {
        const ctrl = cell.control;
        if (!ctrl) continue;
        if (isPosted(ctrl)) {
          const name = ctrl.name || ctrl.id;
          if (name && ctrl.value != null && typeof ctrl.value !== 'object') {
            values[name] = String(ctrl.value);
          }
          // Re-seed the negation ($not) flag from the server's authoritative
          // state so it survives this rebuild and is posted on ExecuteQuery.
          // Without it, toggling "not" then triggering any reload would drop
          // the flag (no control carries it) — same class of loss the scalar
          // value above was fixed for (SXADV-5465).
          if (name && ctrl.negation && ctrl.negationValue) {
            values[negationFieldName(name)] = '1';
          }
        }
        // Recurse into embedded/detail views and tabs
        if (ctrl.contentRows) walkRows(ctrl.contentRows);
      }
    }
  };
  if (ui.rows) walkRows(ui.rows);
  return values;
}

/** Contenuto a lista (pagina lista, lista incorporata). Le righe di una lista
 *  listEdit portano gli stessi nomi di campo qualunque sia la riga in modifica
 *  (la chiave dei valori non dice la riga, SXADV-5735), e le risposte che
 *  aggiornano una riga o una pagina non azzerano i formValues: ridisegnare da
 *  li' metterebbe un valore digitato su un'altra riga, o sopra quello appena
 *  tornato dal server. Il pannello di riga i suoi valori li spedisce da se'
 *  quando si smonta (flushFieldEdits). */
function isList(v: UIControl | UITree): boolean {
  return v.pageType === 1 || v.layoutType === 'horizontal' || !!v.listEdit;
}

/** La vista di una scheda ridisegnata con le modifiche non ancora spedite.
 *
 *  Ogni controllo scrive quello che si digita nei `formValues` della sua
 *  scheda — lo stato di sessione, quello che parte con la richiesta dopo — e
 *  tiene il valore a video in uno stato locale che nasce da `control.value`.
 *  Si disegna solo la scheda in primo piano, quindi passando a un'altra
 *  sessione quello stato locale si perde, e al ritorno i campi rinascevano col
 *  valore del server: vuoti, se il record e' nuovo. Resistevano solo i campi
 *  con `reload`, perche' il loro valore era gia' andato al server — e con lui
 *  quello dei campi scritti prima (SXADV-5989).
 *
 *  Qui la vista si riporta allo stato di sessione: un controllo spedito il cui
 *  nome ha nei `formValues` una stringa diversa dal valore del server prende
 *  quella stringa, cioe' il valore nella forma in cui il controllo stesso l'ha
 *  scritta (e che quindi sa rileggere). `captions` porta la didascalia delle
 *  scelte fatte da un elenco remoto, che nei `formValues` sono solo codici.
 *
 *  Non tocca l'albero ricevuto: rifa' solo il percorso fino ai controlli
 *  cambiati, e se non c'e' niente in sospeso restituisce `ui` stesso. */
export function applyPendingValues(
  ui: UITree,
  formValues: Record<string, string | string[]>,
  captions: Record<string, PendingCaption> = {},
): UITree {
  const patchControl = (ctrl: UIControl): UIControl => {
    let next = ctrl;
    const set = (patch: Partial<UIControl>) => { next = { ...next, ...patch }; };
    const name = ctrl.name || ctrl.id;
    if (name && isPosted(ctrl)) {
      const pending = formValues[name];
      // Un array e' una colonna di griglia (handleGridChange), non il valore
      // di un campo singolo.
      if (typeof pending === 'string') {
        const serverValue = ctrl.value == null ? undefined : String(ctrl.value);
        if (pending !== serverValue && !(pending === '' && serverValue === undefined)) {
          set({ value: pending });
          const caption = captions[name];
          if (typeof caption === 'string') set({ displayText: caption });
          else if (Array.isArray(caption)) set({ selectedItems: caption });
        }
      }
      if (ctrl.negation) {
        const flag = formValues[negationFieldName(name)];
        if (typeof flag === 'string' && (flag === '1') !== !!ctrl.negationValue) {
          set({ negationValue: flag === '1' });
        }
      }
    }
    // Viste incorporate e tab: `contentRows`; le viste embedded/detail
    // portano le loro righe in `control.rows` (per una textarea `rows` e' un
    // numero). Una lista incorporata no: vedi isList.
    if (isList(ctrl)) return next;
    if (ctrl.contentRows) {
      const rows = patchRows(ctrl.contentRows);
      if (rows !== ctrl.contentRows) set({ contentRows: rows });
    }
    if (Array.isArray(ctrl.rows)) {
      const rows = patchRows(ctrl.rows as unknown as UIRow[]);
      if (rows !== (ctrl.rows as unknown)) set({ rows: rows as unknown as number });
    }
    return next;
  };

  const patchRows = (rows: UIRow[]): UIRow[] => {
    let changedRows = false;
    const out = rows.map((row) => {
      let changedCells = false;
      const cells = row.cells.map((cell) => {
        let next = cell;
        if (cell.control) {
          const control = patchControl(cell.control);
          if (control !== cell.control) next = { ...next, control };
        }
        // Le viste incorporate "in linea" (content="this", gli indirizzi)
        // arrivano come cella contenitore con le sue righe.
        if (cell.rows) {
          const inner = patchRows(cell.rows);
          if (inner !== cell.rows) next = { ...next, rows: inner };
        }
        if (next !== cell) changedCells = true;
        return next;
      });
      if (!changedCells) return row;
      changedRows = true;
      return { ...row, cells };
    });
    return changedRows ? out : rows;
  };

  if (!ui.rows || isList(ui)) return ui;
  const rows = patchRows(ui.rows);
  return rows === ui.rows ? ui : { ...ui, rows };
}
