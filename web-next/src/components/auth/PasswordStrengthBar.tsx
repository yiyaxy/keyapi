import { useTranslation } from 'react-i18next';

import { type Strength, estimateStrength } from '@/lib/password';
import { cn } from '@/lib/utils';

const WIDTHS: Record<Strength, string> = {
  none: 'w-0',
  weak: 'w-1/4',
  fair: 'w-2/4',
  good: 'w-3/4',
  strong: 'w-full',
};

const COLORS: Record<Strength, string> = {
  none: 'bg-bg-2',
  weak: 'bg-danger',
  fair: 'bg-warn',
  good: 'bg-info',
  strong: 'bg-success',
};

export function PasswordStrengthBar({ value }: { value: string }) {
  const s = estimateStrength(value);
  const { t } = useTranslation('auth');
  return (
    <div className='flex items-center gap-2'>
      <div
        className='relative h-1 flex-1 overflow-hidden rounded-pill bg-bg-2'
        role='progressbar'
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={['none', 'weak', 'fair', 'good', 'strong'].indexOf(s)}
      >
        <div className={cn('absolute left-0 top-0 h-full transition-all', WIDTHS[s], COLORS[s])} />
      </div>
      <span className='w-10 text-right text-12 text-fg-1'>{t(`strength.${s}`)}</span>
    </div>
  );
}
