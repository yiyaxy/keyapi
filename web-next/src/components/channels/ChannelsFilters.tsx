import { useTranslation } from 'react-i18next';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CHANNEL_TYPES } from '@/lib/channelTypes';

export type ChannelsFilterState = {
  status: 'all' | 'enabled' | 'disabled';
  type: number; // -1 = all
};

export function ChannelsFilters({
  value,
  onChange,
}: {
  value: ChannelsFilterState;
  onChange: (v: ChannelsFilterState) => void;
}) {
  const { t } = useTranslation('channels');
  return (
    <div className='flex flex-wrap items-center gap-3'>
      <Select
        value={value.status}
        onValueChange={(v) => onChange({ ...value, status: v as ChannelsFilterState['status'] })}
      >
        <SelectTrigger className='w-40'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='all'>{t('filters.status.all')}</SelectItem>
          <SelectItem value='enabled'>{t('filters.status.enabled')}</SelectItem>
          <SelectItem value='disabled'>{t('filters.status.disabled')}</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={String(value.type)}
        onValueChange={(v) => onChange({ ...value, type: Number(v) })}
      >
        <SelectTrigger className='w-56'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='-1'>{t('filters.type.all')}</SelectItem>
          {CHANNEL_TYPES.map((typ) => (
            <SelectItem key={typ.id} value={String(typ.id)}>
              {typ.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
