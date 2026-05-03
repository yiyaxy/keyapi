import { describe, expect, test } from 'vitest';

import {
  editTokenSchema,
  parseAllowIps,
  parseGroupChain,
  serializeAllowIps,
  serializeGroupChain,
} from './token-schema';

describe('parseGroupChain / serializeGroupChain', () => {
  test('csv string → array', () => {
    expect(parseGroupChain('auto')).toEqual(['auto']);
    expect(parseGroupChain('vip,default')).toEqual(['vip', 'default']);
    expect(parseGroupChain('')).toEqual([]);
    expect(parseGroupChain(' vip , default ')).toEqual(['vip', 'default']);
  });

  test('array → csv string', () => {
    expect(serializeGroupChain(['auto'])).toBe('auto');
    expect(serializeGroupChain(['vip', 'default'])).toBe('vip,default');
    expect(serializeGroupChain([])).toBe('');
  });
});

describe('parseAllowIps / serializeAllowIps', () => {
  test('newline-separated textarea → array, trim empty', () => {
    expect(parseAllowIps('10.0.0.1\n\n192.168.1.0/24 ')).toEqual(['10.0.0.1', '192.168.1.0/24']);
  });

  test('empty string → empty array', () => {
    expect(parseAllowIps('')).toEqual([]);
  });

  test('round-trip', () => {
    expect(serializeAllowIps(['10.0.0.1', '192.168.1.0/24'])).toBe('10.0.0.1\n192.168.1.0/24');
  });
});

describe('editTokenSchema', () => {
  const base = {
    name: 'my-key',
    status: 1 as const,
    unlimited_quota: true,
    remain_quota: 0,
    expired_time: -1,
    model_limits_enabled: false,
    model_limits: [] as string[],
    enable_image_gen: true,
    allow_ips: [] as string[],
    group: ['auto'],
    cross_group_retry: false,
  };

  test('accepts canonical token', () => {
    expect(editTokenSchema.safeParse(base).success).toBe(true);
  });

  test('rejects empty name', () => {
    expect(editTokenSchema.safeParse({ ...base, name: '' }).success).toBe(false);
  });

  test('rejects name > 50 chars', () => {
    expect(editTokenSchema.safeParse({ ...base, name: 'a'.repeat(51) }).success).toBe(false);
  });

  test('rejects negative remain_quota when not unlimited', () => {
    expect(
      editTokenSchema.safeParse({ ...base, unlimited_quota: false, remain_quota: -1 }).success
    ).toBe(false);
  });

  test('accepts negative remain_quota when unlimited (value ignored)', () => {
    expect(
      editTokenSchema.safeParse({ ...base, unlimited_quota: true, remain_quota: -1 }).success
    ).toBe(true);
  });

  test('rejects cross_group_retry with only 1 group', () => {
    expect(editTokenSchema.safeParse({ ...base, cross_group_retry: true }).success).toBe(false);
  });

  test('accepts cross_group_retry with ≥2 groups', () => {
    expect(
      editTokenSchema.safeParse({
        ...base,
        group: ['vip', 'default'],
        cross_group_retry: true,
      }).success
    ).toBe(true);
  });
});
