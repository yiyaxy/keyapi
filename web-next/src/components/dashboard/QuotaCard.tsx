import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { fmtDisplay } from '@/lib/format';

export function QuotaCard({ user }: { user: { quota: number; used_quota: number } }) {
  const { t } = useTranslation('dashboard');
  const cfg = usePublicConfig();
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
            <div className='h2'>{fmtDisplay(user.quota, cfg)}</div>
            <div className='mt-3 h-1 w-full overflow-hidden rounded-pill bg-bg-2'>
              <div
                className='h-full bg-primary transition-all'
                style={{ width: `${percentUsed}%` }}
              />
            </div>
            <p className='muted mt-2 text-13'>
              {t('quota.used_of_total', {
                used: fmtDisplay(user.used_quota, cfg),
                total: fmtDisplay(total, cfg),
              })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
