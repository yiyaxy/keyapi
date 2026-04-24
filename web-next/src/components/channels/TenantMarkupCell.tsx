import { useTranslation } from 'react-i18next';

import {
  FormulaPills,
  formatRatio,
  resolveEffectiveMarkup,
} from '@/components/channels/FormulaPills';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Channel } from '@/hooks/useChannels';
import type { PricingRow } from '@/hooks/usePricing';
import type { TenantPlatformChannelMarkup } from '@/hooks/useTenantBilling';
import { cn } from '@/lib/utils';

export function TenantMarkupCell({
  channel,
  override,
  planMarkup,
  pricingRows,
  groupRatios,
  groupRatioError = false,
  onEdit,
}: {
  channel: Channel;
  override?: TenantPlatformChannelMarkup;
  planMarkup: number;
  pricingRows: PricingRow[];
  groupRatios: Record<string, number>;
  groupRatioError?: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation('channels');
  const effective = resolveEffectiveMarkup(channel, override, planMarkup);

  return (
    <div className='space-y-2'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='font-medium tabular-nums text-fg-0'>{formatRatio(effective.value)}</span>
        <Badge
          variant='outline'
          className={cn(
            'border text-[11px]',
            effective.source === 'tenant_channel'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-fg-0'
              : 'border-line bg-bg-1 text-fg-2'
          )}
        >
          {t(`tenant_markup_cell.source.${effective.source}`)}
        </Badge>
        <Button type='button' size='sm' variant='ghost' onClick={onEdit}>
          {t('tenant_markup_cell.edit')}
        </Button>
      </div>
      <FormulaPills
        channel={channel}
        markup={effective.value}
        source={effective.source}
        pricingRows={pricingRows}
        groupRatios={groupRatios}
        groupRatioError={groupRatioError}
      />
    </div>
  );
}
