export const MODEL_PRICING_KEYS = [
  'ModelPrice',
  'ModelRatio',
  'CompletionRatio',
  'CacheRatio',
  'CreateCacheRatio',
  'ImageRatio',
  'AudioRatio',
  'AudioCompletionRatio',
] as const;

export type ModelPricingKey = (typeof MODEL_PRICING_KEYS)[number];
