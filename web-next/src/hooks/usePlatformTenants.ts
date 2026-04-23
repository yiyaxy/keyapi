import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Tenant } from '@/hooks/useTenant';
import { api } from '@/lib/api';

const keys = {
  list: ['platform', 'tenants'] as const,
  plans: ['platform', 'tenant-plans'] as const,
};

// TenantPlan mirrors model.TenantPlan — every field admins see/edit on
// the platform plan dialog. RenewPriceAmount is CNY cents.
export type TenantPlan = {
  id: number;
  tenant_id: number;
  plan_name: string;
  quota_limit: number;
  rpm_limit: number;
  tpm_limit: number;
  max_members: number;
  max_tokens: number;
  max_channels: number;
  allowed_models: string;
  status: number;
  expires_at: number;
  grace_period_seconds: number;
  renew_period_days: number;
  renew_price_amount: number; // CNY cents
  renew_currency: string;
  platform_quota_cap: number;
  platform_quota_period: 'none' | 'daily' | 'monthly';
  platform_quota_used: number;
  platform_quota_period_start: number;
  created_at: number;
  updated_at: number;
};

export type UpdateTenantPlanPayload = {
  plan_name?: string;
  quota_limit?: number;
  rpm_limit?: number;
  tpm_limit?: number;
  max_members?: number;
  max_tokens?: number;
  max_channels?: number;
  allowed_models?: string;
  status?: number;
  expires_at?: number;
  grace_period_seconds?: number;
  renew_period_days?: number;
  renew_price_amount?: number;
  renew_currency?: string;
  platform_quota_cap?: number;
  platform_quota_period?: 'none' | 'daily' | 'monthly';
};

export function usePlatformTenants() {
  return useQuery<Tenant[]>({
    queryKey: keys.list,
    queryFn: async () => {
      const res = await api.get<Tenant[]>('/api/platform/tenants/');
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 15_000,
  });
}

export type CreateTenantPayload = {
  name: string;
  slug: string;
  admin_username: string;
  admin_password: string;
  admin_email?: string;
  admin_display_name?: string;
};

export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateTenantPayload) => {
      const res = await api.post<Tenant>('/api/platform/tenants/', body);
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.list }),
  });
}

export function useDeleteTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/platform/tenants/${id}`);
      return id;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.list }),
  });
}

// Platform-admin list of all tenant plans. We paginate by tenant on the
// client because the endpoint returns the full flat list — typical
// deployments have ≤100 tenants so this is fine.
export function useTenantPlans() {
  return useQuery<TenantPlan[]>({
    queryKey: keys.plans,
    queryFn: async () => {
      const res = await api.get<TenantPlan[]>('/api/platform/tenants/plans');
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 15_000,
  });
}

export function useUpdateTenantPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body: UpdateTenantPlanPayload }) => {
      const res = await api.put<TenantPlan>(`/api/platform/tenants/${id}/plan`, body);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.plans });
    },
  });
}
