import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type Tenant = {
  id: number;
  name: string;
  slug: string;
  status: number;
  created_at: number;
  updated_at: number;
};

export type TenantMember = {
  id: number;
  tenant_id: number;
  user_id: number;
  role: number;
  status: number;
  invited_by: number;
  created_at: number;
  user?: {
    id: number;
    username: string;
    email: string;
    display_name: string;
  };
};

const keys = {
  info: ['tenant', 'info'] as const,
  members: (q: Record<string, unknown>) => ['tenant', 'members', q] as const,
};

export function useTenantInfo() {
  return useQuery<Tenant>({
    queryKey: keys.info,
    queryFn: async () => {
      const res = await api.get<Tenant>('/api/tenant/info');
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useUpdateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name?: string; status?: number }) => {
      const res = await api.put<Tenant>('/api/tenant/', body);
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.info }),
  });
}

export type TenantMembersQuery = {
  p?: number;
  page_size?: number;
  keyword?: string;
};
export type TenantMembersPage = { items: TenantMember[]; total: number };

export function useTenantMembers(q: TenantMembersQuery) {
  return useQuery<TenantMembersPage>({
    queryKey: keys.members(q),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 50));
      if (q.keyword) params.set('keyword', q.keyword);
      const res = await api.get<TenantMembersPage>(`/api/tenant/members?${params.toString()}`);
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { username: string; role?: number }) => {
      const res = await api.post('/api/tenant/invite', body);
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenant', 'members'] }),
  });
}

export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { user_id: number; role?: number; status?: number }) => {
      const res = await api.put('/api/tenant/members', body);
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenant', 'members'] }),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (user_id: number) => {
      await api.delete(`/api/tenant/members?user_id=${user_id}`);
      return user_id;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenant', 'members'] }),
  });
}
