import React from 'react';
import { Input, Select, Button } from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';

const PurchaseFilters = ({
  keyword,
  setKeyword,
  statusFilter,
  setStatusFilter,
  refresh,
  loading,
  t,
}) => {
  return (
    <div className='flex flex-col sm:flex-row gap-2 items-start sm:items-center'>
      <Input
        prefix={<IconSearch />}
        placeholder={t('搜索订单号或用户名')}
        value={keyword}
        onChange={(val) => setKeyword(val)}
        onEnterPress={refresh}
        showClear
        size='small'
        style={{ width: 240 }}
      />
      <Select
        placeholder={t('状态筛选')}
        value={statusFilter}
        onChange={(val) => setStatusFilter(val || '')}
        showClear
        size='small'
        style={{ width: 140 }}
      >
        <Select.Option value=''>{t('全部')}</Select.Option>
        <Select.Option value='pending'>{t('待支付')}</Select.Option>
        <Select.Option value='success'>{t('成功')}</Select.Option>
        <Select.Option value='expired'>{t('已过期')}</Select.Option>
      </Select>
      <Button
        type='tertiary'
        size='small'
        loading={loading}
        onClick={refresh}
      >
        {t('查询')}
      </Button>
    </div>
  );
};

export default PurchaseFilters;
