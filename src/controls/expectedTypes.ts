/** Canonical list of control `type` strings the server is expected to emit.
 *  Sourced from:
 *    - CORE UIControl subclasses with getJsonType() (it.interprise.core.*UIControl)
 *    - entrasp custom UIControls (it.interprise.entrasp.view.*UIControl)
 *
 *  If you add a new UIControl on the server with a new getJsonType(), add it
 *  here and register a renderer in `builtins/index.ts`. The runtime check in
 *  `registerBuiltinControls()` asserts every expected type has a renderer.
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
  // entrasp custom controls (ported or placeholder)
  'allegati',
  'array',
  'assegnazioni',
  'cdmsClass',
  'consuntivazione',
  'contatti',
  'disponibilita',
  'gestorePrivilegi',
  'lgtcCalendario',
  'partitario',
  'promptBuilder',
  'reportBar',
  'richOffAtt',
  'ruoli',
  'sottoconti',
  'varianti',
] as const;

export type ExpectedControlType = typeof EXPECTED_CONTROL_TYPES[number];
