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

// QuotaUnit 枚举覆盖 PublicConfig 支持的所有显示单位 + 原生 quota int。
// 用于"多单位输入换算"场景（e.g. plan 编辑器里让管理员任选单位输入）。
export type QuotaUnit = 'quota' | 'usd' | 'cny' | 'custom';

// rawToUnit: 把 raw quota 整数换算为指定单位的数值（浮点）。
// 不负责格式化；只算数字。quota 单位直接透传。
export function rawToUnit(raw: number, unit: QuotaUnit, cfg: PublicConfig): number {
  if (!Number.isFinite(raw)) return 0;
  if (unit === 'quota') return raw;
  const usd = raw / cfg.quota_per_unit;
  if (unit === 'usd') return usd;
  if (unit === 'cny') return usd * (cfg.usd_exchange_rate || 1);
  if (unit === 'custom') return usd * (cfg.custom_currency_exchange_rate || 1);
  return raw;
}

// unitToRaw: 把指定单位的数值反算为 raw quota 整数（四舍五入）。
// 负数原样透传（保留 -1 表示 unlimited 的语义）。
export function unitToRaw(value: number, unit: QuotaUnit, cfg: PublicConfig): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return Math.round(value);
  if (unit === 'quota') return Math.round(value);
  if (unit === 'usd') return Math.round(value * cfg.quota_per_unit);
  if (unit === 'cny') {
    const usd = value / (cfg.usd_exchange_rate || 1);
    return Math.round(usd * cfg.quota_per_unit);
  }
  if (unit === 'custom') {
    const usd = value / (cfg.custom_currency_exchange_rate || 1);
    return Math.round(usd * cfg.quota_per_unit);
  }
  return Math.round(value);
}

// unitSymbol: 单位符号，用于 UI 预览展示。CUSTOM 返回 cfg 配置的符号。
export function unitSymbol(unit: QuotaUnit, cfg: PublicConfig): string {
  switch (unit) {
    case 'usd':
      return '$';
    case 'cny':
      return '¥';
    case 'custom':
      return cfg.custom_currency_symbol || '¤';
    default:
      return '';
  }
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
