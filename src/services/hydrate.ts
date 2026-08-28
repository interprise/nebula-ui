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
 *     the current BIND key's binding, so downstream form-post code keys
 *     form data exactly as the server's PostItemVisitor expects.
 *
 * Scope and bind key are tracked separately. `scope` is the DATA path and
 * namespaces value lookups; it is deliberately not unique per embedded view
 * (a content="this" embedding adds nothing to it, and sibling embeddings on
 * one relationship repeat it). `bind` identifies the embedded VIEW and is
 * what the bindings/scopePaths manifests are keyed by — using `scope` there
 * handed those blocks another viewstate's id, so the server never found
 * their parameters and Save reported "Nessuna modifica da salvare"
 * (SXADV-5800).
 * The output tree has the same shape as a legacy FULL-mode `ui` tree, so
 * ViewRenderer / ControlRenderer consume it unchanged.
 */
const PLACEHOLDER = /^\?i(\d+)$/;

// A DATA value is merged into the cached template stub (rather than set as
// `value`) whenever it is a non-array object — i.e. the control emitted its
// entire refreshable descriptor as a structured value. This covers:
//  - container/dynamic controls (detailView, tab, warning, workflowStatus,
//    actionBar, buttonBar, multiselect) and entrasp custom controls;
//  - metadata-split combos (ListUIControl / GenericListUIControl) shipping
//    {value, displayText/displayValue, navigateAdd} per row;
//  - a CodeTable whose table is picked per record (codeTableName="?expr"),
//    shipping {value, codeTableName, options} — the option list belongs to the
//    record, not to the cross-record template;
//  - the unported-control safety net: any control not (yet) metadata-split
//    re-emits its full renderJSON descriptor in listDataMode DATA mode.
// Scalar values (string/number/bool/null — e.g. a statically-named
// CodeTableUIControl's bare code) fall through to `out.value` unchanged.

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
  bindScope: string,
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
  const navpath = scopePaths[bindScope];
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
    // Flat navpath on the control itself, refreshed from the per-tab scope
    // path. Two cases:
    //  - Standalone action/link controls (navigateView, navigateViewButton,
    //    add, lookup, windowButton, button) bake `navpath = mVS.getPath()`
    //    into the cached template. A reused template freezes it at the
    //    viewstate id from first-cache, so it goes stale on later navigations
    //    and the link dispatches against a dead viewstate — the click looks
    //    dead (SXADV-5474). Overwrite it with the current scope path.
    //  - Reload-trigger controls carry no navpath in the template; fill it in.
    // Structured-value controls (actionBar, tab, multiselect, …) re-emit their
    // descriptor in DATA mode and get navpath overwritten by the value merge
    // below, so this is a no-op for them.
    if (typeof src.navpath === 'string') {
      if (src.navpath !== navpath) {
        if (out === null) out = { ...src };
        out.navpath = navpath;
      }
    } else if (src.reload) {
      if (out === null) out = { ...src };
      out.navpath = navpath;
    }
  }

  const bareName = (out ?? src).name as string | undefined;
  if (bareName) {
    // Value lookup uses the structural path (scope + bare name).
    const valueKey = scope ? scope + '.' + bareName : bareName;
    if (valueKey in values) {
      const v = values[valueKey];
      // A structured DATA value (any non-array object) is the control's entire
      // refreshable descriptor — merge it; a plain scalar sets `value` (see the
      // note by the top-of-file type comment).
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (out === null) out = { ...src };
        Object.assign(out, v as Record<string, unknown>);
      } else {
        if (out === null) out = { ...src };
        out.value = v;
      }
    }
    // Compose wire-form name for form posts. Falls back to the bare name
    // when no binding is known — preserves legacy behavior on cache miss.
    // Idempotent: unported controls (ListUIControl, …) bake the wire-form
    // name into the template via full-mode renderJSON (getControlName =
    // controlName + "." + viewstateId), violating the "templates carry bare
    // names" contract. Appending unconditionally then doubled the suffix
    // (valuta.S1-26.S1-26), corrupting form-post keys and lookup option1.
    // Skip when the id is already present.
    const vsId = bindings[bindScope];
    if (vsId && !bareName.endsWith('.' + vsId)) {
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
  bindScope: string,
): UICell {
  let out: UICell | null = null;

  const visibleRaw = cell.visible;
  const visibleResolved = resolvePlaceholder(visibleRaw, dynProps);
  if (visibleResolved !== visibleRaw) {
    out = { ...cell };
    out.visible = visibleResolved as boolean | string | undefined;
  }

  if (cell.control) {
    const hc = hydrateControl(cell.control, values, dynProps, bindings, scopePaths, scope, bindScope);
    if (hc !== cell.control) {
      out = out ?? { ...cell };
      out.control = hc;
    }
  }

  if (cell.rows) {
    const innerScope = cell.scope != null ? cell.scope : scope;
    // `bind` is emitted by every embedded view, including the ones that carry
    // no `scope` (content="this"). Fall back to `scope` for templates from a
    // server that predates the split, then to the inherited key.
    const innerBind = cell.bind != null ? cell.bind : cell.scope != null ? cell.scope : bindScope;
    const nested = cell.rows.map((r) => hydrateRow(r, values, dynProps, bindings, scopePaths, innerScope, innerBind));
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
  bindScope: string,
): UIRow {
  const cells = row.cells.map((c) => hydrateCell(c, values, dynProps, bindings, scopePaths, scope, bindScope));
  if (cells.some((c, i) => c !== row.cells[i])) return { ...row, cells };
  return row;
}

/**
 * Produce a hydrated tree from a cached template.
 * @param template    sid-free UI tree (cacheable across tabs/sessions).
 * @param values      field values keyed by structural path (scope.name).
 * @param dynProps    evaluated dynamic expression slots (iN).
 * @param bindings    per-tab bind-key → viewstate-id map for wire-form name
 *                    composition. Empty map leaves names bare (cache miss).
 * @param scopePaths  per-tab bind-key → navpath map. Injects navpath into
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
  const rows = template.rows.map((r) => hydrateRow(r, v, d, b, sp, '', ''));
  if (rows.some((r, i) => r !== template.rows[i])) {
    return { ...template, rows };
  }
  return template;
}
