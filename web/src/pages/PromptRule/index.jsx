import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Table, Button, Tag, Switch, Modal, Form, Input, Select, InputNumber,
  Popconfirm, Space, Typography,
} from '@douyinfe/semi-ui';
import { usePromptRuleData } from '../../hooks/prompt-rule/usePromptRuleData';

const { TextArea } = Input;
const { Text } = Typography;

export default function PromptRule() {
  const { t } = useTranslation();
  const {
    rules, loading, total, page, pageSize, keyword,
    setPage, setPageSize, setKeyword,
    createRule, updateRule, deleteRule, toggleEnabled,
  } = usePromptRuleData();

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formType, setFormType] = useState(1);
  const formRef = React.useRef();

  const openCreate = () => {
    setEditingRule(null);
    setFormType(1);
    setModalVisible(true);
  };

  const openEdit = (rule) => {
    setEditingRule(rule);
    setFormType(rule.type);
    setModalVisible(true);
  };

  const handleSubmit = async (values) => {
    setSubmitting(true);
    let ok;
    if (editingRule) {
      ok = await updateRule({ ...values, id: editingRule.id });
    } else {
      ok = await createRule(values);
    }
    setSubmitting(false);
    if (ok) setModalVisible(false);
  };

  const columns = [
    { title: t('名称'), dataIndex: 'name', width: 150 },
    {
      title: t('类型'), dataIndex: 'type', width: 120,
      render: (v) => {
        if (v === 1) return <Tag color="blue">{t('整条替换')}</Tag>;
        if (v === 2) return <Tag color="green">{t('关键词替换')}</Tag>;
        if (v === 3) return <Tag color="orange">{t('回复替换')}</Tag>;
        return <Tag color="red">{t('AI改写')}</Tag>;
      },
    },
    {
      title: t('触发词'), dataIndex: 'keyword', width: 200,
      render: (v) => <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 180 }}>{v}</Text>,
    },
    {
      title: t('替换内容'), dataIndex: 'replacement', width: 200,
      render: (v) => <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 180 }}>{v}</Text>,
    },
    {
      title: t('渠道'), dataIndex: 'channel_id', width: 100,
      render: (v) => v === 0 ? <Tag>{t('全局')}</Tag> : <Tag color="violet">#{v}</Tag>,
    },
    {
      title: t('优先级'), dataIndex: 'priority', width: 80,
    },
    {
      title: t('状态'), dataIndex: 'enabled', width: 80,
      render: (v, record) => (
        <Switch checked={v} onChange={() => toggleEnabled(record)} size="small" />
      ),
    },
    {
      title: t('操作'), width: 120,
      render: (_, record) => (
        <Space>
          <Button theme="light" size="small" onClick={() => openEdit(record)}>{t('编辑')}</Button>
          <Popconfirm title={t('确认删除？')} onConfirm={() => deleteRule(record.id)}>
            <Button theme="light" type="danger" size="small">{t('删除')}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Input
          placeholder={t('搜索规则名称或触发词')}
          value={keyword}
          onChange={setKeyword}
          style={{ width: 300 }}
        />
        <Button theme="solid" onClick={openCreate}>{t('新建规则')}</Button>
      </div>

      <Table
        columns={columns}
        dataSource={rules}
        loading={loading}
        rowKey="id"
        pagination={{
          currentPage: page,
          pageSize,
          total,
          onPageChange: setPage,
          onPageSizeChange: (size) => { setPageSize(size); setPage(1); },
          showSizeChanger: true,
        }}
      />

      <Modal
        title={editingRule ? t('编辑规则') : t('新建规则')}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        closeOnEsc
      >
        <Form
          ref={formRef}
          initValues={editingRule || { type: 1, channel_id: 0, enabled: true, priority: 0, rewrite_channel_id: 0, rewrite_model: '' }}
          onSubmit={handleSubmit}
          key={editingRule ? editingRule.id : 'new'}
        >
          <Form.Input field="name" label={t('名称')} rules={[{ required: true }]} />
          <Form.Select field="type" label={t('类型')} style={{ width: '100%' }} onChange={(v) => setFormType(v)}>
            <Select.Option value={1}>{t('整条替换')}</Select.Option>
            <Select.Option value={2}>{t('关键词替换')}</Select.Option>
            <Select.Option value={3}>{t('回复替换')}</Select.Option>
            <Select.Option value={4}>{t('AI改写')}</Select.Option>
          </Form.Select>
          <Form.TextArea field="keyword" label={t('触发词')} placeholder={t('每行一个触发词')} rows={3} rules={[{ required: true }]} />
          <Form.TextArea field="replacement" label={formType === 4 ? t('改写提示词') : t('替换内容')} placeholder={formType === 4 ? t('支持 {{content}} 和 {{model}} 变量') : ''} rows={4} />
          {formType === 4 && (
            <>
              <Form.InputNumber field="rewrite_channel_id" label={t('改写渠道ID')} extraText={t('0 表示使用翻译渠道')} min={0} style={{ width: '100%' }} />
              <Form.Input field="rewrite_model" label={t('改写模型')} placeholder={t('留空使用翻译模型')} />
            </>
          )}
          <Form.InputNumber field="channel_id" label={t('渠道ID')} extraText={t('0 表示全局规则')} min={0} style={{ width: '100%' }} />
          <Form.InputNumber field="priority" label={t('优先级')} extraText={t('数字越大越优先')} style={{ width: '100%' }} />
          <Form.Switch field="enabled" label={t('启用')} />
          <div style={{ textAlign: 'right', marginTop: 16 }}>
            <Button style={{ marginRight: 8 }} onClick={() => setModalVisible(false)}>{t('取消')}</Button>
            <Button theme="solid" htmlType="submit" loading={submitting}>{t('提交')}</Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
