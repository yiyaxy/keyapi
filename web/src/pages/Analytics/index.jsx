import React, { useMemo } from 'react';
import {
  Card,
  DatePicker,
  InputNumber,
  Button,
  Progress,
  Spin,
  Empty,
} from '@douyinfe/semi-ui';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VChart } from '@visactor/react-vchart';
import { useAnalyticsData } from '../../hooks/analytics/useAnalyticsData';
import { useAnalyticsCharts } from '../../hooks/analytics/useAnalyticsCharts';
import { renderQuota, renderNumber } from '../../helpers';

const CHART_CONFIG = { mode: 'desktop-browser' };

const Analytics = () => {
  const { t } = useTranslation();
  const {
    timeRange,
    setTimeRange,
    refreshInterval,
    updateRefreshInterval,
    loading,
    channelData,
    modelData,
    userData,
    countdown,
    loadAllData,
  } = useAnalyticsData();

  const {
    channelPieSpec,
    modelPieSpec,
    userPieSpec,
    channelBarSpec,
    modelBarSpec,
    userBarSpec,
  } = useAnalyticsCharts(channelData, modelData, userData, t);

  const summary = useMemo(() => {
    if (!channelData?.summary) return null;
    return channelData.summary;
  }, [channelData]);

  const handleDateChange = (dates) => {
    if (dates && dates.length === 2) {
      setTimeRange({
        start: Math.floor(dates[0].getTime() / 1000),
        end: Math.floor(dates[1].getTime() / 1000),
      });
    }
  };

  const progressPercent = refreshInterval > 0
    ? ((refreshInterval - countdown) / refreshInterval) * 100
    : 0;

  return (
    <div className='mt-[60px] px-4 pb-8'>
      {/* Control Bar */}
      <ControlBar
        t={t}
        timeRange={timeRange}
        handleDateChange={handleDateChange}
        refreshInterval={refreshInterval}
        updateRefreshInterval={updateRefreshInterval}
        loading={loading}
        loadAllData={loadAllData}
        countdown={countdown}
        progressPercent={progressPercent}
      />

      {/* Summary Cards */}
      {summary && (
        <SummaryCards t={t} summary={summary} />
      )}

      {/* Pie Charts Row */}
      <PieChartsRow
        t={t}
        channelPieSpec={channelPieSpec}
        modelPieSpec={modelPieSpec}
        userPieSpec={userPieSpec}
        loading={loading}
      />

      {/* Bar Charts */}
      <BarChart spec={channelBarSpec} loading={loading} />
      <BarChart spec={modelBarSpec} loading={loading} />
      <BarChart spec={userBarSpec} loading={loading} />
    </div>
  );
};

export default Analytics;

/* ========== Sub-components ========== */

const ControlBar = ({
  t, timeRange, handleDateChange, refreshInterval,
  updateRefreshInterval, loading, loadAllData, countdown, progressPercent,
}) => (
  <Card
    className='!rounded-2xl mb-4'
    bodyStyle={{ padding: '12px 20px' }}
  >
    <div className='flex flex-wrap items-center gap-4'>
      <DatePicker
        type='dateTimeRange'
        density='compact'
        value={[new Date(timeRange.start * 1000), new Date(timeRange.end * 1000)]}
        onChange={handleDateChange}
        style={{ width: 380 }}
      />
      <div className='flex items-center gap-2'>
        <span className='text-sm text-gray-500 whitespace-nowrap'>{t('刷新间隔')}</span>
        <InputNumber
          size='small'
          min={10}
          max={3600}
          value={refreshInterval}
          onChange={updateRefreshInterval}
          suffix={t('秒')}
          style={{ width: 120 }}
        />
      </div>
      <Button
        icon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}
        size='small'
        onClick={loadAllData}
        loading={loading}
      >
        {t('刷新')}
      </Button>
      <div className='flex items-center gap-2 ml-auto'>
        <span className='text-xs text-gray-400'>{countdown}s</span>
        <Progress
          percent={progressPercent}
          size='small'
          style={{ width: 80 }}
          showInfo={false}
          stroke='var(--semi-color-primary)'
        />
      </div>
    </div>
  </Card>
);

const gradientCards = [
  { key: 'total_quota', gradient: 'linear-gradient(135deg, #3366FF 0%, #00B8D9 100%)' },
  { key: 'total_count', gradient: 'linear-gradient(135deg, #6C5CE7 0%, #A8E6CF 100%)' },
  { key: 'rpm', gradient: 'linear-gradient(135deg, #FF6B6B 0%, #FFD93D 100%)' },
  { key: 'tpm', gradient: 'linear-gradient(135deg, #36D399 0%, #00B8D9 100%)' },
];

const SummaryCards = ({ t, summary }) => (
  <div className='grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4'>
    {gradientCards.map(({ key, gradient }) => {
      let label, value;
      switch (key) {
        case 'total_quota':
          label = t('总消耗');
          value = renderQuota(summary.total_quota, 2);
          break;
        case 'total_count':
          label = t('总调用');
          value = renderNumber(summary.total_count);
          break;
        case 'rpm':
          label = 'RPM';
          value = renderNumber(summary.rpm);
          break;
        case 'tpm':
          label = 'TPM';
          value = renderNumber(summary.tpm);
          break;
      }
      return (
        <div
          key={key}
          className='rounded-2xl p-5 text-white shadow-lg'
          style={{ background: gradient }}
        >
          <div className='text-sm opacity-80 mb-1'>{label}</div>
          <div className='text-2xl font-bold'>{value}</div>
        </div>
      );
    })}
  </div>
);

const chartCardStyle = {
  background: 'rgba(0,0,0,0.02)',
  border: '1px solid rgba(var(--semi-blue-5), 0.15)',
  transition: 'box-shadow 0.3s',
};

const chartCardHoverClass = 'hover:shadow-[0_0_12px_rgba(var(--semi-blue-5),0.3)]';

const PieChartsRow = ({ t, channelPieSpec, modelPieSpec, userPieSpec, loading }) => (
  <div className='grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4'>
    {[channelPieSpec, modelPieSpec, userPieSpec].map((spec, i) => (
      <div
        key={i}
        className={`rounded-2xl p-3 ${chartCardHoverClass}`}
        style={chartCardStyle}
      >
        {loading && !spec ? (
          <div className='h-72 flex items-center justify-center'><Spin /></div>
        ) : spec ? (
          <div className='h-72'>
            <VChart spec={spec} option={CHART_CONFIG} />
          </div>
        ) : (
          <div className='h-72 flex items-center justify-center'>
            <Empty description={t('暂无数据')} />
          </div>
        )}
      </div>
    ))}
  </div>
);

const BarChart = ({ spec, loading }) => {
  if (!spec && !loading) return null;
  return (
    <div
      className={`rounded-2xl p-3 mb-4 ${chartCardHoverClass}`}
      style={chartCardStyle}
    >
      {loading && !spec ? (
        <div className='h-80 flex items-center justify-center'><Spin /></div>
      ) : spec ? (
        <div className='h-80 w-full'>
          <VChart spec={spec} option={CHART_CONFIG} />
        </div>
      ) : null}
    </div>
  );
};
