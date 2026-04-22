import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useMyPaymentOrders,
  type MyPaymentOrder,
} from '@/hooks/usePaymentOrders';
import { fmtDateSec, fmtMoney } from '@/lib/format';

const PAGE_SIZE = 20;

type StatusVariant = 'default' | 'secondary' | 'destructive' | 'outline';

function statusVariant(s: string): StatusVariant {
  switch (s) {
    case 'paid':
      return 'default';
    case 'fully_refunded':
    case 'refunded':
    case 'expired':
      return 'destructive';
    case 'pending':
      return 'secondary';
    case 'partial_refunded':
      return 'secondary';
    case 'closed':
    default:
      return 'outline';
  }
}

function typeLabel(t: (k: string) => string, orderType: string): string {
  const key = `type.${orderType}`;
  const v = t(key);
  return v === key ? orderType : v;
}

function statusLabel(t: (k: string) => string, status: string): string {
  const key = `status.${status}`;
  const v = t(key);
  return v === key ? status : v;
}

export function OrdersPage() {
  const { t } = useTranslation('orders');
  const [page, setPage] = useState(1);
  const [type, setType] = useState('0');

  const list = useMyPaymentOrders({
    page,
    page_size: PAGE_SIZE,
    order_type: type === '0' ? undefined : type,
  });

  const items: MyPaymentOrder[] = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className='space-y-4'>
      <div>
        <h1 className='text-20 font-semibold'>{t('page.title')}</h1>
        <p className='mt-1 text-13 text-fg-2'>{t('page.subtitle')}</p>
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Select
          value={type}
          onValueChange={(v) => {
            setType(v);
            setPage(1);
          }}
        >
          <SelectTrigger className='max-w-[160px]'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='0'>{t('filter.type.all')}</SelectItem>
            <SelectItem value='topup'>{t('filter.type.topup')}</SelectItem>
            <SelectItem value='sub'>{t('filter.type.subscription')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {list.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('empty')}
        </div>
      ) : (
        <div className='overflow-x-auto rounded-md border border-line'>
          <table className='w-full border-collapse tabular-nums'>
            <thead>
              <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                <th className='px-3 py-2 font-medium'>{t('col.out_trade_no')}</th>
                <th className='px-3 py-2 font-medium'>{t('col.type')}</th>
                <th className='px-3 py-2 text-right font-medium'>
                  {t('col.amount')}
                </th>
                <th className='px-3 py-2 text-right font-medium'>
                  {t('col.refunded')}
                </th>
                <th className='px-3 py-2 font-medium'>{t('col.status')}</th>
                <th className='px-3 py-2 font-medium'>{t('col.created')}</th>
                <th className='px-3 py-2 font-medium'>{t('col.paid')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id} className='border-b border-line text-13 hover:bg-bg-1'>
                  <td className='max-w-[220px] truncate px-3 py-2 font-mono text-12'>
                    {o.out_trade_no}
                  </td>
                  <td className='px-3 py-2'>
                    <Badge variant='outline'>{typeLabel(t, o.order_type)}</Badge>
                  </td>
                  <td className='px-3 py-2 text-right'>
                    {fmtMoney(o.amount / 100, o.currency || 'CNY')}
                  </td>
                  <td className='px-3 py-2 text-right text-fg-1'>
                    {o.refunded_amount > 0
                      ? fmtMoney(o.refunded_amount / 100, o.currency || 'CNY')
                      : '—'}
                  </td>
                  <td className='px-3 py-2'>
                    <Badge variant={statusVariant(o.status)}>
                      {statusLabel(t, o.status)}
                    </Badge>
                  </td>
                  <td className='px-3 py-2 text-fg-1'>
                    {fmtDateSec(o.created_at)}
                  </td>
                  <td className='px-3 py-2 text-fg-1'>
                    {o.paid_at ? fmtDateSec(o.paid_at) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className='flex items-center justify-end gap-2'>
        <Button
          type='button'
          variant='secondary'
          size='sm'
          disabled={page <= 1 || list.isPending}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          {t('pagination.prev')}
        </Button>
        <span className='text-12 text-fg-2'>
          {t('pagination.summary', { page, total })}
        </span>
        <Button
          type='button'
          variant='secondary'
          size='sm'
          disabled={page >= pageCount || list.isPending}
          onClick={() => setPage((p) => p + 1)}
        >
          {t('pagination.next')}
        </Button>
      </div>
    </div>
  );
}
