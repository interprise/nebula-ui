export interface UIControl {
  type: string;
  name?: string;
  id?: string;
  editable?: boolean;
  hint?: string;
  cls?: string;
  style?: string; // per-cell inline CSS from ViewItem contentStyle (list cells)
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

/** Instant edit-panel per-record data: the panel form rendered in DATA mode
 *  against this record's BO. `values` keyed by structural path (scope.name),
 *  `dynProps` keyed by iN (the panel catalog's disjoint slot range). The client
 *  hydrates the cached panelTemplate with these on row selection — no round-trip. */
export interface RowEditData {
  values?: Record<string, unknown>;
  dynProps?: Record<string, unknown>;
}

/** Cacheable edit-panel FORM template (bare names, ?iN placeholders) shipped on
 *  a listEdit list. Hydrated per row with {@link RowEditData}. */
export interface PanelTemplate {
  rows: UIRow[];
  templateKey?: string;
  /** scope -> viewstate id, for wire-form field-name composition on POST. */
  bindings?: Record<string, string>;
  /** scope -> navpath, for nav/reload descriptors; the client overrides the
   *  root ("") entry with the selected row's path at hydration time. */
  scopePaths?: Record<string, string>;
}

export interface UIRow {
  id: string;
  cls?: string;
  cells: UICell[];
  /** Instant edit-panel data for this record (emitted on the primary grid row
   *  of a listEdit list). */
  editData?: RowEditData;
}

/** One selectable record reported by ListRenderer to the edit panel: its
 *  selector navpath plus onboard edit data. Lets the panel hydrate on selection
 *  and step prev/next without a round-trip. */
export interface ListRecord {
  path: string;
  editData?: RowEditData;
}

export interface ListColumn {
  elementType: number;
  control?: UIControl;
  selector?: {
    command: string;
    basePath: string;
    canEdit?: boolean;
    canDelete?: boolean;
    /** Dynamic updatable rule (updatable="?expr"): false when read-only for the
     *  current object even though listEdit/canEdit are true. Gates the edit panel. */
    canUpdate?: boolean;
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
  /** `content` del ViewItem — identità della colonna, per riferirla per nome in
   *  `pinnedCols`. A volte è un'espressione: per quello c'è anche `tag`. */
  name?: string;
  /** `tag` del ViewItem, la scorciatoia comoda quando il content è
   *  un'espressione. `pinnedCols` accetta l'uno o l'altro. */
  tag?: string;
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
  subtitle?: string; // applied-filter description under the title (SXADV-5484)
  path?: string;
  recordCount?: number;
  position?: number;
  pageSize?: number;
  /** See `paging.adaptivePageSize`. Emitted here too because a FULL render — the
   *  one that opens the list — carries its paging numbers in this header and has
   *  no `paging` object at all (SXADV-5742). */
  adaptivePageSize?: boolean;
  /** Colonne da bloccare a sinistra nella modalità un-record-per-riga. Due
   *  sintassi: un numero (`pinnedCols="3"`, 0 = nessun blocco) oppure un elenco
   *  di `content`/`tag` separati da virgola (`pinnedCols="codice,descrizione"`),
   *  che è l'unico modo di bloccare una colonna che sta in una riga di
   *  continuazione. Default lato server: 2. */
  pinnedCols?: number | string;
  addCommand?: string;
  addLabel?: string;
}

/** Action bar of an embedded list (detail grid / tab): Add + XLS export +
 *  dynamic report, emitted once per embedded list and rendered above the grid
 *  in the primary-toolbar style (SXADV-5693). Supersedes the scattered
 *  header/footer Add buttons the legacy renderer emitted below the grid. */
export interface GridActions {
  path?: string;
  addCommand?: string;
  addLabel?: string;
  xlsCommand?: string;
  printCommand?: string;
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

export interface AttachmentMeta {
  key: string;
  fileName: string;
  /** Lookup-list description from the BO (e.g. CdmsRisorse "list" lookup),
   *  falls back to the BO's default description if non-empty. Often more
   *  informative than the raw file name. */
  description?: string;
  size?: number;
  lastModified?: number;
  contentType?: string;
}

export interface AttachmentsInfo {
  count: number;
  allowAdd: boolean;
  allowList: boolean;
  allowDelete: boolean;
  cdmsActive: boolean;
  single?: AttachmentMeta | null;
}

export interface UITree {
  rows: UIRow[];
  path?: string;
  pageType?: number; // 0=QUERY, 1=LIST, 2=DETAIL
  multiEdit?: boolean;
  listEdit?: boolean;
  /** listEdit rows edited as detail form (true) vs in-list cells (false). */
  inlineEdit?: boolean;
  /** Detail view bound to the list, when set: Add navigates to it (inlineEdit=false)
   *  and the edit panel can host its form (inlineEdit=true). */
  detailViewName?: string;
  hasDetailView?: boolean;
  /** Instant edit panel: cacheable form template + its key, shipped on a
   *  listEdit list. The client hydrates it per selected row from row.editData. */
  panelTemplate?: PanelTemplate;
  panelTemplateKey?: string;
  documenting?: boolean;
  /** The record on screen is an unsaved new one (server insert state). The
   *  split layout opens with the testata expanded so the fields to fill in are
   *  visible without a click (SXADV-5691). */
  newRecord?: boolean;
  breadcrumbs?: string;
  viewName?: string;
  viewType?: string;
  layoutType?: string;
  totalCols?: number;
  totalWidth?: number;
  title?: string;
  attachmentsInfo?: AttachmentsInfo | null;
  headers?: ListHeader[];
  header?: ListMeta;
  footer?: ListFooter;
  gridActions?: GridActions;
  columns?: ListColumn[];
  continuationHeaders?: ListHeader[][];
  listActions?: ListAction[];
  pageOnly?: boolean;
  // Slim pagination update for a single embedded one-to-many detail grid.
  // Carries `path` (the embedded child view state) + `rows` + `paging`; the
  // client swaps that grid's page in place without re-rendering the detail form.
  detailPageOnly?: boolean;
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
    /** The server allows this list's page size to follow the number of rows that
     *  fit on screen (SXADV-5742). Absent on views that declare their own
     *  pageSize — and on any server older than the SetPageSize command, which is
     *  what keeps the client from calling an action that isn't there. */
    adaptivePageSize?: boolean;
    /** Vedi `header.pinnedCols`: ripetuto qui perché i due oggetti vivono su
     *  percorsi di render diversi. */
    pinnedCols?: number | string;
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
  /** Acceleratore da tastiera. `Toolbar.graphicButton` (CORE) lo emette come
   *  array JSON di keyCode in stile ExtJS — qui era dichiarato `string`, e il
   *  tooltip ci finiva dentro il numero grezzo. Vedi `toolbarKeys.ts`. */
  keys?: number[] | number | string;
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
  // Server-driven "open this URL" directive emitted by workflow navigateUrl
  // events (e.g. visualizzaFE → VisFE styled-XML viewer). The client opens it
  // in a new window/tab, mirroring the legacy doAction handler (SXADV-5457.3).
  openUrl?: string;
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
  brand?: string;          // "Pandora" | "Nebula" — server-driven branding
  bkColor?: string;
  logoaz?: string;
  dbVersion?: string;      // e.g. "1.560.10#d" — header release indicator (rendered with a "Rel." prefix)
  alfa?: boolean;          // true when the server runs in the ALFA (test) environment — drives the ALFA header badge
  copyright?: string;      // utilita.copyright — e.g. "Sixtema Spa", rendered as "© <copyright>" at the bottom of the view
  // False when an external IdP (SSO) owns the credentials: the change-password
  // function is not offered at all. Absent means "supported" (local login).
  changePassword?: boolean;
  cdms?: boolean;
  cdmsAdmin?: boolean;     // documentale administrator — gates nuovo albero / profili / utenti in the documentale app bar
  wikiUrl?: string;         // documentation wiki (run property wiki.url.<runMode>); absent when not configured
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
  // Server (Utenti.getBanners) packs both file attachments AND the external
  // links (linkEsterno1..3 + descriptions) into a single HTML string under
  // `attachments` — it does NOT emit the linkEsterno* fields discretely. This
  // is the "Area Link"/download area shown under the banner (SXADV-5526.2).
  attachments?: string;
  // Legacy discrete fields — not emitted by the current server, kept for typing.
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
  // Parallel manifest: scope path -> navpath. Used to populate the
  // navpath field on nav/add icon descriptors during hydration.
  scopePaths?: Record<string, string>;
  // Breadcrumbs vary per-navigation, so the server emits them on the
  // response root (not inside the cached template) and the client
  // merges them into the hydrated UI.
  breadcrumbs?: string;
  // Same pattern as breadcrumbs: per-record, not part of the cached
  // template. Server emits at response root; client merges into ui.
  attachmentsInfo?: AttachmentsInfo | null;
  // Per-record too: the detail on screen is an unsaved new record (insert
  // state). Drives the initial testata/tabs split (SXADV-5691).
  newRecord?: boolean;
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
