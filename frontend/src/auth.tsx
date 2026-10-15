import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { UserDto } from '@asa/shared';
import { api, setUnauthorizedHandler, tokenStore } from './api';

interface AuthState {
  user: UserDto | null;
  /** True while a stored token is being checked on first load. */
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  /** True when the person pressed Sign out, false when the session simply ended (expired token). */
  manualExit: boolean;
  signOut: (manual?: boolean) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState<boolean>(() => tokenStore.get() !== null);
  const [manualExit, setManualExit] = useState(false);

  const signOut = useCallback((manual = false) => {
    setManualExit(manual === true);
    tokenStore.clear();
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setUnauthorizedHandler(() => signOut(false));
    if (!tokenStore.get()) return;
    api
      .me()
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, [signOut]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const result = await api.login(username, password);
      tokenStore.set(result.token);
      queryClient.clear();
      setManualExit(false);
      setUser(result.user);
    },
    [queryClient],
  );

  const value = useMemo(() => ({ user, loading, manualExit, signIn, signOut }), [user, loading, manualExit, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
