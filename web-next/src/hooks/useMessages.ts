import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { api } from '@/lib/api';

export const MESSAGE_TYPE = {
  DIRECTED: 1,
  BROADCAST: 2,
} as const;

export const MESSAGE_STATUS = {
  NORMAL: 1,
  RECALLED: 2,
} as const;

export type AdminMessage = {
  id: number;
  title: string;
  content: string;
  type: number;
  target_user_id: number;
  sender_id: number;
  status: number;
  created_at: number;
  updated_at: number;
};

export type CreateMessageInput = {
  title: string;
  content: string;
  type: number;
  target_user_id: number;
};

export type EditMessageInput = {
  id: number;
  title?: string;
  content?: string;
};

export function useAdminMessages(q: {
  p?: number;
  page_size?: number;
  keyword?: string;
  type?: number;
}) {
  return useQuery<{ items: AdminMessage[]; total: number }>({
    queryKey: ['admin-messages', 'list', q] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 30));
      if (q.keyword) params.set('keyword', q.keyword);
      if (q.type) params.set('type', String(q.type));
      const res = await api.get<{ items: AdminMessage[]; total: number }>(
        `/api/message/admin/?${params.toString()}`
      );
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useCreateMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateMessageInput) => {
      await api.post('/api/message/admin/', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-messages'] });
    },
  });
}

export function useEditMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: EditMessageInput) => {
      await api.put(`/api/message/admin/${id}`, body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-messages'] });
    },
  });
}

export function useRecallMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/message/admin/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-messages'] });
    },
  });
}
