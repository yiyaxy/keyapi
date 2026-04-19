import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ChannelFormDialog } from '@/components/channels/ChannelFormDialog';
import {
  ChannelsFilters,
  type ChannelsFilterState,
} from '@/components/channels/ChannelsFilters';
import { ChannelsTable } from '@/components/channels/ChannelsTable';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageAction } from '@/hooks/usePageAction';
import {
  useChannels,
  useDeleteChannel,
  useTestChannel,
  useToggleChannelStatus,
  type Channel,
} from '@/hooks/useChannels';

const PAGE_SIZE = 50;

export function ChannelsAdminPage() {
  const { t } = useTranslation('channels');
  const [filters, setFilters] = useState<ChannelsFilterState>({
    status: 'all',
    type: -1,
  });
  const [page, setPage] = useState(1);
  const [formTarget, setFormTarget] = useState<'new' | Channel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);

  const channels = useChannels({
    p: page,
    page_size: PAGE_SIZE,
    status: filters.status,
    type: filters.type,
    id_sort: false,
  });
  const toggle = useToggleChannelStatus();
  const del = useDeleteChannel();
  const test = useTestChannel();

  const items = channels.data?.items ?? [];
  const total = channels.data?.total ?? 0;

  return (
    <div className='space-y-4'>
      <PageAction>
        <Button onClick={() => setFormTarget('new')}>{t('page.create')}</Button>
      </PageAction>
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
          <ChannelsTable
            items={items}
            testingId={testingId}
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
            onTest={(c) => {
              setTestingId(c.id);
              test.mutate(c.id, {
                onSettled: () => setTestingId(null),
                onSuccess: (r) =>
                  toast.success(t('test.ok', { latency: r.response_time })),
                onError: (e) =>
                  toast.error(t('test.fail', { message: (e as Error).message })),
              });
            }}
          />
          <LogsPagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onChange={setPage}
          />
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
            del.mutate(target.id, {
              onSuccess: () => toast.success(t('delete.confirm') + ' ✓'),
              onError: (err) => toast.error((err as Error).message),
            });
          }}
        />
      )}
    </div>
  );
}
