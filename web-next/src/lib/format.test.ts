import i18n from 'i18next';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { fmtDate, fmtMoney, fmtNum } from './format';

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
