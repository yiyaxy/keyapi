import React from 'react';
import { Input, Select, Space } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';

export default function TenantMembersFilters({
  keyword,
  onKeywordChange,
  statusFilter,
  onStatusFilterChange,
}) {
  const { t } = useTranslation();
  return (
    <Space>
      <Input
        placeholder={t('搜索用户名/邮箱/昵称')}
        value={keyword}
        onChange={onKeywordChange}
        style={{ width: 260 }}
        showClear
      />
      <Select value={statusFilter} onChange={onStatusFilterChange} style={{ width: 140 }}>
        <Select.Option value={0}>{t('全部状态')}</Select.Option>
        <Select.Option value={1}>{t('启用')}</Select.Option>
        <Select.Option value={2}>{t('禁用')}</Select.Option>
        <Select.Option value={3}>{t('已移除')}</Select.Option>
      </Select>
    </Space>
  );
}
