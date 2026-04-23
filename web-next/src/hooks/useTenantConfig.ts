import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type TenantConfigItem = {
  key: string;
  value: string;
  overridden: boolean;
};

export function useTenantConfig() {
  return useQuery<TenantConfigItem[]>({
    queryKey: ['tenant', 'config'] as const,
    queryFn: async () => {
      const res = await api.get<TenantConfigItem[] | { items: TenantConfigItem[] }>(
        '/api/tenant/config'
      );
      if (Array.isArray(res.data)) return res.data;
      return (res.data?.items ?? []) as TenantConfigItem[];
    },
    staleTime: 15_000,
  });
}

export function useSetTenantConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { key: string; value: string }) => {
      await api.put('/api/tenant/config', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tenant', 'config'] });
      void qc.invalidateQueries({ queryKey: ['site-status'] });
    },
  });
}

export function useDeleteTenantConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      await api.delete('/api/tenant/config', { data: { key } });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tenant', 'config'] });
      void qc.invalidateQueries({ queryKey: ['site-status'] });
    },
  });
}
