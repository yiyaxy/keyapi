import { useState } from 'react';
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
import { PageAction } from '@/hooks/usePageAction';
import {
  useChannels,
  useDeleteChannel,
  useToggleChannelStatus,
  type Channel,
} from '@/hooks/useChannels';

const PAGE_SIZE = 50;

export function PlatformChannelsAdminPage() {
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
          <Badge variant='secondary'>平台</Badge>
          <span className='text-12 text-fg-2'>共享路由池</span>
          <Button size='sm' onClick={() => setFormTarget('new')}>
            新建平台渠道
          </Button>
        </div>
      </PageAction>

      <Card className='border-line bg-bg-1 shadow-none'>
        <CardHeader className='pb-3'>
          <CardTitle className='text-18 font-semibold tracking-tight'>平台渠道</CardTitle>
        </CardHeader>
        <CardContent className='grid gap-3 pt-0 md:grid-cols-3'>
          <div className='rounded-md border border-line bg-bg-0 px-4 py-3'>
            <div className='text-12 uppercase tracking-[0.12em] text-fg-2'>总数</div>
            <div className='mt-2 text-3xl font-semibold tabular-nums text-fg-0'>{total}</div>
          </div>
          <div className='rounded-md border border-line bg-bg-0 px-4 py-3'>
            <div className='text-12 uppercase tracking-[0.12em] text-fg-2'>启用中</div>
            <div className='mt-2 text-3xl font-semibold tabular-nums text-fg-0'>{active}</div>
          </div>
          <div className='rounded-md border border-line bg-bg-0 px-4 py-3'>
            <div className='text-12 uppercase tracking-[0.12em] text-fg-2'>加价</div>
            <div className='mt-2 text-sm text-fg-1'>按渠道覆盖，未设置则走租户计划</div>
          </div>
        </CardContent>
      </Card>

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
            加载更多
          </Button>
        </div>
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
          title='删除平台渠道'
          body={`确定删除 "${deleteTarget.name}" 吗？此操作不可撤销。`}
          confirmLabel='删除'
          isPending={del.isPending}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            del.mutate(
              { id: target.id },
              {
                onSuccess: () => toast.success('已删除'),
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
