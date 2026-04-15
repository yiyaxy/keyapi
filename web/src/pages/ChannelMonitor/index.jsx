import { useState, useEffect, useCallback } from 'react';
import { Card, Spin } from '@douyinfe/semi-ui';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API } from '../../helpers';
import ChannelMonitorCard from './ChannelMonitorCard';

function timeAgo(timestamp) {
  if (!timestamp) return '';
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 30) return '刚刚';
  if (diff < 60) return `${Math.floor(diff)}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${Math.floor(diff / 86400)}天前`;
}

export default function ChannelMonitor() {
  const { t } = useTranslation();
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [groups, setGroups] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);

  const fetchData = useCallback(async ({ background = false } = {}) => {
    if (background) {
      setRefreshing(true);
    } else {
      setInitialLoading((prev) => (groups.length === 0 ? true : prev));
      setRefreshing(groups.length > 0);
    }
    try {
      const res = await API.get('/api/analytics/channel-monitor');
      setGroups(res.data?.data?.groups || []);
      setUpdatedAt(res.data?.data?.updated_at || null);
    } catch (e) {
      console.error('Failed to fetch channel monitor data:', e);
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, [groups.length]);

  useEffect(() => {
    fetchData();
    const timer = setInterval(() => fetchData({ background: true }), 30000);
    return () => clearInterval(timer);
  }, [fetchData]);

  return (
    <div className='mt-[60px] px-2 pb-8'>
      <Card
        className='!rounded-2xl mb-4'
        bodyStyle={{ padding: '20px 24px' }}
        style={{ boxShadow: 'none', border: '1px solid var(--semi-color-border)' }}
      >
        <div className='flex items-center justify-between flex-wrap gap-3'>
          <div className='flex items-center gap-3'>
            <RefreshCw
              size={16}
              style={{
                color: 'var(--semi-color-text-2)',
                animation: refreshing ? 'spin 1s linear infinite' : 'none',
              }}
            />
            <span
              className='text-base font-semibold'
              style={{ color: 'var(--semi-color-text-0)' }}
            >
              {t('channelMonitor.title')}
            </span>
          </div>
          <div className='flex items-center gap-4'>
            {updatedAt && (
              <span className='text-xs' style={{ color: 'var(--semi-color-text-2)' }}>
                {t('channelMonitor.lastUpdated')}: {timeAgo(updatedAt)}
              </span>
            )}
            <button
              onClick={() => fetchData({ background: true })}
              disabled={refreshing}
              className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors'
              style={{
                background: 'var(--semi-color-primary)',
                color: '#fff',
                border: 'none',
                cursor: refreshing ? 'not-allowed' : 'pointer',
                opacity: refreshing ? 0.6 : 1,
              }}
            >
              <RefreshCw size={12} />
              {t('channelMonitor.refresh')}
            </button>
          </div>
        </div>
      </Card>

      {initialLoading && groups.length === 0 && (
        <div className='flex items-center justify-center py-20'>
          <Spin size='large' />
        </div>
      )}

      {groups.length > 0 && (
        <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'>
          {groups.map((group) => (
            <ChannelMonitorCard key={group.group_key} group={group} />
          ))}
        </div>
      )}

      {!initialLoading && groups.length === 0 && (
        <Card
          className='!rounded-2xl'
          bodyStyle={{ padding: '40px 24px', textAlign: 'center' }}
          style={{ boxShadow: 'none', border: '1px solid var(--semi-color-border)' }}
        >
          <span className='text-sm' style={{ color: 'var(--semi-color-text-2)' }}>
            {t('channelMonitor.noData')}
          </span>
        </Card>
      )}
    </div>
  );
}
