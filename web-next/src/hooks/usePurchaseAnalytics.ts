import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type PurchaseOverview = {
  total_revenue: number;
  order_count: number;
  avg_order_value: number;
  prev_revenue: number;
  prev_order_count: number;
  revenue_change: number;
  order_count_change: number;
};

export type PurchaseTrendItem = {
  time_bucket: string;
  revenue: number;
  count: number;
};

export type PaymentMethodItem = {
  payment_method: string;
  revenue: number;
  count: number;
};

export type TopSpender = {
  user_id: number;
  username: string;
  total_spent: number;
  order_count: number;
};

function rangeParams(startTs: number, endTs: number, extra?: Record<string, string>): string {
  const p = new URLSearchParams();
  p.set('start_timestamp', String(startTs));
  p.set('end_timestamp', String(endTs));
  for (const k in extra) {
    p.set(k, extra[k]!);
  }
  return p.toString();
}

export function usePurchaseOverview(
  startTs: number,
  endTs: number,
  orderType = 'all'
) {
  return useQuery<PurchaseOverview>({
    queryKey: ['purchase', 'overview', startTs, endTs, orderType] as const,
    queryFn: async () => {
      const res = await api.get<PurchaseOverview>(
        `/api/analytics/purchase/overview?${rangeParams(startTs, endTs, {
          order_type: orderType,
        })}`
      );
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function usePurchaseTrend(
  startTs: number,
  endTs: number,
  granularity = 'day',
  orderType = 'all'
) {
  return useQuery<PurchaseTrendItem[]>({
    queryKey: ['purchase', 'trend', startTs, endTs, granularity, orderType] as const,
    queryFn: async () => {
      const res = await api.get<PurchaseTrendItem[]>(
        `/api/analytics/purchase/trend?${rangeParams(startTs, endTs, {
          granularity,
          order_type: orderType,
        })}`
      );
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function usePurchasePaymentMethods(
  startTs: number,
  endTs: number,
  orderType = 'all'
) {
  return useQuery<PaymentMethodItem[]>({
    queryKey: ['purchase', 'payment-methods', startTs, endTs, orderType] as const,
    queryFn: async () => {
      const res = await api.get<PaymentMethodItem[]>(
        `/api/analytics/purchase/payment-method?${rangeParams(startTs, endTs, {
          order_type: orderType,
        })}`
      );
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function usePurchaseTopSpenders(q: {
  start: number;
  end: number;
  p?: number;
  page_size?: number;
  orderType?: string;
}) {
  return useQuery<{ items: TopSpender[]; total: number }>({
    queryKey: ['purchase', 'top-spenders', q] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('start_timestamp', String(q.start));
      params.set('end_timestamp', String(q.end));
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 20));
      params.set('order_type', q.orderType ?? 'all');
      const res = await api.get<{ items: TopSpender[]; total: number }>(
        `/api/analytics/purchase/top-users?${params.toString()}`
      );
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
