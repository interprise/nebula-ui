import React, { useState, useCallback, useRef } from 'react';
import { Layout, Menu, Tabs, Breadcrumb, Badge, Dropdown, Space, Typography, Modal, Input, Button, Tooltip, message } from 'antd';
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
  PlusSquareOutlined,
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
  ToolbarItem,
  UIData,
  ErrorItem,
  ServerResponse,
} from '../types/ui';
import Toolbar from './Toolbar';
import ViewRenderer from './ViewRenderer';
import * as api from '../services/api';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

interface TabState {
  key: string;
  label: string;
  sid: string;
  ui?: UITree;
  toolbar?: ToolbarItem[];
  uiData?: UIData;
  currField?: string;
  formValues: Record<string, string>;
}

interface ShellProps {
  menuItems: MenuItem[];
  loginInfo: LoginInfo;
  onLogout: () => void;
}

function filterMenuTree(items: MenuItem[], filter: string): MenuItem[] {
  const lowerFilter = filter.toLowerCase();
  const result: MenuItem[] = [];
  for (const item of items) {
    const textMatches = item.text.toLowerCase().includes(lowerFilter);
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
    label: item.text,
    children: item.children && item.children.length > 0 ? buildMenuItems(item.children) : undefined,
  }));
}

let tabCounter = 0;

const Shell: React.FC<ShellProps> = ({ menuItems, loginInfo, onLogout }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [menuFilter, setMenuFilter] = useState('');
  const formValuesRef = useRef<Record<string, Record<string, string>>>({});

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

  const processResponse = useCallback(
    (tabKey: string, resp: ServerResponse) => {
      if (resp.errors && resp.errors.length > 0) {
        handleErrors(resp.errors);
      }
      if (resp.redirect) {
        window.location.href = resp.redirect;
        return;
      }
      const update: Partial<TabState> = {};
      if (resp.ui) update.ui = resp.ui;
      if (resp.toolbar) update.toolbar = resp.toolbar;
      if (resp.uiData) update.uiData = resp.uiData;
      if (resp.currField) update.currField = resp.currField;
      if (Object.keys(update).length > 0) {
        updateTabState(tabKey, update);
      }
    },
    [handleErrors, updateTabState]
  );

  const handleMenuClick = useCallback(
    async (menuId: string, menuLabel: string) => {
      const sid = `S${++tabCounter}`;
      const newTab: TabState = {
        key: `tab_${tabCounter}`,
        label: menuLabel,
        sid,
        formValues: {},
      };
      formValuesRef.current[newTab.key] = newTab.formValues;

      setTabs((prev) => [...prev, newTab]);
      setActiveTab(newTab.key);

      try {
        const resp = await api.executeMenuItem(menuId, sid);
        processResponse(newTab.key, resp);
      } catch (e) {
        message.error(`Error: ${e}`);
      }
    },
    [processResponse]
  );

  const handleAction = useCallback(
    async (action: string, params: Record<string, string> = {}) => {
      const tab = getActiveTabState();
      if (!tab) return;

      try {
        const resp = await api.postAction(action, params, tab.formValues, tab.sid);
        processResponse(tab.key, resp);
      } catch (e) {
        message.error(`Error: ${e}`);
      }
    },
    [getActiveTabState, processResponse]
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

  const handleTabChange = (key: string) => setActiveTab(key);

  const handleTabEdit = (
    targetKey: React.MouseEvent | React.KeyboardEvent | string,
    action: 'add' | 'remove'
  ) => {
    if (action === 'remove') {
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

  const findMenuLabel = (items: MenuItem[], id: string): string => {
    for (const item of items) {
      if (item.id === id) return item.text;
      if (item.children) {
        const found = findMenuLabel(item.children, id);
        if (found) return found;
      }
    }
    return id;
  };

  const currentTab = getActiveTabState();
  const breadcrumbs = currentTab?.ui?.breadcrumbs;

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
    { key: 'newSession', icon: <PlusSquareOutlined />, tooltip: 'Nuova Sessione', onClick: () => { tabCounter++; setTabs(prev => [...prev, { key: `tab_${tabCounter}`, label: `Sessione ${tabCounter}`, sid: `S${tabCounter}`, formValues: {} }]); setActiveTab(`tab_${tabCounter}`); }, visible: true },
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
              <Button
                type="text"
                danger={b.danger}
                icon={
                  b.badge ? (
                    <Badge dot size="small">{b.icon}</Badge>
                  ) : (
                    b.icon
                  )
                }
                onClick={b.onClick}
                className="app-bar-btn"
              />
            </Tooltip>
          ))}
      </div>

      {/* Sidebar with menu */}
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={260}
        style={{
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: APPBAR_WIDTH,
          top: 0,
          bottom: 0,
        }}
      >
        <div style={{ padding: '16px', textAlign: 'center', color: '#fff' }}>
          {loginInfo.logoaz?.[0] ? (
            <img src={loginInfo.logoaz[0]} alt="Logo" style={{ maxWidth: '100%', maxHeight: 40 }} />
          ) : (
            <Text strong style={{ color: '#fff', fontSize: 16 }}>
              {loginInfo.title || 'NebulaERP'}
            </Text>
          )}
        </div>
        {!collapsed && (
          <div style={{ padding: '0 12px 8px' }}>
            <Input
              placeholder="Cerca nel menu..."
              prefix={<SearchOutlined style={{ color: 'rgba(255,255,255,0.45)' }} />}
              allowClear
              value={menuFilter}
              onChange={(e) => setMenuFilter(e.target.value)}
              style={{ background: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.2)', color: '#fff' }}
              styles={{ input: { color: '#fff' } }}
            />
          </div>
        )}
        <Menu
          theme="dark"
          mode="inline"
          items={buildMenuItems(filteredMenu)}
          {...(menuOpenKeys !== undefined ? { openKeys: menuOpenKeys } : {})}
          onClick={({ key }) => {
            const label = findMenuLabel(menuItems, key);
            handleMenuClick(key, label);
          }}
        />
      </Sider>

      {/* Main content */}
      <Layout style={{ marginLeft: APPBAR_WIDTH + siderWidth, transition: 'margin-left 0.2s' }}>
        <Header
          style={{
            padding: '0 16px',
            background: loginInfo.bkColor || '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Space>
            {React.createElement(collapsed ? MenuUnfoldOutlined : MenuFoldOutlined, {
              onClick: () => setCollapsed(!collapsed),
              style: { fontSize: 18, cursor: 'pointer' },
            })}
            {breadcrumbs && (
              <Breadcrumb
                items={breadcrumbs
                  .split('>')
                  .map((s: string) => s.trim())
                  .filter(Boolean)
                  .map((b: string) => ({ title: b }))}
              />
            )}
          </Space>
          <Dropdown
            menu={{
              items: [
                { key: 'user', label: `${loginInfo.login} (${loginInfo.profile})`, icon: <UserOutlined />, disabled: true },
                ...(loginInfo.aziende && loginInfo.aziende.length > 1
                  ? [{ key: 'company', label: `Azienda: ${loginInfo.customerKey}` }]
                  : []),
                { type: 'divider' as const, key: 'div' },
                { key: 'logout', label: 'Esci', icon: <LogoutOutlined />, danger: true },
              ],
              onClick: ({ key }) => {
                if (key === 'logout') onLogout();
              },
            }}
          >
            <Space style={{ cursor: 'pointer' }}>
              <Badge dot={!!loginInfo.notifications}>
                <UserOutlined style={{ fontSize: 18 }} />
              </Badge>
              <Text>{loginInfo.login}</Text>
            </Space>
          </Dropdown>
        </Header>

        <Content style={{ margin: '8px 16px', overflow: 'auto' }}>
          {tabs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 80, color: '#999' }}>
              <HomeOutlined style={{ fontSize: 48 }} />
              <div style={{ marginTop: 16 }}>Seleziona una voce dal menu</div>
            </div>
          ) : (
            <>
              <Tabs
                type="editable-card"
                hideAdd
                activeKey={activeTab}
                onChange={handleTabChange}
                onEdit={handleTabEdit}
                items={tabs.map((t) => ({
                  key: t.key,
                  label: t.label,
                }))}
              />
              {currentTab && (
                <div className="tab-content">
                  <Toolbar items={currentTab.toolbar || []} onAction={handleAction} />
                  {currentTab.ui && (
                    <ViewRenderer
                      ui={currentTab.ui}
                      onAction={handleAction}
                      onChange={handleFieldChange}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </Content>
      </Layout>
    </div>
  );
};

export default Shell;
