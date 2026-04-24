import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

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
  renew_price_amount: number;
  renew_currency: string;
  platform_markup: number;
  created_at: number;
  updated_at: number;
};

export type TenantBill = {
  id: number;
  tenant_id: number;
  period_start: number;
  period_end: number;
  quota_used: number;
  request_count: number;
  plan_name: string;
  status: string;
  closed_at: number;
  created_at: number;
  updated_at: number;
};

export type TenantLedgerEntry = {
  id: number;
  tenant_id: number;
  user_id: number;
  ledger_type: string;
  amount: number;
  balance_after: number;
  description: string;
  ref_type: string;
  ref_id: number;
  created_at: number;
};

export type TenantAuditEntry = {
  id: number;
  tenant_id: number;
  actor_user_id: number;
  actor_role: string;
  action: string;
  target: string;
  target_id: number;
  detail: string;
  client_ip: string;
  created_at: number;
};

export function useTenantPlan() {
  return useQuery<TenantPlan>({
    queryKey: ['tenant', 'plan'] as const,
    queryFn: async () => {
      const res = await api.get<TenantPlan>('/api/tenant/plan');
      return res.data;
    },
    staleTime: 30_000,
  });
}

// useUpdateTenantPlanMarkup 是租户管理员自助调整"对用户加价倍率"的 mutation。
// 对应后端 PUT /api/tenant/plan/markup，服务端限制范围 [0.1, 10]。
export function useUpdateTenantPlanMarkup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (markup: number) => {
      await api.put('/api/tenant/plan/markup', { platform_markup: markup });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant', 'plan'] });
    },
  });
}

export function useTenantBills(q: { p?: number; page_size?: number; status?: string }) {
  return useQuery<{ items: TenantBill[]; total: number }>({
    queryKey: ['tenant', 'bills', q] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 30));
      if (q.status) params.set('status', q.status);
      const res = await api.get<{ items: TenantBill[]; total: number }>(
        `/api/tenant/bills?${params.toString()}`
      );
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useRefreshCurrentBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.post('/api/tenant/bills/current/refresh');
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tenant', 'bills'] });
    },
  });
}

export function useTenantLedger(q: { p?: number; page_size?: number; ledger_type?: string }) {
  return useQuery<{ items: TenantLedgerEntry[]; total: number }>({
    queryKey: ['tenant', 'ledger', q] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 30));
      if (q.ledger_type) params.set('ledger_type', q.ledger_type);
      const res = await api.get<{ items: TenantLedgerEntry[]; total: number }>(
        `/api/tenant/ledger?${params.toString()}`
      );
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useTenantAudit(limit = 50) {
  return useQuery<TenantAuditEntry[]>({
    queryKey: ['tenant', 'audit', limit] as const,
    queryFn: async () => {
      const res = await api.get<TenantAuditEntry[] | { items: TenantAuditEntry[] }>(
        `/api/tenant/audit?limit=${limit}`
      );
      if (Array.isArray(res.data)) return res.data;
      return (res.data?.items ?? []) as TenantAuditEntry[];
    },
    staleTime: 15_000,
  });
}
