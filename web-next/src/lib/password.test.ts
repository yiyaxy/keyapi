import { describe, expect, test } from 'vitest';

import { estimateStrength } from './password';

describe('estimateStrength', () => {
  test('empty → none', () => {
    expect(estimateStrength('')).toBe('none');
  });
  test('< 6 chars → weak', () => {
    expect(estimateStrength('ab1')).toBe('weak');
  });
  test('6+ chars but single class → weak', () => {
    expect(estimateStrength('abcdef')).toBe('weak');
  });
  test('2 classes + 8+ → fair', () => {
    expect(estimateStrength('abcdef12')).toBe('fair');
  });
  test('3 classes + 10+ → good', () => {
    expect(estimateStrength('Abcdef1234')).toBe('good');
  });
  test('4 classes + 12+ → strong', () => {
    expect(estimateStrength('Abcdef1234!@')).toBe('strong');
  });
});
