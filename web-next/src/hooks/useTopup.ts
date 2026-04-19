import { useMutation, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

// WechatCreateResponse mirrors service/payment.CreateOrderResponse. Only
// one of code_url / h5_url / (prepay_id + signing bundle) is non-empty,
// depending on which product form was requested.
export type WechatCreateResponse = {
  code_url?: string;
  h5_url?: string;
  prepay_id?: string;
  package?: string;    // "prepay_id=..." for JSAPI
  nonce_str?: string;
  timestamp?: string;
  sign_type?: string;  // "RSA"
  pay_sign?: string;
};

// The controller wraps the order + provider response:
//
//   { success: true, data: { order: { out_trade_no, amount }, response: {...} } }
//
// `amount` is CNY cents (matches PaymentOrder.Amount).
export type CreateTopupResponse = {
  order: {
    out_trade_no: string;
    amount: number; // cents
  };
  response: WechatCreateResponse;
};

export type CreateTopupPayload = {
  amount: number; // display units — see resolveTopupPrice() in Go
  openid?: string; // jsapi only; native/h5 ignore
};

export function useCreateWechatTopupNative() {
  return useMutation({
    mutationFn: async (payload: CreateTopupPayload) => {
      const res = await api.post<CreateTopupResponse>('/api/payment/wechat/topup/native', payload);
      return res.data;
    },
  });
}

// PaymentOrderStatus mirrors the status strings defined in
// model/payment_order.go. "pending" is the only state worth polling on.
export type PaymentOrderStatus =
  | 'pending'
  | 'paid'
  | 'partial_refunded'
  | 'fully_refunded'
  | 'closed'
  | 'expired';

export type PaymentOrderView = {
  id: number;
  out_trade_no: string;
  transaction_id?: string;
  provider: string;
  order_type: string;
  product_form: string;
  amount: number;
  refunded_amount: number;
  currency: string;
  status: PaymentOrderStatus;
  paid_at: number;
  expires_at: number;
  created_at: number;
  updated_at: number;
};

// usePaymentOrderPolling polls /api/payment/orders/:out_trade_no every 3s
// until status flips off "pending" (or enabled=false suspends it).
//
// Call pattern: open a WechatPay modal → createTopup gives out_trade_no →
// mount this hook with {outTradeNo, enabled: true}. On paid/expired/closed
// the modal tears down which flips enabled=false and the poll stops.
export function usePaymentOrderPolling(outTradeNo: string | null, enabled: boolean) {
  return useQuery<PaymentOrderView>({
    queryKey: ['payment-order', outTradeNo] as const,
    enabled: Boolean(outTradeNo) && enabled,
    queryFn: async () => {
      const res = await api.get<PaymentOrderView>(`/api/payment/orders/${outTradeNo}`);
      return res.data;
    },
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s && s !== 'pending' ? false : 3000;
    },
    // Cut stale-time down so a second modal open after a paid order doesn't
    // see the previous cached "paid" row and skip the full poll cycle.
    staleTime: 0,
  });
}
