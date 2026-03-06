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
}

const ViewRenderer: React.FC<ViewRendererProps> = ({ ui, onAction, onChange }) => {
  if (!ui || !ui.rows) return null;

  const pageType = ui.pageType; // 0=DETAIL, 1=LIST, 2=QUERY
  if (pageType === 1) {
    return <ListRenderer ui={ui} onAction={onAction} />;
  }

  return (
    <div className="view-container">
      {ui.title && <div className="view-title">{ui.title}</div>}
      <div className="view-body">
        <table className="layout-table">
          <tbody>
            {ui.rows.map((row, ri) => (
              <RowRenderer key={row.id || ri} row={row} onAction={onAction} onChange={onChange} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const RowRenderer: React.FC<{
  row: UIRow;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
}> = ({ row, onAction, onChange }) => {
  return (
    <tr id={row.id} className={row.cls || ''}>
      {row.cells.map((cell, ci) => (
        <CellRenderer key={cell.id || ci} cell={cell} onAction={onAction} onChange={onChange} />
      ))}
    </tr>
  );
};

const CellRenderer: React.FC<{
  cell: UICell;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
}> = ({ cell, onAction, onChange }) => {
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
        <td {...tdProps} className={`prompt-cell ${cell.promptCls || ''} ${cell.cls || ''}`}>
          {cell.prompt}
        </td>
      );

    case ELTYPE_CONTENT:
      return (
        <td {...tdProps} className={`content-cell ${cell.cls || ''}`}>
          {cell.control ? (
            <ControlRenderer control={cell.control} onAction={onAction} onChange={onChange} />
          ) : null}
        </td>
      );

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
            <ControlRenderer control={cell.control} onAction={onAction} onChange={onChange} />
          ) : null}
        </td>
      );

    case ELTYPE_FILLER:
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
    case 'tab':
      return (
        <Tabs
          activeKey={control.tabs?.find((t) => t.selected)?.name || control.tabs?.[0]?.name}
          onChange={(key) => onAction('Post', { option1: key })}
          items={(control.tabs || []).map((tab) => ({
            key: tab.name,
            label: tab.prompt,
          }))}
        />
      );

    case 'embeddedView':
    case 'detailView':
      if (control.contentRows) {
        const embeddedUi: UITree = {
          rows: control.contentRows,
          viewName: control.contentViewName,
          pageType: control.type === 'detailView' ? 0 : undefined,
        };
        return <ViewRenderer ui={embeddedUi} onAction={onAction} onChange={onChange} />;
      }
      return null;

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
