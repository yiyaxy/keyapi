import { LineChart as LineIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { fmtDaySec, fmtDisplay, fmtNum } from '@/lib/format';
import { aggregateByUtcDay, type QuotaDataRow } from '@/lib/usage-aggregate';

type Props = {
  rows: QuotaDataRow[] | undefined;
  isPending: boolean;
  startSec: number;
  endSec: number;
  range: string;
};

export function UsageTrendCard({ rows, isPending, startSec, endSec, range }: Props) {
  const { t } = useTranslation('dashboard');
  const cfg = usePublicConfig();
  if (isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('usage.title', { range })}</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className='h-[280px] w-full' />
        </CardContent>
      </Card>
    );
  }
  const data = aggregateByUtcDay(rows ?? [], startSec, endSec);
  const isEmpty = (rows ?? []).length === 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('usage.title', { range })}</CardTitle>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className='flex min-h-[280px] flex-col items-center justify-center text-center'>
            <LineIcon size={28} strokeWidth={1.5} className='mb-4 text-fg-2' />
            <h3 className='h3'>{t('usage.empty.title')}</h3>
            <p className='muted mt-2'>{t('usage.empty.body')}</p>
            <Link to='/keys' className='mt-6'>
              <Button>{t('usage.empty.cta')}</Button>
            </Link>
          </div>
        ) : (
          <ResponsiveContainer width='100%' height={280}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray='3 3' stroke='var(--border)' />
              <XAxis
                dataKey='day'
                tickFormatter={(sec: number) => fmtDaySec(sec)}
                stroke='var(--text-2)'
              />
              <YAxis
                tickFormatter={(q: number) => fmtDisplay(q, cfg)}
                stroke='var(--text-2)'
              />
              <Tooltip
                formatter={(value: number, _name, ctx: { payload?: { count?: number } }) => {
                  const count = ctx.payload?.count ?? 0;
                  return [
                    fmtDisplay(value, cfg),
                    t('usage.tooltip.requests', { count, formattedCount: fmtNum(count) }),
                  ];
                }}
                labelFormatter={(sec: number) => `${fmtDaySec(sec)} (UTC)`}
              />
              <Line
                type='monotone'
                dataKey='quota'
                stroke='var(--accent)'
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
