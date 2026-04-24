import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { usePublicConfig, type PublicConfig } from '@/hooks/usePublicConfig';
import {
  useTenantPlan,
  useUpdateTenantPlanMarkup,
} from '@/hooks/useTenantBilling';
import { fmtDateSec, fmtDisplay, fmtNum } from '@/lib/format';

function formatLimit(
  value: number,
  kind: 'quota' | 'count',
  cfg: PublicConfig
): string | null {
  if (value < 0) return null;
  if (kind === 'quota') return fmtDisplay(value, cfg);
  return fmtNum(value);
}

export function TenantPlanPage() {
  const { t } = useTranslation('tenant');
  const cfg = usePublicConfig();
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
              {formatLimit(p.quota_limit, 'quota', cfg) ?? t('plan.quota.unlimited')}
            </Row>
            <Row label={t('plan.rpm')}>
              {formatLimit(p.rpm_limit, 'count', cfg) ?? t('plan.quota.unlimited')}
            </Row>
            <Row label={t('plan.tpm')}>
              {formatLimit(p.tpm_limit, 'count', cfg) ?? t('plan.quota.unlimited')}
            </Row>
            <Row label={t('plan.max_members')}>
              {formatLimit(p.max_members, 'count', cfg) ?? t('plan.quota.unlimited')}
            </Row>
            <Row label={t('plan.max_tokens')}>
              {formatLimit(p.max_tokens, 'count', cfg) ?? t('plan.quota.unlimited')}
            </Row>
            <Row label={t('plan.max_channels')}>
              {formatLimit(p.max_channels, 'count', cfg) ?? t('plan.quota.unlimited')}
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

      <MarkupCard currentMarkup={p.platform_markup ?? 1} />
    </div>
  );
}

function MarkupCard({ currentMarkup }: { currentMarkup: number }) {
  const { t } = useTranslation('tenant');
  const update = useUpdateTenantPlanMarkup();
  const [input, setInput] = useState<string>(() => String(currentMarkup));

  // 后端更新后 currentMarkup 会变（useTenantPlan invalidate 后），
  // 重置本地输入到最新值——避免用户刚保存又看到旧输入残留。
  useEffect(() => {
    setInput(String(currentMarkup));
  }, [currentMarkup]);

  const parsed = Number(input);
  const valid = Number.isFinite(parsed) && parsed >= 0.1 && parsed <= 10;
  const dirty = valid && parsed !== currentMarkup;

  function onSave() {
    if (!dirty) return;
    update.mutate(parsed, {
      onSuccess: () => toast.success(t('plan.markup.saved')),
      onError: (e) => toast.error((e as Error).message),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('plan.markup.title')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        <p className='text-12 leading-relaxed text-fg-2'>
          {t('plan.markup.hint')}
        </p>
        <div className='flex items-end gap-2'>
          <div className='space-y-1'>
            <Label htmlFor='markup-input'>{t('plan.markup.field')}</Label>
            <div className='flex items-center gap-2'>
              <Input
                id='markup-input'
                type='number'
                min={0.1}
                max={10}
                step={0.05}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className='w-32 tabular-nums'
              />
              <span className='text-13 text-fg-2'>x</span>
            </div>
          </div>
          <Button
            type='button'
            onClick={onSave}
            disabled={!dirty || update.isPending}
          >
            {t('plan.markup.save')}
          </Button>
        </div>
        <p className='text-12 text-fg-2'>
          {t('plan.markup.current', { value: currentMarkup })}
        </p>
        {!valid && (
          <p className='text-12 text-danger'>{t('plan.markup.out_of_range')}</p>
        )}
      </CardContent>
    </Card>
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
