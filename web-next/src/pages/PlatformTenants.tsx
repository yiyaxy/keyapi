import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { CreateTenantDialog } from '@/components/platform/CreateTenantDialog';
import { TenantChannelAccessDialog } from '@/components/platform/TenantChannelAccessDialog';
import { TenantFeaturesDialog } from '@/components/platform/TenantFeaturesDialog';
import { TenantPlanEditorDialog } from '@/components/platform/TenantPlanEditorDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageAction } from '@/hooks/usePageAction';
import {
  useDeleteTenant,
  usePlatformTenants,
  useTenantPlans,
  useUpdateTenantStatus,
  type TenantPlan,
} from '@/hooks/usePlatformTenants';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import type { Tenant } from '@/hooks/useTenant';
import { fmtDateSec, fmtDisplay } from '@/lib/format';

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

function formatPlatformQuotaUsage(
  plan: TenantPlan | undefined,
  cfg: ReturnType<typeof usePublicConfig>
): string {
  if (!plan) return '-';
  const used = fmtDisplay(plan.platform_quota_used ?? 0, cfg);
  const cap = plan.platform_quota_cap;
  if (cap < 0) return `${used} / 不限`;
  if (cap === 0) return `${used} / 禁用`;
  return `${used} / ${fmtDisplay(cap, cfg)}`;
}

export function PlatformTenantsPage() {
  const { t } = useTranslation('platform');
  const tenants = usePlatformTenants();
  const plans = useTenantPlans();
  const publicConfig = usePublicConfig();
  const cnyConfig = { ...publicConfig, quota_display_type: 'CNY' as const };
  const del = useDeleteTenant();
  const updateStatus = useUpdateTenantStatus();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Tenant | null>(null);
  const [statusTarget, setStatusTarget] = useState<Tenant | null>(null);
  const [planTarget, setPlanTarget] = useState<{ tenant: Tenant; plan: TenantPlan } | null>(null);
  const [accessTarget, setAccessTarget] = useState<Tenant | null>(null);
  const [featuresTarget, setFeaturesTarget] = useState<Tenant | null>(null);

  const items = tenants.data ?? [];
  const planByTenant = new Map<number, TenantPlan>();
  for (const p of plans.data ?? []) planByTenant.set(p.tenant_id, p);

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
          <div className='text-15 font-medium text-fg-0'>{t('tenants.empty.title')}</div>
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
                <th className='px-3 py-2 font-medium'>平台渠道额度</th>
                <th className='px-3 py-2 font-medium'>{t('tenants.col.created')}</th>
                <th className='px-3 py-2' />
              </tr>
            </thead>
            <tbody>
              {items.map((tnt) => {
                const meta = statusMeta(tnt.status);
                const plan = planByTenant.get(tnt.id);
                const isSuspended = tnt.status === 2;
                return (
                  <tr key={tnt.id} className='border-b border-line text-13 hover:bg-bg-1'>
                    <td className='px-3 py-2 text-fg-2'>{tnt.id}</td>
                    <td className='px-3 py-2'>{tnt.name}</td>
                    <td className='px-3 py-2 font-mono'>{tnt.slug}</td>
                    <td className='px-3 py-2'>
                      <Badge variant={meta.variant}>{t(meta.key)}</Badge>
                    </td>
                    <td className='px-3 py-2 text-fg-1'>
                      {formatPlatformQuotaUsage(plan, cnyConfig)}
                    </td>
                    <td className='px-3 py-2 text-fg-1'>{fmtDateSec(tnt.created_at)}</td>
                    <td className='px-3 py-2 text-right'>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        disabled={!planByTenant.has(tnt.id)}
                        onClick={() => {
                          const p = planByTenant.get(tnt.id);
                          if (p) setPlanTarget({ tenant: tnt, plan: p });
                        }}
                      >
                        {t('tenants.action.plan')}
                      </Button>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        onClick={() => setAccessTarget(tnt)}
                      >
                        {t('tenants.action.channel_access')}
                      </Button>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        onClick={() => setFeaturesTarget(tnt)}
                      >
                        {t('tenants.action.features', { defaultValue: '功能开关' })}
                      </Button>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        disabled={tnt.id === 1 || updateStatus.isPending}
                        onClick={() => setStatusTarget(tnt)}
                      >
                        {isSuspended ? '启用' : '禁用'}
                      </Button>
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
      {planTarget && (
        <TenantPlanEditorDialog
          open
          tenantName={planTarget.tenant.name}
          plan={planTarget.plan}
          onOpenChange={(o) => !o && setPlanTarget(null)}
        />
      )}
      {accessTarget && (
        <TenantChannelAccessDialog
          open
          tenantId={accessTarget.id}
          tenantName={accessTarget.name}
          onOpenChange={(o) => !o && setAccessTarget(null)}
        />
      )}
      {featuresTarget && (
        <TenantFeaturesDialog
          open
          tenantId={featuresTarget.id}
          tenantName={featuresTarget.name}
          onOpenChange={(o) => !o && setFeaturesTarget(null)}
        />
      )}
      {statusTarget && (
        <ConfirmDialog
          open
          title={statusTarget.status === 2 ? '启用租户' : '禁用租户'}
          body={
            statusTarget.status === 2
              ? `确认启用租户 ${statusTarget.name}（${statusTarget.slug}）？启用后该租户可恢复访问。`
              : `确认禁用租户 ${statusTarget.name}（${statusTarget.slug}）？禁用后该租户流量会立即停止。`
          }
          confirmLabel={statusTarget.status === 2 ? '启用' : '禁用'}
          danger={statusTarget.status !== 2}
          isPending={updateStatus.isPending}
          onOpenChange={(o) => !o && setStatusTarget(null)}
          onConfirm={() => {
            const target = statusTarget;
            const nextStatus = target.status === 2 ? 1 : 2;
            setStatusTarget(null);
            updateStatus.mutate(
              { id: target.id, status: nextStatus },
              {
                onSuccess: () => toast.success(nextStatus === 1 ? '租户已启用' : '租户已禁用'),
                onError: (e) => toast.error((e as Error).message),
              }
            );
          }}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          open
          title={t('delete.title')}
          body={t('delete.body', {
            name: deleteTarget.name,
            slug: deleteTarget.slug,
          })}
          confirmLabel={t('delete.confirm')}
          confirmationText={deleteTarget.slug}
          confirmationLabel={`请输入租户 slug「${deleteTarget.slug}」确认删除`}
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
