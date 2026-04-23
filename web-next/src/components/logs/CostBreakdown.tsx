import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { LogRow } from '@/hooks/useLogs';
import { type PublicConfig, toDisplay } from '@/hooks/usePublicConfig';

export type OtherData = {
  model_ratio?: number;
  completion_ratio?: number;
  group_ratio?: number;
  user_group_ratio?: number;
  channel_ratio?: number;
  cache_tokens?: number;
  cache_ratio?: number;
  model_price?: number;
};

export function parseOther(raw: string): OtherData {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as OtherData;
    }
    return {};
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
  // user_group_ratio 在无特殊分组倍率时后端会落库为哨兵值 -1，不能直接当
  // 倍率使用；只在 > 0 时才采用。group_ratio 同样做正值守卫。
  const specialRatio = other.user_group_ratio;
  const fallbackGroupRatio =
    other.group_ratio && other.group_ratio > 0 ? other.group_ratio : 1;
  const groupRatio =
    specialRatio !== undefined && specialRatio > 0
      ? specialRatio
      : fallbackGroupRatio;
  const channelRatio = other.channel_ratio ?? 1;
  const cacheRatio = other.cache_ratio ?? 1;
  const cacheTokens = Math.min(other.cache_tokens ?? 0, row.prompt_tokens);
  const hasCache = cacheTokens > 0 && cacheRatio > 0 && cacheRatio !== 1;

  const inputPricePerM = modelRatio * 2.0;
  const outputPricePerM = modelRatio * 2.0 * completionRatio;
  const cachePricePerM = inputPricePerM * cacheRatio;

  // 缓存命中的 prompt tokens 按 cache_ratio 折扣计价，其余按正常输入价。
  // 下面三项 cost 均为 *base*（未乘任何倍率），tooltip 里直接展示 base，
  // 让用户能用 `原始 × 分组 × 渠道 = 计费` 心算对上。对应 "cost.original"
  // 行就是这三项的合计，任何 ratio 都在后面的"倍率"小节明示。
  const normalInputTokens = row.prompt_tokens - (hasCache ? cacheTokens : 0);
  const normalInputCostUsd = (normalInputTokens / 1_000_000) * inputPricePerM;
  const cachedInputCostUsd = hasCache
    ? (cacheTokens / 1_000_000) * inputPricePerM * cacheRatio
    : 0;
  const outputCostUsd = (row.completion_tokens / 1_000_000) * outputPricePerM;
  const baseUsd = normalInputCostUsd + cachedInputCostUsd + outputCostUsd;

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
          {hasCache ? (
            <>
              <dt className='text-fg-2'>{t('cost.input_cost_normal')}</dt>
              <dd className='text-right font-medium'>
                {fmtUnit(normalInputCostUsd, cfg)}
              </dd>

              <dt className='text-fg-2'>{t('cost.input_cost_cached')}</dt>
              <dd className='text-right font-medium'>
                {fmtUnit(cachedInputCostUsd, cfg)}
              </dd>
            </>
          ) : (
            <>
              <dt className='text-fg-2'>{t('cost.input_cost')}</dt>
              <dd className='text-right font-medium'>
                {fmtUnit(normalInputCostUsd, cfg)}
              </dd>
            </>
          )}

          <dt className='text-fg-2'>{t('cost.output_cost')}</dt>
          <dd className='text-right font-medium'>
            {fmtUnit(outputCostUsd, cfg)}
          </dd>

          {hasCache && (
            <>
              <dt className='text-fg-2'>{t('cost.cache_tokens')}</dt>
              <dd className='text-right font-medium'>
                {new Intl.NumberFormat().format(cacheTokens)}
                {' · '}
                {cacheRatio}x
              </dd>
            </>
          )}

          <dt className='text-fg-2'>{t('cost.input_price')}</dt>
          <dd className='text-right font-medium text-[var(--semi-color-link)]'>
            {fmtPrice(inputPricePerM, cfg)}
          </dd>

          <dt className='text-fg-2'>{t('cost.output_price')}</dt>
          <dd className='text-right font-medium text-[var(--semi-color-link)]'>
            {fmtPrice(outputPricePerM, cfg)}
          </dd>

          {hasCache && (
            <>
              <dt className='text-fg-2'>{t('cost.cache_price')}</dt>
              <dd className='text-right font-medium text-[var(--semi-color-link)]'>
                {fmtPrice(cachePricePerM, cfg)}
              </dd>
            </>
          )}

          {(groupRatio !== 1 || (channelRatio > 0 && channelRatio !== 1)) && (
            <>
              {groupRatio !== 1 && (
                <>
                  <dt className='mt-1 border-t border-line pt-1 text-fg-2'>
                    {t('cost.group_ratio')}
                  </dt>
                  <dd className='mt-1 border-t border-line pt-1 text-right font-semibold'>
                    {groupRatio}x
                  </dd>
                </>
              )}
              {channelRatio > 0 && channelRatio !== 1 && (
                <>
                  <dt
                    className={
                      groupRatio !== 1
                        ? 'text-fg-2'
                        : 'mt-1 border-t border-line pt-1 text-fg-2'
                    }
                  >
                    {t('cost.channel_ratio')}
                  </dt>
                  <dd
                    className={
                      groupRatio !== 1
                        ? 'text-right font-semibold'
                        : 'mt-1 border-t border-line pt-1 text-right font-semibold'
                    }
                  >
                    {channelRatio}x
                  </dd>
                </>
              )}

              <dt className='text-fg-2'>{t('cost.original')}</dt>
              <dd className='text-right font-medium'>
                {fmtUnit(baseUsd, cfg)}
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
