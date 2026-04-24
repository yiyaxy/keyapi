import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Info, Users2 } from 'lucide-react';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/hooks/useAuth';
import { usePricing, type PricingRow, type PricingVendor } from '@/hooks/usePricing';
import { usePublicConfig, type PublicConfig } from '@/hooks/usePublicConfig';
import { fmtDisplayUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

const GROUP_ALL = '__all__';
const VENDOR_ALL = 0;
const EMPTY_CELL = '-';
const EMPTY_ROWS: PricingRow[] = [];
const EMPTY_GROUP_RATIO: Record<string, number> = {};
const EMPTY_USABLE_GROUP: Record<string, string> = {};
const EMPTY_VENDORS: PricingVendor[] = [];

type PricingCurrencyMode = 'site' | 'usd';

// Backend convention: model_ratio = 1 means $0.002 / 1K input tokens, so the
// public table needs model_ratio * 2 to display the price per 1M tokens.
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

function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return '1';
  return String(Math.round(ratio * 1000) / 1000);
}

function siteCurrencyLabel(cfg: PublicConfig): string {
  if (cfg.quota_display_type === 'CNY') return 'CNY';
  if (cfg.quota_display_type === 'CUSTOM') {
    return cfg.custom_currency_symbol ? `CUSTOM ${cfg.custom_currency_symbol}` : 'CUSTOM';
  }
  if (cfg.quota_display_type === 'TOKENS') return 'TOKENS';
  return 'USD';
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

type GroupTagProps = {
  groupKey: string;
  label: string;
  ratio?: number;
  selected: boolean;
};

function GroupTag({ groupKey, label, ratio, selected }: GroupTagProps) {
  return (
    <span
      data-group={groupKey}
      data-selected={selected ? 'true' : 'false'}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-11 font-medium tabular-nums transition-colors',
        selected ? 'border-primary bg-accent-soft text-fg-0' : 'border-line bg-bg-1 text-fg-1'
      )}
    >
      <span>{label}</span>
      {ratio != null ? (
        <span className={selected ? 'text-fg-1' : 'text-fg-2'}>{formatRatio(ratio)}x</span>
      ) : null}
    </span>
  );
}

export function PricingPage() {
  const { t } = useTranslation('public');
  const cfg = usePublicConfig();
  const { user } = useAuth();
  const pricing = usePricing();

  const envelope = pricing.data;
  const rows = envelope?.data ?? EMPTY_ROWS;
  const groupRatio = envelope?.group_ratio ?? EMPTY_GROUP_RATIO;
  const usableGroup = envelope?.usable_group ?? EMPTY_USABLE_GROUP;
  const vendors = envelope?.vendors ?? EMPTY_VENDORS;

  const vendorById = useMemo(() => {
    const map = new Map<number, (typeof vendors)[number]>();
    for (const vendor of vendors) {
      map.set(vendor.id, vendor);
    }
    return map;
  }, [vendors]);

  // Logged-in users default to their own group until they explicitly switch.
  const [selGroupRaw, setSelGroupRaw] = useState<string | null>(null);
  const [selVendorRaw, setSelVendorRaw] = useState<number | null>(null);
  const [currencyMode, setCurrencyMode] = useState<PricingCurrencyMode>('site');
  const [query, setQuery] = useState('');

  const selGroup =
    selGroupRaw ?? (user?.group && user.group in usableGroup ? user.group : GROUP_ALL);
  const selVendor = selVendorRaw ?? VENDOR_ALL;
  const mult = selGroup !== GROUP_ALL ? (groupRatio[selGroup] ?? 1) : 1;
  const showUsdSwitch = cfg.quota_display_type !== 'USD';
  const displayCfg = useMemo(
    () => (currencyMode === 'usd' ? { ...cfg, quota_display_type: 'USD' as const } : cfg),
    [cfg, currencyMode]
  );

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (selGroup !== GROUP_ALL && !(row.enable_groups ?? []).includes(selGroup)) {
        return false;
      }
      if (selVendor !== VENDOR_ALL && row.vendor_id !== selVendor) {
        return false;
      }
      if (!needle) {
        return true;
      }
      const haystack = `${row.model_name} ${row.owner_by ?? ''}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [query, rows, selGroup, selVendor]);

  const groupChips = useMemo(() => {
    const keys = Object.keys(usableGroup).filter(Boolean);
    keys.sort((left, right) => (left === 'default' ? -1 : right === 'default' ? 1 : 0));
    return keys;
  }, [usableGroup]);

  const selectedGroupLabel =
    selGroup === GROUP_ALL ? t('pricing.filter.all_groups') : (usableGroup[selGroup] ?? selGroup);

  return (
    <TooltipProvider delayDuration={150}>
      <div className='space-y-6'>
        <header className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
          <div>
            <h1 className='text-24 font-semibold'>{t('pricing.title')}</h1>
            <p className='mt-1 text-13 text-fg-2'>{t('pricing.sub')}</p>
          </div>

          {showUsdSwitch ? (
            <div className='space-y-1 sm:text-right'>
              <div className='text-12 uppercase tracking-wide text-fg-2'>
                {t('pricing.filter.currency')}
              </div>
              <div className='inline-flex items-center gap-1 rounded-md border border-line bg-bg-1 p-0.5'>
                {(
                  [
                    { mode: 'site', label: siteCurrencyLabel(cfg) },
                    { mode: 'usd', label: 'USD' },
                  ] as const
                ).map((option) => {
                  const active = currencyMode === option.mode;
                  return (
                    <button
                      key={option.mode}
                      type='button'
                      aria-pressed={active}
                      onClick={() => setCurrencyMode(option.mode)}
                      className={cn(
                        'min-w-[3.5rem] rounded px-3 py-1 text-12 font-medium tabular-nums transition-colors',
                        active ? 'bg-fg-0 text-bg-0' : 'text-fg-2 hover:bg-bg-2 hover:text-fg-0'
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </header>

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
                    <Info className='size-3.5 cursor-help text-fg-2' aria-hidden />
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
              {groupChips.map((group) => {
                const ratio = groupRatio[group];
                return (
                  <Chip
                    key={group}
                    active={selGroup === group}
                    onClick={() => setSelGroupRaw(group)}
                    label={usableGroup[group] || group}
                    trailing={ratio != null ? `${formatRatio(ratio)}x` : undefined}
                  />
                );
              })}
            </div>
          </div>
        )}

        {pricing.isPending || vendors.length === 0 ? null : (
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
              {vendors.map((vendor) => (
                <Chip
                  key={vendor.id}
                  active={selVendor === vendor.id}
                  onClick={() => setSelVendorRaw(vendor.id)}
                  label={vendor.name}
                />
              ))}
            </div>
          </div>
        )}

        <Input
          className='max-w-xs'
          placeholder={t('pricing.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
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
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className='h-10 w-full' />
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
                  <th className='px-3 py-2 font-medium'>{t('pricing.col.model')}</th>
                  <th className='px-3 py-2 font-medium'>{t('pricing.col.bill')}</th>
                  <th className='px-3 py-2 font-medium'>{t('pricing.col.vendor')}</th>
                  <th className='px-3 py-2 font-medium'>{t('pricing.col.groups')}</th>
                  <th className='px-3 py-2 text-right font-medium'>{t('pricing.col.input')}</th>
                  <th className='px-3 py-2 text-right font-medium'>{t('pricing.col.output')}</th>
                  <th className='px-3 py-2 text-right font-medium'>
                    {t('pricing.col.cache_input')}
                  </th>
                  <th className='px-3 py-2 text-right font-medium'>{t('pricing.col.fixed')}</th>
                </tr>
              </thead>

              <tbody>
                {items.map((row) => {
                  const vendor = row.vendor_id ? vendorById.get(row.vendor_id) : null;
                  const byUsage = row.quota_type === 0;
                  const byFixed = row.quota_type === 1;
                  const cacheIn = cacheInputPerMillion(row, mult);

                  return (
                    <tr key={row.model_name} className='border-b border-line text-13 hover:bg-bg-1'>
                      <td className='px-3 py-2 font-mono'>{row.model_name}</td>
                      <td className='px-3 py-2'>
                        {byUsage ? (
                          <Badge variant='outline'>{t('pricing.bill.usage')}</Badge>
                        ) : byFixed ? (
                          <Badge variant='outline'>{t('pricing.bill.fixed')}</Badge>
                        ) : (
                          EMPTY_CELL
                        )}
                      </td>
                      <td className='px-3 py-2 text-fg-1'>
                        {vendor?.name ?? row.owner_by ?? EMPTY_CELL}
                      </td>
                      <td className='px-3 py-2'>
                        {row.enable_groups && row.enable_groups.length > 0 ? (
                          <div className='flex flex-wrap gap-1'>
                            {row.enable_groups.map((group) => (
                              <GroupTag
                                key={group}
                                groupKey={group}
                                label={usableGroup[group] || group}
                                ratio={groupRatio[group]}
                                selected={group === selGroup}
                              />
                            ))}
                          </div>
                        ) : (
                          EMPTY_CELL
                        )}
                      </td>
                      <td className='px-3 py-2 text-right'>
                        {byUsage
                          ? fmtDisplayUsd(inputPerMillion(row, mult), displayCfg)
                          : EMPTY_CELL}
                      </td>
                      <td className='px-3 py-2 text-right'>
                        {byUsage
                          ? fmtDisplayUsd(outputPerMillion(row, mult), displayCfg)
                          : EMPTY_CELL}
                      </td>
                      <td className='px-3 py-2 text-right'>
                        {byUsage && cacheIn != null
                          ? fmtDisplayUsd(cacheIn, displayCfg)
                          : EMPTY_CELL}
                      </td>
                      <td className='px-3 py-2 text-right'>
                        {byFixed ? fmtDisplayUsd(row.model_price * mult, displayCfg) : EMPTY_CELL}
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
