import { useEffect, useMemo } from 'react';

import { ActivityCard } from '@/components/dashboard/ActivityCard';
import { QuotaCard } from '@/components/dashboard/QuotaCard';
import { RangeSelect, rangeToSeconds, useRange } from '@/components/dashboard/RangeSelect';
import { UsageTrendCard } from '@/components/dashboard/UsageTrendCard';
import { useAuth } from '@/hooks/useAuth';
import { PageAction } from '@/hooks/usePageAction';
import { useUsageTrend } from '@/hooks/useUsageTrend';
import { useUserStat } from '@/hooks/useUserStat';

export function DashboardPage() {
  const { user, refresh } = useAuth();
  const range = useRange();
  const { startSec, endSec } = useMemo(() => rangeToSeconds(range), [range]);
  const trend = useUsageTrend(startSec, endSec);
  const stat = useUserStat(startSec, endSec);

  // Pull the latest user.quota / used_quota on mount so QuotaCard reflects
  // spend since login rather than the cached snapshot from AuthProvider.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className='mx-auto max-w-[1080px] space-y-4'>
      <PageAction>
        <RangeSelect />
      </PageAction>
      {user && <QuotaCard user={user} />}
      <UsageTrendCard
        rows={trend.data}
        isPending={trend.isPending}
        startSec={startSec}
        endSec={endSec}
        range={range === '7d' ? '7' : '30'}
      />
      <ActivityCard stat={stat.data} />
    </div>
  );
}
