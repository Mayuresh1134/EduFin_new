import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, tokenStore } from './api.js';
import { coinsEarned } from './fx.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(null);
  const [ready, setReady] = useState(false);
  const lastCoins = useRef(null);

  // Every API reply that includes the user passes through here, so the header's coin
  // count is always current, and any increase sets off the flying-coins effect.
  const setUser = useCallback((next) => {
    if (next && lastCoins.current !== null && next.coins > lastCoins.current) {
      coinsEarned(next.coins - lastCoins.current);
    }
    lastCoins.current = next ? next.coins : null;
    setUserState(next);
  }, []);

  useEffect(() => {
    if (!tokenStore.get()) {
      setReady(true);
      return;
    }
    api('/me').then((d) => setUser(d.user)).catch(() => {}).finally(() => setReady(true));
  }, [setUser]);

  useEffect(() => {
    const signedOut = () => setUser(null);
    window.addEventListener('edufin:signed-out', signedOut);
    return () => window.removeEventListener('edufin:signed-out', signedOut);
  }, [setUser]);

  const value = useMemo(() => {
    const startSession = (data, remember) => {
      tokenStore.set(data.token, remember);
      setUser(data.user);
    };
    return {
      user,
      ready,
      setUser,
      startSession,
      login: async (email, password, remember) =>
        startSession(await api('/auth/login', { method: 'POST', body: { email, password, remember } }), remember),
      signup: async (fields) => startSession(await api('/auth/register', { method: 'POST', body: fields }), false),
      logout: () => {
        tokenStore.clear();
        setUser(null);
      },
    };
  }, [user, ready, setUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
