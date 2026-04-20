import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useCacheSavingsSelf } from '@/hooks/useCacheSavings';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { fmtDisplay, fmtNum } from '@/lib/format';

export function SmartCachePage() {
  const { t } = useTranslation('ops');
  const cfg = usePublicConfig();
  const [days, setDays] = useState<7 | 30 | 90>(30);

  const range = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    const now = Math.floor(Date.now() / 1000);
    return { startSec: now - days * 86400, endSec: now };
  }, [days]);

  const data = useCacheSavingsSelf(range.startSec, range.endSec);

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <p className='text-13 text-fg-2'>{t('cache.sub', { days })}</p>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as 7 | 30 | 90)}>
          <SelectTrigger className='w-36'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='7'>{t('cache.range.7')}</SelectItem>
            <SelectItem value='30'>{t('cache.range.30')}</SelectItem>
            <SelectItem value='90'>{t('cache.range.90')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {data.isError && (
        <InlineBanner
          level='danger'
          message={String((data.error as Error).message)}
          onClose={() => void data.refetch()}
        />
      )}
      <div className='grid grid-cols-1 gap-4 md:grid-cols-3'>
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-13 text-fg-2'>{t('cache.total_savings')}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.isPending ? (
              <Skeleton className='h-10 w-full' />
            ) : (
              <div className='text-28 font-semibold tabular-nums'>
                {fmtDisplay(data.data?.total_savings_quota ?? 0, cfg)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-13 text-fg-2'>{t('cache.cache_tokens')}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.isPending ? (
              <Skeleton className='h-10 w-full' />
            ) : (
              <div className='text-28 font-semibold tabular-nums'>
                {fmtNum(data.data?.total_cache_tokens ?? 0)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-13 text-fg-2'>{t('cache.hit_count')}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.isPending ? (
              <Skeleton className='h-10 w-full' />
            ) : (
              <div className='text-28 font-semibold tabular-nums'>
                {fmtNum(data.data?.cache_hit_count ?? 0)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
