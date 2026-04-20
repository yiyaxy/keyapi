import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useActivateSubscription,
  useSubscriptionPlans,
  useSubscriptionSelf,
  type SubscriptionPlanDTO,
} from '@/hooks/useSubscription';
import { fmtDateSec, fmtMoney } from '@/lib/format';

const QUOTA_PER_UNIT = 500_000;

function formatPrice(p: SubscriptionPlanDTO): string {
  if (p.currency === 'USD') return fmtMoney(p.price_amount);
  return `${p.currency} ${p.price_amount.toFixed(2)}`;
}

function cycleLabel(p: SubscriptionPlanDTO, t: ReturnType<typeof useTranslation>['t']): string {
  const v = p.duration_value || 1;
  switch (p.duration_unit) {
    case 'year':
      return t('plans.duration.year', { value: v });
    case 'day':
      return t('plans.duration.day', { value: v });
    default:
      return t('plans.duration.month', { value: v });
  }
}

export function PlanPage() {
  const { t } = useTranslation('plan');
  const plans = useSubscriptionPlans();
  const self = useSubscriptionSelf();
  const activate = useActivateSubscription();

  const items = plans.data ?? [];

  return (
    <div className='space-y-6'>
      <header>
        <h1 className='text-20 font-semibold'>{t('page.title')}</h1>
        <p className='mt-1 text-13 text-fg-2'>{t('page.sub')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t('current.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {self.isPending ? (
            <Skeleton className='h-16 w-full' />
          ) : self.data?.active ? (
            <div className='space-y-1 text-13'>
              <div className='text-15 font-medium'>{self.data.plan_title}</div>
              {self.data.expires_at && (
                <div className='text-12 text-fg-2'>
                  {t('current.expires', { date: fmtDateSec(self.data.expires_at) })}
                </div>
              )}
              {self.data.total_quota !== undefined &&
                self.data.used_quota !== undefined &&
                self.data.total_quota > 0 && (
                  <div className='text-12 text-fg-2'>
                    {t('current.used_quota', {
                      used: fmtMoney(self.data.used_quota / QUOTA_PER_UNIT),
                      total: fmtMoney(self.data.total_quota / QUOTA_PER_UNIT),
                    })}
                  </div>
                )}
              {self.data.purchase_count !== undefined && (
                <div className='text-12 text-fg-2'>
                  {t('current.purchase_count', {
                    count: self.data.purchase_count,
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className='text-13 text-fg-2'>{t('current.none')}</div>
          )}
        </CardContent>
      </Card>

      {plans.isError && (
        <InlineBanner
          level='danger'
          message={String((plans.error as Error).message)}
          onClose={() => void plans.refetch()}
        />
      )}
      {plans.isPending ? (
        <div className='grid grid-cols-1 gap-4 md:grid-cols-3'>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className='h-56 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('plans.empty')}
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-4 md:grid-cols-3'>
          {items.map((p) => {
            const isCurrent = self.data?.active && self.data.plan_id === p.id;
            const soldOut = p.status === 'sold_out';
            const highlights = p.promo_highlights
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);
            return (
              <Card key={p.id} className='flex flex-col'>
                <CardHeader>
                  <div className='flex items-center justify-between'>
                    <CardTitle>{p.title}</CardTitle>
                    {isCurrent ? (
                      <Badge variant='default'>{t('plans.cta.current')}</Badge>
                    ) : soldOut ? (
                      <Badge variant='destructive'>{t('plans.status.sold_out')}</Badge>
                    ) : null}
                  </div>
                  {p.subtitle && <p className='text-12 text-fg-2'>{p.subtitle}</p>}
                </CardHeader>
                <CardContent className='flex flex-1 flex-col gap-4'>
                  <div className='tabular-nums'>
                    <div className='text-32 font-semibold'>{formatPrice(p)}</div>
                    <div className='text-12 text-fg-2'>
                      {t('plans.price.per_cycle', {
                        price: '',
                        cycle: cycleLabel(p, t),
                      })
                        .replace('/', '/')
                        .trim() || cycleLabel(p, t)}
                    </div>
                  </div>
                  {highlights.length > 0 && (
                    <ul className='space-y-1 text-13 text-fg-1'>
                      {highlights.map((h, idx) => (
                        <li key={idx}>• {h}</li>
                      ))}
                    </ul>
                  )}
                  <div className='mt-auto'>
                    <Button
                      type='button'
                      className='w-full'
                      disabled={isCurrent || soldOut || !p.enabled || activate.isPending}
                      onClick={() =>
                        activate.mutate(p.id, {
                          onSuccess: () => {
                            toast.success(t('activate.success'));
                            void self.refetch();
                          },
                          onError: (e) => toast.error((e as Error).message),
                        })
                      }
                    >
                      {isCurrent ? t('plans.cta.current') : t('plans.cta.activate')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
