import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type Range = '7d' | '30d';

// eslint-disable-next-line react-refresh/only-export-components
export function useRange(): Range {
  const [params] = useSearchParams();
  return params.get('range') === '7d' ? '7d' : '30d';
}

// eslint-disable-next-line react-refresh/only-export-components
export function rangeToSeconds(range: Range): { startSec: number; endSec: number } {
  const endSec = Math.floor(Date.now() / 1000);
  const days = range === '7d' ? 7 : 30;
  const startSec = endSec - days * 86400;
  return { startSec, endSec };
}

export function RangeSelect() {
  const { t } = useTranslation('dashboard');
  const [params, setParams] = useSearchParams();
  const value = (params.get('range') === '7d' ? '7d' : '30d') as Range;
  return (
    <Select value={value} onValueChange={(v) => setParams({ range: v })}>
      <SelectTrigger className='w-36'>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value='7d'>{t('range.7d')}</SelectItem>
        <SelectItem value='30d'>{t('range.30d')}</SelectItem>
      </SelectContent>
    </Select>
  );
}
