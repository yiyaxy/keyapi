import { useTranslation } from 'react-i18next';

import { parseOther } from './CostBreakdown';

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

function latencyTotalClass(seconds: number): string {
  if (seconds >= 30) return 'text-red-500 dark:text-red-400';
  if (seconds >= 10) return 'text-orange-500 dark:text-orange-400';
  if (seconds >= 3) return 'text-amber-500 dark:text-amber-400';
  return 'text-emerald-500 dark:text-emerald-400';
}

function ttftClass(ms: number): string {
  if (ms >= 3000) return 'text-orange-500 dark:text-orange-400';
  if (ms >= 1000) return 'text-amber-500 dark:text-amber-400';
  return 'text-emerald-500 dark:text-emerald-400';
}

type OtherWithFrt = { frt?: number };

export function LatencyCell({
  useTime,
  other,
}: {
  useTime: number;
  other: string;
}) {
  const { t } = useTranslation('logs');
  if (!useTime || useTime <= 0) {
    return <span className='text-fg-2'>—</span>;
  }

  const parsed = parseOther(other) as OtherWithFrt;
  const frtMs = typeof parsed.frt === 'number' && parsed.frt > 0 ? parsed.frt : null;
  const totalMs = useTime * 1000;

  // 只有流式请求后端才写有效 frt；非流式直接只渲染总耗时。
  if (frtMs == null) {
    return (
      <span className={`font-medium tabular-nums ${latencyTotalClass(useTime)}`}>
        {useTime >= 60
          ? t('table.latency.m', { m: Math.floor(useTime / 60), s: useTime % 60 })
          : t('table.latency.s', { s: useTime })}
      </span>
    );
  }

  const genMs = Math.max(totalMs - frtMs, 0);
  return (
    <div className='flex flex-col gap-0.5 tabular-nums'>
      <span className={`font-medium ${latencyTotalClass(useTime)}`}>
        {useTime >= 60
          ? t('table.latency.m', { m: Math.floor(useTime / 60), s: useTime % 60 })
          : t('table.latency.s', { s: useTime })}
      </span>
      <span className='flex gap-2 text-11 text-fg-2'>
        <span>
          {t('table.latency.ttft')}{' '}
          <span className={ttftClass(frtMs)}>{formatMs(frtMs)}</span>
        </span>
        <span>
          {t('table.latency.gen')} {formatMs(genMs)}
        </span>
      </span>
    </div>
  );
}
