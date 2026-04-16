import React, { useCallback, useEffect, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Tag,
  Space,
  Popconfirm,
  Typography,
  InputNumber,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess } from '../../helpers';

const statusTag = (t, s) => {
  if (s === 1) return <Tag color='green'>{t('启用')}</Tag>;
  if (s === 2) return <Tag color='orange'>{t('已停用')}</Tag>;
  if (s === 3) return <Tag color='red'>{t('已删除')}</Tag>;
  return <Tag>{t('未知')}</Tag>;
};

export default function PlatformTenantsPanel() {
  const { t } = useTranslation();
  const [tenants, setTenants] = useState([]);
  const [plans, setPlans] = useState({});
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editPlanTarget, setEditPlanTarget] = useState(null);
  const createApiRef = React.useRef(null);
  const planApiRef = React.useRef(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, pRes] = await Promise.all([
        API.get('/api/platform/tenants/'),
        API.get('/api/platform/tenants/plans'),
      ]);
      if (tRes?.data?.success) setTenants(tRes.data.data || []);
      else showError(tRes?.data?.message || t('加载租户失败'));
      if (pRes?.data?.success) {
        const map = {};
        (pRes.data.data || []).forEach((p) => (map[p.tenant_id] = p));
        setPlans(map);
      }
    } catch (e) {
      showError(e?.message || t('加载失败'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleCreate = async () => {
    const api = createApiRef.current;
    if (!api) return;
    let v;
    try {
      v = await api.validate();
    } catch (e) {
      return;
    }
    try {
      const res = await API.post('/api/platform/tenants/', { name: v.name, slug: v.slug });
      if (res?.data?.success) {
        showSuccess(t('已创建'));
        setCreateOpen(false);
        await loadAll();
      } else showError(res?.data?.message || t('创建失败'));
    } catch (e) {
      showError(e?.message || t('创建失败'));
    }
  };

  const handleDelete = async (row) => {
    try {
      const res = await API.delete(`/api/platform/tenants/${row.id}`);
      if (res?.data?.success) {
        showSuccess(t('已删除'));
        await loadAll();
      } else showError(res?.data?.message || t('删除失败'));
    } catch (e) {
      showError(e?.message || t('删除失败'));
    }
  };

  const openPlanEdit = (row) => {
    const current = plans[row.id] || {};
    setEditPlanTarget({ ...row, plan: current });
    setTimeout(() => {
      planApiRef.current?.setValues({
        plan_name: current.plan_name || 'free',
        quota_limit: current.quota_limit ?? -1,
        rpm_limit: current.rpm_limit ?? -1,
        tpm_limit: current.tpm_limit ?? -1,
        max_members: current.max_members ?? -1,
        max_tokens: current.max_tokens ?? -1,
        max_channels: current.max_channels ?? -1,
        allowed_models: current.allowed_models || '',
        status: current.status ?? 1,
        expires_at: current.expires_at ?? 0,
      });
    }, 50);
  };

  const handlePlanSubmit = async () => {
    const api = planApiRef.current;
    if (!api || !editPlanTarget) return;
    let v;
    try {
      v = await api.validate();
    } catch (e) {
      return;
    }
    try {
      const res = await API.put(`/api/platform/tenants/${editPlanTarget.id}/plan`, {
        plan_name: v.plan_name,
        quota_limit: Number(v.quota_limit),
        rpm_limit: Number(v.rpm_limit),
        tpm_limit: Number(v.tpm_limit),
        max_members: Number(v.max_members),
        max_tokens: Number(v.max_tokens),
        max_channels: Number(v.max_channels),
        allowed_models: v.allowed_models || '',
        status: Number(v.status),
        expires_at: Number(v.expires_at),
      });
      if (res?.data?.success) {
        showSuccess(t('已保存'));
        setEditPlanTarget(null);
        await loadAll();
      } else showError(res?.data?.message || t('保存失败'));
    } catch (e) {
      showError(e?.message || t('保存失败'));
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: t('名称'), dataIndex: 'name' },
    { title: 'Slug', dataIndex: 'slug' },
    { title: t('状态'), dataIndex: 'status', render: (v) => statusTag(t, v), width: 100 },
    {
      title: t('计划'),
      render: (_, r) => {
        const p = plans[r.id];
        return p ? (
          <Typography.Text>
            {p.plan_name} {p.status === 0 ? <Tag color='red'>禁用</Tag> : null}
          </Typography.Text>
        ) : (
          '-'
        );
      },
    },
    {
      title: t('操作'),
      render: (_, r) => (
        <Space>
          <Button size='small' onClick={() => openPlanEdit(r)}>
            {t('编辑计划')}
          </Button>
          <Popconfirm title={t('确认删除租户？此操作会把租户 status 置为 deleted')} onConfirm={() => handleDelete(r)}>
            <Button size='small' type='danger' disabled={r.id === 1}>
              {t('删除')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title={t('平台租户管理')}
      headerExtraContent={
        <Space>
          <Button onClick={loadAll}>{t('刷新')}</Button>
          <Button type='primary' theme='solid' onClick={() => setCreateOpen(true)}>
            {t('创建租户')}
          </Button>
        </Space>
      }
    >
      <Table rowKey='id' dataSource={tenants} columns={columns} loading={loading} pagination={false} />

      <Modal
        title={t('创建租户')}
        visible={createOpen}
        onOk={handleCreate}
        onCancel={() => setCreateOpen(false)}
        okText={t('创建')}
        cancelText={t('取消')}
      >
        <Form
          getFormApi={(api) => (createApiRef.current = api)}
          labelPosition='left'
          labelWidth={100}
        >
          <Form.Input field='name' label={t('名称')} rules={[{ required: true }]} />
          <Form.Input
            field='slug'
            label='Slug'
            placeholder='a-z, 0-9, - 仅小写'
            rules={[{ required: true }]}
          />
        </Form>
      </Modal>

      <Modal
        title={t('编辑租户计划')}
        visible={!!editPlanTarget}
        onOk={handlePlanSubmit}
        onCancel={() => setEditPlanTarget(null)}
        okText={t('保存')}
        cancelText={t('取消')}
        width={600}
      >
        {editPlanTarget ? (
          <Form
            getFormApi={(api) => (planApiRef.current = api)}
            labelPosition='left'
            labelWidth={140}
          >
            <Form.Input field='plan_name' label={t('计划名称')} />
            <Form.InputNumber field='quota_limit' label={t('Quota 上限 (-1=不限)')} />
            <Form.InputNumber field='rpm_limit' label={t('RPM 上限')} />
            <Form.InputNumber field='tpm_limit' label={t('TPM 上限')} />
            <Form.InputNumber field='max_members' label={t('最大成员数')} />
            <Form.InputNumber field='max_tokens' label={t('最大令牌数')} />
            <Form.InputNumber field='max_channels' label={t('最大渠道数')} />
            <Form.Input field='allowed_models' label={t('可用模型（逗号分隔，空=全部）')} />
            <Form.Select field='status' label={t('状态')}>
              <Form.Select.Option value={1}>{t('启用')}</Form.Select.Option>
              <Form.Select.Option value={0}>{t('禁用')}</Form.Select.Option>
            </Form.Select>
            <Form.InputNumber field='expires_at' label={t('到期时间 (unix 秒, 0=不过期)')} />
          </Form>
        ) : null}
      </Modal>
    </Card>
  );
}
