import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Button, Card, DatePicker, Radio, Spin, Table, Tag } from '@douyinfe/semi-ui';
import { RefreshCw } from 'lucide-react';
import { VChart } from '@visactor/react-vchart';
import { API } from '../../helpers/api';
import { showError } from '../../helpers';
import { DATE_RANGE_PRESETS } from '../../constants/console.constants';

const POLL_INTERVAL_MS = 5000;
const WINDOW_SECONDS = 60;
const RANGE_SECONDS = 1800;
const MAX_POINTS = 360;
const CHART_CONFIG = { mode: 'desktop-browser' };
const ALL_LABEL = '__ALL__';
const RANGE_MODE_OPTIONS = [
  { label: '30m', value: '30m' },
  { label: 'Day', value: 'day' },
  { label: 'Week', value: 'week' },
  { label: 'Custom', value: 'custom' },
];

const getStartOfDay = (date = new Date()) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const getRangeValues = (range) => {
  if (!Array.isArray(range) || range.length !== 2 || !range[0] || !range[1]) {
    return [null, null];
  }
  const [start, end] = range;
  return [start instanceof Date ? start : new Date(start), end instanceof Date ? end : new Date(end)];
};

const buildRangeQuery = (rangeMode, customRange) => {
  const now = new Date();
  if (rangeMode === '30m') {
    return { range_seconds: RANGE_SECONDS };
  }
  if (rangeMode === 'day') {
    return {
      start_timestamp: Math.floor(getStartOfDay(now).getTime() / 1000),
      end_timestamp: Math.floor(now.getTime() / 1000),
    };
  }
  if (rangeMode === 'week') {
    return {
      start_timestamp: Math.floor(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).getTime() / 1000),
      end_timestamp: Math.floor(now.getTime() / 1000),
    };
  }
  const [start, end] = getRangeValues(customRange);
  if (!start || !end) return null;
  return {
    start_timestamp: Math.floor(start.getTime() / 1000),
    end_timestamp: Math.floor(end.getTime() / 1000),
  };
};

const formatDateTime = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
};

const formatTime = (ts, includeDate = false) => {
  const d = new Date(ts * 1000);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return includeDate ? `${month}-${day} ${hh}:${mm}` : `${hh}:${mm}:${ss}`;
};

const buildChartData = (sortedTs, buf, truncate) => {
  if (truncate) {
    const data = [];
    for (const ts of sortedTs) {
      const timeStr = formatTime(ts, false);
      for (const [label, rpmMap] of Object.entries(buf)) {
        const rpm = rpmMap.get(ts) ?? 0;
        const displayLabel = label === ALL_LABEL ? 'All' : label;
        data.push({ Time: timeStr, RPM: rpm, Site: displayLabel, _ts: ts });
      }
    }
    return data;
  }

  const grouped = new Map();
  for (const ts of sortedTs) {
    const timeStr = formatTime(ts, true);
    if (!grouped.has(timeStr)) {
      grouped.set(timeStr, {});
    }
    const bucket = grouped.get(timeStr);
    for (const [label, rpmMap] of Object.entries(buf)) {
      if (!bucket[label]) {
        bucket[label] = { sum: 0, count: 0, lastTs: ts };
      }
      const rpm = rpmMap.get(ts) ?? 0;
      bucket[label].sum += rpm;
      bucket[label].count += 1;
      bucket[label].lastTs = ts;
    }
  }

  const data = [];
  for (const [timeStr, bucket] of grouped.entries()) {
    for (const [label, stat] of Object.entries(bucket)) {
      const displayLabel = label === ALL_LABEL ? 'All' : label;
      data.push({
        Time: timeStr,
        RPM: stat.count > 0 ? stat.sum / stat.count : 0,
        Site: displayLabel,
        _ts: stat.lastTs,
      });
    }
  }
  return data;
};

const SiteRPM = () => {
  const [loading, setLoading] = useState(true);
  const [chartData, setChartData] = useState([]);
  const [latestSites, setLatestSites] = useState([]);
  const [allRPM, setAllRPM] = useState(0);
  const [rangeMode, setRangeMode] = useState('30m');
  const [customRange, setCustomRange] = useState(null);
  const latestTsRef = useRef(0);
  const timerRef = useRef(null);
  // ring buffer: { [siteLabel]: Map<ts, rpm> }
  const bufferRef = useRef({});
  const tsSetRef = useRef(new Set());
  const isLiveMode = rangeMode === '30m';

  const chartSubtext = useMemo(() => {
    if (rangeMode === '30m') return 'Last 30 min · 5s granularity · auto-refresh every 5s';
    if (rangeMode === 'day') return 'Today · latest snapshot in selected range';
    if (rangeMode === 'week') return 'Last 7 days · latest snapshot in selected range';
    const [start, end] = getRangeValues(customRange);
    if (!start || !end) return 'Custom range · select a start and end time';
    return `${formatDateTime(start)} → ${formatDateTime(end)} · latest snapshot in selected range`;
  }, [customRange, rangeMode]);

  const resetData = useCallback(() => {
    bufferRef.current = {};
    tsSetRef.current = new Set();
    latestTsRef.current = 0;
    setChartData([]);
    setLatestSites([]);
    setAllRPM(0);
  }, []);

  const mergeSnapshots = useCallback((series, options = {}) => {
    const { truncate = true } = options;
    const buf = bufferRef.current;
    const tsSet = tsSetRef.current;

    for (const pt of series) {
      const { ts, site_label, rpm } = pt;
      tsSet.add(ts);
      if (!buf[site_label]) buf[site_label] = new Map();
      buf[site_label].set(ts, rpm);
    }

    // prune to MAX_POINTS timestamps for live mode only
    const allTs = [...tsSet].sort((a, b) => a - b);
    if (truncate && allTs.length > MAX_POINTS) {
      const cutTs = allTs.slice(0, allTs.length - MAX_POINTS);
      for (const ts of cutTs) {
        tsSet.delete(ts);
        for (const label of Object.keys(buf)) {
          buf[label].delete(ts);
        }
      }
    }

    // build VChart data
    const sortedTs = [...tsSet].sort((a, b) => a - b);
    const data = buildChartData(sortedTs, buf, truncate);
    setChartData(data);

    // extract latest snapshot for table + header
    if (sortedTs.length > 0) {
      const lastTs = sortedTs[sortedTs.length - 1];
      const sites = [];
      let totalRPM = 0;
      for (const [label, rpmMap] of Object.entries(buf)) {
        const rpm = rpmMap.get(lastTs) ?? 0;
        if (label === ALL_LABEL) {
          totalRPM = rpm;
        } else {
          sites.push({ site_label: label, rpm });
        }
      }
      sites.sort((a, b) => b.rpm - a.rpm);
      setLatestSites(sites);
      setAllRPM(totalRPM);
    }
  }, []);

  const fetchData = useCallback(async ({ since = 0, fullReload = false, mode = rangeMode, range = customRange } = {}) => {
    const query = buildRangeQuery(mode, range);
    if (!query) {
      setLoading(false);
      return;
    }
    try {
      const params = new URLSearchParams({
        window_seconds: String(WINDOW_SECONDS),
      });
      Object.entries(query).forEach(([key, value]) => {
        params.set(key, String(value));
      });
      if (since > 0 && mode === '30m') {
        params.set('since', String(since));
      }
      const res = await API.get(`/api/analytics/site-rpm/history?${params.toString()}`, {
        disableDuplicate: true,
      });
      if (res.data.success) {
        const { series, latest_ts } = res.data.data;
        if ((series && series.length > 0) || fullReload) {
          mergeSnapshots(series || [], { truncate: mode === '30m' });
        }
        if (latest_ts > 0) {
          latestTsRef.current = latest_ts;
        }
      } else {
        showError(res.data.message || 'Failed to fetch site RPM history');
      }
    } catch (e) {
      showError(e.message || 'Failed to fetch site RPM history');
    } finally {
      setLoading(false);
    }
  }, [customRange, mergeSnapshots, rangeMode]);

  const reloadCurrentRange = useCallback((mode = rangeMode, range = customRange) => {
    resetData();
    setLoading(true);
    fetchData({ since: 0, fullReload: true, mode, range });
  }, [customRange, fetchData, rangeMode, resetData]);

  useEffect(() => {
    reloadCurrentRange();
  }, [reloadCurrentRange]);

  useEffect(() => {
    if (!isLiveMode) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return undefined;
    }
    timerRef.current = setInterval(() => {
      fetchData({ since: latestTsRef.current, mode: '30m', range: customRange });
    }, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [customRange, fetchData, isLiveMode]);

  const chartSpec = {
    type: 'line',
    data: [{ id: 'rpmData', values: chartData }],
    xField: 'Time',
    yField: 'RPM',
    seriesField: 'Site',
    point: { visible: false },
    line: {
      style: (datum) => {
        if (datum?.Site === 'All') {
          return { lineWidth: 3 };
        }
        return { lineWidth: 1.5 };
      },
    },
    legends: {
      visible: true,
      type: 'scroll',
      position: 'right',
      orient: 'right',
      maxRow: 10,
    },
    axes: [
      {
        orient: 'bottom',
        label: { autoRotate: true },
        sampling: true,
      },
      {
        orient: 'left',
        title: { visible: true, text: 'RPM' },
        min: 0,
      },
    ],
    tooltip: {
      mark: {
        content: [
          {
            key: (datum) => datum?.Site,
            value: (datum) => datum?.RPM?.toFixed(2),
          },
        ],
      },
    },
    animation: false,
    title: {
      visible: true,
      text: 'Site RPM Trend',
      subtext: chartSubtext,
    },
  };

  const columns = [
    {
      title: 'Site',
      dataIndex: 'site_label',
      render: (val) => <span className='font-mono text-sm'>{val}</span>,
    },
    {
      title: 'RPM',
      dataIndex: 'rpm',
      render: (val) => (
        <Tag color={val >= 100 ? 'red' : val >= 10 ? 'orange' : 'green'} size='large'>
          {val.toFixed(2)}
        </Tag>
      ),
    },
  ];

  return (
    <div className='mt-[60px] px-4 pb-8'>
      <Card
        className='!rounded-2xl mb-4'
        bodyStyle={{ padding: '20px 24px' }}
        title={
          <div className='flex items-center justify-between gap-3 flex-wrap'>
            <div className='flex items-center gap-2'>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              <span>Site RPM</span>
              <span className='text-xs text-gray-400 font-normal ml-1'>
                (last {WINDOW_SECONDS}s{isLiveMode ? ` · auto-refresh every ${POLL_INTERVAL_MS / 1000}s` : ' · manual refresh'})
              </span>
            </div>
            <div className='flex items-center gap-2 flex-wrap'>
              <Radio.Group
                type='button'
                buttonSize='small'
                value={rangeMode}
                onChange={(e) => {
                  const nextMode = e.target.value;
                  setRangeMode(nextMode);
                }}
              >
                {RANGE_MODE_OPTIONS.map((option) => (
                  <Radio key={option.value} value={option.value}>
                    {option.label}
                  </Radio>
                ))}
              </Radio.Group>
              {rangeMode === 'custom' ? (
                <DatePicker
                  type='dateTimeRange'
                  size='small'
                  insetLabel='Range'
                  placeholder={['Start time', 'End time']}
                  value={customRange}
                  onChange={(value) => setCustomRange(value)}
                  presets={DATE_RANGE_PRESETS.map((preset) => ({
                    text: preset.text,
                    start: preset.start(),
                    end: preset.end(),
                  }))}
                />
              ) : null}
              {!isLiveMode ? (
                <Button
                  type='tertiary'
                  size='small'
                  icon={<RefreshCw size={14} />}
                  loading={loading}
                  onClick={() => reloadCurrentRange()}
                >
                  Refresh
                </Button>
              ) : null}
            </div>
          </div>
        }
      >
        <div className='mb-6'>
          <div className='text-sm text-gray-500 mb-1'>All Sites RPM</div>
          <div className='text-4xl font-bold tabular-nums'>
            {loading && chartData.length === 0 ? (
              <Spin size='large' />
            ) : (
              allRPM.toFixed(2)
            )}
          </div>
        </div>

        {/* VChart trend */}
        <div className='h-96 mb-6'>
          {chartData.length > 0 ? (
            <VChart spec={chartSpec} option={CHART_CONFIG} />
          ) : loading ? (
            <div className='flex items-center justify-center h-full'>
              <Spin size='large' />
            </div>
          ) : (
            <div className='flex items-center justify-center h-full text-gray-400'>
              No data yet — waiting for snapshots...
            </div>
          )}
        </div>

        <Table
          columns={columns}
          dataSource={latestSites}
          rowKey='site_label'
          loading={loading && chartData.length === 0}
          pagination={false}
          size='small'
          empty={<span className='text-gray-400 text-sm'>No data</span>}
        />
      </Card>
    </div>
  );
};

export default SiteRPM;
