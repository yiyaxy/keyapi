import { useState, useEffect, useCallback, useRef } from 'react';
import { API, showError, showSuccess } from '../../helpers';

export const useRebateSettingsData = (t) => {
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get(`/api/user_rebate_setting/?p=${page}&size=10&keyword=${keyword}`);
      if (res.data.success) {
        const pageData = res.data.data;
        setSettings(pageData?.items || []);
        setTotal(pageData?.total || 0);
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError(error.message);
    } finally {
      setLoading(false);
    }
  }, [page, keyword]);

  const saveSetting = useCallback(async (data) => {
    try {
      let res;
      if (data.id > 0) {
        res = await API.put('/api/user_rebate_setting/', data);
      } else {
        res = await API.post('/api/user_rebate_setting/', data);
      }
      if (res.data.success) {
        showSuccess(t('rebateSettings.saveSuccess'));
        await fetchSettings();
        return true;
      } else {
        showError(res.data.message);
        return false;
      }
    } catch (error) {
      showError(error.message);
      return false;
    }
  }, [t, fetchSettings]);

  const deleteSetting = useCallback(async (id) => {
    try {
      const res = await API.delete(`/api/user_rebate_setting/${id}`);
      if (res.data.success) {
        showSuccess(t('rebateSettings.deleteSuccess'));
        await fetchSettings();
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError(error.message);
    }
  }, [t, fetchSettings]);

  const refreshData = useCallback(() => {
    fetchSettings();
  }, [fetchSettings]);

  const searchTimerRef = useRef(null);
  const searchUsers = useCallback((keyword) => {
    return new Promise((resolve) => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(async () => {
        if (!keyword || keyword.trim().length === 0) {
          resolve([]);
          return;
        }
        try {
          const res = await API.get(`/api/user/search?keyword=${encodeURIComponent(keyword)}&page_size=20`);
          if (res.data.success && res.data.data?.items) {
            resolve(
              res.data.data.items.map((u) => ({
                value: u.id,
                label: `${u.username}${u.display_name ? ` (${u.display_name})` : ''} #${u.id}`,
              }))
            );
          } else {
            resolve([]);
          }
        } catch {
          resolve([]);
        }
      }, 300);
    });
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return {
    loading,
    settings,
    page,
    total,
    keyword,
    setPage,
    setKeyword,
    saveSetting,
    deleteSetting,
    refreshData,
    searchUsers,
  };
};
