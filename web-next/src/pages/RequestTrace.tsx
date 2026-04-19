import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useRequestTrace } from '@/hooks/useRequestTrace';
import { fmtDateSec, fmtMoney, fmtNum } from '@/lib/format';

const QUOTA_PER_UNIT = 500_000;

const TYPE_KEY: Record<number, string> = {
  0: 'unknown',
  1: 'topup',
  2: 'consume',
  3: 'manage',
  4: 'system',
  5: 'error',
  6: 'refund',
};

function typeVariant(
  type: number
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (type === 5) return 'destructive';
  if (type === 2) return 'secondary';
  return 'outline';
}

export function RequestTracePage() {
  const { t } = useTranslation('ops');
  const params = useParams<{ requestId?: string }>();
  const initialId = params.requestId ?? '';
  const [input, setInput] = useState(initialId);
  const [lookup, setLookup] = useState(initialId);
  const navigate = useNavigate();
  const trace = useRequestTrace(lookup || null);

  function submit() {
    const id = input.trim();
    setLookup(id);
    if (id) navigate(`/admin/request-trace/${encodeURIComponent(id)}`);
    else navigate('/admin/request-trace');
  }

  return (
    <div className='space-y-4'>
      <header>
        <p className='text-13 text-fg-2'>{t('trace.sub')}</p>
      </header>
      <div className='flex items-center gap-2'>
        <Input
          className='max-w-xl font-mono text-12'
          placeholder={t('trace.input.placeholder')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <Button onClick={submit} disabled={!input.trim()}>
          {t('trace.lookup')}
        </Button>
      </div>

      {!lookup ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('trace.empty')}
        </div>
      ) : trace.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className='h-12 w-full' />
          ))}
        </div>
      ) : trace.isError ? (
        <InlineBanner
          level='danger'
          message={t('trace.not_found')}
          onClose={() => void trace.refetch()}
        />
      ) : (trace.data ?? []).length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('trace.not_found')}
        </div>
      ) : (
        <div className='overflow-x-auto rounded-md border border-line'>
          <table className='w-full border-collapse tabular-nums'>
            <thead>
              <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                <th className='px-3 py-2 font-medium'>{t('trace.col.time')}</th>
                <th className='px-3 py-2 font-medium'>{t('trace.col.type')}</th>
                <th className='px-3 py-2 font-medium'>{t('trace.col.user')}</th>
                <th className='px-3 py-2 font-medium'>{t('trace.col.channel')}</th>
                <th className='px-3 py-2 font-medium'>{t('trace.col.model')}</th>
                <th className='px-3 py-2 font-medium'>{t('trace.col.tokens')}</th>
                <th className='px-3 py-2 font-medium'>{t('trace.col.quota')}</th>
                <th className='px-3 py-2 font-medium'>{t('trace.col.latency')}</th>
                <th className='px-3 py-2 font-medium'>{t('trace.col.content')}</th>
              </tr>
            </thead>
            <tbody>
              {(trace.data ?? []).map((r) => (
                <tr key={r.id} className='border-b border-line text-13 hover:bg-bg-1'>
                  <td className='px-3 py-2 text-fg-1'>{fmtDateSec(r.created_at)}</td>
                  <td className='px-3 py-2'>
                    <Badge variant={typeVariant(r.type)}>
                      {TYPE_KEY[r.type] ?? r.type}
                    </Badge>
                  </td>
                  <td className='px-3 py-2 font-mono'>{r.username || '—'}</td>
                  <td className='px-3 py-2'>{r.channel_name || r.channel || '—'}</td>
                  <td className='px-3 py-2'>{r.model_name || '—'}</td>
                  <td className='px-3 py-2'>
                    {r.prompt_tokens + r.completion_tokens > 0
                      ? `${fmtNum(r.prompt_tokens)} + ${fmtNum(r.completion_tokens)}`
                      : '—'}
                  </td>
                  <td className='px-3 py-2'>
                    {r.quota > 0 ? fmtMoney(r.quota / QUOTA_PER_UNIT) : '—'}
                  </td>
                  <td className='px-3 py-2'>
                    {r.use_time > 0 ? `${r.use_time} ms` : '—'}
                  </td>
                  <td className='max-w-[280px] px-3 py-2'>
                    <div className='truncate text-12 text-fg-2'>{r.content || '—'}</div>
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
