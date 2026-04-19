import { useTranslation } from 'react-i18next';

import type { LogSelfStat } from '@/hooks/useUserStat';
import { fmtMoney, fmtNum } from '@/lib/format';

import { StatTile } from './StatTile';

const QUOTA_PER_UNIT = 500_000;

export function ActivityCard({ stat }: { stat: LogSelfStat | undefined }) {
  const { t } = useTranslation('dashboard');
  return (
    <div className='flex gap-4'>
      <StatTile
        label={t('activity.requests')}
        value={stat ? fmtNum(stat.total_requests) : undefined}
      />
      <StatTile label={t('activity.tokens')} value={stat ? fmtNum(stat.total_tokens) : undefined} />
      <StatTile
        label={t('activity.consumed')}
        value={stat ? fmtMoney(stat.quota / QUOTA_PER_UNIT) : undefined}
      />
    </div>
  );
}
