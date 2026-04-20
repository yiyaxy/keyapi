import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export type ChannelGroup = {
  name: string;
  ratio: number | string;
  desc: string;
};

type ServerShape = Record<string, { ratio: number | string; desc: string }>;

export function useChannelGroups() {
  return useQuery<ChannelGroup[]>({
    queryKey: qk.meta.channelGroups,
    queryFn: async () => {
      const res = await api.get<ServerShape>('/api/user/self/channel-groups');
      const raw = res.data ?? {};
      const entries: ChannelGroup[] = Object.entries(raw).map(([name, v]) => ({
        name,
        ratio: v.ratio,
        desc: v.desc,
      }));
      return entries.sort((a, b) => {
        if (a.name === 'auto') return -1;
        if (b.name === 'auto') return 1;
        return a.name.localeCompare(b.name);
      });
    },
    staleTime: Infinity,
  });
}
