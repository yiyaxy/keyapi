import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

import { cn } from '@/lib/utils';

export type BannerLevel = 'danger' | 'warn' | 'success' | 'info';

const ICONS: Record<BannerLevel, typeof AlertCircle> = {
  danger: AlertCircle,
  warn: AlertCircle,
  success: CheckCircle2,
  info: Info,
};

const STYLES: Record<BannerLevel, string> = {
  danger: 'bg-danger-soft text-fg-0',
  warn: 'bg-warn-soft text-fg-0',
  success: 'bg-success-soft text-fg-0',
  info: 'bg-info-soft text-fg-0',
};

export function InlineBanner({
  level,
  message,
  onClose,
  className,
}: {
  level: BannerLevel;
  message: string;
  onClose?: () => void;
  className?: string;
}) {
  const Icon = ICONS[level];
  return (
    <div
      role='alert'
      className={cn(
        'flex items-start gap-2 rounded-sm px-3 py-2 text-13',
        STYLES[level],
        className
      )}
    >
      <Icon size={14} strokeWidth={1.5} className='mt-[2px] shrink-0' />
      <p className='flex-1'>{message}</p>
      {onClose && (
        <button
          type='button'
          aria-label='Close'
          onClick={onClose}
          className='shrink-0 rounded-xs p-[2px] hover:bg-bg-2'
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}
