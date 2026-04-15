import { useState, useEffect, useCallback, useRef } from 'react';
import { API } from '../../helpers/api';
import { showError, showSuccess } from '../../helpers';

const DEFAULT_REFRESH_INTERVAL = 360;
const BASE = '/api/ip/v2';

export const useIpAnalysisDataV2 = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const [timeRange, setTimeRange] = useState(() => {
    const now = Math.floor(Date.now() / 1000);
    return { start: now - 86400, end: now };
  });

  const [refreshInterval, setRefreshInterval] = useState(
    () =>
      parseInt(localStorage.getItem('ip-analysis-refresh-interval')) ||
      DEFAULT_REFRESH_INTERVAL,
  );

  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(refreshInterval);
  const timerRef = useRef(null);
  const countdownRef = useRef(null);

  // Data stores per tab
  const [overviewData, setOverviewData] = useState(null);
  const [loginGeoData, setLoginGeoData] = useState(null);
  const [loginTimeData, setLoginTimeData] = useState(null);
  const [loginTypeData, setLoginTypeData] = useState(null);
  const [multiAccountData, setMultiAccountData] = useState(null);
  const [apiTopIpsData, setApiTopIpsData] = useState(null);
  const [apiGeoData, setApiGeoData] = useState(null);
  const [apiTimeData, setApiTimeData] = useState(null);
  const [highFreqData, setHighFreqData] = useState(null);
  const [mismatchData, setMismatchData] = useState(null);
  const [riskData, setRiskData] = useState(null);
  const [newIpsData, setNewIpsData] = useState(null);
  const [userIpSummaryData, setUserIpSummaryData] = useState(null);

  const params = `?start_timestamp=${timeRange.start}&end_timestamp=${timeRange.end}`;

  const fetchApi = useCallback(async (url, setter) => {
    try {
      const res = await API.get(url, { disableDuplicate: true });
      if (res.data.success) {
        setter(res.data.data);
      } else {
        showError(res.data.message || 'Failed to fetch data');
      }
    } catch (e) {
      showError(e.message || 'Request failed');
    }
  }, []);

  const loadOverview = useCallback(() => {
    fetchApi(`${BASE}/overview${params}`, setOverviewData);
  }, [params, fetchApi]);

  const loadLoginAnalysis = useCallback(() => {
    fetchApi(`${BASE}/login/geo${params}`, setLoginGeoData);
    fetchApi(`${BASE}/login/time_pattern${params}`, setLoginTimeData);
    fetchApi(`${BASE}/login/type_detail${params}`, setLoginTypeData);
    fetchApi(`${BASE}/login/multi_account${params}`, setMultiAccountData);
  }, [params, fetchApi]);

  const loadApiAnalysis = useCallback(() => {
    fetchApi(`${BASE}/api/top_ips${params}`, setApiTopIpsData);
    fetchApi(`${BASE}/api/geo${params}`, setApiGeoData);
    fetchApi(`${BASE}/api/time_pattern${params}`, setApiTimeData);
    fetchApi(`${BASE}/api/high_freq${params}`, setHighFreqData);
  }, [params, fetchApi]);

  const loadCrossAnalysis = useCallback(() => {
    fetchApi(`${BASE}/cross/ip_mismatch${params}`, setMismatchData);
    fetchApi(`${BASE}/cross/risk_score${params}`, setRiskData);
    fetchApi(`${BASE}/cross/new_ips${params}`, setNewIpsData);
    fetchApi(`${BASE}/cross/user_ip_summary${params}`, setUserIpSummaryData);
  }, [params, fetchApi]);

  const loadCurrentTab = useCallback(() => {
    setLoading(true);
    switch (activeTab) {
      case 'overview':
        loadOverview();
        break;
      case 'login':
        loadLoginAnalysis();
        break;
      case 'api':
        loadApiAnalysis();
        break;
      case 'cross':
        loadCrossAnalysis();
        break;
    }
    setTimeout(() => setLoading(false), 500);
  }, [activeTab, loadOverview, loadLoginAnalysis, loadApiAnalysis, loadCrossAnalysis]);

  const loadIpModels = useCallback(
    async (ip) => {
      try {
        const res = await API.get(
          `${BASE}/api/ip_models${params}&ip=${encodeURIComponent(ip)}`,
          { disableDuplicate: true },
        );
        if (res.data.success) return res.data.data;
        showError(res.data.message);
        return [];
      } catch (e) {
        showError(e.message);
        return [];
      }
    },
    [params],
  );

  const disableUsersBySharedIp = useCallback(
    async ({
      ip,
      start,
      end,
      min_users,
      dry_run,
      also_ban_ip,
      reason,
    }) => {
      try {
        const res = await API.post(
          `${BASE}/login/multi_account/disable_users?start_timestamp=${start}&end_timestamp=${end}`,
          {
            ip,
            min_users,
            dry_run,
            also_ban_ip,
            reason,
          },
        );
        if (res.data.success) {
          if (!dry_run) {
            showSuccess(res.data.message || '操作成功完成！');
          }
          return res.data.data;
        }
        showError(res.data.message || '操作失败，请重试');
        return null;
      } catch (e) {
        showError(e.message || 'Request failed');
        return null;
      }
    },
    [],
  );

  const updateRefreshInterval = useCallback((val) => {
    const v = Math.max(10, parseInt(val) || DEFAULT_REFRESH_INTERVAL);
    setRefreshInterval(v);
    localStorage.setItem('ip-analysis-refresh-interval', String(v));
  }, []);

  // Auto-refresh
  useEffect(() => {
    loadCurrentTab();
    setCountdown(refreshInterval);

    timerRef.current = setInterval(() => {
      loadCurrentTab();
      setCountdown(refreshInterval);
    }, refreshInterval * 1000);

    countdownRef.current = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : refreshInterval));
    }, 1000);

    return () => {
      clearInterval(timerRef.current);
      clearInterval(countdownRef.current);
    };
  }, [refreshInterval, timeRange, activeTab, loadCurrentTab]);

  return {
    activeTab,
    setActiveTab,
    timeRange,
    setTimeRange,
    refreshInterval,
    updateRefreshInterval,
    loading,
    countdown,
    loadCurrentTab,
    loadIpModels,
    disableUsersBySharedIp,
    overviewData,
    loginGeoData,
    loginTimeData,
    loginTypeData,
    multiAccountData,
    apiTopIpsData,
    apiGeoData,
    apiTimeData,
    highFreqData,
    mismatchData,
    riskData,
    newIpsData,
    userIpSummaryData,
  };
};
