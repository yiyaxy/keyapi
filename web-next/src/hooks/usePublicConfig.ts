import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

// Shape of the subset of /api/status fields web-next cares about for
// quota unit rendering / admin tools. The endpoint returns many more
// fields — we narrow to what we actually read to keep the bundle type
// surface tight.
export type PublicConfig = {
  quota_per_unit: number;
  quota_display_type: 'USD' | 'CNY' | 'TOKENS' | 'CUSTOM';
  usd_exchange_rate: number;
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
  price: 7,
  custom_currency_symbol: '¤',
  custom_currency_exchange_rate: 1,
  min_invoice_amount: 200,
};

export function usePublicConfig() {
  const q = useQuery<PublicConfig>({
    queryKey: ['public-config'] as const,
    queryFn: async () => {
      const res = await api.get<PublicConfig>('/api/status');
      // /api/status may not populate all optional fields; merge with defaults
      return { ...DEFAULT, ...res.data };
    },
    // /api/status is cheap but rarely changes; cache for the whole session.
    staleTime: Infinity,
  });
  return q.data ?? DEFAULT;
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
    return { value: usd * (cfg.usd_exchange_rate || 1), symbol: '¥', digits: 6 };
  }
  if (cfg.quota_display_type === 'CUSTOM') {
    return {
      value: usd * (cfg.custom_currency_exchange_rate || 1),
      symbol: cfg.custom_currency_symbol || '¤',
      digits: 6,
    };
  }
  return { value: usd, symbol: '$', digits: 6 };
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
