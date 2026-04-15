import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Banner,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Pagination,
  Progress,
  RadioGroup,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  TextArea,
  Tooltip,
  Typography,
  Switch,
} from '@douyinfe/semi-ui';
import { IconRefresh, IconSearch, IconDownload } from '@douyinfe/semi-icons';

import { showError, showSuccess } from '../../helpers';
import { timestamp2string } from '../../helpers/utils';
import { useInvoiceAdminData } from '../../hooks/invoice/useInvoiceAdminData';
import INVOICE_GOODS_CATEGORIES, { formatCategoryLabel } from '../../constants/invoiceCategories';

const { Text } = Typography;

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

const ISSUE_STATUS_COLOR_MAP = {
  none: 'grey',
  pending_issue: 'orange',
  issuing: 'blue',
  querying: 'blue',
  issue_success: 'green',
  issue_failed: 'red',
  file_ready: 'green',
};
const ISSUE_STATUS_TEXT_MAP = {
  none: 'invoice.issueStatusNone',
  pending_issue: 'invoice.issueStatusPendingIssue',
  issuing: 'invoice.issueStatusIssuing',
  querying: 'invoice.issueStatusQuerying',
  issue_success: 'invoice.issueStatusIssueSuccess',
  issue_failed: 'invoice.issueStatusIssueFailed',
  file_ready: 'invoice.issueStatusFileReady',
};

const PROVIDER_TEXT_MAP = {
  manual: 'invoice.providerManual',
  piaotong: 'invoice.providerPiaoTong',
};

const FILE_FETCH_STATUS_TEXT_MAP = {
  ready: 'invoice.fileFetchReady',
  failed: 'invoice.fileFetchFailed',
  pending: 'invoice.fileFetchPending',
};

const SOURCE_TYPE_META = {
  topup: { color: 'blue', textKey: 'invoice.sourceTypeTopup' },
  subscription: { color: 'green', textKey: 'invoice.sourceTypeSubscription' },
};

function safeFileName(file) {
  if (!file) return '';
  return String(file?.name || '').trim() || 'file';
}

function shouldQueryInvoiceStatus(application) {
  if (!application) return false;

  const provider = String(application?.provider || '').trim();
  const status = String(application?.status || '').trim();
  const issueStatus = String(application?.issue_status || '').trim();
  const reqSerialNo = String(application?.piaotong_invoice_req_serial_no || '').trim();

  if (provider !== 'piaotong') return false;
  if (!reqSerialNo) return false;
  if (!['approved', 'issued'].includes(status)) return false;

  return ['querying', 'issuing', 'issue_success'].includes(issueStatus);
}

export default function InvoiceAdminPage() {
  const { t } = useTranslation();
  const {
    presignAndUpload,
    finalizeInvoiceFiles,
    presignFile,
    appItems,
    appTotal,
    appLoading,
    appPage,
    setAppPage,
    appPageSize,
    setAppPageSize,
    fetchApplications,
    fetchApplicationDetail,
    updateApplicationStatus,
    queryApplicationStatus,
    issueApplication,
    setItemPaymentInfo,
    redInvoice,
    updateFileUserVisibility,
  } = useInvoiceAdminData();

  const [activeTab, setActiveTab] = useState('applications');

  // ---- Applications tab state ----
  const [statusFilter, setStatusFilter] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [userIdInput, setUserIdInput] = useState('');
  const [userIdFilter, setUserIdFilter] = useState('');

  const [detailVisible, setDetailVisible] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState(null);

  // ---- Upload tab state ----
  const [invoiceId, setInvoiceId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadFiles, setUploadFiles] = useState([]);

  // ---- Preview modal state ----
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewName, setPreviewName] = useState('');
  const [previewFileId, setPreviewFileId] = useState(null);

  // ---- Reject modal state ----
  const [rejectVisible, setRejectVisible] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectAppId, setRejectAppId] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  // ---- Red invoice modal state ----
  const [redVisible, setRedVisible] = useState(false);
  const [redReason, setRedReason] = useState('');
  const [redAppId, setRedAppId] = useState(null);

  // ---- Load applications ----
  const loadApps = useCallback(() => {
    fetchApplications(appPage, appPageSize, {
      status: statusFilter,
      keyword,
      userId: userIdFilter,
    });
  }, [fetchApplications, appPage, appPageSize, statusFilter, keyword, userIdFilter]);

  // ---- Refresh with query ----
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Query all eligible items on the current page before reloading
      const queryable = appItems.filter(shouldQueryInvoiceStatus);
      if (queryable.length > 0) {
        await Promise.allSettled(queryable.map((item) => queryApplicationStatus(item.id)));
      }
    } catch (_) {
      // ignore individual query errors
    }
    await fetchApplications(appPage, appPageSize, {
      status: statusFilter,
      keyword,
      userId: userIdFilter,
    });
    setRefreshing(false);
  }, [appItems, queryApplicationStatus, fetchApplications, appPage, appPageSize, statusFilter, keyword, userIdFilter]);

  useEffect(() => {
    if (activeTab === 'applications') loadApps();
  }, [activeTab, loadApps]);

  const handleSearch = () => {
    setKeyword(String(keywordInput || '').trim());
    setUserIdFilter(String(userIdInput || '').trim());
    setAppPage(1);
  };

  // ---- Detail ----
  const openDetail = async (id) => {
    setDetailVisible(true);
    setDetailLoading(true);
    setDetailData(null);
    const data = await fetchApplicationDetail(id);
    setDetailData(data || null);
    setDetailLoading(false);
  };

  const refreshDetail = async (id, application = detailData?.application) => {
    setDetailLoading(true);
    try {
      if (shouldQueryInvoiceStatus(application)) {
        await queryApplicationStatus(id);
      }
      const data = await fetchApplicationDetail(id);
      setDetailData(data || null);
      return data;
    } finally {
      setDetailLoading(false);
    }
  };

  // ---- Status actions ----
  const handleApprove = (id, categoryOverride, taxRateOverride, defaultTaxRate) => {
    Modal.confirm({
      title: t('invoice.approve'),
      content: t('invoice.approveConfirm'),
      onOk: async () => {
        const normalizedTaxRate = String(taxRateOverride || '').trim();
        const normalizedDefaultTaxRate = String(defaultTaxRate || '').trim();
        const doApprove = async () => {
          setActionLoading(true);
          const payload = { status: 'approved' };
          if (categoryOverride) {
            payload.goods_name = categoryOverride.name || '';
            payload.tax_classification_code = categoryOverride.code || '';
          }
          if (normalizedTaxRate !== '') {
            payload.tax_rate_value = normalizedTaxRate;
          }
          const res = await updateApplicationStatus(id, payload);
          setActionLoading(false);
          if (res) {
            showSuccess(t('invoice.statusUpdateSuccess'));
            const issueStatus = res?.issue_status;
            if (issueStatus === 'issuing' || issueStatus === 'querying') {
              showSuccess(t('invoice.autoIssueTriggered'));
            } else if (issueStatus === 'issue_failed') {
              showError(`${t('invoice.autoIssueFailed')}: ${res?.issue_error_message || ''}`);
            }
            loadApps();
            refreshDetail(id);
          }
        };

        if (normalizedTaxRate !== '' && normalizedDefaultTaxRate !== '' && normalizedTaxRate !== normalizedDefaultTaxRate) {
          Modal.confirm({
            title: t('invoice.approve'),
            content: t('invoice.taxRateMismatchConfirm', { taxRate: normalizedTaxRate, defaultTaxRate: normalizedDefaultTaxRate }),
            onOk: doApprove,
          });
          return;
        }

        await doApprove();
      },
    });
  };

  const handleRejectOpen = (id) => {
    setRejectAppId(id);
    setRejectReason('');
    setRejectVisible(true);
  };

  const handleRejectConfirm = async () => {
    if (!String(rejectReason || '').trim()) {
      showError(t('invoice.rejectReasonRequired'));
      return;
    }
    setActionLoading(true);
    const res = await updateApplicationStatus(rejectAppId, {
      status: 'rejected',
      reject_reason: rejectReason.trim(),
    });
    setActionLoading(false);
    if (res) {
      showSuccess(t('invoice.statusUpdateSuccess'));
      setRejectVisible(false);
      loadApps();
      refreshDetail(rejectAppId);
    }
  };

  const handleRedOpen = (id) => {
    setRedAppId(id);
    setRedReason('');
    setRedVisible(true);
  };

  const handleRedConfirm = async () => {
    if (!String(redReason || '').trim()) {
      showError(t('invoice.redReasonRequired'));
      return;
    }
    setActionLoading(true);
    const res = await redInvoice(redAppId, redReason.trim());
    setActionLoading(false);
    if (res) {
      showSuccess(t('invoice.redSuccess'));
      setRedVisible(false);
      loadApps();
      refreshDetail(redAppId);
    }
  };

  const handleMarkIssued = (id) => {
    Modal.confirm({
      title: t('invoice.markIssued'),
      content: t('invoice.markIssuedConfirm'),
      onOk: async () => {
        setActionLoading(true);
        const res = await updateApplicationStatus(id, { status: 'issued' });
        setActionLoading(false);
        if (res) {
          showSuccess(t('invoice.statusUpdateSuccess'));
          loadApps();
          refreshDetail(id);
        }
      },
    });
  };

  const handleApproveAndIssue = (id) => {
    Modal.confirm({
      title: t('invoice.approveAndIssue'),
      content: t('invoice.approveAndIssueConfirm'),
      onOk: async () => {
        setActionLoading(true);
        const res = await updateApplicationStatus(id, { status: 'issued' });
        setActionLoading(false);
        if (res) {
          showSuccess(t('invoice.statusUpdateSuccess'));
          loadApps();
          refreshDetail(id);
        }
      },
    });
  };

  const handleOneClickIssue = (id) => {
    Modal.confirm({
      title: t('invoice.oneClickIssue'),
      content: t('invoice.oneClickIssueConfirm'),
      onOk: async () => {
        setActionLoading(true);
        const res = await issueApplication(id);
        setActionLoading(false);
        if (res) {
          showSuccess(t('invoice.autoIssueTriggered'));
          loadApps();
          refreshDetail(id);
        }
      },
    });
  };

  // ---- Upload in detail ----
  const [detailUploading, setDetailUploading] = useState(false);
  const [detailFile, setDetailFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleDetailUpload = async () => {
    const appId = detailData?.application?.id;
    if (!appId || !detailFile) {
      showError(t('invoice.adminUploadParamsError'));
      return;
    }
    setDetailUploading(true);
    setUploadProgress(0);
    try {
      const objectKey = await presignAndUpload({ invoiceId: appId, file: detailFile, onProgress: setUploadProgress });
      if (!objectKey) { setDetailUploading(false); return; }
      const created = await finalizeInvoiceFiles({ invoiceId: appId, objectKeys: [objectKey] });
      if (created) {
        showSuccess(t('invoice.adminUploadSuccess'));
        setDetailFile(null);
        refreshDetail(appId);
      }
    } catch (e) {
      showError(e.message || t('invoice.uploadFailed'));
    } finally {
      setDetailUploading(false);
      setUploadProgress(0);
    }
  };

  // ---- Preview/Download ----
  const handleOpenFile = async (record) => {
    const id = record?.id;
    if (!id) return;
    const name = String(record?.original_filename || '').trim() || `#${id}`;
    setPreviewVisible(true);
    setPreviewLoading(true);
    setPreviewUrl('');
    setPreviewName(name);
    setPreviewFileId(id);
    const data = await presignFile(id);
    setPreviewUrl(data?.url || '');
    setPreviewLoading(false);
    if (!data?.url) showError(t('invoice.adminLoadFileFailed'));
  };

  const handleDownloadRecord = async (record) => {
    const id = record?.id;
    if (!id) return;
    const data = await presignFile(id, { disposition: 'attachment' });
    if (data?.url) {
      window.open(data.url, '_blank', 'noopener,noreferrer');
      return;
    }
    showError(t('invoice.adminDownloadFailed'));
  };

  const handleDownloadFile = async () => {
    if (!previewFileId) return;
    setPreviewLoading(true);
    const data = await presignFile(previewFileId, { disposition: 'attachment' });
    if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    else showError(t('invoice.adminDownloadFailed'));
    setPreviewLoading(false);
  };

  const handleToggleFileUserVisibility = async (fileRecord, checked) => {
    const fileId = fileRecord?.id;
    const appId = detailData?.application?.id;
    if (!fileId || !appId) return;
    const res = await updateFileUserVisibility(appId, fileId, checked);
    if (res) {
      showSuccess(t('invoice.statusUpdateSuccess'));
      await refreshDetail(appId);
    }
  };

  // ---- Upload tab handlers (legacy) ----
  const handleLegacyUpload = async () => {
    const id = Number(invoiceId) || 0;
    if (!id || !selectedFile) { showError(t('invoice.adminUploadParamsError')); return; }
    setUploading(true);
    try {
      const objectKey = await presignAndUpload({ invoiceId: id, file: selectedFile });
      if (!objectKey) { showError(t('invoice.uploadFailed')); return; }
      const created = await finalizeInvoiceFiles({ invoiceId: id, objectKeys: [objectKey] });
      if (created) { setUploadFiles(created); showSuccess(t('invoice.adminUploadSuccess')); }
    } catch (e) { showError(e.message || t('invoice.uploadFailed')); }
    finally { setUploading(false); }
  };

  const statusOptions = useMemo(() => [
    { value: '', label: t('invoice.allStatus') },
    { value: 'pending', label: t('invoice.statusPending') },
    { value: 'approved', label: t('invoice.statusApproved') },
    { value: 'rejected', label: t('invoice.statusRejected') },
    { value: 'issued', label: t('invoice.statusIssued') },
    { value: 'cancelled', label: t('invoice.statusCancelled') },
  ], [t]);

  const appColumns = useMemo(() => [
    { title: t('invoice.id'), dataIndex: 'id', width: 80 },
    {
      title: t('invoice.applicant'),
      dataIndex: 'username',
      width: 140,
      render: (v, r) => `${v || '-'} (${r?.user_id || ''})`,
    },
    {
      title: t('invoice.invoiceType'),
      dataIndex: 'invoice_type',
      width: 100,
      render: (v) => v === 'company' ? t('invoice.invoiceTypeCompany') : t('invoice.invoiceTypePersonal'),
    },
    {
      title: t('invoice.invoiceKind'),
      dataIndex: 'issue_kind_code',
      width: 140,
      render: (v) => t(String(v) === '81' ? 'invoice.invoiceKindSpecial' : 'invoice.invoiceKindNormal'),
    },
    { title: t('invoice.invoiceTitle'), dataIndex: 'title' },
    {
      title: t('invoice.money'),
      dataIndex: 'total_money',
      width: 120,
      render: (v, r) => `${Number(v) || 0} ${r?.currency || ''}`.trim(),
    },
    {
      title: t('invoice.status'),
      dataIndex: 'status',
      width: 110,
      render: (v) => (
        <Tag color={STATUS_COLOR_MAP[v] || 'grey'}>
          {t(STATUS_TEXT_MAP[v] || 'invoice.statusPending')}
        </Tag>
      ),
    },
    {
      title: t('invoice.issueStatus'),
      dataIndex: 'issue_status',
      width: 130,
      render: (v, r) => {
        if (!v || v === 'none') return <Tag color='grey'>{t('invoice.issueStatusNone')}</Tag>;
        const tag = (
          <Tag color={ISSUE_STATUS_COLOR_MAP[v] || 'grey'}>
            {t(ISSUE_STATUS_TEXT_MAP[v] || 'invoice.issueStatusNone')}
          </Tag>
        );
        if (v === 'issue_failed' && r?.issue_error_message) {
          return (
            <Tooltip content={`${r.issue_error_code ? `[${r.issue_error_code}] ` : ''}${r.issue_error_message}`}>
              {tag}
            </Tooltip>
          );
        }
        return tag;
      },
    },
    {
      title: t('invoice.completeTime'),
      dataIndex: 'created_at',
      width: 170,
      render: (ts) => ts ? timestamp2string(ts) : '-',
    },
    {
      title: t('invoice.action'),
      width: 180,
      render: (_, r) => {
        const canOneClickIssue = (
          (r?.status === 'approved' && ['none', 'pending_issue', 'issue_failed', ''].includes(String(r?.issue_status || ''))) ||
          (r?.status === 'issued' && String(r?.red_status || '') === 'red_success')
        );
        return (
          <Space>
            <Button size='small' onClick={() => openDetail(r.id)}>
              {t('invoice.viewDetail')}
            </Button>
            {canOneClickIssue && (
              <Button size='small' type='primary' theme='borderless' onClick={() => handleOneClickIssue(r.id)}>
                {t('invoice.oneClickIssue')}
              </Button>
            )}
          </Space>
        );
      },
    },
  ], [t]);

  return (
    <div className='mt-[60px] px-2'>
      <Card>
        <div className='flex flex-wrap gap-2 items-center justify-between mb-3'>
          <Text type='secondary'>{t('invoice.adminTitle')}</Text>
          <RadioGroup type='button' value={activeTab} onChange={(e) => setActiveTab(e.target.value)}>
            <Radio value='applications'>{t('invoice.tabApplicationManagement')}</Radio>
            <Radio value='upload'>{t('invoice.tabFileUpload')}</Radio>
          </RadioGroup>
        </div>

        {activeTab === 'applications' && (
          <>
            <div className='flex flex-wrap gap-2 items-center mb-4'>
              <Select
                value={statusFilter}
                onChange={(v) => { setStatusFilter(v); setAppPage(1); }}
                optionList={statusOptions}
                style={{ width: 150 }}
                placeholder={t('invoice.statusFilter')}
              />
              <Input
                prefix={<IconSearch />}
                placeholder={t('invoice.keywordPlaceholder')}
                value={keywordInput}
                onChange={setKeywordInput}
                style={{ width: 200 }}
              />
              <Input
                placeholder={t('invoice.userIdPlaceholder')}
                value={userIdInput}
                onChange={setUserIdInput}
                style={{ width: 140 }}
              />
              <Button icon={<IconSearch />} onClick={handleSearch}>{t('invoice.search')}</Button>
              <Button icon={<IconRefresh />} loading={refreshing} onClick={handleRefresh}>{t('invoice.refresh')}</Button>
            </div>

            <Table
              columns={appColumns}
              dataSource={appItems}
              loading={appLoading}
              pagination={false}
              rowKey='id'
              empty={<Empty description={t('invoice.emptyApplications')} />}
            />

            <div className='flex justify-end mt-4'>
              <Pagination
                total={appTotal}
                currentPage={appPage}
                pageSize={appPageSize}
                onPageChange={(page) => setAppPage(page)}
                onPageSizeChange={(ps) => { setAppPageSize(ps); setAppPage(1); }}
                showSizeChanger
                pageSizeOpts={[10, 20, 50]}
              />
            </div>
          </>
        )}

        {activeTab === 'upload' && (
          <>
            <Banner
              type='warning'
              title={t('invoice.fileDisclaimerTitle')}
              description={t('invoice.fileDisclaimerBody')}
              closeIcon={null}
              className='!rounded-xl !mb-3'
            />
            <div className='flex flex-wrap gap-2 items-center mb-4'>
              <Input
                value={invoiceId}
                onChange={setInvoiceId}
                placeholder={t('invoice.adminInvoiceIdPlaceholder')}
                style={{ width: 220 }}
              />
              <input
                type='file'
                onChange={(e) => { setSelectedFile((e.target.files || [])[0] || null); }}
              />
              {selectedFile ? (
                <Tag color='blue'>{safeFileName(selectedFile)}</Tag>
              ) : (
                <Tag>{t('invoice.adminNoFile')}</Tag>
              )}
              <Button type='primary' loading={uploading} onClick={handleLegacyUpload}>
                {t('invoice.upload')}
              </Button>
            </div>
            <Table
              columns={[
                { title: t('invoice.id'), dataIndex: 'id', width: 90 },
                { title: t('invoice.fileName'), dataIndex: 'original_filename', render: (v, r) => String(v || r?.object_key || '') },
                { title: t('invoice.contentType'), dataIndex: 'content_type', width: 180, render: (v) => <Tag color='blue'>{String(v || '')}</Tag> },
                { title: t('invoice.sizeBytes'), dataIndex: 'size_bytes', width: 140, render: (v) => v == null ? '-' : String(v) },
                { title: t('invoice.action'), width: 120, render: (_, r) => <Button size='small' onClick={() => handleOpenFile(r)}>{t('invoice.preview')}</Button> },
              ]}
              dataSource={uploadFiles}
              pagination={false}
              rowKey='id'
              empty={<div className='py-6 text-center text-gray-400'>{t('invoice.empty')}</div>}
            />
          </>
        )}
      </Card>

      {/* Detail Modal */}
      <Modal
        title={t('invoice.applicationDetail')}
        visible={detailVisible}
        onCancel={() => { setDetailVisible(false); setDetailData(null); setDetailFile(null); }}
        footer={null}
        width={900}
      >
        {detailLoading ? (
          <Text>{t('invoice.loading')}</Text>
        ) : detailData ? (
          <AdminDetailContent
            t={t}
            data={detailData}
            onApprove={handleApprove}
            onReject={handleRejectOpen}
            onMarkIssued={handleMarkIssued}
            onApproveAndIssue={handleApproveAndIssue}
            onOneClickIssue={handleOneClickIssue}
            onRefreshStatus={refreshDetail}
            onRed={handleRedOpen}
            detailLoading={detailLoading}
            actionLoading={actionLoading}
            detailFile={detailFile}
            setDetailFile={setDetailFile}
            detailUploading={detailUploading}
            uploadProgress={uploadProgress}
            onUpload={handleDetailUpload}
            onOpenFile={handleOpenFile}
            onDownloadFile={handleDownloadRecord}
            onToggleFileUserVisibility={handleToggleFileUserVisibility}
            onSetItemPaymentInfo={setItemPaymentInfo}
          />
        ) : (
          <Empty description={t('invoice.emptyApplications')} />
        )}
      </Modal>

      {/* Reject Reason Modal */}
      <Modal
        title={t('invoice.reject')}
        visible={rejectVisible}
        onCancel={() => setRejectVisible(false)}
        onOk={handleRejectConfirm}
        confirmLoading={actionLoading}
        okText={t('invoice.reject')}
      >
        <Text type='secondary'>{t('invoice.rejectReason')}</Text>
        <TextArea
          value={rejectReason}
          onChange={setRejectReason}
          rows={3}
          placeholder={t('invoice.rejectReasonPlaceholder')}
          className='mt-2'
        />
      </Modal>

      {/* Red Invoice Modal */}
      <Modal
        title={t('invoice.red')}
        visible={redVisible}
        onCancel={() => setRedVisible(false)}
        onOk={handleRedConfirm}
        confirmLoading={actionLoading}
        okText={t('invoice.red')}
      >
        <Text type='secondary'>{t('invoice.redReason')}</Text>
        <TextArea
          value={redReason}
          onChange={setRedReason}
          rows={3}
          placeholder={t('invoice.redReasonPlaceholder')}
          className='mt-2'
        />
      </Modal>

      {/* Preview Modal */}
      <Modal
        title={previewName || t('invoice.files')}
        visible={previewVisible}
        onCancel={() => { setPreviewVisible(false); setPreviewUrl(''); setPreviewName(''); setPreviewFileId(null); }}
        footer={
          <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
            <Button loading={previewLoading} onClick={handleDownloadFile}>{t('invoice.download')}</Button>
            <Button type='primary' onClick={() => { setPreviewVisible(false); setPreviewUrl(''); setPreviewName(''); setPreviewFileId(null); }}>
              {t('invoice.view')}
            </Button>
          </Space>
        }
        width={860}
      >
        {previewLoading ? (
          <Text>{t('invoice.loading')}</Text>
        ) : previewUrl ? (
          <iframe src={previewUrl} title={previewName} style={{ width: '100%', height: '70vh', border: 0 }} />
        ) : (
          <Text type='tertiary'>{t('invoice.preview')}</Text>
        )}
      </Modal>
    </div>
  );
}

function AdminDetailContent({ t, data, onApprove, onReject, onMarkIssued, onApproveAndIssue, onOneClickIssue, onRefreshStatus, onRed, detailLoading, actionLoading, detailFile, setDetailFile, detailUploading, uploadProgress, onUpload, onOpenFile, onDownloadFile, onToggleFileUserVisibility, onSetItemPaymentInfo }) {
  const app = data?.application || {};
  const items = Array.isArray(data?.items) ? data.items : [];
  const files = Array.isArray(data?.files) ? data.files : [];
  const status = app.status || '';

  // Admin category override state
  const [overrideCategoryIdx, setOverrideCategoryIdx] = useState(-1); // -1 = use user's choice
  const [overrideTaxRate, setOverrideTaxRate] = useState('');
  const currentCategory = useMemo(() => {
    if (overrideCategoryIdx >= 0) return INVOICE_GOODS_CATEGORIES[overrideCategoryIdx] || null;
    return INVOICE_GOODS_CATEGORIES.find((cat) => cat.code === app.tax_classification_code) || null;
  }, [overrideCategoryIdx, app.tax_classification_code]);
  const categoryOptions = useMemo(() => {
    const currentCategoryLabel = currentCategory ? formatCategoryLabel(currentCategory, t) : (app.goods_name || '-');
    const opts = [{ value: -1, label: `— ${t('invoice.goodsCategory')}: ${currentCategoryLabel} —` }];
    INVOICE_GOODS_CATEGORIES.forEach((cat, idx) => {
      opts.push({ value: idx, label: formatCategoryLabel(cat, t) });
    });
    return opts;
  }, [app.goods_name, currentCategory, t]);
  const currentDefaultTaxRate = currentCategory?.defaultTaxRate || '0.06';

  // Reset override when app changes
  useEffect(() => {
    setOverrideCategoryIdx(-1);
    const matched = INVOICE_GOODS_CATEGORIES.find((cat) => cat.code === app.tax_classification_code);
    setOverrideTaxRate(String(app.tax_rate_value || matched?.defaultTaxRate || '0.06'));
  }, [app.id, app.tax_rate_value, app.tax_classification_code]);

  useEffect(() => {
    if (overrideCategoryIdx >= 0) {
      const selected = INVOICE_GOODS_CATEGORIES[overrideCategoryIdx];
      if (selected?.defaultTaxRate) {
        setOverrideTaxRate(String(selected.defaultTaxRate));
      }
    }
  }, [overrideCategoryIdx]);

  // 乐企联用支付信息编辑
  const [payInfoModalVisible, setPayInfoModalVisible] = useState(false);
  const [payInfoItem, setPayInfoItem] = useState(null);
  const [payInfoForm, setPayInfoForm] = useState({ payment_code: '', trade_no_third_party: '', sub_mchid: '', account: '' });
  const [payInfoSaving, setPayInfoSaving] = useState(false);

  const openPayInfoModal = useCallback((item) => {
    setPayInfoItem(item);
    setPayInfoForm({
      payment_code: item.payment_code || '',
      trade_no_third_party: item.trade_no_third_party || '',
      sub_mchid: item.sub_mchid || '',
      account: item.account || '',
    });
    setPayInfoModalVisible(true);
  }, []);

  const handleSavePayInfo = useCallback(async () => {
    if (!payInfoItem || !onSetItemPaymentInfo) return;
    setPayInfoSaving(true);
    const ok = await onSetItemPaymentInfo(app.id, payInfoItem.id, payInfoForm);
    setPayInfoSaving(false);
    if (ok) {
      setPayInfoModalVisible(false);
      onRefreshStatus(app.id);
    }
  }, [payInfoItem, payInfoForm, app.id, onSetItemPaymentInfo, onRefreshStatus]);

  const infoRows = [
    [t('invoice.id'), app.id],
    [t('invoice.applicant'), `${app.username || '-'} (${app.user_id || ''})`],
    [t('invoice.invoiceType'), app.invoice_type === 'company' ? t('invoice.invoiceTypeCompany') : t('invoice.invoiceTypePersonal')],
    [t('invoice.invoiceKind'), t(String(app.issue_kind_code) === '81' ? 'invoice.invoiceKindSpecial' : 'invoice.invoiceKindNormal')],
    [t('invoice.invoiceTitle'), app.title],
    [t('invoice.taxId'), app.tax_id || '-'],
    [t('invoice.email'), app.email],
    [t('invoice.goodsCategory'), currentCategory ? formatCategoryLabel(currentCategory, t) : (app.goods_name || '-')],
    [t('invoice.taxClassificationCode'), app.tax_classification_code || '-'],
    [t('invoice.taxRate'), app.tax_rate_value || '-'],
    [t('invoice.money'), `${app.total_money || 0} ${app.currency || ''}`],
    [t('invoice.applyRemark'), app.apply_remark || '-'],
    [t('invoice.adminRemark'), app.admin_remark || '-'],
    [t('invoice.rejectReason'), app.reject_reason || '-'],
    [t('invoice.createdAt'), app.created_at ? timestamp2string(app.created_at) : '-'],
  ];

  return (
    <div className='flex flex-col gap-4'>
      {/* Status */}
      <div className='flex items-center gap-2 justify-between'>
        <div className='flex items-center gap-2'>
          <Tag color={STATUS_COLOR_MAP[status] || 'grey'} size='large'>
            {t(STATUS_TEXT_MAP[status] || 'invoice.statusPending')}
          </Tag>
          {app.issue_status && app.issue_status !== 'none' && (
            <Tag color={ISSUE_STATUS_COLOR_MAP[app.issue_status] || 'grey'} size='large'>
              {t(ISSUE_STATUS_TEXT_MAP[app.issue_status] || 'invoice.issueStatusNone')}
            </Tag>
          )}
        </div>
        <Button
          size='small'
          icon={<IconRefresh />}
          loading={detailLoading}
          onClick={() => onRefreshStatus?.(app.id, app)}
        >
          {t('invoice.refresh')}
        </Button>
      </div>

      {/* Application Info */}
      <div>
        <Text strong>{t('invoice.applicationInfo')}</Text>
        <div className='mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm'>
          {infoRows.map(([label, val], i) => (
            <React.Fragment key={i}>
              <Text type='tertiary'>{label}</Text>
              <Text>{String(val ?? '')}</Text>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Issue Info — shown when auto-issue has been attempted */}
      {app.issue_status && app.issue_status !== 'none' && (
        <div>
          <Text strong>{t('invoice.issueInfo')}</Text>

          {/* Error banner */}
          {(app.issue_error_code || app.issue_error_message) && (
            <Banner
              type='danger'
              title={`${t('invoice.issueErrorTitle')}${app.issue_error_code ? ` [${app.issue_error_code}]` : ''}`}
              description={app.issue_error_message || ''}
              closeIcon={null}
              className='!rounded-xl !mt-2 !mb-2'
            />
          )}

          <div className='mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm'>
            <Text type='tertiary'>{t('invoice.issueStatus')}</Text>
            <div>
              <Tag color={ISSUE_STATUS_COLOR_MAP[app.issue_status] || 'grey'} size='small'>
                {t(ISSUE_STATUS_TEXT_MAP[app.issue_status] || 'invoice.issueStatusNone')}
              </Tag>
            </div>

            <Text type='tertiary'>{t('invoice.issueMode')}</Text>
            <Text>{app.issue_mode === 'auto' ? t('invoice.issueModeAuto') : app.issue_mode === 'manual' ? t('invoice.issueModeManual') : '-'}</Text>

            <Text type='tertiary'>{t('invoice.issueProvider')}</Text>
            <Text>{app.provider ? t(PROVIDER_TEXT_MAP[app.provider] || 'invoice.unknown') : '-'}</Text>

            <Text type='tertiary'>{t('invoice.issueAttempts')}</Text>
            <Text>{app.issue_attempts ?? 0}</Text>

            <Text type='tertiary'>{t('invoice.queryAttempts')}</Text>
            <Text>{app.query_attempts ?? 0}</Text>

            <Text type='tertiary'>{t('invoice.lastIssueAt')}</Text>
            <Text>{app.last_issue_attempt_at ? timestamp2string(app.last_issue_attempt_at) : '-'}</Text>

            <Text type='tertiary'>{t('invoice.lastQueryAt')}</Text>
            <Text>{app.last_query_at ? timestamp2string(app.last_query_at) : '-'}</Text>

            <Text type='tertiary'>{t('invoice.fileFetchStatus')}</Text>
            <Text>{app.file_fetch_status ? t(FILE_FETCH_STATUS_TEXT_MAP[app.file_fetch_status] || 'invoice.unknown') : '-'}</Text>

            {(app.piaotong_invoice_no || app.piaotong_blue_all_ele_inv_no) && (
              <>
                <Text type='tertiary'>{t('invoice.piaoTongInvoiceNo')}</Text>
                <Text>{app.piaotong_blue_all_ele_inv_no || app.piaotong_invoice_no || '-'}</Text>
              </>
            )}
          </div>
        </div>
      )}

      {/* Order Items */}
      <div>
        <Text strong>{t('invoice.orderItems')}</Text>
        {items.length === 0 ? (
          <div className='py-2 text-gray-400 text-sm'>{t('invoice.noItems')}</div>
        ) : (
          <Table
            className='mt-2'
            dataSource={items}
            pagination={false}
            rowKey='id'
            size='small'
            columns={[
              {
                title: t('invoice.sourceType'),
                dataIndex: 'source_type',
                width: 100,
                render: (v) => {
                  const meta = SOURCE_TYPE_META[String(v)] || { color: 'grey', textKey: 'invoice.unknown' };
                  return <Tag color={meta.color}>{t(meta.textKey)}</Tag>;
                },
              },
              { title: t('invoice.tradeNo'), dataIndex: 'trade_no' },
              { title: t('invoice.money'), dataIndex: 'money', width: 100, render: (v, r) => `${v || 0} ${r?.currency || ''}` },
              { title: t('invoice.paymentMethod'), dataIndex: 'payment_method', width: 100 },
              { title: t('invoice.completeTime'), dataIndex: 'complete_time', width: 160, render: (ts) => ts ? timestamp2string(ts) : '-' },
              {
                title: t('invoice.paymentInfo'),
                width: 220,
                render: (_, r) => {
                  const hasAny = r.payment_code || r.trade_no_third_party || r.sub_mchid || r.account;
                  if (!hasAny) return <Tag color='orange' size='small'>{t('invoice.paymentInfoMissing')}</Tag>;
                  return (
                    <Space size='extra-tight'>
                      {r.payment_code && <Tag size='small'>{r.payment_code}</Tag>}
                      {r.trade_no_third_party && <Tooltip content={t('invoice.tradeNoThirdParty')}><Text size='small' style={{ maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{r.trade_no_third_party}</Text></Tooltip>}
                      {r.sub_mchid && <Text size='small' style={{ color: '#666' }}>{r.sub_mchid}</Text>}
                    </Space>
                  );
                },
              },
              {
                title: '',
                width: 80,
                render: (_, r) => (
                  <Button size='small' onClick={() => openPayInfoModal(r)}>{t('common.edit')}</Button>
                ),
              },
            ]}
          />
        )}
      </div>

      {/* Files */}
      <div>
        <Text strong>{t('invoice.invoiceFiles')}</Text>
        {files.length === 0 ? (
          <div className='py-2 text-gray-400 text-sm'>{t('invoice.noFiles')}</div>
        ) : (
          <Table
            className='mt-2'
            dataSource={files}
            pagination={false}
            rowKey='id'
            size='small'
            columns={[
              { title: t('invoice.id'), dataIndex: 'id', width: 60 },
              { title: t('invoice.fileName'), dataIndex: 'original_filename' },
              { title: t('invoice.contentType'), dataIndex: 'content_type', width: 140 },
              {
                title: t('invoice.red'),
                dataIndex: 'is_red',
                width: 90,
                render: (v, r) => {
                  const isRed = Boolean(r?.is_red || app?.red_status === 'red_success');
                  return <Tag color={isRed ? 'red' : 'grey'}>{isRed ? t('invoice.yes') : t('invoice.no')}</Tag>;
                },
              },
              {
                title: t('invoice.view'),
                dataIndex: 'is_user_visible',
                width: 120,
                render: (v, r) => (
                  <Switch
                    size='small'
                    checked={Boolean(v)}
                    onChange={(checked) => onToggleFileUserVisibility?.(r, checked)}
                  />
                ),
              },
              {
                title: t('invoice.action'),
                width: 140,
                render: (_, r) => (
                  <Space>
                    <Button size='small' onClick={() => onOpenFile(r)}>{t('invoice.preview')}</Button>
                    <Button size='small' icon={<IconDownload />} onClick={() => onDownloadFile(r)}>
                      {t('invoice.download')}
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </div>

      {/* Upload for this application */}
      <div>
        <Text strong>{t('invoice.uploadForApplication')}</Text>
        <div className='flex flex-wrap gap-2 items-center mt-2'>
          <input type='file' onChange={(e) => setDetailFile((e.target.files || [])[0] || null)} />
          <Button type='primary' loading={detailUploading} disabled={!detailFile} onClick={onUpload}>
            {t('invoice.upload')}
          </Button>
        </div>
        {detailUploading && (
          <div className='mt-3'>
            <Progress percent={uploadProgress} showInfo />
          </div>
        )}
      </div>

      {/* Status Actions */}
      {(status === 'pending' || status === 'approved' || (status === 'issued' && app.red_status === 'red_success')) && (
        <div className='flex flex-col gap-2 pt-2 border-t'>
          {status === 'pending' && (
            <>
              <div>
                <Text type='secondary' size='small'>{t('invoice.categoryOverride')}</Text>
                <Select
                  value={overrideCategoryIdx}
                  onChange={setOverrideCategoryIdx}
                  optionList={categoryOptions}
                  style={{ width: '100%' }}
                  className='mt-1'
                />
              </div>
              <div>
                <Text type='secondary' size='small'>{t('invoice.taxRate')}</Text>
                <Input
                  value={overrideTaxRate}
                  onChange={setOverrideTaxRate}
                  placeholder={t('invoice.taxRatePlaceholder')}
                  style={{ width: 180 }}
                  className='mt-1'
                />
              </div>
              <div className='flex gap-2'>
                <Button type='primary' loading={actionLoading} onClick={() => {
                  const cat = overrideCategoryIdx >= 0 ? INVOICE_GOODS_CATEGORIES[overrideCategoryIdx] : null;
                  onApprove(app.id, cat, overrideTaxRate, currentDefaultTaxRate);
                }}>
                  {t('invoice.approve')}
                </Button>
                <Button type='secondary' loading={actionLoading} onClick={() => onApproveAndIssue(app.id)}>
                  {t('invoice.approveAndIssue')}
                </Button>
                <Button type='danger' loading={actionLoading} onClick={() => onReject(app.id)}>
                  {t('invoice.reject')}
                </Button>
              </div>
            </>
          )}
          {status === 'approved' && (
            <div className='flex gap-2'>
              <Button type='primary' loading={actionLoading} onClick={() => onOneClickIssue(app.id)}>
                {t('invoice.oneClickIssue')}
              </Button>
              <Button type='tertiary' loading={actionLoading} onClick={() => onMarkIssued(app.id)}>
                {t('invoice.markIssued')}
              </Button>
            </div>
          )}
          {status === 'issued' && app.red_status === 'red_success' && (
            <div className='flex gap-2'>
              <Button type='primary' loading={actionLoading} onClick={() => onOneClickIssue(app.id)}>
                {t('invoice.oneClickIssue')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Red invoice action — only for issued invoices */}
      {status === 'issued' && !app.red_status && (
        <div className='pt-2 border-t'>
          <Button type='danger' loading={actionLoading} onClick={() => onRed(app.id)}>
            {t('invoice.red')}
          </Button>
        </div>
      )}
      {app.red_status === 'red_success' && (
        <Tag color='red' size='large'>{t('invoice.redStatusSuccess')}</Tag>
      )}
      {app.red_status === 'red_failed' && (
        <Tooltip content={app.red_error_message || ''}>
          <Tag color='orange' size='large'>{t('invoice.redStatusFailed')}</Tag>
        </Tooltip>
      )}

      {/* 乐企联用支付信息编辑弹窗 */}
      <Modal
        title={t('invoice.paymentInfo')}
        visible={payInfoModalVisible}
        onCancel={() => setPayInfoModalVisible(false)}
        footer={
          <Space>
            <Button onClick={() => setPayInfoModalVisible(false)}>{t('common.cancel')}</Button>
            <Button type='primary' loading={payInfoSaving} onClick={handleSavePayInfo}>{t('invoice.savePaymentInfo')}</Button>
          </Space>
        }
      >
        <div className='flex flex-col gap-3'>
          <div>
            <Text type='secondary'>{t('invoice.tradeNo')} ({payInfoItem?.trade_no || '-'}, {t('invoice.money')} {payInfoItem?.money || 0})</Text>
          </div>
          <div>
            <Text type='secondary' style={{ display: 'block', marginBottom: 4 }}>{t('invoice.paymentCode')}</Text>
            <Input value={payInfoForm.payment_code} onChange={(v) => setPayInfoForm((f) => ({ ...f, payment_code: v }))} style={{ width: '100%' }} placeholder='0901' />
          </div>
          <div>
            <Text type='secondary' style={{ display: 'block', marginBottom: 4 }}>{t('invoice.tradeNoThirdParty')}</Text>
            <Input value={payInfoForm.trade_no_third_party} onChange={(v) => setPayInfoForm((f) => ({ ...f, trade_no_third_party: v }))} style={{ width: '100%' }} placeholder={t('invoice.tradeNoThirdParty')} />
          </div>
          <div>
            <Text type='secondary' style={{ display: 'block', marginBottom: 4 }}>{t('invoice.subMchid')}</Text>
            <Input value={payInfoForm.sub_mchid} onChange={(v) => setPayInfoForm((f) => ({ ...f, sub_mchid: v }))} style={{ width: '100%' }} placeholder={t('invoice.subMchid')} />
          </div>
          <div>
            <Text type='secondary' style={{ display: 'block', marginBottom: 4 }}>{t('invoice.account')}</Text>
            <Input value={payInfoForm.account} onChange={(v) => setPayInfoForm((f) => ({ ...f, account: v }))} style={{ width: '100%' }} placeholder={t('invoice.account')} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
