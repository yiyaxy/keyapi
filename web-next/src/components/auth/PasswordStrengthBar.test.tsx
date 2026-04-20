import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import '@/i18n';

import { PasswordStrengthBar } from './PasswordStrengthBar';

describe('PasswordStrengthBar', () => {
  test('empty password shows nothing', () => {
    render(<PasswordStrengthBar value='' />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });

  test('strong password shows strong', () => {
    render(<PasswordStrengthBar value='Abcdef1234!@' />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('4');
  });
});
