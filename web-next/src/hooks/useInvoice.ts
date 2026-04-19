import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type InvoiceableOrder = {
  source_type: string;
  source_id: number;
  trade_no: string;
  money: number;
  currency: string;
  payment_method: string;
  complete_time: number;
};

export type InvoiceApplication = {
  id: number;
  user_id: number;
  invoice_type: string;
  title: string;
  tax_id: string;
  email: string;
  apply_remark: string;
  admin_remark: string;
  reject_reason: string;
  status: string;
  issue_status: string;
  total_money: number;
  currency: string;
  created_at: number;
};

export type CreateApplicationInput = {
  invoice_type: string;
  title: string;
  tax_id?: string;
  email: string;
  apply_remark?: string;
  items: { source_type: string; source_id: number }[];
};

export function useInvoiceableOrders(q: { p?: number; page_size?: number; keyword?: string }) {
  return useQuery<{ items: InvoiceableOrder[]; total: number }>({
    queryKey: ['invoice', 'orders', q] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 20));
      if (q.keyword) params.set('keyword', q.keyword);
      const res = await api.get<{ items: InvoiceableOrder[]; total: number }>(
        `/api/invoice/self/invoiceable_orders?${params.toString()}`
      );
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useInvoiceApplications(q: {
  p?: number;
  page_size?: number;
  status?: string;
  keyword?: string;
}) {
  return useQuery<{ items: InvoiceApplication[]; total: number }>({
    queryKey: ['invoice', 'applications', q] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 20));
      if (q.status) params.set('status', q.status);
      if (q.keyword) params.set('keyword', q.keyword);
      const res = await api.get<{ items: InvoiceApplication[]; total: number }>(
        `/api/invoice/self/applications?${params.toString()}`
      );
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useCreateInvoiceApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateApplicationInput) => {
      await api.post('/api/invoice/self/applications', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invoice'] });
    },
  });
}

export function useCancelInvoiceApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.post(`/api/invoice/self/applications/${id}/cancel`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invoice', 'applications'] });
    },
  });
}

export function useAdminInvoiceApplications(q: {
  p?: number;
  page_size?: number;
  status?: string;
  keyword?: string;
}) {
  return useQuery<{ items: InvoiceApplication[]; total: number }>({
    queryKey: ['invoice-admin', 'applications', q] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 30));
      if (q.status) params.set('status', q.status);
      if (q.keyword) params.set('keyword', q.keyword);
      const res = await api.get<{ items: InvoiceApplication[]; total: number }>(
        `/api/invoice/admin/applications?${params.toString()}`
      );
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export type AdminUpdateInvoiceStatusInput = {
  id: number;
  status: string;
  admin_remark?: string;
  reject_reason?: string;
};

export function useAdminUpdateInvoiceStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: AdminUpdateInvoiceStatusInput) => {
      await api.post(`/api/invoice/admin/applications/${body.id}/status`, {
        status: body.status,
        admin_remark: body.admin_remark ?? '',
        reject_reason: body.reject_reason ?? '',
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invoice-admin'] });
    },
  });
}
