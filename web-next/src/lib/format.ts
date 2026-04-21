import i18n from 'i18next';

import { toDisplay, type PublicConfig } from '@/hooks/usePublicConfig';

export function fmtMoney(n: number, currency = 'USD'): string {
  return new Intl.NumberFormat(i18n.language, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

// fmtDisplay renders a raw quota integer in whatever unit the tenant
// configured (USD / CNY / TOKENS / CUSTOM). All quota-derived money
// displays should go through this so the unit stays consistent with
// topup pricing.
//
// Precision strategy:
//   - TOKENS (digits=0): integer.
//   - Large values (|v| ≥ 1): fixed 2 fractional digits, tidy money
//     display — ¥1,461.00 not ¥1,460.999998.
//   - Small values (|v| < 1): up to the unit's native precision
//     (usually 6), trailing zeros trimmed — ¥0 for zero, ¥0.005081
//     kept for sub-cent spend.
export function fmtDisplay(rawQuota: number, cfg: PublicConfig): string {
  const { value, symbol, digits } = toDisplay(rawQuota, cfg);
  const isLarge = digits === 0 || Math.abs(value) >= 1;
  const minFrac = isLarge ? Math.min(digits, 2) : 0;
  const maxFrac = isLarge ? Math.min(digits, 2) : digits;
  const num = new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: minFrac,
    maximumFractionDigits: maxFrac,
  }).format(value);
  return symbol ? `${symbol}${num}` : num;
}

// fmtDisplayUsd takes a USD-denominated value (e.g., Pricing rows'
// per-million-tokens rate, plan prices tagged currency=USD) and renders
// it in the tenant's display unit. Internally it goes through toDisplay
// so rounding stays consistent with fmtDisplay.
export function fmtDisplayUsd(usd: number, cfg: PublicConfig): string {
  return fmtDisplay(Math.round(usd * cfg.quota_per_unit), cfg);
}

export function fmtNum(n: number): string {
  return new Intl.NumberFormat(i18n.language).format(n);
}

export function fmtDate(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  return new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function fmtDateSec(sec: number): string {
  if (sec <= 0 || !Number.isFinite(sec)) return '—';
  return new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(sec * 1000));
}

export function fmtDaySec(sec: number): string {
  if (sec <= 0 || !Number.isFinite(sec)) return '—';
  return new Intl.DateTimeFormat(i18n.language, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(sec * 1000));
}
