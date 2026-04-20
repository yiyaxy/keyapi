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

import React, { useRef } from 'react';
import {
  Card,
  Button,
  Banner,
  Skeleton,
  Form,
  Input,
  Space,
  Spin,
} from '@douyinfe/semi-ui';
import { SiAlipay, SiWechat, SiStripe } from 'react-icons/si';
import {
  ArrowRight,
  CreditCard,
  Wallet,
} from 'lucide-react';
import { IconGift } from '@douyinfe/semi-icons';
import { useMinimumLoadingTime } from '../../hooks/common/useMinimumLoadingTime';

const RechargeCard = ({
  t,
  enableOnlineTopUp,
  enableStripeTopUp,
  enableCreemTopUp,
  enableWechatTopup,
  creemProducts,
  creemPreTopUp,
  presetAmounts,
  selectedPreset,
  selectPresetAmount,
  priceRatio,
  topUpCount,
  minTopUp,
  getMinTopUpByPayWay,
  estimateAmount,
  setTopUpCount,
  setSelectedPreset,
  renderAmount,
  amountLoading,
  payMethods,
  preTopUp,
  paymentLoading,
  payWay,
  redemptionCode,
  setRedemptionCode,
  topUp,
  isSubmitting,
  topUpLink,
  openTopUpLink,
  statusLoading,
  topupInfo,
  autoRefreshEnabled,
  setAutoRefreshEnabled,
}) => {
  const onlineFormApiRef = useRef(null);
  const showAmountSkeleton = useMinimumLoadingTime(amountLoading);

  return (
    <Card className='topup-card-surface shadow-sm border-0'>
      <div className='flex items-center gap-2.5 mb-4'>
        <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900'>
          <CreditCard size={16} />
        </div>
        <h2 className='text-base font-bold text-slate-900 dark:text-slate-100'>
          {t('余额充值')}
        </h2>
      </div>

      <Space vertical style={{ width: '100%' }} spacing={16}>
        {statusLoading ? (
          <div className='py-12 flex justify-center'>
            <Spin size='large' />
          </div>
        ) : enableOnlineTopUp || enableStripeTopUp || enableCreemTopUp || enableWechatTopup ? (
          <div className='space-y-4'>
            {(enableOnlineTopUp || enableStripeTopUp || enableWechatTopup) && (
              <div className='rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700 shadow-sm shadow-slate-200/60 dark:shadow-none overflow-hidden'>
                <div className='p-5 bg-gradient-to-br from-slate-50 via-white to-slate-100/80 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 border-b border-slate-100 dark:border-slate-800'>
                  <div className='flex items-start justify-between gap-4 mb-4'>
                    <div>
                      <div className='text-sm font-semibold text-slate-900 dark:text-slate-100'>
                        {t('在线充值')}
                      </div>
                      <div className='text-xs text-slate-500 dark:text-slate-400 mt-1'>
                        {t('选择金额并确认支付方式')}
                      </div>
                    </div>
                    <div className='rounded-xl border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/70 px-3 py-2 text-right shadow-sm dark:shadow-none min-w-[128px]'>
                      <div className='text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400 dark:text-slate-400'>
                        {t('预计支付')}
                      </div>
                      <Skeleton loading={showAmountSkeleton} active placeholder={<div className='w-20 h-7 bg-slate-200 dark:bg-slate-700 rounded-lg animate-pulse ml-auto mt-1' />}>
                        <div className='mt-1 text-lg font-bold text-slate-900 dark:text-slate-100'>{renderAmount()}</div>
                      </Skeleton>
                    </div>
                  </div>

                  <div className='rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-900/40 p-4'>
                    <div className='flex items-center justify-between gap-3 mb-3'>
                      <div>
                        <div className='text-xs font-semibold text-slate-700 dark:text-slate-200'>
                          {t('自定义充值数量')}
                        </div>
                        <div className='text-[11px] text-slate-500 dark:text-slate-400 mt-1'>
                          {t('输入自定义额度，系统会自动估算应付金额')}
                        </div>
                      </div>
                      <div className='hidden sm:flex h-10 w-10 items-center justify-center rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-none'>
                        <Wallet size={16} />
                      </div>
                    </div>
                    <Form
                      getFormApi={(api) => (onlineFormApiRef.current = api)}
                      initValues={{ topUpCount: topUpCount }}
                      layout='vertical'
                    >
                      <Form.InputNumber
                        field='topUpCount'
                        noLabel
                        placeholder={t('最低 ') + minTopUp}
                        value={topUpCount}
                        min={minTopUp}
                        step={1}
                        precision={0}
                        onChange={async (value) => {
                          if (value && value >= 1) {
                            const nextPayWay = payWay || payMethods[0]?.type || '';
                            setTopUpCount(value);
                            await estimateAmount(value, nextPayWay, {
                              updateSelectedPreset: true,
                            });
                          }
                        }}
                        className='!bg-white dark:!bg-slate-900 !rounded-xl'
                      />
                    </Form>
                  </div>
                </div>

                <div className='p-5 space-y-5'>
                  <div>
                    <div className='flex items-center justify-between gap-3 mb-3'>
                      <div className='text-xs font-semibold text-slate-600 dark:text-slate-200'>
                        {t('快捷额度')}
                      </div>
                      <div className='text-[11px] text-slate-400 dark:text-slate-400'>
                        {t('快速选择常用充值档位')}
                      </div>
                    </div>
                    <div className='grid grid-cols-2 sm:grid-cols-4 gap-3'>
                      {presetAmounts.map((preset, index) => {
                        const discount = preset.discount || topupInfo?.discount?.[preset.value] || 1.0;
                        const discountedPrice = preset.value * priceRatio * discount;
                        const isSelected = selectedPreset === preset.value;
                        const minimumByPayWay = getMinTopUpByPayWay(payWay || payMethods[0]?.type || '');
                        const disabled = preset.value < minimumByPayWay;

                        return (
                          <div
                            key={index}
                            onClick={() => {
                              if (disabled) {
                                return;
                              }
                              selectPresetAmount(preset);
                              onlineFormApiRef.current?.setValue('topUpCount', preset.value);
                            }}
                            className={`
                              group relative overflow-hidden rounded-2xl border p-3.5 transition-all duration-200
                              ${disabled
                                ? 'border-slate-100 bg-slate-50 dark:bg-slate-900/40 dark:border-slate-800 text-slate-300 dark:text-slate-600 cursor-not-allowed opacity-50'
                                : isSelected
                                  ? 'border-transparent bg-gradient-to-br from-slate-800 to-slate-900 text-white shadow-lg shadow-slate-900/20 cursor-pointer scale-[1.02]'
                                  : 'border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 hover:shadow-md hover:scale-[1.02] cursor-pointer'}
                            `}
                            style={{ transformOrigin: 'center' }}
                          >
                            <div className='flex items-start justify-between gap-2'>
                              <div>
                                <div className='text-base font-bold leading-none'>
                                  {preset.value}
                                </div>
                                <div className={`mt-2 text-[11px] font-medium ${isSelected ? 'text-slate-300' : 'text-slate-500 dark:text-slate-400'}`}>
                                  {t('充值额度')}
                                </div>
                              </div>
                              {!disabled && discount >= 1.0 && (
                                <div className={`rounded-full px-2 py-1 text-[10px] font-semibold ${isSelected ? 'bg-white/12 text-slate-200' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 group-hover:bg-slate-200/70 dark:group-hover:bg-slate-600'}`}>
                                  {t('即选即用')}
                                </div>
                              )}
                            </div>
                            {!disabled && discount < 1.0 && (
                              <div className='absolute right-3 top-3 flex flex-col items-end gap-1'>
                                <span
                                  className='inline-flex items-center rounded-full bg-gradient-to-r from-rose-500 via-orange-500 to-amber-400 px-2 py-0.5 text-[9px] font-bold text-white shadow-sm'
                                  style={{ animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}
                                >
                                  {Math.round((1 - discount) * 100)}% OFF
                                </span>
                                <span className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold ${isSelected ? 'bg-white/12 text-slate-200' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 group-hover:bg-slate-200/70 dark:group-hover:bg-slate-600'}`}>
                                  {t('即选即用')}
                                </span>
                              </div>
                            )}
                            <div className={`mt-4 text-sm font-semibold ${isSelected ? 'text-white' : 'text-slate-900 dark:text-slate-100'}`}>
                              ¥{discountedPrice.toFixed(2)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className='flex items-center justify-between gap-3 mb-3'>
                      <div className='text-xs font-semibold text-slate-600 dark:text-slate-200'>
                        {t('支付方式')}
                      </div>
                      <div className='text-[11px] text-slate-400 dark:text-slate-400'>
                        {t('选择你偏好的支付渠道')}
                      </div>
                    </div>
                    <div className='grid grid-cols-1 sm:grid-cols-3 gap-3'>
                      {payMethods.map((method) => {
                        const disabled =
                          (method.type === 'stripe' && !enableStripeTopUp) ||
                          (method.type === 'wechat' && !enableWechatTopup) ||
                          (!['stripe', 'wechat'].includes(method.type) && !enableOnlineTopUp);
                        const isActive = payWay === method.type;
                        const isLoading = paymentLoading && isActive;
                        const methodIcon =
                          method.type === 'alipay' ? <SiAlipay size={20} /> :
                          method.type === 'wxpay' ? <SiWechat size={20} /> :
                          method.type === 'stripe' ? <SiStripe size={20} /> :
                          <CreditCard size={20} />;
                        const methodDesc =
                          method.type === 'alipay' ? t('支付宝扫码') :
                          method.type === 'wxpay' ? t('微信扫码') :
                          method.type === 'stripe' ? t('国际信用卡') :
                          t('在线支付');

                        return (
                          <div
                            key={method.type}
                            onClick={() => {
                              if (!disabled && !isLoading) preTopUp(method.type);
                            }}
                            className={`
                              relative rounded-2xl border p-3.5 transition-all duration-200 select-none
                              ${disabled
                                ? 'border-slate-100 bg-slate-50 dark:bg-slate-900/40 dark:border-slate-800 text-slate-300 dark:text-slate-600 cursor-not-allowed opacity-50'
                                : isActive
                                  ? 'border-transparent bg-gradient-to-br from-slate-800 to-slate-900 text-white shadow-lg shadow-slate-900/20 cursor-pointer'
                                  : 'border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 hover:shadow-md cursor-pointer'}
                            `}
                          >
                            {isLoading && (
                              <div className='absolute inset-0 flex items-center justify-center rounded-2xl bg-slate-900/80'>
                                <Spin size='small' />
                              </div>
                            )}
                            <div className='flex items-start gap-3'>
                              <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border ${isActive ? 'border-white/10 bg-white/10 text-white' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 text-slate-600 dark:text-slate-200'}`}>
                                {methodIcon}
                              </div>
                              <div className='min-w-0 flex-1'>
                                <div className='flex items-center justify-between gap-2'>
                                  <div className='text-sm font-bold truncate'>{method.name}</div>
                                  {isActive && (
                                    <div className='rounded-full bg-white/12 px-2 py-0.5 text-[10px] font-semibold text-slate-200'>
                                      {t('已选择')}
                                    </div>
                                  )}
                                </div>
                                <div className={`mt-1 text-[11px] leading-5 ${isActive ? 'text-slate-300' : 'text-slate-500 dark:text-slate-400'}`}>
                                  {methodDesc}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {enableCreemTopUp && creemProducts.length > 0 && (
              <div className='rounded-2xl border border-slate-100 bg-slate-50/70 dark:bg-slate-900/40 dark:border-slate-800 p-4'>
                <div className='text-xs font-semibold text-slate-600 dark:text-slate-200 mb-3'>
                  {t('国际支付 (Creem)')}
                </div>
                <div className='grid grid-cols-2 gap-2.5'>
                  {creemProducts.map((product, index) => (
                    <div
                      key={index}
                      onClick={() => creemPreTopUp(product)}
                      className='rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 hover:border-slate-400 dark:hover:border-slate-500 hover:shadow-md hover:scale-[1.01] cursor-pointer transition-all duration-200'
                    >
                      <div className='flex items-center justify-between gap-2 mb-1'>
                        <span className='text-sm font-bold text-slate-900 dark:text-slate-100 truncate'>{product.name}</span>
                        <span className='text-xs font-semibold text-slate-500 flex-shrink-0'>
                          {product.currency === 'EUR' ? '€' : product.currency === 'USD' ? '$' : '¥'}{product.price}
                        </span>
                      </div>
                      <div className='text-[11px] text-slate-400 dark:text-slate-400'>
                        {t('额度')}: {product.quota}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <Banner
            type='info'
            description={t('管理员未开启在线充值，请使用兑换码。')}
            className='!rounded-2xl'
            closeIcon={null}
          />
        )}

        {/* Redemption Code Section */}
        <div className='rounded-2xl border border-slate-100 bg-white dark:bg-slate-900 dark:border-slate-800 p-4'>
          <div className='text-xs font-semibold text-slate-600 dark:text-slate-200 mb-2'>
            {t('使用兑换码')}
          </div>
          <div className='flex gap-2'>
            <Input
              placeholder={t('输入 12 位兑换码')}
              value={redemptionCode}
              onChange={(v) => setRedemptionCode(v)}
              className='flex-1 !rounded-lg !bg-slate-50 dark:!bg-slate-800'
              prefix={<IconGift />}
            />
            <Button
              theme='solid'
              className='!bg-slate-900 dark:!bg-white hover:!bg-slate-800 dark:hover:!bg-slate-200 !text-white dark:!text-slate-900 !rounded-lg !px-5'
              onClick={topUp}
              loading={isSubmitting}
            >
              {t('兑换')}
            </Button>
          </div>
          {topUpLink && (
            <div className='mt-2 flex items-center justify-center'>
              <Button
                theme='borderless'
                size='small'
                onClick={openTopUpLink}
                className='!text-slate-500 dark:!text-slate-300 hover:!text-slate-900 dark:hover:!text-slate-100 !text-xs'
              >
                {t('没有兑换码？前往购买')} <ArrowRight size={10} className='ml-1' />
              </Button>
            </div>
          )}
        </div>

        {/* Auto Refresh Toggle */}
        <div className='flex items-center justify-between rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 px-3 py-2'>
          <span className='text-[11px] text-slate-500 dark:text-slate-400'>{t('自动刷新余额与订阅状态')}</span>
          <Button
            size='small'
            theme={autoRefreshEnabled ? 'solid' : 'light'}
            type={autoRefreshEnabled ? 'primary' : 'tertiary'}
            className={autoRefreshEnabled ? '!bg-slate-900 dark:!bg-white dark:!text-slate-900 !rounded-lg !h-6 !text-[11px]' : '!rounded-lg !h-6 !text-[11px]'}
            onClick={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
          >
            {autoRefreshEnabled ? t('已开启') : t('已关闭')}
          </Button>
        </div>
      </Space>
    </Card>
  );
};

export default RechargeCard;
