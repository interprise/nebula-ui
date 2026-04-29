import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, themeAlpine, type GridApi } from 'ag-grid-community';
import { Spin, Alert, Typography, Select, Checkbox, Button, Popover } from 'antd';
import { LayoutOutlined, FileExcelOutlined, FileTextOutlined } from '@ant-design/icons';
import type { ControlComponentProps } from '../../controls/types';
import { SidContext, FormValuesContext } from '../ViewRenderer';
import { useOlapState } from './useOlapState';
import { pivot, type PivotedRow } from './pivot';
import type { CubeRow } from './types';
import { triggerDownload } from '../../services/api';

const { Text } = Typography;

const gridTheme = themeAlpine.withParams({
  rowHeight: 22,
  headerHeight: 36,
  fontSize: 12,
  cellHorizontalPadding: 6,
});

/** OLAP cube renderer.
 *  Consumes the NDJSON stream from `olap.StreamCube` via `useOlapState`,
 *  pivots the unaggregated base set client-side into a (Y rows × X column
 *  tree) layout, and renders it through AG Grid. Y dims pin left; X dims
 *  become nested column groups with a measure column per (X-path, measure)
 *  leaf. Z dims default to "all values" but can be filtered via the toolbar
 *  above the grid; measures can be enabled/disabled the same way. Pivot
 *  controls (axis swap) are still pending — task #9 follow-up. */
const OlapCubeRenderer: React.FC<ControlComponentProps> = ({ control, onAction }) => {
  const viewName = (control.viewName as string | undefined) ?? '';
  const sid = useContext(SidContext);
  const getFormValues = useContext(FormValuesContext);
  // Form values are typically empty by the time the cube mounts (the
  // server response that materialises the cube placeholder doesn't carry
  // the query form), so the stream relies on the cursor that
  // `olap.ExecuteOlap` already set up. We still pass form values along
  // for symmetry with re-stream scenarios.
  const { phase, error, meta, rows } = useOlapState(viewName, sid, getFormValues, 0);

  // The cube control sits inside the JSON UI's layout-table, whose <td>
  // sizes to content rather than filling its parent. Size the wrapper to
  // fill the viewport below its own top edge, recomputed on window resize
  // so the grid stays as tall as the visible area.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [wrapperHeight, setWrapperHeight] = useState<number>(600);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => {
      const top = el.getBoundingClientRect().top;
      // Leave a little breathing room at the bottom for status/scroll chrome.
      setWrapperHeight(Math.max(320, Math.floor(window.innerHeight - top - 12)));
    };
    update();
    window.addEventListener('resize', update);
    const ro = new ResizeObserver(update);
    ro.observe(document.documentElement);
    return () => {
      window.removeEventListener('resize', update);
      ro.disconnect();
    };
  }, [phase]);

  // Per-Z-dim selected value sets. `undefined` ⇒ "all values" (no filter).
  // We default to undefined so a cube with hundreds of distinct Z values
  // doesn't fill the dropdown unnecessarily until the user opens it.
  const [zFilter, setZFilter] = useState<Record<string, string[] | undefined>>({});
  // Set of measure names enabled for display. Initialised from meta.measures
  // (`active: true`) once meta arrives.
  const [enabledMeasures, setEnabledMeasures] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (meta && enabledMeasures.size === 0) {
      const names = meta.measures.filter((m) => m.active).map((m) => m.name);
      if (names.length > 0) setEnabledMeasures(new Set(names));
    }
  }, [meta, enabledMeasures.size]);

  // Per-dim axis assignment (task #15). Lets the user move dims between X
  // (rows), Y (columns), Z (filters), and "hidden". Initialised from
  // meta.layout when the cube loads. We keep it as a flat dim → axis map
  // and derive the {x,y,z} layout (ordered by meta.dimensions order) on
  // demand.
  type Axis = 'x' | 'y' | 'z' | 'hidden';
  const [axisAssignment, setAxisAssignment] = useState<Record<string, Axis>>({});
  useEffect(() => {
    if (!meta) return;
    const initial: Record<string, Axis> = {};
    for (const d of meta.dimensions) {
      if (meta.layout?.x?.includes(d.name)) initial[d.name] = 'x';
      else if (meta.layout?.y?.includes(d.name)) initial[d.name] = 'y';
      else if (meta.layout?.z?.includes(d.name)) initial[d.name] = 'z';
      else initial[d.name] = 'hidden';
    }
    setAxisAssignment(initial);
  }, [meta]);

  const effectiveLayout = useMemo(() => {
    const x: string[] = [];
    const y: string[] = [];
    const z: string[] = [];
    for (const d of meta?.dimensions ?? []) {
      const a = axisAssignment[d.name];
      if (a === 'x') x.push(d.name);
      else if (a === 'y') y.push(d.name);
      else if (a === 'z') z.push(d.name);
    }
    return { x, y, z };
  }, [meta, axisAssignment]);

  // Unique Z dim values (codes), one entry per Z dim. Computed once after the
  // stream completes so we don't rescan on every render.
  const zValues = useMemo(() => {
    if (!meta || rows.length === 0) return {} as Record<string, (string | null)[]>;
    const out: Record<string, (string | null)[]> = {};
    for (const z of effectiveLayout.z) {
      const idx = meta.dimsInRows.indexOf(z);
      if (idx < 0) continue;
      const set = new Set<string | null>();
      for (const r of rows) set.add(r.d[idx] ?? null);
      out[z] = [...set].sort((a, b) => (a ?? '').localeCompare(b ?? ''));
    }
    return out;
  }, [meta, rows, effectiveLayout]);

  const filteredRows = useMemo<CubeRow[]>(() => {
    if (!meta) return [];
    const zDims = effectiveLayout.z;
    const activeFilters = zDims
      .map((z) => ({ z, idx: meta.dimsInRows.indexOf(z), sel: zFilter[z] }))
      .filter((f) => f.idx >= 0 && f.sel && f.sel.length > 0);
    if (activeFilters.length === 0) return rows;
    return rows.filter((r) =>
      activeFilters.every((f) => f.sel!.includes(r.d[f.idx] ?? '')),
    );
  }, [meta, rows, zFilter, effectiveLayout]);

  const drillThrough = !!meta?.listViewName;
  const pivoted = useMemo(() => {
    if (!meta) return { rows: [] as PivotedRow[], columnDefs: [], colPaths: [], prefixPaths: new Map<string, (string | null)[]>() };
    return pivot(meta, filteredRows, { enabledMeasures, layout: effectiveLayout, drillThrough });
  }, [meta, filteredRows, enabledMeasures, effectiveLayout]);

  // Row-tree state. `expandedRowKeys` holds the `__key` of every group row
  // the user has expanded; a row is visible iff every entry in its
  // `__ancestorKeys` is in this set. Reset whenever the cube data changes
  // so stale keys from a previous pivot don't leak through.
  const [expandedRowKeys, setExpandedRowKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    setExpandedRowKeys(new Set());
  }, [pivoted]);

  const toggleRowKey = useCallback((key: string) => {
    setExpandedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const visibleRows = useMemo(() => {
    if (pivoted.rows.length === 0) return pivoted.rows;
    return pivoted.rows.filter((r) =>
      r.__ancestorKeys.every((k) => expandedRowKeys.has(k)),
    );
  }, [pivoted.rows, expandedRowKeys]);

  const gridContext = useMemo(
    () => ({ expandedKeys: expandedRowKeys, toggleKey: toggleRowKey }),
    [expandedRowKeys, toggleRowKey],
  );

  // AG Grid doesn't auto-refresh cells when `context` changes — the cell
  // renderer reads it imperatively, so we have to nudge AG Grid to re-run
  // the renderer for the row-dim columns whenever the expansion set
  // changes (the arrow glyph depends on it).
  const gridApiRef = useRef<GridApi<PivotedRow> | null>(null);
  useEffect(() => {
    const api = gridApiRef.current;
    if (!api) return;
    const dimColIds = effectiveLayout.x.map((d) => `r_${d}`);
    if (dimColIds.length > 0) {
      api.refreshCells({ force: true, columns: dimColIds });
    }
  }, [expandedRowKeys, effectiveLayout]);

  /** Drill-through. Clicking a measure cell opens the cube's listView
   *  filtered by every dim that constrains the clicked cell:
   *    – row dims pinned by the row's depth (group rows pin only their
   *      ancestors; leaf rows pin every row dim);
   *    – col dims from the leaf-column path or, for a closed-group
   *      subtotal column, the column-prefix path;
   *    – Z dims that the user has narrowed to a single value.
   *  Each constraint is sent as `dim_<name>=<code>`; the server's
   *  NavigateOlapCommand has a matching branch that bypasses the legacy
   *  HyperCubeRenderer-position decoding. */
  const handleCellClicked = useCallback(
    (e: import('ag-grid-community').CellClickedEvent<PivotedRow>) => {
      // Cube has no list view configured ⇒ no drill target.
      if (!drillThrough) return;
      const colId = e.column?.getColId() ?? '';
      // Dim-label columns aren't drillable (they ARE the row dims).
      if (!colId.startsWith('m_') && !colId.startsWith('s_')) return;
      const r = e.data;
      if (!r) return;
      const params: Record<string, string> = {};

      // Row-dim constraints — only those that actually pin the cell.
      for (let i = 0; i < r.__level; i++) {
        const dimName = effectiveLayout.x[i];
        const code = r.__row[i];
        if (code != null) params[`dim_${dimName}`] = code;
      }

      // Col-dim constraints from the column the cell lives under.
      let colPath: (string | null)[] | undefined;
      if (colId.startsWith('m_')) {
        const ci = parseInt(colId.split('_')[1] ?? '', 10);
        if (Number.isFinite(ci)) colPath = pivoted.colPaths[ci];
      } else {
        // s_<prefixKey>_<measureName> — measure name is the last segment.
        const lastUnderscore = colId.lastIndexOf('_');
        const prefixKey = colId.substring(2, lastUnderscore);
        colPath = pivoted.prefixPaths.get(prefixKey);
      }
      if (colPath) {
        for (let i = 0; i < colPath.length; i++) {
          const dimName = effectiveLayout.y[i];
          const code = colPath[i];
          if (code != null) params[`dim_${dimName}`] = code;
        }
      }

      // Z-dim constraints: only when the filter is narrowed to a single
      // value (otherwise it's an OR-set, not a single cell coordinate).
      for (const zDim of effectiveLayout.z) {
        const sel = zFilter[zDim];
        if (sel && sel.length === 1) params[`dim_${zDim}`] = sel[0];
      }

      onAction('olap.NavigateOlap', params);
    },
    [drillThrough, effectiveLayout, pivoted.colPaths, pivoted.prefixPaths, zFilter, onAction],
  );

  if (phase === 'error') {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="error" message="Errore nel caricamento del cubo" description={error} />
      </div>
    );
  }

  // Until the stream finishes we only have meta + accumulating rows; mounting
  // AG Grid with empty data triggers its "No Rows To Show" overlay which
  // doesn't auto-clear after the late row commit. Show a spinner instead and
  // let the grid mount once with the final dataset.
  if (phase !== 'ready') {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spin tip={meta ? 'Streaming cubo…' : 'Caricamento cubo…'} />
      </div>
    );
  }

  return (
    <div ref={wrapperRef} style={{ display: 'flex', flexDirection: 'column', height: wrapperHeight }}>
      <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Text strong>{meta?.title || meta?.viewName}</Text>
        <Text type="secondary">
          {visibleRows.length} righe visibili / {pivoted.rows.length} totali / {filteredRows.length} dettagli
          {filteredRows.length !== rows.length && ` (di ${rows.length})`}
        </Text>
        {effectiveLayout.z.map((zDim) => {
          const dim = meta!.dimensions.find((d) => d.name === zDim);
          const codes = zValues[zDim] ?? [];
          return (
            <Select
              key={zDim}
              mode="multiple"
              size="small"
              allowClear
              maxTagCount={2}
              style={{ minWidth: 200, maxWidth: 360 }}
              placeholder={dim?.description || zDim}
              value={zFilter[zDim] ?? []}
              onChange={(vals: string[]) =>
                setZFilter((prev) => ({ ...prev, [zDim]: vals.length > 0 ? vals : undefined }))
              }
              options={codes.map((c) => ({
                value: c ?? '',
                label: c == null ? '(vuoto)' : (dim?.values?.[c] ?? c),
              }))}
            />
          );
        })}
        {meta && (
          <Popover
            trigger="click"
            placement="bottomLeft"
            title="Layout pivot"
            content={
              <div style={{ minWidth: 280 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', columnGap: 12, rowGap: 6 }}>
                  {meta.dimensions.map((d) => (
                    <React.Fragment key={d.name}>
                      <span style={{ alignSelf: 'center' }}>{d.description || d.name}</span>
                      <Select
                        size="small"
                        style={{ width: 140 }}
                        value={axisAssignment[d.name] ?? 'hidden'}
                        onChange={(v: Axis) =>
                          setAxisAssignment((prev) => ({ ...prev, [d.name]: v }))
                        }
                        options={[
                          { value: 'x', label: 'Righe (X)' },
                          { value: 'y', label: 'Colonne (Y)' },
                          { value: 'z', label: 'Filtri (Z)' },
                          { value: 'hidden', label: 'Nascosta' },
                        ]}
                      />
                    </React.Fragment>
                  ))}
                </div>
                <div style={{ borderTop: '1px solid #f0f0f0', margin: '10px 0 8px', paddingTop: 8, fontWeight: 500, fontSize: 12, color: '#666' }}>
                  Misure
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {meta.measures.map((m) => (
                    <Checkbox
                      key={m.name}
                      checked={enabledMeasures.has(m.name)}
                      onChange={(e) => {
                        setEnabledMeasures((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(m.name);
                          else next.delete(m.name);
                          return next;
                        });
                      }}
                    >
                      {m.description || m.name}
                    </Checkbox>
                  ))}
                </div>
              </div>
            }
          >
            <Button size="small" icon={<LayoutOutlined />}>Layout</Button>
          </Popover>
        )}
        {meta && (
          <Button
            size="small"
            icon={<FileExcelOutlined />}
            onClick={() => triggerDownload('olap.HyperCubeXLS', {}, sid, `${meta.viewName}.xlsx`)}
          >
            XLSX
          </Button>
        )}
        {meta && (
          <Button
            size="small"
            icon={<FileTextOutlined />}
            onClick={() => triggerDownload('olap.OlapCSV', {}, sid, `${meta.viewName}.csv`)}
          >
            CSV
          </Button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <AgGridReact<PivotedRow>
            theme={gridTheme}
            modules={[AllCommunityModule]}
            rowData={visibleRows}
            columnDefs={pivoted.columnDefs}
            defaultColDef={{ resizable: true, sortable: true, filter: true }}
            animateRows={false}
            context={gridContext}
            getRowId={(p) => p.data.__key}
            onGridReady={(params) => { gridApiRef.current = params.api; }}
            onCellClicked={handleCellClicked}
          />
        </div>
      </div>
    </div>
  );
};

export default OlapCubeRenderer;
