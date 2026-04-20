import React, { useCallback, useEffect, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Tag,
  Popconfirm,
  Space,
  Tabs,
  TabPane,
  Select,
  Typography,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess } from '../../../helpers';

const severityTag = (t, s) => {
  if (s === 'critical') return <Tag color='red'>{t('严重')}</Tag>;
  if (s === 'warning') return <Tag color='orange'>{t('警告')}</Tag>;
  return <Tag>{t(s || '未知')}</Tag>;
};

const statusTag = (t, s) => {
  if (s === 'active') return <Tag color='red'>{t('活跃')}</Tag>;
  if (s === 'acknowledged') return <Tag color='blue'>{t('已确认')}</Tag>;
  if (s === 'resolved') return <Tag color='green'>{t('已解除')}</Tag>;
  return <Tag>{s || '-'}</Tag>;
};

const formatUnix = (u) => (u > 0 ? new Date(u * 1000).toLocaleString() : '-');

function useActiveAlerts() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/tenant/alerts');
      if (res?.data?.success) setItems(res.data.data || []);
      else showError(res?.data?.message || '加载告警失败');
    } catch (e) {
      showError(e?.message || '加载告警失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  return { items, loading, reload: load };
}

function useAlertHistory() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', String(pageSize));
      if (status) params.set('status', status);
      const res = await API.get(`/api/tenant/alerts/history?${params}`);
      if (res?.data?.success) {
        const d = res.data.data || {};
        setItems(d.items || d.Items || []);
        const tot = d.total ?? d.Total ?? 0;
        setTotal(typeof tot === 'number' ? tot : 0);
      } else showError(res?.data?.message || '加载历史失败');
    } catch (e) {
      showError(e?.message || '加载历史失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    items,
    total,
    page,
    pageSize,
    status,
    loading,
    setPage,
    setStatus: (v) => {
      setStatus(v);
      setPage(1);
    },
    reload: load,
  };
}

function ActiveAlertsTab({ t }) {
  const { items, loading, reload } = useActiveAlerts();

  const handleAck = async (id) => {
    try {
      const res = await API.post(`/api/tenant/alerts/${id}/ack`);
      if (res?.data?.success) {
        showSuccess(t('已确认'));
        await reload();
      } else showError(res?.data?.message || t('确认失败'));
    } catch (e) {
      showError(e?.message || t('确认失败'));
    }
  };
  const handleResolve = async (id) => {
    try {
      const res = await API.post(`/api/tenant/alerts/${id}/resolve`);
      if (res?.data?.success) {
        showSuccess(t('已解除'));
        await reload();
      } else showError(res?.data?.message || t('解除失败'));
    } catch (e) {
      showError(e?.message || t('解除失败'));
    }
  };

  const columns = [
    { title: t('类型'), dataIndex: 'alert_type', width: 200 },
    { title: t('严重度'), dataIndex: 'severity', render: (v) => severityTag(t, v), width: 100 },
    { title: t('状态'), dataIndex: 'status', render: (v) => statusTag(t, v), width: 100 },
    { title: t('消息'), dataIndex: 'message' },
    { title: t('触发时间'), dataIndex: 'triggered_at', render: formatUnix, width: 180 },
    {
      title: t('操作'),
      width: 200,
      render: (_, r) => (
        <Space>
          {r.status === 'active' ? (
            <Button size='small' onClick={() => handleAck(r.id)}>
              {t('确认')}
            </Button>
          ) : null}
          <Popconfirm title={t('确认解除此告警？')} onConfirm={() => handleResolve(r.id)}>
            <Button size='small' type='danger'>
              {t('解除')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
        <Typography.Text type='tertiary'>
          {t('当前活跃 + 已确认告警。系统每 5 分钟自动刷新，新告警会邮件通知租户管理员。')}
        </Typography.Text>
        <Button onClick={reload}>{t('刷新')}</Button>
      </div>
      <Table rowKey='id' loading={loading} dataSource={items} columns={columns} pagination={false} />
    </>
  );
}

function AlertHistoryTab({ t }) {
  const { items, total, page, pageSize, status, loading, setPage, setStatus } =
    useAlertHistory();
  const columns = [
    { title: t('类型'), dataIndex: 'alert_type', width: 180 },
    { title: t('严重度'), dataIndex: 'severity', render: (v) => severityTag(t, v), width: 100 },
    { title: t('状态'), dataIndex: 'status', render: (v) => statusTag(t, v), width: 100 },
    { title: t('消息'), dataIndex: 'message' },
    { title: t('触发时间'), dataIndex: 'triggered_at', render: formatUnix, width: 180 },
    { title: t('解除时间'), dataIndex: 'resolved_at', render: formatUnix, width: 180 },
  ];
  return (
    <>
      <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
        <Select
          placeholder={t('状态过滤')}
          value={status}
          onChange={setStatus}
          style={{ width: 160 }}
          showClear
        >
          <Select.Option value='active'>{t('活跃')}</Select.Option>
          <Select.Option value='acknowledged'>{t('已确认')}</Select.Option>
          <Select.Option value='resolved'>{t('已解除')}</Select.Option>
        </Select>
      </div>
      <Table
        rowKey='id'
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={{
          currentPage: page,
          pageSize,
          total,
          onChange: setPage,
          showTotal: true,
        }}
      />
    </>
  );
}

export default function TenantAlertsPanel() {
  const { t } = useTranslation();
  return (
    <Card title={t('租户告警')}>
      <Tabs type='line'>
        <TabPane tab={t('活跃')} itemKey='active'>
          <ActiveAlertsTab t={t} />
        </TabPane>
        <TabPane tab={t('历史')} itemKey='history'>
          <AlertHistoryTab t={t} />
        </TabPane>
      </Tabs>
    </Card>
  );
}
