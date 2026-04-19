import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { api } from '@/lib/api';

export type AgentLog = {
  id: number;
  tenant_id: number;
  admin_id: number;
  agent_name: string;
  category: string;
  action: string;
  description: string;
  status: string;
  detail: string;
  created_at: number;
  updated_at: number;
};

export type AgentLogsFilter = {
  page?: number;
  page_size?: number;
  agent_name?: string;
  category?: string;
  status?: string;
  keyword?: string;
};

export function useAgentLogs(q: AgentLogsFilter) {
  return useQuery<AgentLog[]>({
    queryKey: ['agent-logs', 'list', q] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(q.page ?? 1));
      params.set('page_size', String(q.page_size ?? 30));
      if (q.agent_name) params.set('agent_name', q.agent_name);
      if (q.category) params.set('category', q.category);
      if (q.status) params.set('status', q.status);
      if (q.keyword) params.set('keyword', q.keyword);
      const res = await api.get<AgentLog[]>(`/api/agent-logs?${params.toString()}`);
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useDeleteAgentLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/agent-logs/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agent-logs'] });
    },
  });
}
