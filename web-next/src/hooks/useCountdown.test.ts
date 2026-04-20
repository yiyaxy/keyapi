import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useCountdown } from './useCountdown';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useCountdown', () => {
  test('ticks down to 0 and stops', () => {
    const { result } = renderHook(() => useCountdown());
    act(() => result.current.start(3));
    expect(result.current.seconds).toBe(3);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.seconds).toBe(2);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.seconds).toBe(0);
    expect(result.current.running).toBe(false);
  });

  test('reset cancels the interval', () => {
    const { result } = renderHook(() => useCountdown());
    act(() => result.current.start(10));
    act(() => vi.advanceTimersByTime(3000));
    act(() => result.current.reset());
    expect(result.current.seconds).toBe(0);
    expect(result.current.running).toBe(false);
  });
});
