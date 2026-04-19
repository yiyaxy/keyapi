import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type TenantMetricsSummary = {
  tenant_id: number;
  total_members: number;
  active_members: number;
  total_tokens: number;
  active_tokens: number;
  total_channels: number;
  active_channels: number;
  total_quota_used: number;
  total_requests: number;
  today_quota_used: number;
  today_requests: number;
};

export type TenantUsageTrendPoint = {
  date: string;
  quota_used: number;
  request_count: number;
};

export type TenantModelUsagePoint = {
  model_name: string;
  request_count: number;
  quota_used: number;
};

export function useTenantDashboard() {
  return useQuery<TenantMetricsSummary>({
    queryKey: ['tenant', 'dashboard'] as const,
    queryFn: async () => {
      const res = await api.get<TenantMetricsSummary>('/api/tenant/dashboard');
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useTenantUsageTrend(days: number) {
  return useQuery<TenantUsageTrendPoint[]>({
    queryKey: ['tenant', 'usage-trend', days] as const,
    queryFn: async () => {
      const res = await api.get<TenantUsageTrendPoint[]>(
        `/api/tenant/usage/trend?days=${days}`
      );
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 30_000,
  });
}

export function useTenantModelUsage() {
  return useQuery<TenantModelUsagePoint[]>({
    queryKey: ['tenant', 'model-usage'] as const,
    queryFn: async () => {
      const res = await api.get<TenantModelUsagePoint[]>('/api/tenant/usage/models');
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 30_000,
  });
}
