import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type UptimeMonitor = {
  name: string;
  uptime: number; // 0..1
  uptime_7d: number;
  status: number;
  group?: string;
};

export type UptimeGroup = {
  categoryName: string;
  monitors: UptimeMonitor[];
};

export function useHomePageContent() {
  return useQuery<string>({
    queryKey: ['home-content'] as const,
    queryFn: async () => {
      const res = await api.get<string>('/api/home_page_content');
      return res.data ?? '';
    },
    staleTime: 60_000,
  });
}

export function useUptimeStatus() {
  return useQuery<UptimeGroup[]>({
    queryKey: ['home-uptime'] as const,
    queryFn: async () => {
      const res = await api.get<UptimeGroup[]>('/api/uptime/status');
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
