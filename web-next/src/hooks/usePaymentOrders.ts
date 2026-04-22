import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type MyPaymentOrder = {
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

export type MyPaymentOrdersQuery = {
  page?: number;
  page_size?: number;
  order_type?: string;
};

export type MyPaymentOrdersResponse = {
  items: MyPaymentOrder[];
  total: number;
  page: number;
  page_size: number;
};

export function useMyPaymentOrders(q: MyPaymentOrdersQuery) {
  return useQuery<MyPaymentOrdersResponse>({
    queryKey: ['payment', 'my-orders', q] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(q.page ?? 1));
      params.set('page_size', String(q.page_size ?? 20));
      if (q.order_type) params.set('order_type', q.order_type);
      const res = await api.get<MyPaymentOrdersResponse>(
        `/api/payment/orders?${params.toString()}`
      );
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}
