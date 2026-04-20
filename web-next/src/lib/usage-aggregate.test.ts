import { describe, expect, test } from 'vitest';

import { aggregateByUtcDay, type QuotaDataRow } from './usage-aggregate';

const row = (created_at: number, quota: number, count = 1): QuotaDataRow => ({
  id: 0,
  tenant_id: 1,
  user_id: 1,
  username: 'u',
  model_name: 'm',
  created_at,
  token_used: 100,
  count,
  quota,
});

describe('aggregateByUtcDay', () => {
  test('empty rows + range produces zero-filled series', () => {
    const startSec = 1713484800;
    const endSec = startSec + 2 * 86400;
    const out = aggregateByUtcDay([], startSec, endSec);
    expect(out).toHaveLength(3);
    expect(out.every((p) => p.quota === 0 && p.count === 0)).toBe(true);
  });

  test('rows within one UTC day collapse to one point', () => {
    const startSec = 1713484800;
    const endSec = startSec;
    const out = aggregateByUtcDay(
      [row(startSec, 10), row(startSec + 3600, 20), row(startSec + 7200, 5)],
      startSec,
      endSec
    );
    expect(out).toHaveLength(1);
    expect(out[0].quota).toBe(35);
    expect(out[0].count).toBe(3);
  });

  test('rows across UTC midnight split into two days', () => {
    const startSec = 1713484800;
    const endSec = startSec + 86400;
    const out = aggregateByUtcDay(
      [row(startSec + 3600, 10), row(startSec + 86400 + 3600, 20)],
      startSec,
      endSec
    );
    expect(out[0].quota).toBe(10);
    expect(out[1].quota).toBe(20);
  });

  test('cross-month boundary preserves all points', () => {
    const startSec = 1711929600;
    const endSec = startSec + 2 * 86400;
    const out = aggregateByUtcDay(
      [row(startSec, 5), row(startSec + 86400, 10), row(startSec + 2 * 86400, 15)],
      startSec,
      endSec
    );
    expect(out.map((p) => p.quota)).toEqual([5, 10, 15]);
  });

  test('rows outside range are ignored', () => {
    const startSec = 1713484800;
    const endSec = startSec + 86400;
    const out = aggregateByUtcDay(
      [row(startSec - 86400, 999), row(startSec + 86400 * 3, 999), row(startSec, 10)],
      startSec,
      endSec
    );
    expect(out[0].quota).toBe(10);
    expect(out[1].quota).toBe(0);
  });
});
