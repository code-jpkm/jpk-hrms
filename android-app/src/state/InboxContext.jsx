import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { get, post } from '../api/client';
import { useAuth } from './AuthContext';

const InboxContext = createContext({ items: [], unread: 0, reload: () => {}, markRead: () => {}, markAllRead: () => {} });

/** In-app notifications (the website's bell). Checks every minute while the app is open. */
export function InboxProvider({ children }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const active = useRef(true);

  const reload = useCallback(async () => {
    if (!user || user.forcePasswordChange) return;
    setLoading(true);
    try {
      const data = await get('/notifications/inbox');
      setItems(data.notifications || []);
      setUnread(data.unreadCount || 0);
    } catch { /* keep what we have */ } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) { setItems([]); setUnread(0); return undefined; }
    reload();
    const id = setInterval(() => { if (active.current) reload(); }, 60000);
    const sub = AppState.addEventListener('change', (s) => { active.current = s === 'active'; if (active.current) reload(); });
    return () => { clearInterval(id); sub.remove(); };
  }, [user, reload]);

  const markRead = useCallback(async (id) => {
    setItems((list) => list.map((n) => (n._id === id ? { ...n, readAt: n.readAt || new Date().toISOString() } : n)));
    setUnread((n) => Math.max(0, n - 1));
    await post(`/notifications/inbox/${id}/read`).catch(() => {});
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((list) => list.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
    setUnread(0);
    await post('/notifications/inbox/read-all').catch(() => {});
  }, []);

  const value = useMemo(() => ({ items, unread, loading, reload, markRead, markAllRead }), [items, unread, loading, reload, markRead, markAllRead]);
  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

export function useInbox() {
  return useContext(InboxContext);
}
