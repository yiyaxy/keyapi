import React, { useState, useEffect, useMemo } from 'react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useTranslation } from '../lib/i18n';
import { API } from '../lib/api';
import { toast } from 'react-hot-toast';

interface SystemStatus {
  version: string;
  start_time: number;
  server_address?: string;
  docs_link?: string;
  uptime_kuma_enabled?: boolean;
}

interface LogEntry {
  id: number;
  type: number;
  content: string;
  created_at: number;
  model_name: string;
  use_time: number;
  quota: number;
}

interface QuotaDataPoint {
  created_at: number;
  count: number;
  quota: number;
  token_used?: number;
}

interface UptimeHeartbeat {
  status: number;
  time: string;
}

interface UptimeMonitor {
  name: string;
  uptime: number;
  uptime_7d: number;
  status: number;
  heartbeats: UptimeHeartbeat[];
}

interface UptimeGroup {
  categoryName: string;
  monitors: UptimeMonitor[];
}

interface ResponseStats {
  success: string;
  clientError: string;
  serverError: string;
}

interface StatData {
  quota: number;
  rpm: number;
  tpm: number;
}

interface RangeWindow {
  startTimestamp: number;
  endTimestamp: number;
  bucketTimestamps: number[];
  granularity: 'hour' | 'day';
}

interface RequestComparison {
  todayRequests: number;
  yesterdayRequests: number;
  deltaPercent: number;
}

const getDayStart = (timestamp: number): number => {
  const date = new Date(timestamp * 1000);
  date.setHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
};

const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const [timeRange, setTimeRange] = useState<'day' | 'week' | 'month'>('week');
  const [chartMode, setChartMode] = useState<'reqs' | 'cost'>('reqs');
  const [loading, setLoading] = useState(true);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [recentLogs, setRecentLogs] = useState<LogEntry[]>([]);
  const [chartData, setChartData] = useState<Array<{ name: string; reqs: number; cost: number }>>([]);
  const [responseStats, setResponseStats] = useState<ResponseStats>({
    success: '0%',
    clientError: '0%',
    serverError: '0%',
  });
  const [statData, setStatData] = useState<StatData>({ quota: 0, rpm: 0, tpm: 0 });
  const [totalTokens, setTotalTokens] = useState(0);
  const [requestComparison, setRequestComparison] = useState<RequestComparison>({
    todayRequests: 0,
    yesterdayRequests: 0,
    deltaPercent: 0,
  });
  const [chartRangeLabel, setChartRangeLabel] = useState('');
  const [apiInfo, setApiInfo] = useState<Array<{id: string; route: string; url: string; description: string; color: string}>>([]);
  const [uptimeData, setUptimeData] = useState<UptimeGroup[]>([]);
  const [uptimeLoading, setUptimeLoading] = useState(false);

  const ranges = [
      { id: 'day', label: t('dash.day') },
      { id: 'week', label: t('dash.week') },
      { id: 'month', label: t('dash.month') },
  ];

  useEffect(() => {
    fetchDashboardData(timeRange);
  }, [timeRange]);

  useEffect(() => {
    if (!systemStatus?.uptime_kuma_enabled) return;
    const fetchUptime = async () => {
      setUptimeLoading(true);
      try {
        const res = await API.get('/api/uptime/status');
        if (res.data?.success && Array.isArray(res.data?.data)) {
          setUptimeData(res.data.data);
        }
      } catch (e) {
        console.error('Failed to fetch uptime:', e);
      } finally {
        setUptimeLoading(false);
      }
    };
    fetchUptime();
  }, [systemStatus?.uptime_kuma_enabled]);

  const formatHourLabel = (timestamp: number) => {
    const hour = new Date(timestamp * 1000).getHours().toString().padStart(2, '0');
    return `${hour}:00`;
  };

  const formatDayLabel = (timestamp: number) => {
    const dt = new Date(timestamp * 1000);
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  };

  const getRangeWindow = (range: 'day' | 'week' | 'month'): RangeWindow => {
    const now = new Date();
    const endTimestamp = Math.floor(now.getTime() / 1000);

    if (range === 'day') {
      const currentHour = new Date(now);
      currentHour.setMinutes(0, 0, 0);

      const bucketTimestamps: number[] = [];
      for (let i = 23; i >= 0; i -= 1) {
        const point = new Date(currentHour);
        point.setHours(currentHour.getHours() - i);
        bucketTimestamps.push(Math.floor(point.getTime() / 1000));
      }

      return {
        startTimestamp: bucketTimestamps[0],
        endTimestamp,
        bucketTimestamps,
        granularity: 'hour',
      };
    }

    const dayCount = range === 'week' ? 7 : 30;
    const currentDay = new Date(now);
    currentDay.setHours(0, 0, 0, 0);

    const bucketTimestamps: number[] = [];
    for (let i = dayCount - 1; i >= 0; i -= 1) {
      const point = new Date(currentDay);
      point.setDate(currentDay.getDate() - i);
      bucketTimestamps.push(Math.floor(point.getTime() / 1000));
    }

    return {
      startTimestamp: bucketTimestamps[0],
      endTimestamp,
      bucketTimestamps,
      granularity: 'day',
    };
  };

  const buildRangeLabel = (window: RangeWindow) => {
    const start = new Date(window.bucketTimestamps[0] * 1000);
    const end = new Date(window.endTimestamp * 1000);
    return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
  };

  const buildChartData = (data: QuotaDataPoint[], range: 'day' | 'week' | 'month', window: RangeWindow) => {
    const buckets = window.bucketTimestamps.map((ts) => ({
      ts,
      name: range === 'day' ? formatHourLabel(ts) : formatDayLabel(ts),
      reqs: 0,
      cost: 0,
    }));
    const bucketIndex = new Map<number, number>();
    buckets.forEach((bucket, idx) => {
      bucketIndex.set(bucket.ts, idx);
    });

    data.forEach((item) => {
      const bucketTime = new Date(item.created_at * 1000);
      if (window.granularity === 'hour') {
        bucketTime.setMinutes(0, 0, 0);
      } else {
        bucketTime.setHours(0, 0, 0, 0);
      }
      const normalizedTs = Math.floor(bucketTime.getTime() / 1000);
      const idx = bucketIndex.get(normalizedTs);
      if (idx !== undefined) {
        buckets[idx].reqs += item.count || 0;
        buckets[idx].cost += item.quota || 0;
      }
    });

    return buckets.map((item) => ({ name: item.name, reqs: item.reqs, cost: item.cost }));
  };

  const calcResponseStats = (logs: LogEntry[]): ResponseStats => {
    if (logs.length === 0) {
      return { success: '0%', clientError: '0%', serverError: '0%' };
    }

    // Log types from backend: 2=Consume(success), 5=Error
    // TODO: Backend doesn't distinguish 4xx vs 5xx errors - all errors are type 5
    // For now, treat all type 5 as server errors and calculate client errors from remainder
    const total = logs.length;
    const successCount = logs.filter((log) => log.type === 2).length;
    const errorCount = logs.filter((log) => log.type === 5).length;

    const successPct = Math.round((successCount / total) * 100);
    const serverErrPct = Math.round((errorCount / total) * 100);
    const clientErrPct = Math.max(0, 100 - successPct - serverErrPct);

    return {
      success: `${successPct}%`,
      clientError: `${clientErrPct}%`,
      serverError: `${serverErrPct}%`,
    };
  };

  const fetchDashboardData = async (range: 'day' | 'week' | 'month') => {
    setLoading(true);
    try {
      const rangeWindow = getRangeWindow(range);
      const now = Date.now();
      const todayStartDate = new Date(now);
      todayStartDate.setHours(0, 0, 0, 0);
      const todayStart = Math.floor(todayStartDate.getTime() / 1000);
      const yesterdayStart = todayStart - 24 * 60 * 60;

      setChartRangeLabel(buildRangeLabel(rangeWindow));
      const [statusRes, logsRes, dataRes, statRes, compareRes] = await Promise.all([
        API.get('/api/status'),
        API.get('/api/log/self', { params: { p: 1, page_size: 100 } }),
        API.get('/api/data/self', {
          params: {
            start_timestamp: rangeWindow.startTimestamp,
            end_timestamp: rangeWindow.endTimestamp,
          },
        }),
        API.get('/api/log/self/stat', {
          params: {
            start_timestamp: rangeWindow.startTimestamp,
            end_timestamp: rangeWindow.endTimestamp,
          },
        }),
        API.get('/api/data/self', {
          params: {
            start_timestamp: yesterdayStart,
            end_timestamp: rangeWindow.endTimestamp,
          },
        }),
      ]);

      if (statusRes.data.success) {
        const statusData = statusRes.data.data || {};
        setSystemStatus({
          version: statusData.version,
          start_time: statusData.start_time,
          server_address: statusData.server_address,
          docs_link: statusData.docs_link,
          uptime_kuma_enabled: statusData.uptime_kuma_enabled,
        });

        setApiInfo(statusData.api_info || []);
      }

      if (logsRes.data.success) {
        const logItems = logsRes.data.data?.items || [];
        setRecentLogs(logItems.slice(0, 5));
        setResponseStats(calcResponseStats(logItems));
      }

      if (dataRes.data.success) {
        const quotaData: QuotaDataPoint[] = dataRes.data.data || [];
        setChartData(buildChartData(quotaData, range, rangeWindow));
        const tokenUsage = quotaData.reduce(
          (sum, item) => sum + Number(item.token_used || 0),
          0,
        );
        setTotalTokens(tokenUsage);
      }

      if (statRes.data.success) {
        setStatData(statRes.data.data || { quota: 0, rpm: 0, tpm: 0 });
      }

      if (compareRes.data.success) {
        const compareData: QuotaDataPoint[] = compareRes.data.data || [];
        let todayRequests = 0;
        let yesterdayRequests = 0;

        compareData.forEach((item) => {
          const dayStart = getDayStart(item.created_at);
          if (dayStart === todayStart) {
            todayRequests += Number(item.count || 0);
          } else if (dayStart === yesterdayStart) {
            yesterdayRequests += Number(item.count || 0);
          }
        });

        const deltaPercent =
          yesterdayRequests > 0
            ? ((todayRequests - yesterdayRequests) / yesterdayRequests) * 100
            : todayRequests > 0
              ? 100
              : 0;

        setRequestComparison({
          todayRequests,
          yesterdayRequests,
          deltaPercent,
        });
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatUptime = () => {
    const start = new Date('2026-02-04T00:00:00+08:00').getTime();
    const now = Date.now();
    const days = Math.max(0, Math.floor((now - start) / (1000 * 60 * 60 * 24)));
    return `${days} ${t('dash.days')}`;
  };

  const formatQuota = (quota: number) => {
    return (quota / 500000).toFixed(2);
  };

  const formatTokens = (tokens: number) => {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(2)}M`;
    }
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(2)}K`;
    }
    return tokens.toString();
  };

  const formatDeltaPercent = (value: number) => {
    const rounded = Math.abs(value) >= 100
      ? value.toFixed(0)
      : value.toFixed(1);
    if (value > 0) return `+${rounded}%`;
    if (value < 0) return `${rounded}%`;
    return '0%';
  };

  const formatTimestamp = (timestamp: number) => {
    const now = Date.now() / 1000;
    const diff = now - timestamp;
    if (diff < 0) return t('dash.just_now');
    if (diff < 60) return `${Math.floor(diff)}${t('dash.seconds_ago')}`;
    if (diff < 3600) return `${Math.floor(diff / 60)}${t('dash.minutes_ago')}`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}${t('dash.hours_ago')}`;
    return `${Math.floor(diff / 86400)}${t('dash.days_ago')}`;
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('dash.copied'));
    } catch (error) {
      console.error('Copy failed:', error);
    }
  };

  const handleExportChart = () => {
    if (chartData.length === 0) return;
    const lines = ['time,requests,cost($)', ...chartData.map((item) => `${item.name},${item.reqs},${(item.cost / 500000).toFixed(4)}`)];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `dashboard-traffic-${timeRange}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const statusColorMap: Record<number, string> = {
    1: '#10b981', 0: '#ef4444', 2: '#f59e0b', 3: '#3b82f6',
  };

  const processHeartbeats = (heartbeats: UptimeHeartbeat[], hours: number = 168) => {
    const segments = 90;
    const now = Date.now();
    const rangeStart = now - hours * 60 * 60 * 1000;
    const bucketSize = (now - rangeStart) / segments;
    const statuses: number[] = new Array(segments).fill(-1);
    for (const hb of heartbeats) {
      const ts = new Date(hb.time).getTime();
      if (ts < rangeStart || ts > now) continue;
      const idx = Math.min(Math.floor((ts - rangeStart) / bucketSize), segments - 1);
      if (statuses[idx] === -1 || hb.status < statuses[idx]) statuses[idx] = hb.status;
    }
    for (let i = 1; i < segments; i++) {
      if (statuses[i] === -1 && statuses[i - 1] !== -1) statuses[i] = statuses[i - 1];
    }
    for (let i = segments - 2; i >= 0; i--) {
      if (statuses[i] === -1 && statuses[i + 1] !== -1) statuses[i] = statuses[i + 1];
    }
    return statuses.map((s, i) => ({ status: s, start: rangeStart + i * bucketSize, end: rangeStart + (i + 1) * bucketSize }));
  };

  const allMonitors = useMemo(() => uptimeData.flatMap(g => g.monitors), [uptimeData]);

  if (loading) {
    return (
      <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto">
        <div className="text-center text-slate-500">{t('dash.loading')}</div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white tracking-tight">{t('dash.title')}</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">{t('dash.subtitle')}</p>
        </div>
        
        {/* Time Range Toggle - Unified Design */}
        <div className="bg-slate-100 dark:bg-dark-surface p-1 rounded-xl inline-flex self-start md:self-auto">
            {ranges.map((range) => (
                <button
                    key={range.id}
                    onClick={() => setTimeRange(range.id as any)}
                    className={`
                        relative px-6 py-2 text-sm font-semibold rounded-lg transition-all duration-200
                        ${timeRange === range.id 
                            ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-white/10' 
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                        }
                    `}
                >
                    {range.label}
                </button>
            ))}
        </div>
      </div>


      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KpiCard
          title={t('dash.kpi.requests')}
          value={requestComparison.todayRequests.toLocaleString()}
          change={formatDeltaPercent(requestComparison.deltaPercent)}
          trend={
            requestComparison.deltaPercent > 0
              ? 'up'
              : requestComparison.deltaPercent < 0
                ? 'down'
                : 'neutral'
          }
          icon="data_usage"
          subtitle={t('dash.vs_last')}
        />
        <KpiCard
          title={t('dash.kpi.realtime_cost')}
          value={`$${formatQuota(statData.quota)}`}
          change={chartRangeLabel}
          trend="neutral"
          icon="payments"
          subtitle=""
          isTag
        />
        <KpiCard
          title={t('dash.kpi.token_usage')}
          value={formatTokens(totalTokens)}
          change={chartRangeLabel}
          trend="neutral"
          icon="token"
          subtitle=""
          isTag
        />
        <KpiCard
          title={t('dash.kpi.uptime')}
          value={formatUptime()}
          change={systemStatus?.version || t('dash.unknown')}
          trend="neutral"
          icon="check_circle"
          subtitle=""
          isTag
        />
      </div>

      {/* API Info + Uptime Panel */}
      {(apiInfo.length > 0 || allMonitors.length > 0) && (
        <div className="bg-white dark:bg-dark-surface rounded-3xl p-6 md:p-8 shadow-sm border border-slate-100 dark:border-dark-border">
          <div className={`grid gap-8 ${apiInfo.length > 0 && allMonitors.length > 0 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
            {/* Left: API Info */}
            {apiInfo.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="material-symbols-outlined text-primary text-[20px]">api</span>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{t('dash.api_info')}</h3>
                </div>
                <div className="space-y-2">
                  {apiInfo.map((api) => (
                    <div key={api.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-black/20 border border-slate-100 dark:border-white/5 hover:border-primary/30 transition-colors group">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                        {api.route.substring(0, 2)}
                      </div>
                      <div className="w-28 text-sm font-semibold text-slate-900 dark:text-white truncate shrink-0">
                        {api.route}
                      </div>
                      <button
                        className="min-w-0 flex-1 text-left text-sm text-primary truncate hover:underline"
                        onClick={() => copyText(api.url)}
                      >
                        {api.url}
                      </button>
                      {api.description && (
                        <div className="hidden xl:block max-w-48 text-xs text-slate-500 dark:text-slate-400 truncate">
                          {api.description}
                        </div>
                      )}
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => copyText(api.url)} className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors opacity-0 group-hover:opacity-100">
                          <span className="material-symbols-outlined text-[16px]">content_copy</span>
                        </button>
                        <button onClick={() => window.open(api.url, '_blank', 'noopener,noreferrer')} className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors opacity-0 group-hover:opacity-100">
                          <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Right: Uptime Status */}
            {allMonitors.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-emerald-500 text-[20px]">monitor_heart</span>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{t('public.uptime.title')}</h3>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    {[
                      { status: 1, key: 'public.uptime.up' },
                      { status: 0, key: 'public.uptime.down' },
                      { status: 2, key: 'public.uptime.degraded' },
                    ].map(({ status, key }) => (
                      <div key={key} className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: statusColorMap[status] }} />
                        <span>{t(key)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  {allMonitors.map((monitor, idx) => {
                    const buckets = processHeartbeats(monitor.heartbeats || [], 24);
                    const pct = (monitor.uptime * 100).toFixed(2);
                    const color = monitor.uptime >= 0.99 ? '#10b981' : monitor.uptime >= 0.95 ? '#f59e0b' : '#ef4444';
                    return (
                      <div key={`${monitor.name}-${idx}`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: monitor.status === 1 ? '#10b981' : monitor.status === 0 ? '#ef4444' : '#f59e0b' }} />
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate max-w-[180px]">{monitor.name}</span>
                          </div>
                          <span className="text-sm font-semibold tabular-nums" style={{ color }}>{pct}%</span>
                        </div>
                        <div className="flex gap-[1px] h-6 rounded overflow-hidden">
                          {buckets.map((b, i) => (
                            <div
                              key={i}
                              className="flex-1 transition-opacity hover:opacity-70"
                              style={{ backgroundColor: b.status === -1 ? '#e2e8f0' : statusColorMap[b.status] || '#94a3b8', minWidth: '1px' }}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between mt-2 text-xs text-slate-400">
                  <span>{t('public.uptime.hours_ago')}</span>
                  <span>{t('public.uptime.now')}</span>
                </div>
              </div>
            )}

            {/* Uptime loading skeleton */}
            {uptimeLoading && allMonitors.length === 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="material-symbols-outlined text-emerald-500 text-[20px]">monitor_heart</span>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{t('public.uptime.title')}</h3>
                </div>
                <div className="space-y-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="animate-pulse">
                      <div className="flex justify-between mb-1">
                        <div className="h-4 w-28 bg-slate-200 dark:bg-slate-700 rounded" />
                        <div className="h-4 w-14 bg-slate-200 dark:bg-slate-700 rounded" />
                      </div>
                      <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Chart */}
      <div className="bg-white dark:bg-dark-surface rounded-3xl p-6 md:p-8 shadow-sm border border-slate-100 dark:border-dark-border">
        <div className="flex justify-between items-center mb-8">
            <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{t('dash.traffic')}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">{chartRangeLabel}</p>
            </div>
            <div className="flex items-center gap-3">
                <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-lg inline-flex">
                    <button
                        onClick={() => setChartMode('reqs')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${chartMode === 'reqs' ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                    >
                        {t('dash.chart_reqs')}
                    </button>
                    <button
                        onClick={() => setChartMode('cost')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${chartMode === 'cost' ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                    >
                        {t('dash.chart_cost')}
                    </button>
                </div>
                <button onClick={handleExportChart} className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                    <span className="material-symbols-outlined text-[18px]">download</span>
                    {t('dash.export')}
                </button>
            </div>
        </div>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorReqs" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#135bec" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#135bec" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                itemStyle={{ color: '#fff' }}
                formatter={(value: number) => chartMode === 'cost' ? [`$${(value / 500000).toFixed(4)}`, t('dash.chart_cost')] : [value, t('dash.chart_reqs')]}
              />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#94a3b8', fontSize: 12 }}
                dy={10}
              />
              <Area
                type="monotone"
                dataKey={chartMode === 'reqs' ? 'reqs' : 'cost'}
                stroke={chartMode === 'reqs' ? '#135bec' : '#10b981'}
                strokeWidth={3}
                fillOpacity={1}
                fill={chartMode === 'reqs' ? 'url(#colorReqs)' : 'url(#colorCost)'}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Activity */}
        <div className="lg:col-span-2 bg-white dark:bg-dark-surface rounded-3xl p-6 md:p-8 shadow-sm border border-slate-100 dark:border-dark-border">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{t('dash.recent_activity')}</h3>
                <button className="text-sm font-medium text-primary hover:text-primary-hover">{t('dash.view_all')}</button>
            </div>
            <div className="space-y-2">
                {recentLogs.length > 0 ? (
                  recentLogs.map((log) => (
                    <ActivityRow
                      key={log.id}
                      method="POST"
                      path={`/v1/chat/completions (${log.model_name})`}
                      ip={log.content || t('dash.na')}
                      latency={`${log.use_time}ms`}
                      time={formatTimestamp(log.created_at)}
                      status={log.type === 2 ? 'success' : 'error'}
                    />
                  ))
                ) : (
                  <div className="text-center text-slate-400 py-8">{t('dash.no_activity')}</div>
                )}
            </div>
        </div>

        {/* Response Codes */}
        <div className="bg-white dark:bg-dark-surface rounded-3xl p-6 md:p-8 shadow-sm border border-slate-100 dark:border-dark-border">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-6">{t('dash.response_codes')}</h3>
            <div className="space-y-6">
                <ResponseBar label={`2xx ${t('dash.success')}`} value={responseStats.success} color="bg-emerald-500" textColor="text-emerald-500" />
                <ResponseBar label={`4xx ${t('dash.client_error')}`} value={responseStats.clientError} color="bg-amber-500" textColor="text-amber-500" />
                <ResponseBar label={`5xx ${t('dash.server_error')}`} value={responseStats.serverError} color="bg-red-500" textColor="text-red-500" />
            </div>
        </div>
      </div>
    </div>
  );
};

const KpiCard = ({ title, value, change, trend, icon, subtitle, isTag = false }: any) => {
    let changeColor = 'text-slate-500';
    let changeBg = 'bg-slate-100 dark:bg-slate-800';
    
    if (trend === 'up' || trend === 'good') {
        changeColor = 'text-emerald-500';
        changeBg = 'bg-emerald-500/10';
    } else if (trend === 'down' || trend === 'bad') {
        changeColor = 'text-red-500';
        changeBg = 'bg-red-500/10';
    }

    if (isTag) {
        changeColor = 'text-slate-600 dark:text-slate-400';
        changeBg = 'bg-slate-100 dark:bg-slate-800';
    }

    return (
        <div className="bg-white dark:bg-dark-surface p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-dark-border hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-4">
                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</span>
                <span className="material-symbols-outlined text-primary text-[20px] opacity-50">{icon}</span>
            </div>
            <div className="text-4xl font-bold text-slate-900 dark:text-white tracking-tight mb-2">{value}</div>
            <div className="flex items-center gap-2">
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${changeBg} ${changeColor}`}>{change}</span>
                {subtitle && <span className="text-xs text-slate-400">{subtitle}</span>}
            </div>
        </div>
    )
}

const ActivityRow = ({ method, path, ip, latency, code, time, status }: any) => {
    const icon = status === 'success' ? 'check' : 'priority_high';
    const iconColor = status === 'success' ? 'text-emerald-500 bg-emerald-500/10' : 'text-red-500 bg-red-500/10';

    return (
        <div className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-[#1c2333] transition-colors group cursor-default">
            <div className="flex items-center gap-4">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${iconColor}`}>
                    <span className="material-symbols-outlined text-[18px]">{icon}</span>
                </div>
                <div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white flex gap-2 items-center">
                        <span className="font-mono text-xs opacity-75">{method}</span>
                        {path}
                    </div>
                    <div className="text-xs text-slate-500">{ip}</div>
                </div>
            </div>
            <div className="flex items-center gap-3">
                 <span className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-400">
                    {latency || code}
                 </span>
                 <span className="text-xs text-slate-400">{time}</span>
            </div>
        </div>
    )
}

const ResponseBar = ({ label, value, color, textColor }: any) => (
    <div className="flex flex-col gap-2">
        <div className="flex justify-between text-sm">
            <span className={`font-medium ${textColor}`}>{label}</span>
            <span className="font-bold text-slate-900 dark:text-white">{value}</span>
        </div>
        <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div className={`h-full ${color} rounded-full`} style={{ width: value }}></div>
        </div>
    </div>
)

const FeatureCard = ({ icon, title, desc }: any) => (
    <div className="rounded-2xl bg-white/10 p-4 backdrop-blur-sm border border-white/10 hover:bg-white/20 transition-colors">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/30 text-white">
            <span className="material-symbols-outlined">{icon}</span>
        </div>
        <h3 className="mb-1 font-bold text-white">{title}</h3>
        <p className="text-xs text-indigo-100/80 leading-relaxed">{desc}</p>
    </div>
)

export default Dashboard;
