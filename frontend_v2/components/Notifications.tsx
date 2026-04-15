import React, { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { API } from '../lib/api';
import { useTranslation } from '../lib/i18n';

interface InboxMessage {
  id: number;
  title: string;
  content: string;
  type: number;
  target_user_id: number;
  sender_id: number;
  status: number;
  created_at: number;
  updated_at: number;
  is_read: boolean;
  read_at: number;
}

interface MessageDetail {
  id: number;
  title: string;
  content: string;
  type: number;
  is_read: boolean;
  read_at: number;
  created_at: number;
}

function formatRelativeTime(unixSeconds: number, t: (key: string) => string): string {
  const diff = Date.now() - unixSeconds * 1000;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return t('notif.just_now');
  if (minutes < 60) return `${minutes}${t('notif.minutes_ago')}`;
  if (hours < 24) return hours === 1 ? `1${t('notif.hours_ago')}` : `${hours}${t('notif.hours_ago')}`;
  return days === 1 ? `1${t('notif.days_ago')}` : `${days}${t('notif.days_ago')}`;
}

function formatReadAt(unixSeconds: number): string {
  if (!unixSeconds) return '';
  return new Date(unixSeconds * 1000).toLocaleString();
}

const Notifications: React.FC = () => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailCache, setDetailCache] = useState<Record<number, MessageDetail>>({});
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchMessages = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await API.get('/api/message/inbox', {
        params: { p: 1, size: 50 },
      });
      if (response.data.success && response.data.data?.items) {
        setMessages(response.data.data.items);
      } else {
        setMessages([]);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || t('notif.load_failed'));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await API.get('/api/message/unread_count');
      if (response.data.success) {
        setUnreadCount(response.data.data?.count || 0);
      }
    } catch (err) {
      console.error('Failed to fetch unread count:', err);
    }
  }, []);

  useEffect(() => {
    fetchMessages();
    fetchUnreadCount();
  }, [fetchMessages, fetchUnreadCount]);

  const handleToggleExpand = async (id: number) => {
    // Collapse if already expanded
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }

    setExpandedId(id);

    // Fetch detail if not cached
    if (!detailCache[id]) {
      try {
        setDetailLoading(true);
        const response = await API.get(`/api/message/inbox/${id}`, {
          disableDuplicate: true,
        } as any);
        if (response.data.success && response.data.data) {
          const detail: MessageDetail = response.data.data;
          setDetailCache((prev) => ({ ...prev, [id]: detail }));
          // The GET detail endpoint auto-marks as read on backend
          setMessages((prev) =>
            prev.map((m) => (m.id === id ? { ...m, is_read: true } : m))
          );
          setUnreadCount((prev) => {
            const msg = messages.find((m) => m.id === id);
            return msg && !msg.is_read ? Math.max(0, prev - 1) : prev;
          });
        }
      } catch (err) {
        console.error('Failed to fetch message detail:', err);
      } finally {
        setDetailLoading(false);
      }
    } else {
      // Already cached, still mark read locally if needed
      const msg = messages.find((m) => m.id === id);
      if (msg && !msg.is_read) {
        try {
          await API.post(`/api/message/inbox/${id}/read`);
          setMessages((prev) =>
            prev.map((m) => (m.id === id ? { ...m, is_read: true } : m))
          );
          setUnreadCount((prev) => Math.max(0, prev - 1));
        } catch (err) {
          console.error('Failed to mark as read:', err);
        }
      }
    }
  };

  const markAllRead = async () => {
    try {
      const unread = messages.filter((m) => !m.is_read);
      await Promise.all(
        unread.map((m) => API.post(`/api/message/inbox/${m.id}/read`))
      );
      setMessages((prev) => prev.map((m) => ({ ...m, is_read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    }
  };

  const filtered =
    filter === 'all' ? messages : messages.filter((m) => !m.is_read);

  // --- Loading state ---
  if (loading) {
    return (
      <div className="p-6 md:p-10 max-w-4xl mx-auto">
        <div className="text-center py-12 text-slate-400">
          <span className="material-symbols-outlined text-4xl mb-2 opacity-50 animate-spin">
            refresh
          </span>
          <p>{t('notif.loading')}</p>
        </div>
      </div>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <div className="p-6 md:p-10 max-w-4xl mx-auto">
        <div className="text-center py-12 text-red-500">
          <span className="material-symbols-outlined text-4xl mb-2">error</span>
          <p>{error}</p>
          <button
            onClick={fetchMessages}
            className="mt-4 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover"
          >
            {t('notif.retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-3">
            {t('notif.title')}
            {unreadCount > 0 && (
              <span className="text-sm font-bold bg-primary text-white px-2 py-0.5 rounded-full shadow-sm">
                {unreadCount}
              </span>
            )}
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">
            {t('notif.subtitle')}
          </p>
        </div>
        <div className="flex gap-3">
          <div className="bg-slate-100 dark:bg-dark-surface p-1 rounded-lg inline-flex">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                filter === 'all'
                  ? 'bg-white dark:bg-[#2d384e] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {t('notif.all')}
            </button>
            <button
              onClick={() => setFilter('unread')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                filter === 'unread'
                  ? 'bg-white dark:bg-[#2d384e] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {t('notif.unread')}
            </button>
          </div>
          <button
            onClick={markAllRead}
            disabled={messages.every((m) => m.is_read)}
            className="px-4 py-2 bg-white dark:bg-dark-surface border border-slate-200 dark:border-dark-border text-slate-600 dark:text-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-[#1c2536] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('notif.mark_all')}
          </button>
        </div>
      </div>

      {/* List */}
      <div className="space-y-1">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <span className="material-symbols-outlined text-4xl mb-2 opacity-50">
              notifications_off
            </span>
            <p>{t('notif.empty')}</p>
          </div>
        ) : (
          filtered.map((msg) => {
            const isExpanded = expandedId === msg.id;
            const detail = detailCache[msg.id];

            return (
              <div key={msg.id} className="rounded-xl overflow-hidden">
                {/* Collapsed row — single line */}
                <div
                  onClick={() => handleToggleExpand(msg.id)}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none transition-colors rounded-xl ${
                    isExpanded
                      ? 'bg-slate-100 dark:bg-dark-surface'
                      : 'hover:bg-slate-50 dark:hover:bg-dark-surface/50'
                  } ${!msg.is_read ? '' : 'opacity-70 hover:opacity-100'}`}
                >
                  {/* Unread dot */}
                  <div className="w-2 shrink-0">
                    {!msg.is_read && (
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </div>

                  {/* Title — single line */}
                  <span
                    className={`flex-1 truncate text-sm ${
                      msg.is_read
                        ? 'text-slate-600 dark:text-slate-400 font-normal'
                        : 'text-slate-900 dark:text-white font-semibold'
                    }`}
                  >
                    {msg.title}
                  </span>

                  {/* Timestamp */}
                  <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap ml-4 shrink-0">
                    {formatRelativeTime(msg.created_at, t)}
                  </span>

                  {/* Chevron */}
                  <span
                    className={`material-symbols-outlined text-[18px] text-slate-400 transition-transform duration-200 shrink-0 ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                  >
                    expand_more
                  </span>
                </div>

                {/* Expanded detail area */}
                {isExpanded && (
                  <div className="mx-4 mb-3 mt-1 p-4 rounded-lg bg-slate-50 dark:bg-dark-surface border border-slate-200 dark:border-dark-border transition-all duration-200">
                    {detailLoading && !detail ? (
                      <div className="flex items-center gap-2 text-slate-400 text-sm py-2">
                        <span className="material-symbols-outlined text-[16px] animate-spin">
                          refresh
                        </span>
                        {t('notif.loading_detail')}
                      </div>
                    ) : (
                      <>
                        <div className="prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-slate-300 prose-headings:text-slate-900 dark:prose-headings:text-white prose-code:bg-slate-200 dark:prose-code:bg-slate-700 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-slate-200 dark:prose-pre:bg-slate-800 prose-pre:rounded-lg">
                          <ReactMarkdown>
                            {detail?.content || msg.content || ''}
                          </ReactMarkdown>
                        </div>
                        {detail?.read_at ? (
                          <p className="mt-3 pt-3 border-t border-slate-200 dark:border-dark-border text-xs text-slate-400">
                            {t('notif.read_at')} {formatReadAt(detail.read_at)}
                          </p>
                        ) : null}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default Notifications;
