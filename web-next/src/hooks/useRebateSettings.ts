import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type UserRebateSetting = {
  id: number;
  inviter_id: number;
  inviter_username: string;
  register_reward: number;
  invitee_reward: number;
  top_up_rebate_count: number;
  top_up_rebate_percent: number;
  subscription_rebate_count: number;
  created_at: number;
  updated_at: number;
};

export type RebateSettingInput = {
  id?: number;
  inviter_id: number;
  register_reward: number;
  invitee_reward: number;
  top_up_rebate_count: number;
  top_up_rebate_percent: number;
  subscription_rebate_count: number;
};

export function useRebateSettings(q: { p?: number; page_size?: number; keyword?: string }) {
  return useQuery<{ items: UserRebateSetting[]; total: number }>({
    queryKey: ['rebate-settings', 'list', q] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 30));
      if (q.keyword) params.set('keyword', q.keyword);
      const res = await api.get<{ items: UserRebateSetting[]; total: number }>(
        `/api/user_rebate_setting/?${params.toString()}`
      );
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useCreateRebateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RebateSettingInput) => {
      await api.post('/api/user_rebate_setting/', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rebate-settings'] });
    },
  });
}

export function useUpdateRebateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RebateSettingInput) => {
      await api.put('/api/user_rebate_setting/', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rebate-settings'] });
    },
  });
}

export function useDeleteRebateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/user_rebate_setting/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rebate-settings'] });
    },
  });
}
