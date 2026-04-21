import type { UITree, UIRow, UICell, UIControl } from '../types/ui';

/**
 * Two-phase rendering: the server emits a sid-free template alongside a
 * values map (keyed by structural path `scope.controlName`), a dynProps
 * map (keyed by iN slots), and a per-tab `bindings` manifest that maps
 * each structural scope to its viewstate id. This helper walks the
 * cached template and returns a tree where every control has:
 *   - placeholders like `"?iN"` replaced with `dynProps[iN]`
 *   - `value` overlaid from `values[scope.controlName]`
 *   - `name` composed to the wire form `controlName.viewstateId` using
 *     the current scope's binding, so downstream form-post code keys
 *     form data exactly as the server's PostItemVisitor expects.
 * The output tree has the same shape as a legacy FULL-mode `ui` tree, so
 * ViewRenderer / ControlRenderer consume it unchanged.
 */
const PLACEHOLDER = /^\?i(\d+)$/;

// Control types whose full descriptor is re-emitted in DATA mode and
// merged (not overwritten as `value`) into the cached template stub.
const STRUCTURED_VALUE_TYPES = new Set([
  'detailView', 'tab', 'warning', 'workflowStatus', 'actionBar', 'buttonBar',
]);

function isStructuredValueType(type: string | undefined): boolean {
  return type !== undefined && STRUCTURED_VALUE_TYPES.has(type);
}

type DynProps = Record<string, unknown>;
type Values = Record<string, unknown>;
type Bindings = Record<string, string>;
type ScopePaths = Record<string, string>;

function resolvePlaceholder(v: unknown, dynProps: DynProps): unknown {
  if (typeof v !== 'string') return v;
  const m = v.match(PLACEHOLDER);
  if (!m) return v;
  const key = 'i' + m[1];
  return key in dynProps ? dynProps[key] : v;
}

function hydrateControl(
  control: UIControl,
  values: Values,
  dynProps: DynProps,
  bindings: Bindings,
  scopePaths: ScopePaths,
  scope: string,
): UIControl {
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

  // Inject navpath into nav/add descriptors + reload-on-change info from
  // the per-tab scopePaths manifest. The server emits these structurally
  // (navpath-free) so templates stay cross-tab cacheable.
  const navpath = scopePaths[scope];
  if (navpath) {
    const srcNav = src.navigateView as Record<string, unknown> | undefined;
    if (srcNav && !srcNav.navpath) {
      if (out === null) out = { ...src };
      out.navigateView = { ...srcNav, navpath };
    }
    const srcAdd = src.navigateAdd as Record<string, unknown> | undefined;
    if (srcAdd && !srcAdd.navpath) {
      if (out === null) out = { ...src };
      out.navigateAdd = { ...srcAdd, navpath };
    }
    // Reload info lives as flat fields on the control; fill in navpath
    // for controls that advertise a reload trigger.
    if (src.reload && !src.navpath) {
      if (out === null) out = { ...src };
      out.navpath = navpath;
    }
  }

  const bareName = (out ?? src).name as string | undefined;
  const type = (out ?? src).type as string | undefined;
  if (bareName) {
    // Value lookup uses the structural path (scope + bare name).
    const valueKey = scope ? scope + '.' + bareName : bareName;
    if (valueKey in values) {
      const v = values[valueKey];
      // Container/dynamic controls emit their entire refreshable descriptor
      // as a structured value — merge it into the template's descriptor so
      // static stubs (type, name) coexist with per-render content
      // (tabs, rows, actions, buttons, html, state, ...).
      if (isStructuredValueType(type) && v && typeof v === 'object' && !Array.isArray(v)) {
        if (out === null) out = { ...src };
        Object.assign(out, v as Record<string, unknown>);
      } else {
        if (out === null) out = { ...src };
        out.value = v;
      }
    }
    // Compose wire-form name for form posts. Falls back to the bare name
    // when no binding is known — preserves legacy behavior on cache miss.
    const vsId = bindings[scope];
    if (vsId) {
      if (out === null) out = { ...src };
      out.name = bareName + '.' + vsId;
    }
  }

  return (out ?? src) as unknown as UIControl;
}

function hydrateCell(
  cell: UICell,
  values: Values,
  dynProps: DynProps,
  bindings: Bindings,
  scopePaths: ScopePaths,
  scope: string,
): UICell {
  let out: UICell | null = null;

  const visibleRaw = cell.visible;
  const visibleResolved = resolvePlaceholder(visibleRaw, dynProps);
  if (visibleResolved !== visibleRaw) {
    out = { ...cell };
    out.visible = visibleResolved as boolean | string | undefined;
  }

  if (cell.control) {
    const hc = hydrateControl(cell.control, values, dynProps, bindings, scopePaths, scope);
    if (hc !== cell.control) {
      out = out ?? { ...cell };
      out.control = hc;
    }
  }

  if (cell.rows) {
    const innerScope = cell.scope != null ? cell.scope : scope;
    const nested = cell.rows.map((r) => hydrateRow(r, values, dynProps, bindings, scopePaths, innerScope));
    if (nested.some((r, i) => r !== cell.rows![i])) {
      out = out ?? { ...cell };
      out.rows = nested;
    }
  }

  return out ?? cell;
}

function hydrateRow(
  row: UIRow,
  values: Values,
  dynProps: DynProps,
  bindings: Bindings,
  scopePaths: ScopePaths,
  scope: string,
): UIRow {
  const cells = row.cells.map((c) => hydrateCell(c, values, dynProps, bindings, scopePaths, scope));
  if (cells.some((c, i) => c !== row.cells[i])) return { ...row, cells };
  return row;
}

/**
 * Produce a hydrated tree from a cached template.
 * @param template    sid-free UI tree (cacheable across tabs/sessions).
 * @param values      field values keyed by structural path (scope.name).
 * @param dynProps    evaluated dynamic expression slots (iN).
 * @param bindings    per-tab scope → viewstate-id map for wire-form name
 *                    composition. Empty map leaves names bare (cache miss).
 * @param scopePaths  per-tab scope → navpath map. Injects navpath into
 *                    navigateView/navigateAdd descriptors at render time.
 */
export function hydrate(
  template: UITree,
  values: Values | undefined,
  dynProps: DynProps | undefined,
  bindings: Bindings | undefined,
  scopePaths: ScopePaths | undefined,
): UITree {
  const v = values ?? {};
  const d = dynProps ?? {};
  const b = bindings ?? {};
  const sp = scopePaths ?? {};
  if (Object.keys(v).length === 0 && Object.keys(d).length === 0
      && Object.keys(b).length === 0 && Object.keys(sp).length === 0) {
    return template;
  }
  const rows = template.rows.map((r) => hydrateRow(r, v, d, b, sp, ''));
  if (rows.some((r, i) => r !== template.rows[i])) {
    return { ...template, rows };
  }
  return template;
}
