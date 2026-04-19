import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { CreateApplicationDialog } from '@/components/invoice/CreateApplicationDialog';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useCancelInvoiceApplication,
  useInvoiceApplications,
  useInvoiceableOrders,
  type InvoiceApplication,
  type InvoiceableOrder,
} from '@/hooks/useInvoice';
import { fmtDateSec } from '@/lib/format';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;

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

export function InvoicesPage() {
  const { t } = useTranslation('invoice');
  const [tab, setTab] = useState<'orders' | 'applications'>('orders');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<
    Record<string, InvoiceableOrder | undefined>
  >({});
  const [createOpen, setCreateOpen] = useState(false);

  const orders = useInvoiceableOrders({ p: page, page_size: PAGE_SIZE });
  const apps = useInvoiceApplications({ p: page, page_size: PAGE_SIZE });
  const cancel = useCancelInvoiceApplication();

  const selectedList = Object.values(selected).filter(
    (v): v is InvoiceableOrder => v !== undefined
  );
  const selectedAmount = selectedList.reduce((a, b) => a + b.money, 0);

  function toggle(order: InvoiceableOrder) {
    const key = `${order.source_type}:${order.source_id}`;
    setSelected((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = order;
      return next;
    });
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center gap-2 border-b border-line'>
        <TabButton
          label={t('tab.orders')}
          active={tab === 'orders'}
          onClick={() => {
            setTab('orders');
            setPage(1);
          }}
        />
        <TabButton
          label={t('tab.applications')}
          active={tab === 'applications'}
          onClick={() => {
            setTab('applications');
            setPage(1);
          }}
        />
      </div>

      {tab === 'orders' ? (
        <OrdersTab
          pending={orders.isPending}
          error={orders.isError ? String((orders.error as Error).message) : undefined}
          items={orders.data?.items ?? []}
          total={orders.data?.total ?? 0}
          page={page}
          onPage={setPage}
          selected={selected}
          onToggle={toggle}
          selectedCount={selectedList.length}
          selectedAmount={selectedAmount}
          onApply={() => setCreateOpen(true)}
          onRefetch={() => void orders.refetch()}
          t={t}
        />
      ) : (
        <ApplicationsTab
          pending={apps.isPending}
          error={apps.isError ? String((apps.error as Error).message) : undefined}
          items={apps.data?.items ?? []}
          total={apps.data?.total ?? 0}
          page={page}
          onPage={setPage}
          cancelPending={cancel.isPending}
          onCancel={(id) =>
            cancel.mutate(id, {
              onSuccess: () => toast.success(t('apps.cancel.success')),
              onError: (e) => toast.error((e as Error).message),
            })
          }
          onRefetch={() => void apps.refetch()}
          t={t}
        />
      )}

      <CreateApplicationDialog
        open={createOpen}
        selected={selectedList}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) setSelected({});
        }}
      />
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-3 py-2 text-13 transition-colors',
        active
          ? 'border-primary text-fg-0'
          : 'border-transparent text-fg-2 hover:text-fg-1'
      )}
    >
      {label}
    </button>
  );
}

type Translator = ReturnType<typeof useTranslation>['t'];

function OrdersTab({
  pending,
  error,
  items,
  total,
  page,
  onPage,
  selected,
  onToggle,
  selectedCount,
  selectedAmount,
  onApply,
  onRefetch,
  t,
}: {
  pending: boolean;
  error?: string;
  items: InvoiceableOrder[];
  total: number;
  page: number;
  onPage: (p: number) => void;
  selected: Record<string, InvoiceableOrder | undefined>;
  onToggle: (o: InvoiceableOrder) => void;
  selectedCount: number;
  selectedAmount: number;
  onApply: () => void;
  onRefetch: () => void;
  t: Translator;
}) {
  return (
    <>
      {error && <InlineBanner level='danger' message={error} onClose={onRefetch} />}
      {pending ? (
        <div className='space-y-2'>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('orders.empty')}
        </div>
      ) : (
        <>
          {selectedCount > 0 && (
            <div className='flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-13'>
              <span>
                {t('orders.selected', {
                  count: selectedCount,
                  amount: `¥${selectedAmount.toFixed(2)}`,
                })}
              </span>
              <Button size='sm' onClick={onApply}>
                {t('orders.apply', { count: selectedCount })}
              </Button>
            </div>
          )}
          <div className='overflow-x-auto rounded-md border border-line'>
            <table className='w-full border-collapse tabular-nums'>
              <thead>
                <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                  <th className='w-10 px-3 py-2' />
                  <th className='px-3 py-2 font-medium'>{t('orders.col.trade_no')}</th>
                  <th className='px-3 py-2 font-medium'>{t('orders.col.source')}</th>
                  <th className='px-3 py-2 font-medium'>{t('orders.col.amount')}</th>
                  <th className='px-3 py-2 font-medium'>{t('orders.col.method')}</th>
                  <th className='px-3 py-2 font-medium'>{t('orders.col.completed')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((o) => {
                  const key = `${o.source_type}:${o.source_id}`;
                  const isSelected = Boolean(selected[key]);
                  return (
                    <tr key={key} className='border-b border-line text-13 hover:bg-bg-1'>
                      <td className='px-3 py-2'>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => onToggle(o)}
                        />
                      </td>
                      <td className='px-3 py-2 font-mono text-12'>{o.trade_no}</td>
                      <td className='px-3 py-2 font-mono text-12'>{o.source_type}</td>
                      <td className='px-3 py-2'>
                        {o.currency} {o.money.toFixed(2)}
                      </td>
                      <td className='px-3 py-2 text-fg-1'>{o.payment_method || '—'}</td>
                      <td className='px-3 py-2 text-fg-1'>
                        {fmtDateSec(o.complete_time)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <LogsPagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onChange={onPage}
          />
        </>
      )}
    </>
  );
}

function ApplicationsTab({
  pending,
  error,
  items,
  total,
  page,
  onPage,
  cancelPending,
  onCancel,
  onRefetch,
  t,
}: {
  pending: boolean;
  error?: string;
  items: InvoiceApplication[];
  total: number;
  page: number;
  onPage: (p: number) => void;
  cancelPending: boolean;
  onCancel: (id: number) => void;
  onRefetch: () => void;
  t: Translator;
}) {
  return (
    <>
      {error && <InlineBanner level='danger' message={error} onClose={onRefetch} />}
      {pending ? (
        <div className='space-y-2'>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
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
                  <th className='px-3 py-2 font-medium'>{t('apps.col.id')}</th>
                  <th className='px-3 py-2 font-medium'>{t('apps.col.title')}</th>
                  <th className='px-3 py-2 font-medium'>{t('apps.col.amount')}</th>
                  <th className='px-3 py-2 font-medium'>{t('apps.col.status')}</th>
                  <th className='px-3 py-2 font-medium'>{t('apps.col.issue')}</th>
                  <th className='px-3 py-2 font-medium'>{t('apps.col.created')}</th>
                  <th className='px-3 py-2' />
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className='border-b border-line text-13 hover:bg-bg-1'>
                    <td className='px-3 py-2 text-fg-2'>{a.id}</td>
                    <td className='max-w-[260px] px-3 py-2'>
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
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          className='text-danger'
                          disabled={cancelPending}
                          onClick={() => onCancel(a.id)}
                        >
                          {t('apps.action.cancel')}
                        </Button>
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
            onChange={onPage}
          />
        </>
      )}
    </>
  );
}
