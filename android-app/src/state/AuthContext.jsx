import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get, getToken, loadToken, onAuthEvent, post, setToken } from '../api/client';
import { loadServer } from '../config';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [booting, setBooting] = useState(true); // first start only (splash screen stays up)
  const [checking, setChecking] = useState(false); // slow first start or "Try again": waiting screen
  const [offline, setOffline] = useState(false);

  const loadMe = useCallback(async (opts) => {
    const data = await get('/auth/me', opts);
    setUser(data.user);
    setEmployee(data.employee || null);
    setOffline(false);
    return data;
  }, []);

  // A Render server that was asleep can take up to a minute to answer. The splash
  // stays for a few seconds at most; after that a "waking up" screen shows.
  const boot = useCallback(async ({ first = false } = {}) => {
    if (!first) setChecking(true);
    const slow = first ? setTimeout(() => { setChecking(true); setBooting(false); }, 6000) : null;
    try {
      if (first) await loadServer();
      const saved = first ? await loadToken() : getToken();
      if (saved) await loadMe({ timeout: 75000 });
      setOffline(false);
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        await setToken(null);
        setUser(null);
        setOffline(false);
      } else if (getToken()) {
        // Signed in before, server not reachable now: keep the session, offer a retry.
        setOffline(true);
      }
    } finally {
      clearTimeout(slow);
      setBooting(false);
      setChecking(false);
    }
  }, [loadMe]);

  useEffect(() => { boot({ first: true }); }, [boot]);

  useEffect(() => onAuthEvent(async (type) => {
    if (type === 'unauthorized') {
      await setToken(null);
      setUser(null);
      setEmployee(null);
    }
    if (type === 'password-change-required') {
      setUser((current) => (current ? { ...current, forcePasswordChange: true } : current));
    }
  }), []);

  const login = useCallback(async ({ identifier, password, captchaToken, captchaAnswer }) => {
    const data = await post('/auth/login', { identifier, password, captchaToken, captchaAnswer });
    await setToken(data.token);
    setUser(data.user);
    await loadMe().catch(() => {});
    return data;
  }, [loadMe]);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const data = await post('/auth/change-password', { currentPassword, newPassword });
    if (data.token) await setToken(data.token);
    if (data.user) setUser(data.user);
    await loadMe().catch(() => {});
    return data;
  }, [loadMe]);

  const logout = useCallback(async () => {
    await setToken(null);
    setUser(null);
    setEmployee(null);
    setOffline(false);
  }, []);

  const retry = useCallback(() => boot(), [boot]);
  const reload = useCallback(() => loadMe(), [loadMe]);
  const value = useMemo(() => ({
    user, employee, booting, checking, offline, login, logout, changePassword, reload, retry
  }), [user, employee, booting, checking, offline, login, logout, changePassword, reload, retry]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
