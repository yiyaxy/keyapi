import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type TenantAlert = {
  id: number;
  tenant_id: number;
  alert_type: string;
  severity: string;
  message: string;
  status: string;
  triggered_at: number;
  acknowledged_at?: number;
  acknowledged_by?: number;
  resolved_at?: number;
  created_at: number;
};

export function useTenantAlerts() {
  return useQuery<TenantAlert[]>({
    queryKey: ['tenant', 'alerts'] as const,
    queryFn: async () => {
      const res = await api.get<TenantAlert[]>('/api/tenant/alerts');
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 15_000,
  });
}

export function useTenantAlertHistory(q: {
  p?: number;
  page_size?: number;
  status?: string;
}) {
  return useQuery<{ items: TenantAlert[]; total: number }>({
    queryKey: ['tenant', 'alerts', 'history', q] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 30));
      if (q.status) params.set('status', q.status);
      const res = await api.get<{ items: TenantAlert[]; total: number }>(
        `/api/tenant/alerts/history?${params.toString()}`
      );
      return res.data;
    },
    staleTime: 15_000,
  });
}

export function useAckAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.post(`/api/tenant/alerts/${id}/ack`);
      return id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tenant', 'alerts'] });
    },
  });
}

export function useResolveAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.post(`/api/tenant/alerts/${id}/resolve`);
      return id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tenant', 'alerts'] });
    },
  });
}
