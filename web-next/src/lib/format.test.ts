import i18n from 'i18next';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import type { PublicConfig } from '@/hooks/usePublicConfig';

import { fmtDate, fmtDateSec, fmtDaySec, fmtDisplay, fmtDisplayUsd, fmtMoney, fmtNum } from './format';

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.init({ lng: 'en', resources: { en: { translation: {} } } });
  }
  await i18n.changeLanguage('en');
});

afterAll(async () => {
  await i18n.changeLanguage('en');
});

describe('format', () => {
  test('fmtMoney en USD default 2 decimals', () => {
    expect(fmtMoney(1284.5)).toBe('$1,284.50');
  });

  test('fmtMoney CNY', () => {
    expect(fmtMoney(1000, 'CNY')).toMatch(/CN¥1,000\.00|¥1,000\.00/);
  });

  test('fmtNum thousands', () => {
    expect(fmtNum(9432108)).toBe('9,432,108');
  });

  test('fmtDate returns locale string', () => {
    const out = fmtDate('2026-04-18T12:34:56Z');
    expect(out).toMatch(/\d/);
  });
});

describe('fmtDisplay', () => {
  const usdCfg: PublicConfig = {
    quota_per_unit: 500_000,
    quota_display_type: 'USD',
    usd_exchange_rate: 7,
    custom_currency_symbol: '¤',
    custom_currency_exchange_rate: 1,
  };
  const cnyCfg: PublicConfig = { ...usdCfg, quota_display_type: 'CNY' };
  const tokensCfg: PublicConfig = { ...usdCfg, quota_display_type: 'TOKENS' };
  const customCfg: PublicConfig = {
    ...usdCfg,
    quota_display_type: 'CUSTOM',
    custom_currency_symbol: '€',
    custom_currency_exchange_rate: 0.9,
  };

  test('USD display renders $ prefix', () => {
    // 1_000_000 raw quota = 2 USD
    expect(fmtDisplay(1_000_000, usdCfg)).toBe('$2.00');
  });

  test('CNY display renders ¥ prefix and applies rate', () => {
    // 1_000_000 raw = 2 USD = 14 CNY at rate 7
    expect(fmtDisplay(1_000_000, cnyCfg)).toBe('¥14.00');
  });

  test('TOKENS display renders integer without symbol', () => {
    expect(fmtDisplay(1_000_000, tokensCfg)).toBe('1,000,000');
  });

  test('CUSTOM display uses configured symbol and rate', () => {
    // 1_000_000 raw = 2 USD * 0.9 = 1.80 EUR
    expect(fmtDisplay(1_000_000, customCfg)).toBe('€1.80');
  });

  test('fmtDisplayUsd converts USD input through display unit', () => {
    // 2 USD in CNY mode = 14 CNY
    expect(fmtDisplayUsd(2, cnyCfg)).toBe('¥14.00');
    // 2 USD in USD mode = $2
    expect(fmtDisplayUsd(2, usdCfg)).toBe('$2.00');
  });
});

describe('fmtDateSec (Unix seconds, local timezone)', () => {
  test('formats Unix-sec into date-time with year digits', () => {
    const out = fmtDateSec(1713484800);
    expect(out).toMatch(/\d{4}/);
    expect(out).not.toMatch(/1970/);
  });

  test('zero returns dash', () => {
    expect(fmtDateSec(0)).toBe('—');
  });

  test('negative (backend Never sentinel -1) returns dash', () => {
    expect(fmtDateSec(-1)).toBe('—');
  });
});

describe('fmtDaySec (Unix seconds, UTC day label)', () => {
  test('renders UTC month short + day', () => {
    const out = fmtDaySec(1713484800);
    expect(out).toMatch(/Apr/);
    expect(out).toMatch(/19/);
  });

  test('late-UTC-day stays on UTC day', () => {
    const out = fmtDaySec(1713484800 + 23 * 3600);
    expect(out).toMatch(/Apr/);
    expect(out).toMatch(/19/);
  });

  test('zero returns dash', () => {
    expect(fmtDaySec(0)).toBe('—');
  });
});
