import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export const TICKET_MAX_ATTACHMENTS = 5;

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
  tenant_id: number;
  ticket_id: number;
  reply_id: number;
  uploader_id: number;
  object_key: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  created_at: number;
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

type PresignUploadResp = {
  object_key: string;
  upload_url: string;
  required_headers: Record<string, string> | null;
  expires_at: number;
};

async function presignAndUpload(file: File): Promise<string> {
  const contentType = file.type || 'application/octet-stream';
  const res = await api.post<PresignUploadResp>('/api/ticket/uploads/presign', {
    filename: file.name || 'file',
    content_type: contentType,
    size_bytes: file.size,
  });
  const { object_key, upload_url, required_headers } = res.data;

  const headers = new Headers();
  for (const [k, v] of Object.entries(required_headers ?? {})) {
    if (k) headers.set(k, String(v));
  }
  const hasCt = [...headers.keys()].some((k) => k.toLowerCase() === 'content-type');
  if (!hasCt) headers.set('Content-Type', contentType);

  const put = await fetch(upload_url, { method: 'PUT', headers, body: file });
  if (!put.ok) {
    const text = await put.text().catch(() => '');
    throw new Error(`upload failed: ${put.status} ${text}`.trim());
  }
  return String(object_key || '').trim();
}

async function uploadFiles(files: File[] | undefined): Promise<string[]> {
  if (!files || files.length === 0) return [];
  const out: string[] = [];
  for (const f of files) {
    const key = await presignAndUpload(f);
    if (key) out.push(key);
  }
  return Array.from(new Set(out));
}

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
    mutationFn: async (body: { subject: string; content: string; files?: File[] }) => {
      const object_keys = await uploadFiles(body.files);
      const res = await api.post<{ ticket: Ticket; reply: TicketReply }>('/api/ticket', {
        subject: body.subject,
        content: body.content,
        object_keys,
      });
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tickets', 'list'] }),
  });
}

export function useReplyTicket(ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { content: string; files?: File[] }) => {
      const object_keys = await uploadFiles(body.files);
      const res = await api.post<TicketReply>(`/api/ticket/${ticketId}/reply`, {
        content: body.content,
        object_keys,
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
    mutationFn: async (body: { content: string; files?: File[] }) => {
      const object_keys = await uploadFiles(body.files);
      const res = await api.post<TicketReply>(`/api/ticket/admin/${ticketId}/reply`, {
        content: body.content,
        object_keys,
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

type PresignAttachmentResp = { url: string; expires_at: number };

export async function presignTicketAttachment(
  attId: number,
  opts: { admin?: boolean; disposition?: 'inline' | 'attachment' } = {}
): Promise<PresignAttachmentResp> {
  const disposition = opts.disposition ?? 'inline';
  const base = opts.admin ? '/api/ticket/admin/attachments' : '/api/ticket/attachments';
  const res = await api.get<PresignAttachmentResp>(
    `${base}/${attId}/presign?disposition=${disposition}`
  );
  return res.data;
}
