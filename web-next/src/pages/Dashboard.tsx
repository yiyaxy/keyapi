import { useMemo } from 'react';

import { ActivityCard } from '@/components/dashboard/ActivityCard';
import { QuotaCard } from '@/components/dashboard/QuotaCard';
import { RangeSelect, rangeToSeconds, useRange } from '@/components/dashboard/RangeSelect';
import { UsageTrendCard } from '@/components/dashboard/UsageTrendCard';
import { useAuth } from '@/hooks/useAuth';
import { PageAction } from '@/hooks/usePageAction';
import { useUsageTrend } from '@/hooks/useUsageTrend';
import { useUserStat } from '@/hooks/useUserStat';

export function DashboardPage() {
  const { user } = useAuth();
  const range = useRange();
  const { startSec, endSec } = useMemo(() => rangeToSeconds(range), [range]);
  const trend = useUsageTrend(startSec, endSec);
  const stat = useUserStat(startSec, endSec);

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
