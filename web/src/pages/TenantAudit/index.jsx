import React, { useCallback, useEffect, useState } from 'react';
import {
  Card,
  Table,
  Tag,
  Select,
  DatePicker,
  Button,
  Space,
  Typography,
  Tooltip,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { API, showError } from '../../helpers';

const ACTION_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'membership.invite', label: '成员邀请' },
  { value: 'membership.accept', label: '成员接受邀请' },
  { value: 'membership.remove', label: '成员移除' },
  { value: 'membership.update', label: '成员变更' },
  { value: 'config.set', label: '配置设置' },
  { value: 'config.delete', label: '配置删除' },
  { value: 'plan.update', label: '套餐变更' },
  { value: 'alert.acknowledge', label: '告警确认' },
];

const formatUnix = (u) => (u > 0 ? new Date(u * 1000).toLocaleString() : '-');

const actionTag = (t, action) => {
  const opt = ACTION_OPTIONS.find((o) => o.value === action);
  const label = opt ? t(opt.label) : action || '-';
  let color = 'grey';
  if (action.startsWith('membership.')) color = 'blue';
  else if (action.startsWith('config.')) color = 'orange';
  else if (action.startsWith('plan.')) color = 'purple';
  else if (action.startsWith('alert.')) color = 'red';
  return <Tag color={color}>{label}</Tag>;
};

const formatDetail = (raw) => {
  if (!raw) return '-';
  try {
    const obj = JSON.parse(raw);
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    return raw;
  }
};

export default function TenantAuditPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [action, setAction] = useState('');
  const [range, setRange] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(pageSize));
      params.set('offset', String((page - 1) * pageSize));
      if (action) params.set('action', action);
      if (range && range[0]) {
        const since = Math.floor(new Date(range[0]).getTime() / 1000);
        params.set('since', String(since));
      }
      const res = await API.get(`/api/tenant/audit?${params.toString()}`);
      if (res?.data?.success) {
        const d = res.data.data || {};
        setItems(d.items || []);
        const tot = d.total ?? 0;
        setTotal(typeof tot === 'number' ? tot : 0);
      } else {
        showError(res?.data?.message || t('加载审计日志失败'));
      }
    } catch (e) {
      showError(e?.message || t('加载审计日志失败'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, action, range, t]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = [
    {
      title: t('时间'),
      dataIndex: 'created_at',
      width: 180,
      render: formatUnix,
    },
    {
      title: t('操作人'),
      dataIndex: 'actor_user_id',
      width: 100,
      render: (v) => (v > 0 ? `#${v}` : '-'),
    },
    {
      title: t('角色'),
      dataIndex: 'actor_role',
      width: 130,
      render: (v) => (v ? <Tag>{v}</Tag> : '-'),
    },
    {
      title: t('动作'),
      dataIndex: 'action',
      width: 160,
      render: (v) => actionTag(t, v || ''),
    },
    {
      title: t('目标'),
      dataIndex: 'target',
      width: 140,
      render: (v, r) => `${v || '-'}${r.target_id ? ` #${r.target_id}` : ''}`,
    },
    {
      title: t('客户端 IP'),
      dataIndex: 'client_ip',
      width: 140,
      render: (v) => v || '-',
    },
    {
      title: t('详情'),
      dataIndex: 'detail',
      render: (v) => {
        const text = formatDetail(v);
        const short = text.length > 80 ? text.slice(0, 80) + '…' : text;
        return (
          <Tooltip
            content={
              <pre
                style={{
                  maxWidth: 480,
                  maxHeight: 320,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  margin: 0,
                }}
              >
                {text}
              </pre>
            }
          >
            <Typography.Text type='tertiary' style={{ cursor: 'pointer' }}>
              {short}
            </Typography.Text>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Card title={t('租户审计日志')}>
        <Space style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          <Select
            value={action}
            style={{ width: 180 }}
            onChange={(v) => {
              setAction(v ?? '');
              setPage(1);
            }}
            placeholder={t('动作筛选')}
          >
            {ACTION_OPTIONS.map((o) => (
              <Select.Option key={o.value || 'all'} value={o.value}>
                {t(o.label)}
              </Select.Option>
            ))}
          </Select>
          <DatePicker
            type='dateRange'
            value={range}
            onChange={(v) => {
              setRange(v || []);
              setPage(1);
            }}
            style={{ width: 280 }}
            placeholder={[t('开始时间'), t('结束时间')]}
          />
          <Button onClick={load}>{t('刷新')}</Button>
        </Space>
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
      </Card>
    </div>
  );
}
