import React, { useEffect, useState } from 'react';
import { Card, Descriptions, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { API, showError } from '../../../helpers';

const planStatusTag = (t, s) => {
  if (s === 1) return <Tag color='green'>{t('启用')}</Tag>;
  if (s === 0) return <Tag color='red'>{t('已停用')}</Tag>;
  return <Tag>{t('未知')}</Tag>;
};

const formatLimit = (v, suffix = '') => {
  if (v === undefined || v === null) return '-';
  if (v <= 0) return '不限';
  return `${Number(v).toLocaleString()}${suffix}`;
};

export default function TenantPlanCard() {
  const { t } = useTranslation();
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await API.get('/api/tenant/plan');
        if (res?.data?.success) setPlan(res.data.data);
        else showError(res?.data?.message || t('加载计划失败'));
      } catch (e) {
        showError(e?.message || t('加载计划失败'));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && !plan)
    return (
      <Card>
        <Spin />
      </Card>
    );
  if (!plan)
    return (
      <Card>
        <Typography.Text type='danger'>{t('未能加载租户计划')}</Typography.Text>
      </Card>
    );

  const expires =
    plan.expires_at && plan.expires_at > 0
      ? new Date(plan.expires_at * 1000).toLocaleString()
      : t('永不过期');
  const allowedModels = plan.allowed_models
    ? plan.allowed_models.split(',').filter(Boolean)
    : [];

  return (
    <Card title={t('租户计划')} headerExtraContent={planStatusTag(t, plan.status)}>
      <Descriptions
        data={[
          { key: t('计划名称'), value: plan.plan_name || 'free' },
          { key: t('Quota 上限'), value: formatLimit(plan.quota_limit) },
          { key: t('RPM 上限'), value: formatLimit(plan.rpm_limit, ' 次/分') },
          { key: t('TPM 上限'), value: formatLimit(plan.tpm_limit, ' token/分') },
          { key: t('最大成员数'), value: formatLimit(plan.max_members) },
          { key: t('最大令牌数'), value: formatLimit(plan.max_tokens) },
          { key: t('最大渠道数'), value: formatLimit(plan.max_channels) },
          {
            key: t('可用模型'),
            value:
              allowedModels.length === 0
                ? t('不限（全部允许）')
                : allowedModels.join(', '),
          },
          { key: t('到期时间'), value: expires },
        ]}
        row
      />
    </Card>
  );
}
