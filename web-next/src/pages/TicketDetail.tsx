import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useReplyTicket, useTicketDetail, type TicketReply } from '@/hooks/useTickets';
import { fmtDateSec } from '@/lib/format';

function statusMeta(status: string): {
  key: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
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

export function TicketDetailPage() {
  const { t } = useTranslation('tickets');
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const detail = useTicketDetail(Number.isFinite(id) ? id : null);
  const reply = useReplyTicket(id);
  const [draft, setDraft] = useState('');

  if (detail.isPending) {
    return <Skeleton className='h-96 w-full' />;
  }
  if (detail.isError || !detail.data) {
    return (
      <div className='space-y-4'>
        <InlineBanner
          level='danger'
          message={t('detail.not_found')}
          onClose={() => void detail.refetch()}
        />
        <Link to='/tickets' className='text-13 text-fg-2 hover:underline'>
          {t('detail.back')}
        </Link>
      </div>
    );
  }

  const { ticket, replies } = detail.data;
  const meta = statusMeta(ticket.status);
  const isClosed = ticket.status === 'closed';

  async function onReply() {
    const text = draft.trim();
    if (!text) return;
    try {
      await reply.mutateAsync(text);
      toast.success(t('detail.reply.success'));
      setDraft('');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className='space-y-4'>
      <Link to='/tickets' className='text-13 text-fg-2 hover:underline'>
        {t('detail.back')}
      </Link>
      <Card>
        <CardHeader>
          <div className='flex items-center justify-between'>
            <CardTitle>{ticket.subject}</CardTitle>
            <Badge variant={meta.variant}>{t(meta.key)}</Badge>
          </div>
          <div className='text-12 text-fg-2'>
            #{ticket.id} · {fmtDateSec(ticket.created_at)}
          </div>
        </CardHeader>
        <CardContent>
          <ul className='space-y-4'>
            {replies.map((r) => (
              <ReplyBlock key={r.id} reply={r} t={t} />
            ))}
          </ul>
        </CardContent>
      </Card>
      {isClosed ? (
        <div className='rounded-md border border-line bg-bg-1 p-4 text-13 text-fg-2'>
          {t('detail.closed.body')}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('detail.reply.title')}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <Textarea
              rows={5}
              value={draft}
              placeholder={t('detail.reply.placeholder')}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className='flex justify-end'>
              <Button onClick={() => void onReply()} disabled={reply.isPending || !draft.trim()}>
                {t('detail.reply.submit')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ReplyBlock({ reply, t }: { reply: TicketReply; t: (k: string) => string }) {
  const isUser = reply.role === 'user';
  return (
    <li className={'rounded-md border border-line p-3 ' + (isUser ? 'bg-bg-0' : 'bg-bg-1')}>
      <div className='mb-2 flex items-center justify-between'>
        <div className='text-12 font-medium text-fg-1'>
          {t(isUser ? 'detail.role.user' : 'detail.role.admin')}
        </div>
        <div className='text-12 text-fg-2 tabular-nums'>{fmtDateSec(reply.created_at)}</div>
      </div>
      <div className='whitespace-pre-wrap text-13 leading-6 text-fg-0'>{reply.content}</div>
    </li>
  );
}
