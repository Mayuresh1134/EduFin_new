import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth.jsx';
import { toast } from './fx.js';

// Load something when the page opens (and again when `deps` change).
export function useLoad(loader, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const run = ++latest.current;
    try {
      const result = await loader();
      if (run === latest.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (run === latest.current) setError(e.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, setData, error, reload };
}

// Run a change against the API: show failures as a toast and keep the header's coin count fresh.
export function useAction() {
  const { setUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (request, onDone) => {
    setBusy(true);
    try {
      const result = await request();
      if (result?.user) setUser(result.user);
      onDone?.(result);
      return result;
    } catch (e) {
      toast(e.message, 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }, [setUser]);
  return [run, busy];
}

export function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('edufin_theme', next); } catch { /* private mode */ }
      return next;
    });
  }, []);
  return [theme, toggle];
}

// While a modal animates closed its data is already null; keep the last real value on screen.
export function useLast(value) {
  const last = useRef(value);
  if (value !== null && value !== undefined) last.current = value;
  return last.current;
}
