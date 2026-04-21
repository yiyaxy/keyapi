import { useTranslation } from 'react-i18next';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useChannelMonitor, type ChannelMonitorItem } from '@/hooks/useAnalytics';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { fmtDateSec, fmtDisplay, fmtNum } from '@/lib/format';

function healthVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'normal':
      return 'default';
    case 'degraded':
      return 'secondary';
    case 'error':
      return 'destructive';
    default:
      return 'outline';
  }
}

function statusVariant(status: number): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 1) return 'default';
  if (status === 3) return 'destructive';
  return 'secondary';
}

export function ChannelMonitorPage() {
  const { t } = useTranslation('ops');
  const monitor = useChannelMonitor();

  if (monitor.isPending) {
    return (
      <div className='space-y-4'>
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className='h-64 w-full' />
        ))}
      </div>
    );
  }
  if (monitor.isError || !monitor.data) {
    return (
      <InlineBanner
        level='danger'
        message={String((monitor.error as Error).message)}
        onClose={() => void monitor.refetch()}
      />
    );
  }

  const groups = monitor.data.groups ?? [];

  return (
    <div className='space-y-4'>
      <div className='text-12 text-fg-2'>
        {t('monitor.updated', { time: fmtDateSec(monitor.data.updated_at) })}
      </div>
      {groups.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('monitor.empty')}
        </div>
      ) : (
        groups.map((g) => (
          <Card key={g.group_key}>
            <CardHeader>
              <div className='flex items-center justify-between gap-3'>
                <CardTitle>{g.group_name}</CardTitle>
                <div className='flex items-center gap-2'>
                  <Badge variant={healthVariant(g.health_status)}>
                    {t(`monitor.group.health.${g.health_status}`, {
                      defaultValue: g.health_status,
                    })}
                  </Badge>
                  <span className='text-12 text-fg-2 tabular-nums'>
                    {(g.avg_availability_rate * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
              {g.health_reason && <p className='text-12 text-fg-2'>{g.health_reason}</p>}
            </CardHeader>
            <CardContent>
              <ChannelMonitorTable channels={g.channels} t={t} />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function ChannelMonitorTable({
  channels,
  t,
}: {
  channels: ChannelMonitorItem[];
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const cfg = usePublicConfig();
  if (channels.length === 0) {
    return <div className='text-13 text-fg-2'>{t('monitor.empty')}</div>;
  }
  return (
    <div className='overflow-x-auto'>
      <table className='w-full border-collapse tabular-nums'>
        <thead>
          <tr className='border-b border-line text-left text-12 uppercase text-fg-2'>
            <th className='px-3 py-2 font-medium'>{t('monitor.col.channel')}</th>
            <th className='px-3 py-2 font-medium'>{t('monitor.col.group')}</th>
            <th className='px-3 py-2 font-medium'>{t('monitor.col.status')}</th>
            <th className='px-3 py-2 font-medium'>{t('monitor.col.latency')}</th>
            <th className='px-3 py-2 font-medium'>{t('monitor.col.availability')}</th>
            <th className='px-3 py-2 font-medium'>{t('monitor.col.balance')}</th>
            <th className='px-3 py-2 font-medium'>{t('monitor.col.used_1h')}</th>
          </tr>
        </thead>
        <tbody>
          {channels.map((ch) => (
            <tr key={ch.channel_id} className='border-b border-line text-13'>
              <td className='px-3 py-2'>
                <div className='font-mono text-12 text-fg-2'>#{ch.channel_id}</div>
                <div>{ch.name}</div>
              </td>
              <td className='px-3 py-2'>{ch.group}</td>
              <td className='px-3 py-2'>
                <Badge variant={statusVariant(ch.status)}>
                  {t(
                    ch.status === 1
                      ? 'monitor.status.enabled'
                      : ch.status === 3
                        ? 'monitor.status.auto_disabled'
                        : 'monitor.status.disabled'
                  )}
                </Badge>
              </td>
              <td className='px-3 py-2'>
                {ch.response_time_ms > 0 ? `${ch.response_time_ms} ms` : '—'}
              </td>
              <td className='px-3 py-2'>{(ch.availability_rate * 100).toFixed(1)}%</td>
              <td className='px-3 py-2'>{ch.balance !== 0 ? ch.balance.toFixed(2) : '—'}</td>
              <td className='px-3 py-2'>
                {ch.used_quota_1h > 0 ? fmtDisplay(ch.used_quota_1h, cfg) : fmtNum(0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
