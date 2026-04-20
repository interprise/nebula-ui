import * as React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { ConfigProvider, App as AntApp } from 'antd';
import * as Antd from 'antd';
import * as AntdIcons from '@ant-design/icons';
import * as AgGrid from 'ag-grid-community';
import * as AgGridReact from 'ag-grid-react';
import itIT from 'antd/locale/it_IT';
import LoginForm from './components/LoginForm';
import Shell from './components/Shell';
import type { LoginInfo, MenuItem } from './types/ui';
import * as api from './services/api';

// Register CORE framework controls synchronously. The application-specific
// plugin is loaded dynamically after GetConfig from the URL the server
// provides, so another app on the framework can ship its own plugin bundle
// without touching entrasp-ui source.
import { registerBuiltinControls } from './controls/builtins';
import { registerControl, registerControls, registerCellRenderable } from './controls/registry';
import { loadControlPlugin } from './controls/loadPlugin';
import type { HostAPI } from './controls/hostApi';
registerBuiltinControls();

const DEFAULT_CONTROLS_PLUGIN_URL = '/entrasp/app-plugins/entrasp-controls.js';

const hostApi: HostAPI = {
  React,
  antd: Antd,
  icons: AntdIcons,
  agGrid: AgGrid,
  agGridReact: AgGridReact,
  registry: { registerControl, registerControls, registerCellRenderable },
};

const App: React.FC = () => {
  const [loggedIn, setLoggedIn] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [showLogin, setShowLogin] = useState(true);
  const [loginError, setLoginError] = useState<string>();
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginTitle, setLoginTitle] = useState<string>();
  const [loginInfo, setLoginInfo] = useState<LoginInfo | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);

  const loadMenu = useCallback(async () => {
    try {
      const resp = await api.reloadMenu();
      if (resp.redirect) {
        window.location.href = resp.redirect;
        return;
      }
      if (resp.loginfo) setLoginInfo(resp.loginfo);
      if (resp.children) setMenuItems(resp.children);
      setLoggedIn(true);
    } catch (e) {
      // Auto-login failed, show login form
      setShowLogin(true);
    }
  }, []);

  useEffect(() => {
    api.getConfig().then(async (resp) => {
      const raw = resp as Record<string, unknown>;
      if (raw.loginTitle) setLoginTitle(raw.loginTitle as string);
      const pluginUrl = (raw.controlsPluginUrl as string | undefined) || DEFAULT_CONTROLS_PLUGIN_URL;
      await loadControlPlugin(pluginUrl, hostApi);
      if (raw.loggedIn === true || raw.authenticatorName) {
        // Skip login form — already authenticated or SSO authenticator
        setShowLogin(false);
        loadMenu();
      } else {
        setShowLogin(true);
      }
      setConfigLoaded(true);
    }).catch(() => {
      setShowLogin(true);
      setConfigLoaded(true);
    });
  }, [loadMenu]);

  const handleLogin = useCallback(async (username: string, password: string) => {
    setLoginLoading(true);
    setLoginError(undefined);
    try {
      const resp = await api.login(username, password);
      if (resp.redirect) {
        window.location.href = resp.redirect;
        return;
      }
      if ((resp as Record<string, unknown>).notLoggedIn) {
        setLoginError((resp as Record<string, unknown>).msg as string || 'Login fallita. Verificare username e password.');
        return;
      }
      if (resp.errors && resp.errors.length > 0) {
        setLoginError(resp.errors.map((e) => e.message).join('\n'));
        return;
      }
      if (resp.loginfo) {
        setLoginInfo(resp.loginfo);
      }
      if (resp.children) {
        setMenuItems(resp.children);
      }
      setLoggedIn(true);
    } catch (e) {
      setLoginError(`Errore di connessione: ${e}`);
    } finally {
      setLoginLoading(false);
    }
  }, []);

  const handleReloadMenu = useCallback(async () => {
    try {
      const resp = await api.reloadMenu();
      if (resp.loginfo) setLoginInfo(resp.loginfo);
      if (resp.children) setMenuItems(resp.children);
    } catch (e) {
      console.error('Menu reload failed:', e);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setLoggedIn(false);
    setLoginInfo(null);
    setMenuItems([]);
  }, []);

  // Poll the server every 150s for banner updates via the Ping command
  useEffect(() => {
    if (!loggedIn) return;
    const interval = setInterval(async () => {
      try {
        const resp = await api.postAction2('Ping');
        const banners = (resp as unknown as { banners?: unknown[] }).banners;
        if (banners !== undefined) {
          setLoginInfo((prev) => prev ? { ...prev, banners: banners as LoginInfo['banners'] } : prev);
        }
      } catch {
        // ignore — next tick will retry
      }
    }, 150000);
    return () => clearInterval(interval);
  }, [loggedIn]);

  // Freshworks Widget: load only when assistenza is enabled, after login
  useEffect(() => {
    if (!loginInfo?.assistenza) return;
    // Init stub (queues calls until script loads)
    const win = window as unknown as Record<string, unknown>;
    if (typeof win.FreshworksWidget !== 'function') {
      win.fwSettings = { widget_id: 77000003077 };
      const n = function(...args: unknown[]) { (n as unknown as { q: unknown[][] }).q.push(args); };
      (n as unknown as { q: unknown[][] }).q = [];
      win.FreshworksWidget = n;
    }
    // Load script
    if (!document.getElementById('freshworks-script')) {
      const s = document.createElement('script');
      s.id = 'freshworks-script';
      s.src = 'https://euc-widget.freshworks.com/widgets/77000003077.js';
      s.async = true;
      document.body.appendChild(s);
    }
    const fw = win.FreshworksWidget as (...args: unknown[]) => void;
    // Hide default launcher — we use our own app bar button
    fw('hide', 'launcher');
    // Pre-fill ticket form with user info
    const info = loginInfo as unknown as Record<string, unknown>;
    fw('identify', 'ticketForm', {
      name: loginInfo.login,
      email: info.email || '',
      custom_fields: {
        cf_categoria: info.brand || '',
        cf_sottocategoria: '',
      },
    });
  }, [loginInfo]);

  if (!configLoaded) {
    return null; // Wait for GetConfig before rendering anything
  }

  return (
    <ConfigProvider locale={itIT} theme={{ token: { fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" } }}>
      <AntApp>
        {!loggedIn ? (
          showLogin ? (
            <LoginForm onLogin={handleLogin} error={loginError} loading={loginLoading} title={loginTitle} />
          ) : null /* Auto-login in progress */
        ) : (
          <Shell
            menuItems={menuItems}
            loginInfo={loginInfo!}
            onLogout={handleLogout}
            onReloadMenu={handleReloadMenu}
          />
        )}
      </AntApp>
    </ConfigProvider>
  );
};

export default App;
