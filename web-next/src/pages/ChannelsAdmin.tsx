import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ChannelFormDialog } from '@/components/channels/ChannelFormDialog';
import { ChannelsFilters, type ChannelsFilterState } from '@/components/channels/ChannelsFilters';
import { ChannelsTable } from '@/components/channels/ChannelsTable';
import { ChannelTestDialog } from '@/components/channels/ChannelTestDialog';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { PageAction } from '@/hooks/usePageAction';
import {
  useChannels,
  useDeleteChannel,
  usePlatformChannelMode,
  useSetPlatformChannelMode,
  useToggleChannelStatus,
  type Channel,
} from '@/hooks/useChannels';
import { useAuth } from '@/hooks/useAuth';

const PAGE_SIZE = 50;

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
  const [formTarget, setFormTarget] = useState<'new' | Channel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null);
  const [testTarget, setTestTarget] = useState<Channel | null>(null);

  const channels = useChannels({
    p: page,
    page_size: PAGE_SIZE,
    status: filters.status,
    type: filters.type,
    id_sort: false,
    tenantView,
  });
  const mode = usePlatformChannelMode(tenantView);
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
  const currentMode = mode.data?.mode ?? 'private_priority';

  return (
    <div className='space-y-4'>
      <PageAction>
        <Button onClick={() => setFormTarget('new')}>{t('page.create')}</Button>
      </PageAction>

      {tenantView ? (
        <Card className='border-line bg-bg-1 shadow-none'>
          <CardHeader className='pb-3'>
            <CardTitle className='text-16 font-semibold tracking-tight'>Routing mode</CardTitle>
          </CardHeader>
          <CardContent className='grid gap-3 pt-0 md:grid-cols-2 xl:grid-cols-4'>
            {[
              ['private_priority', 'Private priority'],
              ['platform_priority', 'Platform priority'],
              ['only_private', 'Only private'],
              ['only_platform', 'Only platform'],
            ].map(([value, label]) => (
              <button
                key={value}
                type='button'
                onClick={() =>
                  setMode.mutate(value, {
                    onError: (e) => toast.error((e as Error).message),
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
                    My channels
                  </CardTitle>
                </CardHeader>
                <CardContent className='pt-0'>
                  <ChannelsTable
                    items={myChannels}
                    testingId={null}
                    onEdit={(c) => setFormTarget(c)}
                    onDelete={(c) => setDeleteTarget(c)}
                    onToggle={(c) =>
                      toggle.mutate(
                        { id: c.id, nextStatus: c.status === 1 ? 2 : 1, tenantView: true },
                        { onError: (e) => toast.error((e as Error).message) }
                      )
                    }
                    onTest={(c) => setTestTarget(c)}
                    showScope
                  />
                </CardContent>
              </Card>

              <Card className='border-line bg-bg-1 shadow-none'>
                <CardHeader className='pb-3'>
                  <CardTitle className='text-16 font-semibold tracking-tight'>
                    Platform channels
                  </CardTitle>
                </CardHeader>
                <CardContent className='space-y-3 pt-0'>
                  {platformChannels.map((channel) => (
                    <div
                      key={channel.id}
                      className={`flex items-center justify-between rounded-md border px-4 py-3 ${
                        channel.tenant_disabled
                          ? 'border-line bg-bg-0 opacity-60'
                          : 'border-line bg-bg-0'
                      }`}
                    >
                      <div className='min-w-0'>
                        <div className='flex items-center gap-2'>
                          <div className='font-medium text-fg-0'>{channel.name}</div>
                          <span className='text-12 text-fg-2'>{channel.models}</span>
                        </div>
                        <div className='mt-1 text-12 text-fg-2'>
                          {channel.group} ·{' '}
                          {channel.markup_ratio
                            ? `${channel.markup_ratio.toFixed(2)}x markup`
                            : 'plan markup'}
                        </div>
                      </div>
                      <div className='flex items-center gap-3'>
                        <span className='text-12 text-fg-2'>
                          {channel.tenant_disabled ? 'disabled for this tenant' : 'enabled'}
                        </span>
                        <Switch
                          checked={!channel.tenant_disabled}
                          onCheckedChange={(checked) =>
                            toggle.mutate(
                              {
                                id: channel.id,
                                nextStatus: checked ? 1 : 2,
                                tenantView: true,
                                platformToggle: true,
                              },
                              { onError: (e) => toast.error((e as Error).message) }
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
              onEdit={(c) => setFormTarget(c)}
              onDelete={(c) => setDeleteTarget(c)}
              onToggle={(c) =>
                toggle.mutate(
                  { id: c.id, nextStatus: c.status === 1 ? 2 : 1 },
                  {
                    onError: (e) => toast.error((e as Error).message),
                  }
                )
              }
              onTest={(c) => setTestTarget(c)}
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
        onOpenChange={(o) => !o && setFormTarget(null)}
      />
      {deleteTarget && (
        <ConfirmDialog
          open
          title={t('delete.title')}
          body={t('delete.body', { name: deleteTarget.name })}
          confirmLabel={t('delete.confirm')}
          isPending={del.isPending}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            del.mutate(
              { id: target.id, tenantView },
              {
                onSuccess: () => toast.success(t('delete.confirm') + ' ✓'),
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
