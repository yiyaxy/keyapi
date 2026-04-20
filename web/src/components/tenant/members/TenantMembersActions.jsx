import React from 'react';
import { Button } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';

export default function TenantMembersActions({ onInviteClick, onRefresh }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <Button theme='solid' type='primary' onClick={onInviteClick}>
        {t('邀请成员')}
      </Button>
      <Button onClick={onRefresh}>{t('刷新')}</Button>
    </div>
  );
}
