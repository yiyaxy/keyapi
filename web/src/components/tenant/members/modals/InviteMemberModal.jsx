import React, { useState, useRef } from 'react';
import { Modal, Form, Typography, Banner } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';

export default function InviteMemberModal({ visible, onClose, onInvite }) {
  const { t } = useTranslation();
  const formApiRef = useRef(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastToken, setLastToken] = useState('');

  const handleOk = async () => {
    const api = formApiRef.current;
    if (!api) return;
    let values;
    try {
      values = await api.validate();
    } catch (e) {
      return;
    }
    setSubmitting(true);
    try {
      const result = await onInvite({ email: values.email, role: Number(values.role) });
      if (result && result.status === 'invited' && result.token) {
        setLastToken(result.token);
      } else if (result && result.status === 'joined') {
        setLastToken('');
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setLastToken('');
    onClose();
  };

  return (
    <Modal
      title={t('邀请成员')}
      visible={visible}
      onOk={handleOk}
      onCancel={handleClose}
      confirmLoading={submitting}
      okText={t('发送邀请')}
      cancelText={t('取消')}
    >
      <Form
        getFormApi={(api) => (formApiRef.current = api)}
        labelPosition='left'
        labelWidth={100}
      >
        <Form.Input
          field='email'
          label={t('邮箱')}
          rules={[
            { required: true, message: t('邮箱必填') },
            { type: 'email', message: t('邮箱格式不正确') },
          ]}
        />
        <Form.Select field='role' label={t('角色')} initValue={1}>
          <Form.Select.Option value={1}>{t('普通成员')}</Form.Select.Option>
          <Form.Select.Option value={10}>{t('租户管理员')}</Form.Select.Option>
        </Form.Select>
      </Form>
      {lastToken ? (
        <Banner
          type='info'
          description={
            <Typography.Text copyable={{ content: lastToken }}>
              {t('用户未注册，邀请 token 已生成（48 小时有效）：')} {lastToken}
            </Typography.Text>
          }
          style={{ marginTop: 12 }}
        />
      ) : null}
    </Modal>
  );
}
