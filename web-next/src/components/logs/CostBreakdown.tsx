import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { LogRow } from '@/hooks/useLogs';
import { type PublicConfig, toDisplay } from '@/hooks/usePublicConfig';

type OtherData = {
  model_ratio?: number;
  completion_ratio?: number;
  group_ratio?: number;
  user_group_ratio?: number;
  channel_ratio?: number;
  cache_tokens?: number;
  cache_ratio?: number;
  model_price?: number;
};

function parseOther(raw: string): OtherData {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function fmtUnit(
  usd: number,
  cfg: PublicConfig,
): string {
  const d = toDisplay(Math.round(usd * cfg.quota_per_unit), cfg);
  const num = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: d.digits,
    maximumFractionDigits: d.digits,
  }).format(d.value);
  return d.symbol ? `${d.symbol}${num}` : num;
}

function fmtPrice(usd: number, cfg: PublicConfig): string {
  return `${fmtUnit(usd, cfg)} / 1M Token`;
}

export function CostBreakdown({
  row,
  cfg,
  children,
}: {
  row: LogRow;
  cfg: PublicConfig;
  children: React.ReactNode;
}) {
  const { t } = useTranslation('logs');
  const other = parseOther(row.other);

  if (
    row.quota <= 0 ||
    (row.type !== 2 && row.type !== 5 && row.type !== 6) ||
    !other.model_ratio
  ) {
    return <>{children}</>;
  }

  const modelRatio = other.model_ratio ?? 0;
  const completionRatio = other.completion_ratio ?? 1;
  const groupRatio = other.user_group_ratio ?? other.group_ratio ?? 1;
  const channelRatio = other.channel_ratio ?? 1;

  const inputPricePerM = modelRatio * 2.0;
  const outputPricePerM = modelRatio * 2.0 * completionRatio;

  const inputCostUsd = (row.prompt_tokens / 1_000_000) * inputPricePerM;
  const outputCostUsd = (row.completion_tokens / 1_000_000) * outputPricePerM;
  const originalUsd = (inputCostUsd + outputCostUsd) * groupRatio;

  const billedDisplay = toDisplay(row.quota, cfg);
  const billedNum = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: billedDisplay.digits,
    maximumFractionDigits: billedDisplay.digits,
  }).format(billedDisplay.value);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <span className='inline-flex cursor-pointer items-center gap-1'>
          {children}
          <Info className='size-3.5 text-fg-2' />
        </span>
      </PopoverTrigger>
      <PopoverContent
        side='top'
        className='w-auto min-w-[220px] p-3 text-13 tabular-nums'
      >
        <p className='mb-2 font-semibold'>{t('cost.title')}</p>
        <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'>
          <dt className='text-fg-2'>{t('cost.input_cost')}</dt>
          <dd className='text-right font-medium'>
            {fmtUnit(inputCostUsd * groupRatio, cfg)}
          </dd>

          <dt className='text-fg-2'>{t('cost.output_cost')}</dt>
          <dd className='text-right font-medium'>
            {fmtUnit(outputCostUsd * groupRatio, cfg)}
          </dd>

          <dt className='text-fg-2'>{t('cost.input_price')}</dt>
          <dd className='text-right font-medium text-[var(--semi-color-link)]'>
            {fmtPrice(inputPricePerM, cfg)}
          </dd>

          <dt className='text-fg-2'>{t('cost.output_price')}</dt>
          <dd className='text-right font-medium text-[var(--semi-color-link)]'>
            {fmtPrice(outputPricePerM, cfg)}
          </dd>

          {channelRatio > 0 && channelRatio !== 1 && (
            <>
              <dt className='mt-1 border-t border-line pt-1 text-fg-2'>
                {t('cost.multiplier')}
              </dt>
              <dd className='mt-1 border-t border-line pt-1 text-right font-semibold'>
                {channelRatio}x
              </dd>

              <dt className='text-fg-2'>{t('cost.original')}</dt>
              <dd className='text-right font-medium'>
                {fmtUnit(originalUsd, cfg)}
              </dd>
            </>
          )}

          <dt className='mt-1 border-t border-line pt-1 text-fg-2'>
            {t('cost.billed')}
          </dt>
          <dd className='mt-1 border-t border-line pt-1 text-right font-semibold text-green-500'>
            {billedDisplay.symbol}{billedNum}
          </dd>
        </dl>
      </PopoverContent>
    </Popover>
  );
}
