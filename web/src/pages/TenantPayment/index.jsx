import React from 'react';
import { Tabs, Typography } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import WechatConfig from './WechatConfig';
import OrderList from './OrderList';

const { TabPane } = Tabs;
const { Title } = Typography;

export default function TenantPaymentPage() {
  const { t } = useTranslation();

  return (
    <div style={{ padding: 24 }}>
      <Title heading={3} style={{ marginBottom: 16 }}>
        {t('支付配置')}
      </Title>
      <Tabs type='line'>
        <TabPane tab={t('微信支付（WeChat Pay v3）')} itemKey='config'>
          <WechatConfig />
        </TabPane>
        <TabPane tab='订单' itemKey='orders'>
          <OrderList />
        </TabPane>
        <TabPane tab='退款（S3 提供）' itemKey='refunds' disabled>
          <div />
        </TabPane>
      </Tabs>
    </div>
  );
}
