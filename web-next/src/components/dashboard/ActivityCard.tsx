import { useTranslation } from 'react-i18next';

import { usePublicConfig } from '@/hooks/usePublicConfig';
import type { LogSelfStat } from '@/hooks/useUserStat';
import { fmtDisplay, fmtNum } from '@/lib/format';

import { StatTile } from './StatTile';

export function ActivityCard({ stat }: { stat: LogSelfStat | undefined }) {
  const { t } = useTranslation('dashboard');
  const cfg = usePublicConfig();
  return (
    <div className='flex gap-4'>
      <StatTile
        label={t('activity.requests')}
        value={stat ? fmtNum(stat.total_requests) : undefined}
      />
      <StatTile label={t('activity.tokens')} value={stat ? fmtNum(stat.total_tokens) : undefined} />
      <StatTile
        label={t('activity.consumed')}
        value={stat ? fmtDisplay(stat.quota, cfg) : undefined}
      />
    </div>
  );
}
