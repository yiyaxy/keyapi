import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type SiteRPMEntry = { site_label: string; rpm: number };
export type SiteRPMResult = {
  window_seconds: number;
  all: { rpm: number };
  sites: SiteRPMEntry[];
};

export function useSiteRPM(windowSeconds = 60) {
  return useQuery<SiteRPMResult>({
    queryKey: ['analytics', 'site-rpm', windowSeconds] as const,
    queryFn: async () => {
      const res = await api.get<SiteRPMResult>(
        `/api/analytics/site-rpm?window_seconds=${windowSeconds}`
      );
      return res.data;
    },
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

export type ChannelMonitorItem = {
  channel_id: number;
  name: string;
  group: string;
  models: string;
  status: number;
  response_time_ms: number;
  test_time: number;
  balance: number;
  availability_rate: number;
  used_quota_1h: number;
};

export type ChannelMonitorGroup = {
  group_name: string;
  group_key: string;
  channels: ChannelMonitorItem[];
  total_count: number;
  normal_count: number;
  degraded_count: number;
  error_count: number;
  health_status: string;
  health_reason: string;
  avg_availability_rate: number;
  avg_cache_hit_rate: number;
};

export type ChannelMonitorData = {
  groups: ChannelMonitorGroup[];
  updated_at: number;
};

export function useChannelMonitor() {
  return useQuery<ChannelMonitorData>({
    queryKey: ['analytics', 'channel-monitor'] as const,
    queryFn: async () => {
      const res = await api.get<ChannelMonitorData>('/api/analytics/channel-monitor');
      return res.data;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
