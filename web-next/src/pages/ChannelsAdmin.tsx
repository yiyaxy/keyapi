import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ChannelFormDialog } from '@/components/channels/ChannelFormDialog';
import { ChannelsFilters, type ChannelsFilterState } from '@/components/channels/ChannelsFilters';
import { ChannelsTable } from '@/components/channels/ChannelsTable';
import { ChannelTestDialog } from '@/components/channels/ChannelTestDialog';
import { TenantMarkupCell } from '@/components/channels/TenantMarkupCell';
import { TenantMarkupEditDialog } from '@/components/channels/TenantMarkupEditDialog';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/useAuth';
import {
  useChannels,
  useDeleteChannel,
  usePlatformChannelMode,
  useSetPlatformChannelMode,
  useToggleChannelStatus,
  type Channel,
} from '@/hooks/useChannels';
import { PageAction } from '@/hooks/usePageAction';
import { usePlatformChannelUsage } from '@/hooks/usePlatformChannelUsage';
import { usePricing } from '@/hooks/usePricing';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { useTenantPlan, useTenantPlatformChannelMarkups } from '@/hooks/useTenantBilling';
import { fmtDisplay } from '@/lib/format';

const PAGE_SIZE = 50;

function PlatformPoolRemainingCard() {
  const { t } = useTranslation('channels');
  const cfg = usePublicConfig();
  const usage = usePlatformChannelUsage();

  if (usage.isPending) {
    return (
      <Card className='border-line bg-bg-1 shadow-none'>
        <CardHeader className='pb-2'>
          <CardTitle className='text-14 font-semibold tracking-tight text-fg-1'>
            {t('pool.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className='pt-0'>
          <Skeleton className='h-7 w-32' />
        </CardContent>
      </Card>
    );
  }

  if (usage.isError) {
    return null;
  }

  const rows = usage.data ?? [];
  if (rows.length === 0) {
    return null;
  }

  const unlimitedCount = rows.filter((row) => row.platform_quota_cap < 0).length;
  const boundedRows = rows.filter((row) => row.platform_quota_cap >= 0);
  const totalRemainingRaw = boundedRows.reduce(
    (acc, row) => acc + Math.max(0, row.platform_quota_cap - row.platform_quota_used),
    0
  );

  const hasUnlimited = unlimitedCount > 0;
  const totalLabel = hasUnlimited ? '∞' : fmtDisplay(totalRemainingRaw, cfg);

  return (
    <Card className='border-line bg-bg-1 shadow-none'>
      <CardHeader className='pb-2'>
        <CardTitle className='flex items-baseline justify-between gap-3 text-14 font-semibold tracking-tight text-fg-1'>
          <span>{t('pool.title')}</span>
          <span className='text-12 font-normal text-fg-2'>{t('pool.subtitle')}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className='flex flex-wrap items-baseline gap-x-6 gap-y-1 pt-0'>
        <div className='text-3xl font-semibold tabular-nums text-fg-0'>{totalLabel}</div>
        <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-12 text-fg-2'>
          <span>{t('pool.bounded_tenants', { count: boundedRows.length })}</span>
          {unlimitedCount > 0 ? (
            <span className='rounded-full bg-bg-0 px-2 py-0.5 text-fg-1'>
              {t('pool.unlimited_tenants', { count: unlimitedCount })}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function ChannelsAdminPage() {
  const { t } = useTranslation('channels');
  const { user } = useAuth();
  const isRoot = user !== null && Math.max(user.role, user.platform_role) >= 100;
  const tenantView = !isRoot;
  const [filters, setFilters] = useState<ChannelsFilterState>({
    status: 'all',
    type: -1,
  });
  const [page, setPage] = useState(1);
  // 默认折叠平台渠道列表，避免在租户视角下挤占视线；用 localStorage 记住选择。
  const [platformExpanded, setPlatformExpanded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('channels.platformExpanded') === '1';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('channels.platformExpanded', platformExpanded ? '1' : '0');
  }, [platformExpanded]);
  const [formTarget, setFormTarget] = useState<'new' | Channel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null);
  const [testTarget, setTestTarget] = useState<Channel | null>(null);
  const [markupTarget, setMarkupTarget] = useState<Channel | null>(null);

  const channels = useChannels({
    p: page,
    page_size: PAGE_SIZE,
    status: filters.status,
    type: filters.type,
    id_sort: false,
    tenantView,
  });
  const mode = usePlatformChannelMode(tenantView);
  const tenantPlan = useTenantPlan(tenantView);
  const tenantOverrides = useTenantPlatformChannelMarkups(tenantView);
  const pricing = usePricing();
  const setMode = useSetPlatformChannelMode();
  const toggle = useToggleChannelStatus();
  const del = useDeleteChannel();

  const items = channels.data?.items ?? [];
  const total = channels.data?.total ?? 0;
  const myChannels = useMemo(() => items.filter((item) => item.scope !== 'platform'), [items]);
  const platformChannels = useMemo(
    () => items.filter((item) => item.scope === 'platform'),
    [items]
  );
  const overridesMap = useMemo(
    () => new Map((tenantOverrides.data ?? []).map((row) => [row.channel_id, row] as const)),
    [tenantOverrides.data]
  );
  const pricingRows = pricing.data?.data ?? [];
  const groupRatios = pricing.data?.group_ratio ?? {};
  const planMarkup = tenantPlan.data?.platform_markup ?? 0;
  const currentMode = mode.data?.mode ?? 'private_priority';

  return (
    <div className='space-y-4'>
      <PageAction>
        <Button onClick={() => setFormTarget('new')}>{t('page.create')}</Button>
      </PageAction>

      {isRoot ? <PlatformPoolRemainingCard /> : null}

      {tenantView ? (
        <Card className='border-line bg-bg-1 shadow-none'>
          <CardHeader className='pb-3'>
            <CardTitle className='text-16 font-semibold tracking-tight'>
              {t('routing.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className='grid gap-3 pt-0 md:grid-cols-2 xl:grid-cols-4'>
            {[
              ['private_priority', t('routing.mode.private_priority')],
              ['platform_priority', t('routing.mode.platform_priority')],
              ['only_private', t('routing.mode.only_private')],
              ['only_platform', t('routing.mode.only_platform')],
            ].map(([value, label]) => (
              <button
                key={value}
                type='button'
                onClick={() =>
                  setMode.mutate(value, {
                    onError: (error) => toast.error((error as Error).message),
                  })
                }
                className={`rounded-md border px-4 py-3 text-left transition-colors ${
                  currentMode === value
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-fg-0'
                    : 'border-line bg-bg-0 text-fg-2 hover:text-fg-0'
                }`}
              >
                <div className='text-13 font-medium'>{label}</div>
                <div className='mt-1 text-12 text-fg-2'>{value}</div>
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <ChannelsFilters
        value={filters}
        onChange={(next) => {
          setFilters(next);
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
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className='h-10 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center'>
          <div className='text-15 font-medium text-fg-0'>{t('page.empty.title')}</div>
          <div className='mt-1 text-13 text-fg-2'>{t('page.empty.body')}</div>
        </div>
      ) : (
        <>
          {tenantView ? (
            <div className='space-y-5'>
              <Card className='border-line bg-bg-1 shadow-none'>
                <CardHeader className='pb-3'>
                  <CardTitle className='text-16 font-semibold tracking-tight'>
                    {t('section.my_channels')}
                  </CardTitle>
                </CardHeader>
                <CardContent className='pt-0'>
                  <ChannelsTable
                    items={myChannels}
                    testingId={null}
                    onEdit={(channel) => setFormTarget(channel)}
                    onDelete={(channel) => setDeleteTarget(channel)}
                    onToggle={(channel) =>
                      toggle.mutate(
                        {
                          id: channel.id,
                          nextStatus: channel.status === 1 ? 2 : 1,
                          tenantView: true,
                        },
                        { onError: (error) => toast.error((error as Error).message) }
                      )
                    }
                    onTest={(channel) => setTestTarget(channel)}
                    showScope
                  />
                </CardContent>
              </Card>

              <Card className='border-line bg-bg-1 shadow-none'>
                <button
                  type='button'
                  onClick={() => setPlatformExpanded((v) => !v)}
                  aria-expanded={platformExpanded}
                  className={`flex w-full items-center justify-between gap-3 rounded-md px-6 pt-6 text-left transition-colors hover:bg-bg-0/40 ${
                    platformExpanded ? 'pb-3' : 'pb-6'
                  }`}
                >
                  <div className='flex items-center gap-2'>
                    {platformExpanded ? (
                      <ChevronDown className='h-4 w-4 text-fg-2' />
                    ) : (
                      <ChevronRight className='h-4 w-4 text-fg-2' />
                    )}
                    <CardTitle className='text-16 font-semibold tracking-tight'>
                      {t('section.platform_channels')}
                    </CardTitle>
                    <Badge variant='outline' className='text-11'>
                      {platformChannels.length}
                    </Badge>
                  </div>
                  {!platformExpanded && platformChannels.length > 0 ? (
                    <span className='text-12 text-fg-2'>
                      {t('section.platform_channels_collapsed_hint', {
                        count: platformChannels.length,
                      })}
                    </span>
                  ) : null}
                </button>
                <CardContent
                  className={`space-y-3 pt-0 ${platformExpanded ? '' : 'hidden'}`}
                >
                  {tenantOverrides.isError && (
                    <InlineBanner
                      level='warn'
                      message={t('platform_row.override_load_failed')}
                      onClose={() => void tenantOverrides.refetch()}
                    />
                  )}
                  {platformChannels.map((channel) => (
                    <div
                      key={channel.id}
                      className={`flex items-start justify-between gap-4 rounded-md border px-4 py-3 ${
                        channel.tenant_disabled
                          ? 'border-line bg-bg-0 opacity-60'
                          : 'border-line bg-bg-0'
                      }`}
                    >
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-2'>
                          <div className='font-medium text-fg-0'>{channel.name}</div>
                          <span className='text-12 text-fg-2'>{channel.models}</span>
                          {channel.tenant_channel_locked && (
                            <Badge variant='outline' className='text-11'>
                              {t('platform_row.admin_locked')}
                            </Badge>
                          )}
                        </div>
                        <div className='mt-1 text-12 text-fg-2'>
                          {channel.group} ·{' '}
                          {channel.markup_ratio
                            ? t('platform_row.markup_x', { n: channel.markup_ratio.toFixed(2) })
                            : t('platform_row.plan_markup')}
                        </div>
                        <div className='mt-3 space-y-1'>
                          <div className='text-12 font-medium text-fg-2'>
                            {t('platform_row.my_markup')}
                          </div>
                          <TenantMarkupCell
                            channel={channel}
                            override={overridesMap.get(channel.id)}
                            planMarkup={planMarkup}
                            pricingRows={pricingRows}
                            groupRatios={groupRatios}
                            groupRatioError={pricing.isError}
                            onEdit={() => setMarkupTarget(channel)}
                          />
                        </div>
                      </div>

                      <div className='flex items-center gap-3'>
                        <span className='text-12 text-fg-2'>
                          {channel.tenant_channel_locked
                            ? t('platform_row.admin_locked_hint')
                            : channel.tenant_disabled
                              ? t('platform_row.disabled_for_tenant')
                              : t('platform_row.enabled')}
                        </span>
                        <Switch
                          checked={!channel.tenant_disabled}
                          disabled={!!channel.tenant_channel_locked}
                          onCheckedChange={(checked) =>
                            toggle.mutate(
                              {
                                id: channel.id,
                                nextStatus: checked ? 1 : 2,
                                tenantView: true,
                                platformToggle: true,
                              },
                              { onError: (error) => toast.error((error as Error).message) }
                            )
                          }
                        />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          ) : (
            <ChannelsTable
              items={items}
              testingId={null}
              onEdit={(channel) => setFormTarget(channel)}
              onDelete={(channel) => setDeleteTarget(channel)}
              onToggle={(channel) =>
                toggle.mutate(
                  { id: channel.id, nextStatus: channel.status === 1 ? 2 : 1 },
                  { onError: (error) => toast.error((error as Error).message) }
                )
              }
              onTest={(channel) => setTestTarget(channel)}
              showScope
              showMarkup={isRoot}
            />
          )}

          <LogsPagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </>
      )}

      <ChannelFormDialog
        open={formTarget !== null}
        channel={formTarget === 'new' || formTarget === null ? null : formTarget}
        onOpenChange={(next) => !next && setFormTarget(null)}
      />

      <TenantMarkupEditDialog
        open={markupTarget !== null}
        channel={markupTarget}
        override={markupTarget ? overridesMap.get(markupTarget.id) : undefined}
        planMarkup={planMarkup}
        pricingRows={pricingRows}
        groupRatios={groupRatios}
        pricingPending={pricing.isPending}
        pricingError={pricing.isError}
        onOpenChange={(next) => !next && setMarkupTarget(null)}
      />

      {deleteTarget && (
        <ConfirmDialog
          open
          title={t('delete.title')}
          body={t('delete.body', { name: deleteTarget.name })}
          confirmLabel={t('delete.confirm')}
          isPending={del.isPending}
          onOpenChange={(next) => !next && setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            del.mutate(
              { id: target.id, tenantView },
              {
                onSuccess: () => toast.success(t('delete.success', { defaultValue: 'Deleted' })),
                onError: (error) => toast.error((error as Error).message),
              }
            );
          }}
        />
      )}

      <ChannelTestDialog
        channel={testTarget}
        onOpenChange={(next) => {
          if (!next) setTestTarget(null);
        }}
        onAfterTest={() => void channels.refetch()}
      />
    </div>
  );
}
