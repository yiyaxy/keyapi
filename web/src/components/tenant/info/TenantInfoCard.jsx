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
        status_label:
          tenant.status === 1 ? '启用' : tenant.status === 2 ? '已停用' : '已删除',
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
    // status 不可在本页修改，只提交 name
    await update({ name: values.name });
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
        {/*
          故意不暴露 status 编辑：后端 GetTenantById 只返回 active 状态（见
          model/tenant.go），一旦把当前租户改成 Suspended，UpdateTenant 成功响应
          里 data=nil，前端会把页面打空，且后续 TenantResolve 会回退到默认租户。
          租户停用是平台管理员操作，应走 /api/platform/tenants/:id/... 接口。
        */}
        <Form.Input
          field='status_label'
          label={t('状态')}
          disabled
          initValue={
            tenant.status === 1
              ? t('启用')
              : tenant.status === 2
                ? t('已停用')
                : t('已删除')
          }
        />
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
