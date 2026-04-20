import { z } from 'zod';

export function parseGroupChain(csv: string): string[] {
  if (!csv.trim()) return [];
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function serializeGroupChain(arr: string[]): string {
  return arr
    .map((s) => s.trim())
    .filter(Boolean)
    .join(',');
}

export function parseAllowIps(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function serializeAllowIps(arr: string[]): string {
  return arr.join('\n');
}

export const editTokenSchema = z
  .object({
    name: z.string().min(1).max(50),
    status: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    unlimited_quota: z.boolean(),
    remain_quota: z.number().int(),
    expired_time: z.number().int(),
    model_limits_enabled: z.boolean(),
    model_limits: z.array(z.string()),
    allow_ips: z.array(z.string()),
    group: z.array(z.string()).min(1),
    cross_group_retry: z.boolean(),
  })
  .refine((v) => v.unlimited_quota || v.remain_quota >= 0, {
    path: ['remain_quota'],
    message: 'remain_quota must be ≥ 0 when not unlimited',
  })
  .refine((v) => !v.cross_group_retry || v.group.length >= 2, {
    path: ['cross_group_retry'],
    message: 'cross_group_retry requires ≥ 2 groups',
  });

export type EditTokenValues = z.infer<typeof editTokenSchema>;
