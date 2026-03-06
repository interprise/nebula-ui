import React, { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, type ColDef, type RowClickedEvent, themeAlpine } from 'ag-grid-community';
import { Button } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { UITree, UIRow, UICell } from '../types/ui';
import { ELTYPE_CONTENT } from '../types/ui';

interface ListRendererProps {
  ui: UITree;
  onAction: (action: string, params?: Record<string, string>) => void;
}

const ListRenderer: React.FC<ListRendererProps> = ({ ui, onAction }) => {
  const { columnDefs, rowData } = useMemo(() => {
    if (!ui.rows || ui.rows.length === 0) return { columnDefs: [], rowData: [] };

    // First row is typically the header
    const headerRow = ui.rows[0];
    const dataRows = ui.rows.slice(1);

    // Build column definitions from header cells
    const cols: ColDef[] = [];
    if (headerRow?.cells) {
      headerRow.cells.forEach((cell: UICell) => {
        if (cell.control?.columns) {
          // We have explicit column definitions from the server
          cell.control.columns.forEach((col) => {
            cols.push({
              field: col.name,
              headerName: col.prompt,
              sortable: !!col.sortExpr,
              width: col.width,
              cellClass: col.cls,
            });
          });
        }
      });
    }

    // If no explicit columns, derive from data cells
    if (cols.length === 0 && dataRows.length > 0) {
      const firstDataRow = dataRows[0];
      firstDataRow.cells.forEach((cell: UICell, idx: number) => {
        if (cell.elementType === ELTYPE_CONTENT && cell.control) {
          cols.push({
            field: cell.control.name || `col_${idx}`,
            headerName: cell.prompt || cell.control.name || `Col ${idx}`,
            sortable: true,
          });
        }
      });
    }

    // Build row data
    const rows = dataRows.map((row: UIRow) => {
      const rowObj: Record<string, unknown> = { _rowId: row.id };
      row.cells.forEach((cell: UICell) => {
        if (cell.control?.name) {
          rowObj[cell.control.name] = cell.control.displayValue ?? cell.control.value ?? '';
        }
      });
      return rowObj;
    });

    return { columnDefs: cols, rowData: rows };
  }, [ui.rows]);

  const handleRowClicked = (event: RowClickedEvent) => {
    const rowId = event.data?._rowId;
    if (rowId) {
      onAction('Post', { option1: rowId });
    }
  };

  const addButton = ui.rows?.length
    ? ui.rows[ui.rows.length - 1]?.cells?.[0]?.control?.addButton
    : undefined;

  return (
    <div className="list-container">
      {ui.title && <div className="view-title">{ui.title}</div>}
      <div style={{ width: '100%', flex: 1 }}>
        <AgGridReact
          modules={[AllCommunityModule]}
          theme={themeAlpine}
          columnDefs={columnDefs}
          rowData={rowData}
          domLayout="autoHeight"
          onRowClicked={handleRowClicked}
          rowSelection="single"
          suppressCellFocus
        />
      </div>
      {addButton && (
        <div style={{ marginTop: 8 }}>
          <Button
            icon={<PlusOutlined />}
            onClick={() => onAction(addButton.action)}
          >
            {addButton.prompt}
          </Button>
        </div>
      )}
    </div>
  );
};

export default ListRenderer;
