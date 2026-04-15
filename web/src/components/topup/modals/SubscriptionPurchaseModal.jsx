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

import React, { useState, useEffect } from 'react';
import {
  Banner,
  Modal,
  Typography,
  Button,
  Select,
  Divider,
  Tooltip,
  Checkbox,
} from '@douyinfe/semi-ui';
import { Crown, CalendarClock, Package, ShieldCheck } from 'lucide-react';
import { SiStripe } from 'react-icons/si';
import { IconCreditCard } from '@douyinfe/semi-icons';
import { renderQuota } from '../../../helpers';

import {
  formatSubscriptionDuration,
  formatSubscriptionResetPeriod,
  formatQuotaLabel,
} from '../../../helpers/subscriptionFormat';

const { Text } = Typography;

const normalizePlanStatus = (plan) => {
  if (plan?.status) return plan.status;
  return plan?.enabled === false ? 'disabled' : 'active';
};

const SubscriptionPurchaseModal = ({
  t,
  visible,
  onCancel,
  selectedPlan,
  paying,
  selectedEpayMethod,
  setSelectedEpayMethod,
  epayMethods = [],
  enableOnlineTopUp = false,
  enableStripeTopUp = false,
  enableCreemTopUp = false,
  purchaseLimitInfo = null,
  refundPolicyEnabled = false,
  refundPolicyText = '',
  onPayStripe,
  onPayCreem,
  onPayEpay,
}) => {
  const [refundPolicyAgreed, setRefundPolicyAgreed] = useState(false);

  useEffect(() => {
    if (!visible) setRefundPolicyAgreed(false);
  }, [visible]);

  const plan = selectedPlan?.plan;
  const totalAmount = Number(plan?.total_amount || 0);
  const price = plan ? Number(plan.price_amount || 0) : 0;
  const displayPrice = price.toFixed(Number.isInteger(price) ? 0 : 2);
  
  const hasStripe = enableStripeTopUp && !!plan?.stripe_price_id;
  const hasCreem = enableCreemTopUp && !!plan?.creem_product_id;
  const hasEpay = enableOnlineTopUp && epayMethods.length > 0;
  const hasAnyPayment = hasStripe || hasCreem || hasEpay;
  
  const purchaseLimit = Number(purchaseLimitInfo?.limit || 0);
  const purchaseCount = Number(purchaseLimitInfo?.count || 0);
  const purchaseLimitReached = purchaseLimit > 0 && purchaseCount >= purchaseLimit;
  const planStatus = normalizePlanStatus(plan);
  const statusBlocked = planStatus === 'sold_out' || planStatus === 'disabled';
  const policyBlocked = refundPolicyEnabled && !refundPolicyAgreed;
  const paymentDisabled = purchaseLimitReached || statusBlocked || policyBlocked;

  return (
    <Modal
      title={
        <div className='flex items-center gap-2'>
          <div className='bg-slate-900 p-1.5 rounded-lg text-white'>
            <Crown size={18} />
          </div>
          <span className='font-bold text-slate-900'>{t('购买订阅套餐')}</span>
        </div>
      }
      visible={visible}
      onCancel={onCancel}
      footer={null}
      size='small'
      centered
      className='!rounded-3xl'
    >
      {plan ? (
        <div className='space-y-4 pb-4 pt-1'>
          {/* Plan Info Card */}
          <div className='p-4 rounded-xl bg-slate-50 border border-slate-100'>
            <div className='space-y-3'>
              <div className='flex justify-between items-center'>
                <span className='text-sm text-slate-500 font-medium'>{t('套餐名称')}</span>
                <span className='text-sm font-bold text-slate-900 truncate max-w-[180px]'>{plan.title}</span>
              </div>
              
              <div className='flex justify-between items-center'>
                <span className='text-sm text-slate-500 font-medium'>{t('有效期')}</span>
                <div className='flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded-lg shadow-sm'>
                  <CalendarClock size={14} className='text-slate-400' />
                  <span className='text-xs font-bold text-slate-700'>{formatSubscriptionDuration(plan, t)}</span>
                </div>
              </div>

              <div className='flex justify-between items-center'>
                <span className='text-sm text-slate-500 font-medium'>{formatQuotaLabel(plan, t)}</span>
                <div className='flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded-lg shadow-sm'>
                  <Package size={14} className='text-slate-400' />
                  <span className='text-xs font-bold text-slate-700'>
                    {totalAmount > 0 ? renderQuota(totalAmount) : t('不限')}
                  </span>
                </div>
              </div>

              <div className='pt-4 border-t border-slate-200/60 flex justify-between items-center'>
                <span className='text-sm text-slate-900 font-bold'>{t('应付总额')}</span>
                <div className='flex items-baseline gap-1'>
                  <span className='text-xs font-bold text-slate-900'>¥</span>
                  <span className='text-2xl font-black text-slate-900'>{displayPrice}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Limits & Payment */}
          {planStatus === 'sold_out' && (
            <div className='flex items-center gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl text-amber-700 text-xs font-medium'>
              <ShieldCheck size={14} />
              <span>{t('当前套餐已售罄，暂不可购买')}</span>
            </div>
          )}

          {planStatus === 'disabled' && (
            <div className='flex items-center gap-2 p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 text-xs font-medium'>
              <ShieldCheck size={14} />
              <span>{t('当前套餐已禁用，暂不可购买')}</span>
            </div>
          )}

          {purchaseLimitReached && (
            <div className='flex items-center gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl text-amber-700 text-xs font-medium'>
               <ShieldCheck size={14} />
               <span>{t('已达到购买上限')} ({purchaseCount}/{purchaseLimit})</span>
            </div>
          )}

          {hasAnyPayment ? (
            <div className='space-y-3'>
              {refundPolicyEnabled && (
                <div className='p-3 bg-amber-50/50 border border-amber-100 rounded-xl space-y-2'>
                  <div className='text-xs text-slate-600 max-h-24 overflow-y-auto whitespace-pre-wrap'>
                    {refundPolicyText || t('退款政策内容加载中...')}
                  </div>
                  <Checkbox
                    checked={refundPolicyAgreed}
                    onChange={(e) => setRefundPolicyAgreed(e.target.checked)}
                  >
                    <span className='text-xs font-medium text-slate-700'>
                      {t('我已阅读并同意退款政策')}
                    </span>
                  </Checkbox>
                </div>
              )}

              <div className='text-xs font-bold text-slate-400 uppercase tracking-wider ml-1'>
                {t('支付网关')}
              </div>

              <div className='grid grid-cols-1 gap-2'>
                {hasStripe && (
                  <Button
                    theme='solid'
                    className='!h-10 !rounded-xl !bg-slate-900 hover:!bg-slate-800 !border-0 !font-bold flex items-center justify-center gap-2'
                    onClick={onPayStripe}
                    loading={paying}
                    disabled={paymentDisabled}
                  >
                    <SiStripe size={20} />
                    <span>Pay with Stripe</span>
                  </Button>
                )}
                
                {hasCreem && (
                  <Button
                    theme='light'
                    className='!h-10 !rounded-xl !border-slate-200 hover:!border-slate-300 !font-bold flex items-center justify-center gap-2'
                    onClick={onPayCreem}
                    loading={paying}
                    disabled={paymentDisabled}
                  >
                    <IconCreditCard size='large' />
                    <span>Pay with Creem</span>
                  </Button>
                )}

                {hasEpay && (
                  <div className='flex gap-2'>
                    <Select
                      value={selectedEpayMethod}
                      onChange={setSelectedEpayMethod}
                      className='flex-1 !h-10 !rounded-xl'
                      placeholder={t('选择支付渠道')}
                      optionList={epayMethods.map(m => ({
                        value: m.type,
                        label: m.name || m.type,
                      }))}
                      disabled={paymentDisabled}
                    />
                    <Button
                      theme='solid'
                      className='!h-10 !px-8 !rounded-xl !bg-slate-900 hover:!bg-slate-800 !font-bold'
                      onClick={onPayEpay}
                      loading={paying}
                      disabled={!selectedEpayMethod || paymentDisabled}
                    >
                      {t('结算')}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className='p-6 text-center border-2 border-dashed border-slate-100 rounded-2xl'>
               <p className='text-sm text-slate-400 font-medium'>{t('暂无可用支付方式')}</p>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
};

export default SubscriptionPurchaseModal;
