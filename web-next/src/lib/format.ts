import i18n from 'i18next';

export function fmtMoney(n: number, currency = 'USD'): string {
  return new Intl.NumberFormat(i18n.language, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
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
