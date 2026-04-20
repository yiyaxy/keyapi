import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type AdminUser = {
  id: number;
  tenant_id: number;
  username: string;
  display_name: string;
  email: string;
  role: number;
  status: number;
  group: string;
  quota: number;
  used_quota: number;
  request_count: number;
  created_time?: number;
};

export type UsersQuery = {
  p?: number;
  page_size?: number;
  keyword?: string;
};

export type UsersPage = { items: AdminUser[]; total: number };

const userKeys = {
  list: (q: UsersQuery) => ['admin-users', 'list', q] as const,
};

export function useAdminUsers(q: UsersQuery) {
  return useQuery<UsersPage>({
    queryKey: userKeys.list(q),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 50));
      if (q.keyword) params.set('keyword', q.keyword);
      const path = q.keyword ? '/api/user/search' : '/api/user/';
      const res = await api.get<UsersPage>(`${path}?${params.toString()}`);
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export type CreateUserInput = {
  username: string;
  password: string;
  display_name?: string;
  role?: number;
};

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateUserInput) => {
      const res = await api.post('/api/user/', input);
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-users', 'list'] }),
  });
}

export type UpdateUserInput = {
  id: number;
  username?: string;
  display_name?: string;
  email?: string;
  group?: string;
  role?: number;
  quota?: number;
  password?: string;
};

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateUserInput) => {
      const res = await api.put('/api/user/', input);
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-users', 'list'] }),
  });
}

export type ManageAction = 'enable' | 'disable' | 'delete' | 'promote' | 'demote';

export function useManageUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action }: { id: number; action: ManageAction }) => {
      const res = await api.post('/api/user/manage', { id, action });
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-users', 'list'] }),
  });
}
