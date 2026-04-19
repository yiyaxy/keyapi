import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type CacheSavingsResult = {
  total_savings_quota: number;
  total_cache_tokens: number;
  cache_hit_count: number;
};

export function useCacheSavingsSelf(startSec: number, endSec: number) {
  return useQuery<CacheSavingsResult>({
    queryKey: ['cache-savings', 'self', startSec, endSec] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (startSec > 0) params.set('start_timestamp', String(startSec));
      if (endSec > 0) params.set('end_timestamp', String(endSec));
      const res = await api.get<CacheSavingsResult>(
        `/api/log/self/cache_savings?${params.toString()}`
      );
      return res.data ?? {
        total_savings_quota: 0,
        total_cache_tokens: 0,
        cache_hit_count: 0,
      };
    },
    staleTime: 30_000,
  });
}
