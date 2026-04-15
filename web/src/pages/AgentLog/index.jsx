import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Pagination,
  Select,
  Space,
  Table,
  Tag,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh, IconSearch, IconDelete } from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../../helpers';
import { timestamp2string } from '../../helpers/utils';

const { Text } = Typography;

const STATUS_MAP = {
  running: { color: 'blue', label: 'agentLog.statusRunning' },
  success: { color: 'green', label: 'agentLog.statusSuccess' },
  failed: { color: 'red', label: 'agentLog.statusFailed' },
};

const CATEGORY_MAP = {
  production: { color: 'red', label: 'agentLog.categoryProduction' },
  local: { color: 'blue', label: 'agentLog.categoryLocal' },
  readonly: { color: 'green', label: 'agentLog.categoryReadonly' },
};

export default function AgentLogPage() {
  const { t } = useTranslation();
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [agentFilter, setAgentFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');

  const [createVisible, setCreateVisible] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailData, setDetailData] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, page_size: pageSize });
      if (agentFilter) params.set('agent_name', agentFilter);
      if (categoryFilter) params.set('category', categoryFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (keyword) params.set('keyword', keyword);
      const res = await API.get(`/api/agent-logs?${params}`);
      if (res.data.success) {
        setData(res.data.data || []);
        setTotal(res.data.total || 0);
      }
    } catch {
      showError(t('agentLog.loadFailed'));
    }
    setLoading(false);
  }, [page, pageSize, agentFilter, categoryFilter, statusFilter, keyword, t]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSearch = () => {
    setKeyword(keywordInput.trim());
    setPage(1);
  };

  const handleDelete = (id) => {
    Modal.confirm({
      title: t('agentLog.deleteConfirm'),
      onOk: async () => {
        try {
          const res = await API.delete(`/api/agent-logs/${id}`);
          if (res.data.success) {
            showSuccess(t('agentLog.deleteSuccess'));
            loadData();
          }
        } catch {
          showError(t('agentLog.deleteFailed'));
        }
      },
    });
  };

  const agentOptions = useMemo(() => {
    const names = [...new Set(data.map((d) => d.agent_name).filter(Boolean))];
    return [{ value: '', label: t('agentLog.allAgents') }, ...names.map((n) => ({ value: n, label: n }))];
  }, [data, t]);

  const columns = useMemo(
    () => [
      { title: 'ID', dataIndex: 'id', width: 60 },
      {
        title: t('agentLog.agentName'),
        dataIndex: 'agent_name',
        width: 120,
        render: (v) => <Tag color='purple'>{v}</Tag>,
      },
      {
        title: t('agentLog.createdAt'),
        dataIndex: 'created_at',
        width: 170,
        render: (ts) => (ts ? timestamp2string(ts) : '-'),
      },
      {
        title: t('agentLog.category'),
        dataIndex: 'category',
        width: 140,
        render: (v) => {
          const meta = CATEGORY_MAP[v] || CATEGORY_MAP.readonly;
          return <Tag color={meta.color}>{t(meta.label)}</Tag>;
        },
      },
      {
        title: t('agentLog.action'),
        dataIndex: 'action',
        render: (v) => (
          <code style={{ fontSize: 12, padding: '2px 6px', background: '#f1f5f9', borderRadius: 4, wordBreak: 'break-all' }}>
            {v}
          </code>
        ),
      },
      {
        title: t('agentLog.description'),
        dataIndex: 'description',
        width: 200,
        ellipsis: true,
        render: (v) => v || '-',
      },
      {
        title: t('agentLog.status'),
        dataIndex: 'status',
        width: 90,
        render: (v) => {
          const meta = STATUS_MAP[v] || STATUS_MAP.running;
          return <Tag color={meta.color}>{t(meta.label)}</Tag>;
        },
      },
      {
        title: t('agentLog.actions'),
        dataIndex: 'id',
        width: 80,
        render: (_, record) => (
          <Space>
            <Button size='small' theme='borderless' onClick={() => { setDetailData(record); setDetailVisible(true); }}>
              {t('agentLog.view')}
            </Button>
            <Button size='small' icon={<IconDelete />} theme='borderless' type='danger' onClick={() => handleDelete(record.id)} />
          </Space>
        ),
      },
    ],
    [t],
  );

  return (
    <div className='mt-[60px] px-2'>
      <Card>
        <div className='flex flex-wrap gap-2 items-center justify-between mb-3'>
          <Text strong size='large'>{t('agentLog.title')}</Text>
          <Space>
            <Button icon={<IconRefresh />} onClick={loadData}>{t('agentLog.refresh')}</Button>
            <Button icon={<IconPlus />} type='primary' onClick={() => setCreateVisible(true)}>{t('agentLog.create')}</Button>
          </Space>
        </div>

        <div className='flex flex-wrap gap-2 items-center mb-4'>
          <Select
            placeholder={t('agentLog.agentName')}
            value={agentFilter}
            onChange={(v) => { setAgentFilter(v); setPage(1); }}
            style={{ width: 150 }}
            optionList={agentOptions}
          />
          <Select
            placeholder={t('agentLog.category')}
            value={categoryFilter}
            onChange={(v) => { setCategoryFilter(v); setPage(1); }}
            style={{ width: 170 }}
            optionList={[
              { value: '', label: t('agentLog.allCategories') },
              { value: 'production', label: t('agentLog.categoryProduction') },
              { value: 'local', label: t('agentLog.categoryLocal') },
              { value: 'readonly', label: t('agentLog.categoryReadonly') },
            ]}
          />
          <Select
            placeholder={t('agentLog.status')}
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
            style={{ width: 120 }}
            optionList={[
              { value: '', label: t('agentLog.allStatus') },
              { value: 'running', label: t('agentLog.statusRunning') },
              { value: 'success', label: t('agentLog.statusSuccess') },
              { value: 'failed', label: t('agentLog.statusFailed') },
            ]}
          />
          <Input prefix={<IconSearch />} placeholder={t('agentLog.searchPlaceholder')} value={keywordInput} onChange={setKeywordInput} style={{ width: 220 }} onEnterPress={handleSearch} />
          <Button icon={<IconSearch />} onClick={handleSearch}>{t('agentLog.search')}</Button>
          <Text type='secondary' style={{ marginLeft: 'auto' }}>{t('agentLog.totalCount', { count: total })}</Text>
        </div>

        <Table columns={columns} dataSource={data} loading={loading} pagination={false} rowKey='id' empty={<Empty description={t('agentLog.empty')} />} />

        <div className='flex justify-end mt-4'>
          <Pagination
            total={total} currentPage={page} pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(ps) => { setPageSize(ps); setPage(1); }}
            showSizeChanger pageSizeOpts={[10, 20, 50]}
          />
        </div>
      </Card>

      <CreateLogModal visible={createVisible} onCancel={() => setCreateVisible(false)} onSuccess={() => { setCreateVisible(false); loadData(); }} t={t} />

      <Modal
        title={t('agentLog.detailTitle')}
        visible={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={<Button onClick={() => setDetailVisible(false)}>{t('agentLog.close')}</Button>}
        width={680}
      >
        {detailData && (
          <div className='flex flex-col gap-3'>
            <div className='grid grid-cols-2 gap-x-6 gap-y-2'>
              <div><Text type='secondary'>ID: </Text><Text>{detailData.id}</Text></div>
              <div><Text type='secondary'>{t('agentLog.agentName')}: </Text><Tag color='purple'>{detailData.agent_name}</Tag></div>
              <div><Text type='secondary'>{t('agentLog.category')}: </Text><Tag color={CATEGORY_MAP[detailData.category]?.color || 'grey'}>{t(CATEGORY_MAP[detailData.category]?.label || detailData.category)}</Tag></div>
              <div><Text type='secondary'>{t('agentLog.status')}: </Text><Tag color={STATUS_MAP[detailData.status]?.color || 'grey'}>{t(STATUS_MAP[detailData.status]?.label || detailData.status)}</Tag></div>
              <div><Text type='secondary'>{t('agentLog.createdAt')}: </Text><Text>{detailData.created_at ? timestamp2string(detailData.created_at) : '-'}</Text></div>
            </div>
            <div>
              <Text type='secondary'>{t('agentLog.action')}: </Text>
              <div className='mt-1 p-3 rounded-lg' style={{ background: '#1e293b', color: '#e2e8f0', fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                $ {detailData.action}
              </div>
            </div>
            {detailData.description && (
              <div><Text type='secondary'>{t('agentLog.description')}: </Text><Text>{detailData.description}</Text></div>
            )}
            {detailData.detail && (
              <div>
                <Text type='secondary'>{t('agentLog.detail')}: </Text>
                <div className='mt-1 p-3 bg-gray-50 rounded-lg' style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 400, overflow: 'auto', fontSize: 13 }}>
                  {detailData.detail}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function CreateLogModal({ visible, onCancel, onSuccess, t }) {
  const [agentName, setAgentName] = useState('');
  const [category, setCategory] = useState('readonly');
  const [action, setAction] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('success');
  const [detail, setDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setAgentName('');
    setCategory('readonly');
    setAction('');
    setDescription('');
    setStatus('success');
    setDetail('');
    setSubmitting(false);
  }, [visible]);

  const handleOk = async () => {
    if (!agentName.trim()) { showError(t('agentLog.agentNameRequired')); return; }
    if (!action.trim()) { showError(t('agentLog.actionRequired')); return; }
    setSubmitting(true);
    try {
      const res = await API.post('/api/agent-logs', {
        agent_name: agentName.trim(),
        category,
        action: action.trim(),
        description: description.trim(),
        status,
        detail: detail.trim(),
      });
      if (res.data.success) {
        showSuccess(t('agentLog.createSuccess'));
        onSuccess();
      }
    } catch {
      showError(t('agentLog.createFailed'));
    }
    setSubmitting(false);
  };

  return (
    <Modal title={t('agentLog.create')} visible={visible} onCancel={onCancel} onOk={handleOk} okText={t('agentLog.submit')} confirmLoading={submitting} width={600}>
      <div className='flex flex-col gap-3'>
        <div>
          <Text type='secondary'>{t('agentLog.agentName')}</Text>
          <Input value={agentName} onChange={setAgentName} placeholder={t('agentLog.agentNamePlaceholder')} />
        </div>
        <div>
          <Text type='secondary'>{t('agentLog.category')}</Text>
          <Select value={category} onChange={setCategory} style={{ width: '100%' }} optionList={[
            { value: 'production', label: t('agentLog.categoryProduction') },
            { value: 'local', label: t('agentLog.categoryLocal') },
            { value: 'readonly', label: t('agentLog.categoryReadonly') },
          ]} />
        </div>
        <div>
          <Text type='secondary'>{t('agentLog.action')}</Text>
          <Input value={action} onChange={setAction} placeholder={t('agentLog.actionPlaceholder')} />
        </div>
        <div>
          <Text type='secondary'>{t('agentLog.description')}</Text>
          <Input value={description} onChange={setDescription} placeholder={t('agentLog.descriptionPlaceholder')} />
        </div>
        <div>
          <Text type='secondary'>{t('agentLog.status')}</Text>
          <Select value={status} onChange={setStatus} style={{ width: '100%' }} optionList={[
            { value: 'running', label: t('agentLog.statusRunning') },
            { value: 'success', label: t('agentLog.statusSuccess') },
            { value: 'failed', label: t('agentLog.statusFailed') },
          ]} />
        </div>
        <div>
          <Text type='secondary'>{t('agentLog.detail')}</Text>
          <TextArea value={detail} onChange={setDetail} rows={3} placeholder={t('agentLog.detailPlaceholder')} />
        </div>
      </div>
    </Modal>
  );
}
