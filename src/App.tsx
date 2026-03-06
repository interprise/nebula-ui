import React, { useState, useCallback } from 'react';
import { ConfigProvider, App as AntApp } from 'antd';
import itIT from 'antd/locale/it_IT';
import LoginForm from './components/LoginForm';
import Shell from './components/Shell';
import type { LoginInfo, MenuItem } from './types/ui';
import * as api from './services/api';

const App: React.FC = () => {
  const [loggedIn, setLoggedIn] = useState(false);
  const [loginError, setLoginError] = useState<string>();
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginInfo, setLoginInfo] = useState<LoginInfo | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);

  const handleLogin = useCallback(async (username: string, password: string) => {
    setLoginLoading(true);
    setLoginError(undefined);
    try {
      const resp = await api.login(username, password);
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

  return (
    <ConfigProvider locale={itIT}>
      <AntApp>
        {!loggedIn ? (
          <LoginForm onLogin={handleLogin} error={loginError} loading={loginLoading} />
        ) : (
          <Shell
            menuItems={menuItems}
            loginInfo={loginInfo!}
            onLogout={handleLogout}
          />
        )}
      </AntApp>
    </ConfigProvider>
  );
};

export default App;
