import React from 'react';
import { Card, Table, Tag, Empty } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { renderNumber, timestamp2string } from '../../helpers';
import IpActionCell from './components/IpActionCell';
import RiskScoreBadge from './components/RiskScoreBadge';

const CrossAnalysisTab = ({
  mismatchData,
  riskData,
  newIpsData,
  userIpSummaryData,
  loading,
  onBanIp,
}) => {
  const { t } = useTranslation();

  return (
    <div className='space-y-4'>
      <UserIpSummarySection t={t} data={userIpSummaryData} loading={loading} />
      <MismatchSection t={t} data={mismatchData} loading={loading} />
      <RiskSection
        t={t}
        data={riskData}
        loading={loading}
        onBanIp={onBanIp}
      />
      <NewIpsSection
        t={t}
        data={newIpsData}
        loading={loading}
        onBanIp={onBanIp}
      />
    </div>
  );
};

export default CrossAnalysisTab;

/* ========== Sub-components ========== */

const UserIpSummarySection = ({ t, data, loading }) => {
  const items = data?.items || [];
  const columns = [
    {
      title: t('用户名'),
      dataIndex: 'username',
      key: 'username',
      width: 120,
    },
    {
      title: t('登录IP数'),
      dataIndex: 'login_ip_count',
      key: 'login_ip_count',
      render: (v) => renderNumber(v),
      sorter: (a, b) => a.login_ip_count - b.login_ip_count,
    },
    {
      title: t('API IP数'),
      dataIndex: 'api_ip_count',
      key: 'api_ip_count',
      render: (v) => renderNumber(v),
      sorter: (a, b) => a.api_ip_count - b.api_ip_count,
    },
    {
      title: t('总IP数'),
      dataIndex: 'total_ip_count',
      key: 'total_ip_count',
      render: (v) => (
        <Tag
          color={v >= 5 ? 'red' : v >= 3 ? 'orange' : 'green'}
          size='small'
        >
          {v}
        </Tag>
      ),
      sorter: (a, b) => a.total_ip_count - b.total_ip_count,
      defaultSortOrder: 'descend',
    },
    {
      title: t('登录IP列表'),
      dataIndex: 'login_ips',
      key: 'login_ips',
      render: (v) => (
        <span className='text-xs break-all'>{v || '-'}</span>
      ),
    },
    {
      title: t('API IP列表'),
      dataIndex: 'api_ips',
      key: 'api_ips',
      render: (v) => (
        <span className='text-xs break-all'>{v || '-'}</span>
      ),
    },
    {
      title: t('状态'),
      dataIndex: 'is_banned',
      key: 'is_banned',
      render: (v) =>
        v ? (
          <Tag color='red' size='small'>
            {t('已禁用')}
          </Tag>
        ) : (
          <Tag color='green' size='small'>
            {t('正常')}
          </Tag>
        ),
      width: 80,
    },
  ];

  return (
    <Card className='!rounded-2xl' title={t('用户IP汇总')}>
      <Table
        columns={columns}
        dataSource={items}
        pagination={{ pageSize: 10 }}
        size='small'
        rowKey='user_id'
        loading={loading}
        empty={<Empty description={t('暂无数据')} />}
      />
    </Card>
  );
};

const MismatchSection = ({ t, data, loading }) => {
  const items = data?.items || [];
  const columns = [
    {
      title: t('用户名'),
      dataIndex: 'username',
      key: 'username',
      width: 120,
    },
    {
      title: t('登录IP数'),
      dataIndex: 'login_ip_count',
      key: 'login_ip_count',
      render: (v) => renderNumber(v),
    },
    {
      title: t('API IP数'),
      dataIndex: 'api_ip_count',
      key: 'api_ip_count',
      render: (v) => renderNumber(v),
    },
    {
      title: t('不匹配数'),
      dataIndex: 'mismatch_count',
      key: 'mismatch_count',
      render: (v) => (
        <Tag color={v > 0 ? 'red' : 'green'} size='small'>
          {v}
        </Tag>
      ),
      sorter: (a, b) => a.mismatch_count - b.mismatch_count,
    },
    {
      title: t('登录IP列表'),
      dataIndex: 'login_ips',
      key: 'login_ips',
      render: (v) => (
        <span className='text-xs break-all'>{v || '-'}</span>
      ),
    },
    {
      title: t('API专用IP'),
      dataIndex: 'api_ips',
      key: 'api_ips',
      render: (v) => (
        <span className='text-xs break-all text-red-500'>
          {v || '-'}
        </span>
      ),
    },
  ];

  return (
    <Card className='!rounded-2xl' title={t('IP不匹配检测')}>
      <Table
        columns={columns}
        dataSource={items}
        pagination={{ pageSize: 10 }}
        size='small'
        rowKey='user_id'
        loading={loading}
        empty={<Empty description={t('暂无数据')} />}
      />
    </Card>
  );
};

const RiskSection = ({ t, data, loading, onBanIp }) => {
  const items = data?.items || [];
  const columns = [
    { title: 'IP', dataIndex: 'ip', key: 'ip', width: 140 },
    {
      title: t('风险评分'),
      dataIndex: 'risk_score',
      key: 'risk_score',
      render: (v) => <RiskScoreBadge score={v} />,
      sorter: (a, b) => a.risk_score - b.risk_score,
    },
    {
      title: t('风险因素'),
      dataIndex: 'risk_factors',
      key: 'risk_factors',
      render: (v) =>
        (v || []).map((f, i) => (
          <Tag key={i} size='small' color='orange' style={{ marginRight: 4 }}>
            {f}
          </Tag>
        )),
    },
    {
      title: t('用户数'),
      dataIndex: 'user_count',
      key: 'user_count',
      render: (v) => renderNumber(v),
    },
    {
      title: t('API调用'),
      dataIndex: 'api_call_count',
      key: 'api_call_count',
      render: (v) => renderNumber(v),
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
      width: 120,
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
        />
      ),
    },
  ];

  return (
    <Card className='!rounded-2xl' title={t('IP风险评分')}>
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

const NewIpsSection = ({ t, data, loading, onBanIp }) => {
  const items = data?.items || [];
  const columns = [
    { title: 'IP', dataIndex: 'ip', key: 'ip', width: 140 },
    {
      title: t('来源'),
      dataIndex: 'source',
      key: 'source',
      render: (v) => (
        <Tag
          color={v === 'login' ? 'blue' : 'green'}
          size='small'
        >
          {v === 'login' ? t('登录') : 'API'}
        </Tag>
      ),
    },
    {
      title: t('用户名'),
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: t('首次出现'),
      dataIndex: 'first_seen',
      key: 'first_seen',
      render: (v) => (v ? timestamp2string(v) : '-'),
      width: 180,
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
          <Tag color='red' size='small'>
            {t('已封禁')}
          </Tag>
        ) : (
          <Tag color='green' size='small'>
            {t('正常')}
          </Tag>
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
        />
      ),
    },
  ];

  return (
    <Card className='!rounded-2xl' title={t('新IP告警')}>
      <Table
        columns={columns}
        dataSource={items}
        pagination={{ pageSize: 10 }}
        size='small'
        rowKey={(r) => `${r.ip}-${r.source}`}
        loading={loading}
        empty={<Empty description={t('暂无数据')} />}
      />
    </Card>
  );
};
