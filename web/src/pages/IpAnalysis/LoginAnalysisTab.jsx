import React from 'react';
import { Card, Table, Spin, Empty, Tag } from '@douyinfe/semi-ui';
import { VChart } from '@visactor/react-vchart';
import { useTranslation } from 'react-i18next';
import { renderNumber, timestamp2string } from '../../helpers';
import IpActionCell from './components/IpActionCell';

const CHART_CONFIG = { mode: 'desktop-browser' };

const LoginAnalysisTab = ({
  loginGeoData,
  loginTimeData,
  loginTypeData,
  multiAccountData,
  loading,
  chartSpecs,
  onBanIp,
  onDisableUsersByIp,
}) => {
  const { t } = useTranslation();

  return (
    <div className='space-y-4'>
      <GeoSection
        t={t}
        data={loginGeoData}
        loading={loading}
        pieSpec={chartSpecs?.loginGeoPieSpec}
        onBanIp={onBanIp}
      />
      <TimeSection
        t={t}
        loading={loading}
        hourlySpec={chartSpecs?.loginHourlyBarSpec}
        dailySpec={chartSpecs?.loginDailyLineSpec}
      />
      <TypeSection
        t={t}
        data={loginTypeData}
        loading={loading}
        pieSpec={chartSpecs?.loginTypePieSpec}
      />
      <MultiAccountSection
        t={t}
        data={multiAccountData}
        loading={loading}
        onBanIp={onBanIp}
        onDisableUsersByIp={onDisableUsersByIp}
      />
    </div>
  );
};

export default LoginAnalysisTab;

/* ========== Sub-components ========== */

const chartCardStyle = {
  background: 'rgba(0,0,0,0.02)',
  border: '1px solid rgba(var(--semi-blue-5), 0.15)',
};

const GeoSection = ({ t, data, loading, pieSpec, onBanIp }) => {
  const columns = [
    { title: t('地理位置'), dataIndex: 'location', key: 'location', width: 200 },
    { title: t('登录次数'), dataIndex: 'count', key: 'count', render: (v) => renderNumber(v), sorter: (a, b) => a.count - b.count },
    { title: t('用户数'), dataIndex: 'users', key: 'users', render: (v) => renderNumber(v) },
    { title: t('最后时间'), dataIndex: 'last_seen', key: 'last_seen', render: (v) => v ? timestamp2string(v) : '-', width: 180 },
  ];

  return (
    <Card className='!rounded-2xl' title={t('登录地理分布')}>
      <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
        <div className='rounded-2xl p-3' style={chartCardStyle}>
          {pieSpec ? (
            <div className='h-72'><VChart spec={pieSpec} option={CHART_CONFIG} /></div>
          ) : (
            <div className='h-72 flex items-center justify-center'><Empty description='' /></div>
          )}
        </div>
        <Table
          columns={columns}
          dataSource={data || []}
          pagination={{ pageSize: 10 }}
          size='small'
          rowKey='location'
          loading={loading}
        />
      </div>
    </Card>
  );
};

const TimeSection = ({ t, loading, hourlySpec, dailySpec }) => (
  <Card className='!rounded-2xl' title={t('登录时间模式')}>
    <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
      <div className='rounded-2xl p-3' style={chartCardStyle}>
        {hourlySpec ? (
          <div className='h-72'><VChart spec={hourlySpec} option={CHART_CONFIG} /></div>
        ) : (
          <div className='h-72 flex items-center justify-center'>
            {loading ? <Spin /> : <Empty description='' />}
          </div>
        )}
      </div>
      <div className='rounded-2xl p-3' style={chartCardStyle}>
        {dailySpec ? (
          <div className='h-72'><VChart spec={dailySpec} option={CHART_CONFIG} /></div>
        ) : (
          <div className='h-72 flex items-center justify-center'>
            {loading ? <Spin /> : <Empty description='' />}
          </div>
        )}
      </div>
    </div>
  </Card>
);

const TypeSection = ({ t, data, loading, pieSpec }) => {
  const columns = [
    { title: t('登录类型'), dataIndex: 'login_type', key: 'login_type', render: (v) => v || 'unknown' },
    { title: t('次数'), dataIndex: 'count', key: 'count', render: (v) => renderNumber(v), sorter: (a, b) => a.count - b.count },
    { title: t('独立IP'), dataIndex: 'distinct_ips', key: 'distinct_ips', render: (v) => renderNumber(v) },
    { title: t('独立用户'), dataIndex: 'distinct_users', key: 'distinct_users', render: (v) => renderNumber(v) },
    { title: t('最后时间'), dataIndex: 'last_seen', key: 'last_seen', render: (v) => v ? timestamp2string(v) : '-', width: 180 },
  ];

  return (
    <Card className='!rounded-2xl' title={t('登录类型细分')}>
      <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
        <div className='rounded-2xl p-3' style={chartCardStyle}>
          {pieSpec ? (
            <div className='h-72'><VChart spec={pieSpec} option={CHART_CONFIG} /></div>
          ) : (
            <div className='h-72 flex items-center justify-center'><Empty description='' /></div>
          )}
        </div>
        <Table
          columns={columns}
          dataSource={data || []}
          pagination={false}
          size='small'
          rowKey='login_type'
          loading={loading}
        />
      </div>
    </Card>
  );
};

const MultiAccountSection = ({ t, data, loading, onBanIp, onDisableUsersByIp }) => {
  const items = data?.items || [];
  const columns = [
    { title: 'IP', dataIndex: 'ip', key: 'ip', width: 150 },
    {
      title: t('用户数'),
      dataIndex: 'user_count',
      key: 'user_count',
      render: (v) => (
        <Tag color={v >= 3 ? 'red' : 'orange'} size='small'>
          {v}
        </Tag>
      ),
      sorter: (a, b) => a.user_count - b.user_count,
    },
    {
      title: t('用户列表'),
      dataIndex: 'users',
      key: 'users',
      render: (v) => <span className='text-xs'>{v || '-'}</span>,
    },
    {
      title: t('登录次数'),
      dataIndex: 'login_count',
      key: 'login_count',
      render: (v) => renderNumber(v),
    },
    {
      title: t('地理位置'),
      dataIndex: 'location',
      key: 'location',
      render: (v) => v || '-',
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
      width: 120,
      render: (_, record) => (
        <IpActionCell
          ip={record.ip}
          isBanned={record.is_banned}
          onBan={onBanIp}
          onDisableUsers={onDisableUsersByIp}
        />
      ),
    },
  ];

  return (
    <Card className='!rounded-2xl' title={t('多账号共用IP检测')}>
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
