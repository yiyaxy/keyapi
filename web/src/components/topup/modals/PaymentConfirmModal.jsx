/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React from 'react';
import { Modal, Typography, Card, Skeleton } from '@douyinfe/semi-ui';
import { SiAlipay, SiWechat, SiStripe } from 'react-icons/si';
import { CreditCard, CheckCircle2 } from 'lucide-react';

const { Text } = Typography;

const PaymentConfirmModal = ({
  t,
  open,
  onlineTopUp,
  handleCancel,
  confirmLoading,
  topUpCount,
  renderQuotaWithAmount,
  amountLoading,
  renderAmount,
  payWay,
  payMethods,
  amountNumber,
}) => {
  const originalAmount = Number(topUpCount) > 0 ? Number(amountNumber) / Number(topUpCount) : 0;
  const discountAmount = originalAmount > amountNumber ? originalAmount - amountNumber : 0;
  const hasDiscount = discountAmount > 0.000001;
  const discountRate = hasDiscount && originalAmount > 0 ? amountNumber / originalAmount : 1;

  return (
    <Modal
      title={
        <div className='flex items-center gap-2'>
          <div className='bg-slate-900 p-1.5 rounded-lg text-white'>
            <CheckCircle2 size={18} />
          </div>
          <span className='font-bold text-slate-900'>{t('充值确认')}</span>
        </div>
      }
      visible={open}
      onOk={onlineTopUp}
      onCancel={handleCancel}
      maskClosable={false}
      size='small'
      centered
      confirmLoading={confirmLoading}
      okButtonProps={{ className: '!rounded-lg !bg-slate-900 !h-9 !px-6' }}
      cancelButtonProps={{ className: '!rounded-lg !h-9' }}
    >
      <div className='space-y-3 py-1'>
        <div className='p-4 rounded-xl bg-slate-50 border border-slate-100'>
          <div className='space-y-3'>
            <div className='flex justify-between items-center'>
              <span className='text-sm text-slate-500 font-medium'>
                {t('充值数量')}
              </span>
              <span className='text-sm font-bold text-slate-900 bg-white px-3 py-1 rounded-lg border border-slate-200'>
                {renderQuotaWithAmount(topUpCount)}
              </span>
            </div>

            <div className='flex justify-between items-center'>
              <span className='text-sm text-slate-500 font-medium'>
                {t('实付金额')}
              </span>
              {amountLoading ? (
                <Skeleton.Title style={{ width: '60px', height: '16px' }} />
              ) : (
                <div className='flex items-center gap-2'>
                  {hasDiscount && (
                    <span className='text-[10px] font-black uppercase bg-rose-500 text-white px-1.5 py-0.5 rounded'>
                      -{Math.round((1 - discountRate) * 100)}%
                    </span>
                  )}
                  <span className='text-xl font-black text-slate-900'>
                    {renderAmount()}
                  </span>
                </div>
              )}
            </div>

            {(hasDiscount || !amountLoading) && hasDiscount && (
              <div className='pt-3 border-t border-slate-200/60 space-y-2'>
                <div className='flex justify-between items-center'>
                  <span className='text-[11px] text-slate-400'>
                    {t('原价')}
                  </span>
                  <span className='text-[11px] text-slate-400 line-through'>
                    {`${originalAmount.toFixed(2)} ${t('元')}`}
                  </span>
                </div>
                <div className='flex justify-between items-center'>
                  <span className='text-[11px] text-slate-400'>
                    {t('立减')}
                  </span>
                  <span className='text-[11px] text-emerald-600 font-bold'>
                    {`- ${discountAmount.toFixed(2)} ${t('元')}`}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className='flex items-center justify-between px-2'>
           <span className='text-xs text-slate-400 font-medium'>{t('支付方式')}</span>
           <div className='flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-xl shadow-sm'>
              {(() => {
                const payMethod = payMethods.find(m => m.type === payWay);
                const Icon = payWay === 'alipay' ? SiAlipay : (payWay === 'wxpay' ? SiWechat : (payWay === 'stripe' ? SiStripe : CreditCard));
                const color = payWay === 'alipay' ? '#1677FF' : (payWay === 'wxpay' ? '#07C160' : (payWay === 'stripe' ? '#635BFF' : '#64748b'));
                return (
                  <>
                    <Icon size={16} color={color} />
                    <span className='text-xs font-bold text-slate-700'>{payMethod?.name || t(payWay)}</span>
                  </>
                );
              })()}
           </div>
        </div>
      </div>
    </Modal>
  );
};

export default PaymentConfirmModal;
