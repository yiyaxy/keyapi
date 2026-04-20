import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney } from '@/lib/format';

const QUOTA_PER_UNIT = 500_000;

export function QuotaCard({ user }: { user: { quota: number; used_quota: number } }) {
  const { t } = useTranslation('dashboard');
  const total = user.quota + user.used_quota;
  const isNew = user.quota === 0 && user.used_quota === 0;
  const exhausted = user.quota === 0 && user.used_quota > 0;
  const percentUsed = total === 0 ? 0 : Math.min(100, (user.used_quota / total) * 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle className='eyebrow flex items-center gap-2'>
          {t('quota.label')}
          {exhausted && <Badge variant='secondary'>{t('quota.exhausted')}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isNew ? (
          <div className='flex items-center gap-3'>
            <p className='muted flex-1'>{t('quota.zero_body')}</p>
            <Link to='/topup'>
              <Button>{t('quota.topup')}</Button>
            </Link>
          </div>
        ) : (
          <>
            <div className='h2'>{fmtMoney(user.quota / QUOTA_PER_UNIT)}</div>
            <div className='mt-3 h-1 w-full overflow-hidden rounded-pill bg-bg-2'>
              <div
                className='h-full bg-primary transition-all'
                style={{ width: `${percentUsed}%` }}
              />
            </div>
            <p className='muted mt-2 text-13'>
              {t('quota.used_of_total', {
                used: fmtMoney(user.used_quota / QUOTA_PER_UNIT),
                total: fmtMoney(total / QUOTA_PER_UNIT),
              })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
