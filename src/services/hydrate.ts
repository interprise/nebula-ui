import type { UITree, UIRow, UICell, UIControl } from '../types/ui';

/**
 * Two-phase rendering support: the server now emits a stable `template`
 * alongside per-render `values` (keyed by control name) and `dynProps`
 * (keyed by iN slot index). This helper walks the cached template and
 * produces a tree where:
 *   - every `"?iN"` placeholder is replaced with `dynProps[iN]`
 *   - every control's `value` is overlaid from `values[control.name]`
 * The resulting tree has the same shape as a legacy FULL-mode `ui` tree,
 * so the existing ViewRenderer / ControlRenderer consume it unchanged.
 */
const PLACEHOLDER = /^\?i(\d+)$/;

type DynProps = Record<string, unknown>;
type Values = Record<string, unknown>;

function resolvePlaceholder(v: unknown, dynProps: DynProps): unknown {
  if (typeof v !== 'string') return v;
  const m = v.match(PLACEHOLDER);
  if (!m) return v;
  const key = 'i' + m[1];
  return key in dynProps ? dynProps[key] : v;
}

function hydrateControl(control: UIControl, values: Values, dynProps: DynProps): UIControl {
  const src = control as unknown as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  for (const k in src) {
    const orig = src[k];
    const resolved = resolvePlaceholder(orig, dynProps);
    if (resolved !== orig) {
      if (out === null) out = { ...src };
      out[k] = resolved;
    }
  }
  const name = (out ?? src).name as string | undefined;
  if (name && name in values) {
    if (out === null) out = { ...src };
    out.value = values[name];
  }
  return (out ?? src) as unknown as UIControl;
}

function hydrateCell(cell: UICell, values: Values, dynProps: DynProps): UICell {
  let out: UICell | null = null;

  const visibleRaw = cell.visible;
  const visibleResolved = resolvePlaceholder(visibleRaw, dynProps);
  if (visibleResolved !== visibleRaw) {
    out = { ...cell };
    out.visible = visibleResolved as boolean | string | undefined;
  }

  if (cell.control) {
    const hc = hydrateControl(cell.control, values, dynProps);
    if (hc !== cell.control) {
      out = out ?? { ...cell };
      out.control = hc;
    }
  }

  if (cell.rows) {
    const nested = cell.rows.map((r) => hydrateRow(r, values, dynProps));
    if (nested.some((r, i) => r !== cell.rows![i])) {
      out = out ?? { ...cell };
      out.rows = nested;
    }
  }

  return out ?? cell;
}

function hydrateRow(row: UIRow, values: Values, dynProps: DynProps): UIRow {
  const cells = row.cells.map((c) => hydrateCell(c, values, dynProps));
  if (cells.some((c, i) => c !== row.cells[i])) return { ...row, cells };
  return row;
}

/**
 * Produce a hydrated tree from a cached template, applying the given
 * per-render `values` and `dynProps`. Returns the template unchanged if
 * both maps are empty (no data to apply).
 */
export function hydrate(
  template: UITree,
  values: Values | undefined,
  dynProps: DynProps | undefined,
): UITree {
  if ((!values || Object.keys(values).length === 0)
      && (!dynProps || Object.keys(dynProps).length === 0)) {
    return template;
  }
  const v = values ?? {};
  const d = dynProps ?? {};
  const rows = template.rows.map((r) => hydrateRow(r, v, d));
  if (rows.some((r, i) => r !== template.rows[i])) {
    return { ...template, rows };
  }
  return template;
}
