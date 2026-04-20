import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type ModelMeta = {
  id: number;
  model_name: string;
  description?: string;
  icon?: string;
  tags?: string;
  vendor_id?: number;
  endpoints?: string;
  status: number;
  sync_official: number;
  created_time: number;
  updated_time: number;
  name_rule?: number;
  matched_count?: number;
};

export type ModelsPage = { items: ModelMeta[]; total: number };

export function useModelsMeta(q: { p?: number; page_size?: number; keyword?: string }) {
  return useQuery<ModelsPage>({
    queryKey: ['models-meta', 'list', q] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 30));
      const url = q.keyword
        ? `/api/models/search?keyword=${encodeURIComponent(q.keyword)}&${params.toString()}`
        : `/api/models/?${params.toString()}`;
      const res = await api.get<ModelsPage>(url);
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export type ModelMetaInput = {
  id?: number;
  model_name: string;
  description?: string;
  icon?: string;
  tags?: string;
  vendor_id?: number;
  endpoints?: string;
  status: number;
  name_rule?: number;
};

export function useCreateModelMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ModelMetaInput) => {
      await api.post('/api/models/', body);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['models-meta'] }),
  });
}

export function useUpdateModelMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ModelMetaInput) => {
      await api.put('/api/models/', body);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['models-meta'] }),
  });
}

export function useDeleteModelMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/models/${id}`);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['models-meta'] }),
  });
}
