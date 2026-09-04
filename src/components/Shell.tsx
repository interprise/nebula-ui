import React, { useState, useCallback, useRef, useMemo, useEffect, Suspense } from 'react';
import { Layout, Menu, Tabs, Breadcrumb, Badge, Dropdown, Space, Typography, App, Modal, Input, Button, Tooltip, Select, Spin, ConfigProvider } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  LogoutOutlined,
  UserOutlined,
  SearchOutlined,
  LockOutlined,
  MailOutlined,
  CalendarOutlined,
  PrinterOutlined,
  QuestionCircleOutlined,
  AppstoreOutlined,
  FileTextOutlined,
  BellOutlined,
  BulbOutlined,
  NotificationOutlined,
  TeamOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  BuildOutlined,
  SettingOutlined,
  SafetyOutlined,
  SafetyCertificateOutlined,
  IdcardOutlined,
  CalculatorOutlined,
  ApartmentOutlined,
  CarOutlined,
  TagsOutlined,
  BarChartOutlined,
  HomeOutlined,
  ControlOutlined,
  ShoppingCartOutlined,
  ShoppingOutlined,
  SolutionOutlined,
  MessageOutlined,
  ContactsOutlined,
  ProjectOutlined,
  ScheduleOutlined,
  InboxOutlined,
  ToolOutlined,
  ContainerOutlined,
  ClusterOutlined,
  FolderAddOutlined,
  DeleteOutlined,
  ReadOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  FontSizeOutlined,
  CheckOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import type {
  MenuItem,
  LoginInfo,
  UITree,
  UIRow,
  UIControl,
  ToolbarItem,
  UIData,
  ErrorItem,
  ServerResponse,
  SessionPanel,
} from '../types/ui';
import { ELTYPE_DUMMY } from '../types/ui';
import Toolbar from './Toolbar';
import AttachmentsBar from './AttachmentsBar';
import { viewHasOlapCube } from './olap/detect';
import ViewRenderer, { SidContext, FormValuesContext, EditRowContext, FlushEditsContext, PendingAddContext, TitleInBreadcrumbContext, PaneToolbarContext } from './ViewRenderer';
import { DataVersionContext } from '../controls/dataVersion';
import HomePanel from './HomePanel';
import ChangePasswordModal from './ChangePasswordModal';
import ImpersonateModal from './ImpersonateModal';
import BannerCard from './BannerCard';
import TopProgressBar from './TopProgressBar';
import { ensureNotificationPermission, notify } from '../services/notifications';
import * as api from '../services/api';
import { putTemplate, getTemplate, panelTemplateKeysParam } from '../services/templateCache';
import { hydrate } from '../services/hydrate';
import { negationFieldName } from '../controls/helpers';
import { consumePendingFocus, restoreFocus } from '../services/focusRestore';
import { useUiMode, ZoomScopeContext } from '../hooks/uiMode';
import { useDensity, DENSITY_OPTIONS, type Density } from '../hooks/density';
import { useHotkey } from '../hooks/hotkeys';

const { Header, Content } = Layout;
const { Text } = Typography;

/**
 * Re-issues the request that produced the current response, appending `token`
 * to an accumulating `messages` string. Used to answer server-side
 * CONFIRMATION/YESNOCANCEL prompts by replaying the *original* request (menu
 * navigation, Save, Delete, …) rather than a hardcoded Post — so the action
 * the confirmation was guarding actually proceeds (SXADV-5470.1). Mirrors the
 * legacy ExtJS processOkCancel/reqopt reuse.
 */
type ConfirmReplay = (token: string) => void;

interface TabState {
  key: string;
  label: string;
  sid: string;
  // Menu item this tab was opened from. Drives the persistent selection
  // highlight in the sidebar menu and in the app bar (SXADV-5784), so the user
  // keeps seeing which function is open — hover alone gave no lasting clue.
  menuId?: string;
  ui?: UITree;
  toolbar?: ToolbarItem[];
  uiData?: UIData;
  currField?: string;
  formValues: Record<string, string | string[]>;
  loading?: boolean;
  progressPct?: number; // 0-100 during async job polling
  // Two-phase pipeline: the templateKey ("viewName:pageType") of the
  // template currently driving this tab's render. Echoed back to the
  // server on subsequent requests so it can serve DATA-only when the
  // resolved view matches.
  templateKey?: string;
  // Per-tab binding manifest: structural scope path -> viewstate id.
  // Populated from the METADATA response and used by hydrate() to
  // compose wire-form control names for form posts.
  bindings?: Record<string, string>;
  // Per-tab scope-path manifest: structural scope path -> navpath.
  // Used by hydrate() to populate navigateView/navigateAdd.navpath.
  scopePaths?: Record<string, string>;
  // Bumped every time a response re-renders this tab's form data (see
  // DataVersionContext). Lets controls tell a server refresh from a plain
  // React re-render, so a payload that re-sends an unchanged value still
  // overrides the user's local edit (SXADV-5014.1).
  dataVersion?: number;
  // Scheda ricostruita dopo un ricaricamento della pagina e non ancora resa:
  // la Session esiste sul server, la videata si chiede solo quando si entra
  // nella scheda (SXADV-5658).
  restorePending?: boolean;
}

interface ShellProps {
  menuItems: MenuItem[];
  /** Sessioni gia' vive sul server al caricamento della pagina (JSONMenu
   *  `panels`). Dopo un F5 diventano le schede. */
  initialPanels?: SessionPanel[];
  /** Tetto alle sessioni contemporanee (JSONMenu `sessionLimit`, run property
   *  `session.limit`). 0 o assente = nessun limite. */
  sessionLimit?: number;
  loginInfo: LoginInfo;
  onLogout: () => void;
  onReloadMenu: () => void | Promise<void>;
}

/**
 * Walk the UI tree and flip the configureIcon.included for a single item.
 * Used for ToggleItem responses so we don't re-render the whole view.
 * Returns a new UITree with shallow copies along the touched path.
 */
function applyToggleItem(ui: UITree, itemId: string, included: boolean): UITree {
  let changed = false;
  const visitControl = (ctl: UIControl): UIControl => {
    let next: UIControl = ctl;
    if (ctl.configureIcon && ctl.configureIcon.itemId === itemId) {
      next = { ...next, configureIcon: { ...ctl.configureIcon, included } };
      changed = true;
    }
    if (ctl.tabs && ctl.tabs.length > 0) {
      let tabsChanged = false;
      const newTabs = ctl.tabs.map((t) => {
        if (t.configureIcon && t.configureIcon.itemId === itemId) {
          tabsChanged = true;
          changed = true;
          return { ...t, configureIcon: { ...t.configureIcon, included } };
        }
        return t;
      });
      if (tabsChanged) next = { ...next, tabs: newTabs };
    }
    if (ctl.contentRows) {
      const newRows = ctl.contentRows.map(visitRow);
      if (newRows !== ctl.contentRows) next = { ...next, contentRows: newRows };
    }
    // ButtonBar buttons are inner controls with their own configureIcon
    const buttons = (ctl as unknown as { buttons?: UIControl[] }).buttons;
    if (buttons && buttons.length > 0) {
      let btnsChanged = false;
      const newButtons = buttons.map((b) => {
        const nb = visitControl(b);
        if (nb !== b) btnsChanged = true;
        return nb;
      });
      if (btnsChanged) next = { ...next, buttons: newButtons } as UIControl;
    }
    return next;
  };
  const visitRow = (row: UIRow): UIRow => {
    let rowChanged = false;
    const newCells = row.cells.map((cell) => {
      if (!cell.control) return cell;
      const newCtl = visitControl(cell.control);
      if (newCtl !== cell.control) {
        rowChanged = true;
        return { ...cell, control: newCtl };
      }
      return cell;
    });
    return rowChanged ? { ...row, cells: newCells } : row;
  };
  const newRows = ui.rows.map(visitRow);
  // List headers (column headers) can also carry a configureIcon
  let newHeaders = ui.headers;
  if (ui.headers) {
    let headersChanged = false;
    newHeaders = ui.headers.map((h) => {
      if (h.configureIcon && h.configureIcon.itemId === itemId) {
        headersChanged = true;
        changed = true;
        return { ...h, configureIcon: { ...h.configureIcon, included } };
      }
      return h;
    });
    if (!headersChanged) newHeaders = ui.headers;
  }
  if (!changed) return ui;
  return { ...ui, rows: newRows, headers: newHeaders };
}

/**
 * Toglie dalla lista il record cancellato, senza far ridisegnare la pagina al
 * server.
 *
 * Una view di lista invariata risponde in render mode "I"
 * (`ToolViewRenderer.renderJSONListRow`): il patch della SOLA riga corrente.
 * Una riga TOLTA li' non e' esprimibile, e forzare il render pieno per una
 * cancellazione vorrebbe dire ridisegnare tutta la pagina per una riga in meno.
 * Il client sa gia' quello che serve: quale record e' stato cancellato, e che il
 * server dal canto suo lo ha tolto dal cursore.
 *
 * Oltre a togliere la riga (e le sue righe di continuazione) bisogna
 * RINUMERARE quelle che seguono: l'identita' di una riga e' il suo navpath, che
 * e' POSIZIONALE (`S1-11.<pos>`, vedi LayoutManager.startTableRowJSON). Il
 * cursore lato server ha gia' scalato le posizioni, quindi senza rinumerazione
 * il primo clic su una riga successiva aprirebbe - o cancellerebbe - il record
 * sbagliato. Stessa cosa per il `pos` della cella selettore: e' il ripiego con
 * cui si compone il percorso ed e' la chiave con cui si innesta un `rowUpdate`.
 *
 * Resta indietro il conteggio dei record nella toolbar: quello e' testo
 * renderizzato dal server ("pag: n di N ... N righe.") e si riallinea alla
 * prima richiesta successiva.
 */
function removeListRow(ui: UITree, path: string): UITree {
  const rows = ui.rows;
  if (!Array.isArray(rows) || rows.length === 0) return ui;
  const pathOf = (r: UIRow): string | undefined => {
    const p = r.props?.path;
    return typeof p === 'string' ? p : undefined;
  };
  // Riga di continuazione = prima cella DUMMY (stessa regola di ListRenderer):
  // e' la prosecuzione del record che la precede, quindi se ne va con lui.
  const isContinuation = (r: UIRow) => r.cells.length > 0 && r.cells[0].elementType === ELTYPE_DUMMY;
  const start = rows.findIndex((r) => pathOf(r) === path);
  if (start < 0) return ui;
  let end = start + 1;
  while (end < rows.length && isContinuation(rows[end])) end++;

  const m = /^(.*\.)(\d+)$/.exec(path);
  const prefix = m ? m[1] : null;
  const removedPos = m ? Number(m[2]) : null;
  const shift = (r: UIRow): UIRow => {
    if (prefix == null || removedPos == null) return r;
    let next = r;
    const p = pathOf(r);
    if (p && p.startsWith(prefix)) {
      const n = Number(p.slice(prefix.length));
      if (Number.isInteger(n) && n > removedPos) next = { ...r, props: { ...r.props, path: `${prefix}${n - 1}` } };
    }
    const cells = next.cells.map((c) => {
      const pos = (c as unknown as { pos?: number }).pos;
      return typeof pos === 'number' && pos > removedPos ? { ...c, pos: pos - 1 } : c;
    });
    if (cells.some((c, i) => c !== next.cells[i])) next = { ...next, cells };
    return next;
  };

  const newRows = [...rows.slice(0, start), ...rows.slice(end).map(shift)];
  const paging = ui.paging
    ? { ...ui.paging, totalRows: Math.max(0, ui.paging.totalRows - 1) }
    : ui.paging;
  return { ...ui, rows: newRows, paging };
}

/**
 * Apply a `detailPageOnly` slim pagination update. Walks the cached detail-form
 * tree, finds the embedded one-to-many grid whose child view-state `path`
 * matches, and swaps only its page of rows + paging state — every other branch
 * keeps referential identity so React re-renders just that grid, not the form.
 */
function applyDetailPage(
  ui: UITree,
  path: string,
  rows: UIRow[],
  paging: UITree['paging'],
): UITree {
  let changed = false;
  // Embedded detail grid rows travel under the `rows` key, which collides with
  // UIControl.rows (textarea row count, typed number) and UICell.rows — read it
  // structurally and only treat it as a row array when it actually is one.
  const getRows = (o: object): UIRow[] | undefined => {
    const r = (o as { rows?: unknown }).rows;
    return Array.isArray(r) ? (r as UIRow[]) : undefined;
  };
  const visitControl = (ctl: UIControl): UIControl => {
    // Mirror the client's own ui.path resolution (ViewRenderer, detailView case):
    // header.path || footer.path || control.path — the embedded list's path lives
    // in whichever of these the server emitted (header only when a titled header
    // is shown, footer only when an Add button is present, else on the control).
    const ctlPath = (ctl.header as { path?: string } | undefined)?.path
      ?? (ctl.footer as { path?: string } | undefined)?.path
      ?? (ctl.path as string | undefined);
    const ctlRows = getRows(ctl);
    if (ctlPath === path && (ctlRows || ctl.contentRows)) {
      changed = true;
      const oldHeader = (ctl.header ?? {}) as Record<string, unknown>;
      const base = {
        ...ctl,
        paging,
        header: { ...oldHeader, position: paging?.position, recordCount: paging?.totalRows },
      };
      // The embedded grid's rows live under `rows` or `contentRows` depending on
      // the render path; replace whichever this control uses.
      return (ctlRows ? { ...base, rows } : { ...base, contentRows: rows }) as unknown as UIControl;
    }
    let next = ctl;
    if (ctlRows) {
      const r = ctlRows.map(visitRow);
      if (r.some((nr, i) => nr !== ctlRows[i])) next = { ...next, rows: r } as unknown as UIControl;
    }
    if (ctl.contentRows) {
      const r = ctl.contentRows.map(visitRow);
      if (r.some((nr, i) => nr !== ctl.contentRows![i])) next = { ...next, contentRows: r };
    }
    return next;
  };
  const visitRow = (row: UIRow): UIRow => {
    let rowChanged = false;
    const newCells = row.cells.map((cell) => {
      let newCell = cell;
      if (cell.control) {
        const newCtl = visitControl(cell.control);
        if (newCtl !== cell.control) { rowChanged = true; newCell = { ...newCell, control: newCtl }; }
      }
      const cellRows = getRows(cell);
      if (cellRows) {
        const r = cellRows.map(visitRow);
        if (r.some((nr, i) => nr !== cellRows[i])) { rowChanged = true; newCell = { ...newCell, rows: r }; }
      }
      return newCell;
    });
    return rowChanged ? { ...row, cells: newCells } : row;
  };
  const newRows = ui.rows.map(visitRow);
  if (!changed) return ui;
  return { ...ui, rows: newRows };
}

function filterMenuTree(items: MenuItem[], filter: string): MenuItem[] {
  const lowerFilter = filter.toLowerCase();
  const result: MenuItem[] = [];
  for (const item of items) {
    const textMatches = item.description.toLowerCase().includes(lowerFilter);
    const filteredChildren = item.children ? filterMenuTree(item.children, filter) : [];
    if (textMatches || filteredChildren.length > 0) {
      result.push({
        ...item,
        children: filteredChildren.length > 0 ? filteredChildren : item.children,
      });
    }
  }
  return result;
}

/** Etichetta di una voce di menu dal suo id (ricorsiva sull'albero). Fuori dal
 *  componente: non usa niente dello stato, e dentro sarebbe una funzione nuova
 *  a ogni render — quindi o falsa le dipendenze dei callback che la usano o li
 *  fa ricreare per nulla. */
function findMenuLabel(items: MenuItem[], id: string): string | undefined {
  for (const item of items) {
    if (item.id === id) return item.description;
    if (item.children) {
      const found = findMenuLabel(item.children, id);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function collectOpenKeys(items: MenuItem[]): string[] {
  const keys: string[] = [];
  for (const item of items) {
    if (item.children && item.children.length > 0) {
      keys.push(item.id);
      keys.push(...collectOpenKeys(item.children));
    }
  }
  return keys;
}

// Semantic glyph per top-level Module, keyed on the bare module id (the server id
// arrives as "menu.<id>", so we strip the prefix before lookup — see moduleIconFor).
// Collapsed inline menus otherwise render every Module with the same fallback glyph,
// making them indistinguishable; a distinct icon per Module restores recognizability
// (SXADV-5454.0.b — one icon per primary menu).
const MODULE_ICONS: Record<string, React.ReactNode> = {
  cfg: <SettingOutlined />,              // Configurazioni
  allianz: <SafetyOutlined />,           // Allianz (assicurazioni)
  anag: <IdcardOutlined />,              // Anagrafiche
  ctb: <CalculatorOutlined />,           // Contabilità
  soci: <TeamOutlined />,                // Libro Soci
  art: <TagsOutlined />,                 // Articoli
  imm: <HomeOutlined />,                 // Immobiliare
  ven: <ShoppingCartOutlined />,         // Commerciale
  chub: <MessageOutlined />,             // Communication Hub
  acq: <ShoppingOutlined />,             // Acquisti
  proj: <ProjectOutlined />,             // Attività a progetto
  rap: <ScheduleOutlined />,             // Rapportini
  man: <ToolOutlined />,                 // Manutenzioni
  fat: <FileTextOutlined />,             // Fatturazione
  prod: <BuildOutlined />,               // Produzione
  int: <ApartmentOutlined />,            // Gestione Interna
  log: <CarOutlined />,                  // Logistica
  olap: <BarChartOutlined />,            // Statistiche
  util: <ControlOutlined />,             // Utilità
  age: <SolutionOutlined />,             // Sezione Agenti
  cli: <ContactsOutlined />,             // Sezione Clienti
  ant: <SafetyCertificateOutlined />,    // Antiriciclaggio
  dom: <ClusterOutlined />,              // Domino (hub anagrafiche uniche centralizzate)
  mag: <InboxOutlined />,                // Magazzino
  mct: <ContainerOutlined />,            // Magazzino Conto Terzi
};

function moduleIconFor(id: string): React.ReactNode {
  const bare = id.replace(/^menu\./, '');
  return MODULE_ICONS[bare] ?? <AppstoreOutlined />;
}

function buildMenuItems(items: MenuItem[], level = 0): NonNullable<React.ComponentProps<typeof Menu>['items']> {
  return items.map((item) => ({
    key: item.id,
    label: item.description,
    title: item.description,
    // Tag top-level rows so CSS can render Modules distinctly from sub-functions,
    // and give each Module its own semantic glyph (unmapped Modules fall back to
    // AppstoreOutlined, so nothing regresses).
    ...(level === 0 ? { className: 'menu-module', icon: moduleIconFor(item.id) } : {}),
    children: item.children && item.children.length > 0 ? buildMenuItems(item.children, level + 1) : undefined,
  }));
}

// Fixed-width header labels so the Azienda/Sede selectors line up vertically
// regardless of label text width.
const hdrLabelStyle: React.CSSProperties = { color: '#fff', whiteSpace: 'nowrap', display: 'inline-block', width: 60, flexShrink: 0 };

let tabCounter = 1;

const defaultTab: TabState = {
  key: 'tab_1',
  label: 'Sessione 1',
  sid: 'S1',
  formValues: {},
};

// Lazy-load CDMS tree component (separate chunk, downloaded on demand)
const CdmsTree = React.lazy(() => import('./CdmsTree'));

const Shell: React.FC<ShellProps> = ({ menuItems, initialPanels, sessionLimit = 0, loginInfo, onLogout, onReloadMenu }) => {
  // Context-aware message/modal so toasts and dialogs inherit the ConfigProvider
  // CSS-var theme; the static antd imports render invisibly under it. (SXADV-5542)
  const { message, modal } = App.useApp();
  const [collapsed, setCollapsed] = useState(false);
  // Modalità immersiva: letta anche dalle misure più in basso (la banda del
  // copyright), quindi dichiarata qui in alto. Gli attuatori stanno più sotto,
  // accanto agli altri comandi della app bar.
  const { immersive, setImmersive } = useUiMode();
  // User-adjustable expanded sidebar width (SXADV-5454.0.a) — matches the classic
  // client's draggable navigation column. Clamped to a sane range; ignored while
  // collapsed (fixed 80px). Drag handle lives on the sidebar's right edge.
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const startSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      setSidebarWidth(Math.min(560, Math.max(180, startW + (ev.clientX - startX))));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }, [sidebarWidth]);
  const [tabs, setTabs] = useState<TabState[]>([defaultTab]);
  // Mirror of `tabs` for callbacks that must not re-create on every tab change
  // (processResponseInner) but still need the tab's sid.
  const tabsRef = useRef<TabState[]>([defaultTab]);
  tabsRef.current = tabs;
  const [activeTab, setActiveTab] = useState<string>('tab_1');
  const [menuFilter, setMenuFilter] = useState('');
  const [sidebarMode, setSidebarMode] = useState<'menu' | 'cdms'>('menu');
  const [bannersModalOpen, setBannersModalOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [requestActive, setRequestActive] = useState(false);
  const formValuesRef = useRef<Record<string, Record<string, string | string[]>>>({ tab_1: defaultTab.formValues });
  // Monotonic counter behind TabState.dataVersion / DataVersionContext. Bumped
  // once per response that re-renders a tab's form data; controls only compare
  // it for change, so one counter shared by all tabs is enough.
  const dataVersionRef = useRef(0);
  // Breadcrumb-back is resolved client-side (SXADV-5659). The server never
  // re-emits the trail on the DATA-only response a BackTo produces, and it
  // doesn't need to: a successful BackTo onto crumb #i leaves exactly the
  // crumbs before it. Armed on click with the already-truncated HTML, consumed
  // by processResponseInner once the navigation is known to have gone through.
  const pendingBreadcrumbsRef = useRef<{ tabKey: string; html: string } | null>(null);
  // Riga da togliere dalla griglia quando la risposta conferma la cancellazione
  // (parametro `_removeRow`, armato da handleAction). Il server risponde con il
  // patch della sola riga corrente e non ha modo di dire "questa riga non c'e'
  // piu'": la toglie il client, vedi removeListRow.
  const pendingRowRemovalRef = useRef<{ tabKey: string; path: string } | null>(null);
  // Bumped on every fresh menu payload to remount the sidebar Menu. The inline
  // Menu keeps its expanded submenus in internal state, so without a remount a
  // reload (Azienda/Sede change, manual reload) would inherit the previously
  // open branches. Remounting brings it back collapsed; an active text filter
  // still re-expands to the matches via the controlled openKeys below, and
  // filteredMenu re-derives from the new menuItems so the filter re-applies.
  // (SXADV-5542)
  const [menuNonce, setMenuNonce] = useState(0);
  // True while an Azienda/Sede change is in flight (post + menu reload). Drives
  // the busy indicator on the header selects — the reload takes a few seconds
  // and the switch would otherwise look unresponsive. (SXADV-5542)
  const [contextChanging, setContextChanging] = useState(false);

  // Reflect any in-flight controller request as a thin top progress bar.
  useEffect(() => api.subscribeInFlight((count) => setRequestActive(count > 0)), []);

  useEffect(() => { setMenuNonce((n) => n + 1); }, [menuItems]);

  const filteredMenu = menuFilter ? filterMenuTree(menuItems, menuFilter) : menuItems;
  const menuOpenKeys = menuFilter ? collectOpenKeys(filteredMenu) : undefined;

  const getActiveTabState = useCallback((): TabState | undefined => {
    return tabs.find((t) => t.key === activeTab);
  }, [tabs, activeTab]);

  const updateTabState = useCallback(
    (tabKey: string, update: Partial<TabState>) => {
      setTabs((prev) =>
        prev.map((t) => (t.key === tabKey ? { ...t, ...update } : t))
      );
    },
    []
  );

  // Append a session tab (own sid, own form values) and make it active.
  // Returns it synchronously so the caller can fire a request on it without
  // waiting for the state update — `tabs` is still the pre-append array here.
  const addTab = useCallback((label?: string): TabState => {
    tabCounter++;
    const key = `tab_${tabCounter}`;
    const fv: Record<string, string | string[]> = {};
    formValuesRef.current[key] = fv;
    const tab: TabState = { key, label: label || `Sessione ${tabCounter}`, sid: `S${tabCounter}`, formValues: fv };
    setTabs((prev) => [...prev, tab]);
    setActiveTab(key);
    return tab;
  }, []);

  const handleErrors = useCallback((errors: ErrorItem[], replay?: ConfirmReplay) => {
    for (const err of errors) {
      switch (err.type) {
        case 'ERROR':
          message.error(err.message);
          break;
        case 'WARNING':
          message.warning(err.message);
          break;
        case 'INFO':
        case 'NOTIFICATION':
          message.info(err.message);
          break;
        case 'CONFIRMATION':
        case 'YESNOCANCEL':
          modal.confirm({
            content: err.message,
            // Refusing the prompt aborts the guarded action, so a breadcrumb-back
            // waiting on this answer never happens — un-arm it (SXADV-5659).
            // Stessa cosa per la riga da togliere: la cancellazione rifiutata
            // non avviene, e la riga deve restare in griglia.
            onCancel: () => { pendingBreadcrumbsRef.current = null; pendingRowRemovalRef.current = null; },
            onOk: () => {
              if (!err.mnemonic) return;
              // Answer token per CORE's message grammar (Session.addConfirmation):
              // plain confirmations are matched on "<mnemonic>,"; yes/no/cancel
              // prompts expect "<mnemonic>:S,". The trailing comma is required.
              const token = err.type === 'YESNOCANCEL'
                ? `${err.mnemonic}:S,`
                : `${err.mnemonic},`;
              if (replay) {
                // Re-run the request that raised the prompt so its guarded
                // action (menu change, save, …) actually proceeds.
                replay(token);
              } else {
                // No replay context (e.g. a dialog-driven action) — fall back to
                // re-posting on the active tab so the prompt isn't a dead end.
                const tab = getActiveTabState();
                if (tab) api.postAction('Post', { messages: token }, tab.formValues, tab.sid);
              }
            },
          });
          break;
      }
    }
  }, [getActiveTabState, message, modal]);

  // Changing Azienda/Sede di accesso wipes the whole server session pool
  // (CambioAziendaCommand: clearSession + sessions.clear()). The legacy client
  // mirrored that by tearing down every open tab and landing on the home page
  // (ui.js showMenu, lines 2606-2647). Reproduce it here: collapse the tab area
  // back to a single fresh session tab so no stale document/session survives,
  // and the empty tab renders HomePanel. (SXADV-5542)
  const resetToHome = useCallback(() => {
    tabCounter = 1;
    formValuesRef.current = { tab_1: {} };
    setTabs([{ key: 'tab_1', label: 'Sessione 1', sid: 'S1', formValues: {} }]);
    setActiveTab('tab_1');
  }, []);

  const changeContext = useCallback(
    async (action: 'CambioAzienda' | 'CambioSede', value: string) => {
      // Busy clue for the multi-second switch: a full-screen Spin overlay
      // (rendered in-tree below, so it inherits the ConfigProvider theme —
      // unlike the detached static `message`, which renders invisibly under the
      // CSS-variable theme). Mirrors the legacy MessageBox.wait modal.
      setContextChanging(true);
      try {
        const resp = await api.postAction2(action, { navpath: value });
        // A dirty in-flight session makes the server reject the change
        // (SAVE_BEFORE_NEW_ERR) without touching anything. Surface the message and
        // leave the tabs alone; the header Select reverts on its own because it is
        // bound to the unchanged loginInfo. (legacy ui.js 3168-3172)
        if (resp?.errors && resp.errors.length > 0) {
          handleErrors(resp.errors);
          if (resp.errors.some((e) => e.type === 'ERROR')) return;
        }
        resetToHome();
        // Await the reload — it is the slow part — so the busy clue stays up
        // until the fresh menu/home is actually in place.
        await onReloadMenu();
      } finally {
        setContextChanging(false);
      }
    },
    [handleErrors, resetToHome, onReloadMenu]
  );

  const handleAziendaChange = useCallback(
    (value: string) => {
      if (value === loginInfo.customerKey) return;
      void changeContext('CambioAzienda', value);
    },
    [changeContext, loginInfo.customerKey]
  );

  const handleSedeChange = useCallback(
    (value: string) => {
      if (value === loginInfo.sede) return;
      void changeContext('CambioSede', value);
    },
    [changeContext, loginInfo.sede]
  );

  // Extract values from editable form controls only — the server already has readonly values
  const extractFormValues = useCallback((ui: UITree): Record<string, string | string[]> => {
    const values: Record<string, string | string[]> = {};
    const walkRows = (rows: UIRow[]) => {
      for (const row of rows) {
        for (const cell of row.cells) {
          const ctrl = cell.control;
          if (!ctrl) continue;
          // Only collect from editable controls (server already has readonly state)
          if (ctrl.editable && !ctrl.noPost && !ctrl.disabled) {
            const name = ctrl.name || ctrl.id;
            if (name && ctrl.value != null && typeof ctrl.value !== 'object') {
              values[name] = String(ctrl.value);
            }
            // Re-seed the negation ($not) flag from the server's authoritative
            // state so it survives this rebuild and is posted on ExecuteQuery.
            // Without it, toggling "not" then triggering any reload would drop
            // the flag (no control carries it) — same class of loss the scalar
            // value above was fixed for (SXADV-5465).
            if (name && ctrl.negation && ctrl.negationValue) {
              values[negationFieldName(name)] = '1';
            }
          }

          // Recurse into embedded/detail views and tabs
          if (ctrl.contentRows) {
            walkRows(ctrl.contentRows);
          }
        }
      }
    };
    if (ui.rows) walkRows(ui.rows);
    return values;
  }, []);

  // Handle grid column value changes (array of values for all rows in a column)
  const handleGridChange = useCallback(
    (name: string, values: string[]) => {
      const tab = getActiveTabState();
      if (!tab) return;
      tab.formValues[name] = values;
      formValuesRef.current[tab.key] = tab.formValues;
    },
    [getActiveTabState]
  );

  const processResponseInnerRef = useRef<(tabKey: string, resp: ServerResponse) => void>(() => {});

  const pollProgress = useCallback(
    async (tabKey: string, sid: string) => {
      let delay = 500;
      const poll = async (): Promise<void> => {
        const resp = await api.checkProgress(sid);
        const progress = (resp as Record<string, unknown>).progress as number | undefined;
        // Update progress percentage for the loading indicator
        if (progress != null && progress >= 0 && progress < 100) {
          updateTabState(tabKey, { progressPct: progress });
        }
        // Job complete: progress is -1 or 100, or no trackAsynchJob flag
        if (!resp.trackAsynchJob || progress === -1 || progress === 100) {
          updateTabState(tabKey, { loading: false, progressPct: undefined });
          processResponseInnerRef.current(tabKey, resp);
          return;
        }
        // Still running — poll again with exponential backoff (max 5s)
        delay = Math.min(delay * 2, 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return poll();
      };
      await poll();
    },
    [updateTabState]
  );

  const processResponseInner = useCallback(
    (tabKey: string, resp: ServerResponse, replay?: ConfirmReplay) => {
      const r = resp as Record<string, unknown>;
      if (r.notLoggedIn) {
        updateTabState(tabKey, { loading: false, progressPct: undefined });
        message.error('Sessione scaduta. Effettuare nuovamente il login.');
        return;
      }
      if (r.noSession) {
        updateTabState(tabKey, { loading: false, progressPct: undefined });
        message.error('Sessione non valida. Riprovare.');
        return;
      }
      if (resp.errors && resp.errors.length > 0) {
        handleErrors(resp.errors, replay);
      }
      if (resp.redirect) {
        window.location.href = resp.redirect;
        return;
      }
      // This is the terminal handler for a completed (non-async) response —
      // always drop the loading overlay that handleMenuClick/handleAction/
      // replay raised, so a menu click can't leave the tab spinning (or the
      // HomePanel showing behind a dialog) — SXADV-5470.0.
      const update: Partial<TabState> = { loading: false, progressPct: undefined };
      // Resolve a pending breadcrumb-back (armed by the crumb's onClick).
      // BackTo can refuse to move — dirty transaction, stale viewstate id —
      // and then the server re-renders the CURRENT view, so the trail must
      // stay as it is. A confirmation prompt is not an outcome yet: the
      // answer replays the same request, so keep the arming for that response.
      let backTrail: string | undefined;
      // Tree+detail routing. While a tree view holds the tab, its OWN detail
      // view travels into TreeRenderer's right pane instead of replacing the
      // tab (the merge itself happens at the end of this function, once the
      // per-record flags have been applied to the detail). Anything else that
      // lands in the tab — another view from the menu, a link action, a back —
      // replaces the tree as usual (SXADV-5650).
      const existingUi = tabs.find((t) => t.key === tabKey)?.ui;
      const treeUi =
        existingUi?.viewType === 'tree' && existingUi.navigateView ? existingUi : undefined;
      const isTreeDetail = (ui: UITree) =>
        !!treeUi &&
        ui.viewType !== 'tree' &&
        !ui.treeNodes &&
        // Emitted on every METADATA/FULL render (it is part of the cached
        // template too, so a hydrated view carries it as well).
        ui.viewName === treeUi.navigateView;
      const pendingBack = pendingBreadcrumbsRef.current;
      if (pendingBack && pendingBack.tabKey === tabKey) {
        const errs = resp.errors ?? [];
        if (!errs.some((e) => e.type === 'CONFIRMATION' || e.type === 'YESNOCANCEL')) {
          pendingBreadcrumbsRef.current = null;
          if (!errs.some((e) => e.type === 'ERROR')) backTrail = pendingBack.html;
        }
      }
      // Two-phase pipeline — METADATA+DATA: cache the stable template and
      // render the initial hydrated tree. The binding manifest is per-tab
      // (not cached with the template) — it maps each structural scope to
      // the viewstate id the server allocated for this tab, so form posts
      // can compose wire-form keys.
      //
      // The server omits the template blob (mode "MC") when this tab already
      // advertised its key: a NEW page — its own history entry, its own
      // breadcrumb and viewstate, so a DATA-only response won't do — laid out
      // by a template that's already on screen (opening a second record from
      // the same list, chain-link between records of one view). Everything
      // else travels as usual; the layout comes from the cache.
      const metaTemplate = resp.templateKey
        ? resp.template ?? getTemplate(resp.templateKey)
        : undefined;
      if (resp.templateKey && !metaTemplate) {
        console.warn('[template-cache] missed key', resp.templateKey, '— server omitted the template but the client has none');
      }
      if (metaTemplate && resp.templateKey) {
        // Navigating to a DIFFERENT view (e.g. a listEdit list → "Nuovo" → the
        // record detail) leaves the inline list-edit context. Drop the stale
        // edit-row navpath so the new view's Save/Post resolves on its own
        // viewstate — otherwise the detail's Save injected the previous list
        // row's navpath (S1-11) while its fields were keyed to the new record
        // (S1-12), and the server rejected it as NoSession.
        const prevTemplateKey = tabs.find((t) => t.key === tabKey)?.templateKey;
        // ...and so does a new page that happens to reuse the layout on screen
        // (mode "MC" — key advertised, template omitted): same key, different
        // page, so the key comparison alone wouldn't catch it.
        if (resp.templateKey !== prevTemplateKey || !resp.template) editNavpathRef.current = null;
        if (resp.template) putTemplate(resp.templateKey, resp.template);
        const bindings = resp.bindings ?? {};
        const scopePaths = resp.scopePaths ?? {};
        const hydrated = hydrate(metaTemplate, resp.values, resp.dynProps, bindings, scopePaths);
        // Breadcrumbs vary per navigation and are NOT cached in the template
        // -- merge them in from the response root.
        update.ui = resp.breadcrumbs !== undefined ? { ...hydrated, breadcrumbs: resp.breadcrumbs } : hydrated;
        update.templateKey = resp.templateKey;
        update.bindings = bindings;
        update.scopePaths = scopePaths;
        const newFormValues = extractFormValues(hydrated);
        formValuesRef.current[tabKey] = newFormValues;
        update.formValues = newFormValues;
        update.dataVersion = ++dataVersionRef.current;
      }
      // Two-phase pipeline — DATA-only: reuse the cached template and the
      // tab's existing bindings. Cache miss (tab drift, first render after
      // a reload) falls through to a warning — the next action will force
      // the server back to METADATA mode.
      else if (resp.ui?.dataOnly && resp.ui.templateKey) {
        const tpl = getTemplate(resp.ui.templateKey);
        const existingTab = tabs.find(t => t.key === tabKey);
        // A reused (cached) template can map to a DIFFERENT live viewstate id
        // than when first cached, so the server now re-sends bindings/scopePaths
        // on DATA-only responses. Prefer the fresh manifest; fall back to the
        // tab's last-known one only if the server didn't send it. Persisting the
        // refreshed manifest keeps subsequent posts on the current navpath
        // (fixes the stale "S1-0.0" vs live "S1-21.0" desync).
        const bindings = resp.bindings ?? existingTab?.bindings ?? {};
        const scopePaths = resp.scopePaths ?? existingTab?.scopePaths ?? {};
        if (tpl) {
          const hydrated = hydrate(tpl, resp.ui.values, resp.ui.dynProps, bindings, scopePaths);
          update.bindings = bindings;
          update.scopePaths = scopePaths;
          // DATA-only is a reload on the same view: carry the breadcrumbs
          // forward from the existing tab state (the template doesn't cache
          // them and the server doesn't re-emit them on reloads). The one
          // exception is a breadcrumb-back that landed on an already-cached
          // template — it comes back DATA-only too, but the trail has to
          // shrink to the crumbs before the one clicked (SXADV-5659).
          const carried = backTrail ?? existingTab?.ui?.breadcrumbs;
          update.ui = carried !== undefined ? { ...hydrated, breadcrumbs: carried } : hydrated;
          update.templateKey = resp.ui.templateKey;
          const newFormValues = extractFormValues(hydrated);
          formValuesRef.current[tabKey] = newFormValues;
          update.formValues = newFormValues;
          update.dataVersion = ++dataVersionRef.current;
        } else {
          console.warn('[template-cache] missed key', resp.ui.templateKey, '— server emitted DATA-only but client has no template');
        }
      }
      else if (resp.ui) {
        // A slim in-place merge (row / list page / embedded detail page) patches
        // the view the tab already holds. Inside a tree tab that view is the
        // TREE, while the rows belong to the detail pane TreeRenderer owns —
        // there is nothing here to patch, and applyDetailPage would walk a UI
        // with no `rows` at all. Leave the tab untouched instead.
        if (treeUi && (resp.ui.rowUpdate || resp.ui.pageOnly || resp.ui.detailPageOnly)) {
          console.warn('[tree] ignoring slim update for the detail pane', resp.ui.path);
        } else if (resp.ui.rowUpdate) {
          // Incremental row update: merge single row into existing grid data
          const existingTab = tabs.find(t => t.key === tabKey);
          if (existingTab?.ui) {
            const pos = resp.ui.position;
            const updatedRow = resp.ui.rows?.[0];
            if (updatedRow != null && pos != null) {
              const newRows = existingTab.ui.rows.map(row => {
                const rowPos = (row.cells[0] as unknown as { pos?: number }).pos;
                return rowPos === pos ? updatedRow : row;
              });
              update.ui = { ...existingTab.ui, rows: newRows };
            }
          }
        } else if (resp.ui.pageOnly) {
          // Pagination-only response: merge rows into existing UI, keep columns/headers/toolbar
          const existingTab = tabs.find(t => t.key === tabKey);
          if (existingTab?.ui) {
            update.ui = {
              ...existingTab.ui,
              rows: resp.ui.rows,
              paging: resp.ui.paging,
            };
          }
        } else if (resp.ui.detailPageOnly) {
          // Embedded detail pagination: swap just the matching grid's page in the
          // cached detail-form tree, leaving the rest of the form untouched.
          const existingTab = tabs.find(t => t.key === tabKey);
          if (existingTab?.ui && resp.ui.path) {
            update.ui = applyDetailPage(existingTab.ui, resp.ui.path, resp.ui.rows, resp.ui.paging);
          }
        } else {
          update.ui = resp.ui;
          // Initialize form values from all controls in the UI tree
          const newFormValues = extractFormValues(resp.ui);
          formValuesRef.current[tabKey] = newFormValues;
          // Also update the tab state's formValues
          update.formValues = newFormValues;
          update.dataVersion = ++dataVersionRef.current;
        }
      }
      // Cancellazione andata a buon fine: la riga esce dalla griglia. Stessa
      // logica del breadcrumb-back qui sopra — una CONFERMA non e' ancora un
      // esito (la risposta alla domanda rigioca la stessa richiesta, quindi si
      // tiene l'armamento), un ERRORE vuol dire che il record e' ancora li'.
      const pendingRemoval = pendingRowRemovalRef.current;
      if (pendingRemoval && pendingRemoval.tabKey === tabKey) {
        const errs = resp.errors ?? [];
        if (!errs.some((e) => e.type === 'CONFIRMATION' || e.type === 'YESNOCANCEL')) {
          pendingRowRemovalRef.current = null;
          if (!errs.some((e) => e.type === 'ERROR')) {
            const base = update.ui ?? tabs.find((t) => t.key === tabKey)?.ui;
            if (base) update.ui = removeListRow(base, pendingRemoval.path);
          }
        }
      }
      // attachmentsInfo is per-record and emitted at response root (not
      // cached with the template). Merge into update.ui in all flows.
      if (resp.attachmentsInfo !== undefined && update.ui) {
        update.ui = { ...update.ui, attachmentsInfo: resp.attachmentsInfo };
      }
      // Same for the insert-state flag: per-record, emitted at response root on
      // the two-phase flows (on `ui` itself in the legacy full render, which the
      // branches above keep as-is). ViewRenderer opens a new record with the
      // testata expanded (SXADV-5691).
      if (resp.newRecord && update.ui) {
        update.ui = { ...update.ui, newRecord: true };
      }
      if (resp.toolbar) update.toolbar = resp.toolbar;
      if (resp.uiData) {
        update.uiData = resp.uiData;
        // Server-driven "open this URL" directive from workflow navigateUrl
        // events (e.g. visualizzaFE → VisFE styled-XML viewer / foglio di
        // stile). The legacy client did window.open(uiData.openUrl); mirror
        // that here so the action actually opens its window instead of just
        // reloading the list (SXADV-5457.3).
        const openUrl = resp.uiData.openUrl;
        if (openUrl) {
          const full = /^https?:\/\//i.test(openUrl)
            ? openUrl
            : `/entrasp/${openUrl.replace(/^\//, '')}`;
          window.open(full, '_blank', 'noopener,noreferrer');
        }
        // Handle file download callback from server
        const cb = resp.uiData.callback as string | undefined;
        if (cb && cb.includes('handleFileDownload')) {
          const m = cb.match(/fileName:\s*"([^"]+)".*?type:\s*"([^"]+)".*?index:\s*"([^"]*)"/)
               || cb.match(/fileName:\s*\\?"([^"\\]+)\\?".*?type:\s*\\?"([^"\\]+)\\?".*?index:\s*\\?"([^"\\]*)\\?"/);
          if (m) {
            const fileName = decodeURIComponent(m[1]);
            const fileType = m[2];
            const index = decodeURIComponent(m[3]);
            const CMD2 = '/entrasp/controller2';
            if (fileType === 'application/pdf') {
              // LoadPdf runs the report's post-render action on the session it
              // lands in; without an explicit sid the server falls back to S1
              // and the action hits the wrong tab's session (or a stale key).
              const tabSid = tabsRef.current.find((t) => t.key === tabKey)?.sid;
              window.open(`${CMD2}?action=LoadPdf&fileName=${encodeURIComponent(fileName)}&index=${encodeURIComponent(index)}&type=application/pdf${tabSid ? `&sid=${encodeURIComponent(tabSid)}` : ''}`);
            } else if (fileType === 'text/html') {
              window.open(`${CMD2}?action=LoadHtml&fileName=${encodeURIComponent(fileName)}&index=${encodeURIComponent(index)}`);
            } else {
              // Excel, CSV, ZIP, etc. — trigger download
              const url = `${CMD2}?action=LoadFile&fileName=${encodeURIComponent(fileName)}&index=${encodeURIComponent(index)}&type=${encodeURIComponent(fileType)}`;
              window.location.href = url;
            }
          }
        }
      }
      if (resp.currField) update.currField = resp.currField;
      // Tree+detail: the response turned out to be the pane's own view, so the
      // tab keeps the tree and TreeRenderer picks the detail up from here. This
      // runs last so the detail carries the per-record extras (attachmentsInfo,
      // newRecord) that were merged into it above.
      //
      // A brand-new record is deliberately left out: the pane re-enters edit
      // mode by re-navigating to the SELECTED node, which a record that has no
      // key yet cannot do — "Nuovo" keeps opening as a full page.
      if (treeUi && update.ui && !update.ui.newRecord && isTreeDetail(update.ui)) {
        update.ui = { ...treeUi, _detailResponse: update.ui } as UITree;
        // The tab still IS the tree, so its manifest has to keep describing the
        // tree. TreeRenderer re-enters edit mode with a LocateAndNavigate of its
        // own, which allocates a fresh viewstate for the pane: adopting the
        // response's template/bindings here would key the pane's field posts to
        // the superseded one. Same for the toolbar — the layout on screen is
        // unchanged, so the tree's toolbar stays.
        delete update.templateKey;
        delete update.bindings;
        delete update.scopePaths;
        delete update.toolbar;
      }
      if (Object.keys(update).length > 0) {
        updateTabState(tabKey, update);
      }
      // Restore focus after React re-renders. The target id was
      // captured by useControlChange right before the reload fired.
      restoreFocus(consumePendingFocus());
    },
    // `tabs`: ogni percorso di merge (hydrate da template in cache, rowUpdate,
    // pageOnly, detailPageOnly, instradamento albero+dettaglio) legge la scheda
    // com'e' adesso. Finora ci arrivava di rimbalzo — handleErrors dipende da
    // getActiveTabState, che dipende da tabs — quindi bastava stabilizzare
    // handleErrors per congelare qui un elenco di schede vecchio e far ripartire
    // i merge da dati superati, senza che niente lo segnalasse.
    [handleErrors, updateTabState, extractFormValues, tabs, message]
  );

  processResponseInnerRef.current = processResponseInner;

  const processResponse = useCallback(
    (tabKey: string, resp: ServerResponse, sid?: string, replay?: ConfirmReplay) => {
      // Server says "poll me for progress" — show spinner and start polling
      if ((resp.uiData?.showProgress || resp.uiData?.trackAsynchJob || resp.trackAsynchJob) && !resp.ui) {
        const tabSid = sid || tabs.find((t) => t.key === tabKey)?.sid || 'S1';
        updateTabState(tabKey, { loading: true, progressPct: undefined });
        pollProgress(tabKey, tabSid);
        return;
      }
      processResponseInner(tabKey, resp, replay);
    },
    [processResponseInner, pollProgress, tabs, updateTabState]
  );

  // Build a confirmation-replay bound to the request that produced a response.
  // `request(extra)` must re-issue that exact request with the extra params
  // merged in; `messages` accumulates across chained prompts (each answer is a
  // pre-formatted token ending in ","). See ConfirmReplay / SXADV-5470.1.
  const makeConfirmReplay = useCallback(
    (tabKey: string, sid: string, request: (extra: Record<string, string>) => Promise<ServerResponse>): ConfirmReplay => {
      let messages = '';
      const replay: ConfirmReplay = (token) => {
        messages += token;
        document.body.style.cursor = 'wait';
        updateTabState(tabKey, { loading: true, progressPct: undefined });
        request({ messages })
          .then((resp) => processResponse(tabKey, resp, sid, replay))
          .catch((e) => {
            updateTabState(tabKey, { loading: false, progressPct: undefined });
            pendingBreadcrumbsRef.current = null;
            message.error(`Error: ${e}`);
          })
          .finally(() => { document.body.style.cursor = ''; });
      };
      return replay;
    },
    [processResponse, updateTabState, message]
  );

  const handleMenuClick = useCallback(
    async (menuId: string, menuLabel: string) => {
      const tab = getActiveTabState();
      if (!tab) return;
      if (tab.loading) return; // Block while a request is pending

      // Reset form values for the new screen
      tab.formValues = {};
      formValuesRef.current[tab.key] = tab.formValues;
      editNavpathRef.current = null;
      // Keep the current view mounted under a loading overlay while the new
      // screen loads, instead of blanking `ui` to undefined. Blanking made the
      // HomePanel ("BENVENUTO…") flash on every menu click, and linger behind
      // the confirm dialog when the navigation hit an "unsaved changes" prompt
      // (SXADV-5470.0 / .1). processResponse installs the new view (and clears
      // loading) once it arrives.
      updateTabState(tab.key, { label: menuLabel, menuId, loading: true, progressPct: undefined, formValues: tab.formValues });

      document.body.style.cursor = 'wait';
      // If the navigation raises a confirmation ("annullare TUTTE le modifiche?"),
      // replay THIS ExecuteMenuItem with the answer appended so the menu change
      // actually proceeds — the old code posted a hardcoded Post and dropped the
      // navigation, leaving the user stuck on the previous view (SXADV-5470.1).
      const replay = makeConfirmReplay(tab.key, tab.sid, (extra) => api.executeMenuItem(menuId, tab.sid, extra));
      try {
        const resp = await api.executeMenuItem(menuId, tab.sid);
        processResponse(tab.key, resp, tab.sid, replay);
      } catch (e) {
        updateTabState(tab.key, { loading: false, progressPct: undefined });
        message.error(`Error: ${e}`);
      } finally {
        document.body.style.cursor = '';
      }
    },
    [getActiveTabState, processResponse, updateTabState, makeConfirmReplay, message]
  );

  // After an identity change (impersonate), reload the menu and refresh the
  // active tab's view. Lifted to component scope so ImpersonateModal can call it.
  const refreshAfterIdentityChange = useCallback(async () => {
    onReloadMenu();
    const tab = getActiveTabState();
    if (!tab) return;
    try {
      const resp = await api.postAction('Refresh', {}, undefined, tab.sid);
      processResponse(tab.key, resp);
    } catch {
      // View not accessible — clear the tab
      updateTabState(tab.key, { ui: undefined, toolbar: undefined, uiData: undefined });
    }
  }, [onReloadMenu, getActiveTabState, processResponse, updateTabState]);

  // Rende una scheda ricostruita dopo un ricaricamento della pagina. La Session
  // e' ancora quella di prima e conserva la sua videata corrente: `Refresh`
  // con `full=1` la ridisegna daccapo (setViewReloaded -> risposta completa,
  // template compreso, che dopo un reload serve perche' la cache dei template
  // del client e' vuota). E' l'ajaxDo({action:'Refresh', full:'1'}) che faceva
  // il client legacy in checkForRefresh (SXADV-5658).
  const loadRestoredTab = useCallback(
    async (tab: TabState) => {
      updateTabState(tab.key, { restorePending: false, loading: true, progressPct: undefined });
      document.body.style.cursor = 'wait';
      try {
        const resp = await api.postAction('Refresh', { full: '1', hasTemplate: '1' }, undefined, tab.sid);
        processResponse(tab.key, resp, tab.sid);
      } catch (e) {
        updateTabState(tab.key, { loading: false, progressPct: undefined });
        message.error(`Error: ${e}`);
      } finally {
        document.body.style.cursor = '';
      }
    },
    [processResponse, updateTabState, message],
  );

  // Ricostruzione delle schede dopo un F5. Le Session vivono dentro
  // l'HttpSession, quindi il ricaricamento della pagina non le tocca: il
  // JSONMenu le elenca in `panels` (una voce per Session che ha una videata
  // corrente). Senza questo il client ripartiva sempre da una sola scheda
  // vuota sulla Home, e le sessioni restavano vive ma irraggiungibili — con in
  // piu' il fatto che la scheda "nuova" successiva si riprendeva il sid di una
  // di loro. Come il client legacy (setupPanels): si ricreano tutte le schede,
  // si rende subito solo la prima e le altre quando ci si entra sopra.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    // Solo le sessioni di scheda: il server esclude gia' documentale ("D") e
    // job ("J"), qui cade anche l'agenda ("A"), che in React non c'e'.
    const panels = (initialPanels ?? []).filter((p) => /^S\d+$/.test(p.id));
    if (panels.length === 0) return;
    restoredRef.current = true;
    // Si ricostruisce solo su una Shell ancora intonsa (la scheda vuota
    // iniziale): se per qualche motivo l'elenco arrivasse a lavoro gia'
    // avviato, sostituire le schede butterebbe via quello che c'e' dentro.
    const start = tabsRef.current;
    if (start.length !== 1 || start[0].ui || start[0].loading) return;
    const fvs: Record<string, Record<string, string | string[]>> = {};
    const restored: TabState[] = panels.map((p) => {
      const n = Number(p.id.substring(1));
      const key = `tab_${n}`;
      fvs[key] = {};
      return { key, label: p.title || `Sessione ${n}`, sid: p.id, menuId: p.menuId, formValues: fvs[key], restorePending: true };
    });
    // Le schede aperte dopo il ripristino non devono riusare il sid di una
    // Session gia' viva: il contatore riparte dal massimo ricostruito.
    tabCounter = Math.max(...restored.map((t) => Number(t.sid.substring(1))));
    formValuesRef.current = fvs;
    setTabs(restored);
    setActiveTab(restored[0].key);
    void loadRestoredTab(restored[0]);
  }, [initialPanels, loadRestoredTab]);

  const handleAction = useCallback(
    async (action: string, params: Record<string, string> = {}) => {
      const tab = getActiveTabState();
      if (!tab) return;

      if (tab.loading) return; // Block while a request is pending

      // ToggleItem is a lightweight JSONCommand on controller2 that only flips
      // server-side state and returns a minimal { toggleItem: { itemId, included } }.
      // No need to go through the full render/processResponse pipeline.
      if (action === 'ToggleItem') {
        try {
          const resp = await api.postAction2('ToggleItem', params);
          const toggle = (resp as ServerResponse).toggleItem;
          if (toggle && tab.ui) {
            const newUi = applyToggleItem(tab.ui, toggle.itemId, toggle.included);
            if (newUi !== tab.ui) updateTabState(tab.key, { ui: newUi });
          }
        } catch (e) {
          message.error(`Error: ${e}`);
        }
        return;
      }

      // Impersonate dialog: ImpersonateModal handles input + inline "user not
      // found"; on success it calls refreshAfterIdentityChange.
      if (action === 'impersonateDialog') {
        setImpersonateOpen(true);
        return;
      }

      // doActionAndMenu pattern: call via controller (Command class), process
      // the re-rendered view, then reload the menu.
      // (used by BackToAdmin and similar identity-change commands)
      if (params._reloadMenu === 'true') {
        const serverParams = { ...params };
        delete serverParams._reloadMenu;
        document.body.style.cursor = 'wait';
        try {
          const resp = await api.postAction(action, serverParams, undefined, tab.sid);
          processResponse(tab.key, resp);
          onReloadMenu();
        } catch (e) {
          message.error(`Error: ${e}`);
        } finally {
          document.body.style.cursor = '';
        }
        return;
      }

      const noFormValues = params._noFormValues === 'true';
      const serverParams = { ...params };
      delete serverParams._noFormValues;
      // Riga da togliere dalla griglia se la richiesta va a buon fine (Elimina
      // dal pannello di una lista). Non e' un parametro del server.
      const removeRow = params._removeRow;
      delete serverParams._removeRow;
      pendingRowRemovalRef.current = removeRow ? { tabKey: tab.key, path: removeRow } : null;

      // Two-phase pipeline: opt into the template/data protocol. If this tab
      // already holds a template, advertise its key so the server can decide
      // DATA-only vs METADATA+DATA based on whether the resolved view matches.
      serverParams.hasTemplate = '1';
      if (tab.templateKey) serverParams.templateKey = tab.templateKey;
      // Advertise the instant edit-panel templates the client already holds so
      // the server omits those (cacheable) blobs from list renders, sending only
      // the key. Client falls back to its cache when the blob is absent.
      const pk = panelTemplateKeysParam();
      if (pk) serverParams.panelKeys = pk;

      // For listEdit: include the editing row's navpath for data-modifying actions
      // (Save, Post, etc.) so the server positions on the correct row.
      // Don't inject for navigation actions that have their own positioning.
      // For listEdit: include the editing row's navpath for data-modifying actions
      // (Save, Post, etc.) so the server positions on the correct row.
      // Navigation actions have their own positioning — clear edit state instead.
      const navActions = ['NextPage', 'PrevPage', 'FirstPage', 'LastPage', 'GotoPage', 'SortColumn', 'Refresh'];
      if (navActions.includes(action)) {
        editNavpathRef.current = null;
        pendingAddRef.current = false;
      } else if (editNavpathRef.current && !serverParams.navpath) {
        serverParams.navpath = editNavpathRef.current;
      }
      // Il record nuovo lo crea "Nuovo", ma anche "Salva +" (SaveAndNew, dalla
      // barra di navigazione record): senza armare anche quello il pannello
      // restava sul record appena salvato invece di spostarsi su quello nuovo
      // (SXADV-5735 p).
      if (action === 'Add' || action === 'SaveAndNew') pendingAddRef.current = true;

      document.body.style.cursor = 'wait';
      // Istantanea, non il riferimento vivo: chi manda la richiesta puo' voler
      // ripulire subito i valori appena spediti (il pannello di riga lo fa
      // quando cambia record) e una mutazione arrivata mentre la richiesta e'
      // in volo si porterebbe via i valori dalla richiesta stessa.
      const fv = noFormValues ? undefined : { ...(formValuesRef.current[tab.key] ?? {}) };
      if (fv) dirtyFieldsRef.current.clear();
      // Replay THIS action (Save/Delete/navigation/…) with the answer appended
      // if it raises a confirmation — instead of the old hardcoded Post that
      // discarded the real action and its response (SXADV-5470.1).
      const replay = makeConfirmReplay(tab.key, tab.sid, (extra) =>
        api.postAction(action, { ...serverParams, ...extra }, fv, tab.sid));
      try {
        const resp = await api.postAction(action, serverParams, fv, tab.sid);
        processResponse(tab.key, resp, tab.sid, replay);
      } catch (e) {
        updateTabState(tab.key, { loading: false, progressPct: undefined });
        // A request that never produced a response leaves no navigation to
        // account for — drop any armed breadcrumb-back so it can't be applied
        // to some later, unrelated response on this tab.
        pendingBreadcrumbsRef.current = null;
        message.error(`Error: ${e}`);
      } finally {
        document.body.style.cursor = '';
      }
    },
    [getActiveTabState, processResponse, updateTabState, onReloadMenu, makeConfirmReplay, message]
  );

  // CDMS: open one of the documentale views (ricerca, document list, cestino,
  // gestione profili/utenti) in a given tab. Not menu items — these views live
  // in the cdms module and are reached only from the documentale sidebar/app bar.
  // Takes the tab explicitly so it can also target a tab that was just appended,
  // before `tabs` has caught up with it.
  const openCdmsViewInTab = useCallback(
    async (
      tab: Pick<TabState, 'key' | 'sid'>,
      opts: { viewName: string; title: string; action?: string; filter?: string; orderBy?: string },
    ) => {
      const fv: Record<string, string | string[]> = {};
      formValuesRef.current[tab.key] = fv;
      editNavpathRef.current = null;
      updateTabState(tab.key, { label: opts.title, loading: true, ui: undefined, toolbar: undefined, uiData: undefined, currField: undefined, formValues: fv });
      document.body.style.cursor = 'wait';
      try {
        // Ingresso di primo livello (barra del documentale, cartella dell'albero):
        // la scheda riparte da zero, quindi il percorso non deve accodarsi a
        // quello della funzione precedente (SXADV-5783).
        const params: Record<string, string> = { viewName: opts.viewName, title: opts.title, newTask: '1' };
        if (opts.filter) params.filter = opts.filter;
        if (opts.orderBy) params.orderBy = opts.orderBy;
        const resp = await api.postAction(opts.action || 'ListPage', params, undefined, tab.sid);
        processResponse(tab.key, resp);
      } catch (e) {
        updateTabState(tab.key, { loading: false });
        message.error(`Error: ${e}`);
      } finally {
        document.body.style.cursor = '';
      }
    },
    [updateTabState, processResponse, message],
  );

  const openCdmsView = useCallback(
    (viewName: string, title: string, filter?: string) => {
      const tab = getActiveTabState();
      if (!tab || tab.loading) return;
      openCdmsViewInTab(tab, { viewName, title, filter });
    },
    [getActiveTabState, openCdmsViewInTab],
  );

  // Tabs holding the documentale pair, so re-entering the documentale activates
  // them instead of opening a new pair every time.
  const cdmsSessionTabsRef = useRef<{ search: string; recent: string } | null>(null);

  // Entering the documentale opens its two working sessions, as the legacy
  // client did in setupPanels(): "Ricerca" (query view) and "Documenti recenti"
  // (documents by last revision). Unlike the legacy client this does not wipe
  // the open tabs — the documentale lives inside the gestionale here, so the
  // pair is added, reusing the current tab only when it is still empty
  // (SXADV-5789).
  const enterDocumentale = useCallback(() => {
    setSidebarMode('cdms');
    const open = cdmsSessionTabsRef.current;
    if (open && tabs.some((t) => t.key === open.search) && tabs.some((t) => t.key === open.recent)) {
      setActiveTab(open.search);
      return;
    }
    const active = getActiveTabState();
    const searchTab = active && !active.ui && !active.loading ? active : addTab();
    const recentTab = addTab();
    cdmsSessionTabsRef.current = { search: searchTab.key, recent: recentTab.key };
    openCdmsViewInTab(searchTab, { viewName: 'cdmsRisorseQuery', title: 'Ricerca', action: 'QueryPage' });
    openCdmsViewInTab(recentTab, { viewName: 'cdmsRisorseList', title: 'Documenti recenti', orderBy: 'dataUltimaRevisione desc' });
    setActiveTab(searchTab.key);
  }, [tabs, getActiveTabState, addTab, openCdmsViewInTab]);

  // CDMS: clicking a folder in the tree opens a filtered document list in the active tab
  const handleCdmsFolderClick = useCallback(
    (cdmsId: string, folderName: string) => {
      // Extract UUID from cdmsId (part after last |)
      const uuid = cdmsId.substring(cdmsId.lastIndexOf('|') + 1);
      openCdmsView('cdmsRisorseList', folderName, `exists(nodi[idNodoClass = '${uuid}'])`);
    },
    [openCdmsView],
  );

  // Campi digitati e non ancora spediti al server. Ogni richiesta si porta
  // dietro TUTTI i valori di form, quindi appena ne parte una l'insieme si
  // svuota: quello che resta qui e' esattamente cio' che il server non sa.
  const dirtyFieldsRef = useRef<Set<string>>(new Set());

  const handleFieldChange = useCallback(
    (name: string, value: unknown) => {
      const tab = getActiveTabState();
      if (!tab) return;
      dirtyFieldsRef.current.add(name);
      // Preserve arrays (multi-valued form fields like `assegnaInput`
      // where the server reads parameterValues() — legacy behavior).
      const stored = Array.isArray(value)
        ? value.map((v) => (v == null ? '' : String(v)))
        : value == null ? '' : String(value);
      tab.formValues[name] = stored;
      formValuesRef.current[tab.key] = tab.formValues;
    },
    [getActiveTabState]
  );

  // Banner click: treat navigateTo as a menu item ID if it matches, else as an action
  const handleBannerClick = useCallback(
    (navigateTo: string) => {
      const label = findMenuLabel(menuItems, navigateTo);
      if (label) {
        handleMenuClick(navigateTo, label);
      } else {
        // Fall back to generic action (server decides what to do)
        handleAction(navigateTo);
      }
    },
    [menuItems, handleMenuClick, handleAction],
  );

  // Ingresso di primo livello che NON ha una voce di menu (Gestione Profili
  // Menu, Aggiungi Albero): fa quello che fa handleMenuClick — intitola la
  // scheda alla funzione che si sta aprendo e chiede al server di ripartire da
  // zero (newTask), cosi' il percorso non si accoda a quello di prima
  // (SXADV-5783).
  const openFunctionByAction = useCallback(
    (label: string, action: string, params?: Record<string, string>) => {
      const tab = getActiveTabState();
      if (!tab || tab.loading) return;
      updateTabState(tab.key, { label });
      handleAction(action, { ...params, newTask: '1' });
    },
    [getActiveTabState, updateTabState, handleAction],
  );

  // Request notification permission once on mount
  useEffect(() => {
    ensureNotificationPermission();
  }, []);

  // Fire native browser notifications for new banNotification banners.
  // Tracks "already notified" locally so refreshes don't re-notify.
  const notifiedBannerKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const banners = loginInfo.banners || [];
    for (const b of banners) {
      if (b.banNotification === false) continue;
      const key = (b.text || '') + '|' + (b.banDate || '');
      if (b.notified || notifiedBannerKeysRef.current.has(key)) continue;
      notifiedBannerKeysRef.current.add(key);
      notify({
        title: 'Avviso',
        body: b.text || '',
        onClick: b.navigateTo ? () => handleBannerClick(b.navigateTo!) : undefined,
      });
    }
  }, [loginInfo.banners, handleBannerClick]);

  // Manda al server le modifiche digitate nel pannello di riga e ancora non
  // spedite, indicando la riga a cui appartengono. Lo chiama il pannello quando
  // cambia record o quando si chiude: prima non succedeva niente fino al Salva,
  // e siccome i valori viaggiano con una chiave che NON dice la riga
  // (controlName.idViewstate: la riga la dice il navpath), il digitato sul
  // record precedente restava in mappa e finiva scritto sul record successivo
  // (SXADV-5735 e/f).
  //
  // I nomi spediti escono anche dalla mappa dei valori: il server adesso li ha,
  // e rimandarli su un'altra riga e' esattamente il travaso da evitare.
  const flushFieldEdits = useCallback((navpath: string) => {
    const tab = getActiveTabState();
    if (!tab || !navpath || dirtyFieldsRef.current.size === 0) return;
    // Con una richiesta gia' in volo handleAction non manda niente: non si
    // tolgono valori dalla mappa che nessuno ha spedito. Restano segnati come
    // da mandare e partiranno con la richiesta successiva.
    if (tab.loading) return;
    const names = [...dirtyFieldsRef.current];
    void handleAction('Post', { navpath });
    for (const n of names) delete tab.formValues[n];
    formValuesRef.current[tab.key] = tab.formValues;
  }, [getActiveTabState, handleAction]);

  // Track which row is being edited in listEdit mode (navpath sent with Save/Post)
  // Use a ref to avoid triggering re-renders on every row switch
  const editNavpathRef = useRef<string | null>(null);
  const handleEditRow = useCallback(
    (navpath: string | null) => {
      editNavpathRef.current = navpath;
    },
    []
  );

  // Was the Nuovo/Add toolbar action just dispatched? Set in handleAction below,
  // consumed-and-cleared by ListRenderer's auto-open-panel effect (see
  // PendingAddContext) so it only fires right after a real Add, never on an
  // ordinary reload of a multiEdit list (where almost every row is "in edit
  // path" server-side). Covers the default "Add" command name — a handful of
  // views with a customAddCommand override won't get the auto-open, matching
  // their pre-existing behaviour (not a regression).
  const pendingAddRef = useRef(false);
  const consumePendingAdd = useCallback(() => {
    const was = pendingAddRef.current;
    pendingAddRef.current = false;
    return was;
  }, []);

  // Tetto alle sessioni contemporanee (run property `session.limit`; 0 =
  // nessun limite, ed e' anche il valore che si vede su un server che non lo
  // manda). Il legacy disabilitava il "+" della barra schede quando il conto
  // era pieno (ui.js checkSessionLimit): qui il bottone si spegne allo stesso
  // modo e il clic, che antd lascia comunque passare, si ferma con un avviso.
  const atSessionLimit = sessionLimit > 0 && tabs.length >= sessionLimit;

  const handleTabChange = (key: string) => {
    setActiveTab(key);
    // Scheda ripristinata da un reload e mai aperta finora: si rende adesso.
    const tab = tabsRef.current.find((t) => t.key === key);
    if (tab?.restorePending) void loadRestoredTab(tab);
  };

  const handleTabEdit = (
    targetKey: React.MouseEvent | React.KeyboardEvent | string,
    action: 'add' | 'remove'
  ) => {
    if (action === 'add') {
      if (atSessionLimit) {
        message.warning(`Non si possono tenere aperte piu' di ${sessionLimit} sessioni: chiuderne una per aprirne un'altra.`);
        return;
      }
      addTab();
    } else if (action === 'remove') {
      const key = typeof targetKey === 'string' ? targetKey : '';
      const closed = tabsRef.current.find((t) => t.key === key);
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.key === key);
        const next = prev.filter((t) => t.key !== key);
        if (activeTab === key && next.length > 0) {
          setActiveTab(next[Math.min(idx, next.length - 1)].key);
        } else if (next.length === 0) {
          setActiveTab('');
        }
        return next;
      });
      delete formValuesRef.current[key];
      // La Session resta viva sul server finche' non gliela si chiude: senza
      // questo si accumulano (e dopo un F5 le schede appena chiuse
      // ricomparirebbero, ricostruite da `panels`). Come il closeSession() del
      // client legacy.
      if (closed) void api.postAction2('CloseSession', { sid: closed.sid }).catch(() => {});
    }
  };

  const currentTab = getActiveTabState();
  const breadcrumbs = currentTab?.ui?.breadcrumbs;

  // A pane that drives a viewstate of its own (TreeRenderer's detail) hands its
  // toolbar up here: from the moment the pane loads, the session's current
  // viewstate is the pane's record, and the toolbar rendered with the enclosing
  // view is stale — its Add still carries the old path and comes back
  // NoSession. See PaneToolbarContext.
  const currentTabKey = currentTab?.key;
  const setPaneToolbar = useCallback(
    (toolbar: ToolbarItem[]) => {
      if (currentTabKey) updateTabState(currentTabKey, { toolbar });
    },
    [currentTabKey, updateTabState]
  );

  // Parse HTML breadcrumbs into structured items
  const parsedBreadcrumbs = useMemo(() => {
    if (!breadcrumbs) return [];
    // `html` is the crumb's own markup, kept so a breadcrumb-back can rebuild
    // the shortened trail by re-joining the crumbs that survive it — no
    // re-parse, and the indexes can't drift from what's on screen.
    const items: { title: string; html: string; action?: string; navpath?: string; option1?: string; isBack?: boolean }[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${breadcrumbs}</div>`, 'text/html');
    doc.querySelectorAll('.breadcrumbElement, [onclick]').forEach((el) => {
      const rawTitle = (el.getAttribute('title') || el.textContent || '');
      // The "go back one step" element is marked with a leading "<<" — keep a
      // flag so it can render with a clear back-link affordance (item 5455.0).
      const isBack = /^\s*<<\s*/.test(rawTitle);
      const title = rawTitle.replace(/^\s*<<\s*/, '');
      const onclick = el.getAttribute('onclick') || '';
      const m = onclick.match(/doAction[23]?\(\s*'([^']+)'(?:\s*,\s*'([^']*)')?(?:\s*,\s*'([^']*)')?\s*\)/);
      if (title) {
        items.push({
          title,
          html: el.outerHTML,
          action: m?.[1],
          navpath: m?.[2],
          option1: m?.[3],
          isBack,
        });
      }
    });
    return items;
  }, [breadcrumbs]);

  // The view's own title closes the breadcrumb trail instead of occupying a
  // heading row of its own (SXADV-5742): the trail already names where the user
  // is ("Fatture - Interrogazione › Fatture - Nuovo Record"), so the separate
  // `.view-title` line under the toolbar was saying it twice and costing a full
  // row of the editing area. Only when a trail exists — a top-level view has no
  // crumbs and keeps its own title, which is then the only thing naming it.
  const titleIsLastCrumb = parsedBreadcrumbs.length > 0
    && !!currentTab?.ui?.title
    && !viewHasOlapCube(currentTab?.ui);

  // Copyright line: shown only when the view leaves room for it at the foot of
  // the tab. It is positioned out of flow (see .view-copyright), so it never
  // shortens the view — a grid sized to fill the tab keeps the full height and
  // the label simply doesn't appear, which is what the legacy UI effectively
  // did: the .ftl templates closed the page with <br/><br/>… + the label, so it
  // sat past the fold and only surfaced on short pages (SXADV-5688.2).
  const tabContentRef = useRef<HTMLDivElement | null>(null);
  const [copyrightFits, setCopyrightFits] = useState(false);
  const measureCopyrightRoom = useCallback(() => {
    const tc = tabContentRef.current;
    if (!tc) return;
    const COPYRIGHT_H = 26; // label box + the gap that keeps it off the content
    const tcRect = tc.getBoundingClientRect();
    const limit = tcRect.bottom - (parseFloat(getComputedStyle(tc).paddingBottom) || 0) - COPYRIGHT_H;
    // Deepest bottom edge actually painted by the view. Elements that scroll
    // internally, and grids (JS-sized to fill their panel), own their whole box
    // — recursing into them says nothing about free space. Everything else is
    // measured through its children, so a container stretched by flex but
    // holding a short form reports the form's bottom, not its own.
    const contentBottom = (el: HTMLElement, depth: number): number => {
      if (el.scrollHeight > el.clientHeight + 1) return el.getBoundingClientRect().bottom;
      if (el.classList.contains('ag-root-wrapper')) return el.getBoundingClientRect().bottom;
      let max = -Infinity;
      if (depth < 24) {
        for (const child of Array.from(el.children) as HTMLElement[]) {
          if (child.classList.contains('view-copyright')) continue;
          const cs = getComputedStyle(child);
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'absolute' || cs.position === 'fixed') continue;
          max = Math.max(max, contentBottom(child, depth + 1));
          if (max > limit) return max; // already out of room — stop descending
        }
      }
      // A leaf occupies its own box (nothing inside to measure it by).
      return max === -Infinity ? el.getBoundingClientRect().bottom : max;
    };
    setCopyrightFits(contentBottom(tc, 0) <= limit);
  }, []);
  useEffect(() => {
    measureCopyrightRoom();
    // Grids and fonts settle a frame (and a beat) later — re-measure after both.
    const raf = requestAnimationFrame(measureCopyrightRoom);
    const timer = window.setTimeout(measureCopyrightRoom, 350);
    const tc = tabContentRef.current;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measureCopyrightRoom) : null;
    if (tc && ro) {
      ro.observe(tc);
      // The tab keeps its size while its inside is rearranged — dragging the
      // form/panel splitter, a grid settling on its measured height. Watch the
      // regions that do change so the label follows the room they leave.
      tc.querySelectorAll<HTMLElement>('.view-container, .view-body, .view-split-form, .view-split-bottom, .list-container')
        .forEach((el) => ro.observe(el));
    }
    window.addEventListener('resize', measureCopyrightRoom);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      ro?.disconnect();
      window.removeEventListener('resize', measureCopyrightRoom);
    };
  }, [measureCopyrightRoom, currentTab?.key, currentTab?.ui, currentTab?.loading, collapsed, sidebarWidth, immersive]);

  const APPBAR_WIDTH = 48;
  const siderWidth = collapsed ? 80 : sidebarWidth;

  // ChangePasswordModal owns the form + inline validation; opened on demand.
  const showChangePasswordDialog = useCallback(() => setChangePasswordOpen(true), []);

  /* Modalità immersiva — vedi docs/planned/20260817_immersive_zoom_hotkeys_spec.md.
     Nasconde app bar, sidebar, header e strip sessioni: ~86px verticali e ~310
     orizzontali. La toolbar del record NON sparisce: sta nel content ed è ciò
     che serve mentre si lavora.

     Ci si accompagna il fullscreen del browser, unico modo di recuperare anche
     i ~90px della sua chrome. Va chiesto dentro il gesto dell'utente (click o
     tasto), non da un effect, altrimenti il browser lo rifiuta. */
  // Il fullscreen si spegne solo se l'abbiamo acceso noi: l'utente può esserci
  // già arrivato per conto suo, e non è cosa nostra da disfare.
  const ownsFullscreenRef = useRef(false);

  const enterImmersive = useCallback(() => {
    setImmersive(true);
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen().then(() => { ownsFullscreenRef.current = true; }).catch(() => {});
    }
  }, [setImmersive]);

  const exitImmersive = useCallback(() => setImmersive(false), [setImmersive]);

  // L'uscita arriva da tre parti — Esc (registrata dal provider), il pulsante
  // flottante, F11 — quindi il fullscreen si chiude di conseguenza qui, una
  // volta sola, invece che su ognuna delle tre.
  useEffect(() => {
    if (immersive) return;
    if (ownsFullscreenRef.current && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    ownsFullscreenRef.current = false;
  }, [immersive]);

  // A schermo intero Esc è del browser, non nostro: la pagina non vede il tasto,
  // e senza questo riallineamento si uscirebbe dal fullscreen restando immersivi
  // — chrome del browser tornata, header dell'applicazione ancora nascosto.
  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && ownsFullscreenRef.current) {
        ownsFullscreenRef.current = false;
        setImmersive(false);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [setImmersive]);

  // La modalità non sopravvive alla Shell: al logout si torna alla schermata di
  // login, che non ha né chrome da nascondere né un modo per uscirne.
  useEffect(() => () => {
    setImmersive(false);
    if (ownsFullscreenRef.current && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    ownsFullscreenRef.current = false;
  }, [setImmersive]);

  /* Ambito dello zoom griglia: sessione + vista. Chi zooma i righi lo fa per
     lavorare su più record — apre il dettaglio di un rigo, torna, apre il
     successivo — quindi il ritorno deve ritrovare lo schermo com'era. Con lo
     zoom memorizzato per ambito non c'è niente da azzerare alla navigazione: la
     vista di dettaglio nuova non ha una voce e si vede intera, al ritorno la
     griglia si rizooma da sé. Calcolato in render, non in un effect, o la vista
     nuova si dipingerebbe per un frame con lo zoom di quella vecchia. */
  const zoomScope = `${activeTab}|${currentTab?.ui?.viewName ?? ''}`;

  /* Tasto della modalità immersiva.

     F11 **deliberatamente non è legata**: il keydown arriva alla pagina e
     `preventDefault` ferma davvero il fullscreen nativo — verificato — ma è
     proprio questo il problema, l'applicazione si approprierebbe di una
     funzione del browser che l'utente si aspetta di trovare dov'è sempre stata.
     Shift+F11 resta nella stessa famiglia di tasti, non è rivendicata da nessun
     browser, e lascia F11 al suo mestiere.

     `allowWhileTyping`: è un tasto funzione, non digita niente, e passare a
     schermo intero mentre si compila un campo è legittimo. Senza, la
     scorciatoia sembra rotta ogni volta che il fuoco è dentro un input — che
     durante la compilazione di una testata è la condizione normale.

     Sui portatili però la fila dei funzione non è sempre raggiungibile: dove
     F11 di fabbrica è un tasto multimediale ci vuole anche `fn`, e una combo
     a tre tasti tenuti insieme o non arriva alla pagina o non si prova
     nemmeno (SXADV-5744.1, portatile Dell). Da qui la seconda combo:
     `Ctrl+Shift+F` sta sulla fila alfabetica, nessun browser la rivendica,
     ed è la stessa azione — due strade per la stessa porta, non due
     comportamenti. */
  const toggleImmersive = useCallback(
    () => (immersive ? exitImmersive() : enterImmersive()),
    [immersive, exitImmersive, enterImmersive],
  );
  useHotkey('Shift+F11', toggleImmersive, { allowWhileTyping: true });
  useHotkey('Ctrl+Shift+F', toggleImmersive, { allowWhileTyping: true });

  type AppBarButton = {
    key: string;
    icon: React.ReactNode;
    tooltip: string;
    onClick: () => void;
    visible: boolean;
    badge?: boolean;
    badgeCount?: number;
    danger?: boolean;
    // Persistent "this is what you are looking at" highlight (SXADV-5784.1).
    // Only buttons that open something durable set it; one-shot actions
    // (logout, cambio password, modali) get the press feedback only.
    active?: boolean;
  };

  // The menu function the active tab is showing, if it was opened from the menu
  // or from one of the app-bar shortcuts.
  const activeMenuId = currentTab?.menuId;

  // Corpo del carattere dell'interfaccia (SXADV-5745): e' una preferenza
  // personale, quindi vive nel menu utente insieme a login/profilo/uscita e non
  // si prende pixel di chrome — che e' proprio cio' che il ticket chiede di
  // restituire all'area di editing.
  const { density, setDensity } = useDensity();

  // Session-level functions, kept in both sidebar modes together with the
  // menu/documentale toggle itself.
  const commonBarButtons: AppBarButton[] = [
    { key: 'logout', icon: <LogoutOutlined />, tooltip: 'Esci', onClick: onLogout, visible: true, danger: true },
    { key: 'cdms', icon: sidebarMode === 'cdms' ? <AppstoreOutlined /> : <FileTextOutlined />, tooltip: sidebarMode === 'cdms' ? 'Torna al menu' : 'Documentale', onClick: () => sidebarMode === 'cdms' ? setSidebarMode('menu') : enterDocumentale(), visible: !!loginInfo.cdms, active: sidebarMode === 'cdms' },
    // Hidden when the credentials live in an external IdP (SSO): there the
    // password is not ours to change.
    { key: 'changePwd', icon: <LockOutlined />, tooltip: 'Cambio Password', onClick: () => showChangePasswordDialog(), visible: loginInfo.changePassword !== false },
    // Solo l'ingresso: in immersiva questa barra non c'è più, si esce con Esc o
    // col pulsante flottante.
    { key: 'immersive', icon: <FullscreenOutlined />, tooltip: 'Schermo intero (Ctrl+Shift+F o Shift+F11)', onClick: enterImmersive, visible: true },
  ];

  const appBarButtons: AppBarButton[] = [
    ...commonBarButtons,
    { key: 'email', icon: <MailOutlined />, tooltip: 'Posta Elettronica', onClick: () => handleMenuClick('menu.emailSent', 'Posta Elettronica'), visible: !!loginInfo.emailSent, active: activeMenuId === 'menu.emailSent' },
    // Agenda nascosta per ora: il pannello agenda non è ancora portato sul
    // client React. Per riattivarla: visible: !!loginInfo.agendaList
    { key: 'agenda', icon: <CalendarOutlined />, tooltip: 'Agenda', onClick: () => api.postAction2('ViewAgenda'), visible: false },
    { key: 'areaDoc', icon: <PrinterOutlined />, tooltip: 'Area Documenti', onClick: () => handleMenuClick('menu.cdmsRisorseDocAreaList', 'Area Documenti'), visible: !!loginInfo.areaDocumenti, active: activeMenuId === 'menu.cdmsRisorseDocAreaList' },
    // newSession moved to tab bar add button
    { key: 'help', icon: <QuestionCircleOutlined />, tooltip: 'Aiuto', onClick: () => {
      const fw = (window as unknown as Record<string, unknown>).FreshworksWidget as ((...args: unknown[]) => void) | undefined;
      if (fw) fw('open');
    }, visible: !!loginInfo.assistenza },
    // cdms moved to top of list
    { key: 'avvisi', icon: <BellOutlined />, tooltip: 'Avvisi', onClick: () => handleMenuClick('menu.avvisi', 'Avvisi'), visible: !!loginInfo.avvisi, active: activeMenuId === 'menu.avvisi' },
    { key: 'notifier', icon: <BulbOutlined />, tooltip: 'Notifiche', onClick: () => handleMenuClick('menu.notifications', 'Notifiche'), visible: !!loginInfo.notifications, badge: true, active: activeMenuId === 'menu.notifications' },
    { key: 'banners', icon: <NotificationOutlined />, tooltip: 'Avvisi e notifiche', onClick: () => setBannersModalOpen(true), visible: !!(loginInfo.banners && loginInfo.banners.length > 0), badgeCount: loginInfo.banners?.length || 0 },
    // Le tre funzioni qui sotto sono ingressi di primo livello come una voce di
    // menu, e come quelle devono intitolare la scheda e far ripartire il
    // percorso da zero: le prime due sono voci di menu invisibili (menu.xml,
    // `_$commstatList`/`_$jdbcstatList`) e il client legacy le apriva per id, la
    // terza non ha voce di menu e passa da openFunctionByAction (SXADV-5783).
    { key: 'profmanager', icon: <TeamOutlined />, tooltip: 'Gestione Profili Menu', onClick: () => openFunctionByAction('Gestione Profili Menu', 'ProfileManager', { navpath: 'menu' }), visible: true },
    { key: 'stats', icon: <ClockCircleOutlined />, tooltip: 'Comandi in esecuzione', onClick: () => handleMenuClick('menu._$commstatList', 'Comandi in esecuzione'), visible: true, active: activeMenuId === 'menu._$commstatList' },
    { key: 'jdbc', icon: <DatabaseOutlined />, tooltip: 'Connessioni attive', onClick: () => handleMenuClick('menu._$jdbcstatList', 'Connessioni attive'), visible: true, active: activeMenuId === 'menu._$jdbcstatList' },
    { key: 'expb', icon: <BuildOutlined />, tooltip: 'Costruttore Espressioni', onClick: () => handleMenuClick('menu.expBuilderList', 'Costruttore Espressioni'), visible: true, active: activeMenuId === 'menu.expBuilderList' },
  ];

  // Documentale mode swaps the gestionale functions for the documentale ones —
  // the toolbar of the legacy documentale client (newdocs.js): gestione profili
  // e utenti (admin), aggiungi albero (admin), cestino, wiki. Its "Gestionale"
  // button has no counterpart: the documentale is integrated here, and the
  // toggle above already goes back to the menu (SXADV-5790).
  const cdmsBarButtons: AppBarButton[] = [
    ...commonBarButtons,
    { key: 'cdmsProfili', icon: <TeamOutlined />, tooltip: 'Gestione Profili', onClick: () => openCdmsView('cdmsProfiliList', 'Gestione Profili'), visible: !!loginInfo.cdmsAdmin },
    { key: 'cdmsUtenti', icon: <IdcardOutlined />, tooltip: 'Gestione Utenti', onClick: () => openCdmsView('cdmsUtentiList', 'Gestione Utenti'), visible: !!loginInfo.cdmsAdmin },
    { key: 'cdmsNewTree', icon: <FolderAddOutlined />, tooltip: 'Aggiungi Albero', onClick: () => openFunctionByAction('Aggiungi Albero', 'AddPage', { viewName: 'cdmsNodiClassificazioneDetail' }), visible: !!loginInfo.cdmsAdmin },
    { key: 'cdmsTrash', icon: <DeleteOutlined />, tooltip: 'Cestino', onClick: () => openCdmsView('cdmsRisorseListCestino', 'Cestino'), visible: true },
    { key: 'cdmsWiki', icon: <ReadOutlined />, tooltip: 'Aiuto', onClick: () => window.open(loginInfo.wikiUrl, '_blank', 'noopener'), visible: !!loginInfo.wikiUrl },
  ];

  const visibleBarButtons = (sidebarMode === 'cdms' ? cdmsBarButtons : appBarButtons).filter((b) => b.visible);

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Global in-flight hint; suppressed while the heavy async-job overlay is up */}
      <TopProgressBar active={requestActive && !currentTab?.loading} />
      {/* Prominent busy overlay for the multi-second Azienda/Sede switch — an
          in-tree dimmed backdrop so it inherits the theme and can't be missed
          (the static toast rendered invisibly under the CSS-var theme). SXADV-5542 */}
      {contextChanging && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: 'rgba(0,0,0,0.45)' }}>
          <Spin size="large" />
          <div style={{ color: '#fff', fontSize: 16, fontWeight: 500 }}>Cambio in corso, attendere…</div>
        </div>
      )}
      {/* Uscita dalla modalità immersiva: senza header spariscono anche utente,
          profilo e sede, quindi una via d'uscita deve restare sempre visibile
          (Esc da sola non si scopre). */}
      {immersive && (
        <Tooltip title="Esci da schermo intero (Esc)" placement="left">
          <Button
            className="immersive-exit"
            type="text"
            icon={<FullscreenExitOutlined />}
            onClick={exitImmersive}
            aria-label="Esci da schermo intero"
          />
        </Tooltip>
      )}
      {/* Vertical app bar */}
      {!immersive && (
      <div className="app-bar">
        {visibleBarButtons
          .map((b) => (
            <Tooltip key={b.key} title={b.tooltip} placement="right">
              <Badge
                count={b.badgeCount || 0}
                dot={b.badge && !b.badgeCount}
                size="small"
                offset={b.badgeCount ? [-2, 6] : [-4, 4]}
                overflowCount={99}
              >
                <Button
                  type="text"
                  danger={b.danger}
                  icon={b.icon}
                  onClick={b.onClick}
                  className={b.active ? 'app-bar-btn app-bar-btn-active' : 'app-bar-btn'}
                  aria-current={b.active ? 'true' : undefined}
                />
              </Badge>
            </Tooltip>
          ))}
      </div>
      )}

      {/* Sidebar with menu */}
      {!immersive && (
      <div
        className="sidebar"
        style={{
          width: siderWidth,
          minWidth: siderWidth,
          height: '100vh',
          position: 'fixed',
          left: APPBAR_WIDTH,
          top: 0,
          bottom: 0,
          overflow: 'auto',
          background: '#fff',
          borderRight: '1px solid #e8e8e8',
          // Don't animate width while dragging — the transition fights the drag.
          transition: 'width 0.2s',
          zIndex: 99,
        }}
      >
        {/* Right-edge drag handle to resize the expanded sidebar (SXADV-5454.0.a) */}
        {!collapsed && (
          <div
            className="sidebar-resize-handle"
            onMouseDown={startSidebarResize}
            role="separator"
            aria-orientation="vertical"
            aria-label="Ridimensiona menu"
            style={{ left: APPBAR_WIDTH + siderWidth - 3 }}
          />
        )}
        {/* The sidebar's coloured band must stay exactly as tall as the main
            header — they read as one continuous strip across the top of the app,
            and any difference shows up as a step at the sidebar edge. Both derive
            from --app-header-h (SXADV-5742). */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-end', gap: 8, height: 'var(--app-header-h)', boxSizing: 'border-box', padding: collapsed ? '0' : '0 8px', background: loginInfo.bkColor || '#1E4176' }}>
          <Tooltip title={collapsed ? 'Espandi menu' : 'Comprimi menu'} placement="right">
            <Button
              type="text"
              aria-label={collapsed ? 'Espandi menu' : 'Comprimi menu'}
              style={{ color: '#fff' }}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
            />
          </Tooltip>
        </div>
        {/* Vendor mark, on white rather than on the coloured band. logo_dx is a
            dark-navy wordmark on transparency: over the brand background it had
            almost no contrast, and shrinking the band to header height (5742)
            made it unreadable. Below the band it sits on white at a legible size
            and costs the editing area nothing — the sidebar is not where the
            vertical budget is tight. */}
        {!collapsed && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 12px 6px' }}>
            {/* The asset is 386×128 with generous transparent margins, so the
                wordmark itself is much smaller than the box — it needs a
                generous height to read at all. */}
            <img src="/entrasp/images/logos/logo_dx.png" alt="Sixtema" style={{ maxHeight: 58, maxWidth: '85%', minWidth: 0, objectFit: 'contain' }} />
          </div>
        )}
        {sidebarMode === 'menu' ? (
          <>
            {!collapsed && (
              <div style={{ padding: '0 12px 8px' }}>
                <Input
                  placeholder="Cerca nel menu..."
                  prefix={<SearchOutlined />}
                  allowClear
                  value={menuFilter}
                  onChange={(e) => setMenuFilter(e.target.value)}
                />
              </div>
            )}
            <ConfigProvider theme={{ components: { Menu: { itemHeight: 28, itemColor: 'rgba(0,0,0,0.88)', itemHoverColor: '#1677ff', subMenuItemBg: '#eaeef5', itemBg: '#fff', itemSelectedColor: '#1677ff', itemSelectedBg: '#e6f4ff', itemMarginBlock: 0, itemMarginInline: 0, iconMarginInlineEnd: 8 } } }}>
              <Menu
                key={menuNonce}
                mode="inline"
                inlineCollapsed={collapsed}
                items={buildMenuItems(filteredMenu)}
                // Controlled selection: the internal (uncontrolled) one is lost on
                // every remount (menuNonce) and is per-Menu, not per-tab. Keying it
                // off the active tab keeps the open function highlighted and makes
                // the highlight follow tab switches (SXADV-5784.2).
                selectedKeys={currentTab?.menuId ? [currentTab.menuId] : []}
                {...(menuOpenKeys !== undefined ? { openKeys: menuOpenKeys } : {})}
                onClick={({ key }) => {
                  const label = findMenuLabel(menuItems, key) || key;
                  handleMenuClick(key, label);
                }}
              />
            </ConfigProvider>
          </>
        ) : (
          <Suspense fallback={<div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>}>
            <CdmsTree
              collapsed={collapsed}
              onFolderClick={handleCdmsFolderClick}
            />
          </Suspense>
        )}
      </div>
      )}

      {/* Main content. In immersiva l'area riprende i margini della chrome
          nascosta e occupa tutta la finestra. */}
      <Layout style={{ marginLeft: immersive ? 0 : APPBAR_WIDTH + siderWidth, transition: 'margin-left 0.2s', minWidth: 0, maxWidth: immersive ? '100vw' : `calc(100vw - ${APPBAR_WIDTH + siderWidth}px)`, height: '100vh', overflow: 'hidden' }}>
        {!immersive && (
        <Header
          style={{
            padding: '0 16px',
            background: loginInfo.bkColor || '#1E4176',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            // Vertical density (SXADV-5742): the header is the single largest
            // fixed band above the editing area. Height and logo size come from
            // the chrome scale in tokens.css so the whole band can be retuned in
            // one place instead of here and in the <img> below.
            height: 'var(--app-header-h)',
            minHeight: 'var(--app-header-h)',
            lineHeight: 'normal',
          }}
        >
          {/* Left: product logo (brand-driven) + release + ALFA env badge.
              Pandora instances show the white Pandora mark; Nebula instances keep
              logo_sx.png. "Rel." sits beside the mark for topical grouping and is
              prefixed "Rel." (SXADV-5454.2A). The ALFA badge appears only when the
              server runs in the test environment (SXADV-5454.2B). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <img
              src={loginInfo.brand === 'Pandora' ? '/entrasp/images/logos/pandora_bianco.png' : '/entrasp/images/logos/logo_sx.png'}
              alt={loginInfo.brand || 'Pandora'}
              style={{ height: 'var(--app-header-logo-h)', objectFit: 'contain', flexShrink: 0 }}
            />
            {loginInfo.dbVersion && (
              <Text style={{ color: '#fff', whiteSpace: 'nowrap', opacity: 0.9, fontSize: 12 }}>Rel. {loginInfo.dbVersion}</Text>
            )}
            {loginInfo.alfa && <span className="alfa-badge">ALFA</span>}
          </div>

          {/* Center: company/site selectors */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', justifyContent: 'center', flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              {loginInfo.aziende && loginInfo.aziende.length === 1 && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                  <Text style={hdrLabelStyle}>Azienda:</Text>
                  <Text strong style={{ color: '#fff' }}>{loginInfo.aziende[0].text}</Text>
                </div>
              )}
              {loginInfo.aziende && loginInfo.aziende.length > 1 && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap', whiteSpace: 'nowrap', minWidth: 0 }}>
                  <Text style={hdrLabelStyle}>Azienda:</Text>
                  <Select
                    size="small"
                    className="header-select"
                    value={loginInfo.customerKey}
                    onChange={handleAziendaChange}
                    loading={contextChanging}
                    disabled={contextChanging}
                    style={{ width: 240, minWidth: 0 }}
                    options={loginInfo.aziende}
                    fieldNames={{ label: 'text', value: 'value' }}
                  />
                </div>
              )}
              {loginInfo.sedi && loginInfo.sedi.length === 1 && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                  <Text style={hdrLabelStyle}>Sede:</Text>
                  <Text strong style={{ color: '#fff' }}>{loginInfo.sedi[0].text}</Text>
                </div>
              )}
              {loginInfo.sedi && loginInfo.sedi.length > 1 && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap', whiteSpace: 'nowrap', minWidth: 0 }}>
                  <Text style={hdrLabelStyle}>Sede:</Text>
                  <Select
                    size="small"
                    className="header-select"
                    value={loginInfo.sede}
                    onChange={handleSedeChange}
                    loading={contextChanging}
                    disabled={contextChanging}
                    style={{ width: 240, minWidth: 0 }}
                    options={loginInfo.sedi}
                    fieldNames={{ label: 'text', value: 'value' }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Right: company logo + identity block + user menu. Login/Profilo is
              anchored here, right before the login icon (SXADV-5454.4b); its
              background is highlighted for immediate legibility (SXADV-5454.3) and
              the status dot is green — active login — not red (SXADV-5454.4a). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            {loginInfo.logoaz && !loginInfo.logoaz.endsWith('/') && !loginInfo.logoaz.includes('null') && (
              <img
                src={`/entrasp/${loginInfo.logoaz}`}
                alt="Azienda"
                style={{ height: 'var(--app-header-logo-h)', maxWidth: 160, objectFit: 'contain' }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <div className="login-chip">
              <Text style={{ color: '#fff' }}>Utente: <Text strong style={{ color: '#fff' }}>{loginInfo.login}</Text></Text>
              <Text style={{ color: '#fff' }}>Profilo: <Text strong style={{ color: '#fff' }}>{loginInfo.profile}</Text></Text>
            </div>
            <Dropdown
              menu={{
                items: [
                  { key: 'user', label: `${loginInfo.login} (${loginInfo.profile})`, icon: <UserOutlined />, disabled: true },
                  { type: 'divider' as const, key: 'div' },
                  {
                    key: 'density',
                    label: 'Dimensione caratteri',
                    icon: <FontSizeOutlined />,
                    children: DENSITY_OPTIONS.map((o) => ({
                      key: `density:${o.value}`,
                      label: (
                        <Space size={6}>
                          <CheckOutlined style={{ visibility: o.value === density ? 'visible' : 'hidden' }} />
                          <span>{o.label}</span>
                          <Text type="secondary" style={{ fontSize: 'var(--app-font-size-sm)' }}>{o.hint}</Text>
                        </Space>
                      ),
                    })),
                  },
                  { type: 'divider' as const, key: 'div2' },
                  { key: 'logout', label: 'Esci', icon: <LogoutOutlined />, danger: true },
                ],
                onClick: ({ key }) => {
                  if (key === 'logout') onLogout();
                  else if (key.startsWith('density:')) setDensity(key.slice('density:'.length) as Density);
                },
              }}
            >
              <Space style={{ cursor: 'pointer', color: '#fff', flexShrink: 0 }}>
                {/* No status dot here: the old red dot (notifications) read as a
                    "login disabled" signal, and a fixed green dot carried no real
                    information — removed rather than kept as decoration (SXADV-5454.4a). */}
                <UserOutlined style={{ fontSize: 18, color: '#fff' }} />
              </Space>
            </Dropdown>
          </div>
        </Header>
        )}

        {/* In immersiva il margine destro fa posto al pulsante di uscita, che è
            flottante: senza, si sovrappone ai comandi allineati a destra della
            toolbar e li rende non cliccabili. */}
        <Content style={{ padding: 'var(--app-chrome-gap-sm) var(--app-chrome-pad-x)', paddingRight: immersive ? 'calc(var(--app-chrome-pad-x) + 30px)' : undefined, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, minHeight: 0 }}>
          {/* Session tabs. `size="small"` + the .session-tabs rules trim the card
              tabs to roughly the legacy tab-link height (SXADV-5742.2), and
              tabBarStyle kills antd's 16px nav margin, which was the entire gap
              between the tab strip and the editing area (SXADV-5742.3). */}
          {/* Nascosta in immersiva insieme al resto della chrome: si perde il
              cambio sessione finché si è dentro, ed è il motivo per cui l'uscita
              deve costare un tasto solo. */}
          {!immersive && (
          <Tabs
            className={atSessionLimit ? 'session-tabs session-tabs-full' : 'session-tabs'}
            type="editable-card"
            size="small"
            tabBarStyle={{ margin: 0 }}
            activeKey={activeTab}
            onChange={handleTabChange}
            onEdit={handleTabEdit}
            addIcon={
              <Tooltip title={atSessionLimit ? `Limite di ${sessionLimit} sessioni raggiunto` : 'Nuova sessione'}>
                <PlusOutlined />
              </Tooltip>
            }
            items={tabs.map((t) => ({
              key: t.key,
              label: t.label,
              closable: tabs.length > 1,
            }))}
          />
          )}
          {currentTab && (
            <ZoomScopeContext.Provider value={zoomScope}>
            <SidContext.Provider value={currentTab.sid}>
            <PaneToolbarContext.Provider value={setPaneToolbar}>
            <FormValuesContext.Provider value={() => formValuesRef.current[currentTab.key] || {}}>
              <div className="tab-content" ref={tabContentRef} style={{ position: 'relative' }}>
                {currentTab.loading && (
                  <div className="loading-overlay">
                    <Spin size="large" tip={currentTab.progressPct != null ? `${currentTab.progressPct}%` : undefined}>
                      <div style={{ minHeight: 60 }} />
                    </Spin>
                  </div>
                )}
                {currentTab.ui ? (
                  <>
                    {/* marginBottom keeps the breadcrumb ("« Ritorno un passo indietro")
                        clear of the action toolbar below it, so a slightly-off click
                        doesn't land on a button (SXADV-5685.2) — kept, but on the
                        chrome scale: the band's own padding carries most of the
                        separation, so the margin no longer has to be 8px on top of
                        it (SXADV-5742). */}
                    {(parsedBreadcrumbs.length > 0 || currentTab.ui?.attachmentsInfo) && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '0 8px', marginBottom: 'var(--app-chrome-gap-sm)' }}>
                        {parsedBreadcrumbs.length > 0 ? (
                          <Breadcrumb
                            style={{ padding: 'var(--app-chrome-band-pad-y) 0', maxWidth: '100%', flex: 1, minWidth: 0 }}
                            items={parsedBreadcrumbs.map((b, i) => ({
                              title: b.action ? (
                                <a
                                  title={b.title}
                                  className={b.isBack ? 'breadcrumb-back-link' : 'breadcrumb-link'}
                                  style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'bottom', color: '#1677ff', cursor: 'pointer', fontWeight: b.isBack ? 600 : undefined }}
                                  onClick={() => {
                                    const params: Record<string, string> = {};
                                    if (b.navpath) params.navpath = b.navpath;
                                    if (b.option1) params.option1 = b.option1;
                                    // Going back to crumb #i leaves the trail that
                                    // precedes it (the view landed on is the last
                                    // history entry, and the trail omits it). Arm the
                                    // shortened trail; processResponseInner applies it
                                    // if the navigation actually happened (SXADV-5659).
                                    pendingBreadcrumbsRef.current = {
                                      tabKey: currentTab.key,
                                      html: parsedBreadcrumbs.slice(0, i).map((c) => c.html).join(''),
                                    };
                                    handleAction(b.action!, Object.keys(params).length > 0 ? params : undefined);
                                  }}
                                >{b.isBack ? '« ' : ''}{b.title}</a>
                              ) : (
                                <span
                                  title={b.title}
                                  style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'bottom' }}
                                >{b.title}</span>
                              ),
                            })).concat(titleIsLastCrumb ? [{
                              // Closing crumb: where the user IS. Not a link and
                              // weighted like a heading, since it replaces the
                              // view's own title row (SXADV-5742).
                              title: (
                                <span
                                  className="breadcrumb-current"
                                  title={currentTab.ui!.title}
                                >{currentTab.ui!.title}</span>
                              ),
                            }] : [])}
                          />
                        ) : <span style={{ flex: 1 }} />}
                        {currentTab.ui?.attachmentsInfo && (
                          <AttachmentsBar
                            info={currentTab.ui.attachmentsInfo}
                            sid={currentTab.sid}
                            navpath={currentTab.ui?.path}
                            onRefresh={() => handleAction('Refresh')}
                            onOpenMetadata={(key) => handleAction('CdmsEdit', { navpath: key })}
                          />
                        )}
                      </div>
                    )}
                    {!viewHasOlapCube(currentTab.ui) && (
                      <Toolbar items={currentTab.toolbar || []} paging={currentTab.ui?.paging} pageType={currentTab.ui?.pageType} onAction={handleAction} />
                    )}
                    <EditRowContext.Provider value={handleEditRow}>
                      <FlushEditsContext.Provider value={flushFieldEdits}>
                      <PendingAddContext.Provider value={consumePendingAdd}>
                        <DataVersionContext.Provider value={currentTab.dataVersion ?? 0}>
                          <TitleInBreadcrumbContext.Provider value={titleIsLastCrumb}>
                            <ViewRenderer
                              ui={currentTab.ui}
                              onAction={handleAction}
                              onChange={handleFieldChange}
                              onGridChange={handleGridChange}
                              onEditRow={handleEditRow}
                            />
                          </TitleInBreadcrumbContext.Provider>
                        </DataVersionContext.Provider>
                      </PendingAddContext.Provider>
                      </FlushEditsContext.Provider>
                    </EditRowContext.Provider>
                  </>
                ) : (
                  currentTab.loading ? null : (
                    <HomePanel loginInfo={loginInfo} onBannerClick={handleBannerClick} />
                  )
                )}
                {/* Copyright: out of flow at the foot of the tab, and only when
                    the view leaves room for it — see measureCopyrightRoom. */}
                {loginInfo.copyright && copyrightFits && (
                  <div className="view-copyright">&copy; {loginInfo.copyright}</div>
                )}
              </div>
            </FormValuesContext.Provider>
            </PaneToolbarContext.Provider>
            </SidContext.Provider>
            </ZoomScopeContext.Provider>
          )}
        </Content>
      </Layout>

      {loginInfo.changePassword !== false && (
        <ChangePasswordModal
          open={changePasswordOpen}
          onClose={() => setChangePasswordOpen(false)}
          onServerErrors={handleErrors}
        />
      )}

      <ImpersonateModal
        open={impersonateOpen}
        onClose={() => setImpersonateOpen(false)}
        onSuccess={refreshAfterIdentityChange}
      />

      {/* Banners modal: shows all active banners regardless of banHomePage */}
      <Modal
        title={<><NotificationOutlined style={{ color: '#1677ff', marginRight: 8 }} />Avvisi e notifiche</>}
        open={bannersModalOpen}
        onCancel={() => setBannersModalOpen(false)}
        footer={null}
        width={680}
      >
        {(loginInfo.banners || []).length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>Nessun avviso</div>
        ) : (
          <div style={{ maxHeight: '60vh', overflow: 'auto', paddingRight: 4 }}>
            {(loginInfo.banners || []).map((b, i) => (
              <BannerCard
                key={i}
                banner={b}
                onNavigate={(to) => {
                  setBannersModalOpen(false);
                  handleBannerClick(to);
                }}
                compact
              />
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Shell;
