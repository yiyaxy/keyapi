import React from 'react';
import { Table, Tag, Button, Popconfirm, Space } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';

const roleTag = (t, role) => {
  if (role === 10) return <Tag color='blue'>{t('租户管理员')}</Tag>;
  if (role === 1) return <Tag>{t('普通成员')}</Tag>;
  return <Tag color='grey'>{t('未知')}</Tag>;
};

const statusTag = (t, status) => {
  if (status === 1) return <Tag color='green'>{t('启用')}</Tag>;
  if (status === 2) return <Tag color='orange'>{t('禁用')}</Tag>;
  if (status === 3) return <Tag color='red'>{t('已移除')}</Tag>;
  return <Tag>{t('未知')}</Tag>;
};

export default function TenantMembersTable({
  items,
  loading,
  page,
  pageSize,
  total,
  onPageChange,
  onEditClick,
  onRemoveClick,
}) {
  const { t } = useTranslation();
  const columns = [
    {
      title: t('用户'),
      dataIndex: 'username',
      render: (_, r) => (
        <div>
          <div>{r.display_name || r.username}</div>
          <div style={{ color: '#999', fontSize: 12 }}>{r.email}</div>
        </div>
      ),
    },
    { title: t('角色'), dataIndex: 'tenant_role', render: (v) => roleTag(t, v) },
    { title: t('状态'), dataIndex: 'membership_status', render: (v) => statusTag(t, v) },
    { title: t('分组'), dataIndex: 'group' },
    {
      title: t('已用额度'),
      dataIndex: 'used_quota',
      render: (v) => (v ?? 0).toLocaleString(),
    },
    { title: t('请求数'), dataIndex: 'request_count' },
    {
      title: t('操作'),
      render: (_, r) => (
        <Space>
          <Button size='small' onClick={() => onEditClick(r)}>
            {t('编辑')}
          </Button>
          <Popconfirm
            title={t('确认移除该成员？')}
            content={t('移除后该用户将失去本租户访问权')}
            onConfirm={() => onRemoveClick(r)}
          >
            <Button size='small' type='danger'>
              {t('移除')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];
  return (
    <Table
      rowKey='id'
      loading={loading}
      dataSource={items}
      columns={columns}
      pagination={{
        currentPage: page,
        pageSize,
        total,
        onChange: onPageChange,
        showTotal: true,
      }}
    />
  );
}
