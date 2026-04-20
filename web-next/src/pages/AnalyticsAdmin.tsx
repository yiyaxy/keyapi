import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useAnalyticsByChannel,
  useAnalyticsByModel,
  useAnalyticsByUser,
  type AnalyticsResult,
} from '@/hooks/useAnalyticsAdmin';
import { fmtMoney, fmtNum } from '@/lib/format';

const QUOTA_PER_UNIT = 500_000;
const DAY_SECONDS = 86_400;
type Tab = 'channel' | 'model' | 'user';
type Range = 7 | 30 | 90;

function useRange(days: Range): { start: number; end: number } {
  // eslint-disable-next-line react-hooks/purity
  const now = Math.floor(Date.now() / 1000);
  return useMemo(() => {
    const start = now - days * DAY_SECONDS;
    return { start, end: now };
  }, [days, now]);
}

function SummaryStrip({ result }: { result: AnalyticsResult }) {
  const { t } = useTranslation('analytics');
  const { summary } = result;
  return (
    <div className='grid grid-cols-2 gap-3 sm:grid-cols-5'>
      <div className='rounded-md border border-line bg-bg-1 p-3'>
        <div className='text-12 text-fg-2'>{t('summary.quota')}</div>
        <div className='text-16 font-semibold tabular-nums'>
          {fmtMoney(summary.total_quota / QUOTA_PER_UNIT)}
        </div>
      </div>
      <div className='rounded-md border border-line bg-bg-1 p-3'>
        <div className='text-12 text-fg-2'>{t('summary.requests')}</div>
        <div className='text-16 font-semibold tabular-nums'>
          {fmtNum(summary.total_count)}
        </div>
      </div>
      <div className='rounded-md border border-line bg-bg-1 p-3'>
        <div className='text-12 text-fg-2'>{t('summary.tokens')}</div>
        <div className='text-16 font-semibold tabular-nums'>
          {fmtNum(summary.total_tokens)}
        </div>
      </div>
      <div className='rounded-md border border-line bg-bg-1 p-3'>
        <div className='text-12 text-fg-2'>{t('summary.rpm')}</div>
        <div className='text-16 font-semibold tabular-nums'>
          {fmtNum(summary.rpm)}
        </div>
      </div>
      <div className='rounded-md border border-line bg-bg-1 p-3'>
        <div className='text-12 text-fg-2'>{t('summary.tpm')}</div>
        <div className='text-16 font-semibold tabular-nums'>
          {fmtNum(summary.tpm)}
        </div>
      </div>
    </div>
  );
}

function AnalyticsTable({ result }: { result: AnalyticsResult }) {
  const { t } = useTranslation('analytics');
  // Backend returns items: null on empty result sets from older builds —
  // guard so the spread doesn't throw before the Go-side fix has shipped.
  const items = [...(result.items ?? [])].sort((a, b) => b.quota - a.quota);
  if (items.length === 0) {
    return (
      <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
        {t('empty')}
      </div>
    );
  }
  return (
    <div className='overflow-x-auto rounded-md border border-line'>
      <table className='w-full border-collapse tabular-nums'>
        <thead>
          <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
            <th className='px-3 py-2 font-medium'>{t('col.name')}</th>
            <th className='px-3 py-2 font-medium text-right'>{t('col.quota')}</th>
            <th className='px-3 py-2 font-medium text-right'>{t('col.count')}</th>
            <th className='px-3 py-2 font-medium text-right'>{t('col.tokens')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.name} className='border-b border-line text-13 hover:bg-bg-1'>
              <td className='px-3 py-2 font-mono text-12'>{it.name}</td>
              <td className='px-3 py-2 text-right'>
                {fmtMoney(it.quota / QUOTA_PER_UNIT)}
              </td>
              <td className='px-3 py-2 text-right'>{fmtNum(it.count)}</td>
              <td className='px-3 py-2 text-right'>{fmtNum(it.tokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

function TabBtn({
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
      className={`border-b-2 px-3 py-2 text-13 ${
        active
          ? 'border-primary text-fg-0'
          : 'border-transparent text-fg-2 hover:text-fg-1'
      }`}
    >
      {children}
    </button>
  );
}

export function AnalyticsAdminPage() {
  const { t } = useTranslation('analytics');
  const [tab, setTab] = useState<Tab>('channel');
  const [range, setRange] = useState<Range>(30);
  const { start, end } = useRange(range);

  const ch = useAnalyticsByChannel(start, end);
  const mo = useAnalyticsByModel(start, end);
  const us = useAnalyticsByUser(start, end);
  const q = tab === 'channel' ? ch : tab === 'model' ? mo : us;

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex items-center gap-1 border-b border-line'>
          <TabBtn active={tab === 'channel'} onClick={() => setTab('channel')}>
            {t('tab.channel')}
          </TabBtn>
          <TabBtn active={tab === 'model'} onClick={() => setTab('model')}>
            {t('tab.model')}
          </TabBtn>
          <TabBtn active={tab === 'user'} onClick={() => setTab('user')}>
            {t('tab.user')}
          </TabBtn>
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
      {q.isError && (
        <InlineBanner
          level='danger'
          message={String((q.error as Error).message)}
          onClose={() => void q.refetch()}
        />
      )}
      {q.isPending ? (
        <div className='space-y-2'>
          <Skeleton className='h-16 w-full' />
          <Skeleton className='h-40 w-full' />
        </div>
      ) : q.data ? (
        <>
          <SummaryStrip result={q.data} />
          <AnalyticsTable result={q.data} />
        </>
      ) : null}
    </div>
  );
}
