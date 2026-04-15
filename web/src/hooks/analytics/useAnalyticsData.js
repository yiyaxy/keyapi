import { useState, useEffect, useCallback, useRef } from 'react';
import { API } from '../../helpers/api';
import { showError } from '../../helpers';

const DEFAULT_REFRESH_INTERVAL = 360; // 6 minutes in seconds

export const useAnalyticsData = () => {
  // Time range: default last 24 hours
  const [timeRange, setTimeRange] = useState(() => {
    const now = Math.floor(Date.now() / 1000);
    return { start: now - 86400, end: now };
  });

  const [refreshInterval, setRefreshInterval] = useState(
    () => parseInt(localStorage.getItem('analytics-refresh-interval')) || DEFAULT_REFRESH_INTERVAL
  );

  const [loading, setLoading] = useState(false);
  const [channelData, setChannelData] = useState(null);
  const [modelData, setModelData] = useState(null);
  const [userData, setUserData] = useState(null);
  const [countdown, setCountdown] = useState(refreshInterval);
  const timerRef = useRef(null);
  const countdownRef = useRef(null);

  const fetchData = useCallback(async (endpoint) => {
    const params = `?start_timestamp=${timeRange.start}&end_timestamp=${timeRange.end}`;
    const res = await API.get(`/api/analytics/${endpoint}${params}`, { disableDuplicate: true });
    if (res.data.success) {
      return res.data.data;
    }
    throw new Error(res.data.message || 'Failed to fetch analytics');
  }, [timeRange]);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    try {
      const [ch, md, us] = await Promise.all([
        fetchData('channel'),
        fetchData('model'),
        fetchData('user'),
      ]);
      setChannelData(ch);
      setModelData(md);
      setUserData(us);
    } catch (e) {
      showError(e.message || 'Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  }, [fetchData]);

  // Save refresh interval to localStorage
  const updateRefreshInterval = useCallback((val) => {
    const v = Math.max(10, parseInt(val) || DEFAULT_REFRESH_INTERVAL);
    setRefreshInterval(v);
    localStorage.setItem('analytics-refresh-interval', String(v));
  }, []);

  // Auto refresh timer
  useEffect(() => {
    loadAllData();
    setCountdown(refreshInterval);

    timerRef.current = setInterval(() => {
      loadAllData();
      setCountdown(refreshInterval);
    }, refreshInterval * 1000);

    countdownRef.current = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : refreshInterval));
    }, 1000);

    return () => {
      clearInterval(timerRef.current);
      clearInterval(countdownRef.current);
    };
  }, [refreshInterval, timeRange, loadAllData]);

  return {
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
  };
};
