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

import React, { useMemo, useState } from 'react';
import {
  Badge,
  Banner,
  Button,
  Card,
  Select,
  Tag,
} from '@douyinfe/semi-ui';
import { API, showError, showSuccess, renderQuota } from '../../helpers';

import {
  Crown,
  RefreshCw,
} from 'lucide-react';
import SubscriptionPurchaseModal from './modals/SubscriptionPurchaseModal';
import {
  formatSubscriptionDuration,
  formatSubscriptionResetPeriod,
  formatQuotaLabel,
} from '../../helpers/subscriptionFormat';

const WEEK_SECONDS = 7 * 86400;

function getPlanFamily(plan) {
  const unit = plan?.duration_unit;
  const value = Number(plan?.duration_value || 0);
  const customSeconds = Number(plan?.custom_seconds || 0);

  if (unit === 'month') return 'monthly';
  if (
    (unit === 'day' && value === 7) ||
    customSeconds === WEEK_SECONDS
  ) {
    return 'weekly';
  }
  return 'other';
}

function getEpayMethods(payMethods = []) {
  return (payMethods || []).filter(
    (m) => m?.type && m.type !== 'stripe' && m.type !== 'creem',
  );
}

function submitEpayForm({ url, params }) {
  const form = document.createElement('form');
  form.action = url;
  form.method = 'POST';
  const isSafari =
    navigator.userAgent.indexOf('Safari') > -1 &&
    navigator.userAgent.indexOf('Chrome') < 1;
  if (!isSafari) form.target = '_blank';
  Object.keys(params || {}).forEach((key) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = params[key];
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

const billingOptions = (t) => [
  { value: 'subscription_first', label: t('优先订阅') },
  { value: 'wallet_first', label: t('优先钱包') },
  { value: 'subscription_only', label: t('仅用订阅') },
  { value: 'wallet_only', label: t('仅用钱包') },
];

const normalizePlanStatus = (plan) => {
  if (plan?.status) return plan.status;
  return plan?.enabled === false ? 'disabled' : 'active';
};

const getPlanPurchaseState = ({ plan, count }) => {
  const status = normalizePlanStatus(plan);
  const limit = Number(plan?.max_purchase_per_user || 0);
  const reached = limit > 0 && count >= limit;

  if (status === 'sold_out') {
    return {
      disabled: true,
      label: '已售罄',
    };
  }

  if (status === 'disabled') {
    return {
      disabled: true,
      label: '已禁用',
    };
  }

  if (reached) {
    return {
      disabled: true,
      label: '已达限购',
    };
  }

  return {
    disabled: false,
    label: '立即开启',
  };
};

const SubscriptionPlansCard = ({
  t,
  plans = [],
  payMethods = [],
  enableOnlineTopUp,
  enableStripeTopUp,
  enableCreemTopUp,
  billingPreference,
  onChangeBillingPreference,
  activeSubscriptions = [],
  allSubscriptions = [],
  reloadSubscriptionSelf,
  subscriptionNotice = '',
  refundPolicyEnabled = false,
  refundPolicyText = '',
}) => {
  const [open, setOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [paying, setPaying] = useState(false);
  const [selectedEpayMethod, setSelectedEpayMethod] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [planFamilyView, setPlanFamilyView] = useState('monthly');
  const [showExpiredHistory, setShowExpiredHistory] = useState(false);
  const [activatingId, setActivatingId] = useState(null);

  const epayMethods = useMemo(() => getEpayMethods(payMethods), [payMethods]);

  const recommendCount = useMemo(() => {
    try {
      const status = JSON.parse(localStorage.getItem('status') || '{}');
      return Number(status?.subscription_recommend_count) || 0;
    } catch {
      return 0;
    }
  }, []);

  const openBuy = (p) => {
    setSelectedPlan(p);
    setSelectedEpayMethod(epayMethods?.[0]?.type || '');
    setOpen(true);
  };

  const closeBuy = () => {
    setOpen(false);
    setSelectedPlan(null);
    setPaying(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await reloadSubscriptionSelf?.();
    } finally {
      setRefreshing(false);
    }
  };

  const payStripe = async () => {
    if (!selectedPlan?.plan?.stripe_price_id) {
      showError(t('该套餐未配置 Stripe'));
      return;
    }
    setPaying(true);
    try {
      const res = await API.post('/api/subscription/stripe/pay', {
        plan_id: selectedPlan.plan.id,
      });
      if (res.data?.message === 'success') {
        window.open(res.data.data?.pay_link, '_blank');
        showSuccess(t('已打开支付页面'));
        closeBuy();
      } else {
        const errorMsg =
          typeof res.data?.data === 'string'
            ? res.data.data
            : res.data?.message || t('支付失败');
        showError(errorMsg);
      }
    } catch (e) {
      showError(t('支付请求失败'));
    } finally {
      setPaying(false);
    }
  };

  const payCreem = async () => {
    if (!selectedPlan?.plan?.creem_product_id) {
      showError(t('该套餐未配置 Creem'));
      return;
    }
    setPaying(true);
    try {
      const res = await API.post('/api/subscription/creem/pay', {
        plan_id: selectedPlan.plan.id,
      });
      if (res.data?.message === 'success') {
        window.open(res.data.data?.checkout_url, '_blank');
        showSuccess(t('已打开支付页面'));
        closeBuy();
      } else {
        const errorMsg =
          typeof res.data?.data === 'string'
            ? res.data.data
            : res.data?.message || t('支付失败');
        showError(errorMsg);
      }
    } catch (e) {
      showError(t('支付请求失败'));
    } finally {
      setPaying(false);
    }
  };

  const payEpay = async () => {
    if (!selectedEpayMethod) {
      showError(t('请选择支付方式'));
      return;
    }
    setPaying(true);
    try {
      const res = await API.post('/api/subscription/epay/pay', {
        plan_id: selectedPlan.plan.id,
        payment_method: selectedEpayMethod,
      });
      if (res.data?.message === 'success') {
        submitEpayForm({ url: res.data.url, params: res.data.data });
        showSuccess(t('已发起支付'));
        closeBuy();
      } else {
        const errorMsg =
          typeof res.data?.data === 'string'
            ? res.data.data
            : res.data?.message || t('支付失败');
        showError(errorMsg);
      }
    } catch (e) {
      showError(t('支付请求失败'));
    } finally {
      setPaying(false);
    }
  };

  const hasActiveSubscription = activeSubscriptions.length > 0;

  const planPurchaseCountMap = useMemo(() => {
    const map = new Map();
    (allSubscriptions || []).forEach((sub) => {
      const planId = sub?.subscription?.plan_id;
      if (!planId) return;
      map.set(planId, (map.get(planId) || 0) + 1);
    });
    return map;
  }, [allSubscriptions]);

  const planTitleMap = useMemo(() => {
    const map = new Map();
    (plans || []).forEach((p) => {
      const plan = p?.plan;
      if (!plan?.id) return;
      map.set(plan.id, plan.title || '');
    });
    return map;
  }, [plans]);

  const planMap = useMemo(() => {
    const map = new Map();
    (plans || []).forEach((p) => {
      const plan = p?.plan;
      if (!plan?.id) return;
      map.set(plan.id, plan);
    });
    return map;
  }, [plans]);

  const getPlanPurchaseCount = (planId) =>
    planPurchaseCountMap.get(planId) || 0;

  const getRemainingDays = (sub) => {
    if (!sub?.subscription?.end_time) return 0;
    const now = Date.now() / 1000;
    const remaining = sub.subscription.end_time - now;
    return Math.max(0, Math.ceil(remaining / 86400));
  };

  const getUsagePercent = (sub) => {
    const total = Number(sub?.subscription?.amount_total || 0);
    const used = Number(sub?.subscription?.amount_used || 0);
    if (total <= 0) return 0;
    return Math.round((used / total) * 100);
  };

  const activeCount = activeSubscriptions.length;

  const activateSubscription = async (subId) => {
    setActivatingId(subId);
    try {
      const res = await API.post(`/api/subscription/activate/${subId}`);
      if (res.data?.success) {
        showSuccess(t('订阅已激活'));
        await reloadSubscriptionSelf?.();
      } else {
        showError(res.data?.message || t('激活失败'));
      }
    } catch (e) {
      showError(t('激活失败'));
    } finally {
      setActivatingId(null);
    }
  };

  const subscriptionSections = useMemo(() => {
    const now = Date.now() / 1000;
    const inactive = [];
    const active = [];
    const expired = [];

    (allSubscriptions || []).forEach((sub) => {
      const subscription = sub?.subscription;
      if (subscription?.status === 'inactive') {
        inactive.push(sub);
      } else {
        const isExpired = (subscription?.end_time || 0) < now;
        const isActive = subscription?.status === 'active' && !isExpired;
        if (isActive) {
          active.push(sub);
        } else {
          expired.push(sub);
        }
      }
    });

    return { inactive, active, expired };
  }, [allSubscriptions]);

  const familyOptions = useMemo(
    () => [
      { value: 'weekly', label: t('周卡') },
      { value: 'monthly', label: t('月卡') },
      { value: 'other', label: t('其他周期') },
    ],
    [t],
  );

  const filteredPlans = useMemo(
    () => plans.filter((p) => getPlanFamily(p?.plan) === planFamilyView),
    [planFamilyView, plans],
  );

  const emptyFamilyLabel =
    familyOptions.find((item) => item.value === planFamilyView)?.label ||
    t('当前分类');

  return (
    <Card className='topup-card-surface border-0'>
      <div className='space-y-5'>
        {/* Hero */}
        <div className='topup-subscription-hero px-4 py-3'>
          <div className='flex items-center justify-between gap-3'>
            <div className='flex items-center gap-3'>
              <div className='bg-white/10 p-2 rounded-lg backdrop-blur-md'>
                 <Crown size={18} className='text-white' />
              </div>
              <h2 className='text-base font-bold text-white'>{t('套餐订阅')}</h2>
            </div>
            <div className='flex items-center gap-2'>
              <span className='text-xs text-white/80 font-semibold hidden sm:inline'>{t('扣费偏好')}</span>
              <Select
                value={billingPreference}
                onChange={onChangeBillingPreference}
                size='small'
                optionList={billingOptions(t)}
                className='w-[140px] !bg-white/15 !border-white/25 !text-white !rounded-lg'
              />
            </div>
          </div>
        </div>

        {/* Current Subscriptions */}
        <div className='space-y-2'>
           <div className='flex items-center justify-between px-1'>
              <div className='flex items-center gap-2'>
                 <span className='text-xs font-bold text-slate-800 dark:text-slate-100'>{t('我的当前订阅')}</span>
                 <Badge count={activeCount} theme='light' />
              </div>
              <Button
                  size='small'
                  theme='light'
                  type='tertiary'
                  icon={<RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />}
                  onClick={handleRefresh}
                  loading={refreshing}
                  className='!rounded-lg !text-xs !h-7'
                >
                  {t('同步状态')}
              </Button>
           </div>

           {subscriptionSections.active.length > 0 ? (
             <div className='grid grid-cols-1 gap-4'>
                {subscriptionSections.active.map((sub, idx) => {
                   const subscription = sub.subscription;
                   const plan = planMap.get(subscription?.plan_id);
                   const usage = getUsagePercent(sub);
                   const quotaLabel = formatQuotaLabel(plan, t);

                   return (
                     <div key={`active-${subscription?.id || idx}`} className='p-3 rounded-xl border transition-all bg-white dark:bg-slate-900 dark:border-slate-800 border-slate-100'>
                        <div className='flex justify-between items-center mb-2'>
                           <div className='flex items-center gap-2 min-w-0'>
                              <span className='text-sm font-bold text-slate-900 dark:text-slate-100 truncate'>{plan?.title || t('订阅')}</span>
                              <Tag color='green' size='small' shape='circle' className='!text-[10px] flex-shrink-0'>{t('生效中')}</Tag>
                              <span className='text-[10px] text-slate-400 flex-shrink-0'>{t('有效期至')} {new Date(subscription.end_time * 1000).toLocaleDateString()}</span>
                           </div>
                           <div className='text-right flex-shrink-0 ml-2'>
                              <span className='text-xs font-bold text-slate-900 dark:text-slate-100'>{usage}%</span>
                           </div>
                        </div>

                        <div className='space-y-1'>
                           <div className='h-1 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden'>
                              <div className={`h-full rounded-full ${usage > 90 ? 'bg-rose-500' : 'bg-slate-900 dark:bg-white'}`} style={{ width: `${usage}%` }} />
                           </div>
                           <div className='flex justify-between text-[10px] text-slate-400'>
                              <span>{quotaLabel}: {renderQuota(subscription.amount_total - subscription.amount_used)} {t('剩余')}</span>
                              <span>{renderQuota(subscription.amount_total)} {t('总量')}</span>
                           </div>
                        </div>
                     </div>
                   );
                })}
             </div>
           ) : (
             <div className='py-5 text-center bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-700'>
                <p className='text-xs text-slate-400 dark:text-slate-400'>{t('暂无活跃订阅')}</p>
             </div>
           )}

           {/* Inactive (pending activation) subscriptions */}
           {subscriptionSections.inactive.length > 0 && (
             <div className='space-y-2 mt-3'>
               <span className='text-xs font-bold text-amber-700 dark:text-amber-400 px-1'>
                 {t('待激活订阅')}
               </span>
               <div className='grid grid-cols-1 gap-3'>
                 {subscriptionSections.inactive.map((sub, idx) => {
                   const subscription = sub.subscription;
                   const plan = planMap.get(subscription?.plan_id);
                   return (
                     <div
                       key={`inactive-${subscription?.id || idx}`}
                       className='p-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/20'
                     >
                       <div className='flex justify-between items-center mb-1'>
                         <div className='flex items-center gap-2 min-w-0'>
                           <span className='text-sm font-bold text-slate-900 dark:text-slate-100 truncate'>
                             {plan?.title || t('订阅')}
                           </span>
                           <Tag color='amber' size='small' shape='circle' className='!text-[10px] flex-shrink-0'>
                             {t('待激活')}
                           </Tag>
                         </div>
                         <Button
                           size='small'
                           theme='solid'
                           className='!rounded-lg !bg-amber-500 hover:!bg-amber-600 !border-0 !font-bold !text-xs'
                           onClick={() => activateSubscription(subscription.id)}
                           loading={activatingId === subscription.id}
                         >
                           {t('激活')}
                         </Button>
                       </div>
                       <div className='text-[10px] text-slate-500 dark:text-slate-400'>
                         {t('购买于')} {new Date(subscription.created_at * 1000).toLocaleDateString()}
                         {' · '}
                         {t('激活后开始计时')}
                       </div>
                     </div>
                   );
                 })}
               </div>
             </div>
           )}

           {subscriptionSections.expired.length > 0 && (
             <div className='space-y-3'>
               <button
                 type='button'
                 className='topup-expired-toggle'
                 onClick={() => setShowExpiredHistory((prev) => !prev)}
               >
                 <div>
                   <span className='text-xs font-semibold text-slate-800 dark:text-slate-100'>{t('历史订阅记录')}</span>
                   <span className='ml-2 text-[11px] text-slate-500 dark:text-slate-400'>
                     {subscriptionSections.expired.length} {t('个已结束订阅')}
                   </span>
                 </div>
                 <div className='text-xs font-semibold text-slate-500 dark:text-slate-300'>
                   {showExpiredHistory ? t('收起') : t('展开')}
                 </div>
               </button>

               {showExpiredHistory && (
                 <div className='topup-expired-history grid grid-cols-1 gap-3'>
                   {subscriptionSections.expired.map((sub, idx) => {
                     const subscription = sub.subscription;
                     const plan = planMap.get(subscription?.plan_id);
                     const usage = getUsagePercent(sub);
                     const quotaLabel = formatQuotaLabel(plan, t);

                     return (
                       <div key={`expired-${subscription?.id || idx}`} className='p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/50 opacity-75'>
                         <div className='flex justify-between items-center mb-2'>
                           <div className='flex items-center gap-2 min-w-0'>
                             <span className='text-sm font-bold text-slate-900 dark:text-slate-100 truncate'>{plan?.title || t('订阅')}</span>
                             <Tag color='grey' size='small' shape='circle' className='!text-[10px] flex-shrink-0'>{t('已过期')}</Tag>
                             <span className='text-[10px] text-slate-400 flex-shrink-0'>
                               {subscription?.end_time
                                 ? `${t('结束于')} ${new Date(subscription.end_time * 1000).toLocaleDateString()}`
                                 : t('已结束')}
                             </span>
                           </div>
                           <div className='text-right flex-shrink-0 ml-2'>
                             <span className='text-xs font-bold text-slate-700 dark:text-slate-200'>{usage}%</span>
                           </div>
                         </div>

                         <div className='space-y-1'>
                           <div className='h-1 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden'>
                             <div className='h-full rounded-full bg-slate-400' style={{ width: `${usage}%` }} />
                           </div>
                           <div className='flex justify-between text-[10px] text-slate-400'>
                             <span>{quotaLabel}: {renderQuota(subscription.amount_total - subscription.amount_used)} {t('剩余')}</span>
                             <span>{renderQuota(subscription.amount_total)} {t('总量')}</span>
                           </div>
                         </div>
                       </div>
                     );
                   })}
                 </div>
               )}
             </div>
           )}
        </div>

        {/* Available Plans Grid */}
        <div className='space-y-3 pt-2'>
           <div className='text-sm font-bold text-slate-800 dark:text-slate-100 px-1'>{t('选择订阅方案')}</div>
           {subscriptionNotice ? (
             <div className='px-1'>
               <Banner
                 type='info'
                 bordered
                 closeIcon={null}
                 className='!rounded-xl'
                 description={subscriptionNotice}
               />
             </div>
           ) : null}
           <div className='flex flex-col gap-4 md:flex-row md:items-center md:justify-between px-1'>
             <div className='topup-family-tabs'>
               {familyOptions.map((option) => (
                 <button
                   key={option.value}
                   type='button'
                   className={`topup-family-tab ${planFamilyView === option.value ? 'topup-family-tab-active' : ''}`}
                   onClick={() => setPlanFamilyView(option.value)}
                 >
                   {option.label}
                 </button>
               ))}
             </div>
             <div className='text-xs text-slate-500 dark:text-slate-400'>
               {filteredPlans.length > 0
                 ? `${filteredPlans.length} ${t('个可选方案')}`
                 : `${emptyFamilyLabel}${t('暂无可选方案')}`}
             </div>
           </div>
           {filteredPlans.length > 0 ? (
             <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4'>
                {filteredPlans.map((p, index) => {
                 const plan = p?.plan;
                 const originalIndex = plans.findIndex((item) => item?.plan?.id === plan?.id);
                 const isPopular = recommendCount > 0 && originalIndex > -1 && originalIndex < recommendCount;
                 const price = Number(plan?.price_amount || 0).toFixed(0);
                 const limit = Number(plan?.max_purchase_per_user || 0);
                 const count = getPlanPurchaseCount(plan?.id);
                 const purchaseState = getPlanPurchaseState({ plan, count });

                 return (
                   <div key={plan.id} className={`topup-plan-card relative flex flex-col overflow-hidden p-4 rounded-xl border transition-all hover:shadow-md ${isPopular ? 'topup-plan-card-recommended border-slate-900 dark:border-white ring-1 ring-slate-900/10 dark:ring-white/10' : 'border-slate-100'}`}>
                      {isPopular && (
                        <div className='topup-plan-ribbon'>
                           {t('最受欢迎')}
                        </div>
                      )}

                      <div className='flex justify-between items-start mb-3 pr-8'>
                         <div>
                            <h3 className='text-sm font-bold text-slate-900 dark:text-slate-100'>{plan.title}</h3>
                            <p className='text-[10px] text-slate-500 dark:text-slate-400 mt-0.5'>{plan.subtitle || t('专业级模型体验')}</p>
                         </div>
                         <div className='text-right'>
                            <span className='text-lg font-black text-slate-900 dark:text-slate-100'>¥{price}</span>
                            <span className='text-[10px] text-slate-400 dark:text-slate-400 block'>/{formatSubscriptionDuration(plan, t)}</span>
                         </div>
                      </div>

                      <div className='space-y-1.5 mb-3 flex-1'>
                         <div className='flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300'>
                            <div className='w-1 h-1 rounded-full bg-slate-900 dark:bg-slate-200 flex-shrink-0' />
                            <span>{formatQuotaLabel(plan, t)}: {renderQuota(plan.total_amount)}</span>
                         </div>
                         <div className='flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300'>
                            <div className='w-1 h-1 rounded-full bg-slate-900 dark:bg-slate-200 flex-shrink-0' />
                            <span>{t('重置周期')}: {formatSubscriptionResetPeriod(plan, t)}</span>
                         </div>
                         {(plan.promo_highlights || '').split('\n').map((s) => s.trim()).filter(Boolean).map((h, idx) => (
                           <div key={idx} className='flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300'>
                              <div className='w-1 h-1 rounded-full bg-slate-900 dark:bg-slate-200 flex-shrink-0' />
                              <span>{h}</span>
                           </div>
                         ))}
                      </div>

                      <Button
                        theme='solid'
                        block
                        className={`!rounded-lg !h-9 !text-sm !font-bold ${isPopular ? '!bg-slate-900 dark:!bg-white hover:!bg-slate-800 dark:hover:!bg-slate-200 !text-white dark:!text-slate-900' : '!bg-slate-100 dark:!bg-slate-800 !text-slate-900 dark:!text-slate-100 hover:!bg-slate-200 dark:hover:!bg-slate-700 !border-0'}`}
                        disabled={purchaseState.disabled}
                        onClick={() => openBuy(p)}
                      >
                        {t(purchaseState.label)}
                      </Button>
                   </div>
                 );
              })}
             </div>
           ) : (
             <div className='py-6 text-center bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-700'>
               <p className='text-sm font-semibold text-slate-700 dark:text-slate-100'>{emptyFamilyLabel}</p>
               <p className='mt-2 text-xs text-slate-400 dark:text-slate-400'>{t('当前分类暂无可选订阅方案')}</p>
             </div>
           )}
        </div>
      </div>

      <SubscriptionPurchaseModal
        t={t}
        visible={open}
        onCancel={closeBuy}
        selectedPlan={selectedPlan}
        paying={paying}
        selectedEpayMethod={selectedEpayMethod}
        setSelectedEpayMethod={setSelectedEpayMethod}
        epayMethods={epayMethods}
        enableOnlineTopUp={enableOnlineTopUp}
        enableStripeTopUp={enableStripeTopUp}
        enableCreemTopUp={enableCreemTopUp}
        purchaseLimitInfo={
          selectedPlan?.plan?.id
            ? {
                limit: Number(selectedPlan?.plan?.max_purchase_per_user || 0),
                count: getPlanPurchaseCount(selectedPlan?.plan?.id),
              }
            : null
        }
        onPayStripe={payStripe}
        onPayCreem={payCreem}
        onPayEpay={payEpay}
        refundPolicyEnabled={refundPolicyEnabled}
        refundPolicyText={refundPolicyText}
      />
    </Card>
  );
};

export default SubscriptionPlansCard;
