import React, { useMemo, useCallback, useRef, useEffect, useState, useLayoutEffect, useContext } from 'react';
import { fixServerHtml } from '../services/serverHtml';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, type ColDef, type RowClickedEvent, type ICellRendererParams, type CellValueChangedEvent, type GridApi, themeAlpine } from 'ag-grid-community';
import { Button, Pagination, Space, Tooltip, Typography } from 'antd';
import { PlusOutlined, RightOutlined, FileExcelOutlined, PrinterOutlined, ExpandOutlined, CompressOutlined, ColumnWidthOutlined, ColumnHeightOutlined } from '@ant-design/icons';
import type { UITree, UIRow, UICell, UIControl, ListHeader, ListAction, ListColumn, ListRecord, RowEditData } from '../types/ui';
import { ELTYPE_PROMPT, ELTYPE_CONTENT, ELTYPE_SELECTOR, ELTYPE_SECTION_HEADER, ELTYPE_DUMMY } from '../types/ui';
import { getControl, isCellRenderable } from '../controls/registry';
import { SidContext, TitleInBreadcrumbContext, SplitAreaContext, InTabPanelContext, useIsTabLabelEcho } from './ViewRenderer';
import { useUiMode } from '../hooks/uiMode';
import { gridFontSizePx } from '../hooks/density';
import { useHotkey, HotkeyPriority } from '../hooks/hotkeys';
import { buildColumnFieldName, resolveReloadNavpath } from './listEditPosting';
import {
  getCellEditorForType,
  isBooleanType,
  cellEditorComponents,
} from '../controls/cellEditors';

const { Text } = Typography;

/** Ref-based sort dispatch — shared between custom headers and ListRenderer */
type SortDispatch = (sortExpression: string) => void;
const sortDispatchRef = { current: null as SortDispatch | null };
const toggleItemDispatchRef = { current: null as ((itemId: string) => void) | null };

/** Last-selected record path per list, keyed by tab(sid)+view. Survives the
 *  ListRenderer remount that happens when navigating into a detail and back,
 *  so the originating row can be re-highlighted and scrolled into view on
 *  return (item 5455.1C). */
const lastSelectedByView = new Map<string, string>();

/** Custom header for server-sorted columns — dispatches SortColumn without AG Grid's sort.
 *  Also renders a configureIcon (green/red dot) when in configuring mode. */
const ServerSortHeader = (props: {
  displayName: string;
  sortExpression?: string;
  sortDir?: string;
  configureIcon?: { included: boolean; itemId: string };
  /** Colonna allineata a destra (money/number). AG Grid allinea l'intestazione
   *  con `.ag-right-aligned-header .ag-header-cell-text`, un selettore che
   *  esiste solo per l'intestazione DI SERIE: con un headerComponent proprio
   *  (liste ordinate dal server, o colonna con configureIcon) quella regola non
   *  aggancia nulla e il nome colonna resta a sinistra sopra dati allineati a
   *  destra (SXADV-5736.2). Ci allineiamo qui, come fa AG Grid: `row-reverse`,
   *  che impacchetta a destra e porta l'indicatore di ordinamento a sinistra
   *  dell'etichetta. */
  alignRight?: boolean;
}) => {
  const { displayName, sortExpression, sortDir, configureIcon, alignRight } = props;
  const icon = configureIcon && (
    <span
      className={`configure-icon ${configureIcon.included ? 'configure-on' : 'configure-off'}`}
      title={configureIcon.included ? 'Colonna inclusa - clicca per escludere' : 'Colonna esclusa - clicca per includere'}
      onClick={(e) => {
        e.stopPropagation();
        toggleItemDispatchRef.current?.(configureIcon.itemId);
      }}
      style={{ cursor: 'pointer', fontSize: 13, marginLeft: 4 }}
    >
      {configureIcon.included ? '●' : '✕'}
    </span>
  );
  if (!sortExpression) {
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        flexDirection: alignRight ? 'row-reverse' : 'row',
        width: alignRight ? '100%' : undefined,
        textAlign: alignRight ? 'right' : undefined,
      }}>
        <span>{displayName}</span>
        {icon}
      </span>
    );
  }
  return (
    <div
      style={{
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        width: '100%',
        userSelect: 'none',
        flexDirection: alignRight ? 'row-reverse' : 'row',
        textAlign: alignRight ? 'right' : undefined,
      }}
      onClick={() => sortDispatchRef.current?.(sortExpression)}
    >
      <span>{displayName}</span>
      {sortDir === 'asc' && <span style={{ fontSize: 10 }}>&#9650;</span>}
      {sortDir === 'desc' && <span style={{ fontSize: 10 }}>&#9660;</span>}
      {icon}
    </div>
  );
};

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

/** Parse a CSS inline-style string ("text-align:right;font-weight:bold") into a
 *  React/AG-Grid style object with camelCased keys. Used to apply per-cell
 *  ViewItem contentStyle (alignment, font, background) to grid cells. */
function parseInlineStyle(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of css.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const val = decl.slice(i + 1).trim();
    if (!prop || !val) continue;
    const camel = prop.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
    out[camel] = val;
  }
  return out;
}

/** Minimum pixel width needed to show a header label in a padded grid cell.
 *  Measures the real rendered width (canvas, actual grid font) instead of the
 *  previous ~6.3px-per-char estimate: glyph metrics drift from any per-char
 *  constant — most visibly under browser zoom, where font rasterization
 *  changes a string's CSS-px width by a few pixels — so borderline header
 *  labels flipped between fitting and being ellipsized depending on the zoom
 *  level (item 5455.2, reopened). Measured width + padding + slack keeps them
 *  visible at any zoom. */
const HEADER_LABEL_PAD = 8;  // 4px horizontal cell padding per side
const HEADER_LABEL_SLACK = 6; // absorbs zoom-dependent rasterization drift
let headerMeasureCtx: CanvasRenderingContext2D | null | undefined;
let headerMeasureFont: { size: number; font: string } | null = null;
function headerLabelMinWidth(text: string): number {
  if (!text) return HEADER_LABEL_PAD;
  if (headerMeasureCtx === undefined) {
    headerMeasureCtx = document.createElement('canvas').getContext('2d');
  }
  if (!headerMeasureCtx) {
    // Canvas unavailable — fall back to the old estimate
    return Math.round(text.length * 6.3) + 10;
  }
  // Il corpo non e' piu' fisso: lo decide la densita' scelta dall'utente
  // (SXADV-5745), e misurare con un corpo diverso da quello disegnato rimette
  // in gioco proprio l'ellissi che questa misura serviva a togliere. La cache
  // e' quindi chiusa a chiave sul corpo — `getComputedStyle` si paga solo al
  // cambio. Il family (stack Inter) e' condiviso da tema griglia e body, quindi
  // il valore calcolato del body fa fede. Una lista GIA' aperta conserva le
  // larghezze misurate prima del cambio finche' non si ridisegna: si riallinea
  // alla prima navigazione o al primo caricamento dati.
  const size = gridFontSizePx();
  if (!headerMeasureFont || headerMeasureFont.size !== size) {
    headerMeasureFont = {
      size,
      font: `700 ${size}px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`,
    };
  }
  headerMeasureCtx.font = headerMeasureFont.font;
  return Math.ceil(headerMeasureCtx.measureText(text).width) + HEADER_LABEL_PAD + HEADER_LABEL_SLACK;
}

/* Grid vertical density (SXADV-5742) --------------------------------------
 * A record that wraps costs main row + one continuation row, so every pixel
 * here is paid TWICE per record — which is why lists of wrapped records felt
 * so much emptier than the legacy ones. Kept as named constants because the
 * three heights have to agree: the continuation renderer and getRowHeight set
 * their own heights outside AG Grid's theme.
 *
 * 19px at 12px/16px text is the floor before descenders start touching the row
 * border; the AG Grid theme param alone doesn't get there, because AG Grid's own
 * stylesheet sizes `.ag-cell` at 14px regardless of --ag-font-size (see the
 * `.ag-cell` rule in global.css). */
// Main rows: AG Grid floors normal (non-full-width) rows at 22px here. Measured
// — the theme param, the `rowHeight` grid option and a `getRowHeight` returning
// 19 all get clamped back up to 22, so 22 is what this is worth asking for.
// Full-width rows are NOT clamped, which is why the continuation row (the one a
// wrapped record pays a second time) is where the height was actually won.
const GRID_ROW_HEIGHT = 22;
const GRID_CONTINUATION_ROW_HEIGHT = 18;
/** Continuation rows holding an interactive control need to fit it — at 18px an
 *  antd small Select (24px) bled over the row below, and on lists where EVERY
 *  record carries such a control (Fatture: the "Stampa" selector) that row is
 *  the whole record's height. The `.ag-full-width-row` rules in global.css take
 *  those controls down to 18px so 20 is enough. */
const GRID_CONTINUATION_CONTROL_ROW_HEIGHT = 20;
const GRID_HEADER_HEIGHT = 28;

/** Column header labels wrap instead of being cut with an ellipsis, and the
 *  header row grows to fit the tallest of them — what the legacy HTML `<th>`
 *  did, and what a two-word label like "Importo Spese R" needs in a column
 *  sized for its longest WORD (see headerLabelMinWidth, which is the minimum
 *  the widths are fitted to). AG Grid keeps the configured 28px as the floor,
 *  so single-line headers are unchanged (SXADV-5770.1A/1B). */
const WRAPPING_HEADER_COLDEF: Pick<ColDef, 'wrapHeaderText' | 'autoHeaderHeight'> = {
  wrapHeaderText: true,
  autoHeaderHeight: true,
};

/** Cell content that must NOT wrap: values that are a single token in a column
 *  already sized to fit them (numbers, dates, flags) and the interactive ones,
 *  where a taller row buys nothing. Everything else wraps and the row grows with
 *  it, the way a legacy list `<td>` did — a truncated description is worse than
 *  a two-line record (SXADV-5770.2). */
const NO_WRAP_CONTENT_TYPES = new Set([
  'money', 'number', 'date', 'time', 'timestamp', 'durata',
  'boolean', 'checkbox', 'button', 'action', 'windowButton',
  'navigateView', 'add', 'upload', 'download', 'barcode',
]);

/* Adaptive page size (SXADV-5742). Bounds mirror SetPageSizeCommand's, which is
 * the authority — these only keep the client from asking for something the
 * server would clamp anyway. */
const MIN_ADAPTIVE_PAGE_SIZE = 20;   // ToolView.STD_PAGE_SIZE
const MAX_ADAPTIVE_PAGE_SIZE = 100;  // server caps at 200; stay well under it
/** Rows of difference below which a resize isn't worth a round-trip. */
const ADAPTIVE_PAGE_SIZE_HYSTERESIS = 3;

const gridTheme = themeAlpine.withParams({
  rowHeight: GRID_ROW_HEIGHT,
  headerHeight: GRID_HEADER_HEIGHT,
  fontSize: 12,
  cellHorizontalPadding: 4,
});

// Cell renderer for HTML content (addresses, contacts, etc.)
const HtmlCellRenderer = (params: ICellRendererParams) => {
  const val = params.value;
  if (!val) return null;
  return <span dangerouslySetInnerHTML={{ __html: fixServerHtml(val) }} />;
};

// Render a boolean column as server-decoded text (from BOOLEAN_CODE_TABLE)
// instead of AG Grid's default checkbox. The checkbox belongs to the
// cell editor (agCheckboxCellEditor) which only activates during editing;
// the rest of the time we just want the decoded text.
const BooleanTextRenderer = (params: ICellRendererParams) => {
  const field = params.colDef?.field;
  if (!field) return null;
  const idx = field.replace('col_', '');
  const display = params.data?.[`_display_${idx}`] as string | undefined;
  if (display !== undefined && display !== '') return display;
  const v = params.value;
  if (typeof v === 'string') return v;
  if (v === true) return 'Sì';
  if (v === false) return 'No';
  return '';
};

// Record-SELECTION multiEdit boolean column: an always-interactive checkbox on
// every EDITABLE row (per-row editability = _editable_${idx} && _prop_${dynPropKey}),
// so many records can be checked at once and posted in a single multi-row Save.
// Toggling updates the row value and re-pushes the whole column to formValues via
// the grid context (onBoolToggle). Non-editable rows fall back to decoded text.
type BoolToggleContext = {
  onBoolToggle?: (colIdx: number, node: unknown, checked: boolean, colMeta?: Record<string, unknown>) => void;
};
const MultiEditCheckboxRenderer = (
  params: ICellRendererParams & { dynPropKey?: string | null; colIdx?: number; colMeta?: Record<string, unknown> }
) => {
  const field = params.colDef?.field;
  if (!field) return null;
  const idx = field.replace('col_', '');
  const editableFlag = !!params.data?.[`_editable_${idx}`];
  const dynOk = params.dynPropKey ? !!params.data?.[`_prop_${params.dynPropKey}`] : true;
  const checked = params.value === true;
  if (!editableFlag || !dynOk) {
    const display = params.data?.[`_display_${idx}`] as string | undefined;
    return <>{display ?? (checked ? 'Sì' : params.value === false ? 'No' : '')}</>;
  }
  const ctx = params.context as BoolToggleContext;
  return (
    <input
      type="checkbox"
      checked={checked}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => ctx.onBoolToggle?.(params.colIdx ?? Number(idx), params.node, e.target.checked, params.colMeta)}
      style={{ cursor: 'pointer', width: 16, height: 16 }}
    />
  );
};

// For editable columns whose value is a key (remote combos, lookups...) but
// the server also emits a decoded displayValue, show the displayValue when
// not editing. The cell editor still sees the raw value via params.value.
const DisplayValueRenderer = (params: ICellRendererParams) => {
  const field = params.colDef?.field;
  if (!field) return null;
  const idx = field.replace('col_', '');
  const display = params.data?.[`_display_${idx}`] as string | undefined;
  if (display !== undefined && display !== '') return display;
  const v = params.value;
  return v == null ? '' : String(v);
};

// Cell renderer for custom controls (delegates to registered component).
// Merges column-level meta with the per-row control (stashed at _ctrl_${idx})
// so renderers like reportBar see their per-row reports list. onAction is
// wired through AG Grid context with the row's navpath so row-scoped
// commands (ExecuteBarReport, EmailBarReport, ...) target the correct row.
const CustomCellRenderer = (params: ICellRendererParams) => {
  const field = params.colDef?.field;
  if (!field) return null;
  const idx = field.replace('col_', '');
  const controlType = params.data?.[`_type_${idx}`] as string | undefined;
  if (!controlType) return null;
  const CustomComponent = isCellRenderable(controlType) ? getControl(controlType) : undefined;
  if (!CustomComponent) return null;
  const colMeta = params.data?.[`_meta_${idx}`] as Record<string, unknown> | undefined;
  const rowCtrl = params.data?.[`_ctrl_${idx}`] as Record<string, unknown> | undefined;
  const control = {
    ...(colMeta ?? {}),
    ...(rowCtrl ?? {}),
    type: controlType,
    value: params.value,
    editable: false,
  } as UIControl;
  const rowPath = params.data?._selectorPath as string | undefined;
  const ctx = params.context as { onAction?: (action: string, params?: Record<string, string>) => void; onChange?: (name: string, value: unknown) => void } | undefined;
  const onAction = (action: string, extra?: Record<string, string>) => {
    if (!ctx?.onAction) return;
    const merged = rowPath ? { navpath: rowPath, ...(extra ?? {}) } : (extra ?? {});
    ctx.onAction(action, merged);
  };
  const onChange = (name: string, value: unknown) => {
    ctx?.onChange?.(name, value);
  };
  // Swallow clicks so interacting with an embedded control (attachment
  // download link, action icon, ...) doesn't bubble up to the AG Grid row
  // click handler and navigate into the detail view (SXADV-5457.2/.3). The
  // React stopPropagation alone can't stop AG Grid's row-click — AG Grid
  // listens on the cell natively, before the synthetic event reaches React's
  // root — so the row handlers also bail when the native target sits inside a
  // .list-cell-control wrapper (see handleRowClicked / handleGridClick).
  const stop = (e: React.MouseEvent | React.PointerEvent) => e.stopPropagation();
  return (
    <span className="list-cell-control" onClick={stop} onMouseDown={stop} onPointerDown={stop} style={{ display: 'inline-flex', alignItems: 'center', width: '100%' }}>
      <CustomComponent control={control} onAction={onAction} onChange={onChange} />
    </span>
  );
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

/** Build cumulative pixel offsets at each column-unit boundary from the
 *  current AG Grid column layout. Lets continuation rows align with main
 *  columns even when resizing pushes actual widths away from the size-
 *  based defaults. Unit counts come from the server headers' colspan
 *  (ColDef width is pixels, not units). Returns offsets[u] = px from the
 *  left at unit boundary u.
 */
/** Leftmost navigate-to-detail column for listEdit+detailView lists (the
 *  legacy "selector"). Field click edits in the panel; this icon opens the
 *  full detail page. Rendered only on main rows (continuation/break rows are
 *  full-width and ignore columns). Reads onAction from a stable ref passed via
 *  cellRendererParams so adding the column doesn't rebuild on every render. */
const SELECTOR_NAV_WIDTH = 30;
type SelectorNavParams = ICellRendererParams & {
  onActionRef?: { current: (action: string, params?: Record<string, string>) => void };
};
const SelectorNavRenderer = (params: SelectorNavParams) => {
  const data = params.data as Record<string, unknown> | undefined;
  if (!data || data._isBreakRow || data._isContinuationRow) return null;
  const path = data._selectorPath as string | undefined;
  const command = data._selectorCommand as string | undefined;
  if (!path || !command) return null;
  return (
    <span
      className="selector-nav"
      title="Apri dettaglio"
      onClick={(e) => { e.stopPropagation(); params.onActionRef?.current(command, { navpath: path }); }}
    >
      <RightOutlined />
    </span>
  );
};

function computeUnitOffsets(api: GridApi, headersByField: Map<string, number>): number[] {
  const cols = api.getAllDisplayedColumns();
  const offsets: number[] = [0];
  let px = 0;
  for (const col of cols) {
    const field = col.getColDef().field;
    // The selector column sits outside the colspan/unit model — skip it so the
    // data columns keep their offsets starting at 0 (continuation rows align to
    // the data area, which is padded left by the pinned selector width).
    if (field && field.startsWith('_selnav')) continue;
    const units = (field && headersByField.get(field)) || 1;
    const width = col.getActualWidth();
    const pxPerUnit = width / units;
    for (let u = 0; u < units; u++) {
      px += pxPerUnit;
      offsets.push(px);
    }
  }
  return offsets;
}

/** Size each cell in a colspan-driven list by consuming `unit offsets` left
 *  to right. Returns the absolute pixel width for each cell. When a cell
 *  extends past the computed offsets (continuation row has more units than
 *  the main grid — e.g. because invisible main-row items collapsed), use
 *  the average pixel-per-unit from the main offsets to extrapolate so
 *  trailing cells get a sensible width rather than 0. */
function widthsFromOffsets(
  offsets: number[],
  cellSpans: number[],
): number[] {
  const maxUnit = offsets.length - 1;
  const avgPxPerUnit = maxUnit > 0 ? offsets[maxUnit] / maxUnit : 0;
  const offsetAt = (u: number): number => {
    if (u <= maxUnit) return offsets[u];
    return offsets[maxUnit] + (u - maxUnit) * avgPxPerUnit;
  };
  const result: number[] = [];
  let pos = 0;
  for (const span of cellSpans) {
    result.push(offsetAt(pos + span) - offsetAt(pos));
    pos += span;
  }
  return result;
}

/** Height a continuation row starts at — its FLOOR. What the text does at the
 *  current column widths isn't knowable here (only the <br> count is), so
 *  ContinuationRowRenderer measures the laid-out row and grows it from this
 *  (SXADV-5770.2). Module-level so the column-resize resync can restore the floor
 *  before the re-measure, which is how a row shrinks back after a widening. */
function continuationRowFloor(params: { data?: Record<string, unknown> }): number | undefined {
  if (params.data?._isContinuationRow) {
    const cells = params.data._continuationCells as Array<{ html?: string; text?: string; control?: UIControl }> | undefined;
    if (cells?.some(c => c.html && /<br\s*\/?>/i.test(c.html))) {
      let maxBreaks = 0;
      for (const c of cells) {
        if (c.html) {
          const breaks = (c.html.match(/<br\s*\/?>/gi) || []).length;
          if (breaks > maxBreaks) maxBreaks = breaks;
        }
      }
      return (maxBreaks + 1) * GRID_CONTINUATION_ROW_HEIGHT;
    }
    // An interactive control is taller than a line of text and would otherwise
    // bleed over the row below (it already overlapped by 2px at the old 22px).
    if (cells?.some(c => c.control && c.control.type && isCellRenderable(c.control.type))) {
      return GRID_CONTINUATION_CONTROL_ROW_HEIGHT;
    }
    // Otherwise: one line of 12px text. This is the row a wrapped record pays
    // a second time for, so it is where the density is worth buying.
    return GRID_CONTINUATION_ROW_HEIGHT;
  }
  return undefined;
}

/** `onRowHeightChanged()` repositions every row, and a page's worth of
 *  continuation rows all measure themselves in the same paint — so coalesce
 *  their notifications into one call per frame per grid. */
const pendingRowHeightGrids = new Set<GridApi>();
let rowHeightFlushHandle = 0;
function scheduleRowHeightFlush(api: GridApi): void {
  pendingRowHeightGrids.add(api);
  if (rowHeightFlushHandle) return;
  rowHeightFlushHandle = requestAnimationFrame(() => {
    rowHeightFlushHandle = 0;
    const grids = Array.from(pendingRowHeightGrids);
    pendingRowHeightGrids.clear();
    for (const grid of grids) {
      if (!grid.isDestroyed()) grid.onRowHeightChanged();
    }
  });
}

// Render a single continuation cell. Custom (cell-renderable) controls
// delegate to the registered React component — main cols are served by
// AG Grid's cellRenderer pipeline, but continuation cells sit outside
// that pipeline and need to dispatch themselves.
const ContinuationCell = ({
  cell,
  style,
  onAction,
  onChange,
  rowPath,
}: {
  cell: { html?: string; text?: string; colspan?: number; control?: UIControl };
  style: React.CSSProperties;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
  rowPath?: string;
}) => {
  if (cell.control && cell.control.type && isCellRenderable(cell.control.type)) {
    const Component = getControl(cell.control.type);
    if (Component) {
      const dispatchAction = (action: string, extra?: Record<string, string>) => {
        const merged = rowPath ? { navpath: rowPath, ...(extra ?? {}) } : (extra ?? {});
        onAction(action, merged);
      };
      // Swallow clicks so they don't bubble up to the row-level navigation
      // handler — row activation should only fire when clicking the text
      // areas of the cell, not when interacting with embedded controls.
      const stop = (e: React.MouseEvent | React.PointerEvent) => e.stopPropagation();
      return (
        <span className="list-cell-control" style={style} onClick={stop} onMouseDown={stop} onPointerDown={stop}>
          <Component control={cell.control} onAction={dispatchAction} onChange={onChange} />
        </span>
      );
    }
  }
  if (cell.html) {
    return <span style={style} dangerouslySetInnerHTML={{ __html: fixServerHtml(cell.html) }} />;
  }
  return <span style={style}>{cell.text}</span>;
};

/** Una cella di una banda di continuazione, come la costruisce
 *  `buildContinuationCells`. */
type ContCell = { html?: string; text?: string; colspan?: number; control?: UIControl };

/** Colonne bloccate in modalità una-riga quando il server non dice nulla. Lo
 *  dice con `<View pinnedCols="...">`; questo è solo la rete per un server che
 *  non emette l'attributo. */
const DEFAULT_PINNED_COLS = '2';

/** Specifica di `pinnedCols` risolta: o un conteggio da sinistra, o un insieme
 *  di nomi (content/tag) da bloccare ovunque si trovino. La seconda forma è
 *  quella che serve davvero — i campi significativi stanno spesso nelle righe di
 *  continuazione, mandati a capo proprio perché lunghi, e per posizione non si
 *  raggiungono. */
type PinnedSpec = { kind: 'count'; count: number } | { kind: 'names'; names: Set<string> };

function parsePinnedSpec(raw: number | string | undefined): PinnedSpec {
  const spec = String(raw ?? DEFAULT_PINNED_COLS).trim();
  if (/^\d+$/.test(spec)) return { kind: 'count', count: parseInt(spec, 10) };
  const names = new Set(
    spec.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
  return names.size > 0 ? { kind: 'names', names } : { kind: 'count', count: 0 };
}

/** I nomi con cui una colonna può essere riferita in `pinnedCols`. */
function headerTokens(hdr: { name?: string; tag?: string } | undefined): string[] {
  if (!hdr) return [];
  const out: string[] = [];
  if (hdr.name) out.push(hdr.name.trim().toLowerCase());
  if (hdr.tag) out.push(hdr.tag.trim().toLowerCase());
  return out;
}

/** Larghezza minima di una colonna nata da una banda di continuazione: sotto
 *  questa un valore non si legge, e la banda di partenza non porta con sé una
 *  dimensione dichiarata da cui dedurla. */
const FLAT_COL_MIN_WIDTH = 60;

/** Testo piatto di una cella HTML — per ordinamento e copia, non per il render. */
function stripHtml(html?: string): string {
  return html ? html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

/** Cella di una banda di continuazione promossa a colonna vera (modalità
 *  una-riga). Il valore della colonna è il testo piatto — così ordinamento e
 *  copia funzionano — mentre il contenuto ricco (HTML o control registrato)
 *  viaggia a parte in `_contcell_<field>` e viene reso qui, riusando lo stesso
 *  `ContinuationCell` della modalità a più righe. */
const FlatContinuationRenderer = (params: ICellRendererParams) => {
  const field = params.colDef?.field;
  const cell = field ? (params.data?.[`_contcell_${field}`] as ContCell | undefined) : undefined;
  if (!cell) return null;
  const ctx = params.context as {
    onAction?: (action: string, params?: Record<string, string>) => void;
    onChange?: (name: string, value: unknown) => void;
  } | undefined;
  const isCustom = !!(cell.control && cell.control.type && isCellRenderable(cell.control.type));
  return (
    <ContinuationCell
      cell={cell}
      style={isCustom
        ? { overflow: 'visible', whiteSpace: 'nowrap' }
        : { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      onAction={ctx?.onAction ?? (() => {})}
      onChange={ctx?.onChange ?? (() => {})}
      rowPath={params.data?._selectorPath as string | undefined}
    />
  );
};

// Full-width renderer for continuation rows (2nd, 3rd, ... rows of a multi-row record).
// The outer div is clipped to the viewport width; the inner div holds the
// full row width and translates horizontally via the --grid-scroll-x CSS
// variable (set by the parent on AG Grid bodyScroll events) so continuation
// content stays aligned with the scrolled main columns.
const ContinuationRowRenderer = (params: ICellRendererParams) => {
  const cells = params.data?._continuationCells as Array<{ html?: string; text?: string; colspan?: number; control?: UIControl }> | undefined;
  // Grow the row to its tallest wrapped cell. A continuation row is a FULL-WIDTH
  // row, so the per-column autoHeight that sizes main rows never sees it: its
  // height comes from getRowHeight, which can only count <br>s — it can't know
  // how the text wrapped at the current column widths. So measure what was laid
  // out and push it back (SXADV-5770.2). Growth only: getRowHeight resets the
  // row to its floor whenever the data changes, so this converges (the measure
  // that follows a grow sees the height it just asked for) instead of ratcheting.
  const trackRef = useRef<HTMLDivElement | null>(null);
  const { node, api } = params;
  useEffect(() => {
    if (!node || !api) return;
    const grow = () => {
      const el = trackRef.current;
      if (!el) return;
      const measured = Math.ceil(el.getBoundingClientRect().height);
      if (measured > (node.rowHeight ?? 0) + 1) {
        node.setRowHeight(measured);
        scheduleRowHeightFlush(api);
      }
    };
    grow();
    if (typeof ResizeObserver === 'undefined' || !trackRef.current) return;
    // Re-measure when a column resize rewraps the text.
    const ro = new ResizeObserver(grow);
    ro.observe(trackRef.current);
    return () => ro.disconnect();
  }, [node, api]);
  if (!cells || cells.length === 0) return null;
  const ctx = params.context as {
    onAction?: (action: string, params?: Record<string, string>) => void;
    onChange?: (name: string, value: unknown) => void;
    headersByField?: Map<string, number>;
    selectorPad?: number;
  } | undefined;
  const hbf = ctx?.headersByField ?? new Map<string, number>();
  const offsets = params.api ? computeUnitOffsets(params.api, hbf) : null;
  const widths = offsets ? widthsFromOffsets(offsets, cells.map(c => c.colspan || 1)) : null;
  const totalWidth = offsets?.[offsets.length - 1];
  const rowPath = params.data?._selectorPath as string | undefined;
  const onAction = ctx?.onAction ?? (() => {});
  const onChange = ctx?.onChange ?? (() => {});
  // Full-width rows span the whole grid (over the pinned selector column too),
  // so their content starts at x=0 while the main data cells start after the
  // pinned selector. Pad left by the selector width to realign.
  const selectorPad = ctx?.selectorPad ?? 0;

  if (widths && totalWidth != null) {
    return (
      <div style={{ width: '100%', overflow: 'hidden', position: 'relative', lineHeight: `${GRID_CONTINUATION_ROW_HEIGHT}px`, fontSize: 12, paddingLeft: selectorPad }}>
        <div ref={trackRef} style={{
          display: 'flex',
          width: totalWidth,
          padding: '0 4px',
          transform: 'translateX(calc(var(--grid-scroll-x, 0px) * -1))',
        }}>
          {cells.map((cell, i) => {
            const w = widths[i];
            // Custom (cell-renderable) controls — e.g. the report bar — render
            // embedded components that can exceed the column width; clipping
            // them with overflow:hidden + ellipsis cuts off their buttons
            // (SXADV-5457.1). Keep the box width for column alignment but let
            // the control overflow visibly instead of being clipped.
            const isCustom = !!(cell.control && cell.control.type && isCellRenderable(cell.control.type));
            // Text cells wrap instead of being cut (SXADV-5770.2); the effect
            // above then grows the row to the tallest of them.
            const style: React.CSSProperties = isCustom
              ? { width: w, minWidth: w, padding: '0 4px', overflow: 'visible', whiteSpace: 'nowrap' }
              : { width: w, minWidth: w, maxWidth: w, padding: '0 4px', overflow: 'hidden', whiteSpace: 'normal', wordBreak: 'break-word' };
            return <ContinuationCell key={i} cell={cell} style={style} onAction={onAction} onChange={onChange} rowPath={rowPath} />;
          })}
        </div>
      </div>
    );
  }

  // Fallback before grid layout settles — pure flex distribution
  return (
    <div style={{ display: 'flex', padding: '0 4px', lineHeight: '22px', fontSize: 12 }}>
      {cells.map((cell, i) => {
        const style: React.CSSProperties = { flex: cell.colspan || 1, padding: '0 4px' };
        return <ContinuationCell key={i} cell={cell} style={style} onAction={onAction} onChange={onChange} rowPath={rowPath} />;
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
  onChange?: (name: string, value: unknown) => void;
  onGridChange?: (name: string, values: string[]) => void;
  onEditRow?: (navpath: string | null) => void;
  /** listEdit: a record row was selected — the bottom edit panel renders it. */
  onSelectRecord?: (navpath: string) => void;
  /** listEdit: report the ordered record paths (main rows) so the panel can
   *  navigate prev/next between records. */
  onRecordPaths?: (records: ListRecord[]) => void;
  /** Read-and-clear "was Nuovo/Add just dispatched?" (Shell's pendingAddRef).
   *  Gates auto-opening the panel on the server's newly-added edit-path row —
   *  without it, a multiEdit list (where virtually every row is "in edit path")
   *  would auto-open the panel on row 1 of every ordinary load/refresh. */
  pendingAdd?: () => boolean;
  /** Grid inside a form/tab rather than a page of its own. It gets a MEASURED
   *  pixel height (see fillCapHeight) — the layout-table ancestors block CSS
   *  flex-fill — and scrolls internally; a top-level list just takes flex:1. */
  embedded?: boolean;
  /** Whether the bottom edit panel is currently visible — re-measure the fill
   *  height when it appears/disappears (the grid grows to reclaim its space). */
  panelShown?: boolean;
}

const ListRenderer: React.FC<ListRendererProps> = ({ ui, onAction, onChange, onGridChange, onSelectRecord, onRecordPaths, pendingAdd, embedded, panelShown }) => {
  // The page title is already the closing breadcrumb, so a page-level list must
  // not repeat it as a heading (SXADV-5742). Embedded grids keep their title —
  // it names the section, not the page. The subtitle (applied filters, 5484) is
  // unaffected: it says something the breadcrumb doesn't.
  const titleInBreadcrumb = useContext(TitleInBreadcrumbContext) && !embedded;
  // Nor does a grid inside a tab repeat the tab's own label (the documents
  // "Righe fattura" case — see TabLabelContext).
  const titleEchoesTab = useIsTabLabelEcho(ui.header?.title);
  const sid = useContext(SidContext);
  /* Zoom della griglia (SXADV-5737). Offerto solo alle griglie del pannello
     inferiore di una vista a due aree: sono quelle che hanno una testata sopra
     da collassare, ed è lì che l'alta numerosità righi è ingestibile. Lo stato
     è l'`ui.path` della griglia, così una vista con più griglie sa quale. */
  const inSplitArea = useContext(SplitAreaContext);
  const inTabPanel = useContext(InTabPanelContext);
  const { zoomedGridId, setZoomedGridId, isOneLine, setOneLine } = useUiMode();
  /* Identità della griglia dentro la vista: il NOME della vista, non `ui.path`.
     `ToolViewState.getPath()` è `parent + id + '.' + posizione`, quindi il path
     cambia navigando i record del padre — lo zoom si sarebbe spento passando al
     record successivo, e peggio: la testata sarebbe rimasta collassata mentre il
     pulsante tornava "ingrandisci". Stesso motivo per cui `selKey` sopra usa
     `viewName ?? path`. */
  const gridId = ui.viewName ?? ui.path ?? null;
  /* Dentro un tab il comando di ingrandimento ce l'ha la barra dei tab, che
     ingrandisce l'area tenendo la barra: due pulsanti quasi uguali a poca
     distanza confondevano e basta. Fuori dai tab resta qui, unico posto
     disponibile (SXADV-5651). */
  const canZoom = !!embedded && inSplitArea && !inTabPanel && !!gridId;
  const isZoomed = canZoom && zoomedGridId === gridId;
  /* Modalità una-riga: le bande di continuazione diventano colonne vere, il
     record sta su una linea sola e la griglia scorre in orizzontale con le
     prime colonne bloccate. Offerta solo dove c'è qualcosa da linearizzare —
     senza bande di continuazione il record è già su una riga. A differenza
     dello zoom vale anche per le liste a tutta pagina: la scansione di molti
     record ne guadagna lì esattamente come in un tab. */
  const canFlatten = !!gridId && !!(ui.continuationHeaders && ui.continuationHeaders.length > 0);
  // Come per `adaptivePageSize`: il valore arriva nell'header su un render FULL
  // e nel `paging` su un aggiornamento di pagina, quindi si leggono entrambi.
  const pinnedSpec = useMemo(
    () => parsePinnedSpec(ui.paging?.pinnedCols ?? ui.header?.pinnedCols),
    [ui.paging?.pinnedCols, ui.header?.pinnedCols],
  );
  const oneLine = canFlatten && isOneLine(gridId as string);
  // L'uscita da tastiera la registra la griglia zoomata, non lo store: lo zoom è
  // memorizzato per vista, e da fuori non si saprebbe quale ambito chiudere —
  // si finirebbe per rubare Esc e cancellare uno zoom che l'utente non sta
  // vedendo. Priorità gridZoom: con anche l'immersiva attiva, la prima Esc
  // toglie lo zoom e la seconda l'immersiva.
  useHotkey('Escape', () => setZoomedGridId(null), {
    priority: HotkeyPriority.gridZoom,
    enabled: isZoomed,
  });
  const isMultiEdit = !!ui.multiEdit;
  const isListEdit = !!ui.listEdit;
  // Stable key for persisting the selected row across the remount that occurs
  // when navigating into a detail and back (item 5455.1C).
  const selKey = `${sid ?? ''}|${ui.viewName ?? ui.path ?? ''}`;

  // All data local (no paging or single page) — can do client-side sort
  const meta = ui.header;
  const allDataLocal = (() => {
    if (ui.paging) return ui.paging.totalPages <= 1;
    if (meta?.recordCount && meta?.pageSize) return meta.recordCount <= meta.pageSize;
    return true; // No paging info — assume all data is local
  })();

  // Normalized pagination state for the footer. Prefer the explicit `paging`
  // object (present after a detailPageOnly slim update); otherwise derive it
  // from the header (initial embedded render carries recordCount/pageSize/
  // position but no paging object). Null when there's nothing to paginate.
  const pageInfo = (() => {
    if (ui.paging) return ui.paging;
    if (meta?.recordCount && meta?.pageSize) {
      return {
        currentPage: Math.floor((meta.position ?? 0) / meta.pageSize) + 1,
        totalPages: Math.ceil(meta.recordCount / meta.pageSize),
        totalRows: meta.recordCount,
        pageSize: meta.pageSize,
        position: meta.position ?? 0,
      };
    }
    return null;
  })();
  // An embedded detail grid with more than one server page gets an interactive
  // pager wired to DetailPage (slim, updates just this grid). Top-level lists
  // keep paging in their toolbar, so this is embedded-only.
  const showDetailPager = !!embedded && !!ui.path && !!pageInfo && pageInfo.totalPages > 1;

  // Build editable column metadata map from ui.columns (stable across renders)
  // Stable handle to onAction for the selector cell renderer, so injecting the
  // selector column doesn't force the columnDefs memo to rebuild each render.
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  const editableColumns = useMemo(() => {
    const map = new Map<number, ListColumn['control']>();
    if ((isMultiEdit || isListEdit) && ui.columns) {
      ui.columns.forEach((col, idx) => {
        if (col.control?.editable) {
          map.set(idx, col.control);
        }
      });
    }
    return map;
  }, [ui.columns, isMultiEdit, isListEdit]);



  const { columnDefs, rowData, serverEditingPath } = useMemo(() => {
    // An empty list still has column metadata (ui.headers / ui.columns). Build
    // the columns from it so the header row and the "no records" overlay render
    // correctly. Bailing to zero columns here left an empty list (e.g.
    // registratoriCassaList) header-less and made the continuation-header
    // injection paint a garbled, clipped sliver. Only bail when there is truly
    // nothing to build columns from (no rows AND no header metadata).
    if ((!ui.rows || ui.rows.length === 0) && (!ui.headers || ui.headers.length === 0)) {
      return { columnDefs: [], rowData: [], serverEditingPath: null, serverEditingFirstCol: null };
    }
    const uiRows: UIRow[] = ui.rows ?? [];

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
        } else if (ctrlType && isCellRenderable(ctrlType)) {
          customColumns.set(idx, ctrlType);
          customColumnMeta.set(idx, col.control as Record<string, unknown>);
        }
        if (ctrlType === 'money' || ctrlType === 'number') {
          rightAlignColumns.add(idx);
        }
      });
    } else {
      // Fallback: check first data row
      const firstDataRow = uiRows.find((r: UIRow) => r.cls !== 'breakRow');
      if (firstDataRow) {
        firstDataRow.cells.forEach((cell: UICell, idx: number) => {
          if (cell.control?.type === 'html') htmlColumns.add(idx);
        });
      }
    }

    // Columns whose content style requests wrapping (e.g. numerator
    // definitions with "white-space:pre-wrap") need autoHeight so the row grows
    // and the whole value shows over multiple lines instead of being clipped to
    // the first line (item 5455.3). Detected from the first data row's cells.
    const wrapColumns = new Set<number>();
    // Colonne allineate a destra dallo STILE della cella invece che dal tipo di
    // controllo: `contentStyle="text-align:right"` su un ViewItem di testo (il
    // numero documento, ad esempio) arriva come stile inline per-cella, che il
    // dato rispetta e l'intestazione no — nome colonna a sinistra sopra valori a
    // destra (SXADV-5736.2). Serve solo per l'intestazione: la cella è già a
    // posto per conto suo.
    const styleRightColumns = new Set<number>();
    {
      const firstDataRow = uiRows.find((r: UIRow) => r.cls !== 'breakRow' && !isContinuationRow(r));
      firstDataRow?.cells.forEach((cell: UICell, idx: number) => {
        const st = cell.control?.style;
        if (!st) return;
        if (/white-space\s*:\s*(pre-wrap|pre-line|normal)/i.test(st)) wrapColumns.add(idx);
        if (/text-align\s*:\s*right/i.test(st)) styleRightColumns.add(idx);
      });
    }

    // Secondary (continuation) header labels sit under the primary header at
    // the same column positions (mapped by cumulative colspan units, the same
    // model used at render time). The base width calc only looks at the primary
    // header, so longer secondary labels (e.g. "Cliente" under "Tipo doc.")
    // get truncated (item 5455.2). Compute an additive per-column min width
    // from the secondary labels so columns grow enough to show them.
    const secondaryMinWidth = new Map<number, number>(); // key: serverHeaders idx
    if (serverHeaders && ui.continuationHeaders && ui.continuationHeaders.length > 0) {
      const mainCols: { idx: number; start: number; span: number }[] = [];
      let unit = 0;
      serverHeaders.forEach((h, idx) => {
        if (h.type === 'selector') return;
        const span = h.colspan || 1;
        mainCols.push({ idx, start: unit, span });
        unit += span;
      });
      for (const chRow of ui.continuationHeaders) {
        let pos = 0;
        for (const sh of chRow) {
          const span = sh.colspan || 1;
          const longest = (sh.text || '').split(/\s+/).reduce((a, b) => a.length > b.length ? a : b, '');
          const need = headerLabelMinWidth(longest);
          const covered = mainCols.filter(c => c.start < pos + span && (c.start + c.span) > pos);
          if (covered.length > 0) {
            const share = Math.ceil(need / covered.length);
            for (const c of covered) secondaryMinWidth.set(c.idx, Math.max(secondaryMinWidth.get(c.idx) || 0, share));
          }
          pos += span;
        }
      }
    }

    // Build column definitions from server headers
    const cols: ColDef[] = [];
    /** field della colonna → nomi con cui `pinnedCols` può riferirla. */
    const colTokens = new Map<string, string[]>();
    if (serverHeaders && serverHeaders.length > 0) {
      serverHeaders.forEach((hdr: ListHeader, idx: number) => {
        if (hdr.type === 'selector') {
          return;
        }
        const isHtml = htmlColumns.has(idx);
        const customType = customColumns.get(idx);
        const colCtrl = ui.columns?.[idx]?.control;
        const colCtrlType = colCtrl?.type as string | undefined;
        const isCustom = colCtrlType && isCellRenderable(colCtrlType);
        let cellRenderer: ColDef['cellRenderer'] = undefined;
        let autoHeight = false;
        let wrapText = false;
        // Server-driven auto-height: UIControl.isColumnAutoHeight() emits autoHeight in column metadata
        const colAutoHeight = !!colCtrl?.autoHeight;
        // Values that don't fit their column wrap onto further lines and the row
        // grows to the tallest cell — the legacy row height was driven by its
        // content, not fixed to one line (SXADV-5770.2). Columns edited in the
        // grid stay one line: a cell editor in a grown cell has nothing to gain.
        const contentWraps = !NO_WRAP_CONTENT_TYPES.has(colCtrlType ?? '')
          && !isBooleanType(colCtrlType)
          && !editableColumns.has(idx)
          && !!colCtrl;
        if (isHtml || colAutoHeight || wrapColumns.has(idx)) {
          if (isHtml) cellRenderer = HtmlCellRenderer;
          autoHeight = true;
          wrapText = true;
        } else if (customType) {
          cellRenderer = CustomCellRenderer;
          autoHeight = true;
        } else if (contentWraps) {
          autoHeight = true;
          wrapText = true;
        }
        const isRightAlign = rightAlignColumns.has(idx);
        // L'intestazione segue anche l'allineamento imposto via contentStyle,
        // che invece non tocca le celle (già allineate dal loro stile inline).
        const isHeaderRightAlign = isRightAlign || styleRightColumns.has(idx);
        // Minimum width based on longest word in header (measured, zoom-proof)
        const longestWord = (hdr.text || '').split(/\s+/).reduce((a, b) => a.length > b.length ? a : b, '');
        const hdrMinWidth = headerLabelMinWidth(longestWord);
        // Content-based min width from control.size: columns should at least
        // show their declared content width, matching form behavior. Boolean
        // (checkbox) columns are intrinsically narrow regardless of size.
        // Custom (cell-renderable) controls don't fit the text-char model and
        // get a more generous minimum so embedded components (reportBar etc.)
        // aren't clipped. If the sum exceeds the viewport the grid scrolls
        // horizontally — better than clipping the declared content.
        const colSize = colCtrl?.size;
        // Filler columns (trailing padding in the template with no control)
        // must still carry pixel width so continuation-row cells that map to
        // these units don't collapse to 0px. Use the header-based flex units
        // with a per-unit pixel estimate.
        const isFiller = !colCtrl;
        let contentMinWidth = 0;
        if (colSize) {
          const perChar = isCustom ? 8 : 6.3;
          contentMinWidth = Math.round(Math.min(colSize * perChar + 16, 500));
        } else if (isFiller) {
          const units = hdr.colspan || 1;
          contentMinWidth = Math.round(units * 6.3);
        }
        // Date/timestamp columns must always fit a formatted date (dd/mm/yyyy),
        // even when the header is short ("Dal"/"Al") and no size is declared —
        // otherwise they collapse far too narrow (item 5455.5).
        if (colCtrlType === 'date' || colCtrlType === 'timestamp') {
          contentMinWidth = Math.max(contentMinWidth, colCtrlType === 'timestamp' ? 130 : 88);
        }
        const effectiveMinWidth = Math.max(hdrMinWidth, contentMinWidth, secondaryMinWidth.get(idx) || 0);
        // Starting width honors the server's colspan proportions (the same
        // model the legacy grid used): the server sizes columns in colspan
        // units — ui.totalCols spread over ui.totalWidth — so e.g. Descrizione
        // at colspan 12 is meant to be by far the widest column. Without this,
        // width collapses to effectiveMinWidth (a header/content *minimum*), so
        // text columns with no declared `size` (codice, descrizione) render far
        // too narrow. Floor at the minimum so nothing clips, and fall back to
        // the minimum when the server omits the proportion metadata.
        const perUnit = ui.totalCols && ui.totalWidth ? ui.totalWidth / ui.totalCols : 0;
        const colspanWidth = perUnit > 0 ? Math.round((hdr.colspan || 1) * perUnit) : 0;
        const effectiveWidth = Math.max(effectiveMinWidth, colspanWidth);

        // Editable column support
        const colMeta = editableColumns.get(idx);
        let editable: ColDef['editable'] = false;
        let cellEditor: ColDef['cellEditor'] = undefined;
        let cellEditorParams: ColDef['cellEditorParams'] = undefined;
        let editCellRenderer: ColDef['cellRenderer'] = undefined;
        let dynPropKey: string | null = null;

        if (colMeta) {
          const ctrlType = colMeta.type as string | undefined;
          // Build editable callback based on column metadata:
          // - true: static, editable when row is in edit mode (_editable_ flag)
          // - "iN": dynamic, also check the row's evaluated property
          // - false/absent: never editable
          const colEditable = colMeta.editable as boolean | string | undefined;
          dynPropKey = typeof colEditable === 'string' && colEditable.match(/^i\d+$/) ? colEditable : null;

          const makeEditableCallback = () => (params: { data?: Record<string, unknown> }) => {
            // Row must be in edit mode (flag set by activateRow or server per-cell data)
            if (!params.data?.[`_editable_${idx}`]) return false;
            // For dynamic props, check the per-row evaluated expression
            if (dynPropKey) return !!params.data?.[`_prop_${dynPropKey}`];
            return true;
          };

          if (isBooleanType(ctrlType)) {
            if (isMultiEdit) {
              // Record-SELECTION multiEdit: render an always-interactive checkbox
              // on every editable row (not AG Grid's click-to-edit single cell) so
              // the user can check N records and post them in one multi-row Save.
              // A checkbox is stateless, so it survives AG Grid's full-width row
              // remounts (unlike combos/dates). No AG editor — the renderer toggles
              // the value and re-pushes the column to formValues.
              editCellRenderer = MultiEditCheckboxRenderer as ColDef['cellRenderer'];
              editable = false;
            } else {
              // Use AG Grid's built-in checkbox cell renderer + editor
              editable = makeEditableCallback();
              cellEditor = 'agCheckboxCellEditor';
            }
          } else if (isMultiEdit) {
            // Non-boolean multiEdit columns are never in-grid-editable: field
            // editing happens exclusively in the bottom panel now (server no
            // longer sends colMeta.editable for these either — see
            // UIControl.getJSONColumnMeta). Only the selection checkbox above
            // stays interactive in-grid.
            editable = false;
          } else if (isListEdit) {
            editable = makeEditableCallback();
            const editorName = getCellEditorForType(ctrlType);
            if (colMeta.remote) {
              cellEditor = 'remoteComboCellEditor';
              cellEditorParams = { colMeta, sid, navpath: ui.path };
            } else if (editorName) {
              cellEditor = editorName;
              cellEditorParams = { colMeta };
            }
          }
        }

        // Boolean columns render as text (server-decoded via BOOLEAN_CODE_TABLE);
        // editing still uses agCheckboxCellEditor for the active row. Editable
        // columns with a distinct displayValue (remote combos, List controls
        // emitting both key + description) use DisplayValueRenderer so the
        // cell shows the description while the editor still sees the key.
        const isBool = isBooleanType(colCtrlType);
        const needsDisplayValue = !isBool && !!colMeta;
        const resolvedCellRenderer = editCellRenderer || cellRenderer
          || (isBool ? BooleanTextRenderer : undefined)
          || (needsDisplayValue ? DisplayValueRenderer : undefined);

        colTokens.set(`col_${idx}`, headerTokens(hdr));
        cols.push({
          field: `col_${idx}`,
          headerName: hdr.text || '',
          sortable: allDataLocal && !isMultiEdit,
          comparator: allDataLocal ? rawValueComparator(idx) : undefined,
          // Static header class + money/number right-align fallback, combined
          // with the per-cell dynamic class the server emits from the ViewItem
          // contentClass (state colors like docProvvisorio). Stashed as
          // _cls_{idx} during rowData build.
          cellClass: (params: { data?: Record<string, unknown> }) => {
            const base = isRightAlign
              ? [hdr.cls, 'ag-right-aligned-cell'].filter(Boolean) as string[]
              : (hdr.cls ? [hdr.cls] : []);
            const dyn = params.data?.[`_cls_${idx}`] as string | undefined;
            return dyn ? [...base, ...dyn.split(/\s+/).filter(Boolean)] : base;
          },
          // Per-cell inline style from ViewItem contentStyle (alignment, font,
          // background); stashed as _style_{idx} during rowData build.
          cellStyle: (params: { data?: Record<string, unknown> }) => {
            const s = params.data?.[`_style_${idx}`] as string | undefined;
            return s ? parseInlineStyle(s) : null;
          },
          headerClass: isHeaderRightAlign ? 'ag-right-aligned-header' : undefined,
          headerTooltip: hdr.hint,
          // Fixed width so columns start at their colspan-proportioned
          // dimension (see effectiveWidth) and remain resizable by the user.
          // The colspan-as-flex-unit-count is recovered from ui.headers in
          // computeUnitOffsets for continuation-row cell alignment.
          width: effectiveWidth,
          minWidth: Math.min(40, effectiveMinWidth),
          resizable: true,
          cellRenderer: resolvedCellRenderer,
          cellRendererParams: editCellRenderer ? { colMeta, colIdx: idx, dynPropKey } : undefined,
          // In one-line il record sta su UNA linea: niente a-capo né crescita in
          // altezza, che è ciò che fa entrare molti più record nella pagina. Le
          // colonne con un control registrato tengono l'autoHeight: il loro
          // contenuto non è testo e sborderebbe sulla riga sotto.
          autoHeight: oneLine ? !!customType : autoHeight,
          wrapText: oneLine ? false : wrapText,
          editable,
          cellEditor,
          cellEditorParams,
          // Server-sorted lists: custom header handles sort dispatch; client-sorted: AG Grid native.
          // Also use the custom header when the column has a configureIcon so the dot renders.
          ...((!allDataLocal && hdr.sortExpression) || hdr.configureIcon ? {
            headerComponent: ServerSortHeader,
            headerComponentParams: {
              sortExpression: !allDataLocal ? hdr.sortExpression : undefined,
              sortDir: hdr.sortDir,
              configureIcon: hdr.configureIcon,
              alignRight: isHeaderRightAlign,
            },
          } : {}),
        });
      });
    } else {
      // Fallback: derive columns from first data row cells
      const firstRow = uiRows[0];
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

    // The selector's basePath is only the list's own viewstate id (e.g. "S1-11").
    // For an EMBEDDED list that drops the parent scope prefix, so the composed row
    // path ("S1-11.0") resolves the viewstate but fails the server's full-path
    // isInEditPath prefix test — the clicked row never enters edit mode and its
    // cells stay read-only. ui.path carries the FULL list path (parent chain
    // included, ending in the list's own position), so strip its trailing ".<pos>"
    // to recover the full row-path base. Falls back to the bare id when ui.path is
    // absent or inconsistent (root lists, where the two already coincide).
    if (selectorBasePath && ui.path) {
      const dot = ui.path.lastIndexOf('.');
      if (dot > 0) {
        const stripped = ui.path.slice(0, dot);
        if (stripped.endsWith(selectorBasePath)) selectorBasePath = stripped;
      }
    }

    // Helper to build selector info for a row
    const buildSelectorInfo = (row: UIRow): { command?: string; path?: string } => {
      // L'identita' della riga e' il suo navpath, che il server manda su ogni
      // riga primaria a prescindere da come la lista e' disegnata: il selettore
      // e' presentazione, non identificazione (SXADV-5796.3b). La ricomposizione
      // `basePath + "." + pos` dal selettore resta sotto come ripiego per un
      // server che non lo manda ancora.
      const rowPath = (row.props as Record<string, unknown> | undefined)?.path;
      if (typeof rowPath === 'string' && rowPath) {
        return { command: selectorCommand, path: rowPath };
      }
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

    // Helper to extract cell values from a continuation row. Cells without a
    // control (server-emitted placeholders for invisible items, trailing
    // fillers) are kept as empty entries so subsequent cells don't shift
    // left out of their slots. The leading DUMMY (idx 0) represents the
    // selector column width, which the main grid already omits, so we skip
    // it to align continuation content with main column 0.
    // Cells carrying a custom (cell-renderable) control — reportBar and the
    // like — preserve the full control so the continuation renderer can
    // delegate to the registered React component.
    const buildContinuationCells = (row: UIRow): Array<{ html?: string; text?: string; colspan?: number; control?: UIControl }> => {
      const cells: Array<{ html?: string; text?: string; colspan?: number; control?: UIControl }> = [];
      row.cells.forEach((cell: UICell, idx: number) => {
        if (cell.elementType === ELTYPE_SELECTOR) return;
        if (cell.elementType === ELTYPE_PROMPT) return;
        if (idx === 0 && cell.elementType === ELTYPE_DUMMY) return;
        const colspan = (cell as unknown as Record<string, unknown>).colspan as number | undefined;
        if (cell.control) {
          const ctrlType = cell.control.type;
          if (ctrlType && isCellRenderable(ctrlType)) {
            cells.push({ colspan, control: cell.control });
            return;
          }
          const val = String(cell.control.displayValue ?? cell.control.value ?? '');
          // In list data mode controls lack type; detect HTML by content
          const hasHtml = ctrlType === 'html' || /<[a-z][\s\S]*>/i.test(val);
          cells.push(hasHtml ? { html: val, colspan } : { text: val, colspan });
        } else {
          cells.push({ text: '', colspan });
        }
      });
      return cells;
    };

    const continuationHeaders = ui.continuationHeaders;

    /* Modalità una-riga: le celle delle bande di continuazione vengono promosse
       a colonne vere e fuse nella riga principale del record. Le colonne si
       indicizzano per POSIZIONE IN UNITÀ (banda + unità di partenza), non per
       indice nell'array: le celle sono emesse per record e un record che ne ha
       una in meno sposterebbe tutte le successive di una colonna. L'unità è la
       stessa coordinata su cui il server allinea celle ed etichette
       (`colspan` cumulativo), quindi è anche ciò che permette di ritrovare
       l'etichetta giusta per ognuna. */
    type FlatCol = { band: number; unit: number; span: number; hasContent: boolean };
    const flatCols = new Map<string, FlatCol>();

    // Build row data, detecting continuation rows (first cell is DUMMY elementType 9)
    const rows: Array<Record<string, unknown>> = [];
    let lastSelectorInfo: { command?: string; path?: string } = {};
    let contRowIdx = 0; // tracks which continuation row within a record (0-based)
    let recordGroup = 0; // groups main + continuation rows for hover
    // The row the SERVER placed in the edit path (ViewItem.isEditable only
    // emits editable cell metadata for that row). After an Add on a listEdit
    // grid it's the new insert record — we auto-open its editor below so the
    // record "opens in editing" without a manual click (SXADV-5470.2).
    let serverEditingPath: string | null = null;
    let serverEditingFirstCol: number | null = null;

    for (let i = 0; i < uiRows.length; i++) {
      const row = uiRows[i];
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
        if (oneLine) {
          // Fusione nella riga principale del record, che è l'ultima inserita.
          const target = rows.length > 0 ? rows[rows.length - 1] : null;
          if (target && !target._isBreakRow) {
            let unit = 0;
            for (const cell of contCells) {
              const span = cell.colspan || 1;
              const field = `cont_${contRowIdx}_${unit}`;
              const text = cell.text ?? stripHtml(cell.html);
              const filled = !!(text || cell.control);
              if (filled) {
                target[field] = text;
                target[`_contcell_${field}`] = cell;
              }
              const known = flatCols.get(field);
              if (known) known.hasContent = known.hasContent || filled;
              else flatCols.set(field, { band: contRowIdx, unit, span, hasContent: filled });
              unit += span;
            }
          }
          contRowIdx++;
          continue;
        }
        // Skip empty continuation rows (all dummy/empty cells)
        if (contCells.every(c => !c.html && !c.text)) {
          contRowIdx++;
          continue;
        }
        rowObj._isContinuationRow = true;
        rowObj._continuationCells = contCells;
        rowObj._recordGroup = recordGroup;
        if (row.cls) rowObj._rowCls = row.cls;
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
      // Server row class: zebra striping (evenRow/oddRow) and the view's
      // dynamic RowClass (whole-row state coloring). Applied in getRowClass.
      if (row.cls) rowObj._rowCls = row.cls;
      // Check if next row is a continuation — mark this as having continuations
      const nextRow = i + 1 < uiRows.length ? uiRows[i + 1] : null;
      // In one-line la continuazione confluisce in questa stessa riga: marcarla
      // come "record che prosegue sotto" le toglierebbe il bordo inferiore, cioè
      // il separatore fra un record e l'altro.
      if (!oneLine && nextRow && isContinuationRow(nextRow)) {
        rowObj._hasContination = true;
        rowObj._recordGroup = recordGroup;
      }
      const sel = buildSelectorInfo(row);
      lastSelectorInfo = sel;
      if (sel.command) rowObj._selectorCommand = sel.command;
      if (sel.path) rowObj._selectorPath = sel.path;
      // Instant edit panel: carry this record's edit data (values+dynProps) so
      // the panel hydrates client-side on selection with no round-trip.
      if (row.editData) rowObj._editData = row.editData;

      // Store dynamic row properties (e.g. evaluated isEditable expressions,
      // and — on the primary row — isNew: this record is an unsaved insert).
      const rowProps = row.props;
      if (rowProps?.isNew) {
        rowObj._isNew = true;
        // Row-level "Add just created this record" signal, independent of any
        // per-cell editable metadata — needed because a multiEdit row's cells
        // no longer carry it (field editing moved to the panel), so the
        // _editable_-scan below can never find "the new row" for such a view.
        if (serverEditingPath == null && sel.path) serverEditingPath = sel.path;
      }
      if (rowProps) {
        for (const [key, val] of Object.entries(rowProps)) {
          rowObj[`_prop_${key}`] = val;
        }
      }

      row.cells.forEach((cell: UICell, idx: number) => {
        if (selectorIndices.has(idx) || cell.elementType === ELTYPE_SELECTOR) return;
        if (cell.control) {
          // Per-cell styling from ViewItem contentStyle/contentClass (the
          // server evaluates static + dynamic ?expr per row). Applied by the
          // ColDef cellClass/cellStyle callbacks.
          if (cell.control.cls) rowObj[`_cls_${idx}`] = cell.control.cls;
          if (cell.control.style) rowObj[`_style_${idx}`] = cell.control.style;
          if (customColumns.has(idx)) {
            // Custom controls: store raw value + type + column meta for the
            // cell renderer. Also stash the full per-row control so renderers
            // can read row-specific fields (e.g. reportBar's reports list).
            rowObj[`col_${idx}`] = cell.control.value;
            rowObj[`_type_${idx}`] = customColumns.get(idx);
            rowObj[`_ctrl_${idx}`] = cell.control;
            const meta = customColumnMeta.get(idx);
            if (meta) rowObj[`_meta_${idx}`] = meta;
          } else if (editableColumns.has(idx)) {
            // Editable columns: use raw value for cell editors, not displayValue
            const colType = editableColumns.get(idx)?.type as string | undefined;
            if (isBooleanType(colType)) {
              // Editor (agCheckboxCellEditor) needs the actual boolean; the
              // renderer falls back on _display_${idx} (server-decoded text
              // from BOOLEAN_CODE_TABLE) for read-only display.
              const v = cell.control.value;
              rowObj[`col_${idx}`] = v === true || v === 'true' || v === '1' || v === 'Y' || v === 'S';
              if (cell.control.displayValue !== undefined) {
                rowObj[`_display_${idx}`] = cell.control.displayValue;
              }
            } else {
              rowObj[`col_${idx}`] = cell.control.value ?? '';
              // Server-decoded text for remote combos / lookups so the cell
              // shows the description (e.g. customer name) when not editing
              // while the editor still sees the raw key via col_${idx}.
              if (cell.control.displayValue !== undefined) {
                rowObj[`_display_${idx}`] = cell.control.displayValue;
              }
            }
          } else if (isBooleanType(cell.control.type as string | undefined)
              || isBooleanType(ui.columns?.[idx]?.control?.type as string | undefined)) {
            // Non-editable boolean: show decoded text from BOOLEAN_CODE_TABLE
            rowObj[`col_${idx}`] = cell.control.value;
            if (cell.control.displayValue !== undefined) {
              rowObj[`_display_${idx}`] = cell.control.displayValue;
            }
          } else {
            rowObj[`col_${idx}`] = cell.control.displayValue ?? cell.control.value ?? '';
          }
          // Store raw value for client-side sorting (avoids locale-formatted string comparison)
          if (cell.control.value !== undefined) {
            rowObj[`_raw_${idx}`] = cell.control.value;
          }
          // Per-cell editable flag (for multiEdit conditional editability)
          if (cell.control.editable !== undefined) {
            rowObj[`_editable_${idx}`] = cell.control.editable;
          }
          // For listEdit, if this cell has full metadata (type), it's an editable cell
          if (isListEdit && cell.control.type) {
            rowObj[`_editable_${idx}`] = true;
          }
        }
      });
      // For listEdit: if ANY cell in the row has editable metadata from the server,
      // also mark editable columns whose cells are empty (null value, not server-denied).
      // Cells with a value but no type/editable were explicitly rendered as non-editable by the server (e.g. key fields).
      if (isListEdit) {
        const rowIsEditing = editableColumns.size > 0 &&
          Array.from(editableColumns.keys()).some(ci => rowObj[`_editable_${ci}`]);
        if (rowIsEditing) {
          for (const ci of editableColumns.keys()) {
            if (rowObj[`_editable_${ci}`]) continue; // already marked
            // Only spread to cells that are empty (no value) — not to cells where
            // the server sent a value without editable metadata (server denied editing)
            const cellVal = rowObj[`col_${ci}`];
            if (cellVal === undefined || cellVal === '') {
              rowObj[`_editable_${ci}`] = true;
            }
          }
          // Remember the first edit-path row and its first editable column so
          // the effect below can start the grid editor on it.
          if (serverEditingPath == null) {
            serverEditingPath = (rowObj._selectorPath as string | undefined) ?? null;
            for (const ci of Array.from(editableColumns.keys()).sort((a, b) => a - b)) {
              if (rowObj[`_editable_${ci}`]) { serverEditingFirstCol = ci; break; }
            }
          }
        }
      }
      rows.push(rowObj);
    }

    // Mark the last continuation row of each record group — only that one
    // keeps a bottom border, intermediate continuations merge visually
    // with their group.
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r._isContinuationRow) continue;
      const next = rows[i + 1];
      const isLast = !next
        || !next._isContinuationRow
        || next._recordGroup !== r._recordGroup;
      if (isLast) r._isLastContinuationRow = true;
    }

    /* Colonne nate dalle bande di continuazione. Le etichette si recuperano da
       `ui.continuationHeaders` per SOVRAPPOSIZIONE di unità e non per indice:
       bande e celle sono due sequenze indipendenti sulla stessa coordinata, e
       una banda può coprire più celle (allora la sua etichetta si ripete, che è
       meglio di una colonna senza nome). Le colonne vuote in tutti i record del
       pagina non vengono create: sono i riempitivi che il server emette per
       tenere l'allineamento, e da colonne sarebbero rumore. */
    if (oneLine && flatCols.size > 0) {
      const contHeaders = ui.continuationHeaders ?? [];
      // Etichetta E identità arrivano dalle stesse bande sovrapposte: una banda
      // che copre più celle presta il proprio nome a tutte, quindi bloccarla per
      // nome le blocca insieme — che è il comportamento voluto, sono lo stesso
      // campo spezzato su più celle.
      const bandInfoFor = (band: number, unit: number, span: number): { label: string; tokens: string[] } => {
        const hdrs = contHeaders[band];
        if (!hdrs) return { label: '', tokens: [] };
        const labels: string[] = [];
        const tokens: string[] = [];
        let pos = 0;
        for (const h of hdrs) {
          const hs = h.colspan || 1;
          if (pos < unit + span && pos + hs > unit) {
            if (h.text) labels.push(h.text);
            tokens.push(...headerTokens(h));
          }
          pos += hs;
        }
        return { label: labels.join(' '), tokens };
      };
      const perUnitPx = ui.totalCols && ui.totalWidth ? ui.totalWidth / ui.totalCols : 0;
      Array.from(flatCols.entries())
        .filter(([, m]) => m.hasContent)
        .sort((a, b) => a[1].band - b[1].band || a[1].unit - b[1].unit)
        .forEach(([field, m]) => {
          const { label, tokens } = bandInfoFor(m.band, m.unit, m.span);
          colTokens.set(field, tokens);
          const longest = label.split(/\s+/).reduce((a, b) => (a.length > b.length ? a : b), '');
          const minW = Math.max(FLAT_COL_MIN_WIDTH, headerLabelMinWidth(longest));
          const width = Math.max(minW, perUnitPx > 0 ? Math.round(m.span * perUnitPx) : minW);
          cols.push({
            field,
            headerName: label,
            width,
            minWidth: Math.min(40, minW),
            resizable: true,
            // Ordinamento lato client escluso: il server ordina per colonna
            // della riga principale, e queste colonne non esistono per lui.
            sortable: false,
            cellRenderer: FlatContinuationRenderer,
            headerClass: 'continuation-flat-header',
          });
        });
    }

    // Leftmost navigate-to-detail column (legacy selector) — only when the list
    // both edits in place (listEdit) and binds a detail view. Field click opens
    // the edit panel; this icon opens the full detail page.
    if (isListEdit && ui.hasDetailView) {
      cols.unshift({
        field: '_selnav',
        headerName: '',
        width: SELECTOR_NAV_WIDTH,
        minWidth: SELECTOR_NAV_WIDTH,
        maxWidth: SELECTOR_NAV_WIDTH,
        pinned: 'left',
        resizable: false,
        sortable: false,
        suppressMovable: true,
        suppressNavigable: true,
        cellClass: 'selector-nav-cell',
        headerClass: 'selector-nav-header',
        cellRenderer: SelectorNavRenderer,
        cellRendererParams: { onActionRef },
      });
    }

    /* Prime colonne bloccate: con le bande promosse a colonne la griglia diventa
       più larga della finestra e si scorre in orizzontale, quindi ciò che
       identifica il record deve restare in vista. `pinned` è nativo di AG Grid;
       il selettore, quando c'è, è già bloccato e non conta nel budget. */
    if (oneLine) {
      if (pinnedSpec.kind === 'count') {
        let pinnedCount = 0;
        for (const col of cols) {
          if (col.pinned) continue; // il selettore è già bloccato e non conta
          if (pinnedCount >= pinnedSpec.count) break;
          col.pinned = 'left';
          pinnedCount++;
        }
      } else {
        // Per nome: l'ordine a schermo resta quello della griglia, non quello in
        // cui i nomi sono elencati — l'elenco dice QUALI colonne, non in che
        // ordine metterle.
        let matched = 0;
        for (const col of cols) {
          if (col.pinned || !col.field) continue;
          const tokens = colTokens.get(col.field);
          if (!tokens || !tokens.some((t) => pinnedSpec.names.has(t))) continue;
          col.pinned = 'left';
          matched++;
        }
        if (matched === 0) {
          console.warn(
            `[pinnedCols] nessuna colonna corrisponde a ${Array.from(pinnedSpec.names).join(', ')}`
            + ' — attesi il content o il tag del ViewItem',
          );
        }
      }
    }

    return { columnDefs: cols, rowData: rows, serverEditingPath, serverEditingFirstCol };
  }, [ui.rows, ui.headers, ui.columns, ui.continuationHeaders, ui.hasDetailView, ui.totalCols, ui.totalWidth, allDataLocal, isMultiEdit, isListEdit, editableColumns, oneLine, pinnedSpec]);

  // Report the ordered records (main rows: path + onboard edit data) so the
  // edit panel hydrates on selection and steps prev/next — all client-side,
  // no round-trip. Source of truth for _selectorPath/_editData is here.
  useEffect(() => {
    if (!isListEdit || !onRecordPaths) return;
    const records: ListRecord[] = rowData
      .filter((r) => !r._isContinuationRow && !r._isBreakRow && r._selectorPath)
      .map((r) => ({
        path: r._selectorPath as string,
        editData: r._editData as RowEditData | undefined,
        // Per-row, not per-grid: deletable="?expr" and the BO's workflow rules
        // make this a property of the record, so the panel's Elimina follows
        // the selected row (see CORE LayoutManager.startTableRowJSON).
        canDelete: r._prop_canDelete as boolean | undefined,
      }));
    onRecordPaths(records);
  }, [rowData, isListEdit, onRecordPaths]);

  // Refs and helpers for grouped hover/selection on multi-row records
  const gridApiRef = useRef<GridApi | null>(null);

  // Extract selector info for building field names and determining click behavior
  const selectorInfo = useMemo(() => {
    // canUpdate defaults to true when absent so a server that predates the flag
    // keeps opening the panel (backward compat); a newer server sends false when
    // the view is read-only for the current object (updatable="?expr").
    for (const col of ui.columns ?? []) {
      if (col.selector) return {
        basePath: col.selector.basePath || '',
        canEdit: !!col.selector.canEdit,
        canUpdate: col.selector.canUpdate !== false,
        command: col.selector.command || 'NavigateDetail',
      };
    }
    // Lista listEdit dichiarata `selector="false"`: nessuna colonna selettore,
    // quindi nessun percorso di riga e nessun permesso — e il record non si
    // seleziona, cioe' non si modifica (SXADV-5796.3b). Il server manda le
    // stesse informazioni a livello di lista proprio per questo caso.
    const ps = ui.panelSelector;
    if (ps) return {
      basePath: '',
      canEdit: !!ps.canEdit,
      canUpdate: ps.canUpdate !== false,
      command: 'NavigateDetail',
    };
    return { basePath: '', canEdit: false, canUpdate: true, command: 'NavigateDetail' };
  }, [ui.columns, ui.panelSelector]);
  const selectorBasePath = selectorInfo.basePath;

  // Collect all row values for an editable column and push to formValues, keyed
  // by the bare list id (selectorBasePath) — the same key format the server's
  // page-wide multiEdit post walk actually looks up (controlName + "." + the
  // viewstate's own id). ui.path carries a row-position suffix and would either
  // mismatch the server's lookup key or, worse, be misread as a single targeted
  // row (see CORE ToolViewState.getCurrentEditPosition) instead of the bulk walk
  // this array is meant for — used by the selection checkbox only now.
  const pushColumnValues = useCallback(
    (colIdx: number, colMeta: Record<string, unknown> | undefined) => {
      if (!onGridChange || !colMeta) return;
      const api = gridApiRef.current;
      if (!api) return;
      const fieldName = buildColumnFieldName(String(colMeta.name), selectorBasePath);
      const values: string[] = [];
      api.forEachNodeAfterFilterAndSort((node: { data?: Record<string, unknown> }) => {
        if (node.data?._isBreakRow || node.data?._isContinuationRow) return;
        const val = node.data?.[`col_${colIdx}`];
        values.push(val != null ? String(val) : '');
      });
      onGridChange(fieldName, values);
    },
    [onGridChange, selectorBasePath]
  );

  // Initialize grid formValues on mount / data change for multiEdit
  const initGridFormValues = useCallback(() => {
    if (!isMultiEdit || !onGridChange || !ui.columns) return;
    const api = gridApiRef.current;
    if (!api) return;
    ui.columns.forEach((col, idx) => {
      if (col.control?.editable && col.control?.name) {
        pushColumnValues(idx, col.control as Record<string, unknown>);
      }
    });
  }, [isMultiEdit, onGridChange, ui.columns, pushColumnValues]);

  // Toggle a record-selection checkbox (multiEdit boolean column). setDataValue
  // updates the cell and fires onCellValueChanged → handleCellValueChanged, which
  // re-pushes the whole column to formValues (multi-row post). Works on a column
  // marked editable=false because setDataValue is programmatic, not grid editing.
  const handleBoolToggle = useCallback(
    (colIdx: number, node: unknown, checked: boolean) => {
      const n = node as { setDataValue?: (field: string, value: unknown) => void };
      n.setDataValue?.(`col_${colIdx}`, checked);
    },
    []
  );

  // Handle cell value changes from AG Grid editing
  const handleCellValueChanged = useCallback(
    (event: CellValueChangedEvent) => {
      const field = event.colDef.field;
      if (!field) return;
      const colIdx = parseInt(field.replace('col_', ''), 10);
      const colDef = ui.columns?.[colIdx];
      const colMeta = colDef?.control as Record<string, unknown> | undefined;

      // Update raw value to match
      if (event.node.data) {
        event.node.data[`_raw_${colIdx}`] = event.newValue;
      }

      if (isListEdit && !isMultiEdit && onChange && colMeta?.name) {
        // ListEdit: scalar value with field name = controlName.basePath
        const fieldName = buildColumnFieldName(String(colMeta.name), selectorBasePath);
        const val = event.newValue;
        onChange(fieldName, val != null ? String(val) : '');
      } else {
        // MultiEdit: array of all row values for the column (in practice, only
        // the selection checkbox reaches here now — see makeEditableCallback).
        pushColumnValues(colIdx, colMeta);
      }

      // Check if this column has a reload trigger
      if (colMeta?.reload && colMeta.reload !== 'false') {
        const api = gridApiRef.current;
        if (api) api.stopEditing();
        const command = (colMeta.command as string) || 'Post';
        const params: Record<string, string> = {};
        const reloadNavpath = resolveReloadNavpath({ isMultiEdit, selectorBasePath, uiPath: ui.path });
        if (reloadNavpath) params.navpath = reloadNavpath;
        if (colMeta.option1) params.option1 = colMeta.option1 as string;
        onAction(command, params);
      }
    },
    [ui.columns, ui.path, isListEdit, isMultiEdit, selectorBasePath, onChange, pushColumnValues, onAction]
  );
  const gridContainerRef = useRef<HTMLDivElement | null>(null);
  const lastHoverPath = useRef<string | null>(null);
  const lastSelectedPath = useRef<string | null>(null);

  // An embedded grid fills the space its container actually leaves it, measured
  // in pixels. Sizing it to content (or to a fixed 60vh) makes a tall grid
  // overflow the tab, which forces a second, outer scrollbar and makes the grid's
  // own scroll fight the container's — you can only scroll "to a point". Tables
  // in the ancestor chain block CSS flex height propagation, hence the JS measure.
  const [fillCapHeight, setFillCapHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!embedded) return;
    const gridEl = gridContainerRef.current;
    if (!gridEl || typeof ResizeObserver === 'undefined') return;
    // A dual-area bottom panel has a definite height and clips overflow; when the
    // grid sits in one, its resizes have to re-trigger the measure (below).
    const bound = gridEl.closest<HTMLElement>('.view-split-bottom');
    // The edit panel is a sibling of .list-container (both in the Fragment). When
    // present the grid must FILL down to it.
    const panelEl = gridEl.closest('.list-container')?.parentElement?.querySelector<HTMLElement>('.edit-panel') ?? null;
    const measure = () => {
      const el = gridContainerRef.current;
      if (!el) return;
      // Fill from the grid's top down to the bottom of the nearest scrolling
      // ancestor, minus the edit panel when one is stacked below. The panel's
      // height is measured directly: deriving it from scrollHeight is circular
      // with a sibling panel — it just re-derives the grid's current height.
      let bottomRef = window.innerHeight;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowY === 'auto' || s.overflowY === 'scroll') {
          // Fill to the scroll container's CONTENT bottom. Derive it from
          // clientHeight (which already excludes the horizontal scrollbar and
          // borders) so a wide grid's scrollbar doesn't push content past the
          // fold. The -2 absorbs sub-pixel rounding.
          const borderTop = parseFloat(s.borderTopWidth) || 0;
          const padBottom = parseFloat(s.paddingBottom) || 0;
          bottomRef = p.getBoundingClientRect().top + borderTop + p.clientHeight - padBottom - 2;
          break;
        }
      }
      const listCont = el.closest<HTMLElement>('.list-container');
      const panel = listCont?.parentElement?.querySelector<HTMLElement>('.edit-panel');
      const panelH = panel ? panel.getBoundingClientRect().height : 0;
      // The grid is one part of .list-container (title/pagination/padding are
      // the rest — grid-height-independent). Fill so that the panel, stacked
      // right below .list-container, ends at the scroll container's bottom.
      const listRect = (listCont ?? el).getBoundingClientRect();
      const nonGridChrome = Math.max(0, listRect.height - el.getBoundingClientRect().height);
      setFillCapHeight(Math.max(120, Math.floor(bottomRef - panelH - listRect.top - nonGridChrome)));
    };
    measure();
    // AG Grid / fonts settle a frame later — re-measure once the layout is final.
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    if (bound) ro.observe(bound);
    if (panelEl) ro.observe(panelEl); // grid re-measures when the panel resizes
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [embedded, panelShown, rowData.length]);

  const getGridViewport = useCallback((): HTMLElement | null => {
    return gridContainerRef.current?.querySelector('.ag-body-viewport') ?? null;
  }, []);

  /* Adaptive page size (SXADV-5742) ---------------------------------------
   * The server can't know how many rows fit: that depends on the window size,
   * the browser zoom and — once a record can be shown wrapped or flat — on the
   * row density the user picked. The client is the only party that knows, so it
   * measures and tells the server (SetPageSizeCommand); the page size lives in
   * the ViewState, so the choice is per session.
   *
   * Without this the page size is a fixed 20 and the mismatch is visible today:
   * on a 1265px-tall window 22 wrapped records fit and 20 are loaded, so every
   * list ends in a band of empty grid. */
  const requestedPageSizeRef = useRef<number | null>(null);
  /** Sizes already requested for the current amount of space. Now that a record
   *  sizes to its content, the page size and the average record height feed each
   *  other — asking for 40 can load records that wrap, which measures back as 30,
   *  which measures back as 40 — so each size is asked at most once, until the
   *  space available genuinely changes (window resize, zoom) (SXADV-5770.2). */
  const askedPageSizesRef = useRef<{ avail: number; sizes: Set<number> }>({ avail: 0, sizes: new Set<number>() });

  /** Vertical pitch of one RECORD — main row plus its continuation rows. Measured
   *  from the rendered rows rather than computed from the height constants, so it
   *  stays right whatever a given view's records are made of.
   *
   *  Records no longer share one height (a record wraps to fit its content —
   *  SXADV-5770.2), so this is the AVERAGE gap over the rendered rows, not the
   *  smallest one: the shortest record in view says nothing about how many of the
   *  rest fit. AG Grid renders a contiguous window of rows, so the average over
   *  what's in the DOM is representative of the page. */
  const measureRecordPitch = useCallback((): number | null => {
    const host = gridContainerRef.current;
    if (!host) return null;
    const tops = Array.from(host.querySelectorAll('.ag-center-cols-container .ag-row'))
      .map(r => (r as HTMLElement).getBoundingClientRect().top)
      .sort((a, b) => a - b);
    let total = 0;
    let gaps = 0;
    for (let i = 1; i < tops.length; i++) {
      const d = tops[i] - tops[i - 1];
      if (d > 0) { total += d; gaps++; }
    }
    if (gaps > 0) return total / gaps;
    // Fewer than two rows on screen — fall back to the configured heights.
    const bands = ui.continuationHeaders?.length ?? 0;
    return GRID_ROW_HEIGHT + bands * GRID_CONTINUATION_ROW_HEIGHT;
  }, [ui.continuationHeaders]);

  /* Cambio di modalità di layout: cambia il PASSO delle righe, non lo spazio.
     La stessa finestra ospita il doppio dei record una volta linearizzati, ma il
     misuratore qui sotto si sveglia su un ResizeObserver dell'HOST — che in
     questo caso non scatta, perché l'host è grande uguale — e resterebbe con la
     pagina misurata sull'altra modalità: mezza griglia vuota in fondo.

     Va azzerata anche la memoria di "cosa ho già chiesto": è indicizzata sullo
     spazio disponibile, che non è cambiato, quindi senza azzerarla la taglia
     chiesta nell'altra modalità risulterebbe già richiesta e tornando indietro
     non si rimpicciolirebbe più. */
  useEffect(() => {
    askedPageSizesRef.current = { avail: 0, sizes: new Set<number>() };
    requestedPageSizeRef.current = null;
  }, [oneLine]);

  useEffect(() => {
    // Top-level, server-paged lists only. Embedded grids size to their content
    // and are paged by DetailPageCommand against a different view state.
    if (embedded) return;
    // Server-advertised: absent both on views that declare their own pageSize and
    // on a server that predates SetPageSizeCommand, so the client never calls an
    // action that isn't there. Read from BOTH carriers: a FULL render (opening
    // the list) puts its paging numbers in the list header and emits no `paging`
    // object, which is exactly when this has to work.
    if (!(ui.paging?.adaptivePageSize ?? ui.header?.adaptivePageSize)) return;
    const currentPageSize = ui.paging?.pageSize ?? ui.header?.pageSize;
    if (!currentPageSize) return;

    let timer: number | undefined;
    const measure = () => {
      const viewport = getGridViewport();
      if (!viewport) return;
      const avail = viewport.clientHeight;
      const asked = askedPageSizesRef.current;
      if (Math.abs(asked.avail - avail) > 8) {
        asked.avail = avail;
        asked.sizes.clear();
      }
      const pitch = measureRecordPitch();
      if (!pitch || avail < pitch) return;
      const fits = Math.floor(avail / pitch);
      const want = Math.max(MIN_ADAPTIVE_PAGE_SIZE, Math.min(MAX_ADAPTIVE_PAGE_SIZE, fits));
      if (want === currentPageSize) return;
      // The server clamps and may refuse (a view that declares its own pageSize),
      // in which case the response comes back with the old size — remembering what
      // we asked for stops us asking again on every resize.
      const lastAsked = requestedPageSizeRef.current;
      if (want === lastAsked) return;
      // Hysteresis applies to RESIZES, not to the first fit: the gap between the
      // fixed default and what fits is usually small (20 vs the 22 that fit on a
      // 1265px window) and that gap is the whole point — measuring it against a
      // threshold meant for damping a window drag would silently do nothing.
      // Once we've adapted, a couple of rows is no longer worth a round-trip and
      // a renumbered pager.
      if (lastAsked !== null && Math.abs(want - lastAsked) < ADAPTIVE_PAGE_SIZE_HYSTERESIS) return;
      if (asked.sizes.has(want)) return;
      asked.sizes.add(want);
      requestedPageSizeRef.current = want;
      onAction('SetPageSize', { option1: String(want) });
    };

    timer = window.setTimeout(measure, 200);
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(measure, 400);
    });
    const host = gridContainerRef.current;
    if (host) ro.observe(host);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [embedded, oneLine, ui.paging?.adaptivePageSize, ui.paging?.pageSize, ui.header?.adaptivePageSize, ui.header?.pageSize, getGridViewport, measureRecordPitch, onAction]);

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

  // Track which row is currently in edit mode for listEdit views
  const editingRowPath = useRef<string | null>(null);

  // Activate a row: select the record (listEdit → the bottom panel edits it) or
  // navigate (non-editable lists). Shared between click and Enter key.
  const activateRow = useCallback((data: Record<string, unknown> | undefined) => {
    if (!data || data._isBreakRow) return;
    const path = data._selectorPath as string | undefined;
    lastSelectedPath.current = path ?? null;
    if (path) lastSelectedByView.set(selKey, path); else lastSelectedByView.delete(selKey);
    applyClassByPath(path ?? null, 'record-group-selected');

    const command = data._selectorCommand as string | undefined;
    if (!path) return;
    // Il comando serve solo per NAVIGARE (liste non editabili). Una lista
    // `selector="false"` non ne porta uno, ma la selezione per il pannello ha
    // bisogno del solo percorso di riga (SXADV-5796.3b).
    if (!command && !isListEdit) return;

    if (isListEdit) {
      // Editing lives in the bottom panel, not in the grid: AG Grid remounts
      // full-width rows and destroys any stateful control (combo/date/lookup)
      // rendered in place. A row click selects the record; the panel edits it in
      // the stable React tree. Only open the panel when the view is actually
      // editable — a listEdit view can be read-only by a dynamic rule (e.g. the
      // document isn't provisional), which the server reflects in the selector's
      // canEdit (isEmbeddedEditable) AND canUpdate (the dynamic updatable="?expr"
      // rule — e.g. document not provisional). Read-only → just select (highlight
      // above), no panel, no round-trip.
      if (selectorInfo.canEdit && selectorInfo.canUpdate) onSelectRecord?.(path);
      return;
    }
    // Non-editable lists: the selector navigates to the detail as before.
    if (command) onAction(command, { navpath: path });
  }, [isListEdit, selectorInfo, onSelectRecord, onAction, applyClassByPath, selKey]);

  const handleRowClicked = (event: RowClickedEvent) => {
    const src = event.event as MouseEvent | undefined;
    const target = src?.target as HTMLElement | undefined;
    if (target?.closest('.list-cell-control, button, select, input, textarea, .ant-select, .ant-select-dropdown, .ant-btn, [role="combobox"], [role="option"]')) {
      return;
    }
    activateRow(event.data as Record<string, unknown> | undefined);
  };

  // Keyboard navigation: Enter and arrow keys activate the focused row
  const handleCellKeyDown = useCallback((event: { event?: Event; data?: Record<string, unknown> }) => {
    const keyEvent = event.event as KeyboardEvent | undefined;
    if (!keyEvent || !isListEdit) return;

    if (keyEvent.key === 'Enter') {
      const path = event.data?._selectorPath as string | undefined;
      if (path && path !== editingRowPath.current) {
        keyEvent.preventDefault();
        activateRow(event.data);
      }
    } else if (keyEvent.key === 'ArrowUp' || keyEvent.key === 'ArrowDown') {
      // Activate after AG Grid moves focus to the new row (next tick)
      setTimeout(() => {
        const api = gridApiRef.current;
        if (!api) return;
        const focusedCell = api.getFocusedCell();
        if (!focusedCell) return;
        const node = api.getDisplayedRowAtIndex(focusedCell.rowIndex);
        const newPath = (node as unknown as { data?: Record<string, unknown> })?.data?._selectorPath as string | undefined;
        if (newPath && newPath !== editingRowPath.current) {
          activateRow((node as unknown as { data?: Record<string, unknown> })?.data);
        }
      }, 0);
    }
  }, [isListEdit, activateRow]);

  // Handle clicks on full-width rows (continuation rows) which may not trigger onRowClicked.
  // Skip interactive targets (buttons, selects, inputs, ant-dropdown items)
  // so clicks inside embedded controls like reportBar don't also trigger
  // row navigation.
  const handleGridClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.list-cell-control, button, select, input, textarea, .ant-select, .ant-select-dropdown, .ant-btn, [role="combobox"], [role="option"]')) {
      return;
    }
    const api = gridApiRef.current;
    if (!api) return;
    const rowEl = target.closest('.ag-row') as HTMLElement | null;
    if (!rowEl) return;
    const rowId = rowEl.getAttribute('row-id');
    if (!rowId) return;
    const rowNode = api.getRowNode(rowId);
    if (!rowNode?.data || rowNode.data._isBreakRow) return;
    if (!rowNode.data._isContinuationRow) return;
    // Continuation rows (the 2nd+ line of a multi-row record) render as full-width
    // rows and don't fire AG Grid's onRowClicked, so they're handled here. Route
    // them through the SAME activateRow the main rows use — a click on a
    // continuation field must edit the record (post-and-move), not navigate.
    activateRow(rowNode.data as Record<string, unknown>);
  }, [activateRow]);

  const isFullWidthRow = (params: { rowNode: { data?: Record<string, unknown> } }) =>
    !!params.rowNode.data?._isBreakRow || !!params.rowNode.data?._isContinuationRow;

  const fullWidthCellRenderer = (params: ICellRendererParams) => {
    if (params.data?._isBreakRow) return <BreakRowRenderer {...params} />;
    if (params.data?._isContinuationRow) return <ContinuationRowRenderer {...params} />;
    return null;
  };

  const getRowClass = (params: { data?: Record<string, unknown> }) => {
    const rowCls = params.data?._rowCls as string | undefined;
    if (params.data?._isContinuationRow) {
      const base = params.data._isLastContinuationRow
        ? 'continuation-row continuation-row-last'
        : 'continuation-row continuation-row-middle';
      return rowCls ? `${base} ${rowCls}` : base;
    }
    if (params.data?._hasContination) return rowCls ? `record-first-row ${rowCls}` : 'record-first-row';
    return rowCls;
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

  // Server-side sort dispatch (used by custom header components via ref)
  sortDispatchRef.current = useCallback((sortExpression: string) => {
    const params: Record<string, string> = { option1: sortExpression };
    if (ui.path) params.navpath = ui.path;
    onAction('SortColumn', params);
  }, [onAction, ui.path]);

  // ToggleItem dispatch for configure-mode column header icons
  toggleItemDispatchRef.current = useCallback((itemId: string) => {
    onAction('ToggleItem', { navpath: itemId });
  }, [onAction]);

  // Map column field → unit count (colspan) derived from server headers.
  // Needed because ColDef now uses fixed pixel widths (for resizing) and
  // the flex-unit-count is no longer readable from AG Grid.
  const headersByField = useMemo(() => {
    const map = new Map<string, number>();
    ui.headers?.forEach((hdr, idx) => {
      if (hdr.type === 'selector') return;
      map.set(`col_${idx}`, hdr.colspan || 1);
    });
    return map;
  }, [ui.headers]);

  // Inject continuation header rows AFTER the ag-header. Each row is a
  // clipped viewport whose inner track has width = total cols width and
  // translates via --grid-scroll-x, mirroring the continuation cells.
  const injectContinuationHeaders = useCallback(() => {
    const container = gridContainerRef.current;
    const contHeaders = ui.continuationHeaders;
    if (!container || !contHeaders || contHeaders.length === 0) return;

    const agHeader = container.querySelector('.ag-header');
    if (!agHeader) return;

    container.querySelectorAll('.continuation-header-row').forEach(el => el.remove());
    // In one-line le bande sono diventate colonne vere, con la loro etichetta
    // nell'intestazione della griglia: la fascia iniettata sarebbe un doppione
    // sospeso su righe che non esistono più. La rimozione sopra deve comunque
    // essere passata, o entrando in one-line resterebbe quella di prima.
    if (oneLine) return;

    const api = gridApiRef.current;
    const offsets = api ? computeUnitOffsets(api, headersByField) : null;
    const totalWidth = offsets?.[offsets.length - 1];

    const selectorPad = isListEdit && ui.hasDetailView ? SELECTOR_NAV_WIDTH : 0;
    let insertAfter: Element = agHeader;
    contHeaders.forEach((rowHeaders) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'continuation-header-row';
      // flex:0 0 auto — the wrapper is a flex child of AG Grid's .ag-root
      // column; with overflow:hidden its automatic flex minimum is 0, so any
      // height shortfall (e.g. fractional-px rounding of the fixed container
      // height under browser zoom) would squash the header row vertically
      // before the body gives up a pixel (item 5455.2, reopened).
      wrapper.style.cssText = `width:100%;flex:0 0 auto;overflow:hidden;background:#fafafa;border-bottom:1px solid #f0f0f0;padding-left:${selectorPad}px;box-sizing:border-box;`;
      const widths = offsets
        ? widthsFromOffsets(offsets, rowHeaders.map(h => h.colspan || 1))
        : null;

      const track = document.createElement('div');
      if (totalWidth != null) {
        track.style.cssText = `display:flex;width:${totalWidth}px;font-size:var(--app-grid-font-size);font-weight:700;color:var(--ag-header-foreground-color, #181d1f);padding:0 4px;transform:translateX(calc(var(--grid-scroll-x, 0px) * -1));`;
      } else {
        track.style.cssText = 'display:flex;font-size:var(--app-grid-font-size);font-weight:700;color:var(--ag-header-foreground-color, #181d1f);padding:0 4px;';
      }
      rowHeaders.forEach((hdr, i) => {
        const cell = document.createElement('div');
        const w = widths?.[i];
        if (w != null) {
          // Wraps like the primary header does (SXADV-5770.1A): the width was
          // fitted to the longest WORD of these labels (secondaryMinWidth), so
          // a multi-word one only shows in full over two lines. The wrapper is
          // flex:0 0 auto, so the band grows with the tallest cell.
          cell.style.cssText = `width:${w}px;min-width:${w}px;max-width:${w}px;padding:1px 4px;overflow:hidden;white-space:normal;word-break:break-word;line-height:14px;`;
        } else {
          cell.style.cssText = `flex:${hdr.colspan || 1};padding:1px 4px;`;
        }
        cell.textContent = hdr.text || '';
        track.appendChild(cell);
      });
      wrapper.appendChild(track);
      insertAfter.insertAdjacentElement('afterend', wrapper);
      insertAfter = wrapper;
    });
  }, [ui.continuationHeaders, ui.hasDetailView, isListEdit, headersByField, oneLine]);

  // Propagate horizontal body scroll to continuation rows/headers via a CSS
  // variable. Uses a native scroll listener on the grid's horizontal-scroll
  // viewport — more reliable across AG Grid versions than the bodyScroll
  // API event.
  useEffect(() => {
    const container = gridContainerRef.current;
    if (!container) return;

    const findScroller = (): HTMLElement | null =>
      container.querySelector<HTMLElement>('.ag-body-horizontal-scroll-viewport') ||
      container.querySelector<HTMLElement>('.ag-center-cols-viewport') ||
      container.querySelector<HTMLElement>('.ag-body-viewport');

    let scroller = findScroller();
    let cleanup: (() => void) | null = null;

    const bind = (el: HTMLElement) => {
      const onScroll = () => {
        container.style.setProperty('--grid-scroll-x', `${el.scrollLeft}px`);
      };
      onScroll();
      el.addEventListener('scroll', onScroll, { passive: true });
      cleanup = () => el.removeEventListener('scroll', onScroll);
    };

    if (scroller) {
      bind(scroller);
    } else {
      // Grid DOM not mounted yet — retry on next frame
      const raf = requestAnimationFrame(() => {
        scroller = findScroller();
        if (scroller) bind(scroller);
      });
      return () => {
        cancelAnimationFrame(raf);
        cleanup?.();
      };
    }

    return () => cleanup?.();
  }, [rowData]);

  // Keep continuation row widths in sync with the main grid on column resize
  // or container resize. Re-renders the continuation cells (via redrawRows on
  // full-width rows) and re-injects the continuation header rows.
  useEffect(() => {
    const api = gridApiRef.current;
    if (!api) return;
    const resync = (event?: unknown) => {
      // Mid-drag columnResized events (finished === false) only re-lay the cells
      // out; the row heights are settled once, at the end of the drag. The other
      // events this is bound to carry no `finished` and count as settled.
      const settled = (event as { finished?: boolean } | undefined)?.finished !== false;
      const nodes: Parameters<GridApi['redrawRows']>[0] extends (infer P) | undefined
        ? P extends { rowNodes?: infer R } ? R : never : never = [] as never;
      let floored = false;
      api.forEachNode((n) => {
        const data = n.data as Record<string, unknown> | undefined;
        if (data?._isContinuationRow) {
          (nodes as unknown[]).push(n);
          // Back to the floor: the row grew to fit the text at the OLD widths, and
          // growth alone can't give those pixels back when a column gets wider.
          // The renderer re-measures on the redraw below and grows again from here.
          const floor = continuationRowFloor({ data });
          if (settled && floor != null && n.rowHeight !== floor) {
            n.setRowHeight(floor);
            floored = true;
          }
        }
      });
      if ((nodes as unknown[]).length > 0) {
        api.redrawRows({ rowNodes: nodes });
      }
      if (floored) scheduleRowHeightFlush(api);
      injectContinuationHeaders();
    };
    api.addEventListener('columnResized', resync);
    api.addEventListener('displayedColumnsChanged', resync);
    api.addEventListener('gridSizeChanged', resync);
    api.addEventListener('firstDataRendered', resync);
    // Embedded grids (e.g. inside tabs) often finish DOM layout after
    // onGridReady fires — the initial inject finds an empty .ag-header and
    // leaves the continuation rows unattached. Retry on the next frame so
    // the headers show up on the first paint of the grid.
    const raf = requestAnimationFrame(() => injectContinuationHeaders());
    // For grids that mount hidden (inside a tab panel) the container has
    // width 0 and AG Grid's flex columns all resolve to 0 — our initial
    // injection produces 0-width continuation cells. A ResizeObserver on
    // the container re-injects when the tab becomes visible.
    const container = gridContainerRef.current;
    let ro: ResizeObserver | null = null;
    if (container && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => injectContinuationHeaders());
      ro.observe(container);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      api.removeEventListener('columnResized', resync);
      api.removeEventListener('displayedColumnsChanged', resync);
      api.removeEventListener('gridSizeChanged', resync);
      api.removeEventListener('firstDataRendered', resync);
    };
  }, [injectContinuationHeaders, rowData]);

  // After grid data changes, restore editing state if needed
  useEffect(() => {
    gridContainerRef.current?.classList.remove('grid-waiting');
    if (!isListEdit || !editingRowPath.current) return;
    // Re-apply selection highlight (may be lost during grid re-render from other actions)
    applyClassByPath(editingRowPath.current, 'record-group-selected');
  }, [rowData, isListEdit, applyClassByPath]);

  // Auto-open the bottom edit panel on a NEW server edit-path row — the record
  // just added by "Nuovo" on an editable list. Gated on pendingAdd (consumed
  // once per Add): for a multiEdit list, virtually EVERY row is "in edit path"
  // server-side (see CORE ToolViewState.isInEditPath), so without this gate the
  // panel would auto-open on row 1 of every ordinary load/refresh, not just
  // right after Add. pendingAddSeenRef keeps that one-shot "yes, this is from
  // an Add" answer alive across the retry loop below, since the effect can
  // re-run (new rowData) before the freshly-added row has a rowIndex yet, and a
  // second pendingAdd() call would find the flag already consumed. Only fires
  // when the edit-path row differs from the one we're already on, so plain
  // reloads of the current row don't reopen/fight the panel (SXADV-5470.2).
  // Retries a few frames until the grid has applied the new rowData.
  const pendingAddSeenRef = useRef(false);
  useEffect(() => {
    if (!isListEdit || !serverEditingPath) { pendingAddSeenRef.current = false; return; }
    if (editingRowPath.current === serverEditingPath) return;
    if (!pendingAddSeenRef.current) {
      if (!pendingAdd?.()) return;
      pendingAddSeenRef.current = true;
    }
    let raf = 0;
    let tries = 0;
    const attempt = () => {
      const api = gridApiRef.current;
      if (!api) {
        if (tries++ < 10) raf = requestAnimationFrame(attempt);
        return;
      }
      let rowIndex: number | null = null;
      api.forEachNode((n: { data?: Record<string, unknown>; rowIndex?: number | null }) => {
        if (rowIndex == null && n.data?._selectorPath === serverEditingPath && n.rowIndex != null) {
          rowIndex = n.rowIndex;
        }
      });
      if (rowIndex == null) {
        if (tries++ < 10) raf = requestAnimationFrame(attempt);
        return;
      }
      editingRowPath.current = serverEditingPath;
      pendingAddSeenRef.current = false;
      applyClassByPath(serverEditingPath, 'record-group-selected');
      api.ensureIndexVisible(rowIndex, 'middle');
      onSelectRecord?.(serverEditingPath);
    };
    raf = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(raf);
  }, [rowData, serverEditingPath, isListEdit, onSelectRecord, pendingAdd, applyClassByPath]);

  // Returning to a list after a detail: re-highlight the originating record and
  // scroll it into view (item 5455.1C). The path is read from the module-level
  // map so it survives the remount; retries a few frames until the grid API and
  // rows are ready.
  useEffect(() => {
    if (isListEdit) return; // edit mode handled by the effect above
    const stored = lastSelectedByView.get(selKey);
    if (!stored) return;
    let raf = 0;
    let tries = 0;
    const attempt = () => {
      const api = gridApiRef.current;
      if (!api) {
        if (tries++ < 10) raf = requestAnimationFrame(attempt);
        return;
      }
      lastSelectedPath.current = stored;
      applyClassByPath(stored, 'record-group-selected');
      let rowIndex: number | null = null;
      api.forEachNode((n: { data?: Record<string, unknown>; rowIndex?: number | null }) => {
        if (rowIndex == null && n.data?._selectorPath === stored && n.rowIndex != null) rowIndex = n.rowIndex;
      });
      if (rowIndex == null && tries++ < 10) { raf = requestAnimationFrame(attempt); return; }
      if (rowIndex != null) api.ensureIndexVisible(rowIndex, 'middle');
    };
    raf = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(raf);
  }, [rowData, selKey, isListEdit, applyClassByPath]);

  // The server emits gridActions for embedded lists only. `ui.footer` (the
  // legacy below-the-grid Add) is deliberately no longer rendered — its command
  // is the same one gridActions carries, now shown once above the grid.
  const gridActions = ui.gridActions;
  const gridPath = gridActions?.path || ui.path;
  const hasGridActions = !!gridActions && !!(gridActions.addCommand || gridActions.xlsCommand || gridActions.printCommand);

  // The container never claims more than the available width: horizontal
  // overflow is AG Grid's job (internal scroll, per-column minWidths keep the
  // scroll width honest). The old colspan-based container minWidth pushed wide
  // grids past the tab viewport, so the scrolling ancestor (.tab-content,
  // overflow:auto) grew a SECOND horizontal scrollbar doing the same job as
  // the grid's own (5450.1A), and the grid's vertical scrollbar — glued to
  // the grid's right edge, now off-screen — only appeared after scrolling the
  // outer bar fully right (5450.1B).
  const listContainerStyle: React.CSSProperties = { maxWidth: '100%' };
  // Embedded grids size to content (capped); outer container shouldn't flex
  // to fill the parent — shrink to the grid's height so no empty space
  // below the last row.
  if (embedded) {
    listContainerStyle.flex = 'initial';
  }

  return (
    <div className="list-container" style={listContainerStyle}>
      {/* In zoom il titolo torna anche quando ripete l'etichetta del tab: la
          barra dei tab non c'è più, e resterebbe l'unica cosa a dire su quali
          righe si sta lavorando. */}
      {meta?.title && !titleInBreadcrumb && (!titleEchoesTab || isZoomed) && <div className="view-title">{meta.title}</div>}
      {meta?.subtitle && <div className="view-subtitle">{meta.subtitle}</div>}

      {/* Embedded-list action bar, above the grid and styled like the primary
          toolbar. The legacy renderer put Add *below* the grid (and again in the
          section header) so users who had scrolled a long list could reach it
          without scrolling back; detail grids paginate now, so a single bar on
          top is both enough and consistent with the page toolbar (SXADV-5693). */}
      {(hasGridActions || canZoom || canFlatten) && (
        <div className="toolbar grid-actions" style={{ display: 'flex', alignItems: 'center' }}>
          {gridActions && hasGridActions && (
          <Space wrap size="small">
            {gridActions.addCommand && (
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() => onAction(gridActions.addCommand!, gridPath ? { navpath: gridPath } : undefined)}
              >
                {gridActions.addLabel || 'Nuovo'}
              </Button>
            )}
            {gridActions.xlsCommand && (
              <Tooltip title="Esporta in Excel" placement="bottom">
                <Button
                  size="small"
                  icon={<FileExcelOutlined />}
                  aria-label="Esporta in Excel"
                  onClick={() => onAction(gridActions.xlsCommand!, gridPath ? { navpath: gridPath } : undefined)}
                />
              </Tooltip>
            )}
            {gridActions.printCommand && (
              <Tooltip title="Stampa" placement="bottom">
                <Button
                  size="small"
                  icon={<PrinterOutlined />}
                  aria-label="Stampa"
                  onClick={() => onAction(gridActions.printCommand!, gridPath ? { navpath: gridPath } : undefined)}
                />
              </Tooltip>
            )}
          </Space>
          )}
          {/* Comandi di layout della griglia, in coda a destra.
              - una-riga: le bande di continuazione diventano colonne, il record
                sta su una linea e si scorre in orizzontale con le prime colonne
                bloccate. Guadagna sull'asse ORIZZONTALE.
              - zoom: collassa testata e barra tab. Guadagna sul VERTICALE. Non è
                un overlay — la griglia non si rimonta, quindi scroll, selezione
                e riga in editing restano dove sono.
              Si compongono, ed entrambi fanno riadattare il page size da solo:
              più record entrano, il client li misura e li chiede al server
              (SetPageSizeCommand, SXADV-5742). */}
          {(canFlatten || canZoom) && (
            <Space size="small" style={{ marginLeft: 'auto' }}>
              {canFlatten && (
                <Tooltip
                  title={oneLine ? 'Torna al record su più righe' : 'Un record per riga (colonne affiancate, prime colonne bloccate)'}
                  placement="bottom"
                >
                  <Button
                    size="small"
                    type={oneLine ? 'primary' : 'default'}
                    icon={oneLine ? <ColumnHeightOutlined /> : <ColumnWidthOutlined />}
                    aria-label={oneLine ? 'Torna al record su più righe' : 'Un record per riga'}
                    aria-pressed={oneLine}
                    onClick={() => setOneLine(gridId as string, !oneLine)}
                  />
                </Tooltip>
              )}
              {canZoom && (
                <Tooltip title={isZoomed ? 'Riduci la griglia (Esc)' : 'Ingrandisci la griglia'} placement="bottom">
                  <Button
                    size="small"
                    type={isZoomed ? 'primary' : 'default'}
                    icon={isZoomed ? <CompressOutlined /> : <ExpandOutlined />}
                    aria-label={isZoomed ? 'Riduci la griglia' : 'Ingrandisci la griglia'}
                    aria-pressed={isZoomed}
                    onClick={() => setZoomedGridId(isZoomed ? null : gridId)}
                  />
                </Tooltip>
              )}
            </Space>
          )}
        </div>
      )}

      {ui.listActions && ui.listActions.length > 0 && (
        <div className="action-bar" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '4px 8px' }}>
          {ui.listActions.map((act: ListAction, i: number) => (
            <Button
              key={i}
              size="small"
              onClick={() => onAction(act.command, { navpath: act.path, ...(act.option ? { option1: act.option } : {}) })}
            >
              {act.label}
            </Button>
          ))}
        </div>
      )}

      <div
        ref={gridContainerRef}
        style={(() => {
          // Top-level list page: fill the route container (has a definite height).
          if (!embedded) {
            return { width: '100%', flex: 1, minHeight: 0 };
          }
          // Embedded grid (form section, tab, or stacked above the in-flow edit
          // panel): FILL the space measured down to the container bottom / the
          // panel top (fillCapHeight — the layout-table ancestors block CSS
          // flex-fill), and let AG Grid scroll internally past it. The 45vh is
          // only the first-paint value, before the layout effect has measured.
          // maxWidth constrains the box to the parent so AG Grid's horizontal
          // scroll kicks in when the columns exceed the viewport.
          return {
            width: '100%',
            maxWidth: '100%',
            height: Math.max(120, fillCapHeight ?? Math.round(window.innerHeight * 0.45)),
            minHeight: 0,
            overflow: 'hidden',
            boxSizing: 'border-box',
          };
        })()}
        onClick={handleGridClick}
      >
        <AgGridReact
          modules={[AllCommunityModule]}
          theme={gridTheme}
          columnDefs={columnDefs}
          defaultColDef={WRAPPING_HEADER_COLDEF}
          rowData={rowData}
          components={cellEditorComponents}
          onGridReady={(params) => { gridApiRef.current = params.api; injectContinuationHeaders(); initGridFormValues(); }}
          context={{ onAction, onChange, headersByField, onBoolToggle: handleBoolToggle, selectorPad: isListEdit && ui.hasDetailView ? SELECTOR_NAV_WIDTH : 0 }}
          onRowClicked={handleRowClicked}
          onCellKeyDown={handleCellKeyDown as any}
          onCellValueChanged={handleCellValueChanged}
          isFullWidthRow={isFullWidthRow}
          fullWidthCellRenderer={fullWidthCellRenderer}
          getRowClass={getRowClass}
          rowHeight={GRID_ROW_HEIGHT}
          getRowHeight={continuationRowFloor}
          suppressRowClickSelection
          suppressCellFocus={!isMultiEdit && !isListEdit}
          singleClickEdit={isMultiEdit || isListEdit}
          enterNavigatesVerticallyAfterEdit
          domLayout={undefined}
          overlayNoRowsTemplate="Nessun record da visualizzare"
        />
      </div>

      {/* Pagination. Only the embedded detail pager lives here: it is the sole
          way to page a one-to-many grid (no toolbar of its own). A top-level list
          gets no footer band at all — its toolbar already carries the very same
          numbers (TableNavigator emits "pag: [n] di N … N righe."), so the band
          was spending a row of grid on a second copy (SXADV-5770.3A). */}
      {showDetailPager && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 8px', borderTop: '1px solid #e8e8e8' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>{pageInfo!.totalRows} record</Text>
          <Pagination
            size="small"
            simple
            current={pageInfo!.currentPage}
            total={pageInfo!.totalRows}
            pageSize={pageInfo!.pageSize}
            showSizeChanger={false}
            onChange={(page) => onAction('DetailPage', { navpath: ui.path!, page: String(page) })}
          />
        </div>
      )}

    </div>
  );
};

export default ListRenderer;
