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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  useAdminAffTransfers,
  useAdminProcessAffTransfer,
  type AffTransferRequest,
} from '@/hooks/useAffTransfer';
import { fmtDateSec, fmtMoney } from '@/lib/format';

const QUOTA_PER_UNIT = 500_000;
const PAGE_SIZE = 30;

function statusVariant(status: number): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 2) return 'default';
  if (status === 3) return 'destructive';
  if (status === 1) return 'secondary';
  return 'outline';
}

export function AffTransferAdminPage() {
  const { t } = useTranslation('aff');
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [rejectTarget, setRejectTarget] = useState<AffTransferRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const list = useAdminAffTransfers({
    p: page,
    page_size: PAGE_SIZE,
    keyword: appliedKeyword || undefined,
  });
  const process = useAdminProcessAffTransfer();

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  function approve(r: AffTransferRequest) {
    process.mutate(
      { id: r.id, status: 2 },
      {
        onSuccess: () => toast.success(t('admin.approve.success')),
        onError: (e) => toast.error((e as Error).message),
      }
    );
  }

  function submitReject() {
    if (!rejectTarget) return;
    process.mutate(
      { id: rejectTarget.id, status: 3, admin_remark: rejectReason.trim() },
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
      <div className='flex items-center gap-2'>
        <Input
          className='max-w-xs'
          placeholder={t('admin.search.placeholder')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setAppliedKeyword(keyword);
              setPage(1);
            }
          }}
        />
      </div>
      {list.isError && (
        <InlineBanner
          level='danger'
          message={String((list.error as Error).message)}
          onClose={() => void list.refetch()}
        />
      )}
      {list.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-12 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('history.empty')}
        </div>
      ) : (
        <>
          <div className='overflow-x-auto rounded-md border border-line'>
            <table className='w-full border-collapse tabular-nums'>
              <thead>
                <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                  <th className='px-3 py-2 font-medium'>{t('admin.col.user')}</th>
                  <th className='px-3 py-2 font-medium'>{t('admin.col.quota')}</th>
                  <th className='px-3 py-2 font-medium'>{t('admin.col.status')}</th>
                  <th className='px-3 py-2 font-medium'>{t('admin.col.created')}</th>
                  <th className='px-3 py-2 font-medium'>{t('admin.col.admin_remark')}</th>
                  <th className='px-3 py-2' />
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className='border-b border-line text-13 hover:bg-bg-1'>
                    <td className='px-3 py-2'>
                      <div className='font-mono'>{r.username || `#${r.user_id}`}</div>
                      <div className='text-12 text-fg-2'>#{r.id}</div>
                    </td>
                    <td className='px-3 py-2'>{fmtMoney(r.quota / QUOTA_PER_UNIT)}</td>
                    <td className='px-3 py-2'>
                      <Badge variant={statusVariant(r.status)}>
                        {t(
                          r.status === 2
                            ? 'status.approved'
                            : r.status === 3
                              ? 'status.rejected'
                              : 'status.pending'
                        )}
                      </Badge>
                    </td>
                    <td className='px-3 py-2 text-fg-1'>{fmtDateSec(r.created_at)}</td>
                    <td className='px-3 py-2 text-fg-1'>{r.admin_remark || '—'}</td>
                    <td className='px-3 py-2'>
                      {r.status === 1 && (
                        <div className='flex gap-1'>
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            disabled={process.isPending}
                            onClick={() => approve(r)}
                          >
                            {t('admin.action.approve')}
                          </Button>
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            className='text-danger'
                            disabled={process.isPending}
                            onClick={() => {
                              setRejectTarget(r);
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
          <LogsPagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </>
      )}
      <Dialog open={rejectTarget !== null} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.reject.title')}</DialogTitle>
          </DialogHeader>
          <div className='space-y-2'>
            <Label htmlFor='aff-reject-reason'>{t('admin.reject.reason')}</Label>
            <Textarea
              id='aff-reject-reason'
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type='button' variant='secondary' onClick={() => setRejectTarget(null)}>
              {t('admin.reject.cancel')}
            </Button>
            <Button
              type='button'
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              disabled={process.isPending}
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
