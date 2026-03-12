import React from 'react';
import { Tabs } from 'antd';
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

interface ViewRendererProps {
  ui: UITree;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
  /** When true, this is a nested/embedded view — don't apply the split layout */
  embedded?: boolean;
}

// Session ID context — used by remote combos to call the server
export const SidContext = React.createContext<string>('S1');

/** Check if a row contains a tab, embeddedView, or detailView control */
function isBottomPanelRow(row: UIRow): boolean {
  return row.cells.some((cell) => {
    const type = cell.control?.type;
    return type === 'tab' || type === 'embeddedView' || type === 'detailView';
  });
}

const ViewRenderer: React.FC<ViewRendererProps> = ({ ui, onAction, onChange, embedded }) => {
  if (!ui || !ui.rows) return null;

  const pageType = ui.pageType; // 0=QUERY, 1=LIST, 2=DETAIL
  if (pageType === 1) {
    return <ListRenderer ui={ui} onAction={onAction} embedded={embedded} />;
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
  }

  const tableStyle: React.CSSProperties | undefined = ui.totalWidth
    ? { width: ui.totalWidth, maxWidth: '100%', tableLayout: 'fixed' }
    : undefined;

  // Split layout: form scrolls, bottom panel always visible
  if (bottomRows.length > 0) {
    return (
      <div className="view-container">
        {ui.title && <div className="view-title">{ui.title}</div>}
        <div className="view-split-form">
          <table className="layout-table" style={tableStyle}>
            <tbody>
              {formRows.map((row, ri) => (
                <React.Fragment key={row.id || ri}>
                  <RowRenderer row={row} pageType={pageType} onAction={onAction} onChange={onChange} />
                  {ri === lastHeaderRowIdx && (
                    <tr className="header-separator-row">
                      <td colSpan={ui.totalCols || 100}>
                        <div className="header-items-separator" />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="view-split-bottom">
          {bottomRows.map((row, ri) => (
            <BottomPanelRow key={row.id || `bp_${ri}`} row={row} pageType={pageType} onAction={onAction} onChange={onChange} />
          ))}
        </div>
      </div>
    );
  }

  // No split: single scrollable view (query pages, simple detail pages, embedded views)
  return (
    <div className="view-container">
      {ui.title && <div className="view-title">{ui.title}</div>}
      <div className="view-body">
        <table className="layout-table" style={tableStyle}>
          <tbody>
            {ui.rows.map((row, ri) => (
              <React.Fragment key={row.id || ri}>
                <RowRenderer row={row} pageType={pageType} onAction={onAction} onChange={onChange} />
                {ri === lastHeaderRowIdx && (
                  <tr className="header-separator-row">
                    <td colSpan={ui.totalCols || 100}>
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
  );
};

/** Renders bottom panel rows (tabs, embedded views) outside the table */
const BottomPanelRow: React.FC<{
  row: UIRow;
  pageType?: number;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
}> = ({ row, onAction, onChange }) => {
  return (
    <>
      {row.cells.map((cell, ci) => {
        if (!cell.control) return null;
        return (
          <div key={cell.id || ci}>
            {renderContainerControl(cell.control, onAction, onChange)}
          </div>
        );
      })}
    </>
  );
};

const RowRenderer: React.FC<{
  row: UIRow;
  pageType?: number;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
}> = ({ row, pageType, onAction, onChange }) => {
  return (
    <tr id={row.id} className={row.cls || ''}>
      {row.cells.map((cell, ci) => (
        <CellRenderer key={cell.id || ci} cell={cell} pageType={pageType} onAction={onAction} onChange={onChange} />
      ))}
    </tr>
  );
};

const CellRenderer: React.FC<{
  cell: UICell;
  pageType?: number;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
}> = ({ cell, pageType, onAction, onChange }) => {
  const tdProps: React.TdHTMLAttributes<HTMLTableCellElement> = {
    id: cell.id,
    colSpan: cell.colspan,
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
      return (
        <td {...tdProps} className={`content-cell ${cell.cls || ''}`}>
          {cell.control ? (
            <ControlRenderer control={cell.control} pageType={pageType} onAction={onAction} onChange={onChange} />
          ) : null}
        </td>
      );
    }

    case ELTYPE_CONTAINER:
      return (
        <td {...tdProps} className={`container-cell ${cell.cls || ''}`}>
          {cell.control && renderContainerControl(cell.control, onAction, onChange)}
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
            {renderContainerControl(cell.control, onAction, onChange)}
          </td>
        );
      }
      return <td {...tdProps} className={`filler-cell ${cell.cls || ''}`} />;

    default:
      return <td {...tdProps} />;
  }
};

function renderContainerControl(
  control: UIControl,
  onAction: (action: string, params?: Record<string, string>) => void,
  onChange: (name: string, value: unknown) => void
): React.ReactNode {
  switch (control.type) {
    case 'tab': {
      const activeTab = control.tabs?.find((t) => t.selected)?.name || control.tabs?.[0]?.name;
      return (
        <>
          <div className="tab-sticky-wrapper">
            <Tabs
              activeKey={activeTab}
              onChange={(key) => onAction('ChangeTab', { navpath: control.navpath as string, option1: control.controlName as string, option2: key })}
              items={(control.tabs || []).map((tab) => ({
                key: tab.name,
                label: tab.prompt,
              }))}
            />
          </div>
          {control.contentRows && (
            <div className="tab-content">
              <ViewRenderer
                ui={{ rows: control.contentRows, viewName: control.contentViewName }}
                onAction={onAction}
                onChange={onChange}
                embedded
              />
            </div>
          )}
        </>
      );
    }

    case 'embeddedView':
    case 'detailView': {
      // The server merges the full child UITree into the control object
      const rows = (control.rows ?? control.contentRows) as UIRow[] | undefined;
      if (rows) {
        const isHorizontal = control.layoutType === 'horizontal';
        const embeddedUi: UITree = {
          rows,
          viewName: (control.viewName ?? control.contentViewName) as string,
          pageType: isHorizontal ? 1 : (control.pageType as number | undefined),
          totalCols: control.totalCols as number | undefined,
          header: control.header as UITree['header'],
          headers: control.headers as UITree['headers'],
          columns: control.columns as UITree['columns'],
          footer: control.footer as UITree['footer'],
        };
        return <ViewRenderer ui={embeddedUi} onAction={onAction} onChange={onChange} embedded />;
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
