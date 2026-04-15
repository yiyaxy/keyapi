import React, { useMemo } from 'react';
import { Empty } from '@douyinfe/semi-ui';
import {
  IllustrationNoResult,
  IllustrationNoResultDark,
} from '@douyinfe/semi-illustrations';
import CardTable from '../../common/ui/CardTable';
import {
  getTopupOrderColumns,
  getSubscriptionOrderColumns,
} from './PurchaseColumnDefs';

const PurchaseTable = (purchaseData) => {
  const {
    activeTab,
    topupData,
    subData,
    loading,
    t,
    completeTopup,
    expireTopup,
    deleteTopup,
    completeSub,
    expireSub,
    deleteSub,
  } = purchaseData;

  const topupColumns = useMemo(
    () =>
      getTopupOrderColumns({
        t,
        completeTopup,
        expireTopup,
        deleteTopup,
      }),
    [t, completeTopup, expireTopup, deleteTopup],
  );

  const subColumns = useMemo(
    () =>
      getSubscriptionOrderColumns({
        t,
        completeSub,
        expireSub,
        deleteSub,
      }),
    [t, completeSub, expireSub, deleteSub],
  );

  const columns = activeTab === 'topup' ? topupColumns : subColumns;
  const data = activeTab === 'topup' ? topupData : subData;

  return (
    <CardTable
      columns={columns}
      dataSource={data}
      loading={loading}
      rowKey='id'
      hidePagination
      scroll={{ x: 'max-content' }}
      empty={
        <Empty
          image={<IllustrationNoResult />}
          darkModeImage={<IllustrationNoResultDark />}
          description={t('暂无订单记录')}
        />
      }
    />
  );
};

export default PurchaseTable;
