import React, { useEffect, useRef } from 'react';
import { Card, Form, Button, Typography, Tag, Spin } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { useTenantInfo } from './useTenantInfo';

const statusTag = (t, status) => {
  if (status === 1) return <Tag color='green'>{t('启用')}</Tag>;
  if (status === 2) return <Tag color='orange'>{t('已停用')}</Tag>;
  if (status === 3) return <Tag color='red'>{t('已删除')}</Tag>;
  return <Tag>{t('未知')}</Tag>;
};

export default function TenantInfoCard() {
  const { t } = useTranslation();
  const { tenant, loading, submitting, update } = useTenantInfo();
  const formApiRef = useRef(null);

  useEffect(() => {
    if (tenant && formApiRef.current) {
      formApiRef.current.setValues({
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
      });
    }
  }, [tenant]);

  if (loading && !tenant) {
    return (
      <Card style={{ minHeight: 240 }}>
        <Spin />
      </Card>
    );
  }

  if (!tenant) {
    return (
      <Card>
        <Typography.Text type='danger'>{t('未能加载租户信息')}</Typography.Text>
      </Card>
    );
  }

  const handleSubmit = async (values) => {
    await update({ name: values.name, status: Number(values.status) });
  };

  return (
    <Card title={t('租户信息')} headerExtraContent={statusTag(t, tenant.status)}>
      <Form
        getFormApi={(api) => (formApiRef.current = api)}
        onSubmit={handleSubmit}
        labelPosition='left'
        labelWidth={100}
      >
        <Form.Input
          field='name'
          label={t('名称')}
          rules={[{ required: true, message: t('名称必填') }]}
        />
        <Form.Input field='slug' label={t('唯一标识')} disabled />
        <Form.Select field='status' label={t('状态')}>
          <Form.Select.Option value={1}>{t('启用')}</Form.Select.Option>
          <Form.Select.Option value={2}>{t('停用')}</Form.Select.Option>
        </Form.Select>
        <div style={{ marginBottom: 12 }}>
          <Typography.Text type='tertiary'>
            ID: {tenant.id} · {t('创建于')} {new Date(tenant.created_at * 1000).toLocaleString()}
          </Typography.Text>
        </div>
        <Button htmlType='submit' theme='solid' type='primary' loading={submitting}>
          {t('保存修改')}
        </Button>
      </Form>
    </Card>
  );
}
