import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

// 超管代租户管理"平台渠道访问"：黑名单模型——默认全部可用，
// tenant_channel_overrides 里 disabled=true 的才是被禁用。
// 本 hook 把"所有平台渠道" + "该租户 disabled 列表"合并成 UI 需要的单一列表。

export type ChannelAccessRow = {
  id: number;
  name: string;
  status: number; // 1=enabled, 2=manual disabled, 3=auto disabled
  disabled: boolean; // 对该租户是否禁用（本次 override 设定）
};

type ChannelListItem = {
  id: number;
  name: string;
  status: number;
};

type OverridesResponse = { disabled: number[] };

export function usePlatformChannelAccess(tenantId: number | null) {
  return useQuery<ChannelAccessRow[]>({
    enabled: tenantId != null && tenantId > 0,
    queryKey: ['platform-channel-access', tenantId] as const,
    queryFn: async () => {
      // 平台渠道列表。page_size 设大一点覆盖大多数部署；超过上限再翻页。
      const [channelsRes, overridesRes] = await Promise.all([
        api.get<{ items: ChannelListItem[] }>(
          '/api/channel/?scope=platform&page_size=500'
        ),
        api.get<OverridesResponse>(`/api/admin/tenant/${tenantId}/channel/overrides`),
      ]);
      const disabledSet = new Set(overridesRes.data.disabled ?? []);
      return (channelsRes.data.items ?? []).map((ch) => ({
        id: ch.id,
        name: ch.name,
        status: ch.status,
        disabled: disabledSet.has(ch.id),
      }));
    },
    staleTime: 15_000,
  });
}

export function useToggleTenantChannelAccess(tenantId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { channelId: number; disabled: boolean }) => {
      await api.post(`/api/admin/tenant/${tenantId}/channel/${args.channelId}/toggle`, {
        disabled: args.disabled,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-channel-access', tenantId] });
    },
  });
}
