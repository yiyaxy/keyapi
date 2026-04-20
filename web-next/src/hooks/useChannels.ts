import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

// Channel mirrors the subset of model.Channel fields the admin UI works
// with. `setting` is a JSON-encoded blob (see dto.ChannelSettings); we
// surface proxy + system_prompt as first-class inputs and leave anything
// else the backend wrote in place on save.
export type Channel = {
  id: number;
  tenant_id: number;
  type: number;
  key: string;
  name: string;
  status: number;
  weight: number | null;
  created_time: number;
  test_time: number;
  response_time: number;
  base_url: string | null;
  other: string;
  balance: number;
  balance_updated_time: number;
  models: string;
  group: string;
  used_quota: number;
  priority: number | null;
  auto_ban: number | null;
  max_retry: number | null;
  tag: string | null;
  remark: string | null;

  // extended fields
  openai_organization: string | null;
  test_model: string | null;
  model_mapping: string | null;
  status_code_mapping: string | null;
  param_override: string | null;
  header_override: string | null;
  setting: string | null; // JSON — dto.ChannelSettings
};

export type ChannelsQuery = {
  p?: number;
  page_size?: number;
  status?: 'all' | 'enabled' | 'disabled';
  type?: number;
  id_sort?: boolean;
};

export type ChannelsPage = {
  items: Channel[];
  total: number;
  page: number;
  page_size: number;
  type_counts: Record<string, number>;
};

const channelsKeys = {
  list: (q: ChannelsQuery) => ['channels', 'list', q] as const,
  detail: (id: number) => ['channels', 'detail', id] as const,
};

export function useChannels(q: ChannelsQuery) {
  return useQuery<ChannelsPage>({
    queryKey: channelsKeys.list(q),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('p', String(q.p ?? 1));
      params.set('page_size', String(q.page_size ?? 50));
      if (q.type !== undefined && q.type >= 0) params.set('type', String(q.type));
      if (q.status === 'enabled') params.set('status', '1');
      if (q.status === 'disabled') params.set('status', '0');
      if (q.id_sort) params.set('id_sort', 'true');
      const res = await api.get<ChannelsPage>(`/api/channel/?${params.toString()}`);
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

// ChannelInput is the write shape. Everything optional so the dialog
// can send only what it cares about. `setting` is a pre-serialized JSON
// string — the dialog is responsible for merging before sending.
export type ChannelInput = {
  name: string;
  type: number;
  key?: string;
  base_url?: string;
  models: string;
  group: string;
  priority?: number;
  weight?: number;
  auto_ban?: number;
  max_retry?: number;
  openai_organization?: string;
  test_model?: string;
  model_mapping?: string;
  status_code_mapping?: string;
  param_override?: string;
  header_override?: string;
  tag?: string;
  remark?: string;
  setting?: string;
};

export type ChannelCreateMode = 'single' | 'batch' | 'multi_to_single';
export type MultiKeyMode = 'polling' | 'random';

export type ChannelCreateOptions = {
  mode: ChannelCreateMode;
  // only honoured for multi_to_single
  multi_key_mode?: MultiKeyMode;
  // only honoured for batch
  batch_add_set_key_prefix_2_name?: boolean;
};

// The AddChannel handler decodes AddChannelRequest{ Channel *model.Channel }
// — i.e. the channel fields must be nested under a "channel" key. Update
// on the other hand uses PatchChannel which EMBEDS model.Channel, so flat
// is correct there.
export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { input: ChannelInput; opts: ChannelCreateOptions }) => {
      const body: Record<string, unknown> = {
        mode: payload.opts.mode,
        channel: payload.input,
      };
      if (payload.opts.mode === 'multi_to_single' && payload.opts.multi_key_mode) {
        body.multi_key_mode = payload.opts.multi_key_mode;
      }
      if (payload.opts.mode === 'batch' && payload.opts.batch_add_set_key_prefix_2_name) {
        body.batch_add_set_key_prefix_2_name = true;
      }
      const res = await api.post<Channel>('/api/channel/', body);
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['channels', 'list'] }),
  });
}

export type ChannelUpdateInput = Partial<ChannelInput> & { id: number };

export function useUpdateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ChannelUpdateInput) => {
      const res = await api.put<Channel>('/api/channel/', input);
      return res.data;
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['channels', 'list'] });
      void qc.invalidateQueries({ queryKey: channelsKeys.detail(v.id) });
    },
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/channel/${id}`);
      return id;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['channels', 'list'] }),
  });
}

export function useToggleChannelStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, nextStatus }: { id: number; nextStatus: 1 | 2 }) => {
      await api.put('/api/channel/', { id, status: nextStatus });
      return { id, nextStatus };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['channels', 'list'] }),
  });
}

export type ChannelTestResult = {
  response_time: number;
  message?: string;
};

// useChannelTypeModels maps channel type id → list of builtin model names,
// sourced from DashboardListModels (/api/models). Used by the channel form
// to suggest relevant models for the currently-selected provider type.
export function useChannelTypeModels() {
  return useQuery<Record<string, string[]>>({
    queryKey: qk.meta.channelTypeModels,
    queryFn: async () => {
      const res = await api.get<Record<string, string[]>>('/api/models');
      return res.data ?? {};
    },
    staleTime: 5 * 60_000,
  });
}

// useAdminGroups returns the flat list of admin-configured group names
// (keys of ratio_setting.GroupRatio). Used by the channel form to suggest
// valid group names — channel.group is a CSV, so we surface these as
// clickable chips rather than a <select>.
export function useAdminGroups() {
  return useQuery<string[]>({
    queryKey: qk.meta.adminGroups,
    queryFn: async () => {
      const res = await api.get<string[]>('/api/group/');
      const list = Array.isArray(res.data) ? res.data : [];
      return [...list].sort((a, b) => a.localeCompare(b));
    },
    staleTime: 5 * 60_000,
  });
}

export function useTestChannel() {
  return useMutation({
    mutationFn: async (id: number) => {
      // Endpoint returns { success, message, time } with NO `data` field,
      // so the response interceptor leaves the body in res.data as-is.
      const res = await api.get<{ success?: boolean; message?: string; time?: number }>(
        `/api/channel/test/${id}`
      );
      const payload = res.data;
      return {
        response_time: typeof payload?.time === 'number' ? Math.round(payload.time * 1000) : 0,
        message: payload?.message,
      } satisfies ChannelTestResult;
    },
  });
}
