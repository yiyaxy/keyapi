import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess } from '../../helpers';

export function useMessageData() {
  const { t } = useTranslation();
  const [messages, setMessages] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const fetchMessages = useCallback(async (p, ps, keyword, type) => {
    setLoading(true);
    try {
      let url = `/api/message/admin?p=${p || page}&page_size=${ps || pageSize}`;
      if (keyword) url += `&keyword=${encodeURIComponent(keyword)}`;
      if (type) url += `&type=${type}`;
      const res = await API.get(url);
      const { success, data } = res.data;
      if (success && data) {
        setMessages(Array.isArray(data.items) ? data.items : []);
        setTotal(Number(data.total) || 0);
      }
    } catch (e) {
      showError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  const createMessage = useCallback(async (msg) => {
    try {
      const res = await API.post('/api/message/admin', msg);
      const { success, message } = res.data;
      if (success) {
        showSuccess(t('消息发送成功'));
        return true;
      } else {
        showError(message);
        return false;
      }
    } catch (e) {
      showError(e.message);
      return false;
    }
  }, []);

  const editMessage = useCallback(async (id, updates) => {
    try {
      const res = await API.put(`/api/message/admin/${id}`, updates);
      const { success, message } = res.data;
      if (success) {
        showSuccess(t('消息编辑成功'));
        return true;
      } else {
        showError(message);
        return false;
      }
    } catch (e) {
      showError(e.message);
      return false;
    }
  }, []);

  const recallMessage = useCallback(async (id) => {
    try {
      const res = await API.delete(`/api/message/admin/${id}`);
      const { success, message } = res.data;
      if (success) {
        showSuccess(t('消息撤回成功'));
        return true;
      } else {
        showError(message);
        return false;
      }
    } catch (e) {
      showError(e.message);
      return false;
    }
  }, []);

  const fetchReadStatus = useCallback(async (id, p = 1, ps = 10) => {
    try {
      const res = await API.get(`/api/message/admin/${id}/read_status?p=${p}&page_size=${ps}`);
      const { success, data } = res.data;
      if (success) return data;
      return null;
    } catch (e) {
      showError(e.message);
      return null;
    }
  }, []);

  return {
    messages, total, loading,
    page, setPage, pageSize, setPageSize,
    fetchMessages, createMessage, editMessage,
    recallMessage, fetchReadStatus,
  };
}
