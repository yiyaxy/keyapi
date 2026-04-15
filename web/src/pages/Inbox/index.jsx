import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Table, Button, Modal, Tag, Space, Typography, Card, Pagination, Empty,
} from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';

import { useInboxData } from '../../hooks/message/useInboxData';
import { timestamp2string } from '../../helpers/utils';
import ReactMarkdown from 'react-markdown';

const { Text, Title } = Typography;

export default function InboxPage() {
  const { t, i18n } = useTranslation();
  const {
    messages, total, loading,
    page, setPage, pageSize, setPageSize,
    fetchInbox, fetchMessage, markAsRead,
  } = useInboxData();

  const [detailVisible, setDetailVisible] = useState(false);
  const [currentMessage, setCurrentMessage] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadInbox = useCallback(() => {
    const lang = i18n.language?.split('-')[0] || 'zh';
    fetchInbox(page, pageSize, lang);
  }, [fetchInbox, page, pageSize, i18n.language]);

  useEffect(() => {
    loadInbox();
  }, [loadInbox]);

  const handleViewMessage = async (record) => {
    setDetailLoading(true);
    setDetailVisible(true);
    const lang = i18n.language?.split('-')[0] || 'zh';
    const msg = await fetchMessage(record.id, lang);
    if (msg) {
      setCurrentMessage(msg);
      if (!record.is_read) {
        await markAsRead(record.id);
        loadInbox();
      }
    }
    setDetailLoading(false);
  };

  const columns = [
    {
      title: '',
      dataIndex: 'is_read',
      width: 40,
      render: (isRead) => (
        !isRead ? <div className="w-2 h-2 rounded-full bg-blue-500" /> : null
      ),
    },
    { title: t('消息标题'), dataIndex: 'title', width: 300 },
    {
      title: t('发送时间'),
      dataIndex: 'created_at',
      width: 180,
      render: (ts) => timestamp2string(ts),
    },
    {
      title: t('状态'),
      dataIndex: 'is_read',
      width: 100,
      render: (isRead) => (
        <Tag color={isRead ? 'grey' : 'blue'}>
          {isRead ? t('已读') : t('未读')}
        </Tag>
      ),
    },
    {
      title: t('操作'),
      width: 100,
      render: (_, record) => (
        <Button size="small" onClick={() => handleViewMessage(record)}>
          {t('查看')}
        </Button>
      ),
    },
  ];

  return (
    <div className='mt-[60px] px-2'>
      <Card>
        <div className="flex justify-between items-center mb-4">
          <Text type="secondary">
            {t('共 {{count}} 条消息', { count: total })}
          </Text>
          <Button icon={<IconRefresh />} onClick={loadInbox}>
            {t('刷新')}
          </Button>
        </div>

        <Table
          columns={columns}
          dataSource={messages}
          loading={loading}
          pagination={false}
          rowKey="id"
          empty={<Empty description={t('暂无消息')} />}
          onRow={(record) => ({
            style: { cursor: 'pointer' },
            onClick: () => handleViewMessage(record),
          })}
        />

        <div className="flex justify-end mt-4">
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

      {/* Message Detail Modal */}
      <Modal
        title={currentMessage?.title || t('消息详情')}
        visible={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={700}
      >
        {detailLoading ? (
          <Text>{t('加载中...')}</Text>
        ) : currentMessage ? (
          <div>
            <div className="mb-4 text-gray-500 text-sm flex items-center gap-2">
              <span>{t('发送时间')}: {timestamp2string(currentMessage.created_at)}</span>
              {currentMessage.translated && (
                <Tag color="green" size="small">{t('已翻译')}</Tag>
              )}
            </div>
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown>{String(currentMessage.content ?? '')}</ReactMarkdown>
            </div>
          </div>
        ) : (
          <Text type="tertiary">{t('消息不存在')}</Text>
        )}
      </Modal>
    </div>
  );
}
