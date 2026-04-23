import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Info, Users2 } from 'lucide-react';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAuth } from '@/hooks/useAuth';
import { usePricing, type PricingRow } from '@/hooks/usePricing';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { fmtDisplayUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

const GROUP_ALL = '__all__';
const VENDOR_ALL = 0;

// Backend convention: model_ratio = 1 means $0.002 / 1K input tokens →
// $2 / 1M. So per-million = model_ratio * 2. Multiplied by the selected
// group's ratio for the final display price.
function inputPerMillion(row: PricingRow, mult: number): number {
  return row.model_ratio * 2 * mult;
}
function outputPerMillion(row: PricingRow, mult: number): number {
  return row.model_ratio * row.completion_ratio * 2 * mult;
}
function cacheInputPerMillion(row: PricingRow, mult: number): number | null {
  if (row.cache_ratio == null) return null;
  return row.model_ratio * 2 * row.cache_ratio * mult;
}

type ChipProps = {
  active: boolean;
  onClick: () => void;
  label: string;
  trailing?: string;
};
function Chip({ active, onClick, label, trailing }: ChipProps) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-12 transition',
        active
          ? 'border-fg-0 bg-fg-0 text-bg-0'
          : 'border-line bg-bg-1 text-fg-1 hover:border-fg-2 hover:bg-bg-2'
      )}
    >
      <span>{label}</span>
      {trailing ? (
        <span
          className={cn(
            'rounded-full px-1.5 text-11 tabular-nums',
            active ? 'bg-bg-0/20 text-bg-0' : 'bg-bg-2 text-fg-2'
          )}
        >
          {trailing}
        </span>
      ) : null}
    </button>
  );
}

export function PricingPage() {
  const { t } = useTranslation('public');
  const cfg = usePublicConfig();
  const { user } = useAuth();
  const pricing = usePricing();

  const envelope = pricing.data;
  const rows = envelope?.data ?? [];
  const groupRatio = envelope?.group_ratio ?? {};
  const usableGroup = envelope?.usable_group ?? {};
  const vendors = envelope?.vendors ?? [];
  const vendorById = useMemo(() => {
    const map = new Map<number, (typeof vendors)[number]>();
    for (const v of vendors) map.set(v.id, v);
    return map;
  }, [vendors]);

  // 登录用户默认锚定到自己的分组；未点过芯片时派生，点击后覆盖。
  const [selGroupRaw, setSelGroupRaw] = useState<string | null>(null);
  const [selVendorRaw, setSelVendorRaw] = useState<number | null>(null);
  const selGroup =
    selGroupRaw ??
    (user?.group && user.group in usableGroup ? user.group : GROUP_ALL);
  const selVendor = selVendorRaw ?? VENDOR_ALL;

  const [q, setQ] = useState('');

  // 选中具体分组时用对应倍率，"全部"时显示原始价（倍率=1）
  const mult = selGroup !== GROUP_ALL ? (groupRatio[selGroup] ?? 1) : 1;

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (selGroup !== GROUP_ALL && !(r.enable_groups ?? []).includes(selGroup))
        return false;
      if (selVendor !== VENDOR_ALL && r.vendor_id !== selVendor) return false;
      if (needle) {
        const hay = `${r.model_name} ${r.owner_by ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, selGroup, selVendor]);

  const groupChips = useMemo(() => {
    const keys = Object.keys(usableGroup).filter((k) => k !== '');
    // default 置顶，其余保持后端顺序
    keys.sort((a, b) => (a === 'default' ? -1 : b === 'default' ? 1 : 0));
    return keys;
  }, [usableGroup]);

  const selectedGroupLabel =
    selGroup === GROUP_ALL
      ? t('pricing.filter.all_groups')
      : (usableGroup[selGroup] ?? selGroup);

  return (
    <TooltipProvider delayDuration={150}>
      <div className='space-y-6'>
        <header>
          <h1 className='text-24 font-semibold'>{t('pricing.title')}</h1>
          <p className='mt-1 text-13 text-fg-2'>{t('pricing.sub')}</p>
        </header>

        {/* Filter: group */}
        {pricing.isPending ? (
          <Skeleton className='h-9 w-full max-w-md' />
        ) : (
          <div className='space-y-2'>
            <div className='flex items-center gap-2 text-12 uppercase tracking-wide text-fg-2'>
              <Users2 className='size-3.5' aria-hidden />
              <span>{t('pricing.filter.group')}</span>
              {selGroup !== GROUP_ALL ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info
                      className='size-3.5 cursor-help text-fg-2'
                      aria-hidden
                    />
                  </TooltipTrigger>
                  <TooltipContent side='top' className='text-12'>
                    {t('pricing.ratio.note', {
                      group: selectedGroupLabel,
                      ratio: mult,
                    })}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
            <div className='flex flex-wrap items-center gap-1.5'>
              <Chip
                active={selGroup === GROUP_ALL}
                onClick={() => setSelGroupRaw(GROUP_ALL)}
                label={t('pricing.filter.all_groups')}
              />
              {groupChips.map((g) => {
                const ratio = groupRatio[g];
                const trailing =
                  ratio != null ? `${formatRatio(ratio)}x` : undefined;
                return (
                  <Chip
                    key={g}
                    active={selGroup === g}
                    onClick={() => setSelGroupRaw(g)}
                    label={usableGroup[g] || g}
                    trailing={trailing}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Filter: vendor */}
        {pricing.isPending ? null : vendors.length > 0 ? (
          <div className='space-y-2'>
            <div className='flex items-center gap-2 text-12 uppercase tracking-wide text-fg-2'>
              <Building2 className='size-3.5' aria-hidden />
              <span>{t('pricing.filter.vendor')}</span>
            </div>
            <div className='flex flex-wrap items-center gap-1.5'>
              <Chip
                active={selVendor === VENDOR_ALL}
                onClick={() => setSelVendorRaw(VENDOR_ALL)}
                label={t('pricing.filter.all_vendors')}
              />
              {vendors.map((v) => (
                <Chip
                  key={v.id}
                  active={selVendor === v.id}
                  onClick={() => setSelVendorRaw(v.id)}
                  label={v.name}
                />
              ))}
            </div>
          </div>
        ) : null}

        <Input
          className='max-w-xs'
          placeholder={t('pricing.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        {pricing.isError && (
          <InlineBanner
            level='danger'
            message={t('pricing.failed')}
            onClose={() => void pricing.refetch()}
          />
        )}

        {pricing.isPending ? (
          <div className='space-y-2'>
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className='h-10 w-full' />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
            {t('pricing.empty')}
          </div>
        ) : (
          <div className='overflow-x-auto rounded-md border border-line'>
            <table className='w-full border-collapse tabular-nums'>
              <thead>
                <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                  <th className='px-3 py-2 font-medium'>
                    {t('pricing.col.model')}
                  </th>
                  <th className='px-3 py-2 font-medium'>
                    {t('pricing.col.bill')}
                  </th>
                  <th className='px-3 py-2 font-medium'>
                    {t('pricing.col.vendor')}
                  </th>
                  <th className='px-3 py-2 font-medium'>
                    {t('pricing.col.groups')}
                  </th>
                  <th className='px-3 py-2 text-right font-medium'>
                    {t('pricing.col.input')}
                  </th>
                  <th className='px-3 py-2 text-right font-medium'>
                    {t('pricing.col.output')}
                  </th>
                  <th className='px-3 py-2 text-right font-medium'>
                    {t('pricing.col.cache_input')}
                  </th>
                  <th className='px-3 py-2 text-right font-medium'>
                    {t('pricing.col.fixed')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const vendor = row.vendor_id
                    ? vendorById.get(row.vendor_id)
                    : null;
                  const byUsage = row.quota_type === 0;
                  const byFixed = row.quota_type === 1;
                  const cacheIn = cacheInputPerMillion(row, mult);
                  return (
                    <tr
                      key={row.model_name}
                      className='border-b border-line text-13 hover:bg-bg-1'
                    >
                      <td className='px-3 py-2 font-mono'>{row.model_name}</td>
                      <td className='px-3 py-2'>
                        {byUsage ? (
                          <Badge variant='outline'>
                            {t('pricing.bill.usage')}
                          </Badge>
                        ) : byFixed ? (
                          <Badge variant='outline'>
                            {t('pricing.bill.fixed')}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className='px-3 py-2 text-fg-1'>
                        {vendor?.name ?? row.owner_by ?? '—'}
                      </td>
                      <td className='px-3 py-2'>
                        {row.enable_groups && row.enable_groups.length > 0 ? (
                          <div className='flex flex-wrap gap-1'>
                            {row.enable_groups.map((g) => {
                              const isActive = g === selGroup;
                              const ratio = groupRatio[g];
                              return (
                                <Badge
                                  key={g}
                                  variant={isActive ? 'default' : 'secondary'}
                                  className='text-11 font-normal'
                                >
                                  {usableGroup[g] || g}
                                  {ratio != null ? (
                                    <span className='ml-1 opacity-70'>
                                      {formatRatio(ratio)}x
                                    </span>
                                  ) : null}
                                </Badge>
                              );
                            })}
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className='px-3 py-2 text-right'>
                        {byUsage
                          ? fmtDisplayUsd(inputPerMillion(row, mult), cfg)
                          : '—'}
                      </td>
                      <td className='px-3 py-2 text-right'>
                        {byUsage
                          ? fmtDisplayUsd(outputPerMillion(row, mult), cfg)
                          : '—'}
                      </td>
                      <td className='px-3 py-2 text-right'>
                        {byUsage && cacheIn != null
                          ? fmtDisplayUsd(cacheIn, cfg)
                          : '—'}
                      </td>
                      <td className='px-3 py-2 text-right'>
                        {byFixed
                          ? fmtDisplayUsd(row.model_price * mult, cfg)
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {selGroup !== GROUP_ALL ? (
          <p className='text-12 text-fg-2'>
            {t('pricing.ratio.note', {
              group: selectedGroupLabel,
              ratio: mult,
            })}
          </p>
        ) : (
          <p className='text-12 text-fg-2'>{t('pricing.ratio.note_base')}</p>
        )}
      </div>
    </TooltipProvider>
  );
}

// 1 → "1"; 0.8 → "0.8"; 0.1 → "0.1"; 1.25 → "1.25"。
// 去除多余尾零，保留最多 3 位小数，避免 "1.0000001x" 这种脏显示。
function formatRatio(r: number): string {
  if (!Number.isFinite(r)) return '1';
  const fixed = Math.round(r * 1000) / 1000;
  return String(fixed);
}
