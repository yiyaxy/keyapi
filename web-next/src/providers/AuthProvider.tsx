import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AuthContext, type AuthStatus, type User } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { clearBootstrap, loadBootstrap, saveBootstrap } from '@/lib/bootstrap';
import { logError } from '@/lib/observability';

type LoginBody = { username: string; password: string };
type LoginOrRegisterStub = { id: number; tenant_id: number };
type RegisterBody = {
  username?: string;
  email: string;
  password: string;
  verification_code: string;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const boot = loadBootstrap();
    if (!boot) {
      if (mounted.current) {
        setUser(null);
        setStatus('unauthenticated');
      }
      return;
    }
    try {
      const res = await api.get<User>('/api/user/self');
      if (!mounted.current) return;
      setUser(res.data);
      setStatus('authenticated');
    } catch (err) {
      if (!mounted.current) return;
      logError(err, { tag: 'auth-refresh' });
      clearBootstrap();
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    // Mount-hydration is a legitimate case where the effect must trigger
    // a cascading setState (via refresh → setUser/setStatus). The alternative
    // would be TanStack Query or useSyncExternalStore, both overkill for a
    // one-shot boot read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (body: LoginBody) => {
      const res = await api.post<LoginOrRegisterStub>('/api/user/login', body);
      saveBootstrap({ id: res.data.id, tenant_id: res.data.tenant_id ?? 1 });
      await refresh();
    },
    [refresh]
  );

  const register = useCallback(
    async (body: RegisterBody) => {
      await api.post('/api/user/register', body);
      await login({ username: body.username ?? body.email, password: body.password });
    },
    [login]
  );

  const logout = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      try {
        await api.post('/api/user/logout');
      } catch (err) {
        logError(err, { tag: 'auth-logout' });
      }
    }
    clearBootstrap();
    if (!mounted.current) return;
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo(
    () => ({ user, status, refresh, login, register, logout }),
    [user, status, refresh, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
