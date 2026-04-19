import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { api } from '@/lib/api';

export const PROMPT_RULE_TYPE = {
  REPLACE: 1,
  KEYWORD: 2,
  RESPONSE: 3,
  REWRITE: 4,
} as const;

export type PromptRule = {
  id: number;
  name: string;
  type: number;
  keyword: string;
  replacement: string;
  channel_id: number;
  enabled: boolean;
  priority: number;
  rewrite_channel_id: number;
  rewrite_model: string;
  created_at: number;
};

export type PromptRuleInput = {
  id?: number;
  name: string;
  type: number;
  keyword: string;
  replacement: string;
  channel_id: number;
  enabled: boolean;
  priority: number;
  rewrite_channel_id: number;
  rewrite_model: string;
};

export function usePromptRules(q: {
  p?: number;
  page_size?: number;
  keyword?: string;
}) {
  return useQuery<{ items: PromptRule[]; total: number }>({
    queryKey: ['prompt-rules', 'list', q] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 30));
      if (q.keyword) params.set('keyword', q.keyword);
      const res = await api.get<{ items: PromptRule[]; total: number }>(
        `/api/prompt_rule/?${params.toString()}`
      );
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useCreatePromptRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: PromptRuleInput) => {
      await api.post('/api/prompt_rule/', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['prompt-rules'] });
    },
  });
}

export function useUpdatePromptRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: PromptRuleInput) => {
      await api.put('/api/prompt_rule/', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['prompt-rules'] });
    },
  });
}

export function useDeletePromptRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/prompt_rule/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['prompt-rules'] });
    },
  });
}
