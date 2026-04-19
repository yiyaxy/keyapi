import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { api } from '@/lib/api';

export type WechatConfigView = {
  id: number;
  provider: string;
  enabled: boolean;
  mini_login_enabled: boolean;
  platform_locked: boolean;
  app_id: string;
  mchid: string;
  serial_no: string;
  app_secret_set: boolean;
  apiv3_key_set: boolean;
  private_key_set: boolean;
  last_test_at: number;
  last_test_ok: boolean;
  last_test_error: string;
  created_at: number;
  updated_at: number;
};

export type WechatConfigUpdate = {
  enabled?: boolean;
  mini_login_enabled?: boolean;
  app_id?: string;
  mchid?: string;
  serial_no?: string;
  app_secret?: string;
  apiv3_key?: string;
  private_key?: string;
};

export type PaymentOrder = {
  id: number;
  out_trade_no: string;
  transaction_id?: string;
  provider: string;
  order_type: string;
  product_form: string;
  amount: number;
  refunded_amount: number;
  currency: string;
  status: string;
  paid_at: number;
  expires_at: number;
  created_at: number;
  updated_at: number;
};

export function useWechatConfig() {
  return useQuery<WechatConfigView | null>({
    queryKey: ['tenant-payment', 'wechat'] as const,
    queryFn: async () => {
      const res = await api.get<WechatConfigView[]>(
        '/api/tenant/payment/configs'
      );
      return res.data[0] ?? null;
    },
    staleTime: 30_000,
  });
}

export function useUpdateWechatConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: WechatConfigUpdate) => {
      await api.put('/api/tenant/payment/configs/wechat', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tenant-payment', 'wechat'] });
    },
  });
}

export function useTestWechatConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.post('/api/tenant/payment/configs/wechat/test');
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['tenant-payment', 'wechat'] });
    },
  });
}

export function useDeleteWechatConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.delete('/api/tenant/payment/configs/wechat');
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tenant-payment', 'wechat'] });
    },
  });
}

export function useTenantPaymentOrders(q: {
  page?: number;
  page_size?: number;
  order_type?: string;
  status?: string;
}) {
  return useQuery<{ items: PaymentOrder[]; total: number }>({
    queryKey: ['tenant-payment', 'orders', q] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(q.page ?? 1));
      params.set('page_size', String(q.page_size ?? 20));
      if (q.order_type) params.set('order_type', q.order_type);
      if (q.status) params.set('status', q.status);
      const res = await api.get<{ items: PaymentOrder[]; total: number }>(
        `/api/tenant/payment/orders?${params.toString()}`
      );
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}
