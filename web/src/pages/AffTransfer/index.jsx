import React, { useState, useContext } from 'react';
import { Card, Table, Button, Tag, Typography, InputNumber, Tabs, TabPane } from '@douyinfe/semi-ui';
import { Copy, Users, TrendingUp, BarChart2, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { renderQuota, getCurrencyConfig } from '../../helpers';
import { quotaToDisplayAmount, displayAmountToQuota } from '../../helpers/quota';
import { copy, showError, showSuccess } from '../../helpers/utils';
import { useAffTransferData } from '../../hooks/aff-transfer/useAffTransferData';
import { StatusContext } from '../../context/Status';

const { Text } = Typography;

const AffTransfer = () => {
  const { t } = useTranslation();
  const [statusState] = useContext(StatusContext);
  const {
    userInfo,
    loading,
    requests,
    page,
    total,
    setPage,
    submitRequest,
    refreshRequests,
    rebateLogs,
    rebateLogsPage,
    rebateLogsTotal,
    rebateLogsFilter,
    setRebateLogsPage,
    setRebateLogsFilter,
    pendingQuota,
  } = useAffTransferData();

  const [amount, setAmount] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const affCode = userInfo?.aff_code || '';
  const affLink = affCode ? `${window.location.origin}/register?aff=${affCode}` : '';
  const affCount = userInfo?.aff_count || 0;
  const affQuota = userInfo?.aff_quota || 0;
  const affHistoryQuota = userInfo?.aff_history_quota || 0;

  const effectiveInviterReward = userInfo?.effective_register_reward ?? statusState?.status?.quota_for_inviter ?? 0;
  const effectiveInviteeReward = userInfo?.effective_invitee_reward ?? statusState?.status?.quota_for_invitee ?? 0;
  const effectiveRebateCount = userInfo?.effective_top_up_rebate_count ?? statusState?.status?.top_up_rebate_count ?? 0;
  const effectiveRebatePercent = userInfo?.effective_top_up_rebate_percent ?? statusState?.status?.top_up_rebate_percent ?? 0;

  const handleCopy = async (text) => {
    const ok = await copy(text);
    if (ok) {
      showSuccess(t('affTransfer.copySuccess'));
    }
  };

  const handleSubmit = async () => {
    if (!amount || amount <= 0) {
      showError(t('affTransfer.amountRequired'));
      return;
    }
    const quotaNeeded = displayAmountToQuota(amount);
    if (quotaNeeded > affQuota) {
      showError(t('affTransfer.amountExceedsQuota'));
      return;
    }
    setSubmitting(true);
    const ok = await submitRequest(quotaNeeded);
    if (ok) {
      setAmount(null);
    }
    setSubmitting(false);
  };

  const statusMap = {
    1: { color: 'amber', text: t('affTransfer.pending') },
    2: { color: 'green', text: t('affTransfer.approved') },
    3: { color: 'red', text: t('affTransfer.rejected') },
  };

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: t('affTransfer.quota'),
      dataIndex: 'quota',
      key: 'quota',
      render: (val) => renderQuota(val),
    },
    {
      title: t('affTransfer.status'),
      dataIndex: 'status',
      key: 'status',
      render: (val) => {
        const s = statusMap[val] || { color: 'grey', text: '-' };
        return <Tag color={s.color} size='small'>{s.text}</Tag>;
      },
    },
    {
      title: t('affTransfer.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val) => val ? new Date(val * 1000).toLocaleString() : '-',
    },
    {
      title: t('affTransfer.adminRemark'),
      dataIndex: 'admin_remark',
      key: 'admin_remark',
      render: (val) => val || '-',
    },
  ];

  const statCards = [
    {
      key: 'count',
      icon: <Users size={20} />,
      label: t('affTransfer.inviteCount'),
      value: affCount,
      gradient: 'linear-gradient(135deg, #3366FF 0%, #00B8D9 100%)',
    },
    {
      key: 'pending',
      icon: <TrendingUp size={20} />,
      label: t('affTransfer.affQuota'),
      value: renderQuota(affQuota),
      gradient: 'linear-gradient(135deg, #6C5CE7 0%, #A8E6CF 100%)',
    },
    {
      key: 'history',
      icon: <BarChart2 size={20} />,
      label: t('affTransfer.affHistoryQuota'),
      value: renderQuota(affHistoryQuota),
      gradient: 'linear-gradient(135deg, #36D399 0%, #00B8D9 100%)',
    },
  ];

  const rebateLogColumns = [
    {
      title: t('affTransfer.rebateType'),
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (val) => {
        const colorMap = { 1: 'blue', 2: 'orange', 3: 'green' };
        const labelMap = {
          1: t('affTransfer.registerBonus'),
          2: t('affTransfer.topUpRebate'),
          3: t('affTransfer.subscriptionReward'),
        };
        return (
          <Tag color={colorMap[val] || 'grey'} size='small'>
            {labelMap[val] || val}
          </Tag>
        );
      },
    },
    {
      title: t('affTransfer.quota'),
      dataIndex: 'quota',
      key: 'quota',
      render: (val) => renderQuota(val),
    },
    {
      title: t('affTransfer.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val) => val ? new Date(val * 1000).toLocaleString() : '-',
    },
  ];

  return (
    <div className='mt-[60px] px-4 pb-8'>
      {/* Invitation Info */}
      <Card className='!rounded-2xl mb-4' bodyStyle={{ padding: '20px' }}>
        <div className='flex flex-wrap items-start gap-6 mb-4'>
          <div>
            <Text className='text-sm opacity-70'>{t('affTransfer.inviteCode')}</Text>
            <div className='flex items-center gap-2 mt-1'>
              <code className='px-3 py-1 rounded-lg text-sm' style={{ background: 'var(--semi-color-fill-0)' }}>
                {affCode || '-'}
              </code>
              {affCode && (
                <Button
                  icon={<Copy size={14} />}
                  size='small'
                  theme='borderless'
                  onClick={() => handleCopy(affCode)}
                />
              )}
            </div>
          </div>
          <div className='flex-1 min-w-0'>
            <Text className='text-sm opacity-70'>{t('affTransfer.inviteLink')}</Text>
            <div className='flex items-center gap-2 mt-1'>
              <code
                className='px-3 py-1 rounded-lg text-sm truncate max-w-[500px]'
                style={{ background: 'var(--semi-color-fill-0)' }}
              >
                {affLink || '-'}
              </code>
              {affLink && (
                <Button
                  icon={<Copy size={14} />}
                  size='small'
                  theme='borderless'
                  onClick={() => handleCopy(affLink)}
                />
              )}
            </div>
          </div>
        </div>

        {/* Stat Cards */}
        <div className='grid grid-cols-1 lg:grid-cols-3 gap-4'>
          {statCards.map(({ key, icon, label, value, gradient }) => (
            <div key={key} className='rounded-2xl p-5 text-white shadow-lg' style={{ background: gradient }}>
              <div className='flex items-center gap-2 text-sm opacity-80 mb-1'>
                {icon}
                {label}
              </div>
              <div className='text-2xl font-bold'>{value}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Rebate Rules */}
      <Card className='!rounded-2xl mb-4' bodyStyle={{ padding: '20px' }}>
        <div className='text-sm font-semibold mb-3 opacity-70'>{t('affTransfer.rebateRules')}</div>
        <div className='space-y-2 text-sm'>
          {(effectiveInviterReward > 0 || effectiveInviteeReward > 0) && (
            <div className='flex items-start gap-2'>
              <Tag color='blue' size='small'>{t('affTransfer.registerBonus')}</Tag>
              <Text type='tertiary'>
                {effectiveInviterReward > 0 && t('affTransfer.inviterGets', { amount: renderQuota(effectiveInviterReward) })}
                {effectiveInviterReward > 0 && effectiveInviteeReward > 0 && '，'}
                {effectiveInviteeReward > 0 && t('affTransfer.inviteeGets', { amount: renderQuota(effectiveInviteeReward) })}
              </Text>
            </div>
          )}
          {effectiveRebatePercent > 0 && effectiveRebateCount !== 0 && (
            <div className='flex items-start gap-2'>
              <Tag color='orange' size='small'>{t('affTransfer.topUpRebate')}</Tag>
              <Text type='tertiary'>
                {effectiveRebateCount === -1
                  ? t('affTransfer.unlimitedRebateRule', { percent: effectiveRebatePercent })
                  : t('affTransfer.limitedRebateRule', { count: effectiveRebateCount, percent: effectiveRebatePercent })}
              </Text>
            </div>
          )}
        </div>
      </Card>

      {/* Rebate Logs */}
      <Card className='!rounded-2xl mb-4' bodyStyle={{ padding: '12px 16px' }}>
        <div className='text-sm font-semibold mb-3 opacity-70'>{t('affTransfer.rebateLogs')}</div>
        <Tabs
          type='button'
          size='small'
          activeKey={String(rebateLogsFilter)}
          onChange={(key) => { setRebateLogsFilter(Number(key)); setRebateLogsPage(1); }}
          style={{ marginBottom: 12 }}
        >
          <TabPane tab={t('affTransfer.all')} itemKey='0' />
          <TabPane tab={t('affTransfer.registerBonus')} itemKey='1' />
          <TabPane tab={t('affTransfer.topUpRebate')} itemKey='2' />
        </Tabs>
        <Table
          columns={rebateLogColumns}
          dataSource={rebateLogs}
          rowKey='id'
          pagination={{
            currentPage: rebateLogsPage,
            pageSize: 10,
            total: rebateLogsTotal,
            onPageChange: setRebateLogsPage,
          }}
          size='small'
        />
      </Card>

      {/* Transfer Request Form */}
      <Card className='!rounded-2xl mb-4' bodyStyle={{ padding: '20px' }}>
        <div className='text-sm font-semibold mb-3 opacity-70'>{t('affTransfer.submitRequest')}</div>
        <div className='flex items-center gap-3'>
          <InputNumber
            value={amount}
            onChange={setAmount}
            min={1}
            max={Math.floor(quotaToDisplayAmount(affQuota)) || 1}
            prefix={getCurrencyConfig().symbol}
            placeholder={t('affTransfer.requestAmount')}
            style={{ width: 240 }}
            disabled={pendingQuota > 0}
          />
          <Button
            icon={<Send size={14} />}
            theme='solid'
            loading={submitting}
            onClick={handleSubmit}
            disabled={pendingQuota > 0}
          >
            {t('affTransfer.submitRequest')}
          </Button>
        </div>
        {pendingQuota > 0 && (
          <div className='mt-3 text-sm' style={{ color: 'var(--semi-color-warning)' }}>
            {t('affTransfer.pendingQuotaHint', { amount: renderQuota(pendingQuota) })}
          </div>
        )}
      </Card>

      {/* Request History */}
      <Card className='!rounded-2xl' bodyStyle={{ padding: '12px 16px' }}>
        <div className='text-sm font-semibold mb-3 opacity-70'>{t('affTransfer.requestHistory')}</div>
        <Table
          columns={columns}
          dataSource={requests}
          rowKey='id'
          loading={loading}
          pagination={{
            currentPage: page,
            pageSize: 10,
            total,
            onPageChange: setPage,
          }}
          size='small'
        />
      </Card>
    </div>
  );
};

export default AffTransfer;
