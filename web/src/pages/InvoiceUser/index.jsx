import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Banner,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Modal,
  Pagination,
  RadioGroup,
  Radio,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  TextArea,
} from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh, IconSearch, IconEyeOpened, IconDownload } from '@douyinfe/semi-icons';

import { showError, showSuccess } from '../../helpers';
import { timestamp2string } from '../../helpers/utils';
import { StatusContext } from '../../context/Status';
import { useInvoiceUserData } from '../../hooks/invoice/useInvoiceUserData';
import INVOICE_GOODS_CATEGORIES, { formatCategoryLabel } from '../../constants/invoiceCategories';

const { Text } = Typography;

const SOURCE_META = {
  topup: { color: 'blue', textKey: 'invoice.sourceTopup' },
  subscription: { color: 'green', textKey: 'invoice.sourceSubscription' },
};

const STATUS_COLOR_MAP = {
  pending: 'orange',
  approved: 'blue',
  rejected: 'red',
  issued: 'green',
  cancelled: 'grey',
};
const STATUS_TEXT_MAP = {
  pending: 'invoice.statusPending',
  approved: 'invoice.statusApproved',
  rejected: 'invoice.statusRejected',
  issued: 'invoice.statusIssued',
  cancelled: 'invoice.statusCancelled',
};

function sumMoney(selectedRows) {
  return (Array.isArray(selectedRows) ? selectedRows : []).reduce((sum, it) => sum + (Number(it?.money) || 0), 0);
}
export default function InvoiceUserPage() {
  const { t } = useTranslation();
  const [statusState] = useContext(StatusContext);
  const {
    items, total, loading, page, setPage, pageSize, setPageSize,
    listInvoiceableOrders, createApplication, presignFile,
    appItems, appTotal, appLoading, appPage, setAppPage, appPageSize, setAppPageSize,
    fetchApplications, fetchApplicationDetail, cancelApplication,
  } = useInvoiceUserData();

  const minInvoiceAmount = Number(statusState?.status?.min_invoice_amount) || 200;

  const [activeTab, setActiveTab] = useState('orders');

  // --- Orders tab state ---
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const selectedRows = useMemo(() => {
    const keySet = new Set(selectedRowKeys);
    return (Array.isArray(items) ? items : []).filter((it) => keySet.has(rowKey(it)));
  }, [items, selectedRowKeys]);
  const [createVisible, setCreateVisible] = useState(false);
  const totalSelectedMoney = useMemo(() => sumMoney(selectedRows), [selectedRows]);

  // --- Applications tab state ---
  const [appKeywordInput, setAppKeywordInput] = useState('');
  const [appKeyword, setAppKeyword] = useState('');
  const [appStatusFilter, setAppStatusFilter] = useState('');
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // --- Orders data loading ---
  const loadOrders = useCallback(() => {
    listInvoiceableOrders(page, pageSize, keyword);
  }, [listInvoiceableOrders, page, pageSize, keyword]);

  useEffect(() => {
    if (activeTab === 'orders') loadOrders();
  }, [activeTab, loadOrders]);

  // --- Applications data loading ---
  const loadApplications = useCallback(() => {
    fetchApplications(appPage, appPageSize, { status: appStatusFilter, keyword: appKeyword });
  }, [fetchApplications, appPage, appPageSize, appStatusFilter, appKeyword]);

  useEffect(() => {
    if (activeTab === 'applications') loadApplications();
  }, [activeTab, loadApplications]);

  // --- Orders handlers ---
  const handleSearch = () => {
    setKeyword(String(keywordInput || '').trim());
    setPage(1);
    setSelectedRowKeys([]);
  };

  const belowMin = selectedRowKeys.length > 0 && totalSelectedMoney < minInvoiceAmount;
  const amountGap = Math.max(0, minInvoiceAmount - totalSelectedMoney);
  const applyDisabled = selectedRowKeys.length === 0 || belowMin;

  const handleApply = () => {
    if (selectedRowKeys.length === 0) {
      showError(t('invoice.noSelection'));
      return;
    }
    if (totalSelectedMoney < minInvoiceAmount) {
      showError(t('invoice.minAmountRequired', { amount: minInvoiceAmount }));
      return;
    }
    setCreateVisible(true);
  };

  const handleCreateSubmit = async ({ invoiceType, title, taxId, email, applyRemark, goodsName, taxClassificationCode, taxRateValue, issueKindCode }) => {
    const out = await createApplication({
      invoiceType, title, taxId, email, applyRemark,
      goodsName, taxClassificationCode, taxRateValue, issueKindCode,
      selectedItems: selectedRows,
    });
    if (out) {
      showSuccess(t('invoice.createSuccess'));
      setCreateVisible(false);
      setSelectedRowKeys([]);
      setPage(1);
      listInvoiceableOrders(1, pageSize, keyword);
    }
  };

  // --- Applications handlers ---
  const handleAppSearch = () => {
    setAppKeyword(String(appKeywordInput || '').trim());
    setAppPage(1);
  };

  const handleShowDetail = async (id) => {
    setDetailVisible(true);
    setDetailLoading(true);
    const data = await fetchApplicationDetail(id);
    setDetailData(data);
    setDetailLoading(false);
  };

  const handleCancel = (id) => {
    Modal.confirm({
      title: t('invoice.cancelConfirm'),
      onOk: async () => {
        const res = await cancelApplication(id);
        if (res !== null) {
          showSuccess(t('invoice.cancelSuccess'));
          loadApplications();
        }
      },
    });
  };

  // --- Orders columns ---
  const ordersColumns = useMemo(
    () => [
      {
        title: t('invoice.sourceType'), dataIndex: 'source_type', width: 140,
        render: (v) => {
          const meta = SOURCE_META[String(v)] || { color: 'grey', textKey: 'invoice.sourceType' };
          return <Tag color={meta.color}>{t(meta.textKey)}</Tag>;
        },
      },
      { title: t('invoice.tradeNo'), dataIndex: 'trade_no', render: (v) => String(v ?? '') },
      {
        title: t('invoice.money'), dataIndex: 'money', width: 140,
        render: (v, record) => {
          const money = Number(v) || 0;
          const currency = String(record?.currency || '').trim();
          return `${money} ${currency || ''}`.trim();
        },
      },
      { title: t('invoice.paymentMethod'), dataIndex: 'payment_method', width: 140, render: (v) => String(v ?? '') },
      {
        title: t('invoice.completeTime'), dataIndex: 'complete_time', width: 180,
        render: (ts) => (ts ? timestamp2string(ts) : '-'),
      },
    ],
    [t],
  );

  // --- Applications columns ---
  const appColumns = useMemo(
    () => [
      { title: t('invoice.id'), dataIndex: 'id', width: 80 },
      {
        title: t('invoice.status'), dataIndex: 'status', width: 120,
        render: (v) => {
          const s = String(v || 'pending');
          return <Tag color={STATUS_COLOR_MAP[s] || 'grey'}>{t(STATUS_TEXT_MAP[s] || s)}</Tag>;
        },
      },
      {
        title: t('invoice.invoiceType'), dataIndex: 'invoice_type', width: 120,
        render: (v) => t(String(v) === 'personal' ? 'invoice.invoiceTypePersonal' : 'invoice.invoiceTypeCompany'),
      },
      {
        title: t('invoice.invoiceKind'), dataIndex: 'issue_kind_code', width: 140,
        render: (v) => t(String(v) === '81' ? 'invoice.invoiceKindSpecial' : 'invoice.invoiceKindNormal'),
      },
      { title: t('invoice.invoiceTitle'), dataIndex: 'title' },
      {
        title: t('invoice.money'), dataIndex: 'total_money', width: 140,
        render: (v, record) => {
          const money = Number(v) || 0;
          const currency = String(record?.currency || '').trim();
          return `${money} ${currency || ''}`.trim();
        },
      },
      {
        title: t('invoice.createdAt'), dataIndex: 'created_at', width: 180,
        render: (ts) => (ts ? timestamp2string(ts) : '-'),
      },
      {
        title: t('invoice.action'), dataIndex: 'id', width: 160,
        render: (_, record) => (
          <Space>
            <Button size='small' theme='borderless' onClick={() => handleShowDetail(record.id)}>
              {t('invoice.viewDetail')}
            </Button>
            {String(record.status) === 'pending' && (
              <Button size='small' theme='borderless' type='danger' onClick={() => handleCancel(record.id)}>
                {t('invoice.cancelApplication')}
              </Button>
            )}
          </Space>
        ),
      },
    ],
    [t, handleShowDetail, handleCancel],
  );

  return (
    <div className='mt-[60px] px-2'>
      <Card>
        <div className='mb-4'>
          <RadioGroup
            type='button'
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value)}
          >
            <Radio value='orders'>{t('invoice.tabInvoiceableOrders')}</Radio>
            <Radio value='applications'>{t('invoice.tabMyApplications')}</Radio>
          </RadioGroup>
        </div>

        {activeTab === 'orders' && (
          <>
            <div className='flex flex-wrap gap-2 items-center justify-between mb-3'>
              <Space>
                <Text type='secondary'>{t('invoice.invoiceableOrdersTitle')}</Text>
                {selectedRowKeys.length > 0 && (
                  <Tag color={belowMin ? 'red' : 'green'} size='large' style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {belowMin
                      ? t('invoice.selectedBelowMin', {
                          count: selectedRowKeys.length,
                          selected: totalSelectedMoney,
                          min: minInvoiceAmount,
                          gap: amountGap,
                        })
                      : t('invoice.selectedOk', {
                          count: selectedRowKeys.length,
                          selected: totalSelectedMoney,
                          min: minInvoiceAmount,
                        })}
                  </Tag>
                )}
              </Space>
              <Space>
                <Button icon={<IconRefresh />} onClick={loadOrders}>{t('invoice.refresh')}</Button>
                <Button icon={<IconPlus />} type='primary' disabled={applyDisabled} onClick={handleApply}>{t('invoice.apply')}</Button>
              </Space>
            </div>
            {belowMin && (
              <Banner
                type='warning'
                fullMode={false}
                closeIcon={null}
                className='mb-3'
                description={t('invoice.minAmountRequiredDetail', {
                  selected: totalSelectedMoney,
                  min: minInvoiceAmount,
                  gap: amountGap,
                })}
              />
            )}
            <div className='flex flex-wrap gap-2 items-center mb-4'>
              <Input prefix={<IconSearch />} placeholder={t('invoice.keywordPlaceholder')} value={keywordInput} onChange={setKeywordInput} style={{ width: 260 }} />
              <Button icon={<IconSearch />} onClick={handleSearch}>{t('invoice.search')}</Button>
              <Text type='secondary'>{t('invoice.minAmountHint', { amount: minInvoiceAmount })}</Text>
              <Text type='secondary' style={{ marginLeft: 'auto' }}>{t('invoice.totalCount', { count: total })}</Text>
            </div>
            <Table columns={ordersColumns} dataSource={items} loading={loading} pagination={false} rowKey={rowKey} empty={<Empty description={t('invoice.empty')} />}
              rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(Array.from(new Set(keys))) }}
            />
            <div className='flex justify-end mt-4'>
              <Pagination total={total} currentPage={page} pageSize={pageSize}
                onPageChange={(p) => { setPage(p); setSelectedRowKeys([]); }}
                onPageSizeChange={(ps) => { setPageSize(ps); setPage(1); setSelectedRowKeys([]); }}
                showSizeChanger pageSizeOpts={[10, 20, 50]}
              />
            </div>
          </>
        )}

        {activeTab === 'applications' && (
          <>
            <div className='flex flex-wrap gap-2 items-center justify-between mb-3'>
              <Text type='secondary'>{t('invoice.tabMyApplications')}</Text>
              <Button icon={<IconRefresh />} onClick={loadApplications}>{t('invoice.refresh')}</Button>
            </div>
            <div className='flex flex-wrap gap-2 items-center mb-4'>
              <Select
                placeholder={t('invoice.status')}
                value={appStatusFilter}
                onChange={(v) => { setAppStatusFilter(v); setAppPage(1); }}
                style={{ width: 160 }}
                optionList={[
                  { value: '', label: t('invoice.allStatus') },
                  { value: 'pending', label: t('invoice.statusPending') },
                  { value: 'approved', label: t('invoice.statusApproved') },
                  { value: 'rejected', label: t('invoice.statusRejected') },
                  { value: 'issued', label: t('invoice.statusIssued') },
                  { value: 'cancelled', label: t('invoice.statusCancelled') },
                ]}
              />
              <Input prefix={<IconSearch />} placeholder={t('invoice.keywordPlaceholder')} value={appKeywordInput} onChange={setAppKeywordInput} style={{ width: 260 }} />
              <Button icon={<IconSearch />} onClick={handleAppSearch}>{t('invoice.search')}</Button>
              <Text type='secondary' style={{ marginLeft: 'auto' }}>{t('invoice.totalCount', { count: appTotal })}</Text>
            </div>
            <Table columns={appColumns} dataSource={appItems} loading={appLoading} pagination={false} rowKey='id' empty={<Empty description={t('invoice.empty')} />} />
            <div className='flex justify-end mt-4'>
              <Pagination total={appTotal} currentPage={appPage} pageSize={appPageSize}
                onPageChange={(p) => setAppPage(p)}
                onPageSizeChange={(ps) => { setAppPageSize(ps); setAppPage(1); }}
                showSizeChanger pageSizeOpts={[10, 20, 50]}
              />
            </div>
          </>
        )}
      </Card>

      <CreateApplicationModal visible={createVisible} onCancel={() => setCreateVisible(false)} onSubmit={handleCreateSubmit} t={t} selectedCount={selectedRows.length} selectedMoney={totalSelectedMoney} />
      <ApplicationDetailModal visible={detailVisible} onClose={() => { setDetailVisible(false); setDetailData(null); }} data={detailData} loading={detailLoading} t={t} presignFile={presignFile} />
    </div>
  );
}

function rowKey(record) {
  const st = String(record?.source_type || '').trim();
  const sid = Number(record?.source_id) || 0;
  return `${st}:${sid}`;
}

function CreateApplicationModal({ visible, onCancel, onSubmit, t, selectedCount, selectedMoney }) {
  const [invoiceType, setInvoiceType] = useState('company');
  const [invoiceKindCode, setInvoiceKindCode] = useState('82');
  const [title, setTitle] = useState('');
  const [taxId, setTaxId] = useState('');
  const [email, setEmail] = useState('');
  const [applyRemark, setApplyRemark] = useState('');
  const [categoryIdx, setCategoryIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setInvoiceType('company');
    setInvoiceKindCode('82');
    setTitle('');
    setTaxId('');
    setEmail('');
    setApplyRemark('');
    setCategoryIdx(0);
    setSubmitting(false);
  }, [visible]);

  const handleOk = async () => {
    if (!String(title || '').trim()) { showError(t('invoice.validationTitleRequired')); return; }
    if (!String(email || '').trim()) { showError(t('invoice.validationEmailRequired')); return; }
    if (String(invoiceType) === 'company' && !String(taxId || '').trim()) { showError(t('invoice.validationTaxIdRequired')); return; }
    setSubmitting(true);
    const cat = INVOICE_GOODS_CATEGORIES[categoryIdx] || INVOICE_GOODS_CATEGORIES[0];
    await onSubmit({
      invoiceType, title, taxId, email, applyRemark,
      goodsName: cat.name,
      taxClassificationCode: cat.code,
      taxRateValue: '0.01',
      issueKindCode: invoiceKindCode,
    });
    setSubmitting(false);
  };

  const categoryOptions = useMemo(() =>
    INVOICE_GOODS_CATEGORIES.map((cat, idx) => ({
      value: idx,
      label: formatCategoryLabel(cat, t),
    })),
  [t]);

  return (
    <Modal title={t('invoice.apply')} visible={visible} onCancel={onCancel} onOk={handleOk} okText={t('invoice.submit')} confirmLoading={submitting} width={720}>
      <div className='flex flex-col gap-3'>
        <Banner type='info' title={t('invoice.selectionSummaryTitle')} description={t('invoice.selectionSummaryBody', { count: selectedCount, money: selectedMoney })} closeIcon={null} className='!rounded-xl' />
        <div>
          <Text type='secondary'>{t('invoice.invoiceType')}</Text>
          <Select value={invoiceType} onChange={setInvoiceType} optionList={[
            { value: 'personal', label: t('invoice.invoiceTypePersonal') },
            { value: 'company', label: t('invoice.invoiceTypeCompany') },
          ]} style={{ width: 220 }} />
        </div>
        <div>
          <Text type='secondary'>{t('invoice.invoiceKind')}</Text>
          <Select value={invoiceKindCode} onChange={setInvoiceKindCode} optionList={[
            { value: '82', label: t('invoice.invoiceKindNormal') },
            { value: '81', label: t('invoice.invoiceKindSpecial') },
          ]} style={{ width: 220 }} />
        </div>
        <div>
          <Text type='secondary'>{t('invoice.goodsCategory')}</Text>
          <Select
            value={categoryIdx}
            onChange={setCategoryIdx}
            optionList={categoryOptions}
            style={{ width: '100%' }}
            placeholder={t('invoice.selectCategory')}
          />
        </div>
        <div>
          <Text type='secondary'>{t('invoice.invoiceTitle')}</Text>
          <TextArea value={title} onChange={setTitle} rows={1} placeholder={t('invoice.invoiceTitlePlaceholder')} />
        </div>
        {String(invoiceType) === 'company' && (
          <div>
            <Text type='secondary'>{t('invoice.taxId')}</Text>
            <TextArea value={taxId} onChange={setTaxId} rows={1} placeholder={t('invoice.taxIdPlaceholder')} />
          </div>
        )}
        <div>
          <Text type='secondary'>{t('invoice.email')}</Text>
          <TextArea value={email} onChange={setEmail} rows={1} placeholder={t('invoice.emailPlaceholder')} />
        </div>
        <div>
          <Text type='secondary'>{t('invoice.applyRemark')}</Text>
          <TextArea value={applyRemark} onChange={setApplyRemark} rows={3} placeholder={t('invoice.applyRemarkPlaceholder')} />
        </div>
        <div className='flex items-center gap-2'>
          <Checkbox checked disabled />
          <Text type='tertiary' size='small'>{t('invoice.noApplicationsListHint')}</Text>
        </div>
      </div>
    </Modal>
  );
}

function ApplicationDetailModal({ visible, onClose, data, loading, t, presignFile }) {
  const app = data?.application || null;
  const statusStr = String(app?.status || 'pending');
  const files = Array.isArray(data?.files) ? data.files : [];
  const items = Array.isArray(data?.items) ? data.items : [];

  const handlePreview = async (fileId) => {
    const result = await presignFile(fileId, { disposition: 'inline' });
    if (result?.url) window.open(result.url, '_blank');
  };

  const handleDownload = async (fileId) => {
    const result = await presignFile(fileId, { disposition: 'attachment' });
    if (result?.url) window.open(result.url, '_blank');
  };

  const itemColumns = [
    {
      title: t('invoice.sourceType'), dataIndex: 'source_type', width: 120,
      render: (v) => {
        const meta = SOURCE_META[String(v)] || { color: 'grey', textKey: 'invoice.sourceType' };
        return <Tag color={meta.color}>{t(meta.textKey)}</Tag>;
      },
    },
    { title: t('invoice.tradeNo'), dataIndex: 'trade_no', render: (v) => String(v ?? '') },
    {
      title: t('invoice.money'), dataIndex: 'money', width: 120,
      render: (v) => `${Number(v) || 0}`,
    },
    { title: t('invoice.paymentMethod'), dataIndex: 'payment_method', width: 120, render: (v) => String(v ?? '') },
    {
      title: t('invoice.completeTime'), dataIndex: 'complete_time', width: 170,
      render: (ts) => (ts ? timestamp2string(ts) : '-'),
    },
  ];

  return (
    <Modal
      title={t('invoice.applicationDetail')}
      visible={visible}
      onCancel={onClose}
      footer={<Button onClick={onClose}>{t('invoice.view')}</Button>}
      width={800}
    >
      {loading ? (
        <div className='flex justify-center py-8'><Spin size='large' /></div>
      ) : app ? (
        <div className='flex flex-col gap-4'>
          <div className='grid grid-cols-2 gap-x-6 gap-y-2'>
            <div><Text type='secondary'>{t('invoice.invoiceType')}: </Text><Text>{t(String(app.invoice_type) === 'personal' ? 'invoice.invoiceTypePersonal' : 'invoice.invoiceTypeCompany')}</Text></div>
            <div><Text type='secondary'>{t('invoice.invoiceKind')}: </Text><Text>{t(String(app.issue_kind_code) === '81' ? 'invoice.invoiceKindSpecial' : 'invoice.invoiceKindNormal')}</Text></div>
            <div><Text type='secondary'>{t('invoice.status')}: </Text><Tag color={STATUS_COLOR_MAP[statusStr] || 'grey'}>{t(STATUS_TEXT_MAP[statusStr] || statusStr)}</Tag></div>
            <div><Text type='secondary'>{t('invoice.invoiceTitle')}: </Text><Text>{String(app.title || '')}</Text></div>
            <div><Text type='secondary'>{t('invoice.money')}: </Text><Text>{`${Number(app.total_money) || 0} ${String(app.currency || '').trim()}`.trim()}</Text></div>
            {app.tax_id && <div><Text type='secondary'>{t('invoice.taxId')}: </Text><Text>{app.tax_id}</Text></div>}
            <div><Text type='secondary'>{t('invoice.email')}: </Text><Text>{String(app.email || '')}</Text></div>
            <div><Text type='secondary'>{t('invoice.createdAt')}: </Text><Text>{app.created_at ? timestamp2string(app.created_at) : '-'}</Text></div>
            {app.updated_at && <div><Text type='secondary'>{t('invoice.updatedAt')}: </Text><Text>{timestamp2string(app.updated_at)}</Text></div>}
          </div>
          {app.apply_remark && (
            <div><Text type='secondary'>{t('invoice.applyRemark')}: </Text><Text>{app.apply_remark}</Text></div>
          )}
          {app.admin_remark && (
            <div><Text type='secondary'>{t('invoice.adminRemark')}: </Text><Text>{app.admin_remark}</Text></div>
          )}
          {app.reject_reason && (
            <Banner type='warning' description={`${t('invoice.rejectReason')}: ${app.reject_reason}`} closeIcon={null} className='!rounded-xl' />
          )}

          {items.length > 0 && (
            <>
              <Text strong>{t('invoice.orderItems')}</Text>
              <Table columns={itemColumns} dataSource={items} pagination={false} rowKey={(r, i) => `${r.source_type}:${r.source_id || i}`} size='small' />
            </>
          )}

          {files.length > 0 && (
            <>
              <Text strong>{t('invoice.files')}</Text>
              <div className='flex flex-col gap-2'>
                {files.map((f) => (
                  <div key={f.id} className='flex items-center gap-2 p-2 rounded bg-gray-50'>
                    <Text style={{ flex: 1 }}>{String(f.original_filename || `#${f.id}`)}</Text>
                    <Button size='small' icon={<IconEyeOpened />} theme='borderless' onClick={() => handlePreview(f.id)} />
                    <Button size='small' icon={<IconDownload />} theme='borderless' onClick={() => handleDownload(f.id)} />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <Empty description={t('invoice.empty')} />
      )}
    </Modal>
  );
}