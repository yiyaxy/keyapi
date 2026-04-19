import { useState } from 'react';
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
import { useSiteRPM } from '@/hooks/useAnalytics';

export function SiteRPMPage() {
  const { t } = useTranslation('ops');
  const [window, setWindow] = useState<60 | 300 | 900>(60);
  const rpm = useSiteRPM(window);

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <p className='text-13 text-fg-2'>
          {t('rpm.sub', { seconds: window })}
        </p>
        <Select
          value={String(window)}
          onValueChange={(v) => setWindow(Number(v) as 60 | 300 | 900)}
        >
          <SelectTrigger className='w-36'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='60'>{t('rpm.window.60')}</SelectItem>
            <SelectItem value='300'>{t('rpm.window.300')}</SelectItem>
            <SelectItem value='900'>{t('rpm.window.900')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {rpm.isError && (
        <InlineBanner
          level='danger'
          message={String((rpm.error as Error).message)}
          onClose={() => void rpm.refetch()}
        />
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t('rpm.all')}</CardTitle>
        </CardHeader>
        <CardContent>
          {rpm.isPending ? (
            <Skeleton className='h-12 w-48' />
          ) : (
            <div className='text-40 font-semibold tabular-nums'>
              {rpm.data?.all?.rpm.toFixed(1) ?? '—'}
            </div>
          )}
        </CardContent>
      </Card>
      {rpm.isPending ? (
        <Skeleton className='h-32 w-full' />
      ) : (rpm.data?.sites ?? []).length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('rpm.empty')}
        </div>
      ) : (
        <div className='overflow-x-auto rounded-md border border-line'>
          <table className='w-full border-collapse tabular-nums'>
            <thead>
              <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                <th className='px-3 py-2 font-medium'>{t('rpm.col.site')}</th>
                <th className='px-3 py-2 text-right font-medium'>
                  {t('rpm.col.rpm')}
                </th>
              </tr>
            </thead>
            <tbody>
              {(rpm.data?.sites ?? []).map((s) => (
                <tr
                  key={s.site_label}
                  className='border-b border-line text-13 hover:bg-bg-1'
                >
                  <td className='px-3 py-2 font-mono text-12'>
                    {s.site_label || '—'}
                  </td>
                  <td className='px-3 py-2 text-right'>{s.rpm.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
