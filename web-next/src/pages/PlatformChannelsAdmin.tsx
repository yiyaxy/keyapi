import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ChannelFormDialog } from '@/components/channels/ChannelFormDialog';
import { ChannelsFilters, type ChannelsFilterState } from '@/components/channels/ChannelsFilters';
import { ChannelsTable } from '@/components/channels/ChannelsTable';
import { ChannelTestDialog } from '@/components/channels/ChannelTestDialog';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useChannels, useDeleteChannel, useToggleChannelStatus, type Channel } from '@/hooks/useChannels';
import {
  usePlatformChannelUsage,
  useResetPlatformChannelUsage,
  type PlatformChannelUsageRow,
} from '@/hooks/usePlatformChannelUsage';
import { PageAction } from '@/hooks/usePageAction';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { fmtDateSec, fmtDisplay } from '@/lib/format';

const PAGE_SIZE = 50;

function periodLabel(
  t: (key: string) => string,
  period: PlatformChannelUsageRow['platform_quota_period']
): string {
  switch (period) {
    case 'daily':
      return t('plan.option.period_daily');
    case 'monthly':
      return t('plan.option.period_monthly');
    default:
      return t('plan.option.period_none');
  }
}

function TenantUsagePanel() {
  const { t } = useTranslation('platform');
  const cfg = usePublicConfig();
  const usage = usePlatformChannelUsage();
  const reset = useResetPlatformChannelUsage();

  if (usage.isPending) {
    return <div className='p-4 text-13 text-fg-2'>{t('platform_channels.usage.loading')}</div>;
  }

  if (usage.isError) {
    return (
      <InlineBanner
        level='danger'
        message={String((usage.error as Error).message)}
        onClose={() => void usage.refetch()}
      />
    );
  }

  const rows = usage.data ?? [];
  if (rows.length === 0) {
    return (
      <div className='rounded-md border border-line bg-bg-1 p-6 text-13 text-fg-2'>
        {t('platform_channels.usage.empty')}
      </div>
    );
  }

  return (
    <div className='overflow-x-auto rounded-md border border-line'>
      <table className='w-full border-collapse text-13'>
        <thead>
          <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
            <th className='px-3 py-2 font-medium'>{t('platform_channels.usage.col.tenant')}</th>
            <th className='px-3 py-2 font-medium'>{t('platform_channels.usage.col.plan')}</th>
            <th className='px-3 py-2 text-right font-medium'>
              {t('platform_channels.usage.col.used')}
            </th>
            <th className='px-3 py-2 text-right font-medium'>
              {t('platform_channels.usage.col.cap')}
            </th>
            <th className='px-3 py-2 font-medium'>{t('platform_channels.usage.col.period')}</th>
            <th className='px-3 py-2 text-right font-medium'>
              {t('platform_channels.usage.col.progress')}
            </th>
            <th className='px-3 py-2 text-right font-medium'>
              {t('platform_channels.usage.col.action')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const pct =
              row.platform_quota_cap > 0
                ? Math.min(100, Math.round((row.platform_quota_used / row.platform_quota_cap) * 100))
                : null;
            return (
              <tr key={row.tenant_id} className='border-b border-line text-13 hover:bg-bg-1'>
                <td className='px-3 py-3'>{row.tenant_name || `#${row.tenant_id}`}</td>
                <td className='px-3 py-3'>{row.plan_name}</td>
                <td className='px-3 py-3 text-right tabular-nums'>
                  {fmtDisplay(row.platform_quota_used, cfg)}
                </td>
                <td className='px-3 py-3 text-right tabular-nums'>
                  {row.platform_quota_cap < 0
                    ? t('platform_channels.usage.value.unlimited')
                    : fmtDisplay(row.platform_quota_cap, cfg)}
                </td>
                <td className='px-3 py-3'>
                  <div>{periodLabel(t, row.platform_quota_period)}</div>
                  <div className='text-12 text-fg-2'>
                    {t('platform_channels.usage.period_start', {
                      value: fmtDateSec(row.period_start),
                    })}
                  </div>
                </td>
                <td className='px-3 py-3'>
                  <div className='flex items-center justify-end gap-2'>
                    <div className='h-2 w-24 overflow-hidden rounded-full bg-bg-0'>
                      <div
                        className='h-full bg-fg-0 transition-[width]'
                        style={{ width: `${pct ?? 0}%` }}
                      />
                    </div>
                    <span className='tabular-nums text-fg-2'>
                      {pct === null
                        ? t('platform_channels.usage.value.not_applicable')
                        : `${pct}%`}
                    </span>
                  </div>
                </td>
                <td className='px-3 py-3 text-right'>
                  <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    disabled={reset.isPending}
                    onClick={() =>
                      reset.mutate(row.tenant_id, {
                        onSuccess: () => toast.success(t('platform_channels.usage.action.reset_ok')),
                        onError: (err) => toast.error((err as Error).message),
                      })
                    }
                  >
                    {t('platform_channels.usage.action.reset')}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PlatformChannelsAdminPage() {
  const { t } = useTranslation('platform');
  const [activeTab, setActiveTab] = useState<'channels' | 'tenant_usage'>('channels');
  const [filters, setFilters] = useState<ChannelsFilterState>({
    status: 'all',
    type: -1,
  });
  const [page, setPage] = useState(1);
  const [formTarget, setFormTarget] = useState<'new' | Channel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null);
  const [testTarget, setTestTarget] = useState<Channel | null>(null);

  const channels = useChannels({
    p: page,
    page_size: PAGE_SIZE,
    status: filters.status,
    type: filters.type,
    id_sort: false,
    scope: 'platform',
  });
  const toggle = useToggleChannelStatus();
  const del = useDeleteChannel();

  const items = channels.data?.items ?? [];
  const total = channels.data?.total ?? 0;
  const active = items.filter((item) => item.status === 1).length;

  return (
    <div className='space-y-5'>
      <PageAction>
        <div className='flex items-center gap-2'>
          <Badge variant='secondary'>{t('platform_channels.badge')}</Badge>
          <span className='text-12 text-fg-2'>{t('platform_channels.shared_pool')}</span>
          <Button size='sm' onClick={() => setFormTarget('new')}>
            {t('platform_channels.new')}
          </Button>
        </div>
      </PageAction>

      <Card className='border-line bg-bg-1 shadow-none'>
        <CardHeader className='pb-3'>
          <CardTitle className='text-18 font-semibold tracking-tight'>
            {t('platform_channels.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className='grid gap-3 pt-0 md:grid-cols-3'>
          <div className='rounded-md border border-line bg-bg-0 px-4 py-3'>
            <div className='text-12 uppercase tracking-[0.12em] text-fg-2'>
              {t('platform_channels.summary.total')}
            </div>
            <div className='mt-2 text-3xl font-semibold tabular-nums text-fg-0'>{total}</div>
          </div>
          <div className='rounded-md border border-line bg-bg-0 px-4 py-3'>
            <div className='text-12 uppercase tracking-[0.12em] text-fg-2'>
              {t('platform_channels.summary.active')}
            </div>
            <div className='mt-2 text-3xl font-semibold tabular-nums text-fg-0'>{active}</div>
          </div>
          <div className='rounded-md border border-line bg-bg-0 px-4 py-3'>
            <div className='text-12 uppercase tracking-[0.12em] text-fg-2'>
              {t('platform_channels.summary.markup')}
            </div>
            <div className='mt-2 text-sm text-fg-1'>
              {t('platform_channels.summary.markup_hint')}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className='flex items-center gap-2'>
        <Button
          type='button'
          variant={activeTab === 'channels' ? 'default' : 'secondary'}
          onClick={() => setActiveTab('channels')}
        >
          {t('platform_channels.tab.channels')}
        </Button>
        <Button
          type='button'
          variant={activeTab === 'tenant_usage' ? 'default' : 'secondary'}
          onClick={() => setActiveTab('tenant_usage')}
        >
          {t('platform_channels.tab.tenant_usage')}
        </Button>
      </div>

      {activeTab === 'channels' ? (
        <>
          <ChannelsFilters
            value={filters}
            onChange={(v) => {
              setFilters(v);
              setPage(1);
            }}
          />

          {channels.isError && (
            <InlineBanner
              level='danger'
              message={String((channels.error as Error).message)}
              onClose={() => void channels.refetch()}
            />
          )}

          {channels.isPending ? (
            <div className='space-y-2'>
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className='h-10 w-full' />
              ))}
            </div>
          ) : (
            <ChannelsTable
              items={items as Channel[]}
              testingId={null}
              onEdit={(c) => setFormTarget(c)}
              onDelete={(c) => setDeleteTarget(c)}
              onToggle={(c) =>
                toggle.mutate(
                  { id: c.id, nextStatus: c.status === 1 ? 2 : 1 },
                  { onError: (e) => toast.error((e as Error).message) }
                )
              }
              onTest={(c) => setTestTarget(c)}
              showScope
              showMarkup
            />
          )}

          {total > PAGE_SIZE && (
            <div className='flex justify-end'>
              <Button variant='secondary' size='sm' onClick={() => setPage((p) => p + 1)}>
                {t('platform_channels.more')}
              </Button>
            </div>
          )}
        </>
      ) : (
        <TenantUsagePanel />
      )}

      <ChannelFormDialog
        open={formTarget !== null}
        channel={formTarget === 'new' || formTarget === null ? null : formTarget}
        onOpenChange={(o) => !o && setFormTarget(null)}
        forceScope='platform'
      />

      {deleteTarget && (
        <ConfirmDialog
          open
          title={t('platform_channels.delete.title')}
          body={t('platform_channels.delete.body', { name: deleteTarget.name })}
          confirmLabel={t('platform_channels.delete.confirm')}
          isPending={del.isPending}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            del.mutate(
              { id: target.id },
              {
                onSuccess: () => toast.success(t('platform_channels.delete.success')),
                onError: (err) => toast.error((err as Error).message),
              }
            );
          }}
        />
      )}

      <ChannelTestDialog
        channel={testTarget}
        onOpenChange={(o) => {
          if (!o) setTestTarget(null);
        }}
        onAfterTest={() => void channels.refetch()}
      />
    </div>
  );
}
