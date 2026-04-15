import React, { useEffect, useMemo, useState } from 'react';
import { Card, DatePicker, Select, Button, Progress, Spin, Empty, Tabs, TabPane, Table, Tooltip } from '@douyinfe/semi-ui';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VChart } from '@visactor/react-vchart';
import { usePurchaseAnalyticsData } from '../../hooks/purchase-analytics/usePurchaseAnalyticsData';
import { usePurchaseAnalyticsCharts } from '../../hooks/purchase-analytics/usePurchaseAnalyticsCharts';
import { renderQuota, renderNumber, convertUSDToCurrency } from '../../helpers';

const CHART_CONFIG = { mode: 'desktop-browser' };
const REFERRAL_PAGE_SIZE = 10;
const TABLE_PAGE_SIZE = 10;

const formatRMBAmount = (amount, digits = 2) => {
  const numericAmount = Number(amount || 0);
  if (!Number.isFinite(numericAmount)) {
    return `¥${Number(0).toFixed(digits)}`;
  }

  const converted = convertUSDToCurrency(numericAmount, digits);
  const numericConverted = Number(String(converted).replace(/[^\d.-]/g, ''));

  return `¥${(Number.isFinite(numericConverted) ? numericConverted : 0).toFixed(digits)}`;
};

const PurchaseAnalytics = () => {
  const { t } = useTranslation();
  const [hoveredPlanId, setHoveredPlanId] = useState(null);
  const [selectedHeatmapDate, setSelectedHeatmapDate] = useState(null);
  const [referralPage, setReferralPage] = useState(1);

  const {
    loading,
    overview,
    trend,
    paymentMethod,
    orderTypeData,
    topUsers,
    topUsersPage,
    setTopUsersPage,
    topUsersPageSize,
    setTopUsersPageSize,
    topUsersTotal,
    redemption,
    subscriptionOverview,
    planBreakdown,
    topUpOverview,
    subscriptionHeatmap,
    dau,
    registrations,
    conversion,
    referral,
    timeRange,
    setTimeRange,
    granularity,
    setGranularity,
    currentTab,
    setCurrentTab,
    countdown,
    loadAllData,
    setHeatmapPlanId,
  } = usePurchaseAnalyticsData();

  const { trendSpec, dauSpec, registrationSpec } =
    usePurchaseAnalyticsCharts(trend, dau, registrations, t);

  const handleDateChange = (dates) => {
    if (dates?.length === 2) {
      setTimeRange({
        start: Math.floor(dates[0].getTime() / 1000),
        end: Math.floor(dates[1].getTime() / 1000),
      });
    }
  };

  const handleTabChange = (tab) => {
    setReferralPage(1);
    setHoveredPlanId(null);
    setHeatmapPlanId(null);
    setCurrentTab(tab);
  };

  const handlePlanRowClick = (record) => {
    if (hoveredPlanId === record.plan_id) {
      // Click same row again → deselect
      setHoveredPlanId(null);
      setHeatmapPlanId(null);
    } else {
      setHoveredPlanId(record.plan_id);
      setHeatmapPlanId(record.plan_id);
    }
  };

  const progressPercent = ((600 - countdown) / 600) * 100;

  const formatHeatmapAmount = (quota) => {
    const numericQuota = Number(quota);
    const quotaPerUnit = Number(localStorage.getItem('quota_per_unit'));

    if (!Number.isFinite(numericQuota) || numericQuota <= 0) {
      return formatRMBAmount(0);
    }

    if (!Number.isFinite(quotaPerUnit) || quotaPerUnit <= 0) {
      return formatRMBAmount(0);
    }

    return formatRMBAmount(numericQuota / quotaPerUnit);
  };

  const hoveredPlanName = useMemo(
    () => (planBreakdown || []).find((item) => item.plan_id === hoveredPlanId)?.plan_name || null,
    [hoveredPlanId, planBreakdown],
  );

  const heatmapTitle = hoveredPlanName
    ? `${t('purchaseAnalytics.quotaHeatmap')} · ${hoveredPlanName}`
    : `${t('purchaseAnalytics.quotaHeatmap')} · All Plans`;

  const orderTypeColumns = useMemo(() => [
    {
      title: t('purchaseAnalytics.orderType'),
      dataIndex: 'order_type',
      key: 'order_type',
      render: (val) => {
        if (val === 'subscription') return t('purchaseAnalytics.subscriptionOrder');
        if (val === 'topup') return t('purchaseAnalytics.topUpOrder');
        return val || '--';
      },
    },
    {
      title: t('purchaseAnalytics.revenue'),
      dataIndex: 'revenue',
      key: 'revenue',
      render: (val) => formatRMBAmount(val),
    },
    {
      title: t('purchaseAnalytics.count'),
      dataIndex: 'count',
      key: 'count',
      render: (val) => renderNumber(val),
    },
  ], [t]);

  const paymentMethodColumns = useMemo(() => {
    const totalRevenue = paymentMethod?.reduce((sum, item) => sum + Number(item.revenue || 0), 0) || 0;
    return [
      {
        title: t('purchaseAnalytics.paymentMethod'),
        dataIndex: 'payment_method',
        key: 'payment_method',
        render: (val) => val || '--',
      },
      {
        title: t('purchaseAnalytics.revenue'),
        dataIndex: 'revenue',
        key: 'revenue',
        render: (val) => formatRMBAmount(val),
      },
      {
        title: t('purchaseAnalytics.count'),
        dataIndex: 'count',
        key: 'count',
        render: (val) => renderNumber(val),
      },
      {
        title: t('purchaseAnalytics.percentOfTotal'),
        dataIndex: 'revenue',
        key: 'percent',
        render: (val) => (totalRevenue > 0 ? `${((Number(val || 0) / totalRevenue) * 100).toFixed(1)}%` : '0%'),
      },
    ];
  }, [paymentMethod, t]);

  const topSpendersColumns = useMemo(() => [
    {
      title: t('purchaseAnalytics.rank'),
      key: 'rank',
      width: 70,
      render: (_, __, idx) => (topUsersPage - 1) * topUsersPageSize + idx + 1,
    },
    { title: t('purchaseAnalytics.username'), dataIndex: 'username', key: 'username' },
    { title: t('purchaseAnalytics.userId'), dataIndex: 'user_id', key: 'user_id', render: (val) => renderNumber(val) },
    {
      title: t('purchaseAnalytics.revenue'),
      dataIndex: 'revenue',
      key: 'revenue',
      render: (val) => formatRMBAmount(val),
    },
    { title: t('purchaseAnalytics.count'), dataIndex: 'count', key: 'count', render: (val) => renderNumber(val) },
  ], [t, topUsersPage, topUsersPageSize]);

  const planBreakdownColumns = [
    { title: t('purchaseAnalytics.planName'), dataIndex: 'plan_name', key: 'plan_name' },
    { title: t('purchaseAnalytics.purchaseCount'), dataIndex: 'purchase_count', key: 'purchase_count', render: (val) => renderNumber(val) },
    { title: t('purchaseAnalytics.totalRevenue'), dataIndex: 'total_revenue', key: 'total_revenue', render: (val) => formatRMBAmount(val) },
    { title: t('purchaseAnalytics.usedQuota'), dataIndex: 'used_quota', key: 'used_quota', render: (val) => renderQuota(val) },
    { title: t('purchaseAnalytics.unusedQuota'), dataIndex: 'unused_quota', key: 'unused_quota', render: (val) => renderQuota(val) },
    { title: t('purchaseAnalytics.expiredUnusedQuota'), dataIndex: 'expired_unused', key: 'expired_unused', render: (val) => renderQuota(val) },
  ];

  const referralPageData = useMemo(() => {
    const startIndex = (referralPage - 1) * REFERRAL_PAGE_SIZE;
    return (referral || []).slice(startIndex, startIndex + REFERRAL_PAGE_SIZE);
  }, [referral, referralPage]);

  const referralColumns = [
    {
      title: t('purchaseAnalytics.rank'),
      key: 'rank',
      render: (_, __, index) => (referralPage - 1) * REFERRAL_PAGE_SIZE + index + 1,
    },
    { title: t('purchaseAnalytics.inviter'), dataIndex: 'inviter', key: 'inviter' },
    { title: t('purchaseAnalytics.userId'), dataIndex: 'user_id', key: 'user_id', render: (val) => renderNumber(val) },
    { title: t('purchaseAnalytics.referredCount'), dataIndex: 'referred_count', key: 'referred_count', render: (val) => renderNumber(val) },
    {
      title: t('purchaseAnalytics.referredRevenue'),
      dataIndex: 'referred_revenue',
      key: 'referred_revenue',
      render: (val) => formatRMBAmount(val),
    },
  ];

  const conversionCards = [
    {
      key: 'total_users',
      label: t('purchaseAnalytics.totalUsers'),
      value: Number(conversion?.total_users || 0),
      percent: 100,
      color: '#3366FF',
    },
    {
      key: 'paying_users',
      label: t('purchaseAnalytics.payingUsers'),
      value: Number(conversion?.paying_users || 0),
      percent: Number(conversion?.conversion_rate || 0),
      color: '#36D399',
    },
    {
      key: 'repeat_buyers',
      label: t('purchaseAnalytics.repeatBuyers'),
      value: Number(conversion?.repeat_buyers || 0),
      percent: Number(conversion?.repeat_rate || 0),
      color: '#FF9F43',
    },
  ];

  const topSpendersPagination = {
    currentPage: topUsersPage,
    pageSize: topUsersPageSize,
    total: topUsersTotal,
    onPageChange: setTopUsersPage,
    onPageSizeChange: (pageSize) => setTopUsersPageSize(pageSize),
  };

  return (
    <div className='mt-[60px] px-4 pb-8'>
      <Card className='!rounded-2xl mb-4' bodyStyle={{ padding: '12px 20px' }}>
        <div className='flex flex-wrap items-center gap-4'>
          <DatePicker
            type='dateTimeRange'
            density='compact'
            value={[new Date(timeRange.start * 1000), new Date(timeRange.end * 1000)]}
            onChange={handleDateChange}
            style={{ width: 380 }}
          />
          <Select
            size='small'
            value={granularity}
            onChange={setGranularity}
            style={{ width: 120 }}
          >
            <Select.Option value='day'>{t('purchaseAnalytics.day')}</Select.Option>
            <Select.Option value='week'>{t('purchaseAnalytics.week')}</Select.Option>
            <Select.Option value='month'>{t('purchaseAnalytics.month')}</Select.Option>
          </Select>
          <Button
            icon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}
            size='small'
            onClick={loadAllData}
            loading={loading}
          >
            {t('purchaseAnalytics.refresh')}
          </Button>
          <div className='flex items-center gap-2 ml-auto'>
            <span className='text-xs text-gray-400'>{countdown}s</span>
            <Progress percent={progressPercent} size='small' style={{ width: 80 }} showInfo={false} />
          </div>
        </div>
      </Card>

      <Tabs activeKey={currentTab} onChange={handleTabChange}>
        <TabPane tab={t('purchaseAnalytics.allOrders')} itemKey='all'>
          {overview && (
            <div className='grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4'>
              {[
                { key: 'total_revenue', label: t('purchaseAnalytics.totalRevenue'), value: formatRMBAmount(overview.total_revenue), gradient: 'linear-gradient(135deg, #3366FF 0%, #00B8D9 100%)' },
                { key: 'order_count', label: t('purchaseAnalytics.orderCount'), value: renderNumber(overview.order_count || 0), gradient: 'linear-gradient(135deg, #6C5CE7 0%, #A8E6CF 100%)' },
                { key: 'avg_order_value', label: t('purchaseAnalytics.avgOrderValue'), value: formatRMBAmount(overview.avg_order_value), gradient: 'linear-gradient(135deg, #36D399 0%, #00B8D9 100%)' },
                { key: 'revenue_change', label: t('purchaseAnalytics.changePercent'), value: `${Number(overview.revenue_change || 0).toFixed(1)}%`, gradient: 'linear-gradient(135deg, #FF6B6B 0%, #FFD93D 100%)' },
              ].map(({ key, label, value, gradient }) => (
                <div key={key} className='rounded-2xl p-5 text-white shadow-lg' style={{ background: gradient }}>
                  <div className='text-sm opacity-80 mb-1'>{label}</div>
                  <div className='text-2xl font-bold'>{value}</div>
                </div>
              ))}
            </div>
          )}

          <div className='grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4'>
            <ChartCard spec={trendSpec} loading={loading} height='h-72' />
            <ChartCard spec={dauSpec} loading={loading} height='h-72' />
          </div>

          <div className='grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4'>
            <ChartCard spec={registrationSpec} loading={loading} height='h-72' />
            <Card className='!rounded-2xl' bodyStyle={{ padding: '12px 16px' }}>
              <div className='text-sm font-semibold mb-3 opacity-70'>{t('purchaseAnalytics.orderType')}</div>
              <Table columns={orderTypeColumns} dataSource={orderTypeData || []} rowKey='order_type' pagination={{ pageSize: TABLE_PAGE_SIZE }} size='small' />
            </Card>
          </div>

          <div className='grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4'>
            <Card className='!rounded-2xl' bodyStyle={{ padding: '12px 16px' }}>
              <div className='text-sm font-semibold mb-3 opacity-70'>{t('purchaseAnalytics.paymentMethod')}</div>
              <Table columns={paymentMethodColumns} dataSource={paymentMethod || []} rowKey='payment_method' pagination={{ pageSize: TABLE_PAGE_SIZE }} size='small' />
            </Card>
            <Card className='!rounded-2xl' bodyStyle={{ padding: '12px 16px' }}>
              <div className='text-sm font-semibold mb-3 opacity-70'>{t('purchaseAnalytics.topSpenders')}</div>
              <Table columns={topSpendersColumns} dataSource={topUsers || []} rowKey='user_id' pagination={topSpendersPagination} size='small' />
            </Card>
          </div>

          <Card className='!rounded-2xl mb-4' bodyStyle={{ padding: '16px' }}>
            <div className='text-sm font-semibold mb-4 opacity-70'>{t('purchaseAnalytics.conversionFunnel')}</div>
            <div className='space-y-3'>
              {conversionCards.map((item, index) => (
                <div
                  key={item.key}
                  className='rounded-2xl p-4 text-white shadow-sm'
                  style={{
                    background: item.color,
                    width: `${Math.max(55, 100 - index * 15)}%`,
                    margin: '0 auto',
                  }}
                >
                  <div className='flex items-center justify-between gap-3'>
                    <div>
                      <div className='text-sm opacity-80'>{item.label}</div>
                      <div className='text-2xl font-bold'>{renderNumber(item.value)}</div>
                    </div>
                    <div className='text-right'>
                      <div className='text-xs opacity-80'>Rate</div>
                      <div className='text-lg font-semibold'>{Number(item.percent || 0).toFixed(1)}%</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className='!rounded-2xl mb-4' bodyStyle={{ padding: '12px 16px' }}>
            <div className='text-sm font-semibold mb-3 opacity-70'>{t('purchaseAnalytics.referralAnalytics')}</div>
            <Table
              columns={referralColumns}
              dataSource={referralPageData}
              rowKey='user_id'
              pagination={{
                currentPage: referralPage,
                pageSize: REFERRAL_PAGE_SIZE,
                total: (referral || []).length,
                onPageChange: setReferralPage,
              }}
              size='small'
            />
          </Card>
        </TabPane>

        <TabPane tab={t('purchaseAnalytics.subscriptionAnalytics')} itemKey='subscription'>
          {subscriptionOverview && (
            <div className='grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4'>
              {[
                { key: 'total_revenue', label: t('purchaseAnalytics.totalSubscriptionRevenue'), value: formatRMBAmount(subscriptionOverview.total_revenue), gradient: 'linear-gradient(135deg, #3366FF 0%, #00B8D9 100%)' },
                { key: 'used_money', label: t('purchaseAnalytics.usedMoney'), value: formatRMBAmount(subscriptionOverview.used_money), gradient: 'linear-gradient(135deg, #6C5CE7 0%, #A8E6CF 100%)' },
                { key: 'expired_unused_money', label: t('purchaseAnalytics.expiredUnusedMoney'), value: formatRMBAmount(subscriptionOverview.expired_unused_money), gradient: 'linear-gradient(135deg, #FF6B6B 0%, #FFD93D 100%)' },
              ].map(({ key, label, value, gradient }) => (
                <div key={key} className='rounded-2xl p-5 text-white shadow-lg' style={{ background: gradient }}>
                  <div className='text-sm opacity-80 mb-1'>{label}</div>
                  <div className='text-2xl font-bold'>{value}</div>
                </div>
              ))}
            </div>
          )}

          {planBreakdown !== null && (
            <Card className='!rounded-2xl mb-4' bodyStyle={{ padding: '12px 16px' }}>
              <div className='text-sm font-semibold mb-3 opacity-70'>{t('purchaseAnalytics.planBreakdown')}</div>
              <Table
                columns={planBreakdownColumns}
                dataSource={planBreakdown || []}
                rowKey='plan_id'
                pagination={false}
                size='small'
                onRow={(record) => ({
                  onClick: () => handlePlanRowClick(record),
                  style: {
                    cursor: 'pointer',
                    ...(hoveredPlanId === record.plan_id ? { background: 'rgba(var(--semi-blue-0), 1)' } : {}),
                  },
                })}
              />
            </Card>
          )}

          {subscriptionHeatmap !== null && (
            <Card className='!rounded-2xl mb-4' bodyStyle={{ padding: '12px 16px' }}>
              <div className='text-sm font-semibold mb-3 opacity-70'>{heatmapTitle}</div>
              <HeatmapCalendar
                data={subscriptionHeatmap}
                t={t}
                formatAmount={formatHeatmapAmount}
                selectedHeatmapDate={selectedHeatmapDate}
                setSelectedHeatmapDate={setSelectedHeatmapDate}
              />
            </Card>
          )}

          <ChartCard spec={trendSpec} loading={loading} height='h-80' />

          <div className='grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4'>
            <Card className='!rounded-2xl' bodyStyle={{ padding: '12px 16px' }}>
              <div className='text-sm font-semibold mb-3 opacity-70'>{t('purchaseAnalytics.orderType')}</div>
              <Table columns={orderTypeColumns} dataSource={orderTypeData || []} rowKey='order_type' pagination={{ pageSize: TABLE_PAGE_SIZE }} size='small' />
            </Card>
            <Card className='!rounded-2xl' bodyStyle={{ padding: '12px 16px' }}>
              <div className='text-sm font-semibold mb-3 opacity-70'>{t('purchaseAnalytics.paymentMethod')}</div>
              <Table columns={paymentMethodColumns} dataSource={paymentMethod || []} rowKey='payment_method' pagination={{ pageSize: TABLE_PAGE_SIZE }} size='small' />
            </Card>
            <Card className='!rounded-2xl' bodyStyle={{ padding: '12px 16px' }}>
              <div className='text-sm font-semibold mb-3 opacity-70'>{t('purchaseAnalytics.topSpenders')}</div>
              <Table columns={topSpendersColumns} dataSource={topUsers || []} rowKey='user_id' pagination={topSpendersPagination} size='small' />
            </Card>
          </div>
        </TabPane>

        <TabPane tab={t('purchaseAnalytics.topUpAnalytics')} itemKey='topup'>
          {topUpOverview && (
            <div className='grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4'>
              {[
                { key: 'total_revenue', label: t('purchaseAnalytics.totalTopUpRevenue'), value: formatRMBAmount(topUpOverview.total_revenue), gradient: 'linear-gradient(135deg, #3366FF 0%, #00B8D9 100%)' },
                { key: 'wallet_balance', label: t('purchaseAnalytics.walletBalanceTotal'), value: formatRMBAmount(topUpOverview.wallet_balance_total), gradient: 'linear-gradient(135deg, #36D399 0%, #00B8D9 100%)' },
              ].map(({ key, label, value, gradient }) => (
                <div key={key} className='rounded-2xl p-5 text-white shadow-lg' style={{ background: gradient }}>
                  <div className='text-sm opacity-80 mb-1'>{label}</div>
                  <div className='text-2xl font-bold'>{value}</div>
                </div>
              ))}
            </div>
          )}

          <ChartCard spec={trendSpec} loading={loading} height='h-80' />

          <div className='grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4'>
            <Card className='!rounded-2xl' bodyStyle={{ padding: '12px 16px' }}>
              <div className='text-sm font-semibold mb-3 opacity-70'>{t('purchaseAnalytics.orderType')}</div>
              <Table columns={orderTypeColumns} dataSource={orderTypeData || []} rowKey='order_type' pagination={{ pageSize: TABLE_PAGE_SIZE }} size='small' />
            </Card>
            <Card className='!rounded-2xl' bodyStyle={{ padding: '12px 16px' }}>
              <div className='text-sm font-semibold mb-3 opacity-70'>{t('purchaseAnalytics.paymentMethod')}</div>
              <Table columns={paymentMethodColumns} dataSource={paymentMethod || []} rowKey='payment_method' pagination={{ pageSize: TABLE_PAGE_SIZE }} size='small' />
            </Card>
            <Card className='!rounded-2xl' bodyStyle={{ padding: '12px 16px' }}>
              <div className='text-sm font-semibold mb-3 opacity-70'>{t('purchaseAnalytics.topSpenders')}</div>
              <Table columns={topSpendersColumns} dataSource={topUsers || []} rowKey='user_id' pagination={topSpendersPagination} size='small' />
            </Card>
          </div>
        </TabPane>
      </Tabs>

      {redemption && (
        <div className='grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4'>
          {[
            { key: 'total', label: t('purchaseAnalytics.redemptionTotal'), value: renderNumber(redemption.total_created), gradient: 'linear-gradient(135deg, #3366FF 0%, #00B8D9 100%)' },
            { key: 'used', label: t('purchaseAnalytics.redemptionUsed'), value: renderNumber(redemption.total_used), gradient: 'linear-gradient(135deg, #6C5CE7 0%, #A8E6CF 100%)' },
            { key: 'unused', label: t('purchaseAnalytics.redemptionUnused'), value: renderNumber(redemption.total_enabled), gradient: 'linear-gradient(135deg, #FF6B6B 0%, #FFD93D 100%)' },
            { key: 'rate', label: t('purchaseAnalytics.redemptionRate'), value: `${redemption.usage_rate?.toFixed(1) || 0}%`, gradient: 'linear-gradient(135deg, #36D399 0%, #00B8D9 100%)' },
          ].map(({ key, label, value, gradient }) => (
            <div key={key} className='rounded-2xl p-5 text-white shadow-lg' style={{ background: gradient }}>
              <div className='text-sm opacity-80 mb-1'>{label}</div>
              <div className='text-2xl font-bold'>{value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const HeatmapCalendar = ({ data, t, formatAmount, selectedHeatmapDate, setSelectedHeatmapDate }) => {
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Build full date range: 30 days ago to 365 days in the future from today
  const fullData = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTime = today.getTime();

    const startDate = new Date(todayTime - 30 * 24 * 3600 * 1000);
    const endDate = new Date(todayTime + 365 * 24 * 3600 * 1000);

    // Index API data by date string for fast lookup
    const dataMap = {};
    (data || []).forEach((item) => { dataMap[item.date] = item; });

    const result = [];
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const yyyy = cursor.getFullYear();
      const mm = String(cursor.getMonth() + 1).padStart(2, '0');
      const dd = String(cursor.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;
      const isFuture = cursor.getTime() > todayTime;

      if (dataMap[dateStr]) {
        result.push({ ...dataMap[dateStr], is_future: isFuture });
      } else {
        result.push({
          date: dateStr,
          subscription_count: 0,
          total_quota: 0,
          used_quota: 0,
          is_future: isFuture,
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return result;
  }, [data]);

  const selectedItem = useMemo(() => {
    if (!selectedHeatmapDate) return null;
    return fullData.find((item) => item.date === selectedHeatmapDate) || null;
  }, [fullData, selectedHeatmapDate]);

  if (!fullData.length) return null;

  const getColor = (item) => {
    if (item.is_future) {
      if (item.subscription_count === 0) return '#ebedf0';
      if (item.subscription_count <= 2) return '#dbeafe';
      if (item.subscription_count <= 5) return '#93c5fd';
      return '#3b82f6';
    }
    if (item.total_quota === 0) return '#ebedf0';
    const ratio = item.used_quota / item.total_quota;
    if (ratio === 0) return '#ebedf0';
    if (ratio < 0.25) return '#9be9a7';
    if (ratio < 0.5) return '#40c463';
    if (ratio < 0.75) return '#30a14e';
    return '#216e39';
  };

  const getTooltip = (item) => {
    const lines = [item.date];
    if (item.is_future) {
      lines[0] += ` (${t('purchaseAnalytics.heatmapFutureDay')})`;
    }
    lines.push(`${t('purchaseAnalytics.heatmapSubscriptions')}: ${item.subscription_count}`);
    if (item.total_quota > 0) {
      lines.push(`${t('purchaseAnalytics.heatmapTotalQuota')}: ${formatAmount(item.total_quota)}`);
      if (!item.is_future) {
        lines.push(`${t('purchaseAnalytics.heatmapUsedQuota')}: ${formatAmount(item.used_quota)}`);
        const rate = ((item.used_quota / item.total_quota) * 100).toFixed(1);
        lines.push(`${t('purchaseAnalytics.heatmapUsageRate')}: ${rate}%`);
      }
    }
    return lines.join('\n');
  };

  // Build weeks and track month labels
  const weeks = [];
  const monthLabels = []; // { weekIndex, label }
  let currentWeek = [];
  let lastMonth = -1;

  // Pad the first week so the first date lands on the correct day-of-week
  const firstDate = new Date(fullData[0].date + 'T00:00:00');
  const firstDayOfWeek = firstDate.getDay();
  for (let i = 0; i < firstDayOfWeek; i++) {
    currentWeek.push(null);
  }

  fullData.forEach((item) => {
    const d = new Date(item.date + 'T00:00:00');
    const month = d.getMonth();
    // When we enter a new month, record a label at the current week index
    if (month !== lastMonth) {
      const weekIdx = weeks.length; // index of the week being built
      monthLabels.push({ weekIndex: weekIdx, label: MONTH_NAMES[month] });
      lastMonth = month;
    }
    currentWeek.push(item);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  });
  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }

  const cellSize = 11;
  const cellGap = 2;
  const colWidth = cellSize + cellGap;
  const labelHeight = 16;

  return (
    <div className='overflow-x-auto'>
      {/* Month labels row */}
      <div style={{ display: 'flex', paddingLeft: 0, height: labelHeight, marginBottom: 2 }}>
        {weeks.map((_, wi) => {
          const ml = monthLabels.find((m) => m.weekIndex === wi);
          return (
            <div key={wi} style={{ width: colWidth, flexShrink: 0, fontSize: 10, color: '#9ca3af', whiteSpace: 'nowrap' }}>
              {ml ? ml.label : ''}
            </div>
          );
        })}
      </div>
      {/* Heatmap grid */}
      <div style={{ display: 'inline-flex', gap: `${cellGap}px` }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: `${cellGap}px` }}>
            {week.map((item, di) => (
              <Tooltip key={di} content={item ? <span style={{ whiteSpace: 'pre-line' }}>{getTooltip(item)}</span> : ''} position='top'>
                <div
                  onClick={() => {
                    if (!item) return;
                    setSelectedHeatmapDate((prev) => (prev === item.date ? null : item.date));
                  }}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    borderRadius: 2,
                    backgroundColor: item ? getColor(item) : 'transparent',
                    outline: item && item.date === selectedHeatmapDate ? '2px solid rgba(var(--semi-blue-5), 0.85)' : undefined,
                    outlineOffset: item && item.date === selectedHeatmapDate ? 1 : undefined,
                    cursor: item ? 'pointer' : 'default',
                  }}
                />
              </Tooltip>
            ))}
            {Array.from({ length: 7 - week.length }).map((_, pi) => (
              <div key={`pad-${pi}`} style={{ width: cellSize, height: cellSize }} />
            ))}
          </div>
        ))}
      </div>

      {selectedItem && (
        <div className='mt-2 text-xs text-gray-500'>
          <span className='font-medium text-gray-600'>{selectedItem.date}</span>
          <span className='mx-2'>·</span>
          <span>{t('purchaseAnalytics.heatmapSubscriptions')}: {renderNumber(selectedItem.subscription_count)}</span>
          {Number(selectedItem.total_quota || 0) > 0 && (
            <>
              <span className='mx-2'>·</span>
              <span>{t('purchaseAnalytics.heatmapTotalQuota')}: {formatAmount(selectedItem.total_quota)}</span>
              {!selectedItem.is_future && (
                <>
                  <span className='mx-2'>·</span>
                  <span>{t('purchaseAnalytics.heatmapUsedQuota')}: {formatAmount(selectedItem.used_quota)}</span>
                </>
              )}
            </>
          )}
        </div>
      )}

      <div className='flex items-center gap-1 mt-2 text-xs text-gray-400'>
        <span>{t('purchaseAnalytics.heatmapUsageRate')}:</span>
        {['#ebedf0', '#9be9a7', '#40c463', '#30a14e', '#216e39'].map((color) => (
          <div key={color} style={{ width: cellSize, height: cellSize, borderRadius: 2, backgroundColor: color }} />
        ))}
        <span className='ml-2'>{t('purchaseAnalytics.heatmapFutureDay')}:</span>
        {['#dbeafe', '#93c5fd', '#3b82f6'].map((color) => (
          <div key={color} style={{ width: cellSize, height: cellSize, borderRadius: 2, backgroundColor: color }} />
        ))}
      </div>
    </div>
  );
};

const ChartCard = ({ spec, loading, height }) => (
  <div className='rounded-2xl p-3 mb-4' style={{ background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(var(--semi-blue-5), 0.15)' }}>
    {loading && !spec ? (
      <div className={`${height} flex items-center justify-center`}><Spin /></div>
    ) : spec ? (
      <div className={`${height} w-full`}><VChart spec={spec} option={CHART_CONFIG} /></div>
    ) : (
      <div className={`${height} flex items-center justify-center`}><Empty /></div>
    )}
  </div>
);

export default PurchaseAnalytics;
