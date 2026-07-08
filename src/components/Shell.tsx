import React, { useState, useCallback, useRef, useMemo, useEffect, Suspense } from 'react';
import { Layout, Menu, Tabs, Breadcrumb, Badge, Dropdown, Space, Typography, Modal, Input, Button, Tooltip, Select, Spin, message, ConfigProvider } from 'antd';
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
} from '../types/ui';
import Toolbar from './Toolbar';
import AttachmentsBar from './AttachmentsBar';
import { viewHasOlapCube } from './olap/detect';
import ViewRenderer, { SidContext, FormValuesContext } from './ViewRenderer';
import HomePanel from './HomePanel';
import BannerCard from './BannerCard';
import TopProgressBar from './TopProgressBar';
import { ensureNotificationPermission, notify } from '../services/notifications';
import * as api from '../services/api';
import { putTemplate, getTemplate } from '../services/templateCache';
import { hydrate } from '../services/hydrate';
import { negationFieldName } from '../controls/helpers';
import { consumePendingFocus, restoreFocus } from '../services/focusRestore';

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
}

interface ShellProps {
  menuItems: MenuItem[];
  loginInfo: LoginInfo;
  onLogout: () => void;
  onReloadMenu: () => void;
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

function buildMenuItems(items: MenuItem[], level = 0): NonNullable<React.ComponentProps<typeof Menu>['items']> {
  return items.map((item) => ({
    key: item.id,
    label: item.description,
    title: item.description,
    // Tag top-level rows so CSS can render Modules distinctly from sub-functions
    ...(level === 0 ? { className: 'menu-module' } : {}),
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

const Shell: React.FC<ShellProps> = ({ menuItems, loginInfo, onLogout, onReloadMenu }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [tabs, setTabs] = useState<TabState[]>([defaultTab]);
  const [activeTab, setActiveTab] = useState<string>('tab_1');
  const [menuFilter, setMenuFilter] = useState('');
  const [sidebarMode, setSidebarMode] = useState<'menu' | 'cdms'>('menu');
  const [bannersModalOpen, setBannersModalOpen] = useState(false);
  const [requestActive, setRequestActive] = useState(false);
  const formValuesRef = useRef<Record<string, Record<string, string | string[]>>>({ tab_1: defaultTab.formValues });

  // Reflect any in-flight controller request as a thin top progress bar.
  useEffect(() => api.subscribeInFlight((count) => setRequestActive(count > 0)), []);

  const handleAziendaChange = useCallback(async (value: string) => {
    await api.postAction2('CambioAzienda', { navpath: value });
    onReloadMenu();
  }, [onReloadMenu]);

  const handleSedeChange = useCallback(async (value: string) => {
    await api.postAction2('CambioSede', { navpath: value });
    onReloadMenu();
  }, [onReloadMenu]);

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
          Modal.confirm({
            content: err.message,
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
  }, [getActiveTabState]);

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
      // Two-phase pipeline — METADATA+DATA: cache the stable template and
      // render the initial hydrated tree. The binding manifest is per-tab
      // (not cached with the template) — it maps each structural scope to
      // the viewstate id the server allocated for this tab, so form posts
      // can compose wire-form keys.
      if (resp.template && resp.templateKey) {
        putTemplate(resp.templateKey, resp.template);
        const bindings = resp.bindings ?? {};
        const scopePaths = resp.scopePaths ?? {};
        const hydrated = hydrate(resp.template, resp.values, resp.dynProps, bindings, scopePaths);
        // Breadcrumbs vary per navigation and are NOT cached in the template
        // -- merge them in from the response root.
        update.ui = resp.breadcrumbs !== undefined ? { ...hydrated, breadcrumbs: resp.breadcrumbs } : hydrated;
        update.templateKey = resp.templateKey;
        update.bindings = bindings;
        update.scopePaths = scopePaths;
        const newFormValues = extractFormValues(hydrated);
        formValuesRef.current[tabKey] = newFormValues;
        update.formValues = newFormValues;
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
          // them and the server doesn't re-emit them on reloads).
          const carried = existingTab?.ui?.breadcrumbs;
          update.ui = carried !== undefined ? { ...hydrated, breadcrumbs: carried } : hydrated;
          update.templateKey = resp.ui.templateKey;
          const newFormValues = extractFormValues(hydrated);
          formValuesRef.current[tabKey] = newFormValues;
          update.formValues = newFormValues;
        } else {
          console.warn('[template-cache] missed key', resp.ui.templateKey, '— server emitted DATA-only but client has no template');
        }
      }
      else if (resp.ui) {
        // Tree+detail: when current view is a tree and response is the detail (Save/Post),
        // store the detail in the tree UI instead of replacing the tree
        const existingTab0 = tabs.find(t => t.key === tabKey);
        if (existingTab0?.ui?.viewType === 'tree' && resp.ui.viewType !== 'tree' && !resp.ui.treeNodes) {
          // Update the tree's embedded detail — TreeRenderer will pick it up
          update.ui = { ...existingTab0.ui, _detailResponse: resp.ui } as UITree;
          const newFormValues = extractFormValues(resp.ui);
          formValuesRef.current[tabKey] = newFormValues;
          update.formValues = newFormValues;
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
        } else {
          update.ui = resp.ui;
          // Initialize form values from all controls in the UI tree
          const newFormValues = extractFormValues(resp.ui);
          formValuesRef.current[tabKey] = newFormValues;
          // Also update the tab state's formValues
          update.formValues = newFormValues;
        }
      }
      // attachmentsInfo is per-record and emitted at response root (not
      // cached with the template). Merge into update.ui in all flows.
      if (resp.attachmentsInfo !== undefined && update.ui) {
        update.ui = { ...update.ui, attachmentsInfo: resp.attachmentsInfo };
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
              window.open(`${CMD2}?action=LoadPdf&fileName=${encodeURIComponent(fileName)}&index=${encodeURIComponent(index)}&type=application/pdf`);
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
      if (Object.keys(update).length > 0) {
        updateTabState(tabKey, update);
      }
      // Restore focus after React re-renders. The target id was
      // captured by useControlChange right before the reload fired.
      restoreFocus(consumePendingFocus());
    },
    [handleErrors, updateTabState, extractFormValues]
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
            message.error(`Error: ${e}`);
          })
          .finally(() => { document.body.style.cursor = ''; });
      };
      return replay;
    },
    [processResponse, updateTabState]
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
      updateTabState(tab.key, { label: menuLabel, loading: true, progressPct: undefined, formValues: tab.formValues });

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
    [getActiveTabState, processResponse, updateTabState, makeConfirmReplay]
  );

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

      // After identity change, reload menu and refresh current tab view
      const refreshAfterIdentityChange = async () => {
        onReloadMenu();
        try {
          const resp = await api.postAction('Refresh', {}, undefined, tab.sid);
          processResponse(tab.key, resp);
        } catch {
          // View not accessible — clear the tab
          updateTabState(tab.key, { ui: undefined, toolbar: undefined, uiData: undefined });
        }
      };

      // Impersonate dialog: modal asking for username → controller2 → refresh
      if (action === 'impersonateDialog') {
        let usernameValue = '';
        Modal.confirm({
          title: 'Impersona un utente',
          content: (
            <Input
              placeholder="Username"
              autoFocus
              style={{ marginTop: 8 }}
              onChange={(e) => { usernameValue = e.target.value; }}
              onPressEnter={() => {
                Modal.destroyAll();
                if (usernameValue.trim()) {
                  api.postAction2('Impersonate', { username: usernameValue.trim() }).then((resp) => {
                    const r = resp as Record<string, unknown>;
                    if (r.errors && (r.errors as unknown[]).length > 0) {
                      message.error('Utente non trovato');
                    } else {
                      refreshAfterIdentityChange();
                    }
                  });
                }
              }}
            />
          ),
          okText: 'Impersona',
          cancelText: 'Annulla',
          onOk: () => {
            if (!usernameValue.trim()) return;
            return api.postAction2('Impersonate', { username: usernameValue.trim() }).then((resp) => {
              const r = resp as Record<string, unknown>;
              if (r.errors && (r.errors as unknown[]).length > 0) {
                message.error('Utente non trovato');
              } else {
                refreshAfterIdentityChange();
              }
            });
          },
        });
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

      // Two-phase pipeline: opt into the template/data protocol. If this tab
      // already holds a template, advertise its key so the server can decide
      // DATA-only vs METADATA+DATA based on whether the resolved view matches.
      serverParams.hasTemplate = '1';
      if (tab.templateKey) serverParams.templateKey = tab.templateKey;

      // For listEdit: include the editing row's navpath for data-modifying actions
      // (Save, Post, etc.) so the server positions on the correct row.
      // Don't inject for navigation actions that have their own positioning.
      // For listEdit: include the editing row's navpath for data-modifying actions
      // (Save, Post, etc.) so the server positions on the correct row.
      // Navigation actions have their own positioning — clear edit state instead.
      const navActions = ['NextPage', 'PrevPage', 'FirstPage', 'LastPage', 'GotoPage', 'SortColumn', 'Refresh'];
      if (navActions.includes(action)) {
        editNavpathRef.current = null;
      } else if (editNavpathRef.current && !serverParams.navpath) {
        serverParams.navpath = editNavpathRef.current;
      }

      document.body.style.cursor = 'wait';
      const fv = noFormValues ? undefined : formValuesRef.current[tab.key];
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
        message.error(`Error: ${e}`);
      } finally {
        document.body.style.cursor = '';
      }
    },
    [getActiveTabState, processResponse, updateTabState, handleErrors, onReloadMenu, makeConfirmReplay]
  );

  // CDMS: clicking a folder in the tree opens a filtered document list in the active tab
  const handleCdmsFolderClick = useCallback(
    async (cdmsId: string, folderName: string) => {
      const tab = getActiveTabState();
      if (!tab || tab.loading) return;
      // Extract UUID from cdmsId (part after last |)
      const uuid = cdmsId.substring(cdmsId.lastIndexOf('|') + 1);
      const filter = `exists(nodi[idNodoClass = '${uuid}'])`;
      tab.formValues = {};
      formValuesRef.current[tab.key] = tab.formValues;
      editNavpathRef.current = null;
      updateTabState(tab.key, { label: folderName, ui: undefined, toolbar: undefined, uiData: undefined, currField: undefined, formValues: tab.formValues });
      document.body.style.cursor = 'wait';
      try {
        const resp = await api.postAction('ListPage', {
          viewName: 'cdmsRisorseList',
          filter,
          title: folderName,
        }, undefined, tab.sid);
        processResponse(tab.key, resp);
      } catch (e) {
        message.error(`Error: ${e}`);
      } finally {
        document.body.style.cursor = '';
      }
    },
    [getActiveTabState, updateTabState, processResponse],
  );

  const handleFieldChange = useCallback(
    (name: string, value: unknown) => {
      const tab = getActiveTabState();
      if (!tab) return;
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

  // Track which row is being edited in listEdit mode (navpath sent with Save/Post)
  // Use a ref to avoid triggering re-renders on every row switch
  const editNavpathRef = useRef<string | null>(null);
  const handleEditRow = useCallback(
    (navpath: string | null) => {
      editNavpathRef.current = navpath;
    },
    []
  );

  const handleTabChange = (key: string) => setActiveTab(key);

  const handleTabEdit = (
    targetKey: React.MouseEvent | React.KeyboardEvent | string,
    action: 'add' | 'remove'
  ) => {
    if (action === 'add') {
      tabCounter++;
      const fv = {};
      formValuesRef.current[`tab_${tabCounter}`] = fv;
      setTabs(prev => [...prev, { key: `tab_${tabCounter}`, label: `Sessione ${tabCounter}`, sid: `S${tabCounter}`, formValues: fv }]);
      setActiveTab(`tab_${tabCounter}`);
    } else if (action === 'remove') {
      const key = typeof targetKey === 'string' ? targetKey : '';
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
    }
  };

  const findMenuLabel = (items: MenuItem[], id: string): string | undefined => {
    for (const item of items) {
      if (item.id === id) return item.description;
      if (item.children) {
        const found = findMenuLabel(item.children, id);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };

  const currentTab = getActiveTabState();
  const breadcrumbs = currentTab?.ui?.breadcrumbs;

  // Parse HTML breadcrumbs into structured items
  const parsedBreadcrumbs = useMemo(() => {
    if (!breadcrumbs) return [];
    const items: { title: string; action?: string; navpath?: string; option1?: string; isBack?: boolean }[] = [];
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
          action: m?.[1],
          navpath: m?.[2],
          option1: m?.[3],
          isBack,
        });
      }
    });
    return items;
  }, [breadcrumbs]);

  const APPBAR_WIDTH = 48;
  const siderWidth = collapsed ? 80 : 260;

  const showChangePasswordDialog = useCallback(() => {
    const values = { oldpwd: '', newpwd: '', newpwd2: '' };
    Modal.confirm({
      title: 'Cambio Password',
      icon: null,
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          <Input.Password
            placeholder="Password attuale"
            onChange={(e) => { values.oldpwd = e.target.value; }}
          />
          <Input.Password
            placeholder="Nuova password"
            onChange={(e) => { values.newpwd = e.target.value; }}
          />
          <Input.Password
            placeholder="Ripeti nuova password"
            onChange={(e) => { values.newpwd2 = e.target.value; }}
          />
        </div>
      ),
      okText: 'Cambia Password',
      cancelText: 'Annulla',
      onOk: async () => {
        if (!values.newpwd) {
          message.error('Inserire la nuova password');
          throw ''; // keep modal open
        }
        if (values.newpwd !== values.newpwd2) {
          message.error('Le password non coincidono');
          throw ''; // keep modal open
        }
        const resp = await api.postAction2('ChangePassword2', values);
        if (resp.errors && resp.errors.length > 0) {
          handleErrors(resp.errors);
          const hasError = resp.errors.some(e => e.type === 'ERROR');
          if (hasError) throw ''; // keep modal open
        }
      },
    });
  }, [handleErrors]);

  const appBarButtons: {
    key: string;
    icon: React.ReactNode;
    tooltip: string;
    onClick: () => void;
    visible: boolean;
    badge?: boolean;
    badgeCount?: number;
    danger?: boolean;
  }[] = [
    { key: 'logout', icon: <LogoutOutlined />, tooltip: 'Esci', onClick: onLogout, visible: true, danger: true },
    { key: 'cdms', icon: sidebarMode === 'cdms' ? <AppstoreOutlined /> : <FileTextOutlined />, tooltip: sidebarMode === 'cdms' ? 'Torna al menu' : 'Documentale', onClick: () => setSidebarMode((m) => m === 'cdms' ? 'menu' : 'cdms'), visible: !!loginInfo.cdms },
    { key: 'changePwd', icon: <LockOutlined />, tooltip: 'Cambio Password', onClick: () => showChangePasswordDialog(), visible: true },
    { key: 'email', icon: <MailOutlined />, tooltip: 'Posta Elettronica', onClick: () => handleMenuClick('menu.emailSent', 'Posta Elettronica'), visible: !!loginInfo.emailSent },
    { key: 'agenda', icon: <CalendarOutlined />, tooltip: 'Agenda', onClick: () => api.postAction2('ViewAgenda'), visible: !!loginInfo.agendaList },
    { key: 'areaDoc', icon: <PrinterOutlined />, tooltip: 'Area Documenti', onClick: () => handleMenuClick('menu.cdmsRisorseDocAreaList', 'Area Documenti'), visible: !!loginInfo.areaDocumenti },
    // newSession moved to tab bar add button
    { key: 'help', icon: <QuestionCircleOutlined />, tooltip: 'Aiuto', onClick: () => {
      const fw = (window as unknown as Record<string, unknown>).FreshworksWidget as ((...args: unknown[]) => void) | undefined;
      if (fw) fw('open');
    }, visible: !!loginInfo.assistenza },
    // cdms moved to top of list
    { key: 'avvisi', icon: <BellOutlined />, tooltip: 'Avvisi', onClick: () => handleMenuClick('menu.avvisi', 'Avvisi'), visible: !!loginInfo.avvisi },
    { key: 'notifier', icon: <BulbOutlined />, tooltip: 'Notifiche', onClick: () => handleMenuClick('menu.notifications', 'Notifiche'), visible: !!loginInfo.notifications, badge: true },
    { key: 'banners', icon: <NotificationOutlined />, tooltip: 'Avvisi e notifiche', onClick: () => setBannersModalOpen(true), visible: !!(loginInfo.banners && loginInfo.banners.length > 0), badgeCount: loginInfo.banners?.length || 0 },
    { key: 'profmanager', icon: <TeamOutlined />, tooltip: 'Gestione Profili Menu', onClick: () => handleAction('ProfileManager', { navpath: 'menu' }), visible: true },
    { key: 'stats', icon: <ClockCircleOutlined />, tooltip: 'Comandi in esecuzione', onClick: () => handleAction('CommStats'), visible: true },
    { key: 'jdbc', icon: <DatabaseOutlined />, tooltip: 'Connessioni attive', onClick: () => handleAction('JDBCStats'), visible: true },
    { key: 'expb', icon: <BuildOutlined />, tooltip: 'Costruttore Espressioni', onClick: () => handleMenuClick('menu.expBuilderList', 'Costruttore Espressioni'), visible: true },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Global in-flight hint; suppressed while the heavy async-job overlay is up */}
      <TopProgressBar active={requestActive && !currentTab?.loading} />
      {/* Vertical app bar */}
      <div className="app-bar">
        {appBarButtons
          .filter((b) => b.visible)
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
                  className="app-bar-btn"
                />
              </Badge>
            </Tooltip>
          ))}
      </div>

      {/* Sidebar with menu */}
      <div
        className="sidebar"
        style={{
          width: collapsed ? 80 : 260,
          minWidth: collapsed ? 80 : 260,
          height: '100vh',
          position: 'fixed',
          left: APPBAR_WIDTH,
          top: 0,
          bottom: 0,
          overflow: 'auto',
          background: '#fff',
          borderRight: '1px solid #e8e8e8',
          transition: 'width 0.2s',
          zIndex: 99,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', gap: 8, height: 80, boxSizing: 'border-box', padding: collapsed ? '0' : '0 12px', background: loginInfo.bkColor || '#1E4176' }}>
          {!collapsed && (
            <img src="/entrasp/images/logos/logo_dx.png" alt="Sixtema" style={{ maxHeight: 66, maxWidth: '88%', minWidth: 0, objectFit: 'contain' }} />
          )}
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
                mode="inline"
                inlineCollapsed={collapsed}
                items={buildMenuItems(filteredMenu)}
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
              onAction={handleAction}
            />
          </Suspense>
        )}
      </div>

      {/* Main content */}
      <Layout style={{ marginLeft: APPBAR_WIDTH + siderWidth, transition: 'margin-left 0.2s', minWidth: 0, maxWidth: `calc(100vw - ${APPBAR_WIDTH + siderWidth}px)`, height: '100vh', overflow: 'hidden' }}>
        <Header
          style={{
            padding: '0 16px',
            background: loginInfo.bkColor || '#1E4176',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            height: 80,
            minHeight: 80,
            lineHeight: 'normal',
          }}
        >
          {/* Left: product logo, brand-driven. Pandora instances show the white
              Pandora mark; Nebula instances keep logo_sx.png. Sized full-height
              so the white wordmark is legible on the dark header. */}
          <img
            src={loginInfo.brand === 'Pandora' ? '/entrasp/images/logos/pandora_bianco.png' : '/entrasp/images/logos/logo_sx.png'}
            alt={loginInfo.brand || 'Pandora'}
            style={{ height: 64, objectFit: 'contain', flexShrink: 0 }}
          />

          {/* Center: identity, company/site selectors, release */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', justifyContent: 'center', flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, whiteSpace: 'nowrap' }}>
              <Text style={{ color: '#fff' }}>Utente: <Text strong style={{ color: '#fff' }}>{loginInfo.login}</Text></Text>
              <Text style={{ color: '#fff' }}>Profilo: <Text strong style={{ color: '#fff' }}>{loginInfo.profile}</Text></Text>
            </div>
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
                    style={{ width: 240, minWidth: 0 }}
                    options={loginInfo.sedi}
                    fieldNames={{ label: 'text', value: 'value' }}
                  />
                </div>
              )}
            </div>
            {loginInfo.dbVersion && (
              <Text style={{ color: '#fff', whiteSpace: 'nowrap', opacity: 0.9 }}>{loginInfo.dbVersion}</Text>
            )}
          </div>

          {/* Right: company logo (if any) + Sixtema wordmark + user menu */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            {loginInfo.logoaz && !loginInfo.logoaz.endsWith('/') && !loginInfo.logoaz.includes('null') && (
              <img
                src={`/entrasp/${loginInfo.logoaz}`}
                alt="Azienda"
                style={{ height: 48, maxWidth: 160, objectFit: 'contain' }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <Dropdown
              menu={{
                items: [
                  { key: 'user', label: `${loginInfo.login} (${loginInfo.profile})`, icon: <UserOutlined />, disabled: true },
                  { type: 'divider' as const, key: 'div' },
                  { key: 'logout', label: 'Esci', icon: <LogoutOutlined />, danger: true },
                ],
                onClick: ({ key }) => {
                  if (key === 'logout') onLogout();
                },
              }}
            >
              <Space style={{ cursor: 'pointer', color: '#fff', flexShrink: 0 }}>
                <Badge dot={!!loginInfo.notifications}>
                  <UserOutlined style={{ fontSize: 18, color: '#fff' }} />
                </Badge>
              </Space>
            </Dropdown>
          </div>
        </Header>

        <Content style={{ padding: '8px 16px', margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, minHeight: 0 }}>
          <Tabs
            type="editable-card"
            activeKey={activeTab}
            onChange={handleTabChange}
            onEdit={handleTabEdit}
            items={tabs.map((t) => ({
              key: t.key,
              label: t.label,
              closable: tabs.length > 1,
            }))}
          />
          {currentTab && (
            <SidContext.Provider value={currentTab.sid}>
            <FormValuesContext.Provider value={() => formValuesRef.current[currentTab.key] || {}}>
              <div className="tab-content" style={{ position: 'relative' }}>
                {currentTab.loading && (
                  <div className="loading-overlay">
                    <Spin size="large" tip={currentTab.progressPct != null ? `${currentTab.progressPct}%` : undefined}>
                      <div style={{ minHeight: 60 }} />
                    </Spin>
                  </div>
                )}
                {currentTab.ui ? (
                  <>
                    {(parsedBreadcrumbs.length > 0 || currentTab.ui?.attachmentsInfo) && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '0 8px' }}>
                        {parsedBreadcrumbs.length > 0 ? (
                          <Breadcrumb
                            style={{ padding: '6px 0', maxWidth: '100%', flex: 1, minWidth: 0 }}
                            items={parsedBreadcrumbs.map((b) => ({
                              title: b.action ? (
                                <a
                                  title={b.title}
                                  className={b.isBack ? 'breadcrumb-back-link' : 'breadcrumb-link'}
                                  style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'bottom', color: '#1677ff', cursor: 'pointer', fontWeight: b.isBack ? 600 : undefined }}
                                  onClick={() => {
                                    const params: Record<string, string> = {};
                                    if (b.navpath) params.navpath = b.navpath;
                                    if (b.option1) params.option1 = b.option1;
                                    handleAction(b.action!, Object.keys(params).length > 0 ? params : undefined);
                                  }}
                                >{b.isBack ? '« ' : ''}{b.title}</a>
                              ) : (
                                <span
                                  title={b.title}
                                  style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'bottom' }}
                                >{b.title}</span>
                              ),
                            }))}
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
                    <ViewRenderer
                      ui={currentTab.ui}
                      onAction={handleAction}
                      onChange={handleFieldChange}
                      onGridChange={handleGridChange}
                      onEditRow={handleEditRow}
                    />
                  </>
                ) : (
                  currentTab.loading ? null : (
                    <HomePanel loginInfo={loginInfo} onBannerClick={handleBannerClick} />
                  )
                )}
              </div>
            </FormValuesContext.Provider>
            </SidContext.Provider>
          )}
        </Content>
      </Layout>

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
