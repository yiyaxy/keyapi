import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export type ChatHistoryListItem = {
  id: number;
  request_id: string;
  user_id: number;
  username: string;
  tenant_id: number;
  model_name: string;
  created_at: number;
  prompt_tokens: number;
  completion_tokens: number;
  use_time_ms: number;
  is_stream: boolean;
  message_size_bytes: number;
};

export type ChatHistoryListPage = {
  items: ChatHistoryListItem[];
  total: number;
  page: number;
  size: number;
};

export type ChatHistoryListQuery = {
  user_id?: number;
  model?: string;
  from?: number; // unix seconds
  to?: number; // unix seconds
  tenant_id?: number; // platform admin only
  page?: number;
  size?: number;
};

export function useChatHistoryList(query: ChatHistoryListQuery, enabled = true) {
  return useQuery<ChatHistoryListPage>({
    queryKey: qk.chatHistory.list(query as Record<string, unknown>),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (query.user_id && query.user_id > 0) params.set('user_id', String(query.user_id));
      if (query.model) params.set('model', query.model);
      if (query.from && query.from > 0) params.set('from', String(query.from));
      if (query.to && query.to > 0) params.set('to', String(query.to));
      if (query.tenant_id && query.tenant_id > 0) {
        params.set('tenant_id', String(query.tenant_id));
      }
      params.set('page', String(query.page ?? 1));
      params.set('size', String(query.size ?? 20));
      const res = await api.get<ChatHistoryListPage>(
        `/api/chat_history/admin?${params.toString()}`,
      );
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    enabled,
  });
}

// EnvelopePayload mirrors service/chat_history/recorder.go envelope.payload.
// The recorder picks one of {body, body_text, body_base64} per message
// depending on the original Content-Type, so the renderer has to handle all
// three shapes — see the detail-view component for the rendering logic.
export type EnvelopePayload = {
  content_type?: string;
  body?: unknown; // parsed JSON when original was JSON
  body_text?: string; // when original was SSE / plain text or JSON parse fell back
  body_base64?: string; // when original was binary
  bytes: number;
};

export type ChatHistoryEnvelope = {
  schema: number;
  captured_at: string;
  request_id: string;
  user_id: number;
  username?: string;
  tenant_id?: number;
  model?: string;
  method: string;
  path: string;
  status_code: number;
  is_stream: boolean;
  request: EnvelopePayload;
  response: EnvelopePayload;
  response_truncated_at_bytes?: number;
};

export function useChatHistoryDetail(requestId: string | null) {
  return useQuery<ChatHistoryEnvelope>({
    queryKey: qk.chatHistory.detail(requestId ?? ''),
    queryFn: async () => {
      const res = await api.get<ChatHistoryEnvelope>(
        `/api/chat_history/admin/${encodeURIComponent(requestId ?? '')}`,
      );
      return res.data;
    },
    enabled: Boolean(requestId),
    staleTime: 60_000,
  });
}
