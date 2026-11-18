import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { endLoading, startLoading } from '../state/loadingStore.js';

let requestSerial = 0;

/**
 * GET helper with loading/error state.
 *
 * v26 fixes: (1) refetches whenever `path` changes, even if the caller passed
 * no deps — pages built the path from filters but passed [] and showed stale
 * data; (2) ignores responses that arrive after a newer request, so switching
 * quickly between employees can no longer show A's calendar under B's name.
 */
export function useApi(path, deps = [], options = {}) {
  const { skeleton = true, keepPreviousData = true } = options;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(path));
  const mounted = useRef(true);
  const latest = useRef(0);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    if (!path) {
      if (mounted.current) { setData(null); setError(null); setLoading(false); }
      return null;
    }
    const requestId = `useApi-${++requestSerial}`;
    if (mounted.current) {
      setLoading(true);
      setError(null);
      if (!keepPreviousData) setData(null);
    }
    if (skeleton) startLoading(requestId);
    try {
      const json = await api(path, { toast: false });
      if (mounted.current && ticket === latest.current) setData(json);
      return json;
    } catch (err) {
      if (mounted.current && ticket === latest.current) setError(err);
      throw err;
    } finally {
      if (mounted.current && ticket === latest.current) setLoading(false);
      if (skeleton) endLoading(requestId);
    }
  }, [path, skeleton, keepPreviousData]);

  useEffect(() => {
    load().catch(() => {});
  }, [path, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error, loading, reload: load, setData };
}
