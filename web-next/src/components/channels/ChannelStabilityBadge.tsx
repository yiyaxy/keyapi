import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock3 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';

export type ChannelStabilityFields = {
  status: number;
  cooldown_until?: number | null;
  cooldown_reason?: string | null;
  cooldown_count?: number | null;
};

export function isChannelCoolingDown(channel: ChannelStabilityFields, nowMs = Date.now()): boolean {
  const until = Number(channel.cooldown_until ?? 0);
  return Number.isFinite(until) && until > nowMs;
}

export function formatCooldownRemaining(untilMs: number, nowMs = Date.now()): string {
  const totalSeconds = Math.max(0, Math.ceil((untilMs - nowMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

function statusBadge(status: number) {
  if (status === 1) return { label: 'status.enabled', variant: 'default' as const };
  if (status === 3) return { label: 'status.auto_disabled', variant: 'destructive' as const };
  return { label: 'status.manually_disabled', variant: 'secondary' as const };
}

export function ChannelStabilityBadge({
  channel,
  className,
  showReason = true,
}: {
  channel: ChannelStabilityFields;
  className?: string;
  showReason?: boolean;
}) {
  const { t } = useTranslation('channels');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const untilMs = Number(channel.cooldown_until ?? 0);
  const cooling = channel.status === 1 && isChannelCoolingDown(channel, nowMs);

  useEffect(() => {
    if (!cooling) return undefined;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [cooling, untilMs]);

  if (cooling) {
    const remaining = formatCooldownRemaining(untilMs, nowMs);
    const reason = (channel.cooldown_reason ?? '').trim();
    const count = Number(channel.cooldown_count ?? 0);
    const title = [
      t('stability.tooltip.until', {
        time: fmtDate(untilMs),
        defaultValue: 'Cooling until {{time}}',
      }),
      reason
        ? t('stability.tooltip.reason', {
            reason,
            defaultValue: 'Reason: {{reason}}',
          })
        : '',
      count > 0
        ? t('stability.tooltip.count', {
            count,
            defaultValue: 'Cooldown hits: {{count}}',
          })
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    return (
      <div className={cn('min-w-0 space-y-1', className)}>
        <Badge
          variant='outline'
          title={title}
          aria-label={title}
          className='border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
        >
          <Clock3 className='mr-1 h-3 w-3' />
          {t('status.cooldown', { defaultValue: 'Cooling down' })}
          <span className='ml-1 font-mono font-normal'>{remaining}</span>
        </Badge>
        {showReason && reason ? (
          <div className='max-w-[220px] truncate text-11 text-fg-2' title={reason}>
            {reason}
          </div>
        ) : null}
      </div>
    );
  }

  const badge = statusBadge(channel.status);
  return (
    <Badge variant={badge.variant} className={className}>
      {t(badge.label)}
    </Badge>
  );
}
