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
  displayValue?: string;
  reload?: {
    action: string;
    navpath?: string;
    option1?: string;
    option2?: string;
    change?: boolean;
  };
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
  name: string;
  prompt: string;
  sortExpr?: string;
  width?: number;
  cls?: string;
}

export interface ListRow {
  id: string;
  cells: UICell[];
  data?: Record<string, unknown>;
}

export interface UITree {
  rows: UIRow[];
  path?: string;
  pageType?: number; // 0=DETAIL, 1=LIST, 2=QUERY
  breadcrumbs?: string;
  viewName?: string;
  viewType?: string;
  layoutType?: string;
  totalCols?: number;
  title?: string;
  attachments?: string;
}

export interface ToolbarItem {
  id: string;
  text: string;
  icon?: string;
  handler?: string;
  disabled?: boolean;
  menu?: ToolbarItem[];
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
  logoaz?: string[];
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
  text: string;
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
