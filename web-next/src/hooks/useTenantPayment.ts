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

export type PaymentRefundView = {
  id: number;
  out_trade_no: string;
  out_refund_no: string;
  refund_id?: string;
  payment_order_id: number;
  amount: number; // cents
  currency: string;
  reason: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'closed';
  last_error?: string;
  initiated_by: number;
  user_quota_delta: number; // raw quota admin wants reclaimed
  user_quota_delta_applied: number; // raw quota actually reclaimed after clamp
  refunded_at: number;
  created_at: number;
  updated_at: number;
};

// OrderWithRefundContext is the admin-only response from
// GET /api/payment/orders/:out_trade_no — includes the extra fields the
// refund dialog needs to compute a sensible default deduction.
export type OrderWithRefundContext = {
  id: number;
  out_trade_no: string;
  order_type: string;
  amount: number; // cents
  refunded_amount: number;
  currency: string;
  status: string;
  credited_quota: number; // raw quota applied to the user on topup
  payer_user_id: number;
  payer_username: string;
  payer_current_quota: number;
};

export async function fetchOrderRefundContext(
  outTradeNo: string
): Promise<OrderWithRefundContext> {
  const res = await api.get<OrderWithRefundContext>(
    `/api/payment/orders/${encodeURIComponent(outTradeNo)}`
  );
  return res.data;
}

export function useTenantPaymentRefunds(q: {
  page?: number;
  page_size?: number;
  status?: string;
}) {
  return useQuery<{ items: PaymentRefundView[]; total: number }>({
    queryKey: ['tenant-payment', 'refunds', q] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(q.page ?? 1));
      params.set('page_size', String(q.page_size ?? 20));
      if (q.status) params.set('status', q.status);
      const res = await api.get<{ items: PaymentRefundView[]; total: number }>(
        `/api/tenant/payment/refunds?${params.toString()}`
      );
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export type CreateRefundPayload = {
  out_trade_no: string;
  amount_cents: number;
  reason?: string;
  user_quota_delta?: number; // raw quota; backend clamps to ≤ user.quota
};

export function useCreateRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateRefundPayload) => {
      const res = await api.post<PaymentRefundView>('/api/tenant/payment/refunds', body);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tenant-payment', 'refunds'] });
      void qc.invalidateQueries({ queryKey: ['tenant-payment', 'orders'] });
    },
  });
}
