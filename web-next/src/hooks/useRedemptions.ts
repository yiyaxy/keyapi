import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type Redemption = {
  id: number;
  tenant_id: number;
  user_id: number;
  key: string;
  status: number;
  name: string;
  quota: number;
  created_time: number;
  redeemed_time: number;
  used_user_id: number;
  expired_time: number;
};

export type RedemptionsQuery = {
  p?: number;
  page_size?: number;
};
export type RedemptionsPage = { items: Redemption[]; total: number };

const keys = {
  list: (q: RedemptionsQuery) => ['redemptions', 'list', q] as const,
};

export function useRedemptions(q: RedemptionsQuery) {
  return useQuery<RedemptionsPage>({
    queryKey: keys.list(q),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 50));
      const res = await api.get<RedemptionsPage>(`/api/redemption/?${params.toString()}`);
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export type CreateRedemptionInput = {
  name: string;
  quota: number;
  count: number;
  expired_time: number;
};

export function useCreateRedemptions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRedemptionInput) => {
      const res = await api.post<string[]>('/api/redemption/', input);
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['redemptions', 'list'] }),
  });
}

export function useDeleteRedemption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/redemption/${id}`);
      return id;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['redemptions', 'list'] }),
  });
}

export function useDeleteInvalidRedemptions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.delete('/api/redemption/invalid');
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['redemptions', 'list'] }),
  });
}
