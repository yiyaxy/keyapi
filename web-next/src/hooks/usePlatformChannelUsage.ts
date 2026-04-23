import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

const usageKey = ['platform', 'channel-usage'] as const;
const tenantPlansKey = ['platform', 'tenant-plans'] as const;

export type PlatformChannelUsageRow = {
  tenant_id: number;
  tenant_name: string;
  plan_name: string;
  platform_quota_cap: number;
  platform_quota_used: number;
  platform_quota_period: 'none' | 'daily' | 'monthly';
  period_start: number;
};

export function usePlatformChannelUsage() {
  return useQuery<PlatformChannelUsageRow[]>({
    queryKey: usageKey,
    queryFn: async () => {
      const res = await api.get<PlatformChannelUsageRow[]>('/api/platform/tenants/platform-channel-usage');
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 10_000,
  });
}

export function useResetPlatformChannelUsage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tenantId: number) => {
      await api.post(`/api/platform/tenants/${tenantId}/platform-channel-usage/reset`);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: usageKey });
      await qc.invalidateQueries({ queryKey: tenantPlansKey });
    },
  });
}
