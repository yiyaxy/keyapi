import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { CreateTenantDialog } from '@/components/platform/CreateTenantDialog';
import { TenantChannelAccessDialog } from '@/components/platform/TenantChannelAccessDialog';
import { TenantFeaturesDialog } from '@/components/platform/TenantFeaturesDialog';
import { TenantPlanEditorDialog } from '@/components/platform/TenantPlanEditorDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { PageAction } from '@/hooks/usePageAction';
import {
  fetchPlatformTenants,
  useDeleteTenant,
  usePlatformTenants,
  useResetTenantAdminPassword,
  useTenantPlans,
  useUpdateTenantStatus,
  type TenantPlan,
} from '@/hooks/usePlatformTenants';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import type { Tenant } from '@/hooks/useTenant';
import { fmtDateSec, fmtDisplay } from '@/lib/format';

const PAGE_SIZE = 50;
const EXPORT_PAGE_SIZE = 100;
const TENANT_DOMAIN = 'etopstar.com';

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

function tenantAccessUrl(slug: string): string {
  return `https://${slug}.${TENANT_DOMAIN}/`;
}

function tenantAdminUsername(tnt: Tenant): string {
  return tnt.admin_username?.trim() ?? '';
}

function tenantDefaultPassword(tnt: Tenant): string {
  const username = tenantAdminUsername(tnt);
  return username ? `${username}123` : '';
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function PlatformTenantsPage() {
  const { t } = useTranslation('platform');
  const [page, setPage] = useState(1);
  const tenants = usePlatformTenants({ p: page, page_size: PAGE_SIZE });
  const plans = useTenantPlans();
  const publicConfig = usePublicConfig();
  const cnyConfig = { ...publicConfig, quota_display_type: 'CNY' as const };
  const del = useDeleteTenant();
  const updateStatus = useUpdateTenantStatus();
  const resetPassword = useResetTenantAdminPassword();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Tenant | null>(null);
  const [statusTarget, setStatusTarget] = useState<Tenant | null>(null);
  const [resetTarget, setResetTarget] = useState<Tenant | null>(null);
  const [planTarget, setPlanTarget] = useState<{ tenant: Tenant; plan: TenantPlan } | null>(null);
  const [accessTarget, setAccessTarget] = useState<Tenant | null>(null);
  const [featuresTarget, setFeaturesTarget] = useState<Tenant | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const items = tenants.data?.items ?? [];
  const total = tenants.data?.total ?? 0;
  const planByTenant = new Map<number, TenantPlan>();
  for (const p of plans.data ?? []) planByTenant.set(p.tenant_id, p);

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > pageCount) setPage(pageCount);
  }, [page, total]);

  async function exportTenants() {
    setIsExporting(true);
    try {
      const first = await fetchPlatformTenants({ p: 1, page_size: EXPORT_PAGE_SIZE });
      const all = [...first.items];
      const pageCount = Math.max(1, Math.ceil(first.total / EXPORT_PAGE_SIZE));
      for (let nextPage = 2; nextPage <= pageCount; nextPage += 1) {
        const next = await fetchPlatformTenants({ p: nextPage, page_size: EXPORT_PAGE_SIZE });
        all.push(...next.items);
      }
      downloadCsv('platform-tenants.csv', [
        ['租户名称', 'Slug', '访问地址', '管理员账号', '密码', '创建时间', '最近登录时间'],
        ...all.map((tnt) => [
          tnt.name,
          tnt.slug,
          tenantAccessUrl(tnt.slug),
          tenantAdminUsername(tnt) || '未找到管理员账号',
          tenantDefaultPassword(tnt),
          fmtDateSec(tnt.created_at),
          fmtDateSec(tnt.last_login_at ?? 0),
        ]),
      ]);
      toast.success(`已导出 ${all.length} 个租户`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className='space-y-4'>
      <PageAction>
        <div className='flex items-center gap-2'>
          <Button variant='secondary' disabled={isExporting} onClick={() => void exportTenants()}>
            {isExporting ? '导出中...' : '导出租户'}
          </Button>
          <Button onClick={() => setCreateOpen(true)}>{t('tenants.page.create')}</Button>
        </div>
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
      ) : total === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center'>
          <div className='text-15 font-medium text-fg-0'>{t('tenants.empty.title')}</div>
          <div className='mt-1 text-13 text-fg-2'>{t('tenants.empty.body')}</div>
        </div>
      ) : (
        <>
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
                  <th className='px-3 py-2 font-medium'>最近登录时间</th>
                  <th className='px-3 py-2 font-medium'>管理员账号</th>
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
                      <td className='px-3 py-2 text-fg-1'>{fmtDateSec(tnt.last_login_at ?? 0)}</td>
                      <td className='px-3 py-2 font-mono text-fg-1'>
                        {tenantAdminUsername(tnt) || '-'}
                      </td>
                      <td className='px-3 py-2 text-right'>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type='button'
                              variant='ghost'
                              size='sm'
                              className='h-8 w-8 p-0'
                              aria-label='租户操作'
                            >
                              <MoreHorizontal className='h-4 w-4' />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align='end' className='w-40'>
                            <DropdownMenuItem
                              disabled={!planByTenant.has(tnt.id)}
                              onSelect={() => {
                                const p = planByTenant.get(tnt.id);
                                if (p) setPlanTarget({ tenant: tnt, plan: p });
                              }}
                            >
                              {t('tenants.action.plan')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setAccessTarget(tnt)}>
                              {t('tenants.action.channel_access')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setFeaturesTarget(tnt)}>
                              {t('tenants.action.features', { defaultValue: '功能开关' })}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!tenantAdminUsername(tnt) || resetPassword.isPending}
                              onSelect={() => setResetTarget(tnt)}
                            >
                              重置密码
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={tnt.id === 1 || updateStatus.isPending}
                              onSelect={() => setStatusTarget(tnt)}
                            >
                              {isSuspended ? '启用' : '禁用'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className='text-danger'
                              disabled={tnt.id === 1}
                              onSelect={() => setDeleteTarget(tnt)}
                            >
                              {t('tenants.action.delete')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <LogsPagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </>
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
      {resetTarget && (
        <ConfirmDialog
          open
          title='重置租户管理员密码'
          body={`确认把租户 ${resetTarget.name}（${resetTarget.slug}）的管理员 ${tenantAdminUsername(resetTarget) || '-'} 密码重置为 ${tenantDefaultPassword(resetTarget) || '-'}？`}
          confirmLabel='重置密码'
          confirmationText={resetTarget.slug}
          confirmationLabel={`请输入租户 slug「${resetTarget.slug}」确认重置密码`}
          isPending={resetPassword.isPending}
          onOpenChange={(o) => !o && setResetTarget(null)}
          onConfirm={() => {
            const target = resetTarget;
            resetPassword.mutate(target.id, {
              onSuccess: (result) => {
                toast.success(`密码已重置为 ${result.password}`);
                setResetTarget(null);
              },
              onError: (error) => toast.error((error as Error).message),
            });
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
