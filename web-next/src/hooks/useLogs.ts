import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export type LogType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const LOG_TYPE_LABELS: Record<LogType, string> = {
  0: 'unknown',
  1: 'topup',
  2: 'consume',
  3: 'manage',
  4: 'system',
  5: 'error',
  6: 'refund',
  7: 'channel_test',
};

export type LogRow = {
  id: number;
  tenant_id: number;
  user_id: number;
  created_at: number;
  type: LogType;
  content: string;
  username: string;
  token_name: string;
  model_name: string;
  quota: number;
  prompt_tokens: number;
  completion_tokens: number;
  use_time: number;
  is_stream: boolean;
  channel: number;
  channel_name?: string;
  token_id: number;
  group: string;
  ip: string;
  request_id?: string;
  other: string;
};

export type LogsQuery = {
  type?: LogType;
  token_name?: string;
  model_name?: string;
  group?: string;
  request_id?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  p?: number;
  page_size?: number;
};

export type LogsPage = { items: LogRow[]; total: number };

export function useUserLogs(query: LogsQuery) {
  return useQuery<LogsPage>({
    queryKey: qk.logs.self(query),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (query.type !== undefined && query.type !== 0) {
        params.set('type', String(query.type));
      }
      if (query.token_name) params.set('token_name', query.token_name);
      if (query.model_name) params.set('model_name', query.model_name);
      if (query.group) params.set('group', query.group);
      if (query.request_id) params.set('request_id', query.request_id);
      if (query.start_timestamp) {
        params.set('start_timestamp', String(query.start_timestamp));
      }
      if (query.end_timestamp) {
        params.set('end_timestamp', String(query.end_timestamp));
      }
      params.set('p', String(query.p ?? 1));
      params.set('page_size', String(query.page_size ?? 50));
      const res = await api.get<LogsPage>(`/api/log/self?${params.toString()}`);
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export type AdminLogsQuery = LogsQuery & {
  username?: string;
  channel?: number;
  ip?: string;
};

export function useAdminLogs(query: AdminLogsQuery) {
  return useQuery<LogsPage>({
    queryKey: ['logs', 'admin', query],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (query.type !== undefined && query.type !== 0) {
        params.set('type', String(query.type));
      }
      if (query.token_name) params.set('token_name', query.token_name);
      if (query.model_name) params.set('model_name', query.model_name);
      if (query.group) params.set('group', query.group);
      if (query.request_id) params.set('request_id', query.request_id);
      if (query.username) params.set('username', query.username);
      if (query.ip) params.set('ip', query.ip);
      if (query.channel !== undefined && query.channel > 0) {
        params.set('channel', String(query.channel));
      }
      if (query.start_timestamp) {
        params.set('start_timestamp', String(query.start_timestamp));
      }
      if (query.end_timestamp) {
        params.set('end_timestamp', String(query.end_timestamp));
      }
      params.set('p', String(query.p ?? 1));
      params.set('page_size', String(query.page_size ?? 50));
      const res = await api.get<LogsPage>(`/api/log/?${params.toString()}`);
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}
