import React from 'react';
import { fixServerHtml } from '../services/serverHtml';
import { App, Button } from 'antd';
import { CloseOutlined, DeleteOutlined, UpOutlined, DownOutlined } from '@ant-design/icons';
import type { UITree, UIRow, UICell, UIControl, ListHeader } from '../types/ui';
import { ELTYPE_DUMMY, ELTYPE_SELECTOR } from '../types/ui';
import ControlRenderer from '../controls/ControlRenderer';
import ViewRenderer, { PathContext } from './ViewRenderer';
import { useHotkey, HotkeyPriority } from '../hooks/hotkeys';

/**
 * Bottom edit panel for listEdit lists. The grid stays read-only; selecting a
 * record hydrates the list's cacheable panel template with that record's onboard
 * edit data (`row.editData`) — no Post round-trip. The hydrated form renders here
 * in the stable React tree, where antd controls (combos, dates, lookups) work —
 * unlike inside AG Grid's full-width rows which get remounted and lose state.
 *
 * La STRUTTURA della riga la decide la presenza di una `detailViewName`, non
 * `inlineEdit` — che dice solo DOVE si modifica: qui nel pannello, oppure sulla
 * pagina di dettaglio, e in quel caso il pannello non esiste proprio.
 *  - senza detailViewName → il pannello ricalca il record della GRIGLIA: una
 *    tabella i cui colspan arrivano dal server e le cui etichette di colonna
 *    riusano headers/continuationHeaders della lista (niente prompt per campo:
 *    romperebbero l'incolonnamento e ripeterebbero le intestazioni di colonna).
 *  - con detailViewName → la form della detail referenziata, resa da ViewRenderer.
 *
 * Edits flow through the same onChange/formValues wiring; Save/Delete post with
 * navpath = the selected row's path.
 */

interface EditPanelProps {
  /** Hydrated panel tree for the selected record: le righe del record in griglia
   *  (principale + continuazione) senza detailViewName, la form di dettaglio con. */
  panel: UITree;
  /** The list blob — column headers, continuation headers, delete permission. */
  listUi: UITree;
  /** Exact path of the selected record (from ListRenderer's selector). Used as
   *  PathContext so reload fields and combo fetches target this row. */
  rowPath?: string;
  /** Whether THIS record may be deleted — evaluated per row by the server
   *  (deletable="?expr" on the row's BO, the BO's workflow rules). Undefined on
   *  a server that doesn't send it: falls back to the grid-wide selector flag. */
  canDelete?: boolean;
  onChange?: (name: string, value: unknown) => void;
  onAction: (action: string, params?: Record<string, string>) => void;
  onClose: () => void;
  /** Forma del pannello decisa dal SERVER (buildPanelTemplate): form di
   *  dettaglio invece della riga di griglia. Il server la manda sempre, vera o
   *  falsa; assente solo su un server che non la conosce, e li' si ricade sulla
   *  vecchia deduzione da inlineEdit + hasDetailView (che non coincide piu': la
   *  form di dettaglio ora vuole inlineEdit="true" scritto nella view). */
  formShape?: boolean;
  /** Step to the previous (-1) / next (+1) record without leaving the panel. */
  onNavigate?: (delta: number) => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

// Skip the "Sel." selector column (and the DUMMY placeholder that stands in for
// it on continuation lines) so the panel matches the grid, which hides it too.
const visibleCells = (cells: UICell[]): UICell[] =>
  cells.filter((c) => c.elementType !== ELTYPE_SELECTOR && c.elementType !== ELTYPE_DUMMY);

/** Campo che questa riga non mostra. Il pannello nasce come template METADATA
 *  (un solo record, segnaposto `?iN`) e la visibilita' la porta l'editData del
 *  record selezionato: chi non la guarda mostra i campi che la griglia accanto
 *  tiene nascosti - Peso, Colli, % Provv., Anno Tess. su righe che non li hanno
 *  (SXADV-5735 h). La cella resta, vuota, cosi' le colonne restano incolonnate
 *  sulle intestazioni della lista. */
const isHiddenCell = (c: UICell): boolean => c.visible === false || c.control?.visible === false;

/** Una banda di continuazione dove non si vede niente non si disegna (con la
 *  sua riga di intestazioni): sarebbe una fascia vuota in mezzo al pannello. */
const hasVisibleContent = (cells: UICell[]): boolean =>
  visibleCells(cells).some((c) => !isHiddenCell(c) && (c.control != null || (c.text ?? '') !== ''));
const visibleHeaders = (headers: ListHeader[]): ListHeader[] =>
  headers.filter((h) => h.type !== 'selector');

// Grid-wide fallback: the selector's canDelete, evaluated once for the whole
// list. Only used when the server didn't send the per-row permission.
const canDeleteRecord = (ui: UITree): boolean => {
  for (const col of ui.columns ?? []) if (col.selector) return !!col.selector.canDelete;
  return false;
};

// The view's customDeleteCommand, which the legacy per-row X posted in place of
// the built-in Delete (e.g. RegAnaliticaEliminaDettaglio). View-level, so it
// rides on the selector column rather than per row.
const deleteCommandOf = (ui: UITree): string => {
  for (const col of ui.columns ?? []) if (col.selector) return col.selector.deleteCommand || 'Delete';
  return 'Delete';
};

const HeaderRow: React.FC<{ headers: ListHeader[] }> = ({ headers }) => (
  <tr>
    {headers.map((h, i) => (
      <th key={i} colSpan={h.colspan} className="edit-panel-th">{h.text}</th>
    ))}
  </tr>
);

/** Etichetta leggibile di un controllo non editabile.
 *
 *  Una CodeTable resa in modalita' DATA manda il solo CODICE — la tabella delle
 *  opzioni sta nel template, che qui e' quello della lista — quindi non ha ne'
 *  `displayText` ne' `displayValue` e il pannello mostrava "B" dove la griglia
 *  accanto dice "Banca" (SXADV-5796.3). Le opzioni pero' ci sono, nel
 *  descrittore stesso: la decodifica si fa qui, senza chiedere niente al
 *  server. */
function decodeOption(ctrl: UIControl): string | undefined {
  const label = ctrl.displayText ?? ctrl.displayValue;
  if (label != null && label !== '') return String(label);
  const value = ctrl.value;
  if (value == null || value === '' || !Array.isArray(ctrl.options)) return undefined;
  const hit = ctrl.options.find((o: { value: string; text: string }) => String(o.value) === String(value));
  return hit ? hit.text : undefined;
}

const CellContent: React.FC<{
  cell: UICell;
  onChange?: (name: string, value: unknown) => void;
  onAction: (action: string, params?: Record<string, string>) => void;
}> = ({ cell, onChange, onAction }) => {
  const ctrl = cell.control;
  if (isHiddenCell(cell)) return null;
  if (ctrl && ctrl.type && ctrl.editable) {
    return <ControlRenderer control={ctrl} onAction={onAction} onChange={onChange ?? (() => {})} />;
  }
  // Un booleano non editabile passa comunque dal suo controllo: reso come
  // testo diceva "true"/"false" (in DATA mode il server manda il valore nudo,
  // il decodificato lo emette solo per le celle di lista), mentre la casella
  // spenta e' quello che fa il legacy in pagina di dettaglio - ed e' anche
  // quello che si vede nella griglia accanto (SXADV-5735 a).
  if (ctrl && ctrl.type === 'boolean') {
    return <ControlRenderer control={ctrl} onAction={onAction} onChange={onChange ?? (() => {})} />;
  }
  // Non-editable combos ship the human label as displayText (List) or
  // displayValue (CodeTable/GenericList); prefer either over the raw key/value
  // so a read-only FK combo shows its description, not the code (e.g. "CMO|3208").
  const val = ctrl ? String(decodeOption(ctrl) ?? ctrl.value ?? '') : (cell.text ?? '');
  if (ctrl?.type === 'html' || /<[a-z][\s\S]*>/i.test(val)) {
    return <span dangerouslySetInnerHTML={{ __html: fixServerHtml(val) }} />;
  }
  return <span>{val}</span>;
};

/** Grid-shaped body (nessuna detailViewName): render the record's main +
 *  continuation rows as an aligned table, labelled by the grid's headers — no
 *  per-field prompts. */
const GridBody: React.FC<{
  rows: UIRow[];
  listUi: UITree;
  onChange?: (name: string, value: unknown) => void;
  onAction: (action: string, params?: Record<string, string>) => void;
}> = ({ rows, listUi, onChange, onAction }) => {
  if (rows.length === 0) return null;
  const [mainRow, ...contRows] = rows;
  const contHeaders = listUi.continuationHeaders ?? [];
  return (
    <table className="edit-panel-table">
      <thead>
        {listUi.headers && listUi.headers.length > 0 && <HeaderRow headers={visibleHeaders(listUi.headers)} />}
      </thead>
      <tbody>
        <tr>
          {visibleCells(mainRow.cells).map((c, i) => (
            <td key={i} colSpan={c.colspan} className="edit-panel-td">
              <CellContent cell={c} onChange={onChange} onAction={onAction} />
            </td>
          ))}
        </tr>
        {contRows.map((cr, ci) => (
          !hasVisibleContent(cr.cells) ? null : (
          <React.Fragment key={ci}>
            {contHeaders[ci] && <HeaderRow headers={visibleHeaders(contHeaders[ci])} />}
            <tr>
              {visibleCells(cr.cells).map((c, i) => (
                <td key={i} colSpan={c.colspan} className="edit-panel-td">
                  <CellContent cell={c} onChange={onChange} onAction={onAction} />
                </td>
              ))}
            </tr>
          </React.Fragment>
          )
        ))}
      </tbody>
    </table>
  );
};

const EditPanel: React.FC<EditPanelProps> = ({
  panel, listUi, rowPath, canDelete: rowCanDelete, formShape, onChange, onAction, onClose, onNavigate, hasPrev, hasNext,
}) => {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const { modal } = App.useApp();
  const canDelete = rowCanDelete ?? canDeleteRecord(listUi);
  // No click-outside close: the panel is in-flow (doesn't cover rows), and a
  // click-outside handler would fire on the very blur that commits a reload
  // field (and on combo/date option clicks), swallowing them. It closes via its
  // own button, via Esc, or by switching tab (which unmounts it).
  //
  // Esc deliberately WITHOUT allowWhileTyping: inside a field Esc means "annulla
  // la modifica del campo" — the combos already bind it that way (useSelectKeys
  // restores the baseline and preventDefaults, which the dispatcher honours) —
  // and stealing it would break that. So Esc closes the panel only when focus
  // isn't in a field, which covers the reported case: the user clicks a row,
  // focus stays on the grid, and Esc gets them back to the rows (SXADV-5735.2).
  //
  // allowWhileTyping acceso: appena si clicca una riga il fuoco entra in un
  // campo, quindi l'Esc "che non funziona" era in realta' sempre dentro un
  // campo (SXADV-5735 n). Non ruba niente a nessuno: il registro salta i tasti
  // gia' gestiti (defaultPrevented - le combo annullano cosi' la modifica del
  // campo) e quelli con una tendina aperta (hasOpenOverlay), e la chiusura
  // manda al server quanto digitato invece di buttarlo via.
  useHotkey('Escape', onClose, { priority: HotkeyPriority.editPanel, allowWhileTyping: true });

  const path = rowPath ?? panel.path ?? '';
  // La forma la decide il SERVER (buildPanelTemplate) e la manda in formShape:
  // e' la form di dettaglio dove la lista ha una detailViewName. La deduzione
  // qui sotto resta solo per un server che non manda formShape, e non e' piu'
  // equivalente - guardava anche `inlineEdit`, che oggi dice un'altra cosa.
  const gridShaped = formShape != null ? !formShape : !(listUi.inlineEdit && listUi.hasDetailView);

  const doDelete = () => {
    modal.confirm({
      title: 'Eliminare la riga?',
      okText: 'Elimina',
      okButtonProps: { danger: true },
      cancelText: 'Annulla',
      // Delete on the selected record, through the view's own delete command
      // when it declares one. The server's confirmation flow (if any) is
      // handled by Shell.makeConfirmReplay.
      //
      // option1 e' OBBLIGATORIO: DeleteCommand esce subito (`return false`, la
      // riga resta li') se manca, e il pannello non lo mandava — l'Elimina non
      // ha mai cancellato niente (SXADV-5649). Il legacy ci passava la CHIAVE
      // del record (confirmDelete(path, cmd, key) dal per-row X); qui si manda
      // il letterale "null", l'altro valore che il comando accetta: significa
      // "il record su cui punta il navpath" (getCurrentEditDataObject per una
      // lista listEdit, getCurrentDataObject altrimenti) — che e' esattamente
      // il record del pannello, e vale anche per una riga nuova non ancora
      // salvata, che una chiave non ce l'ha. E' quello che manda anche la
      // barra strumenti quando non c'e' un record corrente (RecordNavigator).
      // Per un customDeleteCommand (ExecuteMethodCommand) option1 e' il nome
      // di un controllo, non una chiave: "null" non risolve nessun item e il
      // comando lavora sul contesto del navpath, come nel legacy.
      onOk: () => {
        if (!path) return;
        const command = deleteCommandOf(listUi);
        const params: Record<string, string> = { navpath: path, option1: 'null' };
        // Togli la riga dalla griglia se la richiesta va a buon fine: la lista
        // risponde con il patch della SOLA riga corrente (render mode "I"), che
        // una riga in meno non la sa dire (Shell.removeListRow). Solo per il
        // Delete del framework: un customDeleteCommand puo' fare tutt'altro —
        // RegAnaliticaEliminaDettaglio azzera un campo e la riga resta dov'e'.
        if (command === 'Delete') params._removeRow = path;
        onAction(command, params);
        // Il record non c'e' piu': si chiude il pannello (che azzera anche il
        // navpath di riga usato dai post successivi). I percorsi di riga sono
        // POSIZIONALI, quindi dopo la cancellazione lo stesso percorso indica
        // il record che ha preso il posto di quello cancellato: lasciando il
        // pannello aperto continuerebbe a mostrare una riga, ma un'altra.
        onClose();
      },
    });
  };

  return (
    <PathContext.Provider value={path}>
      <div className="edit-panel" ref={panelRef}>
        <div className="edit-panel-head">
          <span className="edit-panel-title">Modifica riga</span>
          {onNavigate && (
            <span className="edit-panel-head-actions">
              <Button type="text" size="small" icon={<UpOutlined />} disabled={!hasPrev}
                onClick={() => onNavigate(-1)} aria-label="Record precedente" title="Record precedente" />
              <Button type="text" size="small" icon={<DownOutlined />} disabled={!hasNext}
                onClick={() => onNavigate(1)} aria-label="Record successivo" title="Record successivo" />
            </span>
          )}
          <span className="edit-panel-head-actions">
            {canDelete && (
              <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={doDelete}>
                Elimina
              </Button>
            )}
            <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose}>
              Chiudi
            </Button>
          </span>
        </div>
        <div className="edit-panel-body">
          {gridShaped
            ? <GridBody rows={panel.rows} listUi={listUi} onChange={onChange} onAction={onAction} />
            : <ViewRenderer ui={panel} onAction={onAction} onChange={onChange ?? (() => {})} embedded />}
        </div>
      </div>
    </PathContext.Provider>
  );
};

export default EditPanel;
