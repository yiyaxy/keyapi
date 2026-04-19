import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useInbox, useInboxMessage, type InboxMessage } from '@/hooks/useInbox';
import { fmtDateSec } from '@/lib/format';

const PAGE_SIZE = 30;

export function InboxPage() {
  const { t } = useTranslation('inbox');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);

  const inbox = useInbox({ p: page, page_size: PAGE_SIZE });
  const detail = useInboxMessage(openId);

  const items = inbox.data?.items ?? [];
  const total = inbox.data?.total ?? 0;

  return (
    <div className='space-y-4'>
      {inbox.isError && (
        <InlineBanner
          level='danger'
          message={String((inbox.error as Error).message)}
          onClose={() => void inbox.refetch()}
        />
      )}
      {inbox.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 8 }).map((_, i) => (
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
          <div className='overflow-hidden rounded-md border border-line'>
            <ul className='divide-y divide-line'>
              {items.map((m) => (
                <InboxRow key={m.id} message={m} onOpen={setOpenId} t={t} />
              ))}
            </ul>
          </div>
          <LogsPagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </>
      )}
      <Dialog open={openId !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className='max-w-[600px]'>
          <DialogHeader>
            <DialogTitle>{detail.data?.title ?? ''}</DialogTitle>
          </DialogHeader>
          {detail.isPending && <Skeleton className='h-32 w-full' />}
          {detail.data && (
            <div className='max-h-[60vh] overflow-y-auto'>
              <div className='text-12 text-fg-2'>
                {t('detail.sender.system')} · {fmtDateSec(detail.data.created_at)}
              </div>
              <div
                className='mt-3 whitespace-pre-wrap text-13 leading-6 text-fg-0'
                // message content is plain text from backend
              >
                {detail.data.content}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InboxRow({
  message,
  onOpen,
  t,
}: {
  message: InboxMessage;
  onOpen: (id: number) => void;
  t: (k: string) => string;
}) {
  return (
    <li>
      <button
        type='button'
        onClick={() => onOpen(message.id)}
        className='flex w-full items-center gap-3 px-4 py-3 text-left text-13 hover:bg-bg-1'
      >
        <div className='w-16 shrink-0'>
          {!message.is_read && <Badge variant='default'>{t('list.badge.new')}</Badge>}
        </div>
        <div className='flex-1 truncate'>
          <div className={message.is_read ? 'text-fg-1' : 'font-medium text-fg-0'}>
            {message.title}
          </div>
        </div>
        <div className='shrink-0 text-12 text-fg-2 tabular-nums'>
          {fmtDateSec(message.created_at)}
        </div>
      </button>
    </li>
  );
}
