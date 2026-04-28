import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type UserLevel = {
  id: number;
  tenant_id: number;
  code: string;
  name: string;
  description: string;
  register_reward: number;
  invitee_reward: number;
  top_up_bonus_percent: number;
  top_up_rebate_count: number;
  top_up_rebate_percent: number;
  subscription_rebate_count: number;
  enabled: boolean;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

export type UserLevelInput = {
  id?: number;
  code: string;
  name: string;
  description?: string;
  register_reward: number;
  invitee_reward: number;
  top_up_bonus_percent: number;
  top_up_rebate_count: number;
  top_up_rebate_percent: number;
  subscription_rebate_count: number;
  enabled: boolean;
  sort_order: number;
};

export function useUserLevels() {
  return useQuery<UserLevel[]>({
    queryKey: ['user-levels'] as const,
    queryFn: async () => {
      const res = await api.get<UserLevel[]>('/api/user_level/');
      return res.data;
    },
    staleTime: 15_000,
  });
}

export function useCreateUserLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: UserLevelInput) => {
      await api.post('/api/user_level/', body);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['user-levels'] }),
  });
}

export function useUpdateUserLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: UserLevelInput) => {
      await api.put('/api/user_level/', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user-levels'] });
      void qc.invalidateQueries({ queryKey: ['admin-users', 'list'] });
    },
  });
}

export function useDeleteUserLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/user_level/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user-levels'] });
      void qc.invalidateQueries({ queryKey: ['admin-users', 'list'] });
    },
  });
}
