import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type SubscriptionPlanDTO = {
  id: number;
  title: string;
  subtitle: string;
  promo_highlights: string;
  price_amount: number;
  currency: string;
  duration_unit: string;
  duration_value: number;
  status: string;
  enabled: boolean;
  sort_order: number;
  max_purchase_per_user: number;
  upgrade_group: string;
  total_quota?: number;
};

export type SubscriptionSelfInfo = {
  active: boolean;
  plan_id?: number;
  plan_title?: string;
  expires_at?: number;
  used_quota?: number;
  total_quota?: number;
  remaining_quota?: number;
  purchase_count?: number;
};

export function useSubscriptionPlans() {
  return useQuery<SubscriptionPlanDTO[]>({
    queryKey: ['subscription', 'plans'] as const,
    queryFn: async () => {
      const res = await api.get<SubscriptionPlanDTO[]>('/api/subscription/plans');
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 60_000,
  });
}

export function useSubscriptionSelf() {
  return useQuery<SubscriptionSelfInfo>({
    queryKey: ['subscription', 'self'] as const,
    queryFn: async () => {
      const res = await api.get<SubscriptionSelfInfo>('/api/subscription/self');
      return res.data ?? { active: false };
    },
    staleTime: 30_000,
  });
}

export function useActivateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (planId: number) => {
      await api.post(`/api/subscription/activate/${planId}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['subscription'] });
    },
  });
}
