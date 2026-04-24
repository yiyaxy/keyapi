import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type Option = {
  key: string;
  value: string;
};

export function useOptions() {
  return useQuery<Option[]>({
    queryKey: ['options', 'list'] as const,
    queryFn: async () => {
      const res = await api.get<Option[]>('/api/option/');
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useUpdateOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { key: string; value: string | boolean | number }) => {
      await api.put('/api/option/', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['options'] });
      // Option changes feed both usePublicConfig (quota/currency/payment)
      // and useSiteBranding (SystemName/Logo/Footer) which share the
      // ['site-status'] cache. Drop it so those views re-render without
      // a full reload.
      void qc.invalidateQueries({ queryKey: ['site-status'] });
    },
  });
}

export function useForceLogoutAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.post('/api/option/force_logout_all');
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['options'] });
    },
  });
}
