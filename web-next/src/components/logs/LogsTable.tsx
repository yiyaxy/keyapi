import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { LogRow, LogType } from '@/hooks/useLogs';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { fmtDateSec, fmtDisplay, fmtNum } from '@/lib/format';

import { CostBreakdown, parseOther } from './CostBreakdown';
import { LatencyCell } from './LatencyCell';

const TYPE_VARIANT: Record<LogType, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  0: 'outline',
  1: 'default',
  2: 'secondary',
  3: 'outline',
  4: 'outline',
  5: 'destructive',
  6: 'default',
  7: 'outline',
};

// Per-type row accent on the left border — subtle color coding so the
// table scans at a glance (consume: sky, topup: emerald, refund: amber,
// error: red, everything else: transparent / outline).
const TYPE_ACCENT: Record<LogType, string> = {
  0: '',
  1: 'border-l-2 border-l-emerald-400',
  2: 'border-l-2 border-l-sky-400',
  3: '',
  4: '',
  5: 'border-l-2 border-l-red-500',
  6: 'border-l-2 border-l-amber-400',
  7: 'border-l-2 border-l-violet-400',
};

const TYPE_KEY: Record<LogType, string> = {
  0: 'filters.type.all',
  1: 'filters.type.topup',
  2: 'filters.type.consume',
  3: 'filters.type.manage',
  4: 'filters.type.system',
  5: 'filters.type.error',
  6: 'filters.type.refund',
  7: 'filters.type.channel_test',
};

export function LogsTable({
  rows,
  onRowClick,
}: {
  rows: LogRow[];
  onRowClick: (r: LogRow) => void;
}) {
  const { t } = useTranslation('logs');
  const cfg = usePublicConfig();
  return (
    <div className='overflow-x-auto rounded-md border border-line'>
      <table className='w-full border-collapse tabular-nums'>
        <thead>
          <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
            <th className='px-3 py-2 font-medium'>{t('table.col.time')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.type')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.model')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.token')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.tokens')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.quota')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.latency')}</th>
            <th className='px-3 py-2' />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cache = parseOther(r.other).cache_tokens ?? 0;
            return (
              <tr
                key={r.id}
                className={`border-b border-line text-13 hover:bg-bg-1 ${TYPE_ACCENT[r.type]}`}
              >
                <td className='px-3 py-2 text-fg-1'>{fmtDateSec(r.created_at)}</td>
                <td className='px-3 py-2'>
                  <Badge variant={TYPE_VARIANT[r.type]}>{t(TYPE_KEY[r.type])}</Badge>
                </td>
                <td className='px-3 py-2 font-mono text-12'>{r.model_name || '—'}</td>
                <td className='px-3 py-2'>{r.token_name || '—'}</td>
                <td className='px-3 py-2 tabular-nums'>
                  {r.prompt_tokens + r.completion_tokens > 0 ? (
                    <span className='inline-flex items-baseline gap-1'>
                      <span className='text-fg-1'>{fmtNum(r.prompt_tokens)}</span>
                      <span className='text-fg-2'>+</span>
                      <span className='text-fg-1'>{fmtNum(r.completion_tokens)}</span>
                      {cache > 0 && (
                        <span className='ml-1 text-11 text-sky-500 dark:text-sky-400'>
                          {t('table.tokens.cache_badge', { cache: fmtNum(cache) })}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className='text-fg-2'>—</span>
                  )}
                </td>
                <td className='px-3 py-2'>
                  <CostBreakdown row={r} cfg={cfg}>
                    {r.quota > 0 ? (
                      <span className='font-medium text-emerald-600 dark:text-emerald-400'>
                        {fmtDisplay(r.quota, cfg)}
                      </span>
                    ) : (
                      <span className='text-fg-2'>{t('table.unit.free')}</span>
                    )}
                  </CostBreakdown>
                </td>
                <td className='px-3 py-2'>
                  <LatencyCell useTime={r.use_time} other={r.other} />
                </td>
                <td className='px-3 py-2'>
                  <Button type='button' variant='ghost' size='sm' onClick={() => onRowClick(r)}>
                    {t('table.col.detail')}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
