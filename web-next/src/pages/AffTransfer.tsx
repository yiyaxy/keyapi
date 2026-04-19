import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import {
  useAffPendingQuota,
  useAffTransferSelf,
  useCreateAffTransfer,
  type AffTransferRequest,
} from '@/hooks/useAffTransfer';
import { ApiError } from '@/lib/api';
import { fmtDateSec, fmtMoney, fmtNum } from '@/lib/format';

const QUOTA_PER_UNIT = 500_000;
const PAGE_SIZE = 20;

function statusVariant(status: number): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 2) return 'default';
  if (status === 3) return 'destructive';
  if (status === 1) return 'secondary';
  return 'outline';
}

export function AffTransferPage() {
  const { t } = useTranslation('aff');
  const { user } = useAuth();
  const pending = useAffPendingQuota();
  const create = useCreateAffTransfer();
  const [page, setPage] = useState(1);
  const history = useAffTransferSelf({ p: page, page_size: PAGE_SIZE });
  const [amount, setAmount] = useState(0);

  const pendingVal =
    typeof pending.data === 'number' ? pending.data : (pending.data?.pending_quota ?? 0);
  const hasPending = pendingVal > 0;

  async function submit() {
    if (amount < QUOTA_PER_UNIT) {
      toast.error(t('form.amount.min', { amount: fmtNum(QUOTA_PER_UNIT) }));
      return;
    }
    try {
      await create.mutateAsync(amount);
      toast.success(t('form.success'));
      setAmount(0);
    } catch (e) {
      if (e instanceof ApiError) {
        toast.error(e.backendMessage ?? e.message);
      }
    }
  }

  return (
    <div className='max-w-4xl space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle>{t('page.title')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <p className='text-13 text-fg-2'>{t('sub')}</p>
          <div>
            <div className='text-12 text-fg-2'>{t('available.label')}</div>
            <div className='text-28 font-semibold tabular-nums'>
              {fmtMoney((user?.quota ?? 0) / QUOTA_PER_UNIT)}
            </div>
          </div>
          {hasPending && <InlineBanner level='warn' message={t('pending.notice')} />}
          <div className='grid grid-cols-[1fr_auto] items-end gap-3'>
            <div className='space-y-2'>
              <Label htmlFor='aff-amount'>{t('form.amount.label')}</Label>
              <Input
                id='aff-amount'
                type='number'
                min={0}
                disabled={hasPending}
                value={amount || ''}
                onChange={(e) => setAmount(Number(e.target.value) || 0)}
              />
            </div>
            <Button
              onClick={() => void submit()}
              disabled={hasPending || create.isPending || amount < QUOTA_PER_UNIT}
            >
              {t('form.submit')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('history.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {history.isError && (
            <InlineBanner
              level='danger'
              message={String((history.error as Error).message)}
              onClose={() => void history.refetch()}
            />
          )}
          {history.isPending ? (
            <Skeleton className='h-24 w-full' />
          ) : (history.data?.items ?? []).length === 0 ? (
            <div className='py-8 text-center text-13 text-fg-2'>{t('history.empty')}</div>
          ) : (
            <>
              <div className='overflow-x-auto'>
                <table className='w-full border-collapse tabular-nums'>
                  <thead>
                    <tr className='border-b border-line text-left text-12 uppercase text-fg-2'>
                      <th className='py-2 font-medium'>{t('history.col.id')}</th>
                      <th className='py-2 font-medium'>{t('history.col.quota')}</th>
                      <th className='py-2 font-medium'>{t('history.col.status')}</th>
                      <th className='py-2 font-medium'>{t('history.col.admin_remark')}</th>
                      <th className='py-2 font-medium'>{t('history.col.created')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(history.data?.items ?? []).map((r: AffTransferRequest) => (
                      <tr key={r.id} className='border-b border-line text-13'>
                        <td className='py-2 text-fg-2'>{r.id}</td>
                        <td className='py-2'>{fmtMoney(r.quota / QUOTA_PER_UNIT)}</td>
                        <td className='py-2'>
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
                        <td className='py-2 text-fg-1'>{r.admin_remark || '—'}</td>
                        <td className='py-2 text-fg-1'>{fmtDateSec(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <LogsPagination
                page={page}
                pageSize={PAGE_SIZE}
                total={history.data?.total ?? 0}
                onChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
