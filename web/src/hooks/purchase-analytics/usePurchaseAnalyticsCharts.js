import { useMemo } from 'react';

export const usePurchaseAnalyticsCharts = (trend, dau, registrations, t) => {
  const trendSpec = useMemo(() => {
    if (!trend?.length) return null;
    return {
      type: 'area',
      data: [{ id: 'trend', values: trend }],
      xField: 'time_bucket',
      yField: 'revenue',
      line: { style: { lineWidth: 2 } },
      area: { style: { fillOpacity: 0.3 } },
      color: ['#3366FF'],
      axes: [
        { orient: 'left', title: { visible: true, text: t('purchaseAnalytics.revenueTrend') } },
        { orient: 'bottom', title: { visible: true, text: t('purchaseAnalytics.date') } },
      ],
    };
  }, [trend, t]);

  const dauSpec = useMemo(() => {
    if (!dau?.length) return null;
    const values = dau.flatMap((item) => [
      { time_bucket: String(item.time_bucket), count: item.api_active_users ?? 0, type: t('purchaseAnalytics.apiActiveUsers') },
      { time_bucket: String(item.time_bucket), count: item.login_active_users ?? 0, type: t('purchaseAnalytics.loginActiveUsers') },
      { time_bucket: String(item.time_bucket), count: item.total_active_users ?? 0, type: t('purchaseAnalytics.totalActiveUsers') },
    ]);
    return {
      type: 'line',
      data: [{ id: 'dau', values }],
      xField: 'time_bucket',
      yField: 'count',
      seriesField: 'type',
      line: { style: { lineWidth: 2 } },
      point: { visible: true, style: { size: 4 } },
      legends: { visible: true, orient: 'bottom' },
      axes: [
        { orient: 'left', title: { visible: true, text: t('purchaseAnalytics.dauTrend') } },
        { orient: 'bottom', title: { visible: true, text: t('purchaseAnalytics.date') } },
      ],
      color: ['#3366FF', '#36D399', '#FF9F43'],
    };
  }, [dau, t]);

  const registrationSpec = useMemo(() => {
    if (!registrations?.length) return null;
    const values = registrations.flatMap((item) => [
      { time_bucket: String(item.time_bucket), count: item.new_users ?? 0, type: t('purchaseAnalytics.newUsers') },
      { time_bucket: String(item.time_bucket), count: item.referred_users ?? 0, type: t('purchaseAnalytics.referredUsers') },
    ]);
    return {
      type: 'bar',
      data: [{ id: 'registrations', values }],
      xField: 'time_bucket',
      yField: 'count',
      seriesField: 'type',
      stack: true,
      legends: { visible: true, orient: 'bottom' },
      axes: [
        { orient: 'left', title: { visible: true, text: t('purchaseAnalytics.registrationTrend') } },
        { orient: 'bottom', title: { visible: true, text: t('purchaseAnalytics.date') } },
      ],
      color: ['#6C5CE7', '#00B8D9'],
    };
  }, [registrations, t]);

  return { trendSpec, dauSpec, registrationSpec };
};
