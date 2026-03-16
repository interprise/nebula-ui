import React, { useState, useCallback, useEffect } from 'react';
import { ConfigProvider, App as AntApp } from 'antd';
import itIT from 'antd/locale/it_IT';
import LoginForm from './components/LoginForm';
import Shell from './components/Shell';
import type { LoginInfo, MenuItem } from './types/ui';
import * as api from './services/api';

// Register application-specific custom controls
import { registerControl } from './controls/customControls';
import RuoliControl from './controls/custom/RuoliControl';
import WorkflowStatusControl from './controls/custom/WorkflowStatusControl';
registerControl('ruoli', RuoliControl);
registerControl('workflowStatus', WorkflowStatusControl);

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
    api.getConfig().then((resp) => {
      const raw = resp as Record<string, unknown>;
      if (raw.loginTitle) setLoginTitle(raw.loginTitle as string);
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
