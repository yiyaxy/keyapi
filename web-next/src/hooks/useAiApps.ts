import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { api } from '@/lib/api';

export type AiAppScope = 'platform' | 'tenant';

export type AiApp = {
  id: number;
  tenant_id: number;
  scope: AiAppScope;
  name: string;
  slug: string;
  description: string;
  icon_url: string;
  target_url: string;
  status: number; // 0=draft, 1=online, 2=archived
  sort_order: number;
  vendor_user_id: number;
  guest_quota: number;
  default_group: string;
  session_token_ttl: number;
  tags: string;
  created_at: number;
  updated_at: number;
};

export type AiAppInput = {
  id?: number;
  scope: AiAppScope;
  name: string;
  slug: string;
  description: string;
  icon_url: string;
  target_url: string;
  status: number;
  sort_order: number;
  vendor_user_id: number;
  guest_quota: number;
  default_group: string;
  session_token_ttl: number;
  tags: string;
};

export const AI_APP_STATUS = {
  DRAFT: 0,
  ONLINE: 1,
  ARCHIVED: 2,
} as const;

// ── Public hooks ──────────────────────────────────────────────────────────────

export function usePublicApps() {
  return useQuery<AiApp[]>({
    queryKey: ['apps', 'public'],
    queryFn: async () => {
      const res = await api.get<AiApp[]>('/api/app');
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function usePublicApp(slug: string) {
  return useQuery<AiApp>({
    queryKey: ['apps', 'public', slug],
    queryFn: async () => {
      const res = await api.get<AiApp>(`/api/app/${slug}`);
      return res.data;
    },
    enabled: Boolean(slug),
    staleTime: 60_000,
  });
}

export function useGetSessionToken(slug: string) {
  return useMutation({
    mutationFn: async () => {
      const res = await api.post<{ key: string; expired_time: number; app_id: number }>(
        `/api/app/${slug}/session`
      );
      return res.data;
    },
  });
}

export function useGetGuestToken(slug: string) {
  return useMutation({
    mutationFn: async () => {
      const res = await api.post<{ key: string; expired_time: number; quota: number }>(
        `/api/app/${slug}/guest-session`
      );
      return res.data;
    },
  });
}

// ── Admin hooks ───────────────────────────────────────────────────────────────

export function useAdminApps(q: { p?: number; page_size?: number }) {
  return useQuery<{ items: AiApp[]; total: number }>({
    queryKey: ['apps', 'admin', 'list', q],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 20));
      const res = await api.get<{ items: AiApp[]; total: number }>(
        `/api/admin/app?${params.toString()}`
      );
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useCreateAiApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: AiAppInput) => {
      await api.post('/api/admin/app', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['apps'] });
    },
  });
}

export function useUpdateAiApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: AiAppInput & { id: number }) => {
      const { id, ...rest } = body;
      await api.put(`/api/admin/app/${id}`, rest);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['apps'] });
    },
  });
}

export function useUpdateAiAppStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: number }) => {
      await api.patch(`/api/admin/app/${id}/status`, { status });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['apps'] });
    },
  });
}

export function useDeleteAiApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/admin/app/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['apps'] });
    },
  });
}
