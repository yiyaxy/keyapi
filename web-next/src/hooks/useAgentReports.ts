import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { api } from '@/lib/api';

export type AgentReport = {
  id: number;
  tenant_id: number;
  title: string;
  report_type: string;
  summary: string;
  html_content?: string;
  agent_name: string;
  status: string;
  created_at: number;
  updated_at: number;
};

export type AgentReportsFilter = {
  page?: number;
  page_size?: number;
  report_type?: string;
  keyword?: string;
};

export function useAgentReports(q: AgentReportsFilter) {
  return useQuery<AgentReport[]>({
    queryKey: ['agent-reports', 'list', q] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(q.page ?? 1));
      params.set('page_size', String(q.page_size ?? 30));
      if (q.report_type) params.set('report_type', q.report_type);
      if (q.keyword) params.set('keyword', q.keyword);
      const res = await api.get<AgentReport[]>(
        `/api/agent-reports?${params.toString()}`
      );
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useAgentReportDetail(id: number | null) {
  return useQuery<AgentReport>({
    queryKey: ['agent-reports', 'detail', id] as const,
    enabled: id !== null,
    queryFn: async () => {
      const res = await api.get<AgentReport>(`/api/agent-reports/${id}`);
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useDeleteAgentReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/agent-reports/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agent-reports'] });
    },
  });
}
