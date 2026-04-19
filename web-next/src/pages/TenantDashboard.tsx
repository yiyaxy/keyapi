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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useTenantDashboard,
  useTenantModelUsage,
  useTenantUsageTrend,
} from '@/hooks/useTenantMetrics';
import { fmtMoney, fmtNum } from '@/lib/format';

const QUOTA_PER_UNIT = 500_000;
const TREND_DAYS = 30;

export function TenantDashboardPage() {
  const { t } = useTranslation('tenant');
  const summary = useTenantDashboard();
  const trend = useTenantUsageTrend(TREND_DAYS);
  const models = useTenantModelUsage();

  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
        <MetricCard
          title={t('dashboard.members')}
          loading={summary.isPending}
          primary={summary.data ? fmtNum(summary.data.total_members) : undefined}
          secondary={
            summary.data
              ? t('dashboard.members.active', {
                  active: fmtNum(summary.data.active_members),
                  total: fmtNum(summary.data.total_members),
                })
              : undefined
          }
        />
        <MetricCard
          title={t('dashboard.tokens')}
          loading={summary.isPending}
          primary={summary.data ? fmtNum(summary.data.total_tokens) : undefined}
          secondary={
            summary.data
              ? t('dashboard.tokens.active', {
                  active: fmtNum(summary.data.active_tokens),
                  total: fmtNum(summary.data.total_tokens),
                })
              : undefined
          }
        />
        <MetricCard
          title={t('dashboard.channels')}
          loading={summary.isPending}
          primary={summary.data ? fmtNum(summary.data.total_channels) : undefined}
          secondary={
            summary.data
              ? t('dashboard.channels.active', {
                  active: fmtNum(summary.data.active_channels),
                  total: fmtNum(summary.data.total_channels),
                })
              : undefined
          }
        />
        <MetricCard
          title={t('dashboard.usage')}
          loading={summary.isPending}
          primary={
            summary.data
              ? fmtMoney(summary.data.today_quota_used / QUOTA_PER_UNIT)
              : undefined
          }
          secondary={
            summary.data
              ? t('dashboard.usage.total', {
                  quota: fmtMoney(summary.data.total_quota_used / QUOTA_PER_UNIT),
                  requests: fmtNum(summary.data.total_requests),
                })
              : undefined
          }
        />
      </div>

      {summary.isError && (
        <InlineBanner
          level='danger'
          message={String((summary.error as Error).message)}
          onClose={() => void summary.refetch()}
        />
      )}

      <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
        <Card className='lg:col-span-2'>
          <CardHeader>
            <CardTitle>
              {t('dashboard.trend.title', { days: TREND_DAYS })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {trend.isPending ? (
              <Skeleton className='h-[260px] w-full' />
            ) : (trend.data ?? []).length === 0 ? (
              <div className='py-12 text-center text-13 text-fg-2'>
                {t('dashboard.trend.empty')}
              </div>
            ) : (
              <div className='h-[260px]'>
                <ResponsiveContainer width='100%' height='100%'>
                  <LineChart
                    data={trend.data}
                    margin={{ top: 12, right: 16, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray='2 4' stroke='var(--line)' />
                    <XAxis
                      dataKey='date'
                      stroke='var(--fg-2)'
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      stroke='var(--fg-2)'
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v: number) =>
                        fmtMoney(v / QUOTA_PER_UNIT)
                      }
                    />
                    <Tooltip
                      formatter={(value: number) => [
                        fmtMoney(value / QUOTA_PER_UNIT),
                        t('dashboard.usage'),
                      ]}
                    />
                    <Line
                      type='monotone'
                      dataKey='quota_used'
                      stroke='var(--primary)'
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.models.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {models.isPending ? (
              <div className='space-y-2'>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className='h-6 w-full' />
                ))}
              </div>
            ) : (models.data ?? []).length === 0 ? (
              <div className='py-12 text-center text-13 text-fg-2'>
                {t('dashboard.models.empty')}
              </div>
            ) : (
              <table className='w-full border-collapse tabular-nums'>
                <thead>
                  <tr className='border-b border-line text-left text-12 uppercase text-fg-2'>
                    <th className='py-2 font-medium'>{t('dashboard.models.col.model')}</th>
                    <th className='py-2 text-right font-medium'>
                      {t('dashboard.models.col.requests')}
                    </th>
                    <th className='py-2 text-right font-medium'>
                      {t('dashboard.models.col.cost')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(models.data ?? []).slice(0, 10).map((m) => (
                    <tr key={m.model_name} className='border-b border-line text-13'>
                      <td className='py-2 font-mono'>{m.model_name}</td>
                      <td className='py-2 text-right'>{fmtNum(m.request_count)}</td>
                      <td className='py-2 text-right'>
                        {fmtMoney(m.quota_used / QUOTA_PER_UNIT)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  primary,
  secondary,
  loading,
}: {
  title: string;
  primary?: string;
  secondary?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='text-13 text-fg-2'>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className='h-10 w-full' />
        ) : (
          <>
            <div className='text-24 font-semibold tabular-nums'>
              {primary ?? '—'}
            </div>
            {secondary && (
              <div className='mt-1 text-12 text-fg-2'>{secondary}</div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
