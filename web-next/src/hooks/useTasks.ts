import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type TaskStatus =
  | 'NOT_START'
  | 'SUBMITTED'
  | 'QUEUED'
  | 'IN_PROGRESS'
  | 'FAILURE'
  | 'SUCCESS'
  | 'UNKNOWN';

export type AsyncTask = {
  id: number;
  created_at: number;
  updated_at: number;
  task_id: string;
  platform: string;
  user_id: number;
  group: string;
  channel_id?: number;
  quota: number;
  action: string;
  status: TaskStatus | string;
  fail_reason: string;
  result_url?: string;
  submit_time: number;
  start_time: number;
  finish_time: number;
  progress: string;
  properties?: {
    input?: string;
    upstream_model_name?: string;
    origin_model_name?: string;
    [key: string]: unknown;
  };
  username?: string;
  data?: unknown;
};

export type TasksQuery = {
  platform?: string;
  task_id?: string;
  status?: string;
  action?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  p?: number;
  page_size?: number;
};

export type TasksPageResponse = {
  items: AsyncTask[];
  total: number;
  page: number;
  page_size: number;
};

export function useMyTasks(query: TasksQuery) {
  return useQuery<TasksPageResponse>({
    queryKey: ['tasks', 'self', query] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (query.platform) params.set('platform', query.platform);
      if (query.task_id) params.set('task_id', query.task_id);
      if (query.status) params.set('status', query.status);
      if (query.action) params.set('action', query.action);
      if (query.start_timestamp) params.set('start_timestamp', String(query.start_timestamp));
      if (query.end_timestamp) params.set('end_timestamp', String(query.end_timestamp));
      params.set('p', String(query.p ?? 1));
      params.set('page_size', String(query.page_size ?? 20));
      const res = await api.get<TasksPageResponse>(`/api/task/self?${params.toString()}`);
      return res.data;
    },
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}
