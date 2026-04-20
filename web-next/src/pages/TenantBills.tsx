import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageAction } from '@/hooks/usePageAction';
import { useRefreshCurrentBill, useTenantBills, type TenantBill } from '@/hooks/useTenantBilling';
import { fmtDateSec, fmtMoney, fmtNum } from '@/lib/format';

const QUOTA_PER_UNIT = 500_000;
const PAGE_SIZE = 30;

function statusMeta(status: string): {
  key: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
  switch (status) {
    case 'open':
      return { key: 'bills.status.open', variant: 'default' };
    case 'closed':
      return { key: 'bills.status.closed', variant: 'secondary' };
    case 'settled':
      return { key: 'bills.status.settled', variant: 'outline' };
    default:
      return { key: 'bills.status.open', variant: 'outline' };
  }
}

export function TenantBillsPage() {
  const { t } = useTranslation('tenant');
  const [page, setPage] = useState(1);
  const bills = useTenantBills({ p: page, page_size: PAGE_SIZE });
  const refresh = useRefreshCurrentBill();

  const items: TenantBill[] = bills.data?.items ?? [];
  const total = bills.data?.total ?? 0;

  return (
    <div className='space-y-4'>
      <PageAction>
        <Button
          variant='secondary'
          disabled={refresh.isPending}
          onClick={() =>
            refresh.mutate(undefined, {
              onError: (e) => toast.error((e as Error).message),
            })
          }
        >
          {t('bills.refresh')}
        </Button>
      </PageAction>
      {bills.isError && (
        <InlineBanner
          level='danger'
          message={String((bills.error as Error).message)}
          onClose={() => void bills.refetch()}
        />
      )}
      {bills.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className='h-12 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('bills.empty')}
        </div>
      ) : (
        <>
          <div className='overflow-x-auto rounded-md border border-line'>
            <table className='w-full border-collapse tabular-nums'>
              <thead>
                <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                  <th className='px-3 py-2 font-medium'>{t('bills.col.period')}</th>
                  <th className='px-3 py-2 font-medium'>{t('bills.col.quota')}</th>
                  <th className='px-3 py-2 font-medium'>{t('bills.col.requests')}</th>
                  <th className='px-3 py-2 font-medium'>{t('bills.col.plan')}</th>
                  <th className='px-3 py-2 font-medium'>{t('bills.col.status')}</th>
                  <th className='px-3 py-2 font-medium'>{t('bills.col.closed')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((bill) => {
                  const meta = statusMeta(bill.status);
                  return (
                    <tr key={bill.id} className='border-b border-line text-13 hover:bg-bg-1'>
                      <td className='px-3 py-2 text-fg-1'>
                        {fmtDateSec(bill.period_start)} → {fmtDateSec(bill.period_end)}
                      </td>
                      <td className='px-3 py-2'>{fmtMoney(bill.quota_used / QUOTA_PER_UNIT)}</td>
                      <td className='px-3 py-2'>{fmtNum(bill.request_count)}</td>
                      <td className='px-3 py-2'>{bill.plan_name || '—'}</td>
                      <td className='px-3 py-2'>
                        <Badge variant={meta.variant}>{t(meta.key)}</Badge>
                      </td>
                      <td className='px-3 py-2 text-fg-1'>
                        {bill.closed_at > 0 ? fmtDateSec(bill.closed_at) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <LogsPagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
