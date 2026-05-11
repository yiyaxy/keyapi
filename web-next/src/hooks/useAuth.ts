import { createContext, useContext } from 'react';

export type UserFeatures = {
  // Tenant-admin viewing of captured chat history.
  // Platform admins always see `true`; tenant admins see `true` only when
  // a platform admin enabled the per-tenant flag.
  chat_history: boolean;
};

export type User = {
  id: number;
  username: string;
  email: string;
  display_name: string | null;
  role: number;
  platform_role: number;
  tenant_role: number;
  tenant_id: number;
  group: string;
  quota: number;
  used_quota: number;
  github_id?: string;
  discord_id?: string;
  wechat_id?: string;
  oidc_id?: string;
  telegram_id?: string;
  linux_do_id?: string;
  features?: UserFeatures;
};

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export type AuthContextValue = {
  user: User | null;
  status: AuthStatus;
  refresh: () => Promise<void>;
  login: (body: { username: string; password: string }) => Promise<void>;
  register: (body: {
    username?: string;
    email: string;
    password: string;
    verification_code: string;
  }) => Promise<void>;
  logout: (opts?: { silent?: boolean }) => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return ctx;
}
