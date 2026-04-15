import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { API } from '../../helpers/api';
import { showError, showSuccess } from '../../helpers';

export const usePurchaseData = () => {
  const { t } = useTranslation();

  // Tab state
  const [activeTab, setActiveTab] = useState('topup');

  // TopUp tab state
  const [topupData, setTopupData] = useState([]);
  const [topupPage, setTopupPage] = useState(1);
  const [topupPageSize, setTopupPageSize] = useState(10);
  const [topupTotal, setTopupTotal] = useState(0);

  // Subscription tab state
  const [subData, setSubData] = useState([]);
  const [subPage, setSubPage] = useState(1);
  const [subPageSize, setSubPageSize] = useState(10);
  const [subTotal, setSubTotal] = useState(0);

  // Shared filter state
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);

  // Fetch topup orders
  const loadTopupOrders = useCallback(
    async (page, pageSize) => {
      setLoading(true);
      try {
        let qs = `p=${page}&page_size=${pageSize}`;
        if (keyword) qs += `&keyword=${encodeURIComponent(keyword)}`;
        if (statusFilter) qs += `&status=${encodeURIComponent(statusFilter)}`;
        const res = await API.get(`/api/purchase/topup?${qs}`);
        const { success, message, data } = res.data;
        if (success) {
          setTopupData(data?.items || []);
          setTopupTotal(data?.total || 0);
        } else {
          showError(message);
        }
      } catch (error) {
        showError(error.message || t('加载失败'));
      } finally {
        setLoading(false);
      }
    },
    [keyword, statusFilter, t],
  );

  // Fetch subscription orders
  const loadSubOrders = useCallback(
    async (page, pageSize) => {
      setLoading(true);
      try {
        let qs = `p=${page}&page_size=${pageSize}`;
        if (keyword) qs += `&keyword=${encodeURIComponent(keyword)}`;
        if (statusFilter) qs += `&status=${encodeURIComponent(statusFilter)}`;
        const res = await API.get(`/api/purchase/subscription?${qs}`);
        const { success, message, data } = res.data;
        if (success) {
          setSubData(data?.items || []);
          setSubTotal(data?.total || 0);
        } else {
          showError(message);
        }
      } catch (error) {
        showError(error.message || t('加载失败'));
      } finally {
        setLoading(false);
      }
    },
    [keyword, statusFilter, t],
  );

  // Refresh current tab
  const refresh = useCallback(() => {
    if (activeTab === 'topup') {
      loadTopupOrders(topupPage, topupPageSize);
    } else {
      loadSubOrders(subPage, subPageSize);
    }
  }, [
    activeTab,
    topupPage,
    topupPageSize,
    subPage,
    subPageSize,
    loadTopupOrders,
    loadSubOrders,
  ]);

  // Load on mount and when page/pageSize/tab changes
  useEffect(() => {
    if (activeTab === 'topup') {
      loadTopupOrders(topupPage, topupPageSize);
    } else {
      loadSubOrders(subPage, subPageSize);
    }
  }, [activeTab, topupPage, topupPageSize, subPage, subPageSize, loadTopupOrders, loadSubOrders]);

  // Tab change handler
  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
    setKeyword('');
    setStatusFilter('');
  }, []);

  // Pagination handlers
  const handleTopupPageChange = useCallback((page) => setTopupPage(page), []);
  const handleTopupPageSizeChange = useCallback((size) => {
    setTopupPageSize(size);
    setTopupPage(1);
  }, []);
  const handleSubPageChange = useCallback((page) => setSubPage(page), []);
  const handleSubPageSizeChange = useCallback((size) => {
    setSubPageSize(size);
    setSubPage(1);
  }, []);

  // Actions
  const completeTopup = useCallback(
    async (tradeNo) => {
      try {
        const res = await API.post('/api/purchase/topup/complete', {
          trade_no: tradeNo,
        });
        const { success, message } = res.data;
        if (success) {
          showSuccess(t('补单成功'));
          refresh();
        } else {
          showError(message);
        }
      } catch (error) {
        showError(error.message || t('操作失败'));
      }
    },
    [refresh, t],
  );

  const expireTopup = useCallback(
    async (tradeNo) => {
      try {
        const res = await API.post('/api/purchase/topup/expire', {
          trade_no: tradeNo,
        });
        const { success, message } = res.data;
        if (success) {
          showSuccess(t('标记过期成功'));
          refresh();
        } else {
          showError(message);
        }
      } catch (error) {
        showError(error.message || t('操作失败'));
      }
    },
    [refresh, t],
  );

  const deleteTopup = useCallback(
    async (tradeNo) => {
      try {
        const res = await API.post('/api/purchase/topup/delete', {
          trade_no: tradeNo,
        });
        const { success, message } = res.data;
        if (success) {
          showSuccess(t('删除成功'));
          refresh();
        } else {
          showError(message);
        }
      } catch (error) {
        showError(error.message || t('操作失败'));
      }
    },
    [refresh, t],
  );

  const completeSub = useCallback(
    async (tradeNo) => {
      try {
        const res = await API.post('/api/purchase/subscription/complete', {
          trade_no: tradeNo,
        });
        const { success, message } = res.data;
        if (success) {
          showSuccess(t('补单成功'));
          refresh();
        } else {
          showError(message);
        }
      } catch (error) {
        showError(error.message || t('操作失败'));
      }
    },
    [refresh, t],
  );

  const expireSub = useCallback(
    async (tradeNo) => {
      try {
        const res = await API.post('/api/purchase/subscription/expire', {
          trade_no: tradeNo,
        });
        const { success, message } = res.data;
        if (success) {
          showSuccess(t('标记过期成功'));
          refresh();
        } else {
          showError(message);
        }
      } catch (error) {
        showError(error.message || t('操作失败'));
      }
    },
    [refresh, t],
  );

  const deleteSub = useCallback(
    async (tradeNo) => {
      try {
        const res = await API.post('/api/purchase/subscription/delete', {
          trade_no: tradeNo,
        });
        const { success, message } = res.data;
        if (success) {
          showSuccess(t('删除成功'));
          refresh();
        } else {
          showError(message);
        }
      } catch (error) {
        showError(error.message || t('操作失败'));
      }
    },
    [refresh, t],
  );

  return {
    t,
    activeTab,
    handleTabChange,

    // TopUp
    topupData,
    topupPage,
    topupPageSize,
    topupTotal,
    handleTopupPageChange,
    handleTopupPageSizeChange,

    // Subscription
    subData,
    subPage,
    subPageSize,
    subTotal,
    handleSubPageChange,
    handleSubPageSizeChange,

    // Shared
    keyword,
    setKeyword,
    statusFilter,
    setStatusFilter,
    loading,
    refresh,

    // Actions
    completeTopup,
    expireTopup,
    deleteTopup,
    completeSub,
    expireSub,
    deleteSub,
  };
};
