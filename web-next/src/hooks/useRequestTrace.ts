import { useQuery } from '@tanstack/react-query';

import type { LogRow } from '@/hooks/useLogs';
import { api } from '@/lib/api';

export function useRequestTrace(requestId: string | null) {
  return useQuery<LogRow[]>({
    queryKey: ['request-trace', requestId ?? ''] as const,
    enabled: !!requestId,
    queryFn: async () => {
      if (!requestId) return [];
      const res = await api.get<LogRow[]>(`/api/log/request/${encodeURIComponent(requestId)}`);
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 60_000,
    retry: false,
  });
}
