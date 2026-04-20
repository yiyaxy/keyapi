import React, { useEffect, useState } from 'react';
import { Banner, Button, Card, Descriptions, Spin, Tag, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { API, showError } from '../../../helpers';
import { createWechatSub } from '../../../helpers/payment';
import WechatPayModal from '../../payment/WechatPayModal';

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
  const [wechatModal, setWechatModal] = useState({ visible: false, codeUrl: '', outTradeNo: '', amountCents: 0 });

  const loadPlan = async () => {
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
  };

  useEffect(() => {
    loadPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRenew = async () => {
    const res = await createWechatSub('native', {});
    if (!res?.success) {
      Toast.error(res?.message || t('续期下单失败'));
      return;
    }
    const env = res.data;
    setWechatModal({
      visible: true,
      codeUrl: env.response.code_url,
      outTradeNo: env.order.out_trade_no,
      amountCents: env.order.amount,
    });
  };

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

  const grace = Number(plan.grace_period_seconds || 0);
  const nowSec = Math.floor(Date.now() / 1000);
  const hasExpiry = plan.expires_at && plan.expires_at > 0;
  const inGracePeriod =
    hasExpiry && grace > 0 && nowSec > plan.expires_at && nowSec <= plan.expires_at + grace;
  const graceUntilStr =
    hasExpiry && grace > 0
      ? new Date((plan.expires_at + grace) * 1000).toLocaleString()
      : '';
  const graceDays = grace > 0 ? Math.floor(grace / 86400) : 0;
  const graceLabel =
    grace > 0
      ? graceDays > 0
        ? `${graceDays} ${t('天')}`
        : `${grace} ${t('秒')}`
      : t('无');

  const descriptionRows = [
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
  ];
  if (hasExpiry && grace > 0) {
    descriptionRows.push({ key: t('宽限期'), value: graceLabel });
    descriptionRows.push({ key: t('宽限期截止'), value: graceUntilStr });
  }

  const renewDisabled = !plan?.renew_price_amount || plan.renew_price_amount <= 0;

  return (
    <>
      <Card
        title={t('租户计划')}
        headerExtraContent={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {planStatusTag(t, plan.status)}
            <Tooltip content={renewDisabled ? t('请联系平台管理员配置续期价格') : ''}>
              <Button
                type='primary'
                size='small'
                onClick={handleRenew}
                disabled={renewDisabled}
              >
                {t('续期')}
              </Button>
            </Tooltip>
          </div>
        }
      >
        {inGracePeriod ? (
          <Banner
            type='warning'
            fullMode={false}
            closeIcon={null}
            description={`${t('套餐已到期，宽限期至')} ${graceUntilStr}`}
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <Descriptions data={descriptionRows} row />
      </Card>
      <WechatPayModal
        {...wechatModal}
        onClose={() => setWechatModal({ visible: false, codeUrl: '', outTradeNo: '', amountCents: 0 })}
        onSuccess={() => {
          setWechatModal({ visible: false, codeUrl: '', outTradeNo: '', amountCents: 0 });
          loadPlan();
        }}
      />
    </>
  );
}
