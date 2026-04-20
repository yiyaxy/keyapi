import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import '@/i18n';

import { ResendCountdown } from './ResendCountdown';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe('ResendCountdown', () => {
  test('clicks fire onResend then enters cooldown', async () => {
    const onResend = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ResendCountdown onResend={onResend} initialSeconds={3} />);
    await user.click(screen.getByRole('button'));
    expect(onResend).toHaveBeenCalled();
    expect(screen.getByText(/3s|3 s/)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3000));
    await screen.findByRole('button');
  });
});
