import React, { useMemo, useCallback, useRef, useEffect } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, type ColDef, type RowClickedEvent, type ICellRendererParams, type GridApi, themeAlpine } from 'ag-grid-community';
import { Button, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { UITree, UIRow, UICell, ListHeader } from '../types/ui';
import { ELTYPE_CONTENT, ELTYPE_SELECTOR, ELTYPE_SECTION_HEADER, ELTYPE_DUMMY } from '../types/ui';
import { getCustomControl } from '../controls/customControls';

const { Text } = Typography;

/** Comparator that sorts on raw values stored in _raw_{idx}, handling numbers and dates */
const rawValueComparator = (colIdx: number) =>
  (_a: unknown, _b: unknown, nodeA: { data?: Record<string, unknown> }, nodeB: { data?: Record<string, unknown> }): number => {
    const rawA = nodeA.data?.[`_raw_${colIdx}`];
    const rawB = nodeB.data?.[`_raw_${colIdx}`];
    if (rawA == null && rawB == null) return 0;
    if (rawA == null) return 1;
    if (rawB == null) return -1;
    const numA = typeof rawA === 'number' ? rawA : Number(rawA);
    const numB = typeof rawB === 'number' ? rawB : Number(rawB);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return String(rawA).localeCompare(String(rawB));
  };

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

// Full-width renderer for continuation rows (2nd, 3rd, ... rows of a multi-row record)
const ContinuationRowRenderer = (params: ICellRendererParams) => {
  const cells = params.data?._continuationCells as Array<{ html?: string; text?: string; colspan?: number }> | undefined;
  if (!cells || cells.length === 0) return null;
  const headers = params.data?._continuationHeaders as ListHeader[] | undefined;
  return (
    <div style={{
      display: 'flex',
      padding: '0 4px',
      lineHeight: '22px',
      fontSize: 12,
    }}>
      {cells.map((cell, i) => {
        const flex = cell.colspan || headers?.[i]?.colspan || 1;
        if (cell.html) {
          return <span key={i} style={{ flex, padding: '0 4px' }} dangerouslySetInnerHTML={{ __html: cell.html }} />;
        }
        return <span key={i} style={{ flex, padding: '0 4px' }}>{cell.text}</span>;
      })}
    </div>
  );
};

/** Detect continuation rows: first cell is DUMMY (elementType 9) */
function isContinuationRow(row: UIRow): boolean {
  return row.cells.length > 0 && row.cells[0].elementType === ELTYPE_DUMMY;
}

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
    const rightAlignColumns = new Set<number>(); // money/number → right-align
    if (ui.columns) {
      ui.columns.forEach((col, idx) => {
        const ctrlType = col.control?.type;
        if (ctrlType === 'html') {
          htmlColumns.add(idx);
        } else if (ctrlType && getCustomControl(ctrlType)) {
          customColumns.set(idx, ctrlType);
          customColumnMeta.set(idx, col.control as Record<string, unknown>);
        }
        if (ctrlType === 'money' || ctrlType === 'number') {
          rightAlignColumns.add(idx);
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
        const isRightAlign = rightAlignColumns.has(idx);
        // Minimum width based on longest word in header (~7px per char + padding)
        const longestWord = (hdr.text || '').split(/\s+/).reduce((a, b) => a.length > b.length ? a : b, '');
        const hdrMinWidth = longestWord.length * 7 + 12;
        cols.push({
          field: `col_${idx}`,
          headerName: hdr.text || '',
          sortable: true,
          comparator: rawValueComparator(idx),
          cellClass: isRightAlign ? [hdr.cls, 'ag-right-aligned-cell'].filter(Boolean) as string[] : hdr.cls,
          headerClass: isRightAlign ? 'ag-right-aligned-header' : undefined,
          headerTooltip: hdr.hint,
          flex: hdr.colspan || 1,
          minWidth: hdrMinWidth,
          cellRenderer,
          autoHeight,
          wrapText: isHtml,
          headerComponentParams: hdr.sortExpression ? { sortExpression: hdr.sortExpression } : undefined,
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

    // Helper to build selector info for a row
    const buildSelectorInfo = (row: UIRow): { command?: string; path?: string } => {
      if (selectorCommand && selectorBasePath) {
        const selectorCell = row.cells.find((_c: UICell, idx: number) => selectorIndices.has(idx));
        const pos = (selectorCell as unknown as Record<string, unknown>)?.pos;
        return {
          command: selectorCommand,
          path: pos != null ? `${selectorBasePath}.${pos}` : selectorBasePath,
        };
      }
      // Fallback: non-compact mode with full selector per row
      const selectorCell = row.cells.find((c: UICell) => c.elementType === ELTYPE_SELECTOR);
      const selector = (selectorCell as unknown as Record<string, unknown>)?.selector as { command?: string; path?: string } | undefined;
      return { command: selector?.command, path: selector?.path };
    };

    // Helper to extract cell values from a continuation row
    const buildContinuationCells = (row: UIRow): Array<{ html?: string; text?: string; colspan?: number }> => {
      const cells: Array<{ html?: string; text?: string; colspan?: number }> = [];
      row.cells.forEach((cell: UICell) => {
        if (cell.elementType === ELTYPE_SELECTOR || cell.elementType === ELTYPE_DUMMY) return;
        if (cell.control) {
          const val = String(cell.control.displayValue ?? cell.control.value ?? '');
          // In list data mode controls lack type; detect HTML by content
          const hasHtml = cell.control.type === 'html' || /<[a-z][\s\S]*>/i.test(val);
          const colspan = (cell as unknown as Record<string, unknown>).colspan as number | undefined;
          cells.push(hasHtml ? { html: val, colspan } : { text: val, colspan });
        }
      });
      return cells;
    };

    const continuationHeaders = ui.continuationHeaders;

    // Build row data, detecting continuation rows (first cell is DUMMY elementType 9)
    const rows: Array<Record<string, unknown>> = [];
    let lastSelectorInfo: { command?: string; path?: string } = {};
    let contRowIdx = 0; // tracks which continuation row within a record (0-based)
    let recordGroup = 0; // groups main + continuation rows for hover

    for (let i = 0; i < ui.rows.length; i++) {
      const row = ui.rows[i];
      const rowObj: Record<string, unknown> = { _rowId: row.id };

      // Break rows (group separators) — full-width section headers
      if (row.cls === 'breakRow') {
        const headerCell = row.cells.find((c: UICell) => c.elementType === ELTYPE_SECTION_HEADER);
        rowObj._isBreakRow = true;
        rowObj._breakText = headerCell?.text || '';
        rows.push(rowObj);
        continue;
      }

      // Continuation row: first cell is DUMMY (elementType 9)
      if (isContinuationRow(row)) {
        const contCells = buildContinuationCells(row);
        // Skip empty continuation rows (all dummy/empty cells)
        if (contCells.every(c => !c.html && !c.text)) {
          contRowIdx++;
          continue;
        }
        rowObj._isContinuationRow = true;
        rowObj._continuationCells = contCells;
        rowObj._recordGroup = recordGroup;
        // Attach headers for this continuation row if available
        if (continuationHeaders && continuationHeaders[contRowIdx]) {
          rowObj._continuationHeaders = continuationHeaders[contRowIdx];
        }
        // Propagate selector from the preceding main row
        if (lastSelectorInfo.command) rowObj._selectorCommand = lastSelectorInfo.command;
        if (lastSelectorInfo.path) rowObj._selectorPath = lastSelectorInfo.path;
        rows.push(rowObj);
        contRowIdx++;
        continue;
      }

      // Normal row (first or only row of record)
      contRowIdx = 0;
      recordGroup++;
      // Check if next row is a continuation — mark this as having continuations
      const nextRow = i + 1 < ui.rows.length ? ui.rows[i + 1] : null;
      if (nextRow && isContinuationRow(nextRow)) {
        rowObj._hasContination = true;
        rowObj._recordGroup = recordGroup;
      }
      const sel = buildSelectorInfo(row);
      lastSelectorInfo = sel;
      if (sel.command) rowObj._selectorCommand = sel.command;
      if (sel.path) rowObj._selectorPath = sel.path;

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
          // Store raw value for client-side sorting (avoids locale-formatted string comparison)
          if (cell.control.value !== undefined) {
            rowObj[`_raw_${idx}`] = cell.control.value;
          }
        }
      });
      rows.push(rowObj);
    }

    return { columnDefs: cols, rowData: rows };
  }, [ui.rows, ui.headers, ui.columns, ui.continuationHeaders]);

  // Refs and helpers for grouped hover/selection on multi-row records
  const gridApiRef = useRef<GridApi | null>(null);
  const gridContainerRef = useRef<HTMLDivElement | null>(null);
  const lastHoverPath = useRef<string | null>(null);
  const lastSelectedPath = useRef<string | null>(null);

  const getGridViewport = useCallback((): HTMLElement | null => {
    return gridContainerRef.current?.querySelector('.ag-body-viewport') ?? null;
  }, []);

  /** Apply a CSS class to all rows sharing the same _selectorPath */
  const applyClassByPath = useCallback((path: string | null, cls: string) => {
    const api = gridApiRef.current;
    const viewport = getGridViewport();
    if (!api || !viewport) return;
    viewport.querySelectorAll(`.${cls}`).forEach(el => el.classList.remove(cls));
    if (!path) return;
    api.forEachNode((node: { data?: Record<string, unknown>; id?: string }) => {
      if (node.data?._selectorPath === path) {
        viewport.querySelectorAll(`[row-id="${node.id}"]`).forEach(el => el.classList.add(cls));
      }
    });
  }, [getGridViewport]);

  const handleRowClicked = (event: RowClickedEvent) => {
    if (event.data?._isBreakRow) return;
    const path = event.data?._selectorPath as string | undefined;
    lastSelectedPath.current = path ?? null;
    applyClassByPath(path ?? null, 'record-group-selected');
    const command = event.data?._selectorCommand;
    if (command && path) {
      onAction(command, { navpath: path });
    }
  };

  // Handle clicks on full-width rows (continuation rows) which may not trigger onRowClicked
  const handleGridClick = useCallback((e: React.MouseEvent) => {
    const api = gridApiRef.current;
    if (!api) return;
    const rowEl = (e.target as HTMLElement).closest('.ag-row') as HTMLElement | null;
    if (!rowEl) return;
    const rowId = rowEl.getAttribute('row-id');
    if (!rowId) return;
    const rowNode = api.getRowNode(rowId);
    if (!rowNode?.data || rowNode.data._isBreakRow) return;
    if (!rowNode.data._isContinuationRow) return;
    const path = rowNode.data._selectorPath as string | undefined;
    lastSelectedPath.current = path ?? null;
    applyClassByPath(path ?? null, 'record-group-selected');
    const command = rowNode.data._selectorCommand;
    if (command && path) {
      onAction(command, { navpath: path });
    }
  }, [applyClassByPath, onAction]);

  const isFullWidthRow = (params: { rowNode: { data?: Record<string, unknown> } }) =>
    !!params.rowNode.data?._isBreakRow || !!params.rowNode.data?._isContinuationRow;

  const fullWidthCellRenderer = (params: ICellRendererParams) => {
    if (params.data?._isBreakRow) return <BreakRowRenderer {...params} />;
    if (params.data?._isContinuationRow) return <ContinuationRowRenderer {...params} />;
    return null;
  };

  const getRowClass = (params: { data?: Record<string, unknown> }) => {
    if (params.data?._isContinuationRow) return 'continuation-row';
    if (params.data?._hasContination) return 'record-first-row';
    return undefined;
  };

  const getRowHeight = (params: { data?: Record<string, unknown> }): number | undefined => {
    if (params.data?._isContinuationRow) {
      const cells = params.data._continuationCells as Array<{ html?: string; text?: string }> | undefined;
      if (cells?.some(c => c.html && /<br\s*\/?>/i.test(c.html))) {
        let maxBreaks = 0;
        for (const c of cells) {
          if (c.html) {
            const breaks = (c.html.match(/<br\s*\/?>/gi) || []).length;
            if (breaks > maxBreaks) maxBreaks = breaks;
          }
        }
        return Math.max(22, (maxBreaks + 1) * 22);
      }
    }
    return undefined;
  };

  // Native DOM event listeners for grouped hover — React synthetic events
  // don't fire reliably for AG Grid's dynamically created DOM elements
  useEffect(() => {
    const container = gridContainerRef.current;
    if (!container) return;

    const onMouseOver = (e: MouseEvent) => {
      const api = gridApiRef.current;
      if (!api) return;
      const rowEl = (e.target as HTMLElement).closest('.ag-row') as HTMLElement | null;
      if (!rowEl) return;
      const rowId = rowEl.getAttribute('row-id');
      if (!rowId) return;
      const node = api.getRowNode(rowId);
      const path = node?.data?._selectorPath as string | undefined;
      if (path === lastHoverPath.current) return;
      lastHoverPath.current = path ?? null;
      applyClassByPath(path ?? null, 'record-group-hover');
    };

    const onMouseLeave = () => {
      if (lastHoverPath.current != null) {
        lastHoverPath.current = null;
        applyClassByPath(null, 'record-group-hover');
      }
    };

    container.addEventListener('mouseover', onMouseOver);
    container.addEventListener('mouseleave', onMouseLeave);
    return () => {
      container.removeEventListener('mouseover', onMouseOver);
      container.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [applyClassByPath]);

  // All data local (no paging or single page) — always use client-side sort
  const allDataLocal = !ui.paging || ui.paging.totalPages <= 1;

  // Sort handler: server-side only for multi-page data with sortExpression, client-side otherwise
  const handleSortChanged = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) return;
    const sortModel = api.getColumnState().filter(c => c.sort);
    if (sortModel.length === 0) return;
    if (allDataLocal) return; // AG Grid handles client-side sort natively
    const sortedCol = sortModel[0];
    const colIdx = parseInt(sortedCol.colId?.replace('col_', '') || '', 10);
    const hdr = ui.headers?.[colIdx];
    if (hdr?.sortExpression) {
      const params: Record<string, string> = { option1: hdr.sortExpression };
      if (ui.path) params.navpath = ui.path;
      onAction('SortColumn', params);
      api.applyColumnState({ defaultState: { sort: null } });
    }
  }, [onAction, ui.headers, ui.path, allDataLocal]);

  // Inject continuation header rows into the AG Grid DOM after the ag-header
  const injectContinuationHeaders = useCallback(() => {
    const container = gridContainerRef.current;
    const contHeaders = ui.continuationHeaders;
    if (!container || !contHeaders || contHeaders.length === 0) return;

    const agHeader = container.querySelector('.ag-header');
    if (!agHeader) return;

    // Remove any previously injected continuation headers
    container.querySelectorAll('.continuation-header-row').forEach(el => el.remove());

    // Insert after ag-header
    contHeaders.forEach((rowHeaders) => {
      const row = document.createElement('div');
      row.className = 'continuation-header-row';
      row.style.cssText = 'display:flex;font-size:12px;color:#888;background:#fafafa;border-bottom:1px solid #f0f0f0;padding:0 4px;';
      rowHeaders.forEach((hdr) => {
        const cell = document.createElement('div');
        cell.style.cssText = `flex:${hdr.colspan || 1};padding:3px 4px;`;
        cell.textContent = hdr.text || '';
        row.appendChild(cell);
      });
      agHeader.insertAdjacentElement('afterend', row);
    });
  }, [ui.continuationHeaders]);

  const meta = ui.header;
  const footer = ui.footer;

  // Compute minimum width from header colspans (similar to detail view: ~10px per column unit)
  const totalColspan = ui.headers?.reduce((sum, h) => sum + (h.type === 'selector' ? 0 : (h.colspan || 1)), 0) || 0;
  const minListWidth = totalColspan > 0 ? totalColspan * 10 : undefined;

  return (
    <div className="list-container" style={minListWidth ? { minWidth: minListWidth } : undefined}>
      {meta?.title && <div className="view-title">{meta.title}</div>}

      <div
        ref={gridContainerRef}
        style={{ width: '100%', flex: embedded ? undefined : 1, minHeight: 0 }}
        onClick={handleGridClick}
      >
        <AgGridReact
          modules={[AllCommunityModule]}
          theme={gridTheme}
          columnDefs={columnDefs}
          rowData={rowData}
          onGridReady={(params) => { gridApiRef.current = params.api; injectContinuationHeaders(); }}
          onRowClicked={handleRowClicked}
          onSortChanged={handleSortChanged}
          isFullWidthRow={isFullWidthRow}
          fullWidthCellRenderer={fullWidthCellRenderer}
          getRowClass={getRowClass}
          getRowHeight={getRowHeight}
          suppressRowClickSelection
          suppressCellFocus
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
            onClick={() => onAction(meta.addCommand!, ui.path ? { navpath: ui.path } : undefined)}
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
