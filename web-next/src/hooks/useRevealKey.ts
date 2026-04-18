import { useMutation } from '@tanstack/react-query';

import { api } from '@/lib/api';

export function useRevealKey(tokenId: number) {
  return useMutation({
    mutationFn: async () => {
      const res = await api.post<{ key: string }>(`/api/token/${tokenId}/key`);
      return res.data.key;
    },
  });
}
