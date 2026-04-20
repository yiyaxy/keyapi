import React, { useRef, useEffect } from 'react';
import { Modal, Form } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';

export default function EditMemberRoleModal({ visible, member, onClose, onSubmit }) {
  const { t } = useTranslation();
  const formApiRef = useRef(null);

  useEffect(() => {
    if (visible && member && formApiRef.current) {
      formApiRef.current.setValues({
        user: `${member.display_name || member.username} <${member.email}>`,
        role: member.tenant_role,
        status: member.membership_status,
      });
    }
  }, [visible, member]);

  if (!member) return null;

  const handleOk = async () => {
    const api = formApiRef.current;
    if (!api) return;
    let values;
    try {
      values = await api.validate();
    } catch (e) {
      return;
    }
    const ok = await onSubmit({
      user_id: member.user_id,
      role: Number(values.role),
      status: Number(values.status),
    });
    if (ok) onClose();
  };

  return (
    <Modal
      title={t('编辑成员')}
      visible={visible}
      onOk={handleOk}
      onCancel={onClose}
      okText={t('保存')}
      cancelText={t('取消')}
    >
      <Form getFormApi={(api) => (formApiRef.current = api)} labelPosition='left' labelWidth={100}>
        <Form.Input field='user' label={t('用户')} disabled />
        <Form.Select field='role' label={t('角色')}>
          <Form.Select.Option value={1}>{t('普通成员')}</Form.Select.Option>
          <Form.Select.Option value={10}>{t('租户管理员')}</Form.Select.Option>
        </Form.Select>
        <Form.Select field='status' label={t('状态')}>
          <Form.Select.Option value={1}>{t('启用')}</Form.Select.Option>
          <Form.Select.Option value={2}>{t('禁用')}</Form.Select.Option>
        </Form.Select>
      </Form>
    </Modal>
  );
}
