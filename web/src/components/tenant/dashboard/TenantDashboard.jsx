import React, { useCallback, useEffect, useState } from 'react';
import { Card, Row, Col, Spin, Typography, Select, Table } from '@douyinfe/semi-ui';
import { VChart } from '@visactor/react-vchart';
import { useTranslation } from 'react-i18next';
import { API, showError } from '../../../helpers';

const StatCard = ({ title, value, sub }) => (
  <Card style={{ height: '100%' }}>
    <Typography.Text type='tertiary'>{title}</Typography.Text>
    <div style={{ fontSize: 28, fontWeight: 600, marginTop: 4 }}>
      {(value ?? 0).toLocaleString()}
    </div>
    {sub ? (
      <Typography.Text type='tertiary' size='small'>
        {sub}
      </Typography.Text>
    ) : null}
  </Card>
);

export default function TenantDashboard() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [modelUsage, setModelUsage] = useState([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, tr, mu] = await Promise.all([
        API.get('/api/tenant/dashboard'),
        API.get(`/api/tenant/usage/trend?days=${days}`),
        API.get(`/api/tenant/usage/models?days=${days}`),
      ]);
      if (s?.data?.success) setSummary(s.data.data);
      else showError(s?.data?.message || '加载仪表盘失败');
      if (tr?.data?.success) setTrend(tr.data.data || []);
      if (mu?.data?.success) setModelUsage(mu.data.data || []);
    } catch (e) {
      showError(e?.message || '加载仪表盘失败');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const trendSpec = {
    type: 'line',
    data: [{ id: 'trend', values: trend }],
    xField: 'date',
    yField: 'quota_used',
    crosshair: { xField: { visible: true } },
    tooltip: { mark: { visible: true } },
    title: { text: t('每日 Quota 使用趋势') },
  };

  if (loading && !summary)
    return (
      <Card>
        <Spin />
      </Card>
    );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Row gutter={[12, 12]}>
        <Col span={6}>
          <StatCard
            title={t('活跃成员')}
            value={summary?.active_members}
            sub={`${t('共')} ${summary?.total_members ?? 0}`}
          />
        </Col>
        <Col span={6}>
          <StatCard
            title={t('活跃令牌')}
            value={summary?.active_tokens}
            sub={`${t('共')} ${summary?.total_tokens ?? 0}`}
          />
        </Col>
        <Col span={6}>
          <StatCard
            title={t('活跃渠道')}
            value={summary?.active_channels}
            sub={`${t('共')} ${summary?.total_channels ?? 0}`}
          />
        </Col>
        <Col span={6}>
          <StatCard
            title={t('今日请求数')}
            value={summary?.today_requests}
            sub={`${t('今日 Quota')} ${(summary?.today_quota_used ?? 0).toLocaleString()}`}
          />
        </Col>
      </Row>

      <Card
        title={t('趋势')}
        headerExtraContent={
          <Select value={days} onChange={setDays} style={{ width: 120 }}>
            <Select.Option value={7}>7 {t('天')}</Select.Option>
            <Select.Option value={30}>30 {t('天')}</Select.Option>
            <Select.Option value={90}>90 {t('天')}</Select.Option>
          </Select>
        }
      >
        {trend.length > 0 ? (
          <div style={{ height: 320 }}>
            <VChart spec={trendSpec} />
          </div>
        ) : (
          <Typography.Text type='tertiary'>{t('暂无数据')}</Typography.Text>
        )}
      </Card>

      <Card title={t('模型使用排行')}>
        <Table
          rowKey='model_name'
          dataSource={modelUsage}
          pagination={false}
          columns={[
            { title: t('模型'), dataIndex: 'model_name' },
            {
              title: t('请求数'),
              dataIndex: 'request_count',
              render: (v) => (v ?? 0).toLocaleString(),
            },
            {
              title: t('Quota'),
              dataIndex: 'quota_used',
              render: (v) => (v ?? 0).toLocaleString(),
            },
          ]}
        />
      </Card>
    </div>
  );
}
