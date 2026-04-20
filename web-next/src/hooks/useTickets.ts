import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type Ticket = {
  id: number;
  tenant_id: number;
  user_id: number;
  category: string;
  subject: string;
  status: string;
  last_reply_at: number;
  created_at: number;
  updated_at: number;
};

export type TicketReply = {
  id: number;
  tenant_id: number;
  ticket_id: number;
  role: 'user' | 'admin';
  sender_id: number;
  content: string;
  created_at: number;
};

export type TicketAttachment = {
  id: number;
  ticket_id: number;
  reply_id: number;
  filename: string;
  size_bytes: number;
  content_type: string;
  object_key: string;
};

export type TicketDetail = {
  ticket: Ticket;
  replies: TicketReply[];
  attachments: TicketAttachment[];
};

export type TicketsQuery = { p?: number; page_size?: number };
export type TicketsPage = {
  items: Ticket[];
  total: number;
  page: number;
  page_size: number;
};

const keys = {
  list: (q: TicketsQuery) => ['tickets', 'list', q] as const,
  detail: (id: number) => ['tickets', 'detail', id] as const,
};

export function useTickets(q: TicketsQuery) {
  return useQuery<TicketsPage>({
    queryKey: keys.list(q),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 30));
      const res = await api.get<TicketsPage>(`/api/ticket?${params.toString()}`);
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useTicketDetail(id: number | null) {
  return useQuery<TicketDetail>({
    queryKey: keys.detail(id ?? 0),
    enabled: id !== null && id > 0,
    queryFn: async () => {
      const res = await api.get<TicketDetail>(`/api/ticket/${id}`);
      return res.data;
    },
    staleTime: 5_000,
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { subject: string; content: string }) => {
      const res = await api.post<{ ticket: Ticket; reply: TicketReply }>('/api/ticket', {
        ...body,
        object_keys: [],
      });
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tickets', 'list'] }),
  });
}

export function useReplyTicket(ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) => {
      const res = await api.post<TicketReply>(`/api/ticket/${ticketId}/reply`, {
        content,
        object_keys: [],
      });
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.detail(ticketId) });
      void qc.invalidateQueries({ queryKey: ['tickets', 'list'] });
    },
  });
}

export function useAdminTickets(q: TicketsQuery) {
  return useQuery<TicketsPage>({
    queryKey: ['tickets-admin', 'list', q] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 30));
      const res = await api.get<TicketsPage>(`/api/ticket/admin?${params.toString()}`);
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useAdminTicketDetail(id: number | null) {
  return useQuery<TicketDetail>({
    queryKey: ['tickets-admin', 'detail', id ?? 0] as const,
    enabled: id !== null && id > 0,
    queryFn: async () => {
      const res = await api.get<TicketDetail>(`/api/ticket/admin/${id}`);
      return res.data;
    },
    staleTime: 5_000,
  });
}

export function useAdminReplyTicket(ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) => {
      const res = await api.post<TicketReply>(`/api/ticket/admin/${ticketId}/reply`, {
        content,
        object_keys: [],
      });
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tickets-admin'] });
    },
  });
}

export function useAdminUpdateTicketStatus(ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (status: string) => {
      await api.post(`/api/ticket/admin/${ticketId}/status`, { status });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tickets-admin'] });
    },
  });
}
