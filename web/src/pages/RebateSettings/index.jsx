import React, { useState } from 'react';
import { Card, Table, Button, Input, Modal, InputNumber, SideSheet, Typography, Select } from '@douyinfe/semi-ui';
import { RefreshCw, Plus, Trash2, Edit2, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { renderQuota, showError, getQuotaPerUnit, getCurrencyConfig } from '../../helpers';
import { useRebateSettingsData } from '../../hooks/rebate-settings/useRebateSettingsData';

const { Text } = Typography;

const initialForm = {
  id: 0,
  inviter_id: undefined,
  inviter_label: '',
  register_reward: 0,
  invitee_reward: 0,
  top_up_rebate_count: 0,
  top_up_rebate_percent: 0,
  subscription_rebate_count: 0,
};

const RebateSettings = () => {
  const { t } = useTranslation();
  const {
    loading,
    settings,
    page,
    total,
    keyword,
    setPage,
    setKeyword,
    saveSetting,
    deleteSetting,
    refreshData,
    searchUsers,
  } = useRebateSettingsData(t);
  const [visible, setVisible] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [inviterOptions, setInviterOptions] = useState([]);

  const openCreate = () => {
    setForm(initialForm);
    setInviterOptions([]);
    setVisible(true);
  };

  const openEdit = (record) => {
    const label = record.inviter_username
      ? `${record.inviter_username} #${record.inviter_id}`
      : `#${record.inviter_id}`;
    setInviterOptions([{ value: record.inviter_id, label }]);
    const qpu = getQuotaPerUnit();
    setForm({
      id: record.id,
      inviter_id: record.inviter_id,
      inviter_label: label,
      register_reward: record.register_reward / qpu,
      invitee_reward: record.invitee_reward / qpu,
      top_up_rebate_count: record.top_up_rebate_count,
      top_up_rebate_percent: record.top_up_rebate_percent,
      subscription_rebate_count: record.subscription_rebate_count,
    });
    setVisible(true);
  };

  const handleInviterSearch = async (keyword) => {
    const results = await searchUsers(keyword);
    setInviterOptions(results);
  };

  const handleSave = async () => {
    if (!form.inviter_id || form.inviter_id <= 0) {
      showError(t('rebateSettings.inviterId'));
      return;
    }
    const qpu = getQuotaPerUnit();
    const payload = {
      ...form,
      register_reward: Math.round(form.register_reward * qpu),
      invitee_reward: Math.round(form.invitee_reward * qpu),
    };
    const ok = await saveSetting(payload);
    if (ok) {
      setVisible(false);
      setForm(initialForm);
    }
  };

  const handleDelete = (record) => {
    Modal.confirm({
      title: t('rebateSettings.deleteOverride'),
      content: t('rebateSettings.confirmDelete'),
      onOk: async () => {
        await deleteSetting(record.id);
      },
    });
  };

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: t('rebateSettings.inviterId'),
      dataIndex: 'inviter_id',
      key: 'inviter_id',
      width: 180,
      render: (_, record) => record.inviter_username ? `${record.inviter_username} (#${record.inviter_id})` : `#${record.inviter_id}`,
    },
    {
      title: t('rebateSettings.inviterUsername'),
      dataIndex: 'inviter_username',
      key: 'inviter_username',
      render: (val) => val || '-',
    },
    {
      title: t('rebateSettings.registerReward'),
      dataIndex: 'register_reward',
      key: 'register_reward',
      render: (val) => renderQuota(val),
    },
    {
      title: t('rebateSettings.inviteeReward'),
      dataIndex: 'invitee_reward',
      key: 'invitee_reward',
      render: (val) => renderQuota(val),
    },
    {
      title: t('rebateSettings.rebateCount'),
      dataIndex: 'top_up_rebate_count',
      key: 'top_up_rebate_count',
      render: (val) => (val === -1 ? t('rebateSettings.unlimited') : val),
    },
    {
      title: t('rebateSettings.rebatePercent'),
      dataIndex: 'top_up_rebate_percent',
      key: 'top_up_rebate_percent',
      render: (val) => `${val}%`,
    },
    {
      title: t('rebateSettings.subscriptionRebateCount'),
      dataIndex: 'subscription_rebate_count',
      key: 'subscription_rebate_count',
      render: (val) => (val === -1 ? t('rebateSettings.unlimited') : val),
    },
    {
      title: t('rebateSettings.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val) => new Date(val * 1000).toLocaleString(),
    },
    {
      title: t('rebateSettings.actions'),
      key: 'actions',
      width: 160,
      render: (_, record) => (
        <div className='flex gap-2'>
          <Button size='small' icon={<Edit2 size={14} />} onClick={() => openEdit(record)}>
            {t('rebateSettings.edit')}
          </Button>
          <Button size='small' type='danger' icon={<Trash2 size={14} />} onClick={() => handleDelete(record)}>
            {t('rebateSettings.delete')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className='mt-[60px] px-4 pb-8'>
      <Card className='!rounded-2xl mb-4' bodyStyle={{ padding: '12px 20px' }}>
        <div className='flex flex-wrap items-center justify-between gap-4'>
          <div className='flex flex-wrap items-center gap-4'>
            <Input
              size='small'
              prefix={<Search size={14} />}
              placeholder={t('rebateSettings.inviterUsername')}
              value={keyword}
              onChange={setKeyword}
              style={{ width: 220 }}
            />
            <Button
              icon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}
              size='small'
              onClick={refreshData}
              loading={loading}
            >
              {t('rebateSettings.refresh')}
            </Button>
          </div>
          <Button type='primary' icon={<Plus size={14} />} onClick={openCreate}>
            {t('rebateSettings.addOverride')}
          </Button>
        </div>
      </Card>

      <Card className='!rounded-2xl' bodyStyle={{ padding: '12px 16px' }}>
        <Table
          columns={columns}
          dataSource={settings}
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

      <SideSheet
        title={form.id > 0 ? t('rebateSettings.editOverride') : t('rebateSettings.addOverride')}
        visible={visible}
        onCancel={() => setVisible(false)}
      >
        <div className='space-y-4'>
          <div>
            <Text>{t('rebateSettings.inviterId')}</Text>
            <Select
              remote
              filter
              placeholder={t('rebateSettings.searchInviter') || 'Search user by ID or username'}
              value={form.inviter_id}
              optionList={inviterOptions}
              onSearch={handleInviterSearch}
              onChange={(value) => setForm((prev) => ({ ...prev, inviter_id: value }))}
              style={{ width: '100%' }}
              disabled={form.id > 0}
            />
          </div>
          <div>
            <Text>{t('rebateSettings.registerReward')}</Text>
            <InputNumber
              min={0}
              step={0.01}
              prefix={getCurrencyConfig().symbol}
              value={form.register_reward}
              onChange={(value) => setForm((prev) => ({ ...prev, register_reward: value ?? 0 }))}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <Text>{t('rebateSettings.inviteeReward')}</Text>
            <InputNumber
              min={0}
              step={0.01}
              prefix={getCurrencyConfig().symbol}
              value={form.invitee_reward}
              onChange={(value) => setForm((prev) => ({ ...prev, invitee_reward: value ?? 0 }))}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <Text>{t('rebateSettings.rebateCount')}</Text>
            <InputNumber
              value={form.top_up_rebate_count}
              onChange={(value) => setForm((prev) => ({ ...prev, top_up_rebate_count: value ?? 0 }))}
              style={{ width: '100%' }}
            />
            <div className='mt-1 text-xs text-gray-500'>{t('rebateSettings.rebateCountHint')}</div>
          </div>
          <div>
            <Text>{t('rebateSettings.rebatePercent')}</Text>
            <InputNumber
              min={0}
              max={100}
              value={form.top_up_rebate_percent}
              onChange={(value) => setForm((prev) => ({ ...prev, top_up_rebate_percent: value ?? 0 }))}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <Text>{t('rebateSettings.subscriptionRebateCount')}</Text>
            <InputNumber
              value={form.subscription_rebate_count}
              onChange={(value) => setForm((prev) => ({ ...prev, subscription_rebate_count: value ?? 0 }))}
              style={{ width: '100%' }}
            />
            <div className='mt-1 text-xs text-gray-500'>{t('rebateSettings.subscriptionRebateCountHint')}</div>
          </div>
          <Button type='primary' theme='solid' onClick={handleSave} className='mt-4 w-full'>
            {t('rebateSettings.save')}
          </Button>
        </div>
      </SideSheet>
    </div>
  );
};

export default RebateSettings;
