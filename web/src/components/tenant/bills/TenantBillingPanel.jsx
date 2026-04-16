import React, { useCallback, useEffect, useState } from 'react';
import { Card, Tabs, TabPane, Table, Button, Tag, Select, Space, Typography } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess } from '../../../helpers';

const billStatusTag = (t, s) => {
  if (s === 'open') return <Tag color='blue'>{t('进行中')}</Tag>;
  if (s === 'closed') return <Tag color='grey'>{t('已结转')}</Tag>;
  if (s === 'paid') return <Tag color='green'>{t('已支付')}</Tag>;
  return <Tag>{s || '-'}</Tag>;
};

const ledgerTypeTag = (t, s) => {
  const map = {
    topup: ['green', t('充值')],
    consume: ['orange', t('消费')],
    refund: ['blue', t('退款')],
    adjustment: ['grey', t('人工调整')],
  };
  const [color, label] = map[s] || ['grey', s || '-'];
  return <Tag color={color}>{label}</Tag>;
};

const fmtUnix = (u) => (u > 0 ? new Date(u * 1000).toLocaleString() : '-');
const fmtRange = (start, end) => {
  if (!start || !end) return '-';
  const s = new Date(start * 1000);
  const e = new Date(end * 1000);
  return `${s.toLocaleDateString()} — ${new Date(e.getTime() - 1).toLocaleDateString()}`;
};

function BillsTab({ t }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(12);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', String(pageSize));
      if (status) params.set('status', status);
      const res = await API.get(`/api/tenant/bills?${params}`);
      if (res?.data?.success) {
        const d = res.data.data || {};
        setItems(d.items || d.Items || []);
        const tot = d.total ?? d.Total ?? 0;
        setTotal(typeof tot === 'number' ? tot : 0);
      } else showError(res?.data?.message || '加载账单失败');
    } catch (e) {
      showError(e?.message || '加载账单失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    try {
      const res = await API.post('/api/tenant/bills/current/refresh');
      if (res?.data?.success) {
        showSuccess(t('本月账单已刷新'));
        await load();
      } else showError(res?.data?.message || t('刷新失败'));
    } catch (e) {
      showError(e?.message || t('刷新失败'));
    }
  };

  const columns = [
    { title: t('周期'), render: (_, r) => fmtRange(r.period_start, r.period_end) },
    { title: t('计划'), dataIndex: 'plan_name', width: 100 },
    { title: t('Quota 使用'), dataIndex: 'quota_used', render: (v) => (v ?? 0).toLocaleString() },
    { title: t('请求数'), dataIndex: 'request_count', render: (v) => (v ?? 0).toLocaleString() },
    { title: t('状态'), dataIndex: 'status', render: (v) => billStatusTag(t, v), width: 100 },
    { title: t('结转时间'), dataIndex: 'closed_at', render: fmtUnix, width: 180 },
  ];
  return (
    <>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
        <Space>
          <Select value={status} onChange={setStatus} style={{ width: 160 }} showClear placeholder={t('状态过滤')}>
            <Select.Option value='open'>{t('进行中')}</Select.Option>
            <Select.Option value='closed'>{t('已结转')}</Select.Option>
            <Select.Option value='paid'>{t('已支付')}</Select.Option>
          </Select>
        </Space>
        <Button type='primary' theme='solid' onClick={refresh}>
          {t('刷新本月快照')}
        </Button>
      </div>
      <Table
        rowKey='id'
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={{ currentPage: page, pageSize, total, onChange: setPage, showTotal: true }}
      />
    </>
  );
}

function LedgerTab({ t }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [ledgerType, setLedgerType] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', String(pageSize));
      if (ledgerType) params.set('ledger_type', ledgerType);
      const res = await API.get(`/api/tenant/ledger?${params}`);
      if (res?.data?.success) {
        const d = res.data.data || {};
        setItems(d.items || d.Items || []);
        const tot = d.total ?? d.Total ?? 0;
        setTotal(typeof tot === 'number' ? tot : 0);
      } else showError(res?.data?.message || '加载账本失败');
    } catch (e) {
      showError(e?.message || '加载账本失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, ledgerType]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = [
    { title: t('时间'), dataIndex: 'created_at', render: fmtUnix, width: 180 },
    { title: t('类型'), dataIndex: 'ledger_type', render: (v) => ledgerTypeTag(t, v), width: 120 },
    {
      title: t('金额'),
      dataIndex: 'amount',
      render: (v) => (
        <Typography.Text type={v >= 0 ? 'success' : 'danger'}>
          {v >= 0 ? '+' : ''}
          {(v ?? 0).toLocaleString()}
        </Typography.Text>
      ),
    },
    { title: t('余额'), dataIndex: 'balance_after', render: (v) => (v ?? 0).toLocaleString() },
    { title: t('说明'), dataIndex: 'description' },
  ];
  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Select
          value={ledgerType}
          onChange={(v) => {
            setLedgerType(v);
            setPage(1);
          }}
          style={{ width: 160 }}
          showClear
          placeholder={t('类型过滤')}
        >
          <Select.Option value='topup'>{t('充值')}</Select.Option>
          <Select.Option value='consume'>{t('消费')}</Select.Option>
          <Select.Option value='refund'>{t('退款')}</Select.Option>
          <Select.Option value='adjustment'>{t('人工调整')}</Select.Option>
        </Select>
      </div>
      <Table
        rowKey='id'
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={{ currentPage: page, pageSize, total, onChange: setPage, showTotal: true }}
      />
    </>
  );
}

export default function TenantBillingPanel() {
  const { t } = useTranslation();
  return (
    <Card title={t('账单与账本')}>
      <Tabs type='line'>
        <TabPane tab={t('账单')} itemKey='bills'>
          <BillsTab t={t} />
        </TabPane>
        <TabPane tab={t('账本流水')} itemKey='ledger'>
          <LedgerTab t={t} />
        </TabPane>
      </Tabs>
    </Card>
  );
}
