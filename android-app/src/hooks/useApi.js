import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { get } from '../api/client';

/**
 * GET a path: { data, error, loading, refreshing, refresh, reload, setData }.
 * Reloads quietly when the screen comes back into view.
 */
export function useApi(path, { enabled = true, focus = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(path && enabled));
  const [refreshing, setRefreshing] = useState(false);
  const first = useRef(true);

  const load = useCallback(async (mode = 'quiet') => {
    if (!path || !enabled) { setLoading(false); return null; }
    if (mode === 'refresh') setRefreshing(true);
    try {
      const result = await get(path);
      setData(result);
      setError(null);
      return result;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [path, enabled]);

  useEffect(() => {
    setLoading(Boolean(path && enabled));
    load();
  }, [load, path, enabled]);

  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    if (focus) load();
  }, [load, focus]));

  return { data, error, loading, refreshing, refresh: () => load('refresh'), reload: () => load(), setData };
}
