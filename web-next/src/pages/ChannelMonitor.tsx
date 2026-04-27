import { RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { InlineBanner } from '@/components/auth/InlineBanner';
import {
  ChannelStabilityBadge,
  isChannelCoolingDown,
} from '@/components/channels/ChannelStabilityBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useChannelMonitor,
  type ChannelMonitorGroup,
  type ChannelMonitorItem,
} from '@/hooks/useAnalytics';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { fmtDateSec, fmtDisplay, fmtNum } from '@/lib/format';
import { cn } from '@/lib/utils';

function healthVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'normal':
      return 'default';
    case 'degraded':
      return 'secondary';
    case 'abnormal':
    case 'error':
      return 'destructive';
    default:
      return 'outline';
  }
}

function summaryToneClass(tone: 'neutral' | 'ok' | 'warn' | 'bad') {
  switch (tone) {
    case 'ok':
      return 'border-emerald-500/30 bg-emerald-500/10';
    case 'warn':
      return 'border-amber-500/30 bg-amber-500/10';
    case 'bad':
      return 'border-red-500/30 bg-red-500/10';
    default:
      return 'border-line bg-bg-1';
  }
}

function buildSummary(groups: ChannelMonitorGroup[]) {
  const nowMs = Date.now();
  const channels = groups.flatMap((group) => group.channels ?? []);
  return {
    totalChannels: channels.length,
    enabledChannels: channels.filter((channel) => channel.status === 1).length,
    coolingChannels: channels.filter(
      (channel) => channel.status === 1 && isChannelCoolingDown(channel, nowMs)
    ).length,
    degradedGroups: groups.filter((group) => group.health_status === 'degraded').length,
    abnormalGroups: groups.filter((group) => ['abnormal', 'error'].includes(group.health_status))
      .length,
  };
}

function SummaryTile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number | string;
  tone?: 'neutral' | 'ok' | 'warn' | 'bad';
}) {
  return (
    <div className={cn('rounded-md border px-4 py-3', summaryToneClass(tone))}>
      <div className='text-12 uppercase text-fg-2'>{label}</div>
      <div className='mt-2 text-2xl font-semibold tabular-nums text-fg-0'>{value}</div>
    </div>
  );
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
  const summary = buildSummary(groups);

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='text-12 text-fg-2'>
          {t('monitor.updated', { time: fmtDateSec(monitor.data.updated_at) })}
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            type='button'
            variant='secondary'
            size='sm'
            disabled={monitor.isFetching}
            onClick={() => void monitor.refetch()}
          >
            <RefreshCw className={monitor.isFetching ? 'animate-spin' : undefined} />
            {t('monitor.action.refresh', { defaultValue: 'Refresh' })}
          </Button>
          <Button asChild variant='ghost' size='sm'>
            <Link to='/admin/settings?tab=channel-stability'>
              <SlidersHorizontal />
              {t('monitor.action.settings', { defaultValue: 'Stability settings' })}
            </Link>
          </Button>
        </div>
      </div>

      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
        <SummaryTile
          label={t('monitor.summary.channels', { defaultValue: 'Channels' })}
          value={summary.totalChannels}
        />
        <SummaryTile
          label={t('monitor.summary.enabled', { defaultValue: 'Enabled' })}
          value={summary.enabledChannels}
          tone='ok'
        />
        <SummaryTile
          label={t('monitor.summary.cooling', { defaultValue: 'Cooling down' })}
          value={summary.coolingChannels}
          tone={summary.coolingChannels > 0 ? 'warn' : 'neutral'}
        />
        <SummaryTile
          label={t('monitor.summary.attention', { defaultValue: 'Needs attention' })}
          value={summary.degradedGroups + summary.abnormalGroups}
          tone={summary.abnormalGroups > 0 ? 'bad' : summary.degradedGroups > 0 ? 'warn' : 'ok'}
        />
      </div>

      {groups.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('monitor.empty')}
        </div>
      ) : (
        groups.map((g) => <ChannelMonitorGroupCard key={g.group_key} group={g} t={t} />)
      )}
    </div>
  );
}

function ChannelMonitorGroupCard({
  group,
  t,
}: {
  group: ChannelMonitorGroup;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const nowMs = Date.now();
  const coolingCount = group.channels.filter(
    (channel) => channel.status === 1 && isChannelCoolingDown(channel, nowMs)
  ).length;

  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='min-w-0'>
            <CardTitle>{group.group_name}</CardTitle>
            {group.health_reason && <p className='mt-1 text-12 text-fg-2'>{group.health_reason}</p>}
            <div className='mt-2 flex flex-wrap gap-2 text-12 text-fg-2'>
              <span>
                {t('monitor.group.counts', {
                  normal: group.normal_count,
                  degraded: group.degraded_count,
                  abnormal: group.error_count,
                  defaultValue: '{{normal}} normal / {{degraded}} degraded / {{abnormal}} abnormal',
                })}
              </span>
            </div>
          </div>
          <div className='flex flex-wrap items-center justify-end gap-2'>
            {coolingCount > 0 ? (
              <Badge
                variant='outline'
                className='border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
              >
                {t('monitor.group.cooling', {
                  count: coolingCount,
                  defaultValue: '{{count}} cooling',
                })}
              </Badge>
            ) : null}
            <Badge variant={healthVariant(group.health_status)}>
              {t(`monitor.group.health.${group.health_status}`, {
                defaultValue: group.health_status,
              })}
            </Badge>
            <span className='text-12 text-fg-2 tabular-nums'>
              {(group.avg_availability_rate * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ChannelMonitorTable channels={group.channels} t={t} />
      </CardContent>
    </Card>
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
            <tr key={ch.channel_id} className='border-b border-line text-13 hover:bg-bg-1'>
              <td className='px-3 py-2'>
                <div className='font-mono text-12 text-fg-2'>#{ch.channel_id}</div>
                <div>{ch.name}</div>
                {ch.models ? (
                  <div className='max-w-[260px] truncate text-12 text-fg-2' title={ch.models}>
                    {ch.models}
                  </div>
                ) : null}
              </td>
              <td className='px-3 py-2'>{ch.group}</td>
              <td className='px-3 py-2'>
                <ChannelStabilityBadge channel={ch} />
              </td>
              <td className='px-3 py-2'>
                {ch.response_time_ms > 0 ? `${ch.response_time_ms} ms` : '-'}
              </td>
              <td className='px-3 py-2'>{(ch.availability_rate * 100).toFixed(1)}%</td>
              <td className='px-3 py-2'>{ch.balance !== 0 ? ch.balance.toFixed(2) : '-'}</td>
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
