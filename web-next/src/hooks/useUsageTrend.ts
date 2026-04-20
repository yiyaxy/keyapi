import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import type { QuotaDataRow } from '@/lib/usage-aggregate';

export function useUsageTrend(startSec: number, endSec: number) {
  return useQuery({
    queryKey: qk.user.dataSelf(startSec, endSec),
    queryFn: async () => {
      const res = await api.get<QuotaDataRow[]>('/api/data/self', {
        params: { start_timestamp: startSec, end_timestamp: endSec },
      });
      return res.data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}
