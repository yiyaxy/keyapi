import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Redemption } from '@/hooks/useRedemptions';
import { fmtDateSec, fmtMoney } from '@/lib/format';

const QUOTA_PER_UNIT = 500_000;

function statusMeta(r: Redemption): {
  key: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
  if (r.status === 2 || r.redeemed_time > 0) return { key: 'status.used', variant: 'secondary' };
  if (r.status === 3) return { key: 'status.disabled', variant: 'destructive' };
  if (r.expired_time > 0 && r.expired_time < Math.floor(Date.now() / 1000))
    return { key: 'status.expired', variant: 'destructive' };
  return { key: 'status.unused', variant: 'default' };
}

export function RedemptionsTable({
  items,
  onDelete,
}: {
  items: Redemption[];
  onDelete: (r: Redemption) => void;
}) {
  const { t } = useTranslation('redemption');

  async function copy(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      toast.success(t('action.copied'));
    } catch {
      toast.error(t('action.copy'));
    }
  }

  return (
    <div className='overflow-x-auto rounded-md border border-line'>
      <table className='w-full border-collapse tabular-nums'>
        <thead>
          <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
            <th className='px-3 py-2 font-medium'>{t('table.col.id')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.name')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.quota')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.status')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.created')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.expires')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.code')}</th>
            <th className='px-3 py-2' />
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const meta = statusMeta(r);
            const canCopy = r.status === 1 && r.redeemed_time === 0;
            return (
              <tr key={r.id} className='border-b border-line text-13 hover:bg-bg-1'>
                <td className='px-3 py-2 text-fg-2'>{r.id}</td>
                <td className='px-3 py-2'>{r.name}</td>
                <td className='px-3 py-2'>{fmtMoney(r.quota / QUOTA_PER_UNIT)}</td>
                <td className='px-3 py-2'>
                  <Badge variant={meta.variant}>{t(meta.key)}</Badge>
                </td>
                <td className='px-3 py-2 text-fg-1'>{fmtDateSec(r.created_time)}</td>
                <td className='px-3 py-2 text-fg-1'>
                  {r.expired_time > 0 ? fmtDateSec(r.expired_time) : '—'}
                </td>
                <td className='px-3 py-2 font-mono'>
                  {canCopy ? `${r.key.slice(0, 4)}…${r.key.slice(-4)}` : '—'}
                </td>
                <td className='px-3 py-2'>
                  <div className='flex gap-1'>
                    {canCopy && (
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        onClick={() => void copy(r.key)}
                      >
                        {t('action.copy')}
                      </Button>
                    )}
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='text-danger'
                      onClick={() => onDelete(r)}
                    >
                      {t('action.delete')}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
