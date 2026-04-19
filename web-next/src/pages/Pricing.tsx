import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { usePricing, type PricingRow } from '@/hooks/usePricing';
import { fmtMoney } from '@/lib/format';

// QuotaPerUnit: 500,000 quota = 1 USD
// model_ratio is "quota units per 1K input tokens / 2" (backend convention:
// 0.002 USD / 1K tokens → ratio 1). Price per 1M tokens in USD = ratio * 2.
function inputPerMillion(row: PricingRow): number {
  return row.model_ratio * 2;
}
function outputPerMillion(row: PricingRow): number {
  return row.model_ratio * row.completion_ratio * 2;
}

export function PricingPage() {
  const { t } = useTranslation('public');
  const pricing = usePricing();
  const [q, setQ] = useState('');
  const items = useMemo(() => {
    const rows = pricing.data ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.model_name.toLowerCase().includes(needle) ||
        (r.owner_by ?? '').toLowerCase().includes(needle)
    );
  }, [pricing.data, q]);

  return (
    <div className='space-y-6'>
      <header>
        <h1 className='text-24 font-semibold'>{t('pricing.title')}</h1>
        <p className='mt-1 text-13 text-fg-2'>{t('pricing.sub')}</p>
      </header>

      <Input
        className='max-w-xs'
        placeholder={t('pricing.search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {pricing.isError && (
        <InlineBanner
          level='danger'
          message={t('pricing.failed')}
          onClose={() => void pricing.refetch()}
        />
      )}
      {pricing.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('pricing.empty')}
        </div>
      ) : (
        <div className='overflow-x-auto rounded-md border border-line'>
          <table className='w-full border-collapse tabular-nums'>
            <thead>
              <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                <th className='px-3 py-2 font-medium'>{t('pricing.col.model')}</th>
                <th className='px-3 py-2 font-medium'>{t('pricing.col.vendor')}</th>
                <th className='px-3 py-2 font-medium'>{t('pricing.col.input')}</th>
                <th className='px-3 py-2 font-medium'>{t('pricing.col.output')}</th>
                <th className='px-3 py-2 font-medium'>{t('pricing.col.fixed')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.model_name} className='border-b border-line text-13 hover:bg-bg-1'>
                  <td className='px-3 py-2 font-mono'>{row.model_name}</td>
                  <td className='px-3 py-2 text-fg-1'>{row.owner_by || '—'}</td>
                  <td className='px-3 py-2'>
                    {row.quota_type === 0 ? fmtMoney(inputPerMillion(row)) : '—'}
                  </td>
                  <td className='px-3 py-2'>
                    {row.quota_type === 0 ? fmtMoney(outputPerMillion(row)) : '—'}
                  </td>
                  <td className='px-3 py-2'>
                    {row.quota_type === 1 ? fmtMoney(row.model_price) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
