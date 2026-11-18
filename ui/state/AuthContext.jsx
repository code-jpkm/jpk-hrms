import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, post, setToken, getToken } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));
  // The server could not be reached (network, restart, rate limit) while a
  // saved session exists. Shown as "try again", never as the sign-in page.
  const [unreachable, setUnreachable] = useState(false);

  async function fetchMe(attempt = 0) {
    try {
      return await api('/auth/me');
    } catch (error) {
      const rejected = error.status === 401 || error.status === 403;
      if (!rejected && attempt < 3 && getToken()) {
        await new Promise((resolve) => setTimeout(resolve, [1200, 3000, 6000][attempt]));
        return fetchMe(attempt + 1);
      }
      throw error;
    }
  }

  async function loadMe() {
    try {
      const data = await fetchMe();
      setUser(data.user);
      setEmployee(data.employee);
      setUnreachable(false);
      return data;
    } catch (error) {
      // Only a rejected session signs the person out. A network blip, a 5xx or
      // a rate limit keeps the session and offers "try again".
      if (error.status === 401 || error.status === 403) {
        setToken(null);
        setUser(null);
        setEmployee(null);
        setUnreachable(false);
      } else if (getToken()) {
        setUnreachable(true);
      }
      throw error;
    } finally {
      setLoading(false);
    }
  }

  async function retry() {
    setLoading(true);
    setUnreachable(false);
    try { await loadMe(); } catch { /* the screen explains what happened */ }
  }

  useEffect(() => {
    if (getToken()) loadMe().catch(() => {});
    else setLoading(false);
  }, []);

  useEffect(() => {
    function onUnauthorized() {
      setToken(null);
      setUser(null);
      setEmployee(null);
    }
    function onPasswordChangeRequired() {
      setUser((current) => (current ? { ...current, forcePasswordChange: true } : current));
    }
    window.addEventListener('hrms:password-change-required', onPasswordChangeRequired);
    // Another tab signed in or out: never keep showing one person's data with another's token.
    function onStorage(e) {
      if (e.key !== 'hrms_token') return;
      if (!e.newValue) onUnauthorized();
      else window.location.reload();
    }
    window.addEventListener('hrms:unauthorized', onUnauthorized);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('hrms:password-change-required', onPasswordChangeRequired);
      window.removeEventListener('hrms:unauthorized', onUnauthorized);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Email (or employee code) + password + the letters from the captcha picture.
  async function login({ identifier, password, captchaToken, captchaAnswer }) {
    const data = await post('/auth/login', { identifier, password, captchaToken, captchaAnswer }, { toast: false });
    setToken(data.token);
    setUser(data.user);
    await loadMe();
    return data;
  }

  async function changePassword(currentPassword, newPassword) {
    const data = await post('/auth/change-password', { currentPassword, newPassword }, { toast: false });
    // The server signs out older sessions; this one continues with a fresh token.
    if (data.token) setToken(data.token);
    if (data.user) setUser(data.user);
    return data;
  }

  function logout() {
    setUnreachable(false);
    setToken(null);
    setUser(null);
    setEmployee(null);
  }

  return (
    <AuthContext.Provider value={{ user, employee, loading, unreachable, retry, login, changePassword, logout, reload: loadMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
