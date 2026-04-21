import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';

type TraceEvent = {
  time: number;
  phase: string;
  message: string;
  detail?: Record<string, unknown>;
};

export function parseTraceEvents(raw: string): TraceEvent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { trace_events?: unknown };
    const arr = parsed?.trace_events;
    if (!Array.isArray(arr)) return [];
    const events = arr
      .filter((e): e is TraceEvent => {
        return (
          typeof e === 'object' &&
          e !== null &&
          typeof (e as TraceEvent).time === 'number' &&
          typeof (e as TraceEvent).phase === 'string'
        );
      })
      .sort((a, b) => a.time - b.time);
    return events;
  } catch {
    return [];
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

const PHASE_COLOR: Record<string, string> = {
  validate: 'text-sky-600 dark:text-sky-400',
  init: 'text-sky-600 dark:text-sky-400',
  tenant_check: 'text-violet-600 dark:text-violet-400',
  sensitive_check: 'text-amber-600 dark:text-amber-400',
  token_estimate: 'text-fg-1',
  pricing: 'text-emerald-600 dark:text-emerald-400',
  pre_billing: 'text-emerald-600 dark:text-emerald-400',
  channel_select: 'text-indigo-600 dark:text-indigo-400',
  upstream: 'text-orange-600 dark:text-orange-400',
  post_billing: 'text-emerald-600 dark:text-emerald-400',
  refund: 'text-red-600 dark:text-red-400',
};

export function TraceTimeline({ other }: { other: string }) {
  const { t } = useTranslation('ops');
  const events = parseTraceEvents(other);

  if (events.length === 0) return null;

  const t0 = events[0].time;
  const total = events[events.length - 1].time - t0;

  return (
    <div className='mt-3 rounded-md border border-line bg-bg-1/50 p-3 text-12'>
      <div className='mb-2 flex items-center justify-between'>
        <span className='font-medium text-fg-1'>{t('trace.timeline.title')}</span>
        <span className='font-mono tabular-nums text-fg-2'>
          {t('trace.timeline.total', { ms: formatMs(total) })}
        </span>
      </div>
      <ul className='space-y-1.5'>
        {events.map((ev, i) => {
          const fromStart = ev.time - t0;
          const delta = i === 0 ? 0 : ev.time - events[i - 1].time;
          const isSlow = delta >= 1000;
          const phaseClass = PHASE_COLOR[ev.phase] ?? 'text-fg-2';
          return (
            <li key={i} className='flex items-start gap-3'>
              <span className='w-16 shrink-0 text-right font-mono text-11 tabular-nums text-fg-2'>
                +{formatMs(fromStart)}
              </span>
              <Badge variant='outline' className={`shrink-0 ${phaseClass}`}>
                {ev.phase}
              </Badge>
              <span className='min-w-0 flex-1 break-words text-fg-1'>{ev.message}</span>
              {i > 0 && (
                <span
                  className={`shrink-0 font-mono text-11 tabular-nums ${
                    isSlow ? 'font-semibold text-orange-600 dark:text-orange-400' : 'text-fg-2'
                  }`}
                >
                  Δ {formatMs(delta)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
