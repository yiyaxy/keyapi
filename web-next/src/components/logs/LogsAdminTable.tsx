import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { LogRow, LogType } from '@/hooks/useLogs';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { fmtDateSec, fmtDisplay, fmtNum } from '@/lib/format';

import { CostBreakdown, parseOther } from './CostBreakdown';

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

export function LogsAdminTable({
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
            <th className='px-3 py-2 font-medium'>{t('admin.table.col.username')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.model')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.token')}</th>
            <th className='px-3 py-2 font-medium'>{t('admin.table.col.channel')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.tokens')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.quota')}</th>
            <th className='px-3 py-2 font-medium'>{t('admin.table.col.ip')}</th>
            <th className='px-3 py-2' />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className='border-b border-line text-13 hover:bg-bg-1'>
              <td className='px-3 py-2 text-fg-1'>{fmtDateSec(r.created_at)}</td>
              <td className='px-3 py-2'>
                <Badge variant={TYPE_VARIANT[r.type]}>{t(TYPE_KEY[r.type])}</Badge>
              </td>
              <td className='px-3 py-2 font-mono'>{r.username || '—'}</td>
              <td className='px-3 py-2'>{r.model_name || '—'}</td>
              <td className='px-3 py-2'>{r.token_name || '—'}</td>
              <td className='px-3 py-2'>{r.channel_name || r.channel || '—'}</td>
              <td className='px-3 py-2'>
                {(() => {
                  if (r.prompt_tokens + r.completion_tokens <= 0) return '—';
                  const cache = parseOther(r.other).cache_tokens ?? 0;
                  if (cache > 0) {
                    return t('table.tokens.with_cache', {
                      prompt: fmtNum(r.prompt_tokens),
                      completion: fmtNum(r.completion_tokens),
                      cache: fmtNum(cache),
                    });
                  }
                  return t('table.tokens.detail', {
                    prompt: fmtNum(r.prompt_tokens),
                    completion: fmtNum(r.completion_tokens),
                  });
                })()}
              </td>
              <td className='px-3 py-2'>
                <CostBreakdown row={r} cfg={cfg}>
                  {r.quota > 0 ? fmtDisplay(r.quota, cfg) : t('table.unit.free')}
                </CostBreakdown>
              </td>
              <td className='px-3 py-2 font-mono text-12 text-fg-2'>{r.ip || '—'}</td>
              <td className='px-3 py-2'>
                <Button type='button' variant='ghost' size='sm' onClick={() => onRowClick(r)}>
                  {t('table.col.detail')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
