import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export type LogSelfStat = {
  quota: number;
  rpm: number;
  tpm: number;
  total_requests: number;
  total_tokens: number;
  smartcache_savings_quota: number;
};

export function useUserStat(startSec: number, endSec: number) {
  return useQuery({
    queryKey: qk.user.statSelf(startSec, endSec),
    queryFn: async () => {
      const res = await api.get<LogSelfStat>('/api/log/self/stat', {
        params: { start_timestamp: startSec, end_timestamp: endSec, type: 0 },
      });
      return res.data;
    },
    staleTime: 5 * 60_000,
  });
}
