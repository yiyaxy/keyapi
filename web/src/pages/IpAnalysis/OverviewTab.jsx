import React from 'react';
import { Spin, Empty } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { renderNumber, renderQuota } from '../../helpers';

const OverviewTab = ({ data, loading, onNavigate }) => {
  const { t } = useTranslation();

  if (loading && !data) {
    return (
      <div className='flex justify-center py-12'>
        <Spin size='large' />
      </div>
    );
  }

  if (!data) {
    return <Empty description={t('暂无数据')} />;
  }

  return (
    <div>
      {/* Login dimension cards */}
      <h3 className='text-base font-semibold mb-3 text-gray-600'>
        {t('登录维度')}
      </h3>
      <div className='grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6'>
        {loginCards.map(({ key, gradient }) => (
          <MetricCard
            key={key}
            label={t(cardLabels[key])}
            value={formatValue(key, data)}
            gradient={gradient}
          />
        ))}
      </div>

      {/* API dimension cards */}
      <h3 className='text-base font-semibold mb-3 text-gray-600'>
        {t('API维度')}
      </h3>
      <div className='grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6'>
        {apiCards.map(({ key, gradient }) => (
          <MetricCard
            key={key}
            label={t(cardLabels[key])}
            value={formatValue(key, data)}
            gradient={gradient}
          />
        ))}
      </div>

      {/* Alert cards */}
      <h3 className='text-base font-semibold mb-3 text-gray-600'>
        {t('安全告警')}
      </h3>
      <div className='grid grid-cols-1 lg:grid-cols-3 gap-4'>
        {alertCards.map(({ key, border, tab }) => (
          <AlertCard
            key={key}
            label={t(cardLabels[key])}
            value={renderNumber(data[key] || 0)}
            border={border}
            onClick={() => onNavigate && onNavigate(tab)}
          />
        ))}
      </div>
    </div>
  );
};

export default OverviewTab;

/* ========== Config & Helpers ========== */

const cardLabels = {
  login_records: '总登录记录',
  login_distinct_ips: '登录独立IP',
  login_distinct_users: '登录独立用户',
  today_logins: '今日登录',
  api_call_count: 'API调用总量',
  api_distinct_ips: 'API独立IP',
  api_distinct_users: 'API独立用户',
  api_quota_consumed: 'API消耗额度',
  new_ip_count: '新IP数量',
  multi_account_ips: '多账号共用IP',
  high_freq_ips: '高频IP数',
};

function formatValue(key, data) {
  if (key === 'api_quota_consumed') {
    return renderQuota(data[key] || 0, 2);
  }
  return renderNumber(data[key] || 0);
}

const loginCards = [
  { key: 'login_records', gradient: 'linear-gradient(135deg, #3366FF 0%, #00B8D9 100%)' },
  { key: 'login_distinct_ips', gradient: 'linear-gradient(135deg, #6C5CE7 0%, #A8E6CF 100%)' },
  { key: 'login_distinct_users', gradient: 'linear-gradient(135deg, #FF6B6B 0%, #FFD93D 100%)' },
  { key: 'today_logins', gradient: 'linear-gradient(135deg, #36D399 0%, #00B8D9 100%)' },
];

const apiCards = [
  { key: 'api_call_count', gradient: 'linear-gradient(135deg, #36D399 0%, #2ECC71 100%)' },
  { key: 'api_distinct_ips', gradient: 'linear-gradient(135deg, #F39C12 0%, #E67E22 100%)' },
  { key: 'api_distinct_users', gradient: 'linear-gradient(135deg, #1ABC9C 0%, #16A085 100%)' },
  { key: 'api_quota_consumed', gradient: 'linear-gradient(135deg, #E74C3C 0%, #C0392B 100%)' },
];

const alertCards = [
  { key: 'new_ip_count', border: '2px solid #F39C12', tab: 'cross' },
  { key: 'multi_account_ips', border: '2px solid #E74C3C', tab: 'login' },
  { key: 'high_freq_ips', border: '2px solid #E74C3C', tab: 'api' },
];

/* ========== Sub-components ========== */

const MetricCard = ({ label, value, gradient }) => (
  <div
    className='rounded-2xl p-5 text-white shadow-lg'
    style={{ background: gradient }}
  >
    <div className='text-sm opacity-80 mb-1'>{label}</div>
    <div className='text-2xl font-bold'>{value}</div>
  </div>
);

const AlertCard = ({ label, value, border, onClick }) => (
  <div
    className='rounded-2xl p-5 shadow-sm cursor-pointer hover:shadow-md transition-shadow'
    style={{ border, background: 'rgba(0,0,0,0.02)' }}
    onClick={onClick}
  >
    <div className='text-sm text-gray-500 mb-1'>{label}</div>
    <div className='text-2xl font-bold text-red-600'>{value}</div>
  </div>
);
