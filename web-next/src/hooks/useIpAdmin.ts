import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { api } from '@/lib/api';

export type IpLookupResult = {
  ip: string;
  country?: string;
  region?: string;
  city?: string;
  isp?: string;
  location?: string;
};

export type IpUsersResult = {
  login_users: Array<{ id: number; username: string; login_count?: number }>;
  api_users: Array<{ id: number; username: string; request_count?: number }>;
};

export type IpRecord = {
  id: number;
  user_id: number;
  username: string;
  ip: string;
  ip_location: string;
  login_type: string;
  user_agent: string;
  created_at: number;
};

export type IpBan = {
  id: number;
  ip: string;
  reason: string;
  expire_at: number;
  created_by: number;
  created_at: number;
};

export function useIpLookup(ip: string | null) {
  return useQuery<IpLookupResult>({
    queryKey: ['ip', 'lookup', ip] as const,
    enabled: Boolean(ip),
    queryFn: async () => {
      const res = await api.get<IpLookupResult>(
        `/api/ip/lookup?ip=${encodeURIComponent(ip!)}`
      );
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useIpUsers(ip: string | null) {
  return useQuery<IpUsersResult>({
    queryKey: ['ip', 'users', ip] as const,
    enabled: Boolean(ip),
    queryFn: async () => {
      const res = await api.get<IpUsersResult>(
        `/api/ip/users?ip=${encodeURIComponent(ip!)}`
      );
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useIpRecords(q: { ip: string | null; p?: number; page_size?: number }) {
  return useQuery<{ items: IpRecord[]; total: number }>({
    queryKey: ['ip', 'records', q] as const,
    enabled: Boolean(q.ip),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('ip', q.ip!);
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 20));
      const res = await api.get<{ items: IpRecord[]; total: number }>(
        `/api/ip/records?${params.toString()}`
      );
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useIpBans() {
  return useQuery<IpBan[]>({
    queryKey: ['ip', 'bans'] as const,
    queryFn: async () => {
      const res = await api.get<IpBan[]>('/api/ip/bans');
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useBanIp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { ip: string; reason?: string; expire_at?: number }) => {
      await api.post('/api/ip/ban', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ip', 'bans'] });
    },
  });
}

export function useUnbanIp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ip: string) => {
      await api.post('/api/ip/unban', { ip });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ip', 'bans'] });
    },
  });
}
