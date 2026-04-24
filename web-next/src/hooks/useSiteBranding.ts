import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from '@/lib/api';

type StatusBrandFields = {
  system_name?: string;
  logo?: string;
  footer_html?: string;
};

export type SiteBranding = {
  systemName: string;
  logo: string;
  footerHtml: string;
};

const EMPTY: SiteBranding = { systemName: '', logo: '', footerHtml: '' };

export function useSiteBranding(): SiteBranding {
  const q = useQuery<StatusBrandFields>({
    queryKey: ['site-status'] as const,
    queryFn: async () => (await api.get<StatusBrandFields>('/api/status')).data,
    staleTime: Infinity,
  });
  return useMemo(() => {
    if (!q.data) return EMPTY;
    return {
      systemName: q.data.system_name ?? '',
      logo: q.data.logo ?? '',
      footerHtml: q.data.footer_html ?? '',
    };
  }, [q.data]);
}
