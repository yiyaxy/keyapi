import React, { useState } from 'react';
import { Card, Table, Button, Input, Tag, Typography, Modal, Select, TextArea } from '@douyinfe/semi-ui';
import { RefreshCw, Check, X, Search, CheckCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { renderQuota } from '../../helpers';
import { useAffTransferAdminData } from '../../hooks/aff-transfer/useAffTransferAdminData';

const { Text } = Typography;

const AffTransferAdmin = () => {
  const { t } = useTranslation();
  const {
    loading,
    requests,
    stats,
    page,
    total,
    keyword,
    status,
    setPage,
    setKeyword,
    setStatus,
    processRequest,
    refreshData,
    batchApproveAll,
  } = useAffTransferAdminData(t);

  const [modalVisible, setModalVisible] = useState(false);
  const [modalAction, setModalAction] = useState(null); // 2=approve, 3=reject, batch=all
  const [modalRecord, setModalRecord] = useState(null);
  const [adminRemark, setAdminRemark] = useState('');

  const statusMap = {
    1: { color: 'amber', text: t('affTransfer.pending') },
    2: { color: 'green', text: t('affTransfer.approved') },
    3: { color: 'red', text: t('affTransfer.rejected') },
  };

  const openModal = (record, action) => {
    setModalRecord(record);
    setModalAction(action);
    setAdminRemark('');
    setModalVisible(true);
  };

  const handleConfirm = async () => {
    if (modalAction === 'batch') {
      await batchApproveAll(adminRemark);
    } else if (modalRecord && modalAction) {
      await processRequest(modalRecord.id, modalAction, adminRemark);
    }
    setModalVisible(false);
    setModalRecord(null);
    setModalAction(null);
    setAdminRemark('');
  };

  const openBatchApproveModal = () => {
    setModalRecord(null);
    setModalAction('batch');
    setAdminRemark('');
    setModalVisible(true);
  };

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: t('affTransfer.username'),
      dataIndex: 'username',
      key: 'username',
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
        const s = statusMap[val];
        return s ? <Tag color={s.color}>{s.text}</Tag> : <Tag>{val}</Tag>;
      },
    },
    {
      title: t('affTransfer.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val) => new Date(val * 1000).toLocaleString(),
    },
    {
      title: t('affTransfer.adminRemark'),
      dataIndex: 'admin_remark',
      key: 'admin_remark',
      render: (val) => val || '-',
    },
    {
      title: t('affTransfer.actions'),
      key: 'actions',
      width: 200,
      render: (text, record) => {
        if (record.status !== 1) return null;
        return (
          <div className='flex gap-2'>
            <Button
              size='small'
              type='primary'
              theme='solid'
              icon={<Check size={14} />}
              onClick={() => openModal(record, 2)}
            >
              {t('affTransfer.approve')}
            </Button>
            <Button
              size='small'
              type='danger'
              theme='solid'
              icon={<X size={14} />}
              onClick={() => openModal(record, 3)}
            >
              {t('affTransfer.reject')}
            </Button>
          </div>
        );
      },
    },
  ];

  const statsCards = [
    {
      key: 'pending',
      label: t('affTransfer.stats.pending'),
      value: stats.pending_count,
      gradient: 'linear-gradient(135deg, #FF6B6B 0%, #FFD93D 100%)',
    },
    {
      key: 'approved',
      label: t('affTransfer.stats.approved'),
      value: stats.approved_count,
      gradient: 'linear-gradient(135deg, #36D399 0%, #00B8D9 100%)',
    },
    {
      key: 'total_quota',
      label: t('affTransfer.stats.totalQuota'),
      value: renderQuota(stats.approved_total_quota),
      gradient: 'linear-gradient(135deg, #3366FF 0%, #00B8D9 100%)',
    },
  ];

  return (
    <div className='mt-[60px] px-4 pb-8'>
      <div className='grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4'>
        {statsCards.map(({ key, label, value, gradient }) => (
          <div key={key} className='rounded-2xl p-5 text-white shadow-lg' style={{ background: gradient }}>
            <div className='text-sm opacity-80 mb-1'>{label}</div>
            <div className='text-2xl font-bold'>{value}</div>
          </div>
        ))}
      </div>

      <Card className='!rounded-2xl mb-4' bodyStyle={{ padding: '12px 20px' }}>
        <div className='flex flex-wrap items-center gap-4'>
          <Select
            size='small'
            value={status}
            onChange={setStatus}
            style={{ width: 150 }}
            placeholder={t('affTransfer.status')}
          >
            <Select.Option value=''>{t('affTransfer.all')}</Select.Option>
            <Select.Option value='1'>{t('affTransfer.pending')}</Select.Option>
            <Select.Option value='2'>{t('affTransfer.approved')}</Select.Option>
            <Select.Option value='3'>{t('affTransfer.rejected')}</Select.Option>
          </Select>
          <Input
            size='small'
            prefix={<Search size={14} />}
            placeholder={t('affTransfer.username')}
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
            {t('affTransfer.refresh')}
          </Button>
          <Button
            icon={<CheckCheck size={14} />}
            size='small'
            type='primary'
            theme='solid'
            onClick={openBatchApproveModal}
            disabled={!stats.pending_count}
          >
            {t('affTransfer.batchApprove')}
          </Button>
        </div>
      </Card>

      <Card className='!rounded-2xl' bodyStyle={{ padding: '12px 16px' }}>
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

      <Modal
        title={
          modalAction === 'batch'
            ? t('affTransfer.confirmBatchApprove')
            : modalAction === 2
            ? t('affTransfer.confirmApprove')
            : t('affTransfer.confirmReject')
        }
        visible={modalVisible}
        onOk={handleConfirm}
        onCancel={() => setModalVisible(false)}
      >
        {modalAction === 'batch' ? (
          <div className='mb-4'>
            <Text>{t('affTransfer.batchApproveHint', { count: stats.pending_count })}</Text>
          </div>
        ) : (
          modalRecord && (
            <div className='mb-4'>
              <Text>ID: {modalRecord.id} | {modalRecord.username} | {renderQuota(modalRecord.quota)}</Text>
            </div>
          )
        )}
        <TextArea
          placeholder={t('affTransfer.remarkPlaceholder')}
          value={adminRemark}
          onChange={setAdminRemark}
          rows={3}
        />
      </Modal>
    </div>
  );
};

export default AffTransferAdmin;
