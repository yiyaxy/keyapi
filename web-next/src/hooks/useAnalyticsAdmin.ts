import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type AnalyticsItem = {
  name: string;
  quota: number;
  count: number;
  tokens: number;
};

export type AnalyticsSummary = {
  total_quota: number;
  total_count: number;
  total_tokens: number;
  rpm: number;
  tpm: number;
};

export type AnalyticsResult = {
  items: AnalyticsItem[];
  summary: AnalyticsSummary;
};

function rangeParams(startTs: number, endTs: number): string {
  const p = new URLSearchParams();
  p.set('start_timestamp', String(startTs));
  p.set('end_timestamp', String(endTs));
  return p.toString();
}

export function useAnalyticsByChannel(startTs: number, endTs: number) {
  return useQuery<AnalyticsResult>({
    queryKey: ['analytics', 'channel', startTs, endTs] as const,
    queryFn: async () => {
      const res = await api.get<AnalyticsResult>(
        `/api/analytics/channel?${rangeParams(startTs, endTs)}`
      );
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useAnalyticsByModel(startTs: number, endTs: number) {
  return useQuery<AnalyticsResult>({
    queryKey: ['analytics', 'model', startTs, endTs] as const,
    queryFn: async () => {
      const res = await api.get<AnalyticsResult>(
        `/api/analytics/model?${rangeParams(startTs, endTs)}`
      );
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useAnalyticsByUser(startTs: number, endTs: number) {
  return useQuery<AnalyticsResult>({
    queryKey: ['analytics', 'user', startTs, endTs] as const,
    queryFn: async () => {
      const res = await api.get<AnalyticsResult>(
        `/api/analytics/user?${rangeParams(startTs, endTs)}`
      );
      return res.data;
    },
    staleTime: 30_000,
  });
}
