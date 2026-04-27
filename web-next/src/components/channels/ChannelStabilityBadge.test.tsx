import { describe, expect, it } from 'vitest';

import { formatCooldownRemaining, isChannelCoolingDown } from './ChannelStabilityBadge';

describe('ChannelStabilityBadge helpers', () => {
  it('detects active cooldown windows from millisecond timestamps', () => {
    expect(isChannelCoolingDown({ status: 1, cooldown_until: 10_001 }, 10_000)).toBe(true);
    expect(isChannelCoolingDown({ status: 1, cooldown_until: 10_000 }, 10_000)).toBe(false);
    expect(isChannelCoolingDown({ status: 1, cooldown_until: 0 }, 10_000)).toBe(false);
  });

  it('formats compact countdown labels', () => {
    expect(formatCooldownRemaining(10_000, 9_000)).toBe('1s');
    expect(formatCooldownRemaining(70_000, 9_000)).toBe('1m 01s');
    expect(formatCooldownRemaining(7_290_000, 9_000)).toBe('2h 1m');
  });
});
