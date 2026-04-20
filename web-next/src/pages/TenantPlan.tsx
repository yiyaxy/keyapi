import { useTranslation } from 'react-i18next';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useTenantPlan } from '@/hooks/useTenantBilling';
import { fmtDateSec, fmtMoney, fmtNum } from '@/lib/format';

const QUOTA_PER_UNIT = 500_000;

function formatLimit(value: number, kind: 'quota' | 'count'): string | null {
  if (value < 0) return null;
  if (kind === 'quota') return fmtMoney(value / QUOTA_PER_UNIT);
  return fmtNum(value);
}

export function TenantPlanPage() {
  const { t } = useTranslation('tenant');
  const plan = useTenantPlan();

  if (plan.isPending) {
    return <Skeleton className='h-64 w-full' />;
  }
  if (plan.isError || !plan.data) {
    return (
      <InlineBanner
        level='danger'
        message={t('plan.load_failed')}
        onClose={() => void plan.refetch()}
      />
    );
  }

  const p = plan.data;
  const allowedModels = (p.allowed_models ?? '').trim();

  return (
    <div className='max-w-3xl space-y-4'>
      <Card>
        <CardHeader>
          <div className='flex items-center justify-between'>
            <CardTitle>{t('plan.title')}</CardTitle>
            <Badge variant='default'>{p.plan_name}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <dl className='grid grid-cols-1 gap-y-3 text-13 sm:grid-cols-2'>
            <Row label={t('plan.quota_limit')}>
              {formatLimit(p.quota_limit, 'quota') ?? t('plan.quota.unlimited')}
            </Row>
            <Row label={t('plan.rpm')}>
              {formatLimit(p.rpm_limit, 'count') ?? t('plan.quota.unlimited')}
            </Row>
            <Row label={t('plan.tpm')}>
              {formatLimit(p.tpm_limit, 'count') ?? t('plan.quota.unlimited')}
            </Row>
            <Row label={t('plan.max_members')}>
              {formatLimit(p.max_members, 'count') ?? t('plan.quota.unlimited')}
            </Row>
            <Row label={t('plan.max_tokens')}>
              {formatLimit(p.max_tokens, 'count') ?? t('plan.quota.unlimited')}
            </Row>
            <Row label={t('plan.max_channels')}>
              {formatLimit(p.max_channels, 'count') ?? t('plan.quota.unlimited')}
            </Row>
            <Row label={t('plan.allowed_models')}>
              {allowedModels === '' ? (
                <span className='text-fg-2'>{t('plan.allowed_models.all')}</span>
              ) : (
                <span className='font-mono text-12'>{allowedModels}</span>
              )}
            </Row>
            <Row label={t('plan.expires_at')}>
              {p.expires_at > 0 ? fmtDateSec(p.expires_at) : t('plan.never')}
            </Row>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex flex-col gap-1 border-b border-line pb-2 last:border-b-0'>
      <dt className='text-12 text-fg-2'>{label}</dt>
      <dd className='tabular-nums text-fg-0'>{children}</dd>
    </div>
  );
}
