import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from '@/lib/api';

// Shape of the subset of /api/status fields web-next cares about for
// quota unit rendering / admin tools. The endpoint returns many more
// fields — we narrow to what we actually read to keep the bundle type
// surface tight.
export type PublicConfig = {
  quota_per_unit: number;
  quota_display_type: 'USD' | 'CNY' | 'TOKENS' | 'CUSTOM';
  usd_exchange_rate: number;
  register_enabled: boolean;
  password_register_enabled: boolean;
  password_login_enabled: boolean;
  email_verification: boolean;
  wechat_login?: boolean;
  wx_mini_login?: boolean;
  price?: number;
  custom_currency_symbol?: string;
  custom_currency_exchange_rate?: number;
  min_invoice_amount?: number;
};

// Fallbacks mirror the old web's defaults (helpers/render.jsx): a safe
// baseline when /api/status is unreachable.
const DEFAULT: PublicConfig = {
  quota_per_unit: 500_000,
  quota_display_type: 'USD',
  usd_exchange_rate: 7,
  register_enabled: true,
  password_register_enabled: true,
  password_login_enabled: true,
  email_verification: true,
  wechat_login: false,
  wx_mini_login: false,
  price: 7,
  custom_currency_symbol: '¤',
  custom_currency_exchange_rate: 1,
  min_invoice_amount: 200,
};

export function usePublicConfig() {
  const q = useQuery<PublicConfig>({
    queryKey: ['site-status'] as const,
    queryFn: async () => (await api.get<PublicConfig>('/api/status')).data,
    // /api/status is cheap but rarely changes; cache for the whole session.
    staleTime: Infinity,
  });
  // Merge at read time (not in queryFn) so ['site-status'] cache can be
  // shared with useSiteBranding regardless of fetch race. useMemo keeps
  // the returned reference stable across renders — consumers pass this
  // object into useEffect deps (EditUserDialog etc.), a new ref each
  // render causes infinite update loops (React #185).
  return useMemo(() => (q.data ? { ...DEFAULT, ...q.data } : DEFAULT), [q.data]);
}

// snapToCents: raw quota 是整数，但充值/退款等场景用户期望看到整分金额
// （例如 ¥1.00）。后端算 topup 的 quota_delta 时 amount × qpu / rate
// 会产生截断（1 × 500000 / 7.3 = 68493.15... → 68493），再在前端反算时
// 浮点误差出来成 0.9999978 → 显示 ¥0.999998，看起来像少充了。
//
// 解法：若真实 value 距离最近的两位小数不超过一个 raw quota 单位能
// 代表的显示步长，就吸附到那个整分值并切到 digits=2。对真实的小额
// 消费（¥0.199188 这种）不会误吸附，因为距离显著大于步长。
function snapToCents(
  value: number,
  rate: number,
  quotaPerUnit: number
): { value: number; digits: number } {
  if (!isFinite(value) || !isFinite(rate) || quotaPerUnit <= 0) {
    return { value, digits: 6 };
  }
  const step = Math.abs(rate) / quotaPerUnit;
  const cents = Math.round(value * 100) / 100;
  if (Math.abs(value - cents) <= step + 1e-12) {
    return { value: cents, digits: 2 };
  }
  return { value, digits: 6 };
}

// toDisplay converts a raw quota integer to the tenant-configured display
// unit. Returns { value, symbol, digits } so callers can render with
// tabular-nums consistent across all admin views.
export function toDisplay(
  raw: number,
  cfg: PublicConfig
): { value: number; symbol: string; digits: number } {
  if (cfg.quota_display_type === 'TOKENS') {
    return { value: raw, symbol: '', digits: 0 };
  }
  const usd = raw / cfg.quota_per_unit;
  if (cfg.quota_display_type === 'CNY') {
    const rate = cfg.usd_exchange_rate || 1;
    const snapped = snapToCents(usd * rate, rate, cfg.quota_per_unit);
    return { value: snapped.value, symbol: '¥', digits: snapped.digits };
  }
  if (cfg.quota_display_type === 'CUSTOM') {
    const rate = cfg.custom_currency_exchange_rate || 1;
    const snapped = snapToCents(usd * rate, rate, cfg.quota_per_unit);
    return {
      value: snapped.value,
      symbol: cfg.custom_currency_symbol || '¤',
      digits: snapped.digits,
    };
  }
  const snapped = snapToCents(usd, 1, cfg.quota_per_unit);
  return { value: snapped.value, symbol: '$', digits: snapped.digits };
}

// fromDisplay inverts toDisplay — admins type in the display unit, we
// store raw quota. Returns Math.round so sub-unit drift never sneaks in.
export function fromDisplay(display: number, cfg: PublicConfig): number {
  if (cfg.quota_display_type === 'TOKENS') {
    return Math.round(display);
  }
  if (cfg.quota_display_type === 'CNY') {
    const usd = display / (cfg.usd_exchange_rate || 1);
    return Math.round(usd * cfg.quota_per_unit);
  }
  if (cfg.quota_display_type === 'CUSTOM') {
    const usd = display / (cfg.custom_currency_exchange_rate || 1);
    return Math.round(usd * cfg.quota_per_unit);
  }
  return Math.round(display * cfg.quota_per_unit);
}
