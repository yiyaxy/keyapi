import React, { useEffect, useState } from 'react';
import { API } from '../lib/api';
import { useTranslation } from '../lib/i18n';
import type { Log, LogStat } from '../types';

interface LogFilters {
  token_name: string;
  model_name: string;
  group: string;
  request_id: string;
  type: string;
  start_time?: number;
  end_time?: number;
}

const defaultFilters: LogFilters = {
  token_name: '',
  model_name: '',
  group: '',
  request_id: '',
  type: 'all',
};

const Logs: React.FC = () => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [draftFilters, setDraftFilters] = useState<LogFilters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<LogFilters>(defaultFilters);
  const [stat, setStat] = useState<LogStat>({ quota: 0, rpm: 0, tpm: 0 });
  const [timeRange, setTimeRange] = useState<'today' | 'week' | 'month' | 'custom'>('week');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [quotaPerUnit, setQuotaPerUnit] = useState(500000);
  const [quotaDisplayType, setQuotaDisplayType] = useState('USD');

  const buildLogParams = (nextPage: number, filters: LogFilters) => {
    const params: Record<string, string | number> = {
      p: nextPage,
      page_size: pageSize,
    };

    if (filters.token_name.trim()) params.token_name = filters.token_name.trim();
    if (filters.model_name.trim()) params.model_name = filters.model_name.trim();
    if (filters.group.trim()) params.group = filters.group.trim();
    if (filters.request_id.trim()) params.request_id = filters.request_id.trim();
    if (filters.type !== 'all') params.type = Number(filters.type);
    if (filters.start_time) params.start_timestamp = filters.start_time;
    if (filters.end_time) params.end_timestamp = filters.end_time;

    return params;
  };

  const getTodayTimestamps = (): { start_time: number; end_time: number } => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    return {
      start_time: Math.floor(startOfToday.getTime() / 1000),
      end_time: Math.floor(endOfToday.getTime() / 1000),
    };
  };

  const getTimeRangeTimestamps = (): { start_time?: number; end_time?: number } => {
    const now = new Date();
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    switch (timeRange) {
      case 'today':
        return getTodayTimestamps();
      case 'week': {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const startOfWeekAgo = new Date(weekAgo.getFullYear(), weekAgo.getMonth(), weekAgo.getDate(), 0, 0, 0);
        return {
          start_time: Math.floor(startOfWeekAgo.getTime() / 1000),
          end_time: Math.floor(endOfToday.getTime() / 1000),
        };
      }
      case 'month': {
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const startOfMonthAgo = new Date(monthAgo.getFullYear(), monthAgo.getMonth(), monthAgo.getDate(), 0, 0, 0);
        return {
          start_time: Math.floor(startOfMonthAgo.getTime() / 1000),
          end_time: Math.floor(endOfToday.getTime() / 1000),
        };
      }
      case 'custom': {
        if (!customStartDate && !customEndDate) return {};
        const result: { start_time?: number; end_time?: number } = {};
        if (customStartDate) {
          const startDate = new Date(customStartDate + 'T00:00:00');
          result.start_time = Math.floor(startDate.getTime() / 1000);
        }
        if (customEndDate) {
          const endDate = new Date(customEndDate + 'T23:59:59');
          result.end_time = Math.floor(endDate.getTime() / 1000);
        }
        return result;
      }
      default:
        return {};
    }
  };

  const buildStatParams = (filters: LogFilters) => {
    const params: Record<string, string | number> = {};

    if (filters.token_name.trim()) params.token_name = filters.token_name.trim();
    if (filters.model_name.trim()) params.model_name = filters.model_name.trim();
    if (filters.group.trim()) params.group = filters.group.trim();
    if (filters.type !== 'all') params.type = Number(filters.type);
    if (filters.start_time) params.start_timestamp = filters.start_time;
    if (filters.end_time) params.end_timestamp = filters.end_time;

    return params;
  };

  const fetchLogs = async (nextPage: number = 1, filters: LogFilters = appliedFilters) => {
    try {
      setLoading(true);
      setError(null);

      const response = await API.get('/api/log/self', {
        params: buildLogParams(nextPage, filters),
      });
      const { success, message, data } = response.data;

      if (success) {
        const items: Log[] = data.items || [];
        setLogs(items);
        setTotal(data.total || 0);
        setPage(data.page || nextPage);
      } else {
        setError(message || t('logs.error.fetch'));
      }
    } catch (err: any) {
      setError(err.response?.data?.message || t('logs.error.network'));
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async (filters: LogFilters = appliedFilters) => {
    try {
      const response = await API.get('/api/log/self/stat', {
        params: buildStatParams(filters),
      });
      const { success, data } = response.data;

      if (success) {
        setStat({
          quota: Number(data?.quota || 0),
          rpm: Number(data?.rpm || 0),
          tpm: Number(data?.tpm || 0),
          total_requests: Number(data?.total_requests || 0),
          total_tokens: Number(data?.total_tokens || 0),
        });
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  const getTimeRangeLabel = () => {
    switch (timeRange) {
      case 'today': return t('logs.time.today');
      case 'week': return t('logs.time.week');
      case 'month': return t('logs.time.month');
      case 'custom': return t('logs.time.custom_range');
      default: return '';
    }
  };

  const runSearch = async (filters: LogFilters) => {
    setAppliedFilters(filters);
    await Promise.all([fetchLogs(1, filters), fetchStats(filters)]);
  };

  useEffect(() => {
    const timeTimestamps = getTimeRangeTimestamps();
    runSearch({
      ...defaultFilters,
      start_time: timeTimestamps.start_time,
      end_time: timeTimestamps.end_time,
    });
  }, []);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await API.get('/api/status');
        if (response.data?.success) {
          const statusData = response.data.data;
          if (statusData?.quota_per_unit) setQuotaPerUnit(statusData.quota_per_unit);
          if (statusData?.quota_display_type) setQuotaDisplayType(statusData.quota_display_type);
        }
      } catch (err) {
        console.error('Failed to fetch status:', err);
      }
    };
    fetchStatus();
  }, []);

  const handleApplyFilters = async () => {
    const timeTimestamps = getTimeRangeTimestamps();
    await runSearch({
      token_name: draftFilters.token_name.trim(),
      model_name: draftFilters.model_name.trim(),
      group: draftFilters.group.trim(),
      request_id: draftFilters.request_id.trim(),
      type: draftFilters.type,
      start_time: timeTimestamps.start_time,
      end_time: timeTimestamps.end_time,
    });
  };

  const handleResetFilters = async () => {
    const now = new Date();
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfWeekAgo = new Date(weekAgo.getFullYear(), weekAgo.getMonth(), weekAgo.getDate(), 0, 0, 0);

    setDraftFilters(defaultFilters);
    setTimeRange('week');
    setCustomStartDate('');
    setCustomEndDate('');
    await runSearch({
      ...defaultFilters,
      start_time: Math.floor(startOfWeekAgo.getTime() / 1000),
      end_time: Math.floor(endOfToday.getTime() / 1000),
    });
  };

  const handleInputEnter = async (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key === 'Enter') {
      await handleApplyFilters();
    }
  };

  const formatTimestamp = (ts: number) => {
    const date = new Date(ts * 1000);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  const formatQuota = (quota: number) => {
    if (quotaDisplayType === 'TOKENS') return quota.toLocaleString();
    const value = quota / quotaPerUnit;
    const symbol = quotaDisplayType === 'CNY' ? '¥' : '$';
    const fixed = value.toFixed(6);
    if (parseFloat(fixed) === 0 && quota > 0 && value > 0) {
      return symbol + '0.000001';
    }
    return symbol + fixed;
  };
  const formatNumber = (num: number) => num.toLocaleString();

  // Parse the log.other JSON string to extract cache token info
  const parseLogOther = (other?: string): { cache_tokens: number; cache_creation_tokens: number; frt: number } => {
    if (!other) return { cache_tokens: 0, cache_creation_tokens: 0, frt: 0 };
    try {
      const parsed = typeof other === 'object' ? other : JSON.parse(other);
      return {
        cache_tokens: parsed?.cache_tokens || 0,
        cache_creation_tokens: parsed?.cache_creation_tokens || 0,
        frt: parsed?.frt || 0,
      };
    } catch {
      return { cache_tokens: 0, cache_creation_tokens: 0, frt: 0 };
    }
  };
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const displayStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const displayEnd = Math.min(page * pageSize, total);

  const getLogType = (type: number) => {
    switch (type) {
      case 1:
        return t('logs.type.topup');
      case 2:
        return t('logs.type.consume');
      case 5:
        return t('logs.type.fail');
      case 6:
        return t('logs.type.refund');
      default:
        return t('logs.type.unknown');
    }
  };

  if (loading && logs.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-slate-500">{t('logs.loading')}</div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      <header className="sticky top-0 z-30 w-full border-b border-slate-200 dark:border-dark-border bg-white/95 dark:bg-dark-bg/95 backdrop-blur-sm">
        <div className="w-full px-6 py-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary">
                <span className="material-symbols-outlined text-xl">receipt_long</span>
              </div>
              <h1 className="text-sm font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{t('logs.title')}</h1>
            </div>
            <button
              className="flex items-center justify-center w-8 h-8 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              onClick={() => {
                fetchLogs(page, appliedFilters);
                fetchStats(appliedFilters);
              }}
              title={t('logs.refresh')}
            >
              <span className="material-symbols-outlined text-[20px]">refresh</span>
            </button>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <button
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                timeRange === 'today'
                  ? 'bg-primary text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
              onClick={() => setTimeRange('today')}
            >
              {t('logs.time.today')}
            </button>
            <button
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                timeRange === 'week'
                  ? 'bg-primary text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
              onClick={() => setTimeRange('week')}
            >
              {t('logs.time.week')}
            </button>
            <button
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                timeRange === 'month'
                  ? 'bg-primary text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
              onClick={() => setTimeRange('month')}
            >
              {t('logs.time.month')}
            </button>
            <button
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                timeRange === 'custom'
                  ? 'bg-primary text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
              onClick={() => setTimeRange('custom')}
            >
              {t('logs.time.custom')}
            </button>
            {timeRange === 'custom' && (
              <>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder={t('logs.time.start')}
                />
                <span className="text-slate-400">{t('logs.time.to')}</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder={t('logs.time.end')}
                />
              </>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
            <FilterInput
              value={draftFilters.token_name}
              placeholder={t('logs.filter.token')}
              onChange={(value) => setDraftFilters((prev) => ({ ...prev, token_name: value }))}
              onKeyDown={handleInputEnter}
            />
            <FilterInput
              value={draftFilters.model_name}
              placeholder={t('logs.filter.model')}
              onChange={(value) => setDraftFilters((prev) => ({ ...prev, model_name: value }))}
              onKeyDown={handleInputEnter}
            />
            <FilterInput
              value={draftFilters.group}
              placeholder={t('logs.filter.group')}
              onChange={(value) => setDraftFilters((prev) => ({ ...prev, group: value }))}
              onKeyDown={handleInputEnter}
            />
            <FilterInput
              value={draftFilters.request_id}
              placeholder={t('logs.filter.request_id')}
              onChange={(value) => setDraftFilters((prev) => ({ ...prev, request_id: value }))}
              onKeyDown={handleInputEnter}
            />
            <select
              value={draftFilters.type}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, type: e.target.value }))}
              onKeyDown={handleInputEnter}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="all">{t('logs.filter.all_types')}</option>
              <option value="1">{t('logs.filter.topup')}</option>
              <option value="2">{t('logs.filter.consume')}</option>
              <option value="5">{t('logs.filter.error')}</option>
              <option value="6">{t('logs.filter.refund')}</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors"
              onClick={handleApplyFilters}
              disabled={loading}
            >
              {t('logs.search')}
            </button>
            <button
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              onClick={handleResetFilters}
              disabled={loading}
            >
              {t('logs.reset')}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 p-6 overflow-auto">
        {error && (
          <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-8">
          <StatBox title={t('logs.stat.total_spend')} value={formatQuota(stat.quota)} />
          <StatBox title={`${t('logs.stat.tokens')} (${getTimeRangeLabel()})`} value={formatNumber(stat.total_tokens || 0)} />
          <StatBox title={`${t('logs.stat.requests')} (${getTimeRangeLabel()})`} value={formatNumber(stat.total_requests || 0)} />
          <StatBox title={t('logs.stat.rpm')} value={formatNumber(stat.rpm)} />
          <StatBox title={t('logs.stat.tpm')} value={formatNumber(stat.tpm)} />
        </div>

        <div className="min-w-[1000px]">
          <div className="sticky top-0 z-20 grid grid-cols-12 gap-4 px-4 py-2 text-xs font-medium uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-dark-border bg-gray-50 dark:bg-dark-surface shadow-sm">
            <div className="col-span-2">{t('logs.table.timestamp')}</div>
            <div className="col-span-1">{t('logs.table.token')}</div>
            <div className="col-span-1">{t('logs.table.group')}</div>
            <div className="col-span-1 text-center">{t('logs.table.type')}</div>
            <div className="col-span-2">{t('logs.table.model')}</div>
            <div className="col-span-1 text-right">{t('logs.table.time_ttft')}</div>
            <div className="col-span-1 text-right">{t('logs.table.read')}</div>
            <div className="col-span-1 text-right">{t('logs.table.write')}</div>
            <div className="col-span-2 text-right">{t('logs.table.cost')}</div>
          </div>

          <div className="space-y-[1px] mt-2">
            {logs.length === 0 && !loading ? (
              <div className="text-center py-8 text-slate-500">{t('logs.empty')}</div>
            ) : (
              logs.map((log) => {
                const logType = getLogType(log.type);
                const isTopUp = log.type === 1;
                const isError = log.type === 5;
                const modelName = log.model_name || '';

                return (
                  <div
                    key={log.id}
                    className={`group grid grid-cols-12 gap-4 px-4 py-3 items-center rounded-md border border-transparent transition-all cursor-default ${
                      isTopUp
                        ? 'bg-emerald-500/5 hover:bg-emerald-500/10 hover:border-emerald-500/20'
                        : isError
                          ? 'bg-red-500/5 hover:bg-red-500/10 hover:border-red-500/20'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-slate-200 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="col-span-2 font-mono text-xs text-slate-500 group-hover:text-slate-900 dark:group-hover:text-slate-300">
                      {formatTimestamp(log.created_at)}
                    </div>
                    <div className="col-span-1 font-mono text-xs text-slate-600 dark:text-slate-400 truncate" title={log.token_name}>
                      {log.token_name || '-'}
                    </div>
                    <div className="col-span-1 font-mono text-xs text-slate-500 truncate" title={log.group}>
                      {log.group || t('logs.default_group')}
                    </div>
                    <div className="col-span-1 text-center">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                          logType === 'CONS'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 border-blue-200 dark:border-blue-900/50'
                            : logType === 'FAIL'
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400 border-rose-200 dark:border-rose-900/50'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50'
                        }`}
                      >
                        {logType}
                      </span>
                    </div>
                    <div className="col-span-2 flex items-center gap-2 overflow-hidden">
                      <div
                        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                          modelName.includes('gpt')
                            ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                            : modelName.includes('claude')
                              ? 'bg-amber-600'
                              : modelName.includes('llama')
                                ? 'bg-blue-500'
                                : 'bg-slate-400'
                        }`}
                      ></div>
                      <span className="font-mono text-xs truncate text-slate-700 dark:text-slate-300" title={modelName}>
                        {modelName || '-'}
                      </span>
                    </div>
                    <div className="col-span-1 text-right font-mono text-xs text-slate-500">
                      {(log.type === 2 || log.type === 5) && log.use_time > 0 ? (() => {
                        const { frt } = parseLogOther(log.other);
                        const useTime = log.use_time;
                        const frtSec = log.is_stream && frt > 0 ? (frt / 1000).toFixed(1) : null;
                        return (
                          <span className="flex items-center justify-end gap-1 flex-wrap" title={`Time: ${useTime}s${frtSec ? ` | TTFT: ${frtSec}s` : ''} | ${log.is_stream ? t('logs.stream') : t('logs.non_stream')}`}>
                            <span className={useTime < 101 ? 'text-emerald-600' : useTime < 300 ? 'text-amber-500' : 'text-red-500'}>{useTime}s</span>
                            {frtSec && <span className={parseFloat(frtSec) < 3 ? 'text-emerald-600' : parseFloat(frtSec) < 10 ? 'text-amber-500' : 'text-red-500'}>{frtSec}s</span>}
                            <span className={`inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold leading-none ${log.is_stream ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400' : 'bg-purple-100 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400'}`}>
                              {log.is_stream ? t('logs.stream') : t('logs.non_stream')}
                            </span>
                          </span>
                        );
                      })() : '-'}
                    </div>
                    <div className="col-span-1 text-right font-mono text-xs text-slate-500">
                      {(log.type === 0 || log.type === 2 || log.type === 5) ? (() => {
                        const { cache_tokens: cached, cache_creation_tokens: creation } = parseLogOther(log.other);
                        const prompt = log.prompt_tokens || 0;
                        return (
                          <span title={`Cache: ${cached} | Prompt: ${prompt} | Cache creation: ${creation}`}>
                            {cached}+{prompt}({creation})
                          </span>
                        );
                      })() : '-'}
                    </div>
                    <div className="col-span-1 text-right font-mono text-xs text-slate-500">
                      {(log.type === 0 || log.type === 2 || log.type === 5) && log.completion_tokens > 0 ? formatNumber(log.completion_tokens) : '-'}
                    </div>
                    <div className={`col-span-2 text-right font-mono text-xs font-medium ${isTopUp ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-slate-900 dark:text-white'}`}>
                      {isTopUp ? '+' : ''}
                      {formatQuota(log.quota)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="mt-8 flex items-center justify-between border-t border-slate-200 dark:border-dark-border pt-6">
          <div className="text-sm text-slate-500">
            {t('logs.pagination.showing')} <span className="font-medium text-slate-900 dark:text-white">{displayStart}</span> {t('logs.pagination.to')} <span className="font-medium text-slate-900 dark:text-white">{displayEnd}</span> {t('logs.pagination.of')} {total} {t('logs.pagination.transactions')}
          </div>
          <div className="flex gap-2">
            <button
              className="px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md disabled:opacity-50"
              disabled={page <= 1 || loading}
              onClick={() => fetchLogs(page - 1, appliedFilters)}
            >
              {t('logs.pagination.prev')}
            </button>
            <button
              className="px-3 py-1.5 text-sm font-medium text-white bg-primary hover:bg-primary-hover rounded-md shadow-lg shadow-primary/20 disabled:opacity-50"
              disabled={page >= totalPages || loading}
              onClick={() => fetchLogs(page + 1, appliedFilters)}
            >
              {t('logs.pagination.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const FilterInput = ({
  value,
  placeholder,
  onChange,
  onKeyDown,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) => (
  <div className="relative">
    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
      <span className="material-symbols-outlined text-[18px]">search</span>
    </span>
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/30"
    />
  </div>
);

const StatBox = ({ title, value }: { title: string; value: string }) => (
  <div className="p-4 rounded-lg border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-surface shadow-sm">
    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">{title}</p>
    <div className="flex items-baseline gap-2">
      <span className="text-2xl font-semibold font-mono text-slate-900 dark:text-white">{value}</span>
    </div>
  </div>
);

export default Logs;
