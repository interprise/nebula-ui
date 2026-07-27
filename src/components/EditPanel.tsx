import React from 'react';
import { fixServerHtml } from '../services/serverHtml';
import { App, Button } from 'antd';
import { CloseOutlined, DeleteOutlined, UpOutlined, DownOutlined } from '@ant-design/icons';
import type { UITree, UIRow, UICell, ListHeader } from '../types/ui';
import { ELTYPE_DUMMY, ELTYPE_SELECTOR } from '../types/ui';
import ControlRenderer from '../controls/ControlRenderer';
import ViewRenderer, { PathContext } from './ViewRenderer';

/**
 * Bottom edit panel for listEdit lists. The grid stays read-only; selecting a
 * record hydrates the list's cacheable panel template with that record's onboard
 * edit data (`row.editData`) — no Post round-trip. The hydrated form renders here
 * in the stable React tree, where antd controls (combos, dates, lookups) work —
 * unlike inside AG Grid's full-width rows which get remounted and lose state.
 *
 * Layout by flag:
 *  - inlineEdit=false → the panel mirrors the GRID record: an HTML table whose
 *    colspans come straight from the server and whose column labels reuse the
 *    grid's headers/continuationHeaders (no per-field prompts — they'd break the
 *    auto-layout and duplicate the column headers). Fields align to the grid.
 *  - inlineEdit=true → the referenced detail view's form, rendered via ViewRenderer.
 *
 * Edits flow through the same onChange/formValues wiring; Save/Delete post with
 * navpath = the selected row's path.
 */

interface EditPanelProps {
  /** Hydrated panel tree for the selected record. For inlineEdit=false its rows
   *  are the grid record (main + continuation); for inlineEdit=true a detail form. */
  panel: UITree;
  /** The list blob — column headers, continuation headers, delete permission. */
  listUi: UITree;
  /** Exact path of the selected record (from ListRenderer's selector). Used as
   *  PathContext so reload fields and combo fetches target this row. */
  rowPath?: string;
  onChange?: (name: string, value: unknown) => void;
  onAction: (action: string, params?: Record<string, string>) => void;
  onClose: () => void;
  /** Step to the previous (-1) / next (+1) record without leaving the panel. */
  onNavigate?: (delta: number) => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

// Skip the "Sel." selector column (and the DUMMY placeholder that stands in for
// it on continuation lines) so the panel matches the grid, which hides it too.
const visibleCells = (cells: UICell[]): UICell[] =>
  cells.filter((c) => c.elementType !== ELTYPE_SELECTOR && c.elementType !== ELTYPE_DUMMY);
const visibleHeaders = (headers: ListHeader[]): ListHeader[] =>
  headers.filter((h) => h.type !== 'selector');

const canDeleteRecord = (ui: UITree): boolean => {
  for (const col of ui.columns ?? []) if (col.selector) return !!col.selector.canDelete;
  return false;
};

const HeaderRow: React.FC<{ headers: ListHeader[] }> = ({ headers }) => (
  <tr>
    {headers.map((h, i) => (
      <th key={i} colSpan={h.colspan} className="edit-panel-th">{h.text}</th>
    ))}
  </tr>
);

const CellContent: React.FC<{
  cell: UICell;
  onChange?: (name: string, value: unknown) => void;
  onAction: (action: string, params?: Record<string, string>) => void;
}> = ({ cell, onChange, onAction }) => {
  const ctrl = cell.control;
  if (ctrl && ctrl.type && ctrl.editable) {
    return <ControlRenderer control={ctrl} onAction={onAction} onChange={onChange ?? (() => {})} />;
  }
  // Non-editable combos ship the human label as displayText (List) or
  // displayValue (CodeTable/GenericList); prefer either over the raw key/value
  // so a read-only FK combo shows its description, not the code (e.g. "CMO|3208").
  const val = ctrl ? String(ctrl.displayText ?? ctrl.displayValue ?? ctrl.value ?? '') : (cell.text ?? '');
  if (ctrl?.type === 'html' || /<[a-z][\s\S]*>/i.test(val)) {
    return <span dangerouslySetInnerHTML={{ __html: fixServerHtml(val) }} />;
  }
  return <span>{val}</span>;
};

/** Grid-shaped body (inlineEdit=false): render the record's main + continuation
 *  rows as an aligned table, labelled by the grid's headers — no per-field prompts. */
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
        ))}
      </tbody>
    </table>
  );
};

const EditPanel: React.FC<EditPanelProps> = ({
  panel, listUi, rowPath, onChange, onAction, onClose, onNavigate, hasPrev, hasNext,
}) => {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const { modal } = App.useApp();
  const canDelete = canDeleteRecord(listUi);
  // No click-outside close: the panel is in-flow (doesn't cover rows), and a
  // click-outside handler would fire on the very blur that commits a reload
  // field (and on combo/date option clicks), swallowing them. It closes via its
  // own button or by switching tab (which unmounts it).

  const path = rowPath ?? panel.path ?? '';
  // Mirror the server's buildPanelTemplate choice: the panel is a DETAIL FORM
  // only when inlineEdit=true AND a detail view is bound; otherwise it's the
  // list's own grid-shape structure. inlineEdit defaults to TRUE for listEdit
  // views, so keying purely off inlineEdit mis-rendered the majority case
  // (inlineEdit=true, no detailViewName → server emits grid-shape) as a form.
  const gridShaped = !(listUi.inlineEdit && listUi.hasDetailView);

  const doDelete = () => {
    modal.confirm({
      title: 'Eliminare la riga?',
      okText: 'Elimina',
      okButtonProps: { danger: true },
      cancelText: 'Annulla',
      // Delete on the selected record. The server's confirmation flow (if any)
      // is handled by Shell.makeConfirmReplay.
      onOk: () => { if (path) onAction('Delete', { navpath: path }); },
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
            <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} aria-label="Chiudi" />
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
