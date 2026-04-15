import { useState, useCallback } from 'react';
import { API, showError } from '../../helpers';

export function useInboxData() {
  const [messages, setMessages] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const fetchInbox = useCallback(async (p, ps, lang) => {
    setLoading(true);
    try {
      let url = `/api/message/inbox?p=${p || 1}&page_size=${ps || 10}`;
      if (lang && lang !== 'zh') url += `&lang=${lang}`;
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
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await API.get('/api/message/unread_count');
      const { success, data } = res.data;
      if (success) {
        setUnreadCount(data.count || 0);
      }
    } catch (e) {
      // silent fail
    }
  }, []);

  const fetchMessage = useCallback(async (id, lang) => {
    try {
      const url = lang ? `/api/message/inbox/${id}?lang=${lang}` : `/api/message/inbox/${id}`;
      const res = await API.get(url);
      const { success, data } = res.data;
      if (success) return data;
      return null;
    } catch (e) {
      showError(e.message);
      return null;
    }
  }, []);

  const markAsRead = useCallback(async (id) => {
    try {
      await API.post(`/api/message/inbox/${id}/read`);
    } catch (e) {
      // silent fail
    }
  }, []);

  return {
    messages, total, loading,
    unreadCount, page, setPage,
    pageSize, setPageSize,
    fetchInbox, fetchUnreadCount,
    fetchMessage, markAsRead,
  };
}
