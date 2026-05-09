import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export type Token = {
  id: number;
  name: string;
  status: number;
  key?: string;
  remain_quota: number;
  used_quota: number;
  unlimited_quota: boolean;
  expired_time: number;
  created_time: number;
  model_limits_enabled: boolean;
  model_limits: string;
  enable_image_gen: boolean;
  allow_ips?: string | null;
  group: string;
  cross_group_retry: boolean;
};

export type TokenList = { items: Token[]; total: number };

export function useTokensQuery(page = 1) {
  return useQuery({
    queryKey: qk.tokens.list(page),
    queryFn: async () => {
      const res = await api.get<TokenList>('/api/token/', {
        params: { p: page, page_size: 50 },
      });
      return res.data;
    },
    staleTime: 30_000,
  });
}

export type CreateTokenBody = {
  name: string;
  group: string;
  cross_group_retry?: boolean;
};

export function useCreateToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateTokenBody) => {
      return api.post('/api/token/', {
        name: body.name,
        group: body.group,
        cross_group_retry: body.cross_group_retry ?? false,
        unlimited_quota: true,
        remain_quota: 0,
        expired_time: -1,
        enable_image_gen: true,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tokens'] });
    },
  });
}

export type UpdateTokenBody = Partial<Token> & { id: number; status_only?: 0 | 1 };

export function useUpdateToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateTokenBody) => {
      const { status_only, ...payload } = body;
      return api.put('/api/token/', payload, {
        params: status_only ? { status_only } : undefined,
      });
    },
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: ['tokens', 'list'] });
      const previous = qc.getQueriesData<TokenList>({ queryKey: ['tokens', 'list'] });
      qc.setQueriesData<TokenList>({ queryKey: ['tokens', 'list'] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((t) => (t.id === body.id ? { ...t, ...body } : t)),
        };
      });
      return { previous };
    },
    onError: (_err, _body, ctx) => {
      ctx?.previous?.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['tokens'] });
    },
  });
}

export function useDeleteToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => api.delete(`/api/token/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['tokens', 'list'] });
      const previous = qc.getQueriesData<TokenList>({ queryKey: ['tokens', 'list'] });
      qc.setQueriesData<TokenList>({ queryKey: ['tokens', 'list'] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.filter((t) => t.id !== id),
          total: Math.max(0, old.total - 1),
        };
      });
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      ctx?.previous?.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['tokens'] });
    },
  });
}

export function useToggleTokenStatus() {
  const update = useUpdateToken();
  return {
    ...update,
    mutate: (
      arg: { id: number; nextStatus: 1 | 2 },
      ...rest: Parameters<typeof update.mutate> extends [any, ...infer R] ? R : never
    ) =>
      update.mutate(
        {
          id: arg.id,
          status: arg.nextStatus,
          status_only: 1,
        } as UpdateTokenBody,
        ...rest
      ),
    mutateAsync: (arg: { id: number; nextStatus: 1 | 2 }) =>
      update.mutateAsync({
        id: arg.id,
        status: arg.nextStatus,
        status_only: 1,
      } as UpdateTokenBody),
  };
}
