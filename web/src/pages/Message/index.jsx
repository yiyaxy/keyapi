import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Table, Button, Modal, Input, Select, Tag, Space,
  Popconfirm, Typography, Card, Pagination, TextArea,
} from '@douyinfe/semi-ui';
import { IconPlus, IconSearch, IconRefresh } from '@douyinfe/semi-icons';

import { useMessageData } from '../../hooks/message/useMessageData';
import { timestamp2string } from '../../helpers/utils';
const { Text } = Typography;

const MESSAGE_TYPES = [
  { value: 1, label: '定向消息' },
  { value: 2, label: '广播消息' },
];

const MESSAGE_STATUS = {
  1: { text: '已发送', color: 'green' },
  2: { text: '已撤回', color: 'red' },
};

export default function MessagePage() {
  const { t } = useTranslation();
  const {
    messages, total, loading,
    page, setPage, pageSize, setPageSize,
    fetchMessages, createMessage, editMessage,
    recallMessage, fetchReadStatus,
  } = useMessageData();

  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState(null);
  const [formVisible, setFormVisible] = useState(false);
  const [editingMsg, setEditingMsg] = useState(null);
  const [readStatusVisible, setReadStatusVisible] = useState(false);
  const [readStatusData, setReadStatusData] = useState(null);
  const [readStatusLoading, setReadStatusLoading] = useState(false);

  const loadMessages = useCallback(() => {
    fetchMessages(page, pageSize, keyword, typeFilter);
  }, [fetchMessages, page, pageSize, keyword, typeFilter]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  const handleSearch = () => {
    setPage(1);
    fetchMessages(1, pageSize, keyword, typeFilter);
  };

  const handleCreate = () => {
    setEditingMsg(null);
    setFormVisible(true);
  };

  const handleEdit = (record) => {
    setEditingMsg(record);
    setFormVisible(true);
  };

  const handleRecall = async (id) => {
    const ok = await recallMessage(id);
    if (ok) loadMessages();
  };

  const handleViewReadStatus = async (record) => {
    setReadStatusLoading(true);
    setReadStatusVisible(true);
    const data = await fetchReadStatus(record.id);
    setReadStatusData(data);
    setReadStatusLoading(false);
  };

  const handleFormSubmit = async (values) => {
    let ok;
    if (editingMsg) {
      ok = await editMessage(editingMsg.id, values);
    } else {
      ok = await createMessage(values);
    }
    if (ok) {
      setFormVisible(false);
      loadMessages();
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: t('消息标题'), dataIndex: 'title', width: 200 },
    {
      title: t('消息类型'),
      dataIndex: 'type',
      width: 100,
      render: (type) => {
        const item = MESSAGE_TYPES.find((mt) => mt.value === type);
        return item ? t(item.label) : '-';
      },
    },
    {
      title: t('目标用户'),
      dataIndex: 'target_user_id',
      width: 100,
      render: (id, record) => (record.type === 2 ? t('全体用户') : id),
    },
    {
      title: t('消息状态'),
      dataIndex: 'status',
      width: 100,
      render: (status) => {
        const s = MESSAGE_STATUS[status] || { text: '-', color: 'grey' };
        return <Tag color={s.color}>{s.text === '-' ? '-' : t(s.text)}</Tag>;
      },
    },
    {
      title: t('发送时间'),
      dataIndex: 'created_at',
      width: 180,
      render: (ts) => timestamp2string(ts),
    },
    {
      title: t('操作'),
      width: 200,
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => handleEdit(record)}>
            {t('编辑')}
          </Button>
          <Button size="small" onClick={() => handleViewReadStatus(record)}>
            {t('已读状态')}
          </Button>
          {record.status === 1 && (
            <Popconfirm
              title={t('确认撤回此消息？')}
              content={t('撤回后用户将无法查看此消息')}
              onConfirm={() => handleRecall(record.id)}
            >
              <Button size="small" type="danger">
                {t('撤回')}
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className='mt-[60px] px-2'>
      <Card>
        <div className="flex flex-wrap gap-2 mb-4">
          <Input
            prefix={<IconSearch />}
            placeholder={t('搜索标题')}
            value={keyword}
            onChange={setKeyword}
            style={{ width: 200 }}
          />
          <Select
            placeholder={t('消息类型')}
            value={typeFilter}
            onChange={setTypeFilter}
            optionList={[{ value: null, label: t('全部') }, ...MESSAGE_TYPES]}
            style={{ width: 120 }}
          />
          <Button icon={<IconSearch />} onClick={handleSearch}>
            {t('搜索')}
          </Button>
          <Button icon={<IconRefresh />} onClick={loadMessages}>
            {t('刷新')}
          </Button>
          <Button icon={<IconPlus />} type="primary" onClick={handleCreate}>
            {t('发送消息')}
          </Button>
        </div>

        <Table
          columns={columns}
          dataSource={messages}
          loading={loading}
          pagination={false}
          rowKey="id"
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

      {/* Create/Edit Form Modal */}
      <MessageFormModal
        visible={formVisible}
        editingMsg={editingMsg}
        onCancel={() => setFormVisible(false)}
        onSubmit={handleFormSubmit}
        t={t}
      />

      {/* Read Status Modal */}
      <Modal
        title={t('查看已读状态')}
        visible={readStatusVisible}
        onCancel={() => setReadStatusVisible(false)}
        footer={null}
        width={500}
      >
        {readStatusLoading ? (
          <Text>{t('加载中...')}</Text>
        ) : readStatusData?.items?.length > 0 ? (
          <Table
            columns={[
              { title: t('用户ID'), dataIndex: 'user_id', width: 100 },
              {
                title: t('阅读时间'),
                dataIndex: 'read_at',
                render: (ts) => timestamp2string(ts),
              },
            ]}
            dataSource={readStatusData.items}
            pagination={false}
            rowKey="id"
            size="small"
          />
        ) : (
          <Text type="tertiary">{t('暂无已读记录')}</Text>
        )}
      </Modal>
    </div>
  );
}

function MessageFormModal({ visible, editingMsg, onCancel, onSubmit, t }) {
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    type: 2,
    target_user_id: 0,
  });

  useEffect(() => {
    if (visible) {
      if (editingMsg) {
        setFormData({
          title: editingMsg.title,
          content: editingMsg.content,
          type: editingMsg.type,
          target_user_id: editingMsg.target_user_id,
        });
      } else {
        setFormData({ title: '', content: '', type: 2, target_user_id: 0 });
      }
    }
  }, [editingMsg, visible]);

  const handleSubmit = () => {
    if (!formData.title || !formData.content) return;
    onSubmit({
      title: String(formData.title).trim(),
      content: String(formData.content).trim(),
      type: Number(formData.type) || 2,
      target_user_id: Number(formData.target_user_id) || 0,
    });
  };

  return (
    <Modal
      title={editingMsg ? t('编辑消息') : t('发送消息')}
      visible={visible}
      onCancel={onCancel}
      onOk={handleSubmit}
      okText={editingMsg ? t('保存') : t('发送')}
      width={600}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2">
          <label className="w-[100px] text-right pt-2 flex-shrink-0">{t('消息标题')}</label>
          <div className="flex-1">
            <Input
              value={formData.title}
              onChange={(v) => setFormData((prev) => ({ ...prev, title: v }))}
              placeholder={t('请输入消息标题')}
            />
          </div>
        </div>
        <div className="flex items-start gap-2">
          <label className="w-[100px] text-right pt-2 flex-shrink-0">{t('消息内容')}</label>
          <div className="flex-1">
            <TextArea
              value={formData.content}
              onChange={(v) => setFormData((prev) => ({ ...prev, content: v }))}
              placeholder={t('支持 Markdown 格式')}
              rows={6}
            />
          </div>
        </div>
        {!editingMsg && (
          <>
            <div className="flex items-start gap-2">
              <label className="w-[100px] text-right pt-2 flex-shrink-0">{t('消息类型')}</label>
              <div className="flex-1">
                <Select
                  value={formData.type}
                  onChange={(v) => setFormData((prev) => ({ ...prev, type: v }))}
                  optionList={MESSAGE_TYPES}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            {formData.type === 1 && (
              <div className="flex items-start gap-2">
                <label className="w-[100px] text-right pt-2 flex-shrink-0">{t('目标用户')}</label>
                <div className="flex-1">
                  <Input
                    type="number"
                    value={formData.target_user_id}
                    onChange={(v) => setFormData((prev) => ({ ...prev, target_user_id: parseInt(v) || 0 }))}
                    placeholder={t('请输入用户ID')}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
