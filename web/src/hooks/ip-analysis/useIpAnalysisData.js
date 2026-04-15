import { useState, useEffect, useCallback, useRef } from 'react';
import { API } from '../../helpers/api';
import { showError } from '../../helpers';

const DEFAULT_REFRESH_INTERVAL = 360;

export const useIpAnalysisData = () => {
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
  const [data, setData] = useState(null);
  const [countdown, setCountdown] = useState(refreshInterval);
  const timerRef = useRef(null);
  const countdownRef = useRef(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = `?start_timestamp=${timeRange.start}&end_timestamp=${timeRange.end}`;
      const res = await API.get(`/api/ip/analytics${params}`, {
        disableDuplicate: true,
      });
      if (res.data.success) {
        setData(res.data.data);
      } else {
        showError(res.data.message || 'Failed to fetch IP analytics');
      }
    } catch (e) {
      showError(e.message || 'Failed to load IP analytics data');
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  const updateRefreshInterval = useCallback((val) => {
    const v = Math.max(10, parseInt(val) || DEFAULT_REFRESH_INTERVAL);
    setRefreshInterval(v);
    localStorage.setItem('ip-analysis-refresh-interval', String(v));
  }, []);

  useEffect(() => {
    loadData();
    setCountdown(refreshInterval);

    timerRef.current = setInterval(() => {
      loadData();
      setCountdown(refreshInterval);
    }, refreshInterval * 1000);

    countdownRef.current = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : refreshInterval));
    }, 1000);

    return () => {
      clearInterval(timerRef.current);
      clearInterval(countdownRef.current);
    };
  }, [refreshInterval, timeRange, loadData]);

  return {
    timeRange,
    setTimeRange,
    refreshInterval,
    updateRefreshInterval,
    loading,
    data,
    countdown,
    loadData,
  };
};
