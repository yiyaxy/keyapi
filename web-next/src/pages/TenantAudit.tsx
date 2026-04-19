import { useTranslation } from 'react-i18next';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Skeleton } from '@/components/ui/skeleton';
import { useTenantAudit } from '@/hooks/useTenantBilling';
import { fmtDateSec } from '@/lib/format';

export function TenantAuditPage() {
  const { t } = useTranslation('tenant');
  const audit = useTenantAudit(100);
  const items = audit.data ?? [];

  return (
    <div className='space-y-4'>
      {audit.isError && (
        <InlineBanner
          level='danger'
          message={String((audit.error as Error).message)}
          onClose={() => void audit.refetch()}
        />
      )}
      {audit.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('audit.empty')}
        </div>
      ) : (
        <div className='overflow-x-auto rounded-md border border-line'>
          <table className='w-full border-collapse tabular-nums'>
            <thead>
              <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                <th className='px-3 py-2 font-medium'>{t('audit.col.when')}</th>
                <th className='px-3 py-2 font-medium'>{t('audit.col.actor')}</th>
                <th className='px-3 py-2 font-medium'>{t('audit.col.action')}</th>
                <th className='px-3 py-2 font-medium'>{t('audit.col.target')}</th>
                <th className='px-3 py-2 font-medium'>{t('audit.col.ip')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className='border-b border-line text-13 hover:bg-bg-1'>
                  <td className='px-3 py-2 text-fg-1'>{fmtDateSec(row.created_at)}</td>
                  <td className='px-3 py-2'>
                    <div className='font-mono'>#{row.actor_user_id}</div>
                    <div className='text-12 text-fg-2'>{row.actor_role || '—'}</div>
                  </td>
                  <td className='px-3 py-2 font-mono text-12'>{row.action}</td>
                  <td className='px-3 py-2'>
                    {row.target || '—'}
                    {row.target_id > 0 ? ` #${row.target_id}` : ''}
                  </td>
                  <td className='px-3 py-2 font-mono text-12 text-fg-2'>{row.client_ip || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
