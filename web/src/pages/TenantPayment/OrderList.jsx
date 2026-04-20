import React, { useEffect, useState } from 'react';
import { Card, Table, Tag, Select, Space, Typography } from '@douyinfe/semi-ui';
import { listTenantPaymentOrders } from '../../helpers/payment';

const { Title } = Typography;

const statusColor = {
  pending: 'grey',
  paid: 'green',
  partial_refunded: 'orange',
  fully_refunded: 'red',
  closed: 'grey',
  expired: 'grey',
};

export default function OrderList() {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [orderType, setOrderType] = useState('');
  const [status, setStatus] = useState('');
  const pageSize = 20;

  const load = async () => {
    setLoading(true);
    try {
      const params = { page, page_size: pageSize };
      if (orderType) params.order_type = orderType;
      if (status) params.status = status;
      const res = await listTenantPaymentOrders(params);
      const d = res?.data || {};
      setRows(d.items || []);
      setTotal(d.total || 0);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [page, orderType, status]);

  const columns = [
    { title: '订单号', dataIndex: 'out_trade_no', width: 260, render: (v) => <code>{v}</code> },
    { title: '类型', dataIndex: 'order_type', width: 80,
      render: (v) => <Tag color={v === 'topup' ? 'blue' : 'purple'}>{v}</Tag> },
    { title: '金额（分）', dataIndex: 'amount', width: 100, render: (v) => v.toLocaleString() },
    { title: '已退', dataIndex: 'refunded_amount', width: 100, render: (v) => v || '-' },
    { title: '状态', dataIndex: 'status', width: 140,
      render: (v) => <Tag color={statusColor[v] || 'grey'}>{v}</Tag> },
    { title: '支付时间', dataIndex: 'paid_at', width: 160,
      render: (v) => v ? new Date(v * 1000).toLocaleString() : '-' },
    { title: '创建时间', dataIndex: 'created_at', width: 160,
      render: (v) => new Date(v * 1000).toLocaleString() },
  ];

  return (
    <Card>
      <Title heading={5} style={{ marginBottom: 16 }}>支付订单</Title>
      <Space style={{ marginBottom: 16 }}>
        <Select value={orderType} onChange={setOrderType} placeholder="类型筛选" style={{ width: 160 }}>
          <Select.Option value="">全部</Select.Option>
          <Select.Option value="topup">充值</Select.Option>
          <Select.Option value="sub">续期</Select.Option>
        </Select>
        <Select value={status} onChange={setStatus} placeholder="状态筛选" style={{ width: 180 }}>
          <Select.Option value="">全部</Select.Option>
          <Select.Option value="pending">待支付</Select.Option>
          <Select.Option value="paid">已支付</Select.Option>
          <Select.Option value="partial_refunded">部分退款</Select.Option>
          <Select.Option value="fully_refunded">全额退款</Select.Option>
          <Select.Option value="closed">已关闭</Select.Option>
          <Select.Option value="expired">已过期</Select.Option>
        </Select>
      </Space>
      <Table
        columns={columns}
        dataSource={rows}
        loading={loading}
        rowKey="id"
        pagination={{
          currentPage: page,
          pageSize,
          total,
          onPageChange: setPage,
        }}
      />
    </Card>
  );
}
