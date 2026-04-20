export type QuotaDataRow = {
  id: number;
  tenant_id: number;
  user_id: number;
  username: string;
  model_name: string;
  created_at: number;
  token_used: number;
  count: number;
  quota: number;
};

export type DayPoint = {
  day: number;
  quota: number;
  count: number;
};

const DAY = 86400;

export function aggregateByUtcDay(
  rows: QuotaDataRow[],
  startSec: number,
  endSec: number
): DayPoint[] {
  const startDay = Math.floor(startSec / DAY) * DAY;
  const endDay = Math.floor(endSec / DAY) * DAY;
  const buckets = new Map<number, DayPoint>();
  for (let d = startDay; d <= endDay; d += DAY) {
    buckets.set(d, { day: d, quota: 0, count: 0 });
  }
  for (const r of rows) {
    const day = Math.floor(r.created_at / DAY) * DAY;
    const bucket = buckets.get(day);
    if (!bucket) continue;
    bucket.quota += r.quota;
    bucket.count += r.count;
  }
  return Array.from(buckets.values()).sort((a, b) => a.day - b.day);
}
