import React, { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, type ColDef, type RowClickedEvent, type ICellRendererParams, themeAlpine } from 'ag-grid-community';
import { Button, Typography } from 'antd';
import { PlusOutlined, CaretUpOutlined, CaretDownOutlined } from '@ant-design/icons';
import type { UITree, UIRow, UICell, ListHeader } from '../types/ui';
import { ELTYPE_CONTENT, ELTYPE_SELECTOR, ELTYPE_SECTION_HEADER } from '../types/ui';
import { getCustomControl } from '../controls/customControls';

const { Text } = Typography;

const gridTheme = themeAlpine.withParams({
  rowHeight: 22,
  headerHeight: 36,
  fontSize: 12,
  cellHorizontalPadding: 4,
});

// Cell renderer for HTML content (addresses, contacts, etc.)
const HtmlCellRenderer = (params: ICellRendererParams) => {
  const val = params.value;
  if (!val) return null;
  return <span dangerouslySetInnerHTML={{ __html: val }} />;
};

// Cell renderer for custom controls (delegates to registered component)
const CustomCellRenderer = (params: ICellRendererParams) => {
  const field = params.colDef?.field;
  if (!field) return null;
  const idx = field.replace('col_', '');
  const controlType = params.data?.[`_type_${idx}`] as string | undefined;
  if (!controlType) return null;
  const CustomComponent = getCustomControl(controlType);
  if (!CustomComponent) return null;
  const colMeta = params.data?.[`_meta_${idx}`] as Record<string, unknown> | undefined;
  const control = { type: controlType, value: params.value, editable: false, ...colMeta };
  const noop = () => {};
  return <CustomComponent control={control} onAction={noop} onChange={noop} />;
};

// Full-width renderer for break rows (group separators)
const BreakRowRenderer = (params: ICellRendererParams) => {
  return (
    <div style={{
      background: 'linear-gradient(to bottom, #dae6f4 0%, #c2d6eb 100%)',
      fontWeight: 'bold',
      fontSize: 11,
      padding: '0 6px',
      lineHeight: '22px',
      border: '1px solid #99bbe8',
      color: '#15428b',
    }}>
      {params.data?._breakText}
    </div>
  );
};

interface ListRendererProps {
  ui: UITree;
  onAction: (action: string, params?: Record<string, string>) => void;
  embedded?: boolean;
}

const ListRenderer: React.FC<ListRendererProps> = ({ ui, onAction, embedded }) => {
  const { columnDefs, rowData } = useMemo(() => {
    if (!ui.rows || ui.rows.length === 0) return { columnDefs: [], rowData: [] };

    const serverHeaders = ui.headers;

    // Detect which columns need special rendering (HTML or custom controls)
    const htmlColumns = new Set<number>();
    const customColumns = new Map<number, string>(); // idx → control type
    const customColumnMeta = new Map<number, Record<string, unknown>>(); // idx → column control metadata
    if (ui.columns) {
      ui.columns.forEach((col, idx) => {
        const ctrlType = col.control?.type;
        if (ctrlType === 'html') {
          htmlColumns.add(idx);
        } else if (ctrlType && getCustomControl(ctrlType)) {
          customColumns.set(idx, ctrlType);
          customColumnMeta.set(idx, col.control as Record<string, unknown>);
        }
      });
    } else {
      // Fallback: check first data row
      const firstDataRow = ui.rows.find((r: UIRow) => r.cls !== 'breakRow');
      if (firstDataRow) {
        firstDataRow.cells.forEach((cell: UICell, idx: number) => {
          if (cell.control?.type === 'html') htmlColumns.add(idx);
        });
      }
    }

    // Build column definitions from server headers
    const cols: ColDef[] = [];
    if (serverHeaders && serverHeaders.length > 0) {
      serverHeaders.forEach((hdr: ListHeader, idx: number) => {
        if (hdr.type === 'selector') {
          return;
        }
        const isHtml = htmlColumns.has(idx);
        const customType = customColumns.get(idx);
        let cellRenderer: ColDef['cellRenderer'] = undefined;
        let autoHeight = false;
        if (isHtml) {
          cellRenderer = HtmlCellRenderer;
          autoHeight = true;
        } else if (customType) {
          cellRenderer = CustomCellRenderer;
          autoHeight = true;
        }
        cols.push({
          field: `col_${idx}`,
          headerName: hdr.text || '',
          sortable: false,
          cellClass: hdr.cls,
          headerTooltip: hdr.hint,
          flex: hdr.colspan || 1,
          cellRenderer,
          autoHeight,
          wrapText: isHtml,
        });
      });
    } else {
      // Fallback: derive columns from first data row cells
      const firstRow = ui.rows[0];
      if (firstRow) {
        firstRow.cells.forEach((cell: UICell, idx: number) => {
          if (cell.elementType === ELTYPE_CONTENT) {
            const isHtml = cell.control?.type === 'html';
            cols.push({
              field: `col_${idx}`,
              headerName: cell.prompt || cell.control?.name || `Col ${idx}`,
              sortable: false,
              cellRenderer: isHtml ? HtmlCellRenderer : undefined,
              autoHeight: isHtml,
              wrapText: isHtml,
            });
          }
        });
      }
    }

    // Extract selector info from column definitions (same for all rows)
    const colDefs = ui.columns;
    let selectorCommand: string | undefined;
    let selectorBasePath: string | undefined;
    const selectorIndices = new Set<number>();
    if (colDefs) {
      colDefs.forEach((col, idx) => {
        if (col.elementType === ELTYPE_SELECTOR || col.selector) {
          selectorIndices.add(idx);
          if (col.selector) {
            selectorCommand = col.selector.command;
            selectorBasePath = col.selector.basePath;
          }
        }
      });
    }

    // Build row data — use cell array index to match header array index
    const rows = ui.rows.map((row: UIRow) => {
      const rowObj: Record<string, unknown> = { _rowId: row.id };

      // Break rows (group separators) — full-width section headers
      if (row.cls === 'breakRow') {
        const headerCell = row.cells.find((c: UICell) => c.elementType === ELTYPE_SECTION_HEADER);
        rowObj._isBreakRow = true;
        rowObj._breakText = headerCell?.text || '';
        return rowObj;
      }

      // Build navpath from basePath + row position
      if (selectorCommand && selectorBasePath) {
        rowObj._selectorCommand = selectorCommand;
        // Find the selector cell to get the row's position index
        const selectorCell = row.cells.find((_c: UICell, idx: number) => selectorIndices.has(idx));
        const pos = (selectorCell as unknown as Record<string, unknown>)?.pos;
        rowObj._selectorPath = pos != null ? `${selectorBasePath}.${pos}` : selectorBasePath;
      } else {
        // Fallback: non-compact mode with full selector per row
        const selectorCell = row.cells.find((c: UICell) => c.elementType === ELTYPE_SELECTOR);
        const selector = (selectorCell as unknown as Record<string, unknown>)?.selector as { command?: string; path?: string } | undefined;
        if (selector) {
          rowObj._selectorCommand = selector.command;
          rowObj._selectorPath = selector.path;
        }
      }
      row.cells.forEach((cell: UICell, idx: number) => {
        if (selectorIndices.has(idx) || cell.elementType === ELTYPE_SELECTOR) return;
        if (cell.control) {
          if (customColumns.has(idx)) {
            // Custom controls: store raw value + type + column meta for the cell renderer
            rowObj[`col_${idx}`] = cell.control.value;
            rowObj[`_type_${idx}`] = customColumns.get(idx);
            const meta = customColumnMeta.get(idx);
            if (meta) rowObj[`_meta_${idx}`] = meta;
          } else {
            rowObj[`col_${idx}`] = cell.control.displayValue ?? cell.control.value ?? '';
          }
        }
      });
      return rowObj;
    });

    return { columnDefs: cols, rowData: rows };
  }, [ui.rows, ui.headers, ui.columns]);

  const handleRowClicked = (event: RowClickedEvent) => {
    if (event.data?._isBreakRow) return;
    const command = event.data?._selectorCommand;
    const path = event.data?._selectorPath;
    if (command && path) {
      onAction(command, { navpath: path });
    }
  };

  const isFullWidthRow = (params: { rowNode: { data?: Record<string, unknown> } }) =>
    !!params.rowNode.data?._isBreakRow;

  const handleSort = (sortExpression: string) => {
    onAction('SortColumn', { option1: sortExpression });
  };

  const meta = ui.header;
  const footer = ui.footer;

  return (
    <div className="list-container">
      {meta?.title && <div className="view-title">{meta.title}</div>}

      {/* Column headers with sort support */}
      {ui.headers && ui.headers.length > 0 && (
        <div className="list-headers" style={{ display: 'flex', borderBottom: '2px solid #e8e8e8', background: '#fafafa', fontWeight: 600, fontSize: 13 }}>
          {ui.headers.map((hdr, idx) => {
            if (hdr.type === 'selector') return null;
            const sortable = !!hdr.sortExpression;
            return (
              <div
                key={idx}
                className={hdr.cls || ''}
                title={hdr.hint}
                style={{
                  flex: hdr.colspan || 1,
                  padding: '6px 8px',
                  cursor: sortable ? 'pointer' : 'default',
                  userSelect: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
                onClick={sortable ? () => handleSort(hdr.sortExpression!) : undefined}
              >
                {hdr.text}
                {hdr.sortDir === 'asc' && <CaretUpOutlined style={{ fontSize: 10, color: '#1677ff' }} />}
                {hdr.sortDir === 'desc' && <CaretDownOutlined style={{ fontSize: 10, color: '#1677ff' }} />}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ width: '100%', flex: embedded ? undefined : 1, minHeight: 0 }}>
        <AgGridReact
          modules={[AllCommunityModule]}
          theme={gridTheme}
          columnDefs={columnDefs}
          rowData={rowData}
          onRowClicked={handleRowClicked}
          isFullWidthRow={isFullWidthRow}
          fullWidthCellRenderer={BreakRowRenderer}
          rowSelection="single"
          suppressCellFocus
          headerHeight={0}
          domLayout={embedded ? 'autoHeight' : undefined}
          overlayNoRowsTemplate="Nessun record da visualizzare"
        />
      </div>

      {/* Pagination info */}
      {ui.paging ? (
        <div style={{ padding: '6px 8px', fontSize: 12, color: '#666', borderTop: '1px solid #e8e8e8' }}>
          <Text type="secondary">
            {ui.paging.totalRows} record &middot; Pagina {ui.paging.currentPage} di {ui.paging.totalPages}
          </Text>
        </div>
      ) : meta && meta.recordCount !== undefined && (
        <div style={{ padding: '6px 8px', fontSize: 12, color: '#666', borderTop: '1px solid #e8e8e8' }}>
          <Text type="secondary">
            {meta.recordCount} record
            {meta.pageSize && meta.position !== undefined && (
              <> &middot; Pagina {Math.floor(meta.position / meta.pageSize) + 1} di {Math.ceil(meta.recordCount / meta.pageSize)}</>
            )}
          </Text>
        </div>
      )}

      {/* Add button from header metadata */}
      {meta?.addCommand && (
        <div style={{ marginTop: 8 }}>
          <Button
            icon={<PlusOutlined />}
            onClick={() => onAction(meta.addCommand!)}
          >
            {meta.addLabel || 'Nuovo'}
          </Button>
        </div>
      )}

      {/* Add button from footer (embedded lists) */}
      {footer && (
        <div style={{ marginTop: 8 }}>
          <Button
            icon={<PlusOutlined />}
            onClick={() => onAction(footer.addCommand, footer.path ? { navpath: footer.path } : undefined)}
          >
            {footer.label || 'Nuovo'}
          </Button>
        </div>
      )}
    </div>
  );
};

export default ListRenderer;
