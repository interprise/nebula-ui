import React, { useState, useCallback, useRef, useMemo } from 'react';
import { Layout, Menu, Tabs, Breadcrumb, Badge, Dropdown, Space, Typography, Modal, Input, Button, Tooltip, Select, Spin, message, ConfigProvider } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  LogoutOutlined,
  UserOutlined,
  HomeOutlined,
  SearchOutlined,
  LockOutlined,
  MailOutlined,
  CalendarOutlined,
  PrinterOutlined,
  QuestionCircleOutlined,
  PictureOutlined,
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
  ToolbarItem,
  UIData,
  ErrorItem,
  ServerResponse,
} from '../types/ui';
import Toolbar from './Toolbar';
import ViewRenderer, { SidContext } from './ViewRenderer';
import * as api from '../services/api';

const { Header, Content } = Layout;
const { Text } = Typography;

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
}

interface ShellProps {
  menuItems: MenuItem[];
  loginInfo: LoginInfo;
  onLogout: () => void;
  onReloadMenu: () => void;
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

function buildMenuItems(items: MenuItem[]): NonNullable<React.ComponentProps<typeof Menu>['items']> {
  return items.map((item) => ({
    key: item.id,
    label: item.description,
    title: item.description,
    children: item.children && item.children.length > 0 ? buildMenuItems(item.children) : undefined,
  }));
}

let tabCounter = 1;

const defaultTab: TabState = {
  key: 'tab_1',
  label: 'Sessione 1',
  sid: 'S1',
  formValues: {},
};

const Shell: React.FC<ShellProps> = ({ menuItems, loginInfo, onLogout, onReloadMenu }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [tabs, setTabs] = useState<TabState[]>([defaultTab]);
  const [activeTab, setActiveTab] = useState<string>('tab_1');
  const [menuFilter, setMenuFilter] = useState('');
  const formValuesRef = useRef<Record<string, Record<string, string | string[]>>>({ tab_1: defaultTab.formValues });

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

  const handleErrors = useCallback((errors: ErrorItem[]) => {
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
              const tab = getActiveTabState();
              if (tab && err.mnemonic) {
                api.postAction('Post', {
                  messages: `${err.mnemonic},Y`,
                }, tab.formValues, tab.sid);
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
    (tabKey: string, resp: ServerResponse) => {
      const r = resp as Record<string, unknown>;
      if (r.notLoggedIn) {
        message.error('Sessione scaduta. Effettuare nuovamente il login.');
        return;
      }
      if (r.noSession) {
        message.error('Sessione non valida. Riprovare.');
        return;
      }
      if (resp.errors && resp.errors.length > 0) {
        handleErrors(resp.errors);
      }
      if (resp.redirect) {
        window.location.href = resp.redirect;
        return;
      }
      const update: Partial<TabState> = {};
      if (resp.ui) {
        if (resp.ui.rowUpdate) {
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
      if (resp.toolbar) update.toolbar = resp.toolbar;
      if (resp.uiData) {
        update.uiData = resp.uiData;
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
    },
    [handleErrors, updateTabState, extractFormValues]
  );

  processResponseInnerRef.current = processResponseInner;

  const processResponse = useCallback(
    (tabKey: string, resp: ServerResponse, sid?: string) => {
      // Server says "poll me for progress" — show spinner and start polling
      if ((resp.uiData?.showProgress || resp.uiData?.trackAsynchJob || resp.trackAsynchJob) && !resp.ui) {
        const tabSid = sid || tabs.find((t) => t.key === tabKey)?.sid || 'S1';
        updateTabState(tabKey, { loading: true, progressPct: undefined });
        pollProgress(tabKey, tabSid);
        return;
      }
      processResponseInner(tabKey, resp);
    },
    [processResponseInner, pollProgress, tabs, updateTabState]
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
      updateTabState(tab.key, { label: menuLabel, ui: undefined, toolbar: undefined, uiData: undefined, currField: undefined, formValues: tab.formValues });

      document.body.style.cursor = 'wait';
      try {
        const resp = await api.executeMenuItem(menuId, tab.sid);
        processResponse(tab.key, resp);
      } catch (e) {
        updateTabState(tab.key, { loading: false, progressPct: undefined });
        message.error(`Error: ${e}`);
      } finally {
        document.body.style.cursor = '';
      }
    },
    [getActiveTabState, processResponse, updateTabState]
  );

  const handleAction = useCallback(
    async (action: string, params: Record<string, string> = {}) => {
      const tab = getActiveTabState();
      if (!tab) return;

      if (tab.loading) return; // Block while a request is pending

      const noFormValues = params._noFormValues === 'true';
      const serverParams = { ...params };
      delete serverParams._noFormValues;

      // For listEdit: include the editing row's navpath so the server positions correctly
      if (editNavpathRef.current && !serverParams.navpath) {
        serverParams.navpath = editNavpathRef.current;
      }

      document.body.style.cursor = 'wait';
      try {
        const fv = noFormValues ? undefined : formValuesRef.current[tab.key];
        const resp = await api.postAction(action, serverParams, fv, tab.sid);
        processResponse(tab.key, resp);
      } catch (e) {
        updateTabState(tab.key, { loading: false, progressPct: undefined });
        message.error(`Error: ${e}`);
      } finally {
        document.body.style.cursor = '';
      }
    },
    [getActiveTabState, processResponse, updateTabState, handleErrors]
  );

  const handleFieldChange = useCallback(
    (name: string, value: unknown) => {
      const tab = getActiveTabState();
      if (!tab) return;
      const strValue = value == null ? '' : String(value);
      tab.formValues[name] = strValue;
      formValuesRef.current[tab.key] = tab.formValues;
    },
    [getActiveTabState]
  );

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
    const items: { title: string; action?: string; navpath?: string; option1?: string }[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${breadcrumbs}</div>`, 'text/html');
    doc.querySelectorAll('.breadcrumbElement, [onclick]').forEach((el) => {
      const title = (el.getAttribute('title') || el.textContent || '').replace(/^<<\s*/, '');
      const onclick = el.getAttribute('onclick') || '';
      const m = onclick.match(/doAction[23]?\(\s*'([^']+)'(?:\s*,\s*'([^']*)')?(?:\s*,\s*'([^']*)')?\s*\)/);
      if (title) {
        items.push({
          title,
          action: m?.[1],
          navpath: m?.[2],
          option1: m?.[3],
        });
      }
    });
    return items;
  }, [breadcrumbs]);

  const APPBAR_WIDTH = 48;
  const siderWidth = collapsed ? 80 : 260;

  const appBarButtons: {
    key: string;
    icon: React.ReactNode;
    tooltip: string;
    onClick: () => void;
    visible: boolean;
    badge?: boolean;
    danger?: boolean;
  }[] = [
    { key: 'logout', icon: <LogoutOutlined />, tooltip: 'Logout', onClick: onLogout, visible: true, danger: true },
    { key: 'changePwd', icon: <LockOutlined />, tooltip: 'Cambio Password', onClick: () => api.postAction2('ChangePassword2'), visible: true },
    { key: 'email', icon: <MailOutlined />, tooltip: 'Posta Elettronica', onClick: () => api.postAction2('ShowEmail'), visible: !!loginInfo.emailSent },
    { key: 'agenda', icon: <CalendarOutlined />, tooltip: 'Agenda', onClick: () => api.postAction2('ViewAgenda'), visible: !!loginInfo.agendaList },
    { key: 'areaDoc', icon: <PrinterOutlined />, tooltip: 'Area Documenti', onClick: () => api.postAction2('ShowDocArea'), visible: !!loginInfo.areaDocumenti },
    // newSession moved to tab bar add button
    { key: 'help', icon: <QuestionCircleOutlined />, tooltip: 'Aiuto', onClick: () => {}, visible: !!loginInfo.assistenza },
    { key: 'cdms', icon: <PictureOutlined />, tooltip: 'Documentale', onClick: () => api.postAction2('CdmsEdit'), visible: !!loginInfo.cdms },
    { key: 'avvisi', icon: <BellOutlined />, tooltip: 'Avvisi', onClick: () => api.postAction2('ShowAvvisi'), visible: !!loginInfo.avvisi },
    { key: 'notifier', icon: <BulbOutlined />, tooltip: 'Notifiche', onClick: () => api.postAction2('ShowNotifiche'), visible: !!loginInfo.notifications, badge: true },
    { key: 'banners', icon: <NotificationOutlined />, tooltip: 'Banner', onClick: () => api.postAction2('Ping'), visible: true },
    { key: 'profmanager', icon: <TeamOutlined />, tooltip: 'Gestione Profili', onClick: () => api.postAction2('ShowProfileManager'), visible: true },
    { key: 'stats', icon: <ClockCircleOutlined />, tooltip: 'Comandi in esecuzione', onClick: () => api.postAction2('CommStats'), visible: true },
    { key: 'jdbc', icon: <DatabaseOutlined />, tooltip: 'Connessioni attive', onClick: () => api.postAction2('JdbcStats'), visible: true },
    { key: 'expb', icon: <BuildOutlined />, tooltip: 'Costruttore Espressioni', onClick: () => api.postAction2('ExpBuilder'), visible: true },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Vertical app bar */}
      <div className="app-bar">
        {appBarButtons
          .filter((b) => b.visible)
          .map((b) => (
            <Tooltip key={b.key} title={b.tooltip} placement="right">
              <Badge dot={b.badge} size="small" offset={[-4, 4]}>
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
        <div style={{ padding: '12px', textAlign: 'center' }}>
          <img src="/entrasp/images/logos/LogoSixtema.jpg" alt="Sixtema" style={{ maxWidth: '100%', maxHeight: 40, objectFit: 'contain' }} />
        </div>
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
        <ConfigProvider theme={{ components: { Menu: { itemHeight: 28, itemColor: 'rgba(0,0,0,0.88)', itemHoverColor: '#1677ff', subMenuItemBg: '#fff', itemBg: '#fff', itemSelectedColor: '#1677ff', itemSelectedBg: '#e6f4ff', itemMarginBlock: 0, itemMarginInline: 0, iconMarginInlineEnd: 8 } } }}>
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
        <div style={{ textAlign: 'center', padding: 8 }}>
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
          />
        </div>
      </div>

      {/* Main content */}
      <Layout style={{ marginLeft: APPBAR_WIDTH + siderWidth, transition: 'margin-left 0.2s', minWidth: 0, maxWidth: `calc(100vw - ${APPBAR_WIDTH + siderWidth}px)`, height: '100vh', overflow: 'hidden' }}>
        <Header
          style={{
            padding: '0 16px',
            background: loginInfo.bkColor || '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 'auto',
            minHeight: 48,
            lineHeight: 'normal',
          }}
        >
          <Space>
            <img src="/entrasp/images/logos/logo_sx.png" alt="Sixtema" style={{ height: 36, objectFit: 'contain' }} />
          </Space>
          <Space size="middle" wrap>
            <Text style={{ color: '#fff' }}>Utente: <Text strong style={{ color: '#fff' }}>{loginInfo.login}</Text></Text>
            <Text style={{ color: '#fff' }}>Profilo: <Text strong style={{ color: '#fff' }}>{loginInfo.profile}</Text></Text>
            {loginInfo.aziende && loginInfo.aziende.length === 1 && (
              <Text style={{ color: '#fff' }}>Azienda: <Text strong style={{ color: '#fff' }}>{loginInfo.aziende[0].text}</Text></Text>
            )}
            {loginInfo.aziende && loginInfo.aziende.length > 1 && (
              <Space size={4}>
                <Text style={{ color: '#fff' }}>Azienda:</Text>
                <Select
                  value={loginInfo.customerKey}
                  onChange={handleAziendaChange}
                  style={{ width: 320 }}
                  options={loginInfo.aziende}
                  fieldNames={{ label: 'text', value: 'value' }}
                />
              </Space>
            )}
            {loginInfo.sedi && loginInfo.sedi.length === 1 && (
              <Text style={{ color: '#fff' }}>Sede: <Text strong style={{ color: '#fff' }}>{loginInfo.sedi[0].text}</Text></Text>
            )}
            {loginInfo.sedi && loginInfo.sedi.length > 1 && (
              <Space size={4}>
                <Text style={{ color: '#fff' }}>Sede:</Text>
                <Select
                  value={loginInfo.sede}
                  onChange={handleSedeChange}
                  style={{ width: 320 }}
                  options={loginInfo.sedi}
                  fieldNames={{ label: 'text', value: 'value' }}
                />
              </Space>
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
              <Space style={{ cursor: 'pointer', color: '#fff' }}>
                <Badge dot={!!loginInfo.notifications}>
                  <UserOutlined style={{ fontSize: 18, color: '#fff' }} />
                </Badge>
              </Space>
            </Dropdown>
          </Space>
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
                    {parsedBreadcrumbs.length > 0 && (
                      <Breadcrumb
                        style={{ padding: '6px 8px', maxWidth: '100%' }}
                        items={parsedBreadcrumbs.map((b) => ({
                          title: b.action ? (
                            <a
                              title={b.title}
                              style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'bottom' }}
                              onClick={() => {
                                const params: Record<string, string> = {};
                                if (b.navpath) params.navpath = b.navpath;
                                if (b.option1) params.option1 = b.option1;
                                handleAction(b.action!, Object.keys(params).length > 0 ? params : undefined);
                              }}
                            >{b.title}</a>
                          ) : (
                            <span
                              title={b.title}
                              style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'bottom' }}
                            >{b.title}</span>
                          ),
                        }))}
                      />
                    )}
                    <Toolbar items={currentTab.toolbar || []} paging={currentTab.ui?.paging} onAction={handleAction} />
                    <ViewRenderer
                      ui={currentTab.ui}
                      onAction={handleAction}
                      onChange={handleFieldChange}
                      onGridChange={handleGridChange}
                      onEditRow={handleEditRow}
                    />
                  </>
                ) : (
                  <div style={{ textAlign: 'center', padding: 80, color: '#999' }}>
                    {currentTab.loading ? null : (
                      <>
                        <HomeOutlined style={{ fontSize: 48 }} />
                        <div style={{ marginTop: 16 }}>Seleziona una voce dal menu</div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </SidContext.Provider>
          )}
        </Content>
      </Layout>
    </div>
  );
};

export default Shell;
