/** Canonical list of CORE `type` strings that must be registered by the
 *  builtins bundle. App-specific types (e.g. entrasp/* custom controls) are
 *  owned by their own plugin bundles and audited there — the plugin loader
 *  runs after builtins and may override any builtin registration.
 *
 *  If you add a new CORE UIControl on the server with a new getJsonType(),
 *  add it here and register a renderer in `builtins/index.ts`. The runtime
 *  check in `registerBuiltinControls()` asserts every expected type has a
 *  renderer.
 *
 *  Composite types (tab, embeddedView, detailView) are intentionally omitted —
 *  they're handled at the row level by ViewRenderer, not the leaf registry. */
export const EXPECTED_CONTROL_TYPES = [
  // CORE leaf controls
  'action',
  'actionBar',
  'add',
  'alternateKey',
  'attachments',
  'barcode',
  'boolean',
  'bpmStatus',
  'button',
  'buttonBar',
  'checkbox',
  'colorPalette',
  'combo',
  'date',
  'download',
  'durata',
  'expbuilder',
  'highlight',
  'hint',
  'html',
  'htmlarea',
  'htmlFormat',
  'imageFormat',
  'lookup',
  'money',
  'multiselect',
  'navigateView',
  'navigateViewButton',
  'number',
  'olapCube',
  'password',
  'path',
  'popupUrl',
  'text',
  'textarea',
  'time',
  'timestamp',
  'toggleVisibilityFilter',
  'uploadButton',
  'upload',
  'url',
  'visibilityFilter',
  'warning',
  'windowButton',
  'workflowStatus',
] as const;

export type ExpectedControlType = typeof EXPECTED_CONTROL_TYPES[number];
