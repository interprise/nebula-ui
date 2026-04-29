import { registerControls, registerCellRenderable, listControlTypes } from '../registry';
import { EXPECTED_CONTROL_TYPES } from '../expectedTypes';
import TextControl from './TextControl';
import { NumberControl, MoneyControl } from './NumberControl';
import { DateControl, TimeControl, TimestampControl, DurataControl } from './DateControl';
import BooleanControl from './BooleanControl';
import ComboControl from './ComboControl';
import MultiSelectBuiltin from './MultiSelectBuiltin';
import TextAreaControl from './TextAreaControl';
import HtmlAreaControl from './HtmlAreaControl';
import ExpBuilderBuiltin from './ExpBuilderBuiltin';
import PasswordControl from './PasswordControl';
import {
  ButtonControl,
  ActionControl,
  WindowButtonControl,
  LookupControl,
  NavigateViewControl,
  AddControl,
  UploadControl,
  DownloadControl,
} from './ButtonControls';
import {
  BarcodeControl,
  UrlControl,
  HtmlControl,
  HtmlFormatControl,
  HintControl,
  HighlightControl,
  WarningControl,
} from './DisplayControls';
import { ActionBarControl, ButtonBarControl } from './BarControls';
import WorkflowStatusControl from './WorkflowStatusControl';
import OlapCubeBuiltin from './OlapCubeBuiltin';
import {
  AttachmentsControl,
  BpmStatusControl,
  ImageFormatControl,
  NavigateViewButtonControl,
  PathControl,
  PopupUrlControl,
  UploadButtonControl,
} from './MiscControls';
// NOTE: entrasp custom controls (allegati, array, assegnazioni, cdmsClass,
// consuntivazione, contatti, disponibilita, gestorePrivilegi, lgtcCalendario,
// partitario, promptBuilder, reportBar, richOffAtt, ruoli, sottoconti,
// varianti) live in the entrasp-controls plugin (entrasp/react-plugins/
// entrasp-controls) which loads after this registry and would override any
// entries here. Register them there, not here.

/** Register all CORE (framework) control types. Call once at app startup. */
export function registerBuiltinControls(): void {
  registerControls({
    text: TextControl,
    password: PasswordControl,
    number: NumberControl,
    money: MoneyControl,
    date: DateControl,
    time: TimeControl,
    timestamp: TimestampControl,
    durata: DurataControl,
    boolean: BooleanControl,
    checkbox: BooleanControl,
    combo: ComboControl,
    multiselect: MultiSelectBuiltin,
    textarea: TextAreaControl,
    htmlarea: HtmlAreaControl,
    expbuilder: ExpBuilderBuiltin,
    button: ButtonControl,
    action: ActionControl,
    windowButton: WindowButtonControl,
    lookup: LookupControl,
    navigateView: NavigateViewControl,
    add: AddControl,
    upload: UploadControl,
    download: DownloadControl,
    barcode: BarcodeControl,
    url: UrlControl,
    html: HtmlControl,
    htmlFormat: HtmlFormatControl,
    hint: HintControl,
    highlight: HighlightControl,
    warning: WarningControl,
    actionBar: ActionBarControl,
    buttonBar: ButtonBarControl,
    workflowStatus: WorkflowStatusControl,
    olapCube: OlapCubeBuiltin,
    // Phase 1b new types
    attachments: AttachmentsControl,
    bpmStatus: BpmStatusControl,
    imageFormat: ImageFormatControl,
    navigateViewButton: NavigateViewButtonControl,
    path: PathControl,
    popupUrl: PopupUrlControl,
    uploadButton: UploadButtonControl,
    // Phase 1b inheritors: reuse existing text/boolean renderers
    alternateKey: TextControl,
    colorPalette: TextControl,
    toggleVisibilityFilter: BooleanControl,
    visibilityFilter: BooleanControl,
    // entrasp-specific types register from the plugin (see note above).
  });
  registerCellRenderable('workflowStatus');
  auditRegistry();
}

/** Compare registered control types against the canonical expected list.
 *  Logs to console when drift is detected so missing renderers or orphaned
 *  registrations are surfaced at app startup rather than on first hit. */
function auditRegistry(): void {
  const registered = new Set(listControlTypes());
  const expected = new Set<string>(EXPECTED_CONTROL_TYPES);
  const missing = [...expected].filter((t) => !registered.has(t));
  const extra = [...registered].filter((t) => !expected.has(t));
  if (missing.length > 0) {
    console.error('[controls] EXPECTED types with no renderer:', missing);
  }
  if (extra.length > 0) {
    console.warn('[controls] Registered types not in expected list (add to expectedTypes.ts):', extra);
  }
}
