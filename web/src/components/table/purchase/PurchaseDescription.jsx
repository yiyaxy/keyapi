import React from 'react';
import { Typography } from '@douyinfe/semi-ui';
import { ShoppingCart } from 'lucide-react';

const { Text } = Typography;

const PurchaseDescription = ({ t }) => {
  return (
    <div className='flex items-center text-blue-500'>
      <ShoppingCart size={16} className='mr-2' />
      <Text>{t('订单管理')}</Text>
    </div>
  );
};

export default PurchaseDescription;
