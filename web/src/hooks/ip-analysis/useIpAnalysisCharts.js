import { useMemo, useEffect } from 'react';
import { initVChartSemiTheme } from '@visactor/vchart-semi-theme';
import { renderNumber } from '../../helpers';

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

export const useIpAnalysisCharts = (data, t) => {
  useEffect(() => {
    initVChartSemiTheme({ isWatchingThemeSwitch: true });
  }, []);

  // Country / region distribution pie (from country_dist or login_type_dist is actually available from backend via ip_location parsing)
  // We'll use login_type_dist for login type pie
  const loginTypePieSpec = useMemo(() => {
    if (!data?.login_type_dist?.length) return null;
    const items = data.login_type_dist.map((d) => ({
      name: d.name || 'unknown',
      count: d.count,
    }));
    const colors = assignColors(items);
    return {
      type: 'pie',
      data: [
        {
          id: 'loginTypePie',
          values: items.map((d) => ({ type: d.name, value: d.count })),
        },
      ],
      outerRadius: 0.8,
      innerRadius: 0.5,
      padAngle: 0.6,
      valueField: 'value',
      categoryField: 'type',
      pie: {
        style: { cornerRadius: 8 },
        state: { hover: { outerRadius: 0.85 } },
      },
      title: { visible: true, text: t('登录类型分布') },
      legends: { visible: true, orient: 'bottom' },
      label: { visible: false },
      tooltip: {
        mark: {
          content: [
            { key: (d) => d.type, value: (d) => renderNumber(d.value) },
          ],
        },
      },
      color: { specified: colors },
    };
  }, [data, t]);

  // Top IPs bar chart
  const topIpsBarSpec = useMemo(() => {
    if (!data?.top_ips?.length) return null;
    const sorted = [...data.top_ips].slice(0, 20).reverse();
    const items = sorted.map((d) => ({ name: d.ip, count: d.count }));
    const colors = assignColors(items);
    return {
      type: 'bar',
      direction: 'horizontal',
      data: [
        {
          id: 'topIpsBar',
          values: items.map((d) => ({ name: d.name, value: d.count })),
        },
      ],
      xField: 'value',
      yField: 'name',
      seriesField: 'name',
      title: {
        visible: true,
        text: t('Top IP排行') + ' (TOP 20)',
      },
      legends: { visible: false },
      label: {
        visible: true,
        position: 'outside',
        formatter: (d) => renderNumber(d.value),
      },
      tooltip: {
        mark: {
          content: [
            { key: (d) => d.name, value: (d) => renderNumber(d.value) },
          ],
        },
      },
      bar: { style: { cornerRadius: [0, 4, 4, 0] } },
      color: { specified: colors },
    };
  }, [data, t]);

  // Top users by IP count bar chart
  const topUsersBarSpec = useMemo(() => {
    if (!data?.top_users?.length) return null;
    const sorted = [...data.top_users].slice(0, 20).reverse();
    const items = sorted.map((d) => ({
      name: d.username || `User#${d.user_id}`,
      count: d.ip_count,
    }));
    const colors = assignColors(items);
    return {
      type: 'bar',
      direction: 'horizontal',
      data: [
        {
          id: 'topUsersBar',
          values: items.map((d) => ({ name: d.name, value: d.count })),
        },
      ],
      xField: 'value',
      yField: 'name',
      seriesField: 'name',
      title: {
        visible: true,
        text: t('Top 用户(按IP数量)') + ' (TOP 20)',
      },
      legends: { visible: false },
      label: {
        visible: true,
        position: 'outside',
        formatter: (d) => renderNumber(d.value),
      },
      tooltip: {
        mark: {
          content: [
            { key: (d) => d.name, value: (d) => renderNumber(d.value) },
          ],
        },
      },
      bar: { style: { cornerRadius: [0, 4, 4, 0] } },
      color: { specified: colors },
    };
  }, [data, t]);

  return {
    loginTypePieSpec,
    topIpsBarSpec,
    topUsersBarSpec,
  };
};
