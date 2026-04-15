import { useState, useEffect, useCallback, useRef } from 'react';
import { API, showError } from '../../helpers';

const EMPTY_CONVERSION = {
  total_users: 0,
  paying_users: 0,
  repeat_buyers: 0,
  conversion_rate: 0,
  repeat_rate: 0,
};

const HEATMAP_PAST_DAYS = 30;
const HEATMAP_FUTURE_DAYS = 365;

const getHeatmapRange = () => {
  const now = Math.floor(Date.now() / 1000);
  return {
    start: now - HEATMAP_PAST_DAYS * 24 * 3600,
    end: now + HEATMAP_FUTURE_DAYS * 24 * 3600,
  };
};

export const usePurchaseAnalyticsData = () => {
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState(null);
  const [trend, setTrend] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [orderTypeData, setOrderTypeData] = useState(null);
  const [topUsers, setTopUsers] = useState(null);
  const [topUsersPage, setTopUsersPage] = useState(1);
  const [topUsersPageSize, setTopUsersPageSize] = useState(10);
  const [topUsersTotal, setTopUsersTotal] = useState(0);
  const [redemption, setRedemption] = useState(null);
  const [subscriptionOverview, setSubscriptionOverview] = useState(null);
  const [planBreakdown, setPlanBreakdown] = useState(null);
  const [topUpOverview, setTopUpOverview] = useState(null);
  const [subscriptionHeatmap, setSubscriptionHeatmap] = useState(null);
  const [dau, setDau] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [conversion, setConversion] = useState(EMPTY_CONVERSION);
  const [referral, setReferral] = useState([]);
  const [heatmapPlanId, setHeatmapPlanId] = useState(null);

  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = now - 30 * 24 * 3600;

  const [timeRange, setTimeRange] = useState({
    start: thirtyDaysAgo,
    end: now,
  });
  const [granularity, setGranularity] = useState('day');
  const [currentTab, setCurrentTab] = useState('all');
  const [countdown, setCountdown] = useState(600);
  const refreshInterval = 600;

  const loadAllData = useCallback(async () => {
    setLoading(true);
    try {
      const { start, end } = timeRange;
      const params = `start_timestamp=${start}&end_timestamp=${end}`;
      const heatmapRange = getHeatmapRange();
      const heatmapParams = `start_timestamp=${heatmapRange.start}&end_timestamp=${heatmapRange.end}`;

      const topUsersParams = `${params}&p=${topUsersPage}&page_size=${topUsersPageSize}&order_type=${currentTab}`;

      const [
        overviewRes,
        trendRes,
        paymentRes,
        orderRes,
        topUsersRes,
        redemptionRes,
        subscriptionOverviewRes,
        planBreakdownRes,
        topUpOverviewRes,
        heatmapRes,
        dauRes,
        registrationsRes,
        conversionRes,
        referralRes,
      ] = await Promise.all([
        API.get(`/api/analytics/purchase/overview?${params}&order_type=${currentTab}`),
        API.get(`/api/analytics/purchase/trend?${params}&granularity=${granularity}&order_type=${currentTab}`),
        API.get(`/api/analytics/purchase/payment-method?${params}&order_type=${currentTab}`),
        API.get(`/api/analytics/purchase/order-type?${params}`),
        API.get(`/api/analytics/purchase/top-users?${topUsersParams}`),
        API.get('/api/analytics/purchase/redemption'),
        API.get(`/api/analytics/purchase/subscription/overview?${params}`),
        API.get(`/api/analytics/purchase/subscription/plan-breakdown?${params}`),
        API.get(`/api/analytics/purchase/topup/overview?${params}`),
        API.get(`/api/analytics/purchase/subscription/heatmap?${heatmapParams}`),
        API.get(`/api/analytics/purchase/dau?${params}&granularity=${granularity}`),
        API.get(`/api/analytics/purchase/registrations?${params}&granularity=${granularity}`),
        API.get(`/api/analytics/purchase/conversion?${params}`),
        API.get(`/api/analytics/purchase/referral?${params}&limit=100`),
      ]);

      const topUsersData = topUsersRes.data.success ? (topUsersRes.data.data || {}) : {};

      setOverview(overviewRes.data.success ? overviewRes.data.data : null);
      setTrend(trendRes.data.success ? trendRes.data.data : []);
      setPaymentMethod(paymentRes.data.success ? paymentRes.data.data : []);
      setOrderTypeData(orderRes.data.success ? orderRes.data.data : []);
      setTopUsers(topUsersData.items || []);
      setTopUsersTotal(Number(topUsersData.total || 0));
      setRedemption(redemptionRes.data.success ? redemptionRes.data.data : null);
      setSubscriptionOverview(subscriptionOverviewRes.data.success ? subscriptionOverviewRes.data.data : null);
      setPlanBreakdown(planBreakdownRes.data.success ? planBreakdownRes.data.data : []);
      setTopUpOverview(topUpOverviewRes.data.success ? topUpOverviewRes.data.data : null);
      setSubscriptionHeatmap(heatmapRes.data.success ? heatmapRes.data.data : []);
      setDau(dauRes.data.success ? (dauRes.data.data || []) : []);
      setRegistrations(registrationsRes.data.success ? (registrationsRes.data.data || []) : []);
      setConversion(conversionRes.data.success ? { ...EMPTY_CONVERSION, ...(conversionRes.data.data || {}) } : EMPTY_CONVERSION);
      setReferral(referralRes.data.success ? (referralRes.data.data || []) : []);
    } catch (error) {
      showError(error.message);
    } finally {
      setLoading(false);
    }
  }, [timeRange, granularity, currentTab, topUsersPage, topUsersPageSize]);

  useEffect(() => {
    setTopUsersPage(1);
  }, [timeRange, currentTab]);

  useEffect(() => {
    setTopUsersPage(1);
  }, [topUsersPageSize]);

  // Refresh heatmap only when heatmapPlanId changes (not full reload)
  const loadHeatmapOnly = useCallback(async () => {
    try {
      const heatmapRange = getHeatmapRange();
      const params = `start_timestamp=${heatmapRange.start}&end_timestamp=${heatmapRange.end}`;
      const heatmapPlanParam = heatmapPlanId ? `&plan_id=${heatmapPlanId}` : '';
      const heatmapRes = await API.get(`/api/analytics/purchase/subscription/heatmap?${params}${heatmapPlanParam}`);
      setSubscriptionHeatmap(heatmapRes.data.success ? heatmapRes.data.data : []);
    } catch (error) {
      // Silently fail for heatmap-only refresh
    }
  }, [heatmapPlanId]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // When heatmapPlanId changes, only refresh heatmap (not all data)
  const isFirstHeatmapRender = useRef(true);
  useEffect(() => {
    if (isFirstHeatmapRender.current) {
      isFirstHeatmapRender.current = false;
      return;
    }
    loadHeatmapOnly();
  }, [heatmapPlanId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          loadAllData();
          return refreshInterval;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [loadAllData]);

  return {
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
    heatmapPlanId,
    setHeatmapPlanId,
    timeRange,
    setTimeRange,
    granularity,
    setGranularity,
    currentTab,
    setCurrentTab,
    countdown,
    loadAllData,
  };
};
