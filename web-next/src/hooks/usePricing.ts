import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type PricingRow = {
  model_name: string;
  description?: string;
  tags?: string;
  vendor_id?: number;
  quota_type: number;
  model_ratio: number;
  model_price: number;
  owner_by: string;
  completion_ratio: number;
};

export function usePricing() {
  return useQuery<PricingRow[]>({
    queryKey: ['pricing', 'list'],
    queryFn: async () => {
      const res = await api.get<PricingRow[]>('/api/pricing');
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 60_000,
  });
}
