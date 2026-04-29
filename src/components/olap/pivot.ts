import React from 'react';
import type { ColDef, ColGroupDef, ICellRendererParams } from 'ag-grid-community';
import type { CubeMeas, CubeMeta, CubeRow } from './types';
import { evalCalc } from './evalCalc';

export interface PivotedRow {
  /** Row-axis dim values (codes), padded to `rowDims.length` with nulls past
   *  the row's own depth (group rows). */
  __row: (string | null)[];
  /** Tree depth, 1 = top-level group, `rowDims.length` = leaf. */
  __level: number;
  /** Stable key for this row (hash of its row-prefix path). */
  __key: string;
  /** Parent's `__key`, undefined for top-level rows. */
  __parentKey?: string;
  /** Keys of all ancestors, root → parent. The visible-row filter uses this
   *  to test whether every ancestor is expanded. */
  __ancestorKeys: string[];
  /** True when this row has at least one direct child row. Drives the
   *  expand/collapse arrow in the row-dim cell renderer. */
  __hasChildren: boolean;
  /** Dynamic measure cells: leaf cells `m_${ci}_${measure}` and column
   *  subtotals `s_${colPrefixKey}_${measure}`. Group rows hold aggregated
   *  values across all their leaf descendants. */
  [k: string]: unknown;
}

export interface PivotResult {
  rows: PivotedRow[];
  columnDefs: (ColDef | ColGroupDef)[];
  /** Column dim values per leaf-column index. `colPaths[ci]` is parallel
   *  to `meta.layout.y`. Drill-through reads this to constrain the target
   *  list view by the clicked cell's column dims. */
  colPaths: (string | null)[][];
  /** Column-prefix path lookup: maps the prefix key (the SEP-joined dim
   *  values up to depth N) → the (string|null)[] dim values. Used for
   *  drill-through on subtotal cells emitted under closed column groups. */
  prefixPaths: Map<string, (string | null)[]>;
}

const SEP = '\x1f';

const pathKey = (path: (string | null)[]): string =>
  path.map((v) => v ?? '').join(SEP);

/** Pivot the unaggregated base set into row × column-tree cells.
 *  CORE's `HyperCubeRenderer` puts X dims down the left (one row per X-path)
 *  and Y dims across the top (nested column groups). We follow that wiring
 *  even though it's the inverse of the spreadsheet convention, so the React
 *  view stays visually identical to the legacy HTML cube. Z dims are
 *  aggregated over (no Z filter UI yet — task #9).
 *
 *  For row-axis collapsibility (task #14) we emit synthetic group rows at
 *  each row-dim depth: a leaf at rowPath [A, X, Cli] also produces parent
 *  rows [A] and [A, X], each holding the aggregated measures for its
 *  subtree. The renderer hides children of collapsed groups in the
 *  consumer (`OlapCubeRenderer`) using `__ancestorKeys` and an
 *  `expandedKeys` set — there's no AG Grid Community treeData feature, so
 *  we manage it ourselves.
 *
 *  Aggregation is currently SUM regardless of the measure's declared type.
 *  Non-composable measures (AVG / COUNT_DISTINCT / STDDEV / VARIANCE) need
 *  a server refetch at the projected granularity — that lands in task #10. */
export interface PivotOptions {
  enabledMeasures?: Set<string>;
  /** Layout override — when supplied, replaces `meta.layout`. Lets the
   *  consumer reassign dims between X / Y / Z (task #15) without mutating
   *  the meta packet from the server. */
  layout?: { x: string[]; y: string[]; z: string[] };
  /** When true, measure cells render with a pointer cursor to advertise
   *  drill-through. Off by default and disabled by the consumer when
   *  `meta.listViewName` is absent. */
  drillThrough?: boolean;
}

export function pivot(
  meta: CubeMeta,
  baseRows: CubeRow[],
  options?: PivotOptions,
): PivotResult {
  const layout = options?.layout ?? meta.layout;
  const enabledMeasures = options?.enabledMeasures;
  const drillThrough = !!options?.drillThrough;
  const rowDims = layout?.x ?? [];
  const colDims = layout?.y ?? [];
  const dimIdx = (name: string) => meta.dimsInRows.indexOf(name);
  const rowDimIdxs = rowDims.map(dimIdx);
  const colDimIdxs = colDims.map(dimIdx);
  const activeMeasures = enabledMeasures
    ? meta.measures.filter((m) => enabledMeasures.has(m.name))
    : meta.measures.filter((m) => m.active);
  // Calc measures are not summed — their pre-evaluated values arrive per
  // base row but aggregating them is meaningless (e.g. summing avg-prices).
  // We re-evaluate from aggregated base measures per output cell at the end.
  const baseMeasures = activeMeasures.filter((m) => !m.calculation);
  const calcMeasures = activeMeasures.filter((m) => !!m.calculation);

  type Bucket = {
    rowPath: (string | null)[];
    colPath: (string | null)[];
    sums: number[];
  };
  const buckets = new Map<string, Bucket>();
  for (const r of baseRows) {
    const rowPath = rowDimIdxs.map((i) => (i >= 0 ? r.d[i] ?? null : null));
    const colPath = colDimIdxs.map((i) => (i >= 0 ? r.d[i] ?? null : null));
    const k = pathKey(rowPath) + '||' + pathKey(colPath);
    let b = buckets.get(k);
    if (!b) {
      b = { rowPath, colPath, sums: new Array(baseMeasures.length).fill(0) };
      buckets.set(k, b);
    }
    baseMeasures.forEach((m, mi) => {
      const origIdx = meta.measures.indexOf(m);
      const v = r.m[origIdx];
      if (v != null) {
        const n = typeof v === 'number' ? v : Number(v);
        if (Number.isFinite(n)) b!.sums[mi] += n;
      }
    });
  }

  // Collect & sort unique col paths.
  const cmpPath = (a: (string | null)[], b: (string | null)[]) => {
    for (let i = 0; i < a.length; i++) {
      const va = a[i] ?? '';
      const vb = b[i] ?? '';
      if (va < vb) return -1;
      if (va > vb) return 1;
    }
    return 0;
  };
  const colByKey = new Map<string, (string | null)[]>();
  for (const b of buckets.values()) colByKey.set(pathKey(b.colPath), b.colPath);
  const colPaths = [...colByKey.values()].sort(cmpPath);
  const colIndex = new Map<string, number>();
  colPaths.forEach((p, i) => colIndex.set(pathKey(p), i));

  // Build row tree. Each bucket contributes to every row-prefix length 1..N
  // (where N = rowDims.length). For each (rowPrefix, colPath) pair we
  // accumulate the leaf cell `m_${ci}_${measure}`, plus subtotals at every
  // col-prefix `s_${colPrefixKey}_${measure}`. Group rows therefore have
  // aggregated measures across their full subtree — both at individual leaf
  // columns and at every collapsed-column-group subtotal.
  const rowsByKey = new Map<string, PivotedRow>();
  // Per-row: which leaf-column indexes and column-prefix keys received any
  // contribution. Used to drive calc-measure re-evaluation only over real
  // cells, since calc values must be derived from aggregated base sums and
  // not summed across buckets like base measures are.
  const rowLeaves = new Map<string, Set<number>>();
  const rowPrefixes = new Map<string, Set<string>>();
  for (const b of buckets.values()) {
    const ci = colIndex.get(pathKey(b.colPath))!;
    for (let D = 1; D <= rowDims.length; D++) {
      const slice = b.rowPath.slice(0, D);
      const key = pathKey(slice);
      let row = rowsByKey.get(key);
      if (!row) {
        const padded: (string | null)[] = [...slice];
        while (padded.length < rowDims.length) padded.push(null);
        const ancestorKeys: string[] = [];
        for (let A = 1; A < D; A++) ancestorKeys.push(pathKey(slice.slice(0, A)));
        row = {
          __row: padded,
          __level: D,
          __key: key,
          __parentKey: D > 1 ? ancestorKeys[ancestorKeys.length - 1] : undefined,
          __ancestorKeys: ancestorKeys,
          __hasChildren: D < rowDims.length,
        };
        rowsByKey.set(key, row);
        rowLeaves.set(key, new Set());
        rowPrefixes.set(key, new Set());
      }
      rowLeaves.get(key)!.add(ci);
      baseMeasures.forEach((m, mi) => {
        const v = b.sums[mi];
        const lf = `m_${ci}_${m.name}`;
        row![lf] = ((row![lf] as number | undefined) ?? 0) + v;
        for (let L = 0; L < colDims.length; L++) {
          const pkey = pathKey(b.colPath.slice(0, L + 1));
          rowPrefixes.get(key)!.add(pkey);
          const f = `s_${pkey}_${m.name}`;
          row![f] = ((row![f] as number | undefined) ?? 0) + v;
        }
      });
    }
  }

  // Calc-measure pass: for every row × cell, derive base measure values from
  // already-summed base fields and feed them to evalCalc. Aggregation cells
  // (subtotals at column-prefix keys) get the same treatment — their inputs
  // are already aggregated base sums, so the AST yields the correctly
  // re-aggregated calculated value.
  if (calcMeasures.length > 0) {
    for (const [key, row] of rowsByKey) {
      const baseValsAt = (suffix: string): Record<string, number | null> => {
        const out: Record<string, number | null> = {};
        for (const bm of baseMeasures) {
          const v = row[`${suffix}${bm.name}`] as number | undefined;
          out[bm.name] = v == null ? null : v;
        }
        return out;
      };
      for (const ci of rowLeaves.get(key)!) {
        const base = baseValsAt(`m_${ci}_`);
        for (const cm of calcMeasures) {
          row[`m_${ci}_${cm.name}`] = evalCalc(cm.calculation?.ast, base);
        }
      }
      for (const pkey of rowPrefixes.get(key)!) {
        const base = baseValsAt(`s_${pkey}_`);
        for (const cm of calcMeasures) {
          row[`s_${pkey}_${cm.name}`] = evalCalc(cm.calculation?.ast, base);
        }
      }
    }
  }

  // Sort rows in tree pre-order: padded __row lex sort puts ancestors before
  // descendants at any divergence (null sorts before any non-empty value),
  // and the __level tiebreaker keeps a parent before a leaf with the same
  // padded path (e.g. group [A, null, null] before leaf [A, null, null] in
  // a cube with all-null deeper dims).
  const rows = [...rowsByKey.values()].sort((a, b) => {
    const c = cmpPath(a.__row, b.__row);
    return c !== 0 ? c : a.__level - b.__level;
  });
  // Backfill __hasChildren: a node has children if any other row lists it as
  // an ancestor. We already set __hasChildren = (D < rowDims.length) above,
  // but a parent might have no actual children (sparse data) — recheck.
  const seenParents = new Set<string>();
  for (const r of rows) for (const a of r.__ancestorKeys) seenParents.add(a);
  for (const r of rows) {
    if (r.__hasChildren && !seenParents.has(r.__key)) r.__hasChildren = false;
  }

  // Build columnDefs.
  const decodeDim = (dimName: string, code: string | null): string => {
    if (code == null) return '';
    const dim = meta.dimensions.find((d) => d.name === dimName);
    return dim?.values?.[code] ?? code;
  };

  const columnDefs: (ColDef | ColGroupDef)[] = [];

  // Pinned-left row-dim columns. Each row only renders its value in the
  // column matching its own depth — the columns above are blank, so the
  // visible position of the value implicitly conveys tree depth without
  // needing rowSpan (which AG Grid Community lacks). The expand/collapse
  // arrow lives in the same cell.
  rowDims.forEach((dimName, depth) => {
    const dim = meta.dimensions.find((d) => d.name === dimName);
    columnDefs.push({
      headerName: dim?.description || dimName,
      colId: `r_${dimName}`,
      pinned: 'left',
      // Row-dim columns carry the pivot's row hierarchy and the
      // expand/collapse arrow; reordering or unpinning them breaks the
      // tree layout (AG Grid would render the arrow column away from the
      // value column it labels). Lock them in place.
      suppressMovable: true,
      lockPinned: true,
      lockPosition: true,
      valueGetter: (p) => {
        const r = p.data as PivotedRow | undefined;
        if (!r) return '';
        if (r.__level - 1 !== depth) return '';
        return decodeDim(dimName, r.__row[depth] ?? null);
      },
      cellRenderer: RowDimCell,
      cellRendererParams: { dimDepth: depth },
      minWidth: 140,
      maxWidth: 320,
    } as ColDef<PivotedRow>);
  });

  // Column tree (or flat measure columns when colDims is empty).
  if (colDims.length === 0) {
    activeMeasures.forEach((m) => columnDefs.push(measureColumn(m, 'm_0', m.name, drillThrough)));
  } else {
    columnDefs.push(
      ...buildColTree(colPaths, 0, colPaths.length, 0, colDims, decodeDim, activeMeasures, drillThrough),
    );
  }

  // Materialise the prefix-path table for drill-through. Subtotal cells
  // carry colId `s_<prefixKey>_<measure>`; consumers reverse-lookup the
  // dim values for the clicked prefix here.
  const prefixPaths = new Map<string, (string | null)[]>();
  for (const p of colPaths) {
    for (let L = 0; L < colDims.length; L++) {
      const slice = p.slice(0, L + 1);
      const k = pathKey(slice);
      if (!prefixPaths.has(k)) prefixPaths.set(k, slice);
    }
  }

  return { rows, columnDefs, colPaths, prefixPaths };
}

interface RowDimContext {
  expandedKeys: Set<string>;
  toggleKey: (key: string) => void;
}

type RowDimRendererProps = ICellRendererParams<PivotedRow> & {
  context?: RowDimContext;
  dimDepth: number;
};

/** Renders a row-dim cell. Returns null for any column other than the row's
 *  own depth, and the expand/collapse arrow + value for the matching one. */
const RowDimCell: React.FC<RowDimRendererProps> = (params) => {
  const r = params.data;
  if (!r) return null;
  if (r.__level - 1 !== params.dimDepth) return null;
  const expanded = params.context?.expandedKeys?.has(r.__key) ?? false;
  const onArrowClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    params.context?.toggleKey?.(r.__key);
  };
  const arrow = r.__hasChildren
    ? React.createElement(
        'span',
        {
          onClick: onArrowClick,
          style: { width: 14, flex: '0 0 auto', textAlign: 'center', cursor: 'pointer' },
        },
        expanded ? '▼' : '▶',
      )
    : React.createElement('span', { style: { width: 14, flex: '0 0 auto' } });
  const text = React.createElement(
    'span',
    {
      style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    },
    String(params.value ?? ''),
  );
  return React.createElement(
    'span',
    {
      style: { display: 'flex', alignItems: 'center', gap: 4 },
    },
    arrow,
    text,
  );
};

function buildColTree(
  colPaths: (string | null)[][],
  start: number,
  end: number,
  depth: number,
  colDims: string[],
  decodeDim: (dim: string, code: string | null) => string,
  measures: CubeMeas[],
  drillThrough: boolean,
): (ColDef | ColGroupDef)[] {
  if (depth === colDims.length) {
    return measures.map((m) => measureColumn(m, `m_${start}`, m.name, drillThrough));
  }
  const isLeafGroup = depth === colDims.length - 1;
  const groups: ColGroupDef[] = [];
  let i = start;
  while (i < end) {
    const v = colPaths[i][depth];
    let j = i + 1;
    while (j < end && colPaths[j][depth] === v) j++;
    const dimName = colDims[depth];
    const label = decodeDim(dimName, v);
    const prefixKey = pathKey(colPaths[i].slice(0, depth + 1));

    let children: (ColDef | ColGroupDef)[];
    if (isLeafGroup) {
      children = measures.map((m) => measureColumn(m, `s_${prefixKey}`, m.name, drillThrough));
    } else {
      children = [];
      measures.forEach((m) => {
        const col = measureColumn(m, `s_${prefixKey}`, m.name, drillThrough);
        col.columnGroupShow = 'closed';
        children.push(col);
      });
      const inner = buildColTree(colPaths, i, j, depth + 1, colDims, decodeDim, measures, drillThrough);
      inner.forEach((c) => {
        children.push({ ...(c as object), columnGroupShow: 'open' } as ColDef | ColGroupDef);
      });
    }

    groups.push({
      headerName: label || '(vuoto)',
      groupId: `${dimName}|${i}|${j}`,
      openByDefault: false,
      children,
    });
    i = j;
  }
  return groups;
}

function measureColumn(
  m: CubeMeas,
  fieldPrefix: string,
  measureName: string,
  drillThrough: boolean,
): ColDef<PivotedRow> {
  const field = `${fieldPrefix}_${measureName}`;
  return {
    colId: field,
    field,
    headerName: m.description || m.name,
    type: 'numericColumn',
    valueFormatter: (p) => formatMeasure(p.value, m.format),
    cellStyle: drillThrough ? { cursor: 'pointer' } : undefined,
    minWidth: 110,
  };
}

function formatMeasure(value: unknown, format?: string): string {
  if (value == null) return '';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  const decimals = format ? (format.split('.')[1]?.length ?? 0) : 2;
  return n.toLocaleString('it-IT', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
