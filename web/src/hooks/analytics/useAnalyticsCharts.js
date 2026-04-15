import { useMemo, useEffect } from 'react';
import { initVChartSemiTheme } from '@visactor/vchart-semi-theme';
import { renderQuota, renderNumber } from '../../helpers';

const COLORS = [
  '#3366FF', '#36D399', '#FF6B6B', '#FFD93D', '#6C5CE7',
  '#00B8D9', '#FF8B94', '#A8E6CF', '#FFD3B6', '#B8B5FF',
  '#F8A5C2', '#63CDDA', '#CF6A87', '#786FA6', '#F19066',
];

function assignColors(items) {
  const map = {};
  items.forEach((item, i) => {
    map[item.name] = COLORS[i % COLORS.length];
  });
  return map;
}

export const useAnalyticsCharts = (channelData, modelData, userData, t) => {
  useEffect(() => {
    initVChartSemiTheme({ isWatchingThemeSwitch: true });
  }, []);

  const channelPieSpec = useMemo(() => {
    if (!channelData?.items?.length) return null;
    const sorted = [...channelData.items].sort((a, b) => b.quota - a.quota);
    const top10 = sorted.slice(0, 10);
    const colors = assignColors(top10);
    return {
      type: 'pie',
      data: [{ id: 'channelPie', values: top10.map((d) => ({ type: d.name, value: d.quota })) }],
      outerRadius: 0.8,
      innerRadius: 0.5,
      padAngle: 0.6,
      valueField: 'value',
      categoryField: 'type',
      pie: { style: { cornerRadius: 8 }, state: { hover: { outerRadius: 0.85 } } },
      title: { visible: true, text: t('渠道消耗分布') },
      legends: { visible: true, orient: 'bottom' },
      label: { visible: false },
      tooltip: {
        mark: { content: [{ key: (d) => d.type, value: (d) => renderQuota(d.value, 2) }] },
      },
      color: { specified: colors },
    };
  }, [channelData, t]);

  const modelPieSpec = useMemo(() => {
    if (!modelData?.items?.length) return null;
    const sorted = [...modelData.items].sort((a, b) => b.quota - a.quota);
    const top10 = sorted.slice(0, 10);
    const colors = assignColors(top10);
    return {
      type: 'pie',
      data: [{ id: 'modelPie', values: top10.map((d) => ({ type: d.name, value: d.quota })) }],
      outerRadius: 0.8,
      innerRadius: 0.5,
      padAngle: 0.6,
      valueField: 'value',
      categoryField: 'type',
      pie: { style: { cornerRadius: 8 }, state: { hover: { outerRadius: 0.85 } } },
      title: { visible: true, text: t('模型消耗分布') },
      legends: { visible: true, orient: 'bottom' },
      label: { visible: false },
      tooltip: {
        mark: { content: [{ key: (d) => d.type, value: (d) => renderQuota(d.value, 2) }] },
      },
      color: { specified: colors },
    };
  }, [modelData, t]);

  const userPieSpec = useMemo(() => {
    if (!userData?.items?.length) return null;
    const sorted = [...userData.items].sort((a, b) => b.quota - a.quota);
    const top10 = sorted.slice(0, 10);
    const colors = assignColors(top10);
    return {
      type: 'pie',
      data: [{ id: 'userPie', values: top10.map((d) => ({ type: d.name, value: d.quota })) }],
      outerRadius: 0.8,
      innerRadius: 0.5,
      padAngle: 0.6,
      valueField: 'value',
      categoryField: 'type',
      pie: { style: { cornerRadius: 8 }, state: { hover: { outerRadius: 0.85 } } },
      title: { visible: true, text: t('用户消耗分布') },
      legends: { visible: true, orient: 'bottom' },
      label: { visible: false },
      tooltip: {
        mark: { content: [{ key: (d) => d.type, value: (d) => renderQuota(d.value, 2) }] },
      },
      color: { specified: colors },
    };
  }, [userData, t]);

  // Horizontal bar charts (TOP 10)
  const channelBarSpec = useMemo(() => {
    if (!channelData?.items?.length) return null;
    const sorted = [...channelData.items].sort((a, b) => b.quota - a.quota).slice(0, 10).reverse();
    const colors = assignColors(sorted);
    return {
      type: 'bar',
      direction: 'horizontal',
      data: [{ id: 'channelBar', values: sorted.map((d) => ({ name: d.name, value: d.quota })) }],
      xField: 'value',
      yField: 'name',
      seriesField: 'name',
      title: { visible: true, text: t('渠道消耗排行') + ' (TOP 10)' },
      legends: { visible: false },
      label: { visible: true, position: 'outside', formatter: (d) => renderQuota(d.value, 2) },
      tooltip: {
        mark: { content: [{ key: (d) => d.name, value: (d) => renderQuota(d.value, 2) }] },
      },
      bar: { style: { cornerRadius: [0, 4, 4, 0] } },
      color: { specified: colors },
    };
  }, [channelData, t]);

  const modelBarSpec = useMemo(() => {
    if (!modelData?.items?.length) return null;
    const sorted = [...modelData.items].sort((a, b) => b.count - a.count).slice(0, 10).reverse();
    const colors = assignColors(sorted);
    return {
      type: 'bar',
      direction: 'horizontal',
      data: [{ id: 'modelBar', values: sorted.map((d) => ({ name: d.name, value: d.count })) }],
      xField: 'value',
      yField: 'name',
      seriesField: 'name',
      title: { visible: true, text: t('模型调用排行') + ' (TOP 10)' },
      legends: { visible: false },
      label: { visible: true, position: 'outside', formatter: (d) => renderNumber(d.value) },
      tooltip: {
        mark: { content: [{ key: (d) => d.name, value: (d) => renderNumber(d.value) }] },
      },
      bar: { style: { cornerRadius: [0, 4, 4, 0] } },
      color: { specified: colors },
    };
  }, [modelData, t]);

  const userBarSpec = useMemo(() => {
    if (!userData?.items?.length) return null;
    const sorted = [...userData.items].sort((a, b) => b.quota - a.quota).slice(0, 10).reverse();
    const colors = assignColors(sorted);
    return {
      type: 'bar',
      direction: 'horizontal',
      data: [{ id: 'userBar', values: sorted.map((d) => ({ name: d.name, value: d.quota })) }],
      xField: 'value',
      yField: 'name',
      seriesField: 'name',
      title: { visible: true, text: t('用户消耗排行') + ' (TOP 10)' },
      legends: { visible: false },
      label: { visible: true, position: 'outside', formatter: (d) => renderQuota(d.value, 2) },
      tooltip: {
        mark: { content: [{ key: (d) => d.name, value: (d) => renderQuota(d.value, 2) }] },
      },
      bar: { style: { cornerRadius: [0, 4, 4, 0] } },
      color: { specified: colors },
    };
  }, [userData, t]);

  return {
    channelPieSpec,
    modelPieSpec,
    userPieSpec,
    channelBarSpec,
    modelBarSpec,
    userBarSpec,
  };
};
