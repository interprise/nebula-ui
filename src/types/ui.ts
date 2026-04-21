export interface UIControl {
  type: string;
  name?: string;
  id?: string;
  editable?: boolean;
  hint?: string;
  cls?: string;
  mandatory?: boolean;
  tabStop?: boolean;
  value?: unknown;
  // Allow extra properties from custom server controls
  [key: string]: unknown;
  displayValue?: string;
  reload?: string; // reload trigger: "true" or "change"
  command?: string; // command for reload (default "Post")
  navpath?: string; // navigation path for reload
  option1?: string; // option1 for reload
  // text
  size?: number;
  maxLength?: number;
  pattern?: string;
  // number / money
  decimals?: number;
  format?: string;
  currencySymbol?: string;
  // combo
  options?: { value: string; text: string }[];
  codeTableName?: string;
  remote?: boolean;
  // textarea
  rows?: number;
  cols?: number;
  // tab
  tabs?: {
    name: string;
    prompt: string;
    selected?: boolean;
    badge?: string;
    contentViewName?: string;
    configureIcon?: { included: boolean; itemId: string };
  }[];
  // button / action
  action?: string;
  icon?: string;
  prompt?: string;
  disabled?: boolean;
  // navigate
  targetViewName?: string;
  // post-decorations: navigation icons next to field
  navigateView?: { command: string; navpath: string; controlName: string };
  navigateAdd?: { command: string; navpath: string; controlName: string };
  navigateLookupCommand?: string; // lookup search action (e.g. "NavigateLookup")
  lookupViewName?: string;
  // documentation mode: icon to edit/view help text for this field
  docIcon?: { hasHelp: boolean; viewName: string; itemId: string };
  // configuration mode: green/red dot to include/exclude item per customer
  configureIcon?: { included: boolean; itemId: string };
  // post-decoration extras
  postPrompt?: string; // text displayed after the field
  negation?: boolean; // field supports NOT checkbox on query pages
  negationValue?: boolean; // current NOT checkbox state
  mandatoryIcon?: 'sequence'; // sequence fields get numbered-list icon instead of star
  // embedded / detail view
  contentViewName?: string;
  contentRows?: UIRow[];
  // window button
  openWin?: boolean;
  // list columns
  columns?: ListColumn[];
  listRows?: ListRow[];
  addButton?: { action: string; prompt: string };
}

export interface UICell {
  id?: string;
  colspan?: number;
  rowspan?: number;
  cls?: string;
  style?: string;
  elementType: number;
  prompt?: string;
  promptCls?: string;
  control?: UIControl;
  text?: string; // section header
  rows?: UIRow[]; // nested rows for ELTYPE_CONTAINER cells with an embedded layout
  // Two-phase pipeline: "visible" may be a literal boolean or a "?iN"
  // placeholder resolved from dynProps at render time. The ViewRenderer
  // omits a cell when this resolves to false.
  visible?: boolean | string;
  // Scope marker emitted by embedded views. The hydrate walker pushes this
  // structural scope path when descending into cell.rows so field value
  // lookups use the scope-prefixed key and control.name is composed from
  // the per-tab binding manifest.
  scope?: string;
}

export interface UIRow {
  id: string;
  cls?: string;
  cells: UICell[];
}

export interface ListColumn {
  elementType: number;
  control?: UIControl;
  selector?: {
    command: string;
    basePath: string;
    canEdit?: boolean;
    canDelete?: boolean;
  };
}

export interface ListRow {
  id: string;
  cells: UICell[];
  data?: Record<string, unknown>;
  props?: Record<string, unknown>; // dynamic row properties (e.g. i0, i1 for editable expressions)
}

export interface ListHeader {
  text: string;
  sortExpression?: string;
  sortDir?: 'asc' | 'desc';
  sortPosition?: number;
  hint?: string;
  cls?: string;
  type?: string; // 'selector' for row selector column
  colspan?: number;
  configureIcon?: { included: boolean; itemId: string };
}

export interface ListMeta {
  title?: string;
  path?: string;
  recordCount?: number;
  position?: number;
  pageSize?: number;
  addCommand?: string;
  addLabel?: string;
}

export interface ListFooter {
  addCommand: string;
  path?: string;
  label?: string;
}

export interface ListAction {
  label: string;
  command: string;
  path: string;
  option?: string;
}

export interface UITree {
  rows: UIRow[];
  path?: string;
  pageType?: number; // 0=QUERY, 1=LIST, 2=DETAIL
  multiEdit?: boolean;
  listEdit?: boolean;
  documenting?: boolean;
  breadcrumbs?: string;
  viewName?: string;
  viewType?: string;
  layoutType?: string;
  totalCols?: number;
  totalWidth?: number;
  title?: string;
  attachments?: string;
  headers?: ListHeader[];
  header?: ListMeta;
  footer?: ListFooter;
  columns?: ListColumn[];
  continuationHeaders?: ListHeader[][];
  listActions?: ListAction[];
  pageOnly?: boolean;
  rowUpdate?: boolean; // incremental: single row update, merge into existing grid
  position?: number; // row position for rowUpdate
  // Two-phase pipeline (form/detail views):
  // dataOnly=true marks a slim response body carrying only `values` + `dynProps`
  // that the client applies to its cached template keyed by `templateKey`.
  dataOnly?: boolean;
  templateKey?: string;
  values?: Record<string, unknown>;
  dynProps?: Record<string, unknown>;
  // Tree view
  treeNodes?: TreeNode[];
  navigateView?: string;
  paging?: {
    currentPage: number;
    totalPages: number;
    totalRows: number;
    position: number;
    pageSize: number;
  };
}

export interface ToolbarItem {
  id: string;
  text: string;
  tooltip?: string;
  icon?: string;
  handler?: string;
  disabled?: boolean;
  pressed?: boolean; // toggle button state
  menu?: ToolbarItem[] | { items: ToolbarItem[] };
  keys?: string;
  shift?: boolean;
}

export interface JSCheck {
  type?: string;
  mandatory?: boolean;
  min?: number;
  max?: number;
  pattern?: string;
}

export interface NavMapEntry {
  navpath?: string;
  option1?: string;
  command?: string;
  change?: boolean;
}

export interface UIData {
  jsChecks?: Record<string, JSCheck>;
  scrollPos?: number;
  refreshInterval?: number;
  progressMap?: Record<string, string>;
  controls?: UIControl[];
  navMap?: Record<string, NavMapEntry>;
  thumbs?: string[];
  upload?: string;
  ckeditor?: boolean;
  trackAsynchJob?: boolean;
  showProgress?: boolean;
  callback?: string;
}

export interface ErrorItem {
  type: 'ERROR' | 'WARNING' | 'INFO' | 'CONFIRMATION' | 'YESNOCANCEL' | 'NOTIFICATION';
  message: string;
  mnemonic?: string;
}

export interface LoginInfo {
  login: string;
  profile: string;
  customerKey: string;
  partitionKey?: string;
  sede?: string;
  aziende?: { value: string; text: string }[];
  sedi?: { value: string; text: string }[];
  title?: string;
  bkColor?: string;
  logoaz?: string;
  dbVersion?: string;
  cdms?: boolean;
  emailSent?: boolean;
  agendaList?: boolean;
  avvisi?: boolean;
  areaDocumenti?: boolean;
  notifications?: boolean;
  assistenza?: boolean;
  banners?: Banner[];
}

export interface Banner {
  text: string;            // short text for browser notification
  hpText?: string;         // longer text for home page (may contain HTML)
  banDate?: string;        // creation date (ISO / formatted string)
  banNotification?: boolean;
  banHomePage?: boolean;
  navigateTo?: string;     // command / menuId to navigate to on click
  notified?: boolean;      // client-side: already shown as notification
  linkEsterno1?: string; linkEsternoDescr1?: string;
  linkEsterno2?: string; linkEsternoDescr2?: string;
  linkEsterno3?: string; linkEsternoDescr3?: string;
}

export interface MenuItem {
  id: string;
  description: string;
  children?: MenuItem[];
  leaf?: boolean;
  iconCls?: string;
}

export interface ServerResponse {
  ui?: UITree;
  // Two-phase pipeline: on a fresh navigation that opts in, the server
  // returns a stable `template` alongside flat `values` + `dynProps`. The
  // client caches the template by `templateKey` and, on subsequent requests,
  // asserts it to get DATA-only responses (where the data arrives as
  // ui.dataOnly + ui.values + ui.dynProps).
  template?: UITree;
  templateKey?: string;
  values?: Record<string, unknown>;
  dynProps?: Record<string, unknown>;
  // Binding manifest: structural scope path -> viewstate id, emitted
  // alongside METADATA responses. Per-tab state used to compose wire-form
  // control names for form posts.
  bindings?: Record<string, string>;
  path?: string;
  toolbar?: ToolbarItem[];
  currField?: string;
  uiData?: UIData;
  errors?: ErrorItem[];
  loginfo?: LoginInfo;
  notLoggedIn?: boolean;
  suspended?: boolean;
  sid?: string;
  children?: MenuItem[];
  redirect?: string;
  trackAsynchJob?: boolean;
  progress?: number;
  context?: Record<string, unknown>;
  toggleItem?: { itemId: string; included: boolean };
}

export interface TreeNode {
  key: string;
  title: string;
  hint?: string;
  isLeaf?: boolean;
  matched?: boolean; // true for nodes matching a search filter
  children?: TreeNode[];
}

// Element type constants matching LayoutElement Java constants
export const ELTYPE_PROMPT = 0;
export const ELTYPE_CONTENT = 1;
export const ELTYPE_SECTION_HEADER = 3;
export const ELTYPE_SECTION_CONTENT = 4;
export const ELTYPE_SELECTOR = 5;
export const ELTYPE_INDENT = 6;
export const ELTYPE_FILLER = 7;
export const ELTYPE_CONTAINER = 8;
export const ELTYPE_DUMMY = 9;
