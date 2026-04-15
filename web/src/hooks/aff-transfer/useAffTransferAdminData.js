import { useState, useEffect, useCallback } from 'react';
import { API, showError, showSuccess } from '../../helpers';

export const useAffTransferAdminData = (t) => {
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState([]);
  const [stats, setStats] = useState({ pending_count: 0, approved_count: 0, approved_total_quota: 0 });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get(`/api/aff_transfer/?p=${page}&size=10&keyword=${keyword}&status=${status}`);
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
  }, [page, keyword, status]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await API.get('/api/aff_transfer/stats');
      if (res.data.success) {
        setStats(res.data.data);
      }
    } catch (error) {
      showError(error.message);
    }
  }, []);

  const processRequest = useCallback(async (id, newStatus, adminRemark) => {
    try {
      const action = newStatus === 2 ? 'approve' : 'reject';
      const res = await API.post('/api/aff_transfer/process', {
        id,
        action,
        remark: adminRemark,
      });
      if (res.data.success) {
        showSuccess(t('affTransfer.processSuccess'));
        await Promise.all([fetchRequests(), fetchStats()]);
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError(error.message);
    }
  }, [t, fetchRequests, fetchStats]);

  const refreshData = useCallback(() => {
    fetchRequests();
    fetchStats();
  }, [fetchRequests, fetchStats]);

  const batchApproveAll = useCallback(async (adminRemark) => {
    try {
      const res = await API.post('/api/aff_transfer/batch_approve', {
        remark: adminRemark,
      });
      if (res.data.success) {
        const count = res.data.data?.approved_count || 0;
        showSuccess(t('affTransfer.batchApproveSuccess', { count }));
        await Promise.all([fetchRequests(), fetchStats()]);
        return true;
      } else {
        showError(res.data.message);
        return false;
      }
    } catch (error) {
      showError(error.message);
      return false;
    }
  }, [t, fetchRequests, fetchStats]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return {
    loading,
    requests,
    stats,
    page,
    total,
    keyword,
    status,
    setPage,
    setKeyword,
    setStatus,
    processRequest,
    refreshData,
    batchApproveAll,
  };
};
