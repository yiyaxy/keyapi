import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ReplyAttachments } from '@/components/tickets/ReplyAttachments';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  useAdminReplyTicket,
  useAdminTicketDetail,
  useAdminUpdateTicketStatus,
  type TicketAttachment,
  type TicketReply,
} from '@/hooks/useTickets';
import { fmtDateSec } from '@/lib/format';

function statusMeta(status: string): {
  key: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
  switch (status) {
    case 'open':
      return { key: 'status.open', variant: 'default' };
    case 'processing':
      return { key: 'status.processing', variant: 'secondary' };
    case 'closed':
      return { key: 'status.closed', variant: 'destructive' };
    default:
      return { key: 'status.open', variant: 'outline' };
  }
}

type StatusAction = { target: 'open' | 'processing' | 'closed'; labelKey: string };

function statusActions(current: string): StatusAction[] {
  switch (current) {
    case 'open':
      return [
        { target: 'processing', labelKey: 'admin.action.start_processing' },
        { target: 'closed', labelKey: 'admin.action.close' },
      ];
    case 'processing':
      return [
        { target: 'open', labelKey: 'admin.action.back_to_open' },
        { target: 'closed', labelKey: 'admin.action.close' },
      ];
    case 'closed':
      return [{ target: 'open', labelKey: 'admin.action.reopen' }];
    default:
      return [];
  }
}

export function TicketAdminDetailPage() {
  const { t } = useTranslation('tickets');
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const detail = useAdminTicketDetail(Number.isFinite(id) ? id : null);
  const reply = useAdminReplyTicket(id);
  const status = useAdminUpdateTicketStatus(id);
  const [draft, setDraft] = useState('');

  const byReply = useMemo(() => {
    const map = new Map<number, TicketAttachment[]>();
    for (const a of detail.data?.attachments ?? []) {
      const arr = map.get(a.reply_id) ?? [];
      arr.push(a);
      map.set(a.reply_id, arr);
    }
    return map;
  }, [detail.data?.attachments]);

  if (detail.isPending) return <Skeleton className='h-96 w-full' />;
  if (detail.isError || !detail.data) {
    return (
      <div className='space-y-4'>
        <InlineBanner
          level='danger'
          message={t('detail.not_found')}
          onClose={() => void detail.refetch()}
        />
        <Link to='/admin/tickets' className='text-13 text-fg-2 hover:underline'>
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
      await reply.mutateAsync({ content: text });
      toast.success(t('detail.reply.success'));
      setDraft('');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function setStatus(next: StatusAction['target']) {
    try {
      await status.mutateAsync(next);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className='space-y-4'>
      <Link to='/admin/tickets' className='text-13 text-fg-2 hover:underline'>
        {t('detail.back')}
      </Link>
      <Card>
        <CardHeader>
          <div className='flex items-center justify-between'>
            <CardTitle>{ticket.subject}</CardTitle>
            <div className='flex items-center gap-2'>
              <Badge variant={meta.variant}>{t(meta.key)}</Badge>
              {statusActions(ticket.status).map((a) => (
                <Button
                  key={a.target}
                  type='button'
                  variant='secondary'
                  size='sm'
                  disabled={status.isPending}
                  onClick={() => void setStatus(a.target)}
                >
                  {t(a.labelKey)}
                </Button>
              ))}
            </div>
          </div>
          <div className='text-12 text-fg-2'>
            #{ticket.id} · user #{ticket.user_id} · {fmtDateSec(ticket.created_at)}
          </div>
        </CardHeader>
        <CardContent>
          <ul className='space-y-4'>
            {replies.map((r) => (
              <AdminReplyBlock
                key={r.id}
                reply={r}
                attachments={byReply.get(r.id) ?? []}
                t={t}
              />
            ))}
          </ul>
        </CardContent>
      </Card>
      {!isClosed && (
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

function AdminReplyBlock({
  reply,
  attachments,
  t,
}: {
  reply: TicketReply;
  attachments: TicketAttachment[];
  t: (k: string) => string;
}) {
  const isUser = reply.role === 'user';
  return (
    <li className={'rounded-md border border-line p-3 ' + (isUser ? 'bg-bg-1' : 'bg-bg-0')}>
      <div className='mb-2 flex items-center justify-between'>
        <div className='text-12 font-medium text-fg-1'>
          {t(isUser ? 'admin.role.user' : 'admin.role.admin')}
        </div>
        <div className='text-12 text-fg-2 tabular-nums'>{fmtDateSec(reply.created_at)}</div>
      </div>
      <div className='whitespace-pre-wrap text-13 leading-6 text-fg-0'>{reply.content}</div>
      <ReplyAttachments attachments={attachments} admin />
    </li>
  );
}
