import React from 'react';
import { Typography, Badge, Button, Dropdown, Modal } from '@douyinfe/semi-ui';
import { timestamp2string } from '../../../helpers/utils';

const { Text } = Typography;

const STATUS_CONFIG = {
  success: { type: 'success', key: '成功' },
  pending: { type: 'warning', key: '待支付' },
  expired: { type: 'danger', key: '已过期' },
};

const PAYMENT_METHOD_MAP = {
  stripe: 'Stripe',
  creem: 'Creem',
  alipay: '支付宝',
  wxpay: '微信',
};

const CNY_METHODS = new Set(['alipay', 'wxpay', 'epay']);
const USD_METHODS = new Set(['stripe', 'creem']);

const getCurrencySymbol = (pm) => {
  if (USD_METHODS.has(pm)) return '$';
  return '¥';
};

const renderStatusBadge = (status, t) => {
  const config = STATUS_CONFIG[status] || { type: 'primary', key: status };
  return (
    <span className='flex items-center gap-2'>
      <Badge dot type={config.type} />
      <span>{t(config.key)}</span>
    </span>
  );
};

const renderPaymentMethod = (pm, t) => {
  const displayName = PAYMENT_METHOD_MAP[pm];
  return <Text>{displayName ? t(displayName) : pm || '-'}</Text>;
};

const confirmAction = (title, content, onOk) => {
  Modal.confirm({
    title,
    content,
    okType: 'danger',
    onOk,
  });
};

export const getTopupOrderColumns = ({
  t,
  completeTopup,
  expireTopup,
  deleteTopup,
}) => {
  return [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 70,
    },
    {
      title: t('用户名'),
      dataIndex: 'username',
      key: 'username',
      width: 120,
      render: (text) => <Text>{text || '-'}</Text>,
    },
    {
      title: t('订单号'),
      dataIndex: 'trade_no',
      key: 'trade_no',
      width: 200,
      render: (text) => (
        <Text copyable style={{ maxWidth: 180 }} ellipsis={{ showTooltip: true }}>
          {text}
        </Text>
      ),
    },
    {
      title: t('支付方式'),
      dataIndex: 'payment_method',
      key: 'payment_method',
      width: 100,
      render: (pm) => renderPaymentMethod(pm, t),
    },
    {
      title: t('充值额度'),
      dataIndex: 'amount',
      key: 'amount',
      width: 100,
    },
    {
      title: t('支付金额'),
      dataIndex: 'money',
      key: 'money',
      width: 100,
      render: (money, record) => (
        <Text>
          {money != null ? `${getCurrencySymbol(record.payment_method)}${Number(money).toFixed(2)}` : '-'}
        </Text>
      ),
    },
    {
      title: t('状态'),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => renderStatusBadge(status, t),
    },
    {
      title: t('客户端IP'),
      dataIndex: 'client_ip',
      key: 'client_ip',
      width: 130,
      render: (text) => <Text>{text || '-'}</Text>,
    },
    {
      title: t('创建时间'),
      dataIndex: 'create_time',
      key: 'create_time',
      width: 170,
      render: (time) => timestamp2string(time),
    },
    {
      title: t('完成时间'),
      dataIndex: 'complete_time',
      key: 'complete_time',
      width: 170,
      render: (time) => (time ? timestamp2string(time) : '-'),
    },
    {
      title: t('操作'),
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (_, record) => {
        if (record.status === 'pending') {
          return (
            <div className='flex gap-1'>
              <Button
                size='small'
                type='primary'
                onClick={() =>
                  confirmAction(
                    t('确认补单'),
                    t('确认为该订单执行补单操作？'),
                    () => completeTopup(record.trade_no),
                  )
                }
              >
                {t('补单')}
              </Button>
              <Dropdown
                trigger='click'
                position='bottomRight'
                menu={[
                  {
                    node: 'item',
                    name: t('标记过期'),
                    onClick: () =>
                      confirmAction(
                        t('确认标记过期'),
                        t('将该订单标记为已过期'),
                        () => expireTopup(record.trade_no),
                      ),
                  },
                  {
                    node: 'item',
                    name: t('删除'),
                    type: 'danger',
                    onClick: () =>
                      confirmAction(
                        t('确认删除'),
                        t('删除后不可恢复'),
                        () => deleteTopup(record.trade_no),
                      ),
                  },
                ]}
              >
                <Button size='small' type='tertiary'>
                  ...
                </Button>
              </Dropdown>
            </div>
          );
        }
        return (
          <Button
            size='small'
            type='danger'
            onClick={() =>
              confirmAction(
                t('确认删除'),
                t('删除后不可恢复'),
                () => deleteTopup(record.trade_no),
              )
            }
          >
            {t('删除')}
          </Button>
        );
      },
    },
  ];
};

export const getSubscriptionOrderColumns = ({
  t,
  completeSub,
  expireSub,
  deleteSub,
}) => {
  return [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 70,
    },
    {
      title: t('用户名'),
      dataIndex: 'username',
      key: 'username',
      width: 120,
      render: (text) => <Text>{text || '-'}</Text>,
    },
    {
      title: t('订单号'),
      dataIndex: 'trade_no',
      key: 'trade_no',
      width: 200,
      render: (text) => (
        <Text copyable style={{ maxWidth: 180 }} ellipsis={{ showTooltip: true }}>
          {text}
        </Text>
      ),
    },
    {
      title: t('套餐ID'),
      dataIndex: 'plan_id',
      key: 'plan_id',
      width: 80,
    },
    {
      title: t('支付方式'),
      dataIndex: 'payment_method',
      key: 'payment_method',
      width: 100,
      render: (pm) => renderPaymentMethod(pm, t),
    },
    {
      title: t('应付金额'),
      key: 'purchase_amount',
      width: 110,
      render: (_, record) => {
        if (record.purchase_amount != null && record.purchase_amount > 0) {
          const sym = record.purchase_currency === 'USD' ? '$' : '¥';
          return <Text>{`${sym}${Number(record.purchase_amount).toFixed(2)}`}</Text>;
        }
        return <Text>-</Text>;
      },
    },
    {
      title: t('实付金额'),
      dataIndex: 'money',
      key: 'money',
      width: 110,
      render: (money, record) => (
        <Text>
          {money != null ? `${getCurrencySymbol(record.payment_method)}${Number(money).toFixed(2)}` : '-'}
        </Text>
      ),
    },
    {
      title: t('状态'),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => renderStatusBadge(status, t),
    },
    {
      title: t('客户端IP'),
      dataIndex: 'client_ip',
      key: 'client_ip',
      width: 130,
      render: (text) => <Text>{text || '-'}</Text>,
    },
    {
      title: t('创建时间'),
      dataIndex: 'create_time',
      key: 'create_time',
      width: 170,
      render: (time) => timestamp2string(time),
    },
    {
      title: t('完成时间'),
      dataIndex: 'complete_time',
      key: 'complete_time',
      width: 170,
      render: (time) => (time ? timestamp2string(time) : '-'),
    },
    {
      title: t('操作'),
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (_, record) => {
        if (record.status === 'pending') {
          return (
            <div className='flex gap-1'>
              <Button
                size='small'
                type='primary'
                onClick={() =>
                  confirmAction(
                    t('确认补单'),
                    t('确认为该订单执行补单操作？'),
                    () => completeSub(record.trade_no),
                  )
                }
              >
                {t('补单')}
              </Button>
              <Dropdown
                trigger='click'
                position='bottomRight'
                menu={[
                  {
                    node: 'item',
                    name: t('标记过期'),
                    onClick: () =>
                      confirmAction(
                        t('确认标记过期'),
                        t('将该订单标记为已过期'),
                        () => expireSub(record.trade_no),
                      ),
                  },
                  {
                    node: 'item',
                    name: t('删除'),
                    type: 'danger',
                    onClick: () =>
                      confirmAction(
                        t('确认删除'),
                        t('删除后不可恢复'),
                        () => deleteSub(record.trade_no),
                      ),
                  },
                ]}
              >
                <Button size='small' type='tertiary'>
                  ...
                </Button>
              </Dropdown>
            </div>
          );
        }
        return (
          <Button
            size='small'
            type='danger'
            onClick={() =>
              confirmAction(
                t('确认删除'),
                t('删除后不可恢复'),
                () => deleteSub(record.trade_no),
              )
            }
          >
            {t('删除')}
          </Button>
        );
      },
    },
  ];
};
