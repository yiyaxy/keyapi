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
  Select,
  Space,
  Table,
  Tag,
  Typography,
  TextArea,
} from '@douyinfe/semi-ui';
import { IconRefresh, IconSearch } from '@douyinfe/semi-icons';

import { showError } from '../../helpers';
import { timestamp2string } from '../../helpers/utils';
import { useTicketAdminData } from '../../hooks/ticket/useTicketAdminData';

const { Text } = Typography;

const STATUS_META = {
  open: { color: 'blue', textKey: 'tickets.statusOpen' },
  processing: { color: 'orange', textKey: 'tickets.statusProcessing' },
  closed: { color: 'grey', textKey: 'tickets.statusClosed' },
};

function safeJsonParse(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export default function TicketsAdminPage() {
  const { t } = useTranslation();
  const {
    tickets,
    total,
    loading,
    page,
    setPage,
    pageSize,
    setPageSize,
    fetchTickets,
    fetchTicketDetail,
    replyTicket,
    updateStatus,
    presignAttachment,
  } = useTicketAdminData();

  const [keywordInput, setKeywordInput] = useState('');
  const [statusInput, setStatusInput] = useState('');
  const [userIdInput, setUserIdInput] = useState('');
  const [query, setQuery] = useState({ status: '', keyword: '', userId: '' });

  const [detailVisible, setDetailVisible] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [currentTicket, setCurrentTicket] = useState(null);
  const [nextStatus, setNextStatus] = useState('');

  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewName, setPreviewName] = useState('');
  const [previewAttId, setPreviewAttId] = useState(null);

  const loadTickets = useCallback(() => {
    fetchTickets(page, pageSize, query);
  }, [fetchTickets, page, pageSize, query]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    if (!currentTicket) return;
    setNextStatus(String(currentTicket.status || ''));
  }, [currentTicket]);

  const handleSearch = () => {
    setQuery({
      status: String(statusInput || '').trim(),
      keyword: String(keywordInput || '').trim(),
      userId: String(userIdInput || '').trim(),
    });
    setPage(1);
  };

  const handleOpenDetail = async (record) => {
    const id = record?.id;
    if (!id) return;

    setDetailVisible(true);
    setDetailLoading(true);
    const detail = await fetchTicketDetail(id);
    setCurrentTicket(detail);
    setDetailLoading(false);
  };

  const handleOpenAttachment = async (att) => {
    const attId = att?.id;
    if (!attId) return;

    const meta = safeJsonParse(att?.meta);
    const name =
      String(att?.original_filename || '').trim() ||
      String(meta?.original_filename || '').trim() ||
      String(att?.object_key || '').trim() ||
      `#${attId}`;

    setPreviewVisible(true);
    setPreviewLoading(true);
    setPreviewUrl('');
    setPreviewName(name);
    setPreviewAttId(attId);

    const data = await presignAttachment(attId);
    const url = data?.url;
    if (!url) {
      showError('Failed to load attachment');
      setPreviewLoading(false);
      return;
    }

    setPreviewUrl(url);
    setPreviewLoading(false);
  };

  const handleDownloadAttachment = async () => {
    if (!previewAttId) return;
    setPreviewLoading(true);

    const data = await presignAttachment(previewAttId, { disposition: 'attachment' });
    const url = data?.url;
    if (!url) {
      showError('Failed to download attachment');
      setPreviewLoading(false);
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
    setPreviewLoading(false);
  };

  const handleReplySubmit = async ({ content, files }) => {
    const ticketId = currentTicket?.id;
    if (!ticketId) return;

    const ok = await replyTicket(ticketId, { content, files });
    if (ok) {
      const detail = await fetchTicketDetail(ticketId);
      setCurrentTicket(detail);
      loadTickets();
    }
  };

  const handleUpdateStatus = async () => {
    const ticketId = currentTicket?.id;
    if (!ticketId) return;

    const ok = await updateStatus(ticketId, nextStatus);
    if (ok) {
      const detail = await fetchTicketDetail(ticketId);
      setCurrentTicket(detail);
      loadTickets();
    }
  };

  const columns = useMemo(
    () => [
      { title: 'ID', dataIndex: 'id', width: 90 },
      {
        title: t('tickets.subject'),
        dataIndex: 'subject',
        render: (v) => String(v ?? ''),
      },
      {
        title: t('tickets.userId'),
        dataIndex: 'user_id',
        width: 120,
        render: (v) => (v === null || v === undefined ? '-' : String(v)),
      },
      {
        title: t('tickets.status'),
        dataIndex: 'status',
        width: 140,
        render: (status) => {
          const meta = STATUS_META[String(status)] || {
            color: 'grey',
            textKey: 'tickets.statusUnknown',
          };
          return <Tag color={meta.color}>{t(meta.textKey)}</Tag>;
        },
      },
      {
        title: t('tickets.updatedAt'),
        dataIndex: 'updated_at',
        width: 180,
        render: (ts) => (ts ? timestamp2string(ts) : '-'),
      },
      {
        title: t('tickets.action'),
        width: 120,
        render: (_, record) => (
          <Button size='small' onClick={() => handleOpenDetail(record)}>
            {t('tickets.view')}
          </Button>
        ),
      },
    ],
    [t],
  );

  const replies = Array.isArray(currentTicket?.replies)
    ? currentTicket.replies
    : Array.isArray(currentTicket?.ticket_replies)
      ? currentTicket.ticket_replies
      : [];

  const attachments = Array.isArray(currentTicket?.attachments)
    ? currentTicket.attachments
    : [];

  return (
    <div className='mt-[60px] px-2'>
      <Card>
        <div className='flex flex-wrap gap-2 mb-4 items-center'>
          <Input
            prefix={<IconSearch />}
            placeholder={t('tickets.keywordPlaceholder')}
            value={keywordInput}
            onChange={setKeywordInput}
            style={{ width: 220 }}
          />

          <Select
            placeholder={t('tickets.status')}
            value={statusInput}
            onChange={setStatusInput}
            optionList={[
              { value: '', label: t('tickets.all') },
              { value: 'open', label: t('tickets.statusOpen') },
              { value: 'processing', label: t('tickets.statusProcessing') },
              { value: 'closed', label: t('tickets.statusClosed') },
            ]}
            style={{ width: 160 }}
          />

          <Input
            placeholder={t('tickets.userIdPlaceholder')}
            value={userIdInput}
            onChange={setUserIdInput}
            style={{ width: 160 }}
          />

          <Button icon={<IconSearch />} onClick={handleSearch}>
            {t('tickets.search')}
          </Button>
          <Button icon={<IconRefresh />} onClick={loadTickets}>
            {t('tickets.refresh')}
          </Button>
        </div>

        <Table
          columns={columns}
          dataSource={tickets}
          loading={loading}
          pagination={false}
          rowKey='id'
          empty={<Empty description={t('tickets.empty')} />}
          onRow={(record) => ({
            style: { cursor: 'pointer' },
            onClick: () => handleOpenDetail(record),
          })}
        />

        <div className='flex justify-end mt-4'>
          <Pagination
            total={total}
            currentPage={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            showSizeChanger
            pageSizeOpts={[10, 20, 50]}
          />
        </div>
      </Card>

      <Modal
        title={t('tickets.adminDetailTitle')}
        visible={detailVisible}
        onCancel={() => {
          setDetailVisible(false);
          setCurrentTicket(null);
        }}
        footer={null}
        width={900}
      >
        {detailLoading ? (
          <Text>{t('tickets.loading')}</Text>
        ) : currentTicket ? (
          <div className='flex flex-col gap-4'>
            <div className='flex flex-wrap gap-2 items-center justify-between'>
              <div className='flex flex-wrap gap-2 items-center'>
                <Text strong>{String(currentTicket.subject ?? '')}</Text>
                <Tag color={(STATUS_META[String(currentTicket.status)] || {}).color || 'grey'}>
                  {t((STATUS_META[String(currentTicket.status)] || {}).textKey || 'tickets.statusUnknown')}
                </Tag>
                <Text type='tertiary'>
                  {t('tickets.userId')}: {currentTicket.user_id ?? '-'}
                </Text>
                <Text type='tertiary'>
                  {t('tickets.updatedAt')}: {currentTicket.updated_at ? timestamp2string(currentTicket.updated_at) : '-'}
                </Text>
              </div>

              <Space>
                <Select
                  value={nextStatus}
                  onChange={setNextStatus}
                  optionList={[
                    { value: 'open', label: t('tickets.statusOpen') },
                    { value: 'processing', label: t('tickets.statusProcessing') },
                    { value: 'closed', label: t('tickets.statusClosed') },
                  ]}
                  style={{ width: 160 }}
                />
                <Button onClick={handleUpdateStatus}>
                  {t('tickets.updateStatus')}
                </Button>
              </Space>
            </div>

            {attachments.length > 0 && (
              <div>
                <Text strong>{t('tickets.attachments')}</Text>
                <Banner
                  type='warning'
                  title={t('tickets.detailDisclaimerTitle')}
                  description={t('tickets.detailDisclaimerBody')}
                  closeIcon={null}
                  className='!mt-2 !rounded-xl'
                />
                <div className='mt-2 flex flex-wrap gap-2'>
                  {attachments.map((att) => {
                    const meta = safeJsonParse(att?.meta);
                    const name =
                      String(att?.original_filename || '').trim() ||
                      String(meta?.original_filename || '').trim() ||
                      String(att?.object_key || '').trim() ||
                      `#${att?.id}`;
                    return (
                      <Button
                        key={att?.id || name}
                        size='small'
                        theme='outline'
                        onClick={() => handleOpenAttachment(att)}
                      >
                        {name}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <Text strong>{t('tickets.replies')}</Text>
              <div className='mt-2 flex flex-col gap-2'>
                {replies.length === 0 ? (
                  <Text type='tertiary'>{t('tickets.noReplies')}</Text>
                ) : (
                  replies.map((r) => (
                    <Card key={r?.id || `${r?.role}-${r?.created_at}`} bodyStyle={{ padding: 12 }}>
                      <div className='flex justify-between gap-2'>
                        <Tag color={r?.role === 'admin' ? 'purple' : 'blue'}>
                          {r?.role === 'admin' ? t('tickets.roleAdmin') : t('tickets.roleUser')}
                        </Tag>
                        <Text type='tertiary'>
                          {r?.created_at ? timestamp2string(r.created_at) : '-'}
                        </Text>
                      </div>
                      <div className='mt-2 whitespace-pre-wrap break-words'>
                        {String(r?.content ?? '')}
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </div>

            <ReplyTicketPanel t={t} onSubmit={handleReplySubmit} />
          </div>
        ) : (
          <Text type='tertiary'>{t('tickets.notFound')}</Text>
        )}
      </Modal>

      <Modal
        title={previewName || t('tickets.attachments')}
        visible={previewVisible}
        onCancel={() => {
          setPreviewVisible(false);
          setPreviewUrl('');
          setPreviewName('');
          setPreviewAttId(null);
          setPreviewLoading(false);
        }}
        footer={
          <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
            <Button loading={previewLoading} onClick={handleDownloadAttachment}>
              {t('tickets.download')}
            </Button>
            <Button
              type='primary'
              onClick={() => {
                setPreviewVisible(false);
                setPreviewUrl('');
                setPreviewName('');
                setPreviewAttId(null);
                setPreviewLoading(false);
              }}
            >
              {t('tickets.view')}
            </Button>
          </Space>
        }
        width={860}
      >
        {previewLoading ? (
          <Text>{t('tickets.loading')}</Text>
        ) : previewUrl ? (
          <div className='flex justify-center'>
            <img
              src={previewUrl}
              alt={previewName}
              style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }}
            />
          </div>
        ) : (
          <Text type='tertiary'>{t('tickets.preview')}</Text>
        )}
      </Modal>
    </div>
  );
}

function ReplyTicketPanel({ t, onSubmit }) {
  const [content, setContent] = useState('');
  const [files, setFiles] = useState([]);
  const fileInputRef = React.useRef(null);

  const handleSend = () => {
    if (!String(content || '').trim()) return;
    onSubmit({ content, files });
    setContent('');
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (e) => {
    const newFiles = Array.from(e.target.files || []);
    if (newFiles.length > 0) {
      setFiles((prev) => {
        const combined = [...prev, ...newFiles];
        return combined.slice(0, 5);
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <Card bodyStyle={{ padding: 12 }}>
      <div className='flex flex-col gap-3'>
        <Text strong>{t('tickets.reply')}</Text>
        <TextArea
          value={content}
          onChange={setContent}
          rows={4}
          placeholder={t('tickets.replyPlaceholder')}
        />
        <div>
          <Text type='secondary'>{t('tickets.attachments')}</Text>
          <input
            ref={fileInputRef}
            type='file'
            multiple
            accept='image/*'
            onChange={handleFileChange}
          />
          {files.length > 0 && (
            <div className='mt-2 flex flex-wrap gap-1'>
              {files.map((f, i) => (
                <Tag
                  key={`${f.name}-${i}`}
                  closable
                  onClose={() => handleRemoveFile(i)}
                  color='blue'
                  size='small'
                >
                  {f.name}
                </Tag>
              ))}
            </div>
          )}
        </div>
        <div className='flex justify-end'>
          <Button type='primary' onClick={handleSend}>
            {t('tickets.send')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
