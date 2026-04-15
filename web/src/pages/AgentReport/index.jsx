import React, { useCallback, useEffect, useState } from 'react';
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
  Spin,
  Tag,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh, IconSearch, IconDelete, IconEyeOpened } from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../../helpers';
import { timestamp2string } from '../../helpers/utils';

const { Text } = Typography;

const TYPE_MAP = {
  daily:   { color: 'blue',   label: 'agentReport.typeDaily' },
  weekly:  { color: 'purple', label: 'agentReport.typeWeekly' },
  monthly: { color: 'orange', label: 'agentReport.typeMonthly' },
  trend:   { color: 'cyan',   label: 'agentReport.typeTrend' },
  manual:  { color: 'grey',   label: 'agentReport.typeManual' },
};

const STATUS_MAP = {
  generating: { color: 'blue',  label: 'agentReport.statusGenerating' },
  completed:  { color: 'green', label: 'agentReport.statusCompleted' },
  failed:     { color: 'red',   label: 'agentReport.statusFailed' },
};

export default function AgentReportPage() {
  const { t } = useTranslation();
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [typeFilter, setTypeFilter] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');

  const [createVisible, setCreateVisible] = useState(false);
  const [viewVisible, setViewVisible] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewReport, setViewReport] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, page_size: pageSize });
      if (typeFilter) params.set('report_type', typeFilter);
      if (keyword) params.set('keyword', keyword);
      const res = await API.get(`/api/agent-reports?${params}`);
      if (res.data.success) {
        setData(res.data.data || []);
        setTotal(res.data.total || 0);
      }
    } catch {
      showError(t('agentReport.loadFailed'));
    }
    setLoading(false);
  }, [page, pageSize, typeFilter, keyword, t]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSearch = () => { setKeyword(keywordInput.trim()); setPage(1); };

  const handleView = async (id) => {
    setViewVisible(true);
    setViewLoading(true);
    setViewReport(null);
    try {
      const res = await API.get(`/api/agent-reports/${id}`);
      if (res.data.success) {
        setViewReport(res.data.data);
      }
    } catch {
      showError(t('agentReport.loadFailed'));
    }
    setViewLoading(false);
  };

  const handleDelete = (id) => {
    Modal.confirm({
      title: t('agentReport.deleteConfirm'),
      onOk: async () => {
        try {
          const res = await API.delete(`/api/agent-reports/${id}`);
          if (res.data.success) {
            showSuccess(t('agentReport.deleteSuccess'));
            loadData();
          }
        } catch {
          showError(t('agentReport.loadFailed'));
        }
      },
    });
  };

  return (
    <div className='mt-[60px] px-2'>
      <Card>
        {/* Header */}
        <div className='flex flex-wrap gap-2 items-center justify-between mb-3'>
          <Text strong size='large'>{t('agentReport.title')}</Text>
          <Space>
            <Button icon={<IconRefresh />} onClick={loadData}>{t('agentReport.refresh')}</Button>
            <Button icon={<IconPlus />} type='primary' onClick={() => setCreateVisible(true)}>{t('agentReport.create')}</Button>
          </Space>
        </div>

        {/* Filters */}
        <div className='flex flex-wrap gap-2 items-center mb-4'>
          <Select
            placeholder={t('agentReport.reportType')}
            value={typeFilter}
            onChange={(v) => { setTypeFilter(v); setPage(1); }}
            style={{ width: 160 }}
            optionList={[
              { value: '', label: t('agentReport.allTypes') },
              { value: 'daily', label: t('agentReport.typeDaily') },
              { value: 'weekly', label: t('agentReport.typeWeekly') },
              { value: 'monthly', label: t('agentReport.typeMonthly') },
              { value: 'trend', label: t('agentReport.typeTrend') },
              { value: 'manual', label: t('agentReport.typeManual') },
            ]}
          />
          <Input prefix={<IconSearch />} placeholder={t('agentReport.searchPlaceholder')} value={keywordInput} onChange={setKeywordInput} style={{ width: 240 }} onEnterPress={handleSearch} />
          <Button icon={<IconSearch />} onClick={handleSearch}>{t('agentReport.search')}</Button>
          <Text type='secondary' style={{ marginLeft: 'auto' }}>{t('agentReport.totalCount', { count: total })}</Text>
        </div>

        {/* Report cards */}
        {loading ? (
          <div className='flex justify-center py-12'><Spin size='large' /></div>
        ) : data.length === 0 ? (
          <Empty description={t('agentReport.empty')} />
        ) : (
          <div className='flex flex-col gap-3'>
            {data.map((item) => (
              <ReportCard key={item.id} item={item} t={t} onView={handleView} onDelete={handleDelete} />
            ))}
          </div>
        )}

        {/* Pagination */}
        <div className='flex justify-end mt-4'>
          <Pagination
            total={total} currentPage={page} pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(ps) => { setPageSize(ps); setPage(1); }}
            showSizeChanger pageSizeOpts={[5, 10, 20]}
          />
        </div>
      </Card>

      {/* Create modal */}
      <CreateReportModal visible={createVisible} onCancel={() => setCreateVisible(false)} onSuccess={() => { setCreateVisible(false); loadData(); }} t={t} />

      {/* View full report modal */}
      <Modal
        title={viewReport?.title || t('agentReport.viewReport')}
        visible={viewVisible}
        onCancel={() => { setViewVisible(false); setViewReport(null); }}
        footer={<Button onClick={() => { setViewVisible(false); setViewReport(null); }}>{t('agentReport.close')}</Button>}
        fullScreen
        bodyStyle={{ padding: 0, overflow: 'auto' }}
      >
        {viewLoading ? (
          <div className='flex justify-center py-20'><Spin size='large' /></div>
        ) : viewReport?.html_content ? (
          <ReportHtmlViewer html={viewReport.html_content} />
        ) : (
          <Empty description={t('agentReport.noContent')} style={{ padding: 60 }} />
        )}
      </Modal>
    </div>
  );
}

/* ---- Report Card ---- */
function ReportCard({ item, t, onView, onDelete }) {
  const typeMeta = TYPE_MAP[item.report_type] || TYPE_MAP.manual;
  const statusMeta = STATUS_MAP[item.status] || STATUS_MAP.completed;

  return (
    <div className='border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow'>
      {/* Row 1: title + tags */}
      <div className='flex flex-wrap items-center gap-2 mb-2'>
        <Text strong style={{ fontSize: 15 }}>{item.title}</Text>
        <Tag color={typeMeta.color} size='small'>{t(typeMeta.label)}</Tag>
        <Tag color={statusMeta.color} size='small'>{t(statusMeta.label)}</Tag>
        <div style={{ marginLeft: 'auto' }} className='flex items-center gap-2'>
          <Text type='tertiary' size='small'>{t('agentReport.agentName')}: {item.agent_name}</Text>
          <Text type='tertiary' size='small'>·</Text>
          <Text type='tertiary' size='small'>{item.created_at ? timestamp2string(item.created_at) : '-'}</Text>
        </div>
      </div>

      {/* Row 2: summary */}
      {item.summary && (
        <div className='mb-3 p-3 rounded-lg' style={{ background: '#f8fafc', borderLeft: '3px solid #6366f1' }}>
          <Text type='secondary' size='small' style={{ display: 'block', marginBottom: 4 }}>{t('agentReport.summary')}</Text>
          <Text style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{item.summary}</Text>
        </div>
      )}

      {/* Row 3: actions */}
      <div className='flex justify-end gap-2'>
        <Button size='small' icon={<IconEyeOpened />} onClick={() => onView(item.id)}>
          {t('agentReport.viewReport')}
        </Button>
        <Button size='small' icon={<IconDelete />} type='danger' theme='borderless' onClick={() => onDelete(item.id)} />
      </div>
    </div>
  );
}

/* ---- HTML Viewer (iframe sandbox) ---- */
function ReportHtmlViewer({ html }) {
  return (
    <iframe
      srcDoc={html}
      sandbox="allow-scripts allow-same-origin"
      style={{
        width: '100%',
        height: '100%',
        minHeight: 'calc(100vh - 60px)',
        border: 'none',
        background: '#fff',
      }}
      title="report"
    />
  );
}

/* ---- Create Modal ---- */
function CreateReportModal({ visible, onCancel, onSuccess, t }) {
  const [title, setTitle] = useState('');
  const [reportType, setReportType] = useState('manual');
  const [summary, setSummary] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [agentName, setAgentName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTitle(''); setReportType('manual'); setSummary(''); setHtmlContent(''); setAgentName(''); setSubmitting(false);
  }, [visible]);

  const handleOk = async () => {
    if (!title.trim()) { showError(t('agentReport.titleRequired')); return; }
    if (!agentName.trim()) { showError(t('agentReport.agentNameRequired')); return; }
    setSubmitting(true);
    try {
      const res = await API.post('/api/agent-reports', {
        title: title.trim(),
        report_type: reportType,
        summary: summary.trim(),
        html_content: htmlContent,
        agent_name: agentName.trim(),
        status: 'completed',
      });
      if (res.data.success) {
        showSuccess(t('agentReport.createSuccess'));
        onSuccess();
      }
    } catch {
      showError(t('agentReport.loadFailed'));
    }
    setSubmitting(false);
  };

  return (
    <Modal title={t('agentReport.create')} visible={visible} onCancel={onCancel} onOk={handleOk} okText={t('agentReport.submit')} confirmLoading={submitting} width={700}>
      <div className='flex flex-col gap-3'>
        <div>
          <Text type='secondary'>{t('agentReport.reportTitle')}</Text>
          <Input value={title} onChange={setTitle} placeholder={t('agentReport.titlePlaceholder')} />
        </div>
        <div className='grid grid-cols-2 gap-3'>
          <div>
            <Text type='secondary'>{t('agentReport.reportType')}</Text>
            <Select value={reportType} onChange={setReportType} style={{ width: '100%' }} optionList={[
              { value: 'daily', label: t('agentReport.typeDaily') },
              { value: 'weekly', label: t('agentReport.typeWeekly') },
              { value: 'monthly', label: t('agentReport.typeMonthly') },
              { value: 'trend', label: t('agentReport.typeTrend') },
              { value: 'manual', label: t('agentReport.typeManual') },
            ]} />
          </div>
          <div>
            <Text type='secondary'>{t('agentReport.agentName')}</Text>
            <Input value={agentName} onChange={setAgentName} placeholder='CaMeL Manager' />
          </div>
        </div>
        <div>
          <Text type='secondary'>{t('agentReport.summary')}</Text>
          <TextArea value={summary} onChange={setSummary} rows={3} placeholder={t('agentReport.summaryPlaceholder')} />
        </div>
        <div>
          <Text type='secondary'>{t('agentReport.htmlContent')}</Text>
          <TextArea value={htmlContent} onChange={setHtmlContent} rows={6} placeholder={t('agentReport.htmlPlaceholder')} />
        </div>
      </div>
    </Modal>
  );
}
