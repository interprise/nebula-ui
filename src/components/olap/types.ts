/** AST node for calculated measures (mirror of CORE `CalculationAST.serialize`).
 *  The client evaluator (task #8) walks this tree per cell. */
export type CalcAst =
  | { kind: 'atom'; token: string }
  | { kind: 'num'; token: string }
  | { kind: 'op'; token: string; args?: CalcAst[] }
  | { kind: 'fn'; token: string; args?: CalcAst[] }
  | { kind: 'unknown'; token: string; args?: CalcAst[] }
  | { kind: 'null' };

export interface CubeDim {
  name: string;
  description?: string;
  navigateViewName?: string;
  active: boolean;
  position?: 'X' | 'Y' | 'Z';
  /** Decoding map: dim value code → human-readable description. Sent once
   *  in the meta line so rows can carry compact codes only. */
  values: Record<string, string>;
}

export interface CubeMeas {
  name: string;
  description?: string;
  format?: string;
  /** SUM | COUNT | COUNT_DISTINCT | MIN | MAX | AVG | STDDEV | VARIANCE | NONE | GROUP_BY.
   *  Drives composability for client-side projection: SUM/MIN/MAX/COUNT
   *  are composable; AVG/COUNT_DISTINCT/STDDEV/VARIANCE are not. */
  aggregateType?: string;
  active: boolean;
  calculation?: { expr: string; ast: CalcAst };
}

export interface CubeMeta {
  kind: 'meta';
  viewName: string;
  title?: string;
  layout: { x: string[]; y: string[]; z: string[] };
  dimensions: CubeDim[];
  /** Names of the dim columns actually present in each row's `d` array,
   *  in row order. Equals all cube dims for the default initial fetch;
   *  a subset when `visibleDims` was passed to the streaming endpoint. */
  dimsInRows: string[];
  measures: CubeMeas[];
  filters: Record<string, string>;
  splitCells?: boolean;
  /** Target view name for drill-through navigation. Absent when the cube
   *  has no associated list view — the React UI then suppresses the cell
   *  click affordance. */
  listViewName?: string;
}

export interface CubeRow {
  kind: 'row';
  /** Dim value codes, indexed parallel to `meta.dimsInRows`. */
  d: (string | null)[];
  /** Measure values, indexed parallel to `meta.measures`. */
  m: (number | null)[];
}

export interface CubeEnd {
  kind: 'end';
}

export interface CubeError {
  kind: 'error';
  message: string;
}

export interface CubeValues {
  kind: 'values';
  dim: string;
  values: Record<string, string>;
}

export type StreamLine = CubeMeta | CubeRow | CubeEnd | CubeError | CubeValues;

const COMPOSABLE = new Set(['SUM', 'MIN', 'MAX', 'COUNT']);

/** True when a measure can be re-aggregated client-side from rows at
 *  finer granularity. Non-composable measures (AVG, COUNT_DISTINCT, etc.)
 *  require a server refetch when display granularity drops. */
export function isComposable(m: CubeMeas): boolean {
  if (m.aggregateType == null) return true; // calculated measures compose if their inputs do
  return COMPOSABLE.has(m.aggregateType);
}
