import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { CreateTenantDialog } from '@/components/platform/CreateTenantDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageAction } from '@/hooks/usePageAction';
import {
  useDeleteTenant,
  usePlatformTenants,
} from '@/hooks/usePlatformTenants';
import type { Tenant } from '@/hooks/useTenant';
import { fmtDateSec } from '@/lib/format';

function statusMeta(status: number): {
  key: string;
  variant: 'default' | 'secondary' | 'destructive';
} {
  switch (status) {
    case 1:
      return { key: 'tenants.status.active', variant: 'default' };
    case 2:
      return { key: 'tenants.status.suspended', variant: 'secondary' };
    case 3:
      return { key: 'tenants.status.deleted', variant: 'destructive' };
    default:
      return { key: 'tenants.status.active', variant: 'default' };
  }
}

export function PlatformTenantsPage() {
  const { t } = useTranslation('platform');
  const tenants = usePlatformTenants();
  const del = useDeleteTenant();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Tenant | null>(null);

  const items = tenants.data ?? [];

  return (
    <div className='space-y-4'>
      <PageAction>
        <Button onClick={() => setCreateOpen(true)}>{t('tenants.page.create')}</Button>
      </PageAction>
      {tenants.isError && (
        <InlineBanner
          level='danger'
          message={String((tenants.error as Error).message)}
          onClose={() => void tenants.refetch()}
        />
      )}
      {tenants.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center'>
          <div className='text-15 font-medium text-fg-0'>
            {t('tenants.empty.title')}
          </div>
          <div className='mt-1 text-13 text-fg-2'>{t('tenants.empty.body')}</div>
        </div>
      ) : (
        <div className='overflow-x-auto rounded-md border border-line'>
          <table className='w-full border-collapse tabular-nums'>
            <thead>
              <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                <th className='px-3 py-2 font-medium'>{t('tenants.col.id')}</th>
                <th className='px-3 py-2 font-medium'>{t('tenants.col.name')}</th>
                <th className='px-3 py-2 font-medium'>{t('tenants.col.slug')}</th>
                <th className='px-3 py-2 font-medium'>{t('tenants.col.status')}</th>
                <th className='px-3 py-2 font-medium'>{t('tenants.col.created')}</th>
                <th className='px-3 py-2' />
              </tr>
            </thead>
            <tbody>
              {items.map((tnt) => {
                const meta = statusMeta(tnt.status);
                return (
                  <tr key={tnt.id} className='border-b border-line text-13 hover:bg-bg-1'>
                    <td className='px-3 py-2 text-fg-2'>{tnt.id}</td>
                    <td className='px-3 py-2'>{tnt.name}</td>
                    <td className='px-3 py-2 font-mono'>{tnt.slug}</td>
                    <td className='px-3 py-2'>
                      <Badge variant={meta.variant}>{t(meta.key)}</Badge>
                    </td>
                    <td className='px-3 py-2 text-fg-1'>{fmtDateSec(tnt.created_at)}</td>
                    <td className='px-3 py-2'>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        className='text-danger'
                        disabled={tnt.id === 1}
                        onClick={() => setDeleteTarget(tnt)}
                      >
                        {t('tenants.action.delete')}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <CreateTenantDialog open={createOpen} onOpenChange={setCreateOpen} />
      {deleteTarget && (
        <ConfirmDialog
          open
          title={t('delete.title')}
          body={t('delete.body', {
            name: deleteTarget.name,
            slug: deleteTarget.slug,
          })}
          confirmLabel={t('delete.confirm')}
          isPending={del.isPending}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            del.mutate(target.id, {
              onError: (e) => toast.error((e as Error).message),
            });
          }}
        />
      )}
    </div>
  );
}
