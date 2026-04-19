import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { api } from '@/lib/api';

export type InboxMessage = {
  id: number;
  title: string;
  content: string;
  type: number;
  target_user_id: number;
  sender_id: number;
  status: number;
  created_at: number;
  is_read: boolean;
  read_at: number;
};

export type InboxQuery = { p?: number; page_size?: number };
export type InboxPage = { items: InboxMessage[]; total: number };

const keys = {
  list: (q: InboxQuery) => ['inbox', 'list', q] as const,
  unread: ['inbox', 'unread'] as const,
  detail: (id: number) => ['inbox', 'detail', id] as const,
};

export function useInbox(q: InboxQuery) {
  return useQuery<InboxPage>({
    queryKey: keys.list(q),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 30));
      const res = await api.get<InboxPage>(`/api/message/inbox?${params.toString()}`);
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useUnreadCount() {
  return useQuery<number>({
    queryKey: keys.unread,
    queryFn: async () => {
      const res = await api.get<{ count: number } | number>('/api/message/unread_count');
      const payload = res.data as number | { count?: number };
      return typeof payload === 'number' ? payload : (payload?.count ?? 0);
    },
    staleTime: 60_000,
  });
}

export function useInboxMessage(id: number | null) {
  return useQuery<InboxMessage>({
    queryKey: keys.detail(id ?? 0),
    enabled: id !== null && id > 0,
    queryFn: async () => {
      const res = await api.get<InboxMessage>(`/api/message/inbox/${id}`);
      return res.data;
    },
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.post(`/api/message/inbox/${id}/read`);
      return id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inbox'] });
    },
  });
}
