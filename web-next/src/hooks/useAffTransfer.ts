import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type AffTransferRequest = {
  id: number;
  user_id: number;
  username: string;
  quota: number;
  status: number; // 1=pending 2=approved 3=rejected
  admin_id: number;
  admin_remark: string;
  created_at: number;
  updated_at: number;
};

export type AffTransferStats = {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  approved_quota: number;
};

export function useAffTransferSelf(q: { p?: number; page_size?: number; status?: number }) {
  return useQuery<{ items: AffTransferRequest[]; total: number }>({
    queryKey: ['aff-transfer', 'self', q] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 20));
      if (q.status) params.set('status', String(q.status));
      const res = await api.get<{ items: AffTransferRequest[]; total: number }>(
        `/api/aff_transfer/self?${params.toString()}`
      );
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useAffPendingQuota() {
  return useQuery<{ pending_quota: number } | number>({
    queryKey: ['aff-transfer', 'pending-quota'] as const,
    queryFn: async () => {
      const res = await api.get<{ pending_quota: number } | number>(
        '/api/aff_transfer/pending_quota'
      );
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useCreateAffTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (quota: number) => {
      await api.post('/api/aff_transfer/', { quota });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['aff-transfer'] });
    },
  });
}

export function useAdminAffTransfers(q: {
  p?: number;
  page_size?: number;
  status?: number;
  keyword?: string;
}) {
  return useQuery<{ items: AffTransferRequest[]; total: number }>({
    queryKey: ['aff-transfer-admin', 'list', q] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 30));
      if (q.status) params.set('status', String(q.status));
      if (q.keyword) params.set('keyword', q.keyword);
      const res = await api.get<{ items: AffTransferRequest[]; total: number }>(
        `/api/aff_transfer/?${params.toString()}`
      );
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useAdminProcessAffTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { id: number; status: 2 | 3; admin_remark?: string }) => {
      await api.post('/api/aff_transfer/process', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['aff-transfer-admin'] });
    },
  });
}
