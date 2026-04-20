import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useAuth, type User } from '@/hooks/useAuth';
import { api } from '@/lib/api';

export type UpdateSelfPayload = {
  username?: string;
  display_name?: string;
  password?: string;
  original_password?: string;
};

export function useUpdateSelf() {
  const qc = useQueryClient();
  const { refresh } = useAuth();
  return useMutation({
    mutationFn: async (body: UpdateSelfPayload) => {
      const res = await api.put<User>('/api/user/self', body);
      return res.data;
    },
    onSuccess: async () => {
      await refresh();
      await qc.invalidateQueries({ queryKey: ['user'] });
    },
  });
}
