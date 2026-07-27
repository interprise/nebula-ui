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

// SSO landing parameters. When CNAAuthenticator (or another custom Authenticator
// configured for the app) bounces the user to an external IdP — Sixtema's Piero
// via tkt, OIDC via code/state/scope, or Nebula FE via nebfe — the IdP
// redirects back to /entrasp/app/ with these query params. The SPA forwards
// them on the first JSONMenu POST so the server-side Authenticator can validate
// them and establish the session, then strips them from the URL bar.
const SSO_PARAM_NAMES = ['tkt', 'code', 'scope', 'state', 'nebfe', 'token'] as const;

const initialSsoParams: Record<string, string> = (() => {
  if (typeof window === 'undefined') return {};
  const search = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  let found = false;
  for (const k of SSO_PARAM_NAMES) {
    const v = search.get(k);
    if (v) { out[k] = v; found = true; }
  }
  if (found) {
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }
  return out;
})();

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

  const loadMenu = useCallback(async (extra: Record<string, string> = {}) => {
    try {
      const resp = await api.reloadMenu(extra);
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
    // The control plugin loads exactly once per page load, so anything that
    // skips this call leaves the app without the entrasp custom controls for
    // the rest of the session: ControlRenderer then falls back to a text input
    // and an object-valued control (ruoli, contatti, …) renders as
    // "[object Object]" with nothing in the console to explain it. Load it
    // outside the GetConfig promise chain so a failing/500 GetConfig — which
    // happens while the server is restarting — can no longer take the controls
    // down with it. `controlsPluginUrl` only ever overrides the default path,
    // so the default is a safe standalone fallback.
    const loadPlugin = (url: string) =>
      // Cache-bust the dynamically imported plugin bundle. It is imported once
      // at startup, so without this the browser pins the previously cached
      // module and a freshly deployed plugin (new controls/fixes) is never
      // picked up until a manual hard-refresh.
      loadControlPlugin(url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now(), hostApi);
    const configPromise = api.getConfig();
    const pluginLoaded = configPromise
      .then((resp) => (resp as Record<string, unknown>).controlsPluginUrl as string | undefined)
      .catch(() => undefined)
      .then((url) => loadPlugin(url || DEFAULT_CONTROLS_PLUGIN_URL));
    configPromise.then(async (resp) => {
      const raw = resp as Record<string, unknown>;
      if (raw.loginTitle) setLoginTitle(raw.loginTitle as string);
      await pluginLoaded;
      // If the server returned an SSO redirect URL and we're not in the
      // middle of consuming an SSO callback, bounce to the IdP directly.
      // When initialSsoParams is non-empty the IdP just sent us back —
      // those params must be validated via JSONMenu, not redirected away.
      if (raw.redirect && Object.keys(initialSsoParams).length === 0) {
        window.location.href = raw.redirect as string;
        return;
      }
      if (raw.loggedIn === true || raw.authenticatorName) {
        // Skip login form — already authenticated or SSO authenticator
        setShowLogin(false);
        loadMenu(initialSsoParams);
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
    let redirect: string | undefined;
    try {
      const resp = await api.logout();
      redirect = resp?.redirect;
    } catch {
      // ignore
    }
    setLoggedIn(false);
    setLoginInfo(null);
    setMenuItems([]);
    // For PIS (Piero) logout the server returns the OIDC end_session URL; navigating
    // there is what actually clears the OP session. Without this, the user stays
    // signed in at the IdP and the next page load silently re-authenticates.
    if (redirect) {
      window.location.href = redirect;
    }
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
