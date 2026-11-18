import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, put } from '../api/client.js';
import { defaultWidgets } from '../components/dashboard/widgetTypes.js';

// Layout persistence: server-first (GET/PUT /dashboard/layout, per user),
// with localStorage as an offline/dev fallback so the dashboard still works
// when the backend is unreachable. Saves are debounced to one PUT per burst.
function keyFor(user) {
  return `hrms_dashboard_${user?.id || user?._id || user?.email || 'guest'}`;
}

export function useDashboard(user, summary) {
  const storageKey = useMemo(() => keyFor(user), [user]);
  const [widgets, setWidgets] = useState(null);
  const serverOk = useRef(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const localLoad = () => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) return JSON.parse(raw)?.widgets || null;
      } catch { /* corrupt store */ }
      return null;
    };
    (async () => {
      let initial = null;
      try {
        const res = await api('/dashboard/layout');
        serverOk.current = true;
        if (Array.isArray(res?.widgets) && res.widgets.length) initial = res.widgets;
      } catch {
        serverOk.current = false;
      }
      if (!initial) initial = localLoad();
      if (!cancelled) setWidgets(Array.isArray(initial) && initial.length ? initial : defaultWidgets());
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const persist = useCallback((next) => {
    setWidgets(next);
    try { localStorage.setItem(storageKey, JSON.stringify({ widgets: next, updatedAt: Date.now() })); } catch { /* quota */ }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      put('/dashboard/layout', { widgets: next })
        .then(() => { serverOk.current = true; })
        .catch(() => { /* offline or no permission: local copy already saved */ });
    }, 600);
  }, [storageKey]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const add = useCallback((w) => persist([...(widgets || []), w]), [widgets, persist]);
  const remove = useCallback((id) => persist((widgets || []).filter((w) => w.id !== id)), [widgets, persist]);
  const update = useCallback((id, patch) => persist((widgets || []).map((w) => (w.id === id ? { ...w, ...patch, config: { ...w.config, ...(patch.config || {}) } } : w))), [widgets, persist]);

  const move = useCallback((fromId, toId) => {
    if (fromId === toId) return;
    const list = [...(widgets || [])];
    const from = list.findIndex((w) => w.id === fromId);
    const to = list.findIndex((w) => w.id === toId);
    if (from < 0 || to < 0) return;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    persist(list);
  }, [widgets, persist]);

  const reset = useCallback(() => persist(defaultWidgets()), [persist]);

  return { widgets: widgets || [], loading: widgets === null, add, remove, update, move, reset };
}
