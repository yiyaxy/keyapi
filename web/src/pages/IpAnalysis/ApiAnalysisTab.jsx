import React, { useState } from 'react';
import { Card, Table, Spin, Empty, Tag, Button } from '@douyinfe/semi-ui';
import { VChart } from '@visactor/react-vchart';
import { useTranslation } from 'react-i18next';
import { renderNumber, renderQuota, timestamp2string } from '../../helpers';
import IpActionCell from './components/IpActionCell';
import IpModelDetailModal from './components/IpModelDetailModal';

const CHART_CONFIG = { mode: 'desktop-browser' };
const chartCardStyle = {
  background: 'rgba(0,0,0,0.02)',
  border: '1px solid rgba(var(--semi-blue-5), 0.15)',
};

const ApiAnalysisTab = ({
  apiTopIpsData,
  apiGeoData,
  apiTimeData,
  highFreqData,
  loading,
  onBanIp,
  loadIpModels,
}) => {
  const { t } = useTranslation();
  const [modelModalIp, setModelModalIp] = useState(null);

  return (
    <div className='space-y-4'>
      <TopIpsSection
        t={t}
        data={apiTopIpsData}
        loading={loading}
        onBanIp={onBanIp}
        onViewModels={setModelModalIp}
      />
      <ApiGeoSection t={t} data={apiGeoData} loading={loading} />
      <ApiTimeSection t={t} data={apiTimeData} loading={loading} />
      <HighFreqSection
        t={t}
        data={highFreqData}
        loading={loading}
        onBanIp={onBanIp}
        onViewModels={setModelModalIp}
      />
      <IpModelDetailModal
        visible={!!modelModalIp}
        ip={modelModalIp}
        onClose={() => setModelModalIp(null)}
        loadIpModels={loadIpModels}
      />
    </div>
  );
};

export default ApiAnalysisTab;

/* ========== Sub-components ========== */

const TopIpsSection = ({ t, data, loading, onBanIp, onViewModels }) => {
  const items = data?.items || [];
  const columns = [
    { title: 'IP', dataIndex: 'ip', key: 'ip', width: 140 },
    {
      title: t('调用次数'),
      dataIndex: 'call_count',
      key: 'call_count',
      render: (v) => renderNumber(v),
      sorter: (a, b) => a.call_count - b.call_count,
    },
    {
      title: t('消耗额度'),
      dataIndex: 'quota',
      key: 'quota',
      render: (v) => renderQuota(v, 6),
    },
    {
      title: t('用户数'),
      dataIndex: 'users',
      key: 'users',
      render: (v) => renderNumber(v),
    },
    {
      title: t('模型数'),
      dataIndex: 'models',
      key: 'models',
      render: (v) => renderNumber(v),
    },
    {
      title: t('最常用模型'),
      dataIndex: 'top_model',
      key: 'top_model',
      render: (v) => v || '-',
    },
    {
      title: t('地理位置'),
      dataIndex: 'location',
      key: 'location',
      render: (v) => v || '-',
      width: 120,
    },
    {
      title: t('操作'),
      key: 'action',
      width: 180,
      render: (_, record) => (
        <div className='flex gap-1'>
          <IpActionCell
            ip={record.ip}
            isBanned={record.is_banned}
            onBan={onBanIp}
          />
          <Button
            size='small'
            theme='borderless'
            onClick={() => onViewModels(record.ip)}
          >
            {t('模型详情')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card className='!rounded-2xl' title={t('API调用Top IP排行')}>
      <Table
        columns={columns}
        dataSource={items}
        pagination={{ pageSize: 10 }}
        size='small'
        rowKey='ip'
        loading={loading}
        empty={<Empty description={t('暂无数据')} />}
      />
    </Card>
  );
};

const ApiGeoSection = ({ t, data, loading }) => {
  const items = data || [];
  const columns = [
    { title: t('地理位置'), dataIndex: 'location', key: 'location' },
    {
      title: t('调用次数'),
      dataIndex: 'call_count',
      key: 'call_count',
      render: (v) => renderNumber(v),
      sorter: (a, b) => a.call_count - b.call_count,
    },
    {
      title: t('消耗额度'),
      dataIndex: 'quota',
      key: 'quota',
      render: (v) => renderQuota(v, 6),
    },
    {
      title: t('用户数'),
      dataIndex: 'users',
      key: 'users',
      render: (v) => renderNumber(v),
    },
  ];

  return (
    <Card className='!rounded-2xl' title={t('API调用地理分布')}>
      <Table
        columns={columns}
        dataSource={items}
        pagination={{ pageSize: 10 }}
        size='small'
        rowKey='location'
        loading={loading}
        empty={<Empty description={t('暂无数据')} />}
      />
    </Card>
  );
};

const ApiTimeSection = ({ t, data, loading }) => {
  const hourlySpec =
    data?.hourly_dist?.length > 0
      ? {
          type: 'bar',
          data: [
            {
              id: 'apiHourly',
              values: data.hourly_dist.map((d) => ({
                hour: `${d.hour}:00`,
                count: d.count,
              })),
            },
          ],
          xField: 'hour',
          yField: 'count',
          title: { visible: true, text: t('API调用时间分布(24h)') },
          legends: { visible: false },
          bar: {
            style: { cornerRadius: [4, 4, 0, 0], fill: '#36D399' },
          },
          tooltip: {
            mark: {
              content: [
                {
                  key: (d) => d.hour,
                  value: (d) => renderNumber(d.count),
                },
              ],
            },
          },
        }
      : null;

  return (
    <Card className='!rounded-2xl' title={t('API调用时间模式')}>
      <div className='rounded-2xl p-3' style={chartCardStyle}>
        {hourlySpec ? (
          <div className='h-72'>
            <VChart spec={hourlySpec} option={CHART_CONFIG} />
          </div>
        ) : (
          <div className='h-72 flex items-center justify-center'>
            {loading ? <Spin /> : <Empty description='' />}
          </div>
        )}
      </div>
    </Card>
  );
};

const HighFreqSection = ({ t, data, loading, onBanIp, onViewModels }) => {
  const items = data?.items || [];
  const columns = [
    { title: 'IP', dataIndex: 'ip', key: 'ip', width: 140 },
    {
      title: t('总调用'),
      dataIndex: 'call_count',
      key: 'call_count',
      render: (v) => renderNumber(v),
      sorter: (a, b) => a.call_count - b.call_count,
    },
    {
      title: t('调用/分钟'),
      dataIndex: 'calls_per_min',
      key: 'calls_per_min',
      render: (v) => (v ? v.toFixed(2) : '0'),
    },
    {
      title: t('消耗额度'),
      dataIndex: 'quota',
      key: 'quota',
      render: (v) => renderQuota(v, 6),
    },
    {
      title: t('用户数'),
      dataIndex: 'users',
      key: 'users',
      render: (v) => renderNumber(v),
    },
    {
      title: t('峰值小时'),
      dataIndex: 'peak_hour',
      key: 'peak_hour',
      render: (v, r) => `${v}:00 (${renderNumber(r.peak_count)})`,
    },
    {
      title: t('地理位置'),
      dataIndex: 'location',
      key: 'location',
      render: (v) => v || '-',
      width: 120,
    },
    {
      title: t('状态'),
      dataIndex: 'is_banned',
      key: 'is_banned',
      render: (v) =>
        v ? (
          <Tag color='red' size='small'>{t('已封禁')}</Tag>
        ) : (
          <Tag color='green' size='small'>{t('正常')}</Tag>
        ),
    },
    {
      title: t('操作'),
      key: 'action',
      width: 180,
      render: (_, record) => (
        <div className='flex gap-1'>
          <IpActionCell
            ip={record.ip}
            isBanned={record.is_banned}
            onBan={onBanIp}
            banReason={t('高频调用')}
          />
          <Button
            size='small'
            theme='borderless'
            onClick={() => onViewModels(record.ip)}
          >
            {t('模型详情')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card className='!rounded-2xl' title={t('高频IP检测')}>
      <Table
        columns={columns}
        dataSource={items}
        pagination={{ pageSize: 10 }}
        size='small'
        rowKey='ip'
        loading={loading}
        empty={<Empty description={t('暂无数据')} />}
      />
    </Card>
  );
};
