import { useState, useEffect, useCallback } from 'react';
import { API, showError, showSuccess } from '../../helpers';
import { useTranslation } from 'react-i18next';

export const useAffTransferData = () => {
  const { t } = useTranslation();
  const [userInfo, setUserInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rebateLogs, setRebateLogs] = useState([]);
  const [rebateLogsPage, setRebateLogsPage] = useState(1);
  const [rebateLogsTotal, setRebateLogsTotal] = useState(0);
  const [rebateLogsFilter, setRebateLogsFilter] = useState(0);
  const [pendingQuota, setPendingQuota] = useState(0);

  const refreshUserInfo = useCallback(async () => {
    try {
      const res = await API.get('/api/user/self');
      if (res.data.success) {
        setUserInfo(res.data.data);
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError(error.message);
    }
  }, []);

  const refreshPendingQuota = useCallback(async () => {
    try {
      const res = await API.get('/api/aff_transfer/pending_quota');
      if (res.data.success) {
        setPendingQuota(res.data.data.pending_quota || 0);
      }
    } catch (error) {
      showError(error.message);
    }
  }, []);

  const refreshRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get(`/api/aff_transfer/self?p=${page}&size=10`);
      if (res.data.success) {
        const pageData = res.data.data;
        setRequests(pageData?.items || []);
        setTotal(pageData?.total || 0);
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError(error.message);
    } finally {
      setLoading(false);
    }
  }, [page]);

  const submitRequest = useCallback(async (amount) => {
    try {
      const res = await API.post('/api/aff_transfer/', { quota: amount });
      if (res.data.success) {
        showSuccess(t('affTransfer.requestSuccess'));
        await refreshUserInfo();
        await refreshRequests();
        await refreshPendingQuota();
        return true;
      } else {
        showError(res.data.message);
        return false;
      }
    } catch (error) {
      showError(error.message);
      return false;
    }
  }, [t, refreshUserInfo, refreshRequests, refreshPendingQuota]);

  const refreshRebateLogs = useCallback(async () => {
    try {
      let url = `/api/aff_transfer/rebate_logs?p=${rebateLogsPage}&size=10`;
      if (rebateLogsFilter > 0) {
        url += `&type=${rebateLogsFilter}`;
      }
      const res = await API.get(url);
      if (res.data.success) {
        const pageData = res.data.data;
        setRebateLogs(pageData?.items || []);
        setRebateLogsTotal(pageData?.total || 0);
      }
    } catch (error) {
      showError(error.message);
    }
  }, [rebateLogsPage, rebateLogsFilter]);

  useEffect(() => {
    refreshUserInfo();
    refreshPendingQuota();
  }, [refreshUserInfo, refreshPendingQuota]);

  useEffect(() => {
    refreshRequests();
  }, [refreshRequests]);

  useEffect(() => {
    refreshRebateLogs();
  }, [refreshRebateLogs]);

  return {
    userInfo,
    loading,
    requests,
    page,
    total,
    setPage,
    submitRequest,
    refreshRequests,
    refreshUserInfo,
    rebateLogs,
    rebateLogsPage,
    rebateLogsTotal,
    rebateLogsFilter,
    setRebateLogsPage,
    setRebateLogsFilter,
    refreshRebateLogs,
    pendingQuota,
  };
};
