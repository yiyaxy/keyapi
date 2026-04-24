import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { Channel } from '@/hooks/useChannels';
import type { PricingRow } from '@/hooks/usePricing';
import type { TenantPlatformChannelMarkup } from '@/hooks/useTenantBilling';
import { cn } from '@/lib/utils';

export type EffectiveMarkupSource = 'tenant_channel' | 'channel' | 'plan' | 'none';

export function formatRatio(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '1x';
  return `${Number(value.toFixed(4)).toString()}x`;
}

export function parseChannelModels(models: string): string[] {
  return [
    ...new Set(
      models
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

export function readChannelRatio(channel: Channel): number {
  if (!channel.setting) return 1;
  try {
    const parsed = JSON.parse(channel.setting) as { channel_ratio?: unknown };
    if (typeof parsed.channel_ratio === 'number' && parsed.channel_ratio > 0) {
      return parsed.channel_ratio;
    }
  } catch {
    return 1;
  }
  return 1;
}

export function resolveEffectiveMarkup(
  channel: Channel,
  override: TenantPlatformChannelMarkup | undefined,
  planMarkup: number
): { value: number; source: EffectiveMarkupSource } {
  if (override && override.enabled && override.markup_ratio > 0) {
    return { value: override.markup_ratio, source: 'tenant_channel' };
  }
  if (channel.markup_ratio && channel.markup_ratio > 0) {
    return { value: channel.markup_ratio, source: 'channel' };
  }
  if (planMarkup > 0) {
    return { value: planMarkup, source: 'plan' };
  }
  return { value: 1, source: 'none' };
}

function Pill({
  label,
  tooltip,
  highlighted = false,
}: {
  label: string;
  tooltip: React.ReactNode;
  highlighted?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type='button'
          className={cn(
            'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
            highlighted
              ? 'border-emerald-500/40 bg-emerald-500/10 font-semibold text-fg-0 ring-1 ring-emerald-500/30'
              : 'border-line bg-bg-1 text-fg-2 hover:text-fg-0'
          )}
        >
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side='top' className='max-w-xs text-12'>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

export function FormulaPills({
  channel,
  markup,
  source,
  pricingRows,
  groupRatios,
  groupRatioError = false,
  forceShowChannelRatio = false,
}: {
  channel: Channel;
  markup: number;
  source: EffectiveMarkupSource;
  pricingRows: PricingRow[];
  groupRatios: Record<string, number>;
  groupRatioError?: boolean;
  /**
   * Render the channel_ratio pill even when the value is 1.0. Enabled in the
   * edit dialog so tenants can see the platform's extra multiplier exists;
   * list cells keep the default (false) for visual calm.
   */
  forceShowChannelRatio?: boolean;
}) {
  const { t } = useTranslation('channels');
  const matchedPricing = useMemo(() => {
    const byName = new Map(pricingRows.map((row) => [row.model_name, row] as const));
    return parseChannelModels(channel.models)
      .map((model) => byName.get(model))
      .filter((row): row is PricingRow => Boolean(row));
  }, [channel.models, pricingRows]);
  const fixedOnly =
    matchedPricing.length > 0 && matchedPricing.every((row) => row.quota_type === 1);
  const channelRatio = readChannelRatio(channel);
  const sourceLabel = t(`tenant_markup_cell.source.${source}`);
  const groupEntries = Object.entries(
    Object.keys(groupRatios).length > 0 ? groupRatios : { default: 1 }
  ).sort(([left], [right]) => {
    if (left === 'default') return -1;
    if (right === 'default') return 1;
    return left.localeCompare(right);
  });

  return (
    <TooltipProvider delayDuration={100}>
      <div className='flex flex-wrap items-center gap-1.5'>
        <Pill
          label={
            fixedOnly
              ? t('tenant_markup_cell.formula.call_count')
              : t('tenant_markup_cell.formula.tokens')
          }
          tooltip={t('tenant_markup_cell.tooltip.usage')}
        />
        <Pill
          label={
            fixedOnly
              ? t('tenant_markup_cell.formula.model_price')
              : t('tenant_markup_cell.formula.model_ratio')
          }
          tooltip={t('tenant_markup_cell.tooltip.model')}
        />
        <Pill
          label={t('tenant_markup_cell.formula.group_ratio')}
          tooltip={
            groupRatioError ? (
              t('tenant_markup_cell.tooltip.group_ratio_error')
            ) : (
              <div className='space-y-1'>
                {groupEntries.map(([group, ratio]) => (
                  <div key={group} className='flex items-center justify-between gap-4'>
                    <span>{group}</span>
                    <span className='tabular-nums'>{formatRatio(ratio)}</span>
                  </div>
                ))}
              </div>
            )
          }
        />
        <Pill
          label={`${t('tenant_markup_cell.formula.my_markup')} ${formatRatio(markup)}`}
          tooltip={t('tenant_markup_cell.tooltip.my_markup', { source: sourceLabel })}
          highlighted
        />
        {(channelRatio !== 1 || forceShowChannelRatio) && (
          <Pill
            label={`${t('tenant_markup_cell.formula.channel_ratio')} ${formatRatio(channelRatio)}`}
            tooltip={t('tenant_markup_cell.tooltip.channel_ratio', {
              ratio: formatRatio(channelRatio),
            })}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
