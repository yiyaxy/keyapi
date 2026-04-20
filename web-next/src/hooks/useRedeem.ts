import { useMutation } from '@tanstack/react-query';

import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';

export function useRedeem() {
  const { refresh } = useAuth();
  return useMutation({
    mutationFn: async (key: string) => {
      const res = await api.post<number>('/api/user/topup', { key });
      return res.data;
    },
    onSuccess: async () => {
      await refresh();
    },
  });
}
