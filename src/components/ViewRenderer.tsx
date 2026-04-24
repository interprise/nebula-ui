import React, { useCallback, useRef } from 'react';
import { Tabs } from 'antd';
import { BookOutlined, CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import type { UITree, UIRow, UICell, UIControl } from '../types/ui';
import {
  ELTYPE_PROMPT,
  ELTYPE_CONTENT,
  ELTYPE_SECTION_HEADER,
  ELTYPE_SELECTOR,
  ELTYPE_FILLER,
  ELTYPE_CONTAINER,
} from '../types/ui';
import ControlRenderer from '../controls/ControlRenderer';
import ListRenderer from './ListRenderer';
import TreeRenderer from './TreeRenderer';

/** Shows horizontal scrollbar only when mouse is near the bottom edge */
const SCROLL_REVEAL_ZONE = 25; // pixels from bottom edge
function useEdgeScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const distFromBottom = rect.bottom - e.clientY;
    el.classList.toggle('scrollbar-visible', distFromBottom <= SCROLL_REVEAL_ZONE);
  }, []);
  const onMouseLeave = useCallback(() => {
    ref.current?.classList.remove('scrollbar-visible');
  }, []);
  return { ref, onMouseMove, onMouseLeave };
}

interface ViewRendererProps {
  ui: UITree;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
  onGridChange?: (name: string, values: string[]) => void;
  onEditRow?: (navpath: string | null) => void;
  /** When true, this is a nested/embedded view — don't apply the split layout */
  embedded?: boolean;
  /** When true, an embedded list should fill available vertical space with
   *  its own scroll (tab panels), not expand to fit all rows. */
  fillHeight?: boolean;
}

// Session ID context — used by remote combos to call the server
export const SidContext = React.createContext<string>('S1');

// View path context — used by controls to send navpath with commands
export const PathContext = React.createContext<string | undefined>(undefined);

// Propagates the "fill available vertical space" signal down to embedded
// lists. Set by tab content so nested grids use internal scroll instead of
// AG Grid's autoHeight.
export const FillHeightContext = React.createContext<boolean>(false);

// View name context — used only for diagnostics (e.g. unknown-control-type warnings)
export const ViewNameContext = React.createContext<string | undefined>(undefined);

/** Input-like widgets that always render a visible UI (input/select/
 *  checkbox/textarea) even when disabled or empty — if the server keeps
 *  them editable the cell is kept alive; if read-only they need a value. */
const INPUT_TYPES = new Set<string>([
  'text', 'number', 'money', 'date', 'time', 'timestamp', 'durata',
  'password', 'textarea', 'htmlarea', 'htmlFormat',
  'combo', 'multiselect', 'checkbox', 'boolean',
  'barcode', 'expbuilder',
  'alternateKey', 'colorPalette',
  'toggleVisibilityFilter', 'visibilityFilter',
]);

/** Button-like widgets that render their prompt/icon regardless of value. */
const BUTTON_TYPES = new Set<string>([
  'button', 'action', 'windowButton',
  'navigateView', 'navigateViewButton',
  'add', 'lookup', 'download', 'upload', 'uploadButton',
]);

/** Structural composites that always render their scaffolding. */
const STRUCTURAL_TYPES = new Set<string>([
  'actionBar', 'buttonBar', 'tab', 'embeddedView', 'detailView',
  'warning', 'workflowStatus',
]);

/** Array/object fields whose non-empty presence means the control has
 *  real content to show (custom entrasp + CORE list-ish controls). */
const STRUCTURED_FIELDS = [
  'items', 'files', 'segments', 'options', 'rows', 'contentRows', 'tabs',
  'groups', 'scadenze', 'demands', 'resources', 'cells',
  'contacts', 'variants', 'privileges', 'profiles',
  'vehicles', 'days', 'activities', 'sections', 'assignments',
  'columns', 'listRows', 'forGroup',
] as const;

function hasScalarContent(ctl: UIControl): boolean {
  const v = ctl.value;
  if (v !== undefined && v !== null && v !== '') return true;
  if (ctl.displayValue) return true;
  const bag = ctl as unknown as Record<string, unknown>;
  if (bag.href || bag.src) return true;
  return false;
}

function hasStructuredContent(ctl: UIControl): boolean {
  const bag = ctl as unknown as Record<string, unknown>;
  for (const k of STRUCTURED_FIELDS) {
    const x = bag[k];
    if (Array.isArray(x) ? x.length > 0 : !!x) return true;
  }
  return false;
}

/** Will this control actually produce visible output, or is it an empty
 *  shell (span with no text, etc.)? Different control families have
 *  different rules. */
function controlProducesOutput(ctl: UIControl): boolean {
  if (ctl.visible === false) return false;
  const type = ctl.type ?? '';
  if (INPUT_TYPES.has(type)) {
    // Editable inputs always render a widget; read-only ones only when
    // they carry a value (an empty disabled span is a wasted row).
    return ctl.editable !== false || hasScalarContent(ctl);
  }
  if (BUTTON_TYPES.has(type)) {
    // A button is visible output only if it carries a prompt or an icon.
    // `action`/`command` alone make the click target wired but invisible
    // (e.g. antd Button with no children renders an empty capsule) —
    // those rows must still collapse.
    return !!(ctl.prompt || ctl.icon);
  }
  if (STRUCTURAL_TYPES.has(type)) {
    return true;
  }
  // Display-only (url/html/highlight/hint/path/attachments/imageFormat/
  // popupUrl/...) or app-specific custom: need real content to be worth
  // a row.
  return hasScalarContent(ctl) || !!ctl.prompt || hasStructuredContent(ctl);
}

/** Is there anything in this row worth rendering? The server now emits the
 *  full template on every response (two-phase pipeline) and marks
 *  conditionally-hidden fields with `visible: false` on the cell and/or
 *  `visible: false` on the control. If every content-bearing cell resolves
 *  to hidden OR to empty content (non-editable fields with no value), the
 *  `<tr>` is suppressed so there's no blank gap in the layout — matching
 *  the legacy HTML behavior where invisible/empty cells weren't emitted.
 *
 *  PROMPT cells alone don't justify keeping a row alive — they're labels
 *  for CONTENT cells, so if all CONTENT is hidden the prompts go too. */
function isRowVisible(row: UIRow): boolean {
  return row.cells.some((cell) => {
    if (cell.visible === false) return false;
    switch (cell.elementType) {
      case ELTYPE_PROMPT:
        return false;
      case ELTYPE_CONTENT:
      case ELTYPE_SELECTOR:
      case ELTYPE_CONTAINER:
      case ELTYPE_FILLER: {
        const ctl = cell.control;
        if (!ctl) return false;
        return controlProducesOutput(ctl);
      }
      case ELTYPE_SECTION_HEADER:
        return !!(cell.text || cell.prompt);
      default:
        return true;
    }
  });
}

/** Check if a row contains a tab, embeddedView, or detailView control */
function isBottomPanelRow(row: UIRow): boolean {
  return row.cells.some((cell) => {
    const type = cell.control?.type;
    return type === 'tab' || type === 'embeddedView' || type === 'detailView';
  });
}

/** Check if a row contains an actionBar control */
function isActionBarRow(row: UIRow): boolean {
  return row.cells.some((cell) => cell.control?.type === 'actionBar');
}

/** Build a tab label node, adding a configure icon when configuring mode is active */
function renderTabLabel(
  tab: { prompt: string; configureIcon?: { included: boolean; itemId: string } },
  onAction: (action: string, params?: Record<string, string>) => void,
): React.ReactNode {
  if (!tab.configureIcon) return tab.prompt;
  const ci = tab.configureIcon;
  const Icon = ci.included ? CheckCircleFilled : CloseCircleFilled;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {tab.prompt}
      <Icon
        className={`configure-icon ${ci.included ? 'configure-on' : 'configure-off'}`}
        title={ci.included ? 'Tab incluso - clicca per escludere' : 'Tab escluso - clicca per includere'}
        onClick={(e) => {
          e.stopPropagation();
          onAction('ToggleItem', { navpath: ci.itemId });
        }}
      />
    </span>
  );
}

const ViewRenderer: React.FC<ViewRendererProps> = ({ ui, onAction, onChange, onGridChange, onEditRow, embedded, fillHeight: fillHeightProp }) => {
  const fillHeightCtx = React.useContext(FillHeightContext);
  const fillHeight = fillHeightProp ?? fillHeightCtx;
  if (!ui) return null;

  // Tree views
  if (ui.viewType === 'tree' && ui.treeNodes) {
    return (
      <ViewNameContext.Provider value={ui.viewName}>
      <PathContext.Provider value={ui.path}>
        <TreeRenderer ui={ui} onAction={onAction} onChange={onChange} />
      </PathContext.Provider>
      </ViewNameContext.Provider>
    );
  }

  if (!ui.rows) return null;

  const pageType = ui.pageType; // 0=QUERY, 1=LIST, 2=DETAIL
  if (pageType === 1) {
    return (
      <FillHeightContext.Provider value={fillHeight}>
      <ViewNameContext.Provider value={ui.viewName}>
      <PathContext.Provider value={ui.path}>
        <ListRenderer ui={ui} onAction={onAction} onChange={onChange} onGridChange={onGridChange} onEditRow={onEditRow} embedded={embedded} fillHeight={fillHeight} />
      </PathContext.Provider>
      </ViewNameContext.Provider>
      </FillHeightContext.Provider>
    );
  }

  // Find last header-item row index (rows containing controls with group or forGroup)
  const lastHeaderRowIdx = (() => {
    let last = -1;
    for (let i = 0; i < ui.rows.length; i++) {
      const row = ui.rows[i];
      for (const cell of row.cells) {
        if (cell.control?.forGroup || cell.control?.group) {
          last = i;
          break;
        }
      }
    }
    return last;
  })();

  // For top-level detail pages, split rows into form rows and bottom panel rows
  // Bottom panel = trailing rows that contain tab/embeddedView/detailView
  let formRows = ui.rows;
  let bottomRows: UIRow[] = [];
  let actionBarRows: UIRow[] = [];

  if (!embedded && pageType === 2) {
    // Find where the bottom panel starts: scan from the end
    let splitIdx = ui.rows.length;
    for (let i = ui.rows.length - 1; i >= 0; i--) {
      if (isBottomPanelRow(ui.rows[i])) {
        splitIdx = i;
      } else {
        break; // Stop at first non-panel row from the bottom
      }
    }
    if (splitIdx < ui.rows.length) {
      formRows = ui.rows.slice(0, splitIdx);
      bottomRows = ui.rows.slice(splitIdx);
    }
    // Extract actionBar rows from form rows so they stay fixed above the scroll area
    actionBarRows = formRows.filter(isActionBarRow);
    formRows = formRows.filter((r) => !isActionBarRow(r));
  }

  // Compute actual column count from form rows only (exclude container/section-header rows
  // whose colspans include child sub-views and inflate the auto-layout table)
  const formCols = (() => {
    let max = 0;
    for (const row of ui.rows) {
      let sum = 0;
      let isFormRow = false;
      for (const cell of row.cells) {
        sum += cell.colspan || 1;
        if (cell.elementType === ELTYPE_PROMPT || cell.elementType === ELTYPE_CONTENT || cell.elementType === ELTYPE_SELECTOR) {
          isFormRow = true;
        }
      }
      if (isFormRow && sum > max) max = sum;
    }
    return max || undefined;
  })();

  // The layout-table sizes to the form fields' declared width — grids
  // (detailView/embeddedView containers) don't contribute to this width
  // because they are autonomous: they take whatever horizontal space is
  // available and scroll internally. We derive the width from formCols
  // (form rows only) rather than ui.totalWidth (which the server computes
  // including grid contributions and is therefore inflated).
  //
  // Each formCol is one server grid column (~charWidth * gridSize px on
  // the legacy HTML layout — typically 24–30px). Using a multiplier in
  // that range keeps form fields at the width their controls expect.
  const formWidth = formCols ? formCols * 24 : (ui.totalWidth || 0);
  const tableWidth = formWidth;
  const tableStyle: React.CSSProperties = embedded
    ? { width: '100%' }
    : { minWidth: tableWidth || '100%' };

  // Ruler row: hidden row defining the grid columns with fixed widths,
  // so colspans in subsequent rows distribute space correctly (mirrors
  // old HTML ruler). Use formCols (form rows only) not ui.totalCols —
  // grids render outside the table and don't constrain the ruler.
  const totalCols = formCols || ui.totalCols || 0;
  const colWidth = totalCols && tableWidth ? tableWidth / totalCols : 0;
  const rulerRow = totalCols > 0 && colWidth > 0 ? (
    <tr style={{ height: 0, lineHeight: 0, fontSize: 0 }}>
      {Array.from({ length: totalCols }, (_, i) => (
        <td key={i} style={{ width: colWidth, padding: 0, border: 'none', height: 0 }} />
      ))}
    </tr>
  ) : null;
  const edgeScroll = useEdgeScrollReveal();

  // Split layout: form (top) / bottom panel (tabs, embedded views).
  // The user can drag the resizer between them to change how much space
  // each gets — useful when the bottom panel contains a grid they want
  // to see more rows of.
  const [formFlexBasisPct, setFormFlexBasisPct] = React.useState<number>(40);
  const splitContainerRef = React.useRef<HTMLDivElement | null>(null);
  const onResizerMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    const startY = e.clientY;
    const rect = container.getBoundingClientRect();
    const startPct = formFlexBasisPct;
    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - startY;
      const deltaPct = (dy / rect.height) * 100;
      const next = Math.min(90, Math.max(10, startPct + deltaPct));
      setFormFlexBasisPct(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [formFlexBasisPct]);

  // Split layout: form scrolls, bottom panel always visible
  if (bottomRows.length > 0) {
    return (
      <FillHeightContext.Provider value={fillHeight}>
      <ViewNameContext.Provider value={ui.viewName}>
      <PathContext.Provider value={ui.path}>
      <div className="view-container" ref={splitContainerRef}>
        {ui.title && <div className="view-title">{ui.title}</div>}
        {actionBarRows.length > 0 && (
          <div className="action-bar-sticky">
            {actionBarRows.map((row, ri) => (
              <RowRenderer key={row.id || `ab_${ri}`} row={row} pageType={pageType} onAction={onAction} onChange={onChange} onGridChange={onGridChange} asDiv />
            ))}
          </div>
        )}
        <div
          className="view-split-form"
          ref={edgeScroll.ref}
          onMouseMove={edgeScroll.onMouseMove}
          onMouseLeave={edgeScroll.onMouseLeave}
          style={{ flex: `0 0 ${formFlexBasisPct}%`, maxHeight: 'none' }}
        >
          <table className="layout-table" style={tableStyle}>
            <tbody>
              {rulerRow}
              {formRows.map((row, ri) => (
                <React.Fragment key={row.id || ri}>
                  <RowRenderer row={row} pageType={pageType} formCols={formCols} onAction={onAction} onChange={onChange} onGridChange={onGridChange} />
                  {ri === lastHeaderRowIdx && (
                    <tr className="header-separator-row">
                      <td colSpan={formCols || 100}>
                        <div className="header-items-separator" />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div
          className="view-split-resizer"
          onMouseDown={onResizerMouseDown}
          title="Trascina per ridimensionare"
        />
        <div className="view-split-bottom">
          {bottomRows.map((row, ri) => {
            // Tab rows: render tab bar + content rows in a table sharing the master grid
            const tabCell = row.cells.find((c) => c.control?.type === 'tab');
            if (tabCell?.control) {
              const tabControl = tabCell.control;
              const tabActiveTab = tabControl.tabs?.find((t) => t.selected)?.name || tabControl.tabs?.[0]?.name;
              return (
                <div key={row.id || `bp_${ri}`} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                  <div className="tab-sticky-wrapper">
                    <Tabs
                      activeKey={tabActiveTab}
                      onChange={(key) => onAction('ChangeTab', { navpath: tabControl.navpath as string, option1: tabControl.controlName as string, option2: key })}
                      items={(tabControl.tabs || []).map((tab) => ({
                        key: tab.name,
                        label: renderTabLabel(tab, onAction),
                      }))}
                    />
                  </div>
                  {tabControl.contentRows && (
                    <div className="tab-content view-body-embedded" style={{ overflow: 'hidden', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                      <table className="layout-table" style={{ width: '100%' }}>
                        <tbody>
                          {rulerRow}
                          {(tabControl.contentRows as UIRow[]).map((cRow, cri) => (
                            <RowRenderer key={cRow.id || `tc_${cri}`} row={cRow} pageType={pageType} formCols={formCols} onAction={onAction} onChange={onChange} onGridChange={onGridChange} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            }
            // Non-tab bottom panel rows
            return (
              <BottomPanelRow key={row.id || `bp_${ri}`} row={row} pageType={pageType} onAction={onAction} onChange={onChange} onGridChange={onGridChange} />
            );
          })}
        </div>
      </div>
      </PathContext.Provider>
      </ViewNameContext.Provider>
      </FillHeightContext.Provider>
    );
  }

  // No split: single view. Top-level pages keep the scrollable view-body.
  // Embedded views are transparent — an embedded "wrapper" view (just
  // dispatchers pointing to an inner list) shouldn't introduce its own
  // scroll container. The inner grid or the parent handles scrolling.
  const bodyClassName = embedded ? 'view-body view-body-embedded' : 'view-body';
  const bodyProps = embedded
    ? { className: bodyClassName }
    : {
        className: bodyClassName,
        ref: edgeScroll.ref,
        onMouseMove: edgeScroll.onMouseMove,
        onMouseLeave: edgeScroll.onMouseLeave,
      };
  return (
    <FillHeightContext.Provider value={fillHeight}>
    <ViewNameContext.Provider value={ui.viewName}>
    <PathContext.Provider value={ui.path}>
    <div className="view-container">
      {ui.title && <div className="view-title">{ui.title}</div>}
      <div {...bodyProps}>
        <table className="layout-table" style={tableStyle}>
          <tbody>
            {rulerRow}
            {ui.rows.map((row, ri) => (
              <React.Fragment key={row.id || ri}>
                <RowRenderer row={row} pageType={pageType} formCols={formCols} onAction={onAction} onChange={onChange} onGridChange={onGridChange} />
                {ri === lastHeaderRowIdx && (
                  <tr className="header-separator-row">
                    <td colSpan={formCols || 100}>
                      <div className="header-items-separator" />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </PathContext.Provider>
    </ViewNameContext.Provider>
    </FillHeightContext.Provider>
  );
};

/** Renders bottom panel rows (tabs, embedded views) outside the table */
const BottomPanelRow: React.FC<{
  row: UIRow;
  pageType?: number;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
  onGridChange?: (name: string, values: string[]) => void;
}> = ({ row, onAction, onChange, onGridChange }) => {
  return (
    <>
      {row.cells.map((cell, ci) => {
        if (!cell.control) return null;
        return (
          <div key={cell.id || ci} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {renderContainerControl(cell.control, onAction, onChange, onGridChange)}
          </div>
        );
      })}
    </>
  );
};

const RowRenderer: React.FC<{
  row: UIRow;
  pageType?: number;
  formCols?: number;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
  onGridChange?: (name: string, values: string[]) => void;
  asDiv?: boolean;
}> = ({ row, pageType, formCols, onAction, onChange, onGridChange, asDiv }) => {
  if (!isRowVisible(row)) return null;
  if (asDiv) {
    // Render outside table context (e.g. sticky action bar)
    return (
      <div id={row.id} className={row.cls || ''}>
        {row.cells.map((cell, ci) => {
          if (!cell.control) return null;
          return (
            <ControlRenderer key={cell.id || ci} control={cell.control} pageType={pageType} onAction={onAction} onChange={onChange} />
          );
        })}
      </div>
    );
  }
  // Detect which CONTENT cells have no preceding PROMPT (companion fields)
  const noPrecedingPrompt = new Set<number>();
  for (let i = 0; i < row.cells.length; i++) {
    if (row.cells[i].elementType === ELTYPE_CONTENT) {
      const prev = i > 0 ? row.cells[i - 1] : null;
      if (!prev || prev.elementType !== ELTYPE_PROMPT) {
        noPrecedingPrompt.add(i);
      }
    }
  }

  return (
    <tr id={row.id} className={row.cls || ''}>
      {row.cells.map((cell, ci) => (
        <CellRenderer key={cell.id || ci} cell={cell} companion={noPrecedingPrompt.has(ci)} pageType={pageType} formCols={formCols} onAction={onAction} onChange={onChange} onGridChange={onGridChange} />
      ))}
    </tr>
  );
};

const CellRenderer: React.FC<{
  cell: UICell;
  companion?: boolean;
  pageType?: number;
  formCols?: number;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
  onGridChange?: (name: string, values: string[]) => void;
}> = ({ cell, companion, pageType, formCols, onAction, onChange, onGridChange }) => {
  // Two-phase pipeline: the template carries a `visible` slot for every
  // conditionally-shown cell. When `hydrate()` resolves it to false, we skip
  // the cell entirely — matching the legacy FULL-mode behavior where
  // hidden cells were simply omitted from the wire.
  if (cell.visible === false) return null;
  // For container/section-header/filler cells, clamp colspan to formCols so
  // sub-view colspans don't inflate the auto-layout table width
  const isFullWidthCell = cell.elementType === ELTYPE_CONTAINER
    || cell.elementType === ELTYPE_SECTION_HEADER
    || cell.elementType === ELTYPE_FILLER;
  const colSpan = isFullWidthCell && formCols ? formCols : cell.colspan;

  const tdProps: React.TdHTMLAttributes<HTMLTableCellElement> = {
    id: cell.id,
    colSpan,
    rowSpan: cell.rowspan,
    className: cell.cls || '',
  };
  if (cell.style) {
    tdProps.style = parseInlineStyle(cell.style);
  }

  switch (cell.elementType) {
    case ELTYPE_PROMPT:
      return (
        <td {...tdProps} className={`prompt-cell ${cell.promptCls || ''} ${cell.cls || ''}`}
          dangerouslySetInnerHTML={cell.prompt ? { __html: cell.prompt } : undefined}
        />
      );

    case ELTYPE_CONTENT: {
      const isCompact = cell.control?.type === 'boolean' || cell.control?.type === 'checkbox';
      if (isCompact) {
        tdProps.colSpan = 1;
        tdProps.style = { ...tdProps.style, width: '1%' };
      }
      const cellClass = `content-cell ${companion ? 'companion-cell' : ''} ${cell.cls || ''}`;
      const docIcon = cell.control?.docIcon;
      const configureIcon = cell.control?.configureIcon;
      const hasSideIcons = !!(docIcon || configureIcon);
      return (
        <td {...tdProps} className={cellClass}>
          {cell.control ? (
            <>
              <span style={hasSideIcons ? { display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap', width: '100%' } : { display: 'block', width: '100%' }}>
                <ControlRenderer control={cell.control} pageType={pageType} onAction={onAction} onChange={onChange} />
                {docIcon && (
                  <BookOutlined
                    className={`doc-icon ${docIcon.hasHelp ? 'doc-on' : 'doc-off'}`}
                    title={docIcon.hasHelp ? 'Modifica documentazione' : 'Aggiungi documentazione'}
                    onClick={() => onAction('NavigateHelp', { navpath: `${docIcon.viewName}|${docIcon.itemId}` })}
                  />
                )}
                {configureIcon && (
                  configureIcon.included
                    ? <CheckCircleFilled
                        className="configure-icon configure-on"
                        title="Elemento incluso - clicca per escludere"
                        onClick={() => onAction('ToggleItem', { navpath: configureIcon.itemId })}
                      />
                    : <CloseCircleFilled
                        className="configure-icon configure-off"
                        title="Elemento escluso - clicca per includere"
                        onClick={() => onAction('ToggleItem', { navpath: configureIcon.itemId })}
                      />
                )}
              </span>
            </>
          ) : null}
        </td>
      );
    }

    case ELTYPE_CONTAINER:
      return (
        <td {...tdProps} className={`container-cell ${cell.cls || ''}`}>
          {cell.control && renderContainerControl(cell.control, onAction, onChange, onGridChange)}
        </td>
      );

    case ELTYPE_SECTION_HEADER:
      return (
        <td {...tdProps} className={`section-header ${cell.cls || ''}`}>
          {cell.text || cell.prompt}
        </td>
      );

    case ELTYPE_SELECTOR:
      return (
        <td {...tdProps} className={`selector-cell ${cell.cls || ''}`}>
          {cell.control ? (
            <ControlRenderer control={cell.control} pageType={pageType} onAction={onAction} onChange={onChange} />
          ) : null}
        </td>
      );

    case ELTYPE_FILLER:
      if (cell.control) {
        return (
          <td {...tdProps} className={`container-cell ${cell.cls || ''}`}>
            {renderContainerControl(cell.control, onAction, onChange, onGridChange)}
          </td>
        );
      }
      return null;

    default:
      return <td {...tdProps} />;
  }
};

function renderContainerControl(
  control: UIControl,
  onAction: (action: string, params?: Record<string, string>) => void,
  onChange: (name: string, value: unknown) => void,
  onGridChange?: (name: string, values: string[]) => void
): React.ReactNode {
  switch (control.type) {
    case 'tab': {
      const activeTab = control.tabs?.find((t) => t.selected)?.name || control.tabs?.[0]?.name;
      return (
        <div className="tab-container">
          <div className="tab-sticky-wrapper">
            <Tabs
              activeKey={activeTab}
              onChange={(key) => onAction('ChangeTab', { navpath: control.navpath as string, option1: control.controlName as string, option2: key })}
              items={(control.tabs || []).map((tab) => ({
                key: tab.name,
                label: renderTabLabel(tab, onAction),
              }))}
            />
          </div>
          {control.contentRows && (
            <div className="tab-content" style={{ overflow: 'hidden', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <ViewRenderer
                ui={{
                  rows: control.contentRows,
                  viewName: control.contentViewName,
                  totalCols: control.totalCols as number | undefined,
                  totalWidth: control.totalWidth as number | undefined,
                }}
                onAction={onAction}
                onChange={onChange}
                onGridChange={onGridChange}
                embedded
                fillHeight
              />
            </div>
          )}
        </div>
      );
    }

    case 'embeddedView':
    case 'detailView': {
      // The server merges the full child UITree into the control object
      const rows = (control.rows ?? control.contentRows) as UIRow[] | undefined;
      if (rows) {
        const isHorizontal = control.layoutType === 'horizontal';
        const embeddedHeader = control.header as UITree['header'];
        const embeddedFooter = control.footer as UITree['footer'];
        const embeddedUi: UITree = {
          rows,
          viewName: (control.viewName ?? control.contentViewName) as string,
          pageType: isHorizontal ? 1 : (control.pageType as number | undefined),
          totalCols: control.totalCols as number | undefined,
          // Derive path from header or footer (server puts it there for embedded views)
          path: embeddedHeader?.path || embeddedFooter?.path || (control.path as string | undefined),
          header: embeddedHeader,
          headers: control.headers as UITree['headers'],
          columns: control.columns as UITree['columns'],
          continuationHeaders: control.continuationHeaders as UITree['continuationHeaders'],
          footer: embeddedFooter,
          multiEdit: control.multiEdit as boolean | undefined,
          listEdit: control.listEdit as boolean | undefined,
        };
        return <ViewRenderer ui={embeddedUi} onAction={onAction} onChange={onChange} onGridChange={onGridChange} embedded />;
      }
      return null;
    }

    default:
      return <ControlRenderer control={control} onAction={onAction} onChange={onChange} />;
  }
}

function parseInlineStyle(styleStr: string): React.CSSProperties {
  const style: Record<string, string> = {};
  styleStr.split(';').forEach((rule) => {
    const [prop, val] = rule.split(':').map((s) => s.trim());
    if (prop && val) {
      const camelProp = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      style[camelProp] = val;
    }
  });
  return style;
}

export default ViewRenderer;
