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
export function fmtDisplay(rawQuota: number, cfg: PublicConfig): string {
  const { value, symbol, digits } = toDisplay(rawQuota, cfg);
  const num = new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
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
