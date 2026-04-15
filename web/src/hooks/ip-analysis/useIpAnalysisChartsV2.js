import { useMemo, useEffect } from 'react';
import { initVChartSemiTheme } from '@visactor/vchart-semi-theme';
import { renderNumber } from '../../helpers';

const COLORS = [
  '#3366FF', '#36D399', '#FF6B6B', '#FFD93D', '#6C5CE7',
  '#00B8D9', '#FF8B94', '#A8E6CF', '#FFD3B6', '#B8B5FF',
  '#F8A5C2', '#63CDDA', '#CF6A87', '#786FA6', '#F19066',
];

function assignColors(items, key = 'name') {
  const map = {};
  items.forEach((item, i) => {
    map[item[key]] = COLORS[i % COLORS.length];
  });
  return map;
}

export const useIpAnalysisChartsV2 = (data, t) => {
  useEffect(() => {
    initVChartSemiTheme({ isWatchingThemeSwitch: true });
  }, []);

  // Login geo pie chart
  const loginGeoPieSpec = useMemo(() => {
    if (!data?.loginGeoData?.length) return null;
    const items = data.loginGeoData.slice(0, 10).map((d) => ({
      name: d.location || 'Unknown',
      value: d.count,
    }));
    const colors = assignColors(items);
    return {
      type: 'pie',
      data: [{ id: 'loginGeoPie', values: items.map((d) => ({ type: d.name, value: d.value })) }],
      outerRadius: 0.8,
      innerRadius: 0.5,
      padAngle: 0.6,
      valueField: 'value',
      categoryField: 'type',
      pie: { style: { cornerRadius: 8 }, state: { hover: { outerRadius: 0.85 } } },
      title: { visible: true, text: t('登录地理分布') },
      legends: { visible: true, orient: 'bottom' },
      label: { visible: false },
      tooltip: { mark: { content: [{ key: (d) => d.type, value: (d) => renderNumber(d.value) }] } },
      color: { specified: colors },
    };
  }, [data?.loginGeoData, t]);

  // Login hourly bar chart
  const loginHourlyBarSpec = useMemo(() => {
    if (!data?.loginTimeData?.hourly_dist?.length) return null;
    const items = data.loginTimeData.hourly_dist;
    return {
      type: 'bar',
      data: [{ id: 'loginHourly', values: items.map((d) => ({ hour: `${d.hour}:00`, count: d.count })) }],
      xField: 'hour',
      yField: 'count',
      title: { visible: true, text: t('登录时间分布(24h)') },
      legends: { visible: false },
      bar: { style: { cornerRadius: [4, 4, 0, 0], fill: '#3366FF' } },
      tooltip: { mark: { content: [{ key: (d) => d.hour, value: (d) => renderNumber(d.count) }] } },
    };
  }, [data?.loginTimeData, t]);

  // Login daily trend line chart
  const loginDailyLineSpec = useMemo(() => {
    if (!data?.loginTimeData?.daily_dist?.length) return null;
    const items = [...data.loginTimeData.daily_dist].sort((a, b) => a.date.localeCompare(b.date));
    return {
      type: 'line',
      data: [{ id: 'loginDaily', values: items.map((d) => ({ date: d.date, count: d.count })) }],
      xField: 'date',
      yField: 'count',
      title: { visible: true, text: t('每日登录趋势') },
      legends: { visible: false },
      point: { visible: true, style: { fill: '#3366FF' } },
      line: { style: { stroke: '#3366FF' } },
      tooltip: { mark: { content: [{ key: (d) => d.date, value: (d) => renderNumber(d.count) }] } },
    };
  }, [data?.loginTimeData, t]);

  // Login type pie chart
  const loginTypePieSpec = useMemo(() => {
    if (!data?.loginTypeData?.length) return null;
    const items = data.loginTypeData.map((d) => ({
      name: d.login_type || 'unknown',
      value: d.count,
    }));
    const colors = assignColors(items);
    return {
      type: 'pie',
      data: [{ id: 'loginTypePie', values: items.map((d) => ({ type: d.name, value: d.value })) }],
      outerRadius: 0.8,
      innerRadius: 0.5,
      padAngle: 0.6,
      valueField: 'value',
      categoryField: 'type',
      pie: { style: { cornerRadius: 8 }, state: { hover: { outerRadius: 0.85 } } },
      title: { visible: true, text: t('登录类型分布') },
      legends: { visible: true, orient: 'bottom' },
      label: { visible: false },
      tooltip: { mark: { content: [{ key: (d) => d.type, value: (d) => renderNumber(d.value) }] } },
      color: { specified: colors },
    };
  }, [data?.loginTypeData, t]);

  return {
    loginGeoPieSpec,
    loginHourlyBarSpec,
    loginDailyLineSpec,
    loginTypePieSpec,
  };
};
