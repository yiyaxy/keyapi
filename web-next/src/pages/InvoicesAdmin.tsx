import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  useAdminInvoiceApplications,
  useAdminUpdateInvoiceStatus,
  type InvoiceApplication,
} from '@/hooks/useInvoice';
import { fmtDateSec } from '@/lib/format';

const PAGE_SIZE = 30;

function statusVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'approved':
      return 'default';
    case 'pending':
      return 'secondary';
    case 'rejected':
      return 'destructive';
    case 'cancelled':
      return 'outline';
    default:
      return 'outline';
  }
}

function issueVariant(
  issue: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (issue) {
    case 'issued':
      return 'default';
    case 'issuing':
      return 'secondary';
    case 'failed':
      return 'destructive';
    default:
      return 'outline';
  }
}

export function InvoicesAdminPage() {
  const { t } = useTranslation('invoice');
  const [page, setPage] = useState(1);
  const [rejectTarget, setRejectTarget] = useState<InvoiceApplication | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const apps = useAdminInvoiceApplications({ p: page, page_size: PAGE_SIZE });
  const update = useAdminUpdateInvoiceStatus();

  const items = apps.data?.items ?? [];
  const total = apps.data?.total ?? 0;

  function approve(app: InvoiceApplication) {
    update.mutate(
      { id: app.id, status: 'approved' },
      {
        onSuccess: () => toast.success(t('admin.approve.success')),
        onError: (e) => toast.error((e as Error).message),
      }
    );
  }

  function submitReject() {
    if (!rejectTarget) return;
    update.mutate(
      {
        id: rejectTarget.id,
        status: 'rejected',
        reject_reason: rejectReason.trim(),
      },
      {
        onSuccess: () => {
          toast.success(t('admin.reject.success'));
          setRejectTarget(null);
          setRejectReason('');
        },
        onError: (e) => toast.error((e as Error).message),
      }
    );
  }

  return (
    <div className='space-y-4'>
      {apps.isError && (
        <InlineBanner
          level='danger'
          message={String((apps.error as Error).message)}
          onClose={() => void apps.refetch()}
        />
      )}
      {apps.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-12 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('apps.empty')}
        </div>
      ) : (
        <>
          <div className='overflow-x-auto rounded-md border border-line'>
            <table className='w-full border-collapse tabular-nums'>
              <thead>
                <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                  <th className='px-3 py-2 font-medium'>{t('admin.col.id')}</th>
                  <th className='px-3 py-2 font-medium'>{t('admin.col.user')}</th>
                  <th className='px-3 py-2 font-medium'>{t('admin.col.title')}</th>
                  <th className='px-3 py-2 font-medium'>{t('admin.col.amount')}</th>
                  <th className='px-3 py-2 font-medium'>{t('admin.col.status')}</th>
                  <th className='px-3 py-2 font-medium'>{t('admin.col.issue')}</th>
                  <th className='px-3 py-2 font-medium'>{t('admin.col.created')}</th>
                  <th className='px-3 py-2' />
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className='border-b border-line text-13 hover:bg-bg-1'>
                    <td className='px-3 py-2 text-fg-2'>{a.id}</td>
                    <td className='px-3 py-2 font-mono text-12'>#{a.user_id}</td>
                    <td className='max-w-[240px] px-3 py-2'>
                      <div className='truncate'>{a.title}</div>
                    </td>
                    <td className='px-3 py-2'>
                      {a.currency} {a.total_money.toFixed(2)}
                    </td>
                    <td className='px-3 py-2'>
                      <Badge variant={statusVariant(a.status)}>
                        {t(`apps.status.${a.status}`, { defaultValue: a.status })}
                      </Badge>
                    </td>
                    <td className='px-3 py-2'>
                      <Badge variant={issueVariant(a.issue_status)}>
                        {t(`apps.issue.${a.issue_status}`, {
                          defaultValue: a.issue_status,
                        })}
                      </Badge>
                    </td>
                    <td className='px-3 py-2 text-fg-1'>{fmtDateSec(a.created_at)}</td>
                    <td className='px-3 py-2'>
                      {a.status === 'pending' && (
                        <div className='flex gap-1'>
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            disabled={update.isPending}
                            onClick={() => approve(a)}
                          >
                            {t('admin.action.approve')}
                          </Button>
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            className='text-danger'
                            disabled={update.isPending}
                            onClick={() => {
                              setRejectTarget(a);
                              setRejectReason('');
                            }}
                          >
                            {t('admin.action.reject')}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <LogsPagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onChange={setPage}
          />
        </>
      )}
      <Dialog
        open={rejectTarget !== null}
        onOpenChange={(o) => !o && setRejectTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.reject.title')}</DialogTitle>
          </DialogHeader>
          <div className='space-y-2'>
            <Label htmlFor='inv-reject-reason'>{t('admin.reject.reason')}</Label>
            <Textarea
              id='inv-reject-reason'
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type='button'
              variant='secondary'
              onClick={() => setRejectTarget(null)}
            >
              {t('admin.reject.cancel')}
            </Button>
            <Button
              type='button'
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              disabled={update.isPending}
              onClick={submitReject}
            >
              {t('admin.reject.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
