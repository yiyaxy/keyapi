import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Skeleton } from '@/components/ui/skeleton';
import {
  usePurchaseOverview,
  usePurchasePaymentMethods,
  usePurchaseTopSpenders,
  usePurchaseTrend,
} from '@/hooks/usePurchaseAnalytics';
import { fmtMoney, fmtNum } from '@/lib/format';

const DAY_SECONDS = 86_400;
type Range = 7 | 30 | 90;

function useRange(days: Range): { start: number; end: number } {
  // eslint-disable-next-line react-hooks/purity
  const now = Math.floor(Date.now() / 1000);
  return useMemo(() => {
    const start = now - days * DAY_SECONDS;
    return { start, end: now };
  }, [days, now]);
}

function RangeSeg({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={`rounded-md border px-3 py-1 text-12 ${
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-line bg-bg-1 text-fg-1 hover:bg-bg-0'
      }`}
    >
      {children}
    </button>
  );
}

function pctLabel(pct: number): { str: string; positive: boolean } {
  const positive = pct >= 0;
  return { str: `${positive ? '↑' : '↓'} ${Math.abs(pct).toFixed(1)}%`, positive };
}

export function PurchaseAnalyticsPage() {
  const { t } = useTranslation('analytics');
  const [range, setRange] = useState<Range>(30);
  const { start, end } = useRange(range);

  const overview = usePurchaseOverview(start, end);
  const trend = usePurchaseTrend(start, end);
  const payments = usePurchasePaymentMethods(start, end);
  const top = usePurchaseTopSpenders({ start, end, p: 1, page_size: 20 });

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-16 font-semibold'>{t('purchase.page.title')}</h2>
          <p className='text-12 text-fg-2'>{t('purchase.page.sub')}</p>
        </div>
        <div className='flex gap-1'>
          <RangeSeg active={range === 7} onClick={() => setRange(7)}>
            {t('range.7d')}
          </RangeSeg>
          <RangeSeg active={range === 30} onClick={() => setRange(30)}>
            {t('range.30d')}
          </RangeSeg>
          <RangeSeg active={range === 90} onClick={() => setRange(90)}>
            {t('range.90d')}
          </RangeSeg>
        </div>
      </div>
      {overview.isError && (
        <InlineBanner
          level='danger'
          message={String((overview.error as Error).message)}
        />
      )}
      {overview.isPending ? (
        <Skeleton className='h-24 w-full' />
      ) : overview.data ? (
        <div className='grid gap-3 sm:grid-cols-3'>
          {(() => {
            const { revenue_change, order_count_change } = overview.data;
            const rev = pctLabel(revenue_change);
            const oc = pctLabel(order_count_change);
            return (
              <>
                <div className='rounded-md border border-line bg-bg-1 p-4'>
                  <div className='text-12 text-fg-2'>
                    {t('purchase.card.revenue')}
                  </div>
                  <div className='text-24 font-semibold tabular-nums'>
                    {fmtMoney(overview.data.total_revenue)}
                  </div>
                  <div
                    className={`text-12 ${rev.positive ? 'text-success' : 'text-danger'}`}
                  >
                    {rev.str}
                  </div>
                </div>
                <div className='rounded-md border border-line bg-bg-1 p-4'>
                  <div className='text-12 text-fg-2'>
                    {t('purchase.card.orders')}
                  </div>
                  <div className='text-24 font-semibold tabular-nums'>
                    {fmtNum(overview.data.order_count)}
                  </div>
                  <div
                    className={`text-12 ${oc.positive ? 'text-success' : 'text-danger'}`}
                  >
                    {oc.str}
                  </div>
                </div>
                <div className='rounded-md border border-line bg-bg-1 p-4'>
                  <div className='text-12 text-fg-2'>{t('purchase.card.aov')}</div>
                  <div className='text-24 font-semibold tabular-nums'>
                    {fmtMoney(overview.data.avg_order_value)}
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      ) : null}
      <div className='rounded-md border border-line bg-bg-1 p-4'>
        <h3 className='mb-3 text-13 font-medium'>{t('purchase.trend.title')}</h3>
        {trend.isPending ? (
          <Skeleton className='h-[240px] w-full' />
        ) : trend.data ? (
          <ResponsiveContainer width='100%' height={240}>
            <LineChart data={trend.data}>
              <CartesianGrid strokeDasharray='3 3' stroke='var(--border)' />
              <XAxis dataKey='time_bucket' tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(value: number) => [fmtMoney(value), t('purchase.card.revenue')]}
              />
              <Line
                type='monotone'
                dataKey='revenue'
                stroke='var(--primary)'
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : null}
      </div>
      <div className='grid gap-4 md:grid-cols-2'>
        <div className='rounded-md border border-line bg-bg-1 p-4'>
          <h3 className='mb-3 text-13 font-medium'>{t('purchase.pm.title')}</h3>
          {payments.isPending ? (
            <Skeleton className='h-24 w-full' />
          ) : (payments.data ?? []).length === 0 ? (
            <div className='text-12 text-fg-2'>{t('empty')}</div>
          ) : (
            <table className='w-full border-collapse tabular-nums'>
              <thead>
                <tr className='border-b border-line text-left text-12 uppercase text-fg-2'>
                  <th className='py-2 font-medium'>{t('purchase.pm.col.method')}</th>
                  <th className='py-2 text-right font-medium'>
                    {t('purchase.pm.col.revenue')}
                  </th>
                  <th className='py-2 text-right font-medium'>
                    {t('purchase.pm.col.count')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {payments.data!.map((p) => (
                  <tr key={p.payment_method} className='border-b border-line text-13'>
                    <td className='py-2 font-mono text-12'>{p.payment_method}</td>
                    <td className='py-2 text-right'>{fmtMoney(p.revenue)}</td>
                    <td className='py-2 text-right'>{fmtNum(p.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className='rounded-md border border-line bg-bg-1 p-4'>
          <h3 className='mb-3 text-13 font-medium'>{t('purchase.top.title')}</h3>
          {top.isPending ? (
            <Skeleton className='h-24 w-full' />
          ) : (top.data?.items ?? []).length === 0 ? (
            <div className='text-12 text-fg-2'>{t('empty')}</div>
          ) : (
            <table className='w-full border-collapse tabular-nums'>
              <thead>
                <tr className='border-b border-line text-left text-12 uppercase text-fg-2'>
                  <th className='py-2 font-medium'>{t('purchase.top.col.user')}</th>
                  <th className='py-2 text-right font-medium'>
                    {t('purchase.top.col.spent')}
                  </th>
                  <th className='py-2 text-right font-medium'>
                    {t('purchase.top.col.orders')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {top.data!.items.map((s) => (
                  <tr key={s.user_id} className='border-b border-line text-13'>
                    <td className='py-2'>
                      <div>{s.username || `#${s.user_id}`}</div>
                      <div className='text-12 text-fg-2'>#{s.user_id}</div>
                    </td>
                    <td className='py-2 text-right'>{fmtMoney(s.total_spent)}</td>
                    <td className='py-2 text-right'>{fmtNum(s.order_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
