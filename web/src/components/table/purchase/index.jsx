import React from 'react';
import { Tabs, TabPane } from '@douyinfe/semi-ui';
import CardPro from '../../common/ui/CardPro';
import PurchaseTable from './PurchaseTable';
import PurchaseFilters from './PurchaseFilters';
import PurchaseDescription from './PurchaseDescription';
import { usePurchaseData } from '../../../hooks/purchase/usePurchaseData';
import { useIsMobile } from '../../../hooks/common/useIsMobile';
import { createCardProPagination } from '../../../helpers/utils';

const PurchasePage = () => {
  const purchaseData = usePurchaseData();
  const isMobile = useIsMobile();

  const {
    t,
    activeTab,
    handleTabChange,
    topupPage,
    topupPageSize,
    topupTotal,
    handleTopupPageChange,
    handleTopupPageSizeChange,
    subPage,
    subPageSize,
    subTotal,
    handleSubPageChange,
    handleSubPageSizeChange,
  } = purchaseData;

  const currentPage = activeTab === 'topup' ? topupPage : subPage;
  const pageSize = activeTab === 'topup' ? topupPageSize : subPageSize;
  const total = activeTab === 'topup' ? topupTotal : subTotal;
  const onPageChange =
    activeTab === 'topup' ? handleTopupPageChange : handleSubPageChange;
  const onPageSizeChange =
    activeTab === 'topup'
      ? handleTopupPageSizeChange
      : handleSubPageSizeChange;

  return (
    <CardPro
      type='type1'
      descriptionArea={<PurchaseDescription t={t} />}
      actionsArea={
        <div className='flex flex-col md:flex-row justify-between items-start md:items-center gap-2 w-full'>
          <Tabs
            type='button'
            activeKey={activeTab}
            onChange={handleTabChange}
            size='small'
          >
            <TabPane tab={t('充值订单')} itemKey='topup' />
            <TabPane tab={t('订阅订单')} itemKey='subscription' />
          </Tabs>
          <PurchaseFilters {...purchaseData} />
        </div>
      }
      paginationArea={createCardProPagination({
        currentPage,
        pageSize,
        total,
        onPageChange,
        onPageSizeChange,
        isMobile,
        t,
      })}
      t={t}
    >
      <PurchaseTable {...purchaseData} />
    </CardPro>
  );
};

export default PurchasePage;
