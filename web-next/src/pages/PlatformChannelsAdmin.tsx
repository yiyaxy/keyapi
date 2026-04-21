import { useState } from 'react';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ChannelsFilters, type ChannelsFilterState } from '@/components/channels/ChannelsFilters';
import { ChannelsTable } from '@/components/channels/ChannelsTable';
import { PageAction } from '@/hooks/usePageAction';
import { useChannels, type Channel } from '@/hooks/useChannels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const PAGE_SIZE = 50;

export function PlatformChannelsAdminPage() {
  const [filters, setFilters] = useState<ChannelsFilterState>({
    status: 'all',
    type: -1,
  });
  const [page, setPage] = useState(1);

  const channels = useChannels({
    p: page,
    page_size: PAGE_SIZE,
    status: filters.status,
    type: filters.type,
    id_sort: false,
    scope: 'platform',
  });

  const items = channels.data?.items ?? [];
  const total = channels.data?.total ?? 0;
  const active = items.filter((item) => item.status === 1).length;

  return (
    <div className='space-y-5'>
      <PageAction>
        <div className='flex items-center gap-2'>
          <Badge variant='secondary'>platform</Badge>
          <span className='text-12 text-fg-2'>shared routing inventory</span>
        </div>
      </PageAction>

      <Card className='border-line bg-bg-1 shadow-none'>
        <CardHeader className='pb-3'>
          <CardTitle className='text-18 font-semibold tracking-tight'>Platform channels</CardTitle>
        </CardHeader>
        <CardContent className='grid gap-3 pt-0 md:grid-cols-3'>
          <div className='rounded-md border border-line bg-bg-0 px-4 py-3'>
            <div className='text-12 uppercase tracking-[0.12em] text-fg-2'>Total</div>
            <div className='mt-2 text-3xl font-semibold tabular-nums text-fg-0'>{total}</div>
          </div>
          <div className='rounded-md border border-line bg-bg-0 px-4 py-3'>
            <div className='text-12 uppercase tracking-[0.12em] text-fg-2'>Enabled</div>
            <div className='mt-2 text-3xl font-semibold tabular-nums text-fg-0'>{active}</div>
          </div>
          <div className='rounded-md border border-line bg-bg-0 px-4 py-3'>
            <div className='text-12 uppercase tracking-[0.12em] text-fg-2'>Markup</div>
            <div className='mt-2 text-sm text-fg-1'>channel-level override or tenant plan fallback</div>
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
          onEdit={() => undefined}
          onDelete={() => undefined}
          onToggle={() => undefined}
          onTest={() => undefined}
          readOnly
          showScope
          showMarkup
        />
      )}

      {total > PAGE_SIZE && (
        <div className='flex justify-end'>
          <Button variant='secondary' size='sm' onClick={() => setPage((p) => p + 1)}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
