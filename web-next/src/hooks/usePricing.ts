import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type PricingRow = {
  model_name: string;
  description?: string;
  icon?: string;
  tags?: string;
  vendor_id?: number;
  quota_type: number;
  model_ratio: number;
  model_price: number;
  owner_by: string;
  completion_ratio: number;
  cache_ratio?: number;
  create_cache_ratio?: number;
  image_ratio?: number;
  audio_ratio?: number;
  audio_completion_ratio?: number;
  enable_groups?: string[];
  supported_endpoint_types?: string[];
};

export type PricingVendor = {
  id: number;
  name: string;
  description?: string;
  icon?: string;
};

export type PricingEnvelope = {
  data: PricingRow[];
  vendors: PricingVendor[];
  group_ratio: Record<string, number>;
  usable_group: Record<string, string>;
  auto_groups: string[];
  supported_endpoint: Record<string, { path: string; method: string }>;
  pricing_version?: string;
};

export function usePricing() {
  return useQuery<PricingEnvelope>({
    queryKey: ['pricing', 'envelope'],
    queryFn: async () => {
      // rawEnvelope: true 指示响应拦截器跳过自动 .data 解包——/api/pricing
      // 的 group_ratio / usable_group / vendors 等字段都挂在 envelope 顶层，
      // 默认拦截器会解包丢掉。
      const res = await api.get<Record<string, unknown>>('/api/pricing', {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rawEnvelope: true,
      } as any);
      const body = res.data ?? {};
      return {
        data: Array.isArray(body.data) ? (body.data as PricingRow[]) : [],
        vendors: Array.isArray(body.vendors) ? (body.vendors as PricingVendor[]) : [],
        group_ratio: (body.group_ratio as Record<string, number>) ?? {},
        usable_group: (body.usable_group as Record<string, string>) ?? {},
        auto_groups: Array.isArray(body.auto_groups) ? (body.auto_groups as string[]) : [],
        supported_endpoint:
          (body.supported_endpoint as Record<string, { path: string; method: string }>) ?? {},
        pricing_version: body.pricing_version as string | undefined,
      };
    },
    staleTime: 60_000,
  });
}
