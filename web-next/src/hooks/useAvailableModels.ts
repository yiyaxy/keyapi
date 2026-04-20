import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export function useAvailableModels() {
  return useQuery({
    queryKey: qk.meta.availableModels,
    queryFn: async () => {
      const res = await api.get<string[]>('/api/user/models');
      return res.data ?? [];
    },
    staleTime: Infinity,
  });
}
