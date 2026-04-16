import React, { useCallback, useEffect, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Input,
  Space,
  Popconfirm,
  Modal,
  Form,
  Banner,
  Typography,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess } from '../../../helpers';

/**
 * 租户配置编辑器：key-value 结构。
 * 后端接口（假定响应格式）：
 *   GET /api/tenant/config     → { success, data: { key1: value1, ... } }
 *   PUT /api/tenant/config     body: { key, value }
 *   DELETE /api/tenant/config  body: { key }
 *
 * 若后端响应是数组 [{key,value}]，此组件同样兼容。
 */
export default function TenantConfigEditor() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState([]); // [{key, value}]
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null); // {key, value} or null(=add new)
  const formApiRef = React.useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/tenant/config');
      if (res?.data?.success) {
        const d = res.data.data;
        let list = [];
        if (Array.isArray(d)) list = d;
        else if (d && typeof d === 'object') {
          list = Object.entries(d).map(([key, value]) => ({
            key,
            value: typeof value === 'string' ? value : JSON.stringify(value),
          }));
        }
        setEntries(list);
      } else showError(res?.data?.message || t('加载配置失败'));
    } catch (e) {
      showError(e?.message || t('加载配置失败'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async () => {
    const api = formApiRef.current;
    if (!api) return;
    let values;
    try {
      values = await api.validate();
    } catch (e) {
      return;
    }
    try {
      const res = await API.put('/api/tenant/config', {
        key: values.key,
        value: values.value,
      });
      if (res?.data?.success) {
        showSuccess(t('已保存'));
        setEditOpen(false);
        setEditTarget(null);
        await load();
      } else showError(res?.data?.message || t('保存失败'));
    } catch (e) {
      showError(e?.message || t('保存失败'));
    }
  };

  const handleDelete = async (row) => {
    try {
      const res = await API.delete('/api/tenant/config', { data: { key: row.key } });
      if (res?.data?.success) {
        showSuccess(t('已删除'));
        await load();
      } else showError(res?.data?.message || t('删除失败'));
    } catch (e) {
      showError(e?.message || t('删除失败'));
    }
  };

  const columns = [
    { title: t('Key'), dataIndex: 'key', width: 240 },
    {
      title: t('Value'),
      dataIndex: 'value',
      render: (v) => (
        <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 400 }}>
          {String(v ?? '')}
        </Typography.Text>
      ),
    },
    {
      title: t('操作'),
      width: 200,
      render: (_, r) => (
        <Space>
          <Button
            size='small'
            onClick={() => {
              setEditTarget(r);
              setEditOpen(true);
              setTimeout(() => {
                formApiRef.current?.setValues({ key: r.key, value: r.value });
              }, 50);
            }}
          >
            {t('编辑')}
          </Button>
          <Popconfirm title={t('确认删除此配置？')} onConfirm={() => handleDelete(r)}>
            <Button size='small' type='danger'>
              {t('删除')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title={t('租户配置')}
      headerExtraContent={
        <Button
          type='primary'
          theme='solid'
          onClick={() => {
            setEditTarget(null);
            setEditOpen(true);
            setTimeout(() => formApiRef.current?.setValues({ key: '', value: '' }), 50);
          }}
        >
          {t('新增配置')}
        </Button>
      }
    >
      <Banner
        type='info'
        description={t(
          '在此编辑的配置项仅对当前租户生效，覆盖平台默认值。空即恢复默认。',
        )}
        style={{ marginBottom: 12 }}
      />
      <Table
        rowKey='key'
        loading={loading}
        dataSource={entries}
        columns={columns}
        pagination={false}
      />
      <Modal
        title={editTarget ? t('编辑配置') : t('新增配置')}
        visible={editOpen}
        onOk={handleSubmit}
        onCancel={() => {
          setEditOpen(false);
          setEditTarget(null);
        }}
        okText={t('保存')}
        cancelText={t('取消')}
      >
        <Form
          getFormApi={(api) => (formApiRef.current = api)}
          labelPosition='left'
          labelWidth={80}
        >
          <Form.Input
            field='key'
            label='Key'
            rules={[{ required: true, message: t('Key 必填') }]}
            disabled={!!editTarget}
          />
          <Form.TextArea field='value' label='Value' rows={3} />
        </Form>
      </Modal>
    </Card>
  );
}
