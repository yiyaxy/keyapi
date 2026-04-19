import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { NewTicketDialog } from '@/components/tickets/NewTicketDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageAction } from '@/hooks/usePageAction';
import { useTickets, type Ticket } from '@/hooks/useTickets';
import { fmtDateSec } from '@/lib/format';

const PAGE_SIZE = 30;

type StatusMeta = {
  key: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
};

function statusMeta(status: string): StatusMeta {
  switch (status) {
    case 'open':
      return { key: 'status.open', variant: 'default' };
    case 'pending':
      return { key: 'status.pending', variant: 'secondary' };
    case 'replied':
      return { key: 'status.replied', variant: 'outline' };
    case 'closed':
      return { key: 'status.closed', variant: 'destructive' };
    default:
      return { key: 'status.open', variant: 'outline' };
  }
}

export function TicketsPage() {
  const { t } = useTranslation('tickets');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const tickets = useTickets({ p: page, page_size: PAGE_SIZE });

  const items: Ticket[] = tickets.data?.items ?? [];
  const total = tickets.data?.total ?? 0;

  return (
    <div className='space-y-4'>
      <PageAction>
        <Button onClick={() => setCreateOpen(true)}>{t('page.create')}</Button>
      </PageAction>
      {tickets.isError && (
        <InlineBanner
          level='danger'
          message={String((tickets.error as Error).message)}
          onClose={() => void tickets.refetch()}
        />
      )}
      {tickets.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className='h-12 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center'>
          <div className='text-15 font-medium text-fg-0'>{t('page.empty.title')}</div>
          <div className='mt-1 text-13 text-fg-2'>{t('page.empty.body')}</div>
        </div>
      ) : (
        <>
          <div className='overflow-x-auto rounded-md border border-line'>
            <table className='w-full border-collapse tabular-nums'>
              <thead>
                <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                  <th className='px-3 py-2 font-medium'>{t('table.col.id')}</th>
                  <th className='px-3 py-2 font-medium'>{t('table.col.subject')}</th>
                  <th className='px-3 py-2 font-medium'>{t('table.col.status')}</th>
                  <th className='px-3 py-2 font-medium'>{t('table.col.last_reply')}</th>
                  <th className='px-3 py-2 font-medium'>{t('table.col.created')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((tkt) => {
                  const meta = statusMeta(tkt.status);
                  return (
                    <tr key={tkt.id} className='border-b border-line text-13 hover:bg-bg-1'>
                      <td className='px-3 py-2 text-fg-2'>{tkt.id}</td>
                      <td className='px-3 py-2'>
                        <Link to={`/tickets/${tkt.id}`} className='text-fg-0 hover:underline'>
                          {tkt.subject}
                        </Link>
                      </td>
                      <td className='px-3 py-2'>
                        <Badge variant={meta.variant}>{t(meta.key)}</Badge>
                      </td>
                      <td className='px-3 py-2 text-fg-1'>
                        {tkt.last_reply_at > 0 ? fmtDateSec(tkt.last_reply_at) : '—'}
                      </td>
                      <td className='px-3 py-2 text-fg-1'>{fmtDateSec(tkt.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <LogsPagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </>
      )}
      <NewTicketDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
