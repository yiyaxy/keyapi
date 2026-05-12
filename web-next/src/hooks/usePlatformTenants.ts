import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Tenant } from '@/hooks/useTenant';
import { api } from '@/lib/api';

const keys = {
  listRoot: ['platform', 'tenants'] as const,
  list: (q: PlatformTenantsQuery) => ['platform', 'tenants', q] as const,
  plans: ['platform', 'tenant-plans'] as const,
  features: (tenantId: number) => ['platform', 'tenant-features', tenantId] as const,
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

export type PlatformTenantsQuery = {
  p?: number;
  page_size?: number;
};

export type PlatformTenantsPage = {
  items: Tenant[];
  total: number;
  page: number;
  page_size: number;
};

export function usePlatformTenants(q: PlatformTenantsQuery = {}) {
  return useQuery<PlatformTenantsPage>({
    queryKey: keys.list(q),
    queryFn: () => fetchPlatformTenants(q),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export async function fetchPlatformTenants(
  q: PlatformTenantsQuery = {}
): Promise<PlatformTenantsPage> {
  const params = new URLSearchParams();
  params.set('p', String(q.p ?? 1));
  params.set('page_size', String(q.page_size ?? 50));
  const res = await api.get<PlatformTenantsPage | Tenant[]>(
    `/api/platform/tenants/?${params.toString()}`
  );
  if (Array.isArray(res.data)) {
    return {
      items: res.data,
      total: res.data.length,
      page: q.p ?? 1,
      page_size: q.page_size ?? res.data.length,
    };
  }
  return {
    items: Array.isArray(res.data.items) ? res.data.items : [],
    total: res.data.total ?? 0,
    page: res.data.page ?? q.p ?? 1,
    page_size: res.data.page_size ?? q.page_size ?? 50,
  };
}

export type CreateTenantPayload = {
  name: string;
  slug: string;
  admin_username: string;
  admin_password: string;
  admin_email?: string;
  admin_display_name?: string;
};

export type BatchCreateTenantsPayload = {
  count: number;
};

export type BatchCreatedTenant = {
  tenant: Tenant;
  admin_user_id: number;
  admin_username: string;
  admin_password: string;
};

export type BatchCreateTenantsResult = {
  items: BatchCreatedTenant[];
  total: number;
};

export type ResetTenantAdminPasswordResult = {
  tenant_id: number;
  admin_user_id: number;
  admin_username: string;
  password: string;
};

export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateTenantPayload) => {
      const res = await api.post<Tenant>('/api/platform/tenants/', body);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.listRoot });
      void qc.invalidateQueries({ queryKey: keys.plans });
    },
  });
}

export function useBatchCreateTenants() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: BatchCreateTenantsPayload) => {
      const res = await api.post<BatchCreateTenantsResult>('/api/platform/tenants/batch', body);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.listRoot });
      void qc.invalidateQueries({ queryKey: keys.plans });
    },
  });
}

export function useResetTenantAdminPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await api.post<ResetTenantAdminPasswordResult>(
        `/api/platform/tenants/${id}/reset-admin-password`
      );
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.listRoot }),
  });
}

export function useUpdateTenantStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: number }) => {
      const res = await api.put<Tenant>(`/api/platform/tenants/${id}`, { status });
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.listRoot }),
  });
}

export function useDeleteTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/platform/tenants/${id}`);
      return id;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.listRoot }),
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

// Per-tenant feature toggles managed by platform admins.
// Mirrors controller/tenant/features.go: a flat record of boolean flags.
// Currently only chat_history; future flags can be appended without breaking
// callers because the type carries each known flag explicitly.
export type TenantFeatures = {
  chat_history: boolean;
};

export type UpdateTenantFeaturesPayload = Partial<TenantFeatures>;

export function useTenantFeatures(tenantId: number | null) {
  return useQuery<TenantFeatures>({
    enabled: tenantId != null && tenantId > 0,
    queryKey: tenantId != null ? keys.features(tenantId) : ['platform', 'tenant-features', 0],
    queryFn: async () => {
      const res = await api.get<TenantFeatures>(`/api/platform/tenants/${tenantId}/features`);
      return res.data;
    },
    staleTime: 15_000,
  });
}

export function useUpdateTenantFeatures(tenantId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateTenantFeaturesPayload) => {
      const res = await api.put<TenantFeatures>(`/api/platform/tenants/${tenantId}/features`, body);
      return res.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(keys.features(tenantId), data);
    },
  });
}
