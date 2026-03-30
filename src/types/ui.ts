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
  tabs?: { name: string; prompt: string; selected?: boolean }[];
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
  banners?: {
    text: string;
    banNotification?: boolean;
    banHomePage?: boolean;
    navigateTo?: string;
    notified?: boolean;
  }[];
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
