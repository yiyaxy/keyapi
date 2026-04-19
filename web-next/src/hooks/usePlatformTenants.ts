import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Tenant } from '@/hooks/useTenant';
import { api } from '@/lib/api';

const keys = {
  list: ['platform', 'tenants'] as const,
};

export function usePlatformTenants() {
  return useQuery<Tenant[]>({
    queryKey: keys.list,
    queryFn: async () => {
      const res = await api.get<Tenant[]>('/api/platform/tenants/');
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 15_000,
  });
}

export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; slug: string }) => {
      const res = await api.post<Tenant>('/api/platform/tenants/', body);
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.list }),
  });
}

export function useDeleteTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/platform/tenants/${id}`);
      return id;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.list }),
  });
}
