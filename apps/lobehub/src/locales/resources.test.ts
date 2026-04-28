import { describe, expect, it } from 'vitest';

import { normalizeLocale } from './resources';

describe('normalizeLocale', () => {
  it('should return "zh-CN" when locale is undefined', () => {
    expect(normalizeLocale()).toBe('zh-CN');
  });

  it('should normalize Chinese locale variants to "zh-CN"', () => {
    expect(normalizeLocale('zh-CN')).toBe('zh-CN');
    expect(normalizeLocale('zh')).toBe('zh-CN');
    expect(normalizeLocale('zh-TW')).toBe('zh-CN');
    expect(normalizeLocale('zh_Hans')).toBe('zh-CN');
  });

  it('should normalize English locale variants to "en-US"', () => {
    expect(normalizeLocale('en')).toBe('en-US');
    expect(normalizeLocale('en-US')).toBe('en-US');
    expect(normalizeLocale('en_GB')).toBe('en-US');
  });

  it('should fallback unsupported locales to "zh-CN"', () => {
    expect(normalizeLocale('de')).toBe('zh-CN');
    expect(normalizeLocale('fr-FR')).toBe('zh-CN');
    expect(normalizeLocale('unknown')).toBe('zh-CN');
  });
});
