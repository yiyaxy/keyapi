import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { PlanFormDialog } from '@/components/subscription/PlanFormDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageAction } from '@/hooks/usePageAction';
import {
  useAdminPatchPlanStatus,
  useAdminSubscriptionPlans,
  type SubscriptionPlanDTO,
} from '@/hooks/useSubscription';
import { fmtMoney } from '@/lib/format';

function statusVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'active':
      return 'default';
    case 'sold_out':
      return 'secondary';
    case 'archived':
      return 'outline';
    default:
      return 'outline';
  }
}

export function SubscriptionAdminPage() {
  const { t } = useTranslation('plan');
  const plans = useAdminSubscriptionPlans();
  const patch = useAdminPatchPlanStatus();
  const [editTarget, setEditTarget] = useState<SubscriptionPlanDTO | 'new' | null>(null);

  const items = plans.data ?? [];

  return (
    <div className='space-y-4'>
      <PageAction>
        <Button onClick={() => setEditTarget('new')}>{t('admin.page.create')}</Button>
      </PageAction>
      {plans.isError && (
        <InlineBanner
          level='danger'
          message={String((plans.error as Error).message)}
          onClose={() => void plans.refetch()}
        />
      )}
      {plans.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className='h-12 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('admin.empty')}
        </div>
      ) : (
        <div className='overflow-x-auto rounded-md border border-line'>
          <table className='w-full border-collapse tabular-nums'>
            <thead>
              <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                <th className='px-3 py-2 font-medium'>{t('admin.col.id')}</th>
                <th className='px-3 py-2 font-medium'>{t('admin.col.title')}</th>
                <th className='px-3 py-2 font-medium'>{t('admin.col.price')}</th>
                <th className='px-3 py-2 font-medium'>{t('admin.col.cycle')}</th>
                <th className='px-3 py-2 font-medium'>{t('admin.col.status')}</th>
                <th className='px-3 py-2 font-medium'>{t('admin.col.enabled')}</th>
                <th className='px-3 py-2' />
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className='border-b border-line text-13 hover:bg-bg-1'>
                  <td className='px-3 py-2 text-fg-2'>{p.id}</td>
                  <td className='px-3 py-2'>{p.title}</td>
                  <td className='px-3 py-2'>
                    {p.currency === 'USD'
                      ? fmtMoney(p.price_amount)
                      : `${p.currency} ${p.price_amount.toFixed(2)}`}
                  </td>
                  <td className='px-3 py-2'>
                    {p.duration_value} {p.duration_unit}
                  </td>
                  <td className='px-3 py-2'>
                    <Badge variant={statusVariant(p.status)}>
                      {t(`admin.status.${p.status}`, { defaultValue: p.status })}
                    </Badge>
                  </td>
                  <td className='px-3 py-2'>
                    <Badge variant={p.enabled ? 'default' : 'outline'}>
                      {p.enabled ? '✓' : '—'}
                    </Badge>
                  </td>
                  <td className='px-3 py-2'>
                    <div className='flex gap-1'>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        onClick={() => setEditTarget(p)}
                      >
                        {t('admin.action.edit')}
                      </Button>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        disabled={patch.isPending}
                        onClick={() =>
                          patch.mutate(
                            { id: p.id, enabled: !p.enabled },
                            {
                              onError: (e) => toast.error((e as Error).message),
                            }
                          )
                        }
                      >
                        {p.enabled ? t('admin.action.disable') : t('admin.action.enable')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PlanFormDialog
        open={editTarget !== null}
        plan={editTarget === 'new' || editTarget === null ? null : editTarget}
        onOpenChange={(o) => !o && setEditTarget(null)}
      />
    </div>
  );
}
