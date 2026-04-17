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

import React, { useEffect, useState, useContext, useMemo, useRef } from 'react';
import {
  API,
  showError,
  showInfo,
  showSuccess,
  renderQuota,
  renderQuotaWithAmount,
} from '../../helpers';
import { Modal, Toast } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { UserContext } from '../../context/User';
import { StatusContext } from '../../context/Status';
import {
  BarChart2,
  Crown,
  Receipt,
  Wallet,
} from 'lucide-react';

import RechargeCard from './RechargeCard';
import SubscriptionPlansCard from './SubscriptionPlansCard';
import PaymentConfirmModal from './modals/PaymentConfirmModal';
import TopupHistoryModal from './modals/TopupHistoryModal';
import WechatPayModal from '../payment/WechatPayModal';
import { createWechatTopup } from '../../helpers/payment';
import './topup-theme.css';

const TopUp = () => {
  const { t, i18n } = useTranslation();
  const [userState, userDispatch] = useContext(UserContext);
  const [statusState] = useContext(StatusContext);

  const [redemptionCode, setRedemptionCode] = useState('');
  const [amount, setAmount] = useState(0.0);
  const [minTopUp, setMinTopUp] = useState(statusState?.status?.min_topup || 1);
  const [topUpCount, setTopUpCount] = useState(
    statusState?.status?.min_topup || 1,
  );
  const [topUpLink, setTopUpLink] = useState(
    statusState?.status?.top_up_link || '',
  );
  const [enableOnlineTopUp, setEnableOnlineTopUp] = useState(
    statusState?.status?.enable_online_topup || false,
  );
  const [priceRatio, setPriceRatio] = useState(statusState?.status?.price || 1);

  const [enableStripeTopUp, setEnableStripeTopUp] = useState(
    statusState?.status?.enable_stripe_topup || false,
  );
  const [enableWechatTopup, setEnableWechatTopup] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);

  const [creemProducts, setCreemProducts] = useState([]);
  const [enableCreemTopUp, setEnableCreemTopUp] = useState(false);
  const [creemOpen, setCreemOpen] = useState(false);
  const [selectedCreemProduct, setSelectedCreemProduct] = useState(null);

  const [refundPolicyText, setRefundPolicyText] = useState('');
  const refundPolicyEnabled = !!statusState?.status?.refund_policy_enabled;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [open, setOpen] = useState(false);
  const [payWay, setPayWay] = useState('');
  const [amountLoading, setAmountLoading] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [payMethods, setPayMethods] = useState([]);

  const [openHistory, setOpenHistory] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const autoRefreshTimerRef = useRef(null);

  const [subscriptionPlans, setSubscriptionPlans] = useState([]);
  const [subscriptionLoading, setSubscriptionLoading] = useState(true);
  const [billingPreference, setBillingPreference] =
    useState('subscription_first');
  const [preferredSubscriptionId, setPreferredSubscriptionId] = useState(0);
  const [activeSubscriptions, setActiveSubscriptions] = useState([]);
  const [allSubscriptions, setAllSubscriptions] = useState([]);

  const [presetAmounts, setPresetAmounts] = useState([]);
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [topupView, setTopupView] = useState('subscription');

  const [wechatModal, setWechatModal] = useState({
    visible: false,
    codeUrl: '',
    outTradeNo: '',
    amountCents: 0,
  });

  const [topupInfo, setTopupInfo] = useState({
    amount_options: [],
    discount: {},
  });

  const topUp = async () => {
    if (redemptionCode === '') {
      showInfo(t('请输入兑换码！'));
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await API.post('/api/user/topup', {
        key: redemptionCode,
      });
      const { success, message, data } = res.data;
      if (success) {
        showSuccess(t('兑换成功！'));
        Modal.success({
          title: t('兑换成功！'),
          content: t('成功兑换额度：') + renderQuota(data),
          centered: true,
        });
        if (userState.user) {
          const updatedUser = {
            ...userState.user,
            quota: userState.user.quota + data,
          };
          userDispatch({ type: 'login', payload: updatedUser });
        }
        setRedemptionCode('');
      } else {
        showError(message);
      }
    } catch (err) {
      showError(t('请求失败'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const openTopUpLink = () => {
    if (!topUpLink) {
      showError(t('超级管理员未设置充值链接！'));
      return;
    }
    window.open(topUpLink, '_blank');
  };

  const preTopUp = async (payment) => {
    if (payment === 'stripe') {
      if (!enableStripeTopUp) {
        showError(t('管理员未开启Stripe充值！'));
        return;
      }
    } else if (payment === 'wechat') {
      // wechat S2 — method is only injected into payMethods when the tenant
      // config is valid, so no separate flag check is needed here.
    } else {
      if (!enableOnlineTopUp) {
        showError(t('管理员未开启在线充值！'));
        return;
      }
    }

    const minimumByPayWay = getMinTopUpByPayWay(payment);
    if (topUpCount < minimumByPayWay) {
      showError(t('充值数量不能小于') + minimumByPayWay);
      return;
    }

    setPayWay(payment);
    setMinTopUp(minimumByPayWay);
    setPaymentLoading(true);
    try {
      await estimateAmount(topUpCount, payment, {
        updateSelectedPreset: false,
      });
      setOpen(true);
    } catch (error) {
      showError(t('获取金额失败'));
    } finally {
      setPaymentLoading(false);
    }
  };

  const onlineTopUp = async () => {
    if (!payWay) {
      showError(t('请选择支付方式'));
      return;
    }

    const minimumByPayWay = getMinTopUpByPayWay(payWay);
    if (topUpCount < minimumByPayWay) {
      showError(t('充值数量不能小于') + minimumByPayWay);
      return;
    }

    setMinTopUp(minimumByPayWay);
    setConfirmLoading(true);
    try {
      await estimateAmount(topUpCount, payWay, {
        updateSelectedPreset: false,
      });

      if (payWay === 'wechat') {
        const res = await createWechatTopup('native', { amount: parseInt(topUpCount) });
        if (!res?.success) {
          Toast.error(res?.message || t('下单失败'));
          return;
        }
        const env = res.data;
        setWechatModal({
          visible: true,
          codeUrl: env.response.code_url,
          outTradeNo: env.order.out_trade_no,
          amountCents: env.order.amount,
        });
        setOpen(false);
        return;
      }

      let res;
      if (payWay === 'stripe') {
        res = await API.post('/api/user/stripe/pay', {
          amount: parseInt(topUpCount),
          payment_method: 'stripe',
        });
      } else {
        res = await API.post('/api/user/pay', {
          amount: parseInt(topUpCount),
          payment_method: payWay,
        });
      }

      if (res !== undefined) {
        const { message, data } = res.data;
        if (message === 'success') {
          if (payWay === 'stripe') {
            window.open(data.pay_link, '_blank');
          } else {
            let params = data;
            let url = res.data.url;
            let form = document.createElement('form');
            form.action = url;
            form.method = 'POST';
            let isSafari =
              navigator.userAgent.indexOf('Safari') > -1 &&
              navigator.userAgent.indexOf('Chrome') < 1;
            if (!isSafari) {
              form.target = '_blank';
            }
            for (let key in params) {
              let input = document.createElement('input');
              input.type = 'hidden';
              input.name = key;
              input.value = params[key];
              form.appendChild(input);
            }
            document.body.appendChild(form);
            form.submit();
            document.body.removeChild(form);
          }
        } else {
          const errorMsg =
            typeof data === 'string' ? data : message || t('支付失败');
          showError(errorMsg);
        }
      } else {
        showError(res);
      }
    } catch (err) {
      showError(t('支付请求失败'));
    } finally {
      setOpen(false);
      setConfirmLoading(false);
    }
  };

  const creemPreTopUp = async (product) => {
    if (!enableCreemTopUp) {
      showError(t('管理员未开启 Creem 充值！'));
      return;
    }
    setSelectedCreemProduct(product);
    setCreemOpen(true);
  };

  const onlineCreemTopUp = async () => {
    if (!selectedCreemProduct) {
      showError(t('请选择产品'));
      return;
    }
    if (!selectedCreemProduct.productId) {
      showError(t('产品配置错误，请联系管理员'));
      return;
    }
    setConfirmLoading(true);
    try {
      const res = await API.post('/api/user/creem/pay', {
        product_id: selectedCreemProduct.productId,
        payment_method: 'creem',
      });
      if (res !== undefined) {
        const { message, data } = res.data;
        if (message === 'success') {
          processCreemCallback(data);
        } else {
          const errorMsg =
            typeof data === 'string' ? data : message || t('支付失败');
          showError(errorMsg);
        }
      } else {
        showError(res);
      }
    } catch (err) {
      showError(t('支付请求失败'));
    } finally {
      setCreemOpen(false);
      setConfirmLoading(false);
    }
  };

  const processCreemCallback = (data) => {
    window.open(data.checkout_url, '_blank');
  };

  const getUserQuota = async () => {
    let res = await API.get(`/api/user/self`);
    const { success, message, data } = res.data;
    if (success) {
      userDispatch({ type: 'login', payload: data });
    } else {
      showError(message);
    }
  };

  const getSubscriptionPlans = async () => {
    setSubscriptionLoading(true);
    try {
      const lang = i18n.language?.split('-')[0] || 'zh';
      const res = await API.get(`/api/subscription/plans?lang=${lang}`);
      if (res.data?.success) {
        setSubscriptionPlans(res.data.data || []);
      }
    } catch (e) {
      setSubscriptionPlans([]);
    } finally {
      setSubscriptionLoading(false);
    }
  };

  const getSubscriptionSelf = async () => {
    try {
      const res = await API.get('/api/subscription/self');
      if (res.data?.success) {
        setBillingPreference(
          res.data.data?.billing_preference || 'subscription_first',
        );
        setPreferredSubscriptionId(
          res.data.data?.preferred_subscription_id || 0,
        );
        const activeSubs = res.data.data?.subscriptions || [];
        setActiveSubscriptions(activeSubs);
        const allSubs = res.data.data?.all_subscriptions || [];
        setAllSubscriptions(allSubs);
      }
    } catch (e) {
      // ignore
    }
  };

  const updateBillingPreference = async (pref) => {
    const previousPref = billingPreference;
    setBillingPreference(pref);
    try {
      const res = await API.put('/api/subscription/self/preference', {
        billing_preference: pref,
      });
      if (res.data?.success) {
        showSuccess(t('更新成功'));
        const normalizedPref =
          res.data?.data?.billing_preference || pref || previousPref;
        setBillingPreference(normalizedPref);
      } else {
        showError(res.data?.message || t('更新失败'));
        setBillingPreference(previousPref);
      }
    } catch (e) {
      showError(t('请求失败'));
      setBillingPreference(previousPref);
    }
  };

  const updatePreferredSubscription = async (subId) => {
    const previousId = preferredSubscriptionId;
    setPreferredSubscriptionId(subId);
    try {
      const res = await API.put('/api/subscription/self/preference', {
        billing_preference: billingPreference,
        preferred_subscription_id: subId,
      });
      if (res.data?.success) {
        showSuccess(t('更新成功'));
        setPreferredSubscriptionId(
          res.data?.data?.preferred_subscription_id ?? subId,
        );
      } else {
        showError(res.data?.message || t('更新失败'));
        setPreferredSubscriptionId(previousId);
      }
    } catch (e) {
      showError(t('请求失败'));
      setPreferredSubscriptionId(previousId);
    }
  };

  const getTopupInfo = async () => {
    try {
      const res = await API.get('/api/user/topup/info');
      const { data, success } = res.data;
      if (success) {
        setTopupInfo({
          amount_options: data.amount_options || [],
          discount: data.discount || {},
        });

        let payMethods = data.pay_methods || [];
        try {
          if (typeof payMethods === 'string') {
            payMethods = JSON.parse(payMethods);
          }
          if (payMethods && payMethods.length > 0) {
            payMethods = payMethods.filter((method) => {
              return method.name && method.type;
            });
            payMethods = payMethods.map((method) => {
              const normalizedMinTopup = Number(method.min_topup);
              method.min_topup = Number.isFinite(normalizedMinTopup)
                ? normalizedMinTopup
                : 0;

              if (
                method.type === 'stripe' &&
                (!method.min_topup || method.min_topup <= 0)
              ) {
                const stripeMin = Number(data.stripe_min_topup);
                if (Number.isFinite(stripeMin)) {
                  method.min_topup = stripeMin;
                }
              }

              if (!method.color) {
                if (method.type === 'alipay') {
                  method.color = 'rgba(var(--semi-blue-5), 1)';
                } else if (method.type === 'wxpay') {
                  method.color = 'rgba(var(--semi-green-5), 1)';
                } else if (method.type === 'stripe') {
                  method.color = 'rgba(var(--semi-purple-5), 1)';
                } else {
                  method.color = 'rgba(var(--semi-primary-5), 1)';
                }
              }
              return method;
            });
          } else {
            payMethods = [];
          }

          setPayMethods(payMethods);
          const enableStripeTopUp = data.enable_stripe_topup || false;
          const enableOnlineTopUp = data.enable_online_topup || false;
          const enableCreemTopUp = data.enable_creem_topup || false;
          const enableWechatTopupData = data.enable_wechat_topup || false;
          const minTopUpValue = enableOnlineTopUp
            ? data.min_topup
            : enableStripeTopUp
              ? data.stripe_min_topup
              : 1;
          setEnableOnlineTopUp(enableOnlineTopUp);
          setEnableStripeTopUp(enableStripeTopUp);
          setEnableCreemTopUp(enableCreemTopUp);
          setEnableWechatTopup(enableWechatTopupData);
          setMinTopUp(minTopUpValue);
          setTopUpCount(minTopUpValue);

          try {
            const products = JSON.parse(data.creem_products || '[]');
            setCreemProducts(products);
          } catch (e) {
            setCreemProducts([]);
          }

          if (topupInfo.amount_options.length === 0) {
            setPresetAmounts(generatePresetAmounts(minTopUpValue));
          }

          const defaultPayWay = payMethods[0]?.type || '';
          setPayWay(defaultPayWay);
          if (defaultPayWay) {
            await estimateAmount(minTopUpValue, defaultPayWay, {
              syncTopUpCount: true,
            });
          }
        } catch (e) {
          setPayMethods([]);
        }

        if (data.amount_options && data.amount_options.length > 0) {
          const customPresets = data.amount_options.map((amount) => ({
            value: amount,
            discount: data.discount[amount] || 1.0,
          }));
          setPresetAmounts(customPresets);
        }
      }
    } catch (error) {
      // ignore
    }
  };

  useEffect(() => {
    getUserQuota().then();
  }, []);

  useEffect(() => {
    getTopupInfo().then();
    getSubscriptionPlans().then();
    getSubscriptionSelf().then();
  }, []);

  useEffect(() => {
    getSubscriptionPlans();
  }, [i18n.language]);

  useEffect(() => {
    if (statusState?.status) {
      setTopUpLink(statusState.status.top_up_link || '');
      setPriceRatio(statusState.status.price || 1);
      setStatusLoading(false);
    }
  }, [statusState?.status]);

  useEffect(() => {
    if (refundPolicyEnabled) {
      API.get('/api/refund-policy').then((res) => {
        if (res.data?.success) {
          setRefundPolicyText(res.data.data || '');
        }
      }).catch(() => {});
    }
  }, [refundPolicyEnabled]);

  useEffect(() => {
    if (!autoRefreshEnabled) {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
        autoRefreshTimerRef.current = null;
      }
      return undefined;
    }

    const refreshTopupStatus = () => {
      getUserQuota();
      getSubscriptionSelf();
    };

    refreshTopupStatus();

    if (!autoRefreshTimerRef.current) {
      autoRefreshTimerRef.current = setInterval(refreshTopupStatus, 10000);
    }

    return () => {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
        autoRefreshTimerRef.current = null;
      }
    };
  }, [autoRefreshEnabled]);

  const renderAmount = () => {
    return amount + ' ' + t('元');
  };

  const getMinTopUpByPayWay = (paymentMethod) => {
    const matchedMethod = payMethods.find(
      (method) => method.type === paymentMethod,
    );
    if (matchedMethod && Number.isFinite(Number(matchedMethod.min_topup))) {
      return Number(matchedMethod.min_topup);
    }
    return minTopUp;
  };

  const estimateAmount = async (value, paymentMethod = payWay, options = {}) => {
    const nextAmount = value === undefined ? topUpCount : value;
    const requestPayWay = paymentMethod || payWay;

    if (!requestPayWay) {
      setAmount(0);
      return 0;
    }

    if (options.syncTopUpCount) {
      setTopUpCount(nextAmount);
    }

    if (options.updateSelectedPreset !== false) {
      setSelectedPreset(options.selectedPresetValue ?? null);
    }

    setAmountLoading(true);
    try {
      const endpoint = requestPayWay === 'stripe'
        ? '/api/user/stripe/amount'
        : '/api/user/amount';
      const res = await API.post(endpoint, {
        amount: parseFloat(nextAmount),
      });
      if (res !== undefined) {
        const { message, data } = res.data;
        if (message === 'success') {
          const nextEstimatedAmount = parseFloat(data);
          setAmount(nextEstimatedAmount);
          return nextEstimatedAmount;
        }
        setAmount(0);
        Toast.error({ content: '错误：' + data, id: 'getAmount' });
      } else {
        showError(res);
      }
    } catch (err) {
      setAmount(0);
    } finally {
      setAmountLoading(false);
    }

    return 0;
  };

  const handleCancel = () => {
    setOpen(false);
  };

  const handleOpenHistory = () => {
    setOpenHistory(true);
  };

  const handleHistoryCancel = () => {
    setOpenHistory(false);
  };

  const handleCreemCancel = () => {
    setCreemOpen(false);
    setSelectedCreemProduct(null);
  };

  const selectPresetAmount = async (preset) => {
    await estimateAmount(preset.value, payWay, {
      syncTopUpCount: true,
      selectedPresetValue: preset.value,
    });
  };

  const formatLargeNumber = (num) => {
    return num.toString();
  };

  const generatePresetAmounts = (minAmount) => {
    const multipliers = [1, 5, 10, 30, 50, 100, 300, 500];
    return multipliers.map((multiplier) => ({
      value: minAmount * multiplier,
    }));
  };

  const summaryCards = useMemo(() => {
    const hasActiveSubscription = activeSubscriptions.length > 0;
    return [
      {
        key: 'quota',
        title: t('当前余额'),
        value: renderQuota(userState?.user?.quota || 0),
        icon: <Wallet size={20} />,
        color: 'blue'
      },
      {
        key: 'subscription',
        title: t('我的订阅'),
        value: hasActiveSubscription
          ? `${activeSubscriptions.length} ${t('个生效中')}`
          : t('无生效'),
        icon: <Crown size={20} />,
        color: 'purple'
      },
      {
        key: 'used',
        title: t('历史消耗'),
        value: renderQuota(userState?.user?.used_quota || 0),
        icon: <Receipt size={20} />,
        color: 'amber'
      },
      {
        key: 'requests',
        title: t('请求次数'),
        value: formatLargeNumber(userState?.user?.request_count || 0),
        icon: <BarChart2 size={20} />,
        color: 'emerald'
      },
    ];
  }, [
    activeSubscriptions.length,
    t,
    userState?.user?.quota,
    userState?.user?.request_count,
    userState?.user?.used_quota,
  ]);

  return (
    <div className='topup-page w-full max-w-7xl mx-auto relative min-h-screen lg:min-h-0 mt-[72px] px-4 pb-8'>
      <PaymentConfirmModal
        t={t}
        open={open}
        onlineTopUp={onlineTopUp}
        handleCancel={handleCancel}
        confirmLoading={confirmLoading}
        topUpCount={topUpCount}
        renderQuotaWithAmount={renderQuotaWithAmount}
        amountLoading={amountLoading}
        renderAmount={renderAmount}
        payWay={payWay}
        payMethods={payMethods}
        amountNumber={amount}
      />

      <TopupHistoryModal
        visible={openHistory}
        onCancel={handleHistoryCancel}
        t={t}
      />

      <WechatPayModal
        {...wechatModal}
        onClose={() =>
          setWechatModal({ visible: false, codeUrl: '', outTradeNo: '', amountCents: 0 })
        }
        onSuccess={() => {
          getUserQuota();
          setWechatModal({ visible: false, codeUrl: '', outTradeNo: '', amountCents: 0 });
        }}
      />

      <Modal
        title={`${t('确定要充值')} ${selectedCreemProduct?.currency === 'EUR' ? '€' : selectedCreemProduct?.currency === 'USD' ? '$' : '¥'}`}
        visible={creemOpen}
        onOk={onlineCreemTopUp}
        onCancel={handleCreemCancel}
        maskClosable={false}
        size='small'
        centered
        confirmLoading={confirmLoading}
      >
        {selectedCreemProduct && (
          <>
            <p>
              {t('产品名称')}：{selectedCreemProduct.name}
            </p>
            <p>
              {t('价格')}：{selectedCreemProduct.currency === 'EUR' ? '€' : selectedCreemProduct.currency === 'USD' ? '$' : '¥'}
              {selectedCreemProduct.price}
            </p>
            <p>
              {t('充值额度')}：{selectedCreemProduct.quota}
            </p>
            <p>{t('是否确认充值？')}</p>
          </>
        )}
      </Modal>

      <div className='topup-stack space-y-5'>
        {/* Assets Overview + Transaction Button in one row */}
        <div className='flex items-stretch gap-3'>
          <div className='grid grid-cols-2 lg:grid-cols-4 gap-3 flex-1 min-w-0'>
            {summaryCards.map((item) => (
              <div key={item.key} className='topup-stat-card group p-4'>
                <div className='flex items-center gap-3'>
                  <div className={`stat-icon-wrapper stat-icon-${item.color}`}>
                    {item.icon}
                  </div>
                  <div className='min-w-0'>
                    <div className='text-[11px] font-medium text-slate-400 dark:text-slate-400 uppercase tracking-wider truncate'>
                      {item.title}
                    </div>
                    <div className='text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight truncate'>
                      {item.value}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button
            type='button'
            className='topup-billing-btn flex-shrink-0 flex flex-col items-center justify-center gap-2 px-5 rounded-2xl cursor-pointer transition-all'
            onClick={handleOpenHistory}
          >
            <Receipt size={20} />
            <span className='text-xs font-bold whitespace-nowrap'>{t('交易账单')}</span>
          </button>
        </div>

        {/* Main Content */}
        <div className='space-y-4'>
          <div className='flex items-center justify-between'>
            <div className='topup-view-switch'>
              <button
                type='button'
                className={`topup-view-switch-item ${topupView === 'subscription' ? 'topup-view-switch-item-active' : ''}`}
                onClick={() => setTopupView('subscription')}
              >
                <Crown size={16} />
                <span>{t('订阅方案')}</span>
              </button>
              <button
                type='button'
                className={`topup-view-switch-item ${topupView === 'recharge' ? 'topup-view-switch-item-active' : ''}`}
                onClick={() => setTopupView('recharge')}
              >
                <Wallet size={16} />
                <span>{t('随用随充')}</span>
              </button>
            </div>
          </div>

          {topupView === 'subscription' ? (
            <SubscriptionPlansCard
              t={t}
              loading={subscriptionLoading}
              plans={subscriptionPlans}
              payMethods={payMethods}
              enableOnlineTopUp={enableOnlineTopUp}
              enableStripeTopUp={enableStripeTopUp}
              enableCreemTopUp={enableCreemTopUp}
              billingPreference={billingPreference}
              onChangeBillingPreference={updateBillingPreference}
              preferredSubscriptionId={preferredSubscriptionId}
              onChangePreferredSubscription={updatePreferredSubscription}
              activeSubscriptions={activeSubscriptions}
              allSubscriptions={allSubscriptions}
              reloadSubscriptionSelf={getSubscriptionSelf}
              subscriptionNotice={statusState?.status?.topup_subscription_notice || ''}
              refundPolicyEnabled={refundPolicyEnabled}
              refundPolicyText={refundPolicyText}
            />
          ) : (
            <RechargeCard
              t={t}
              enableOnlineTopUp={enableOnlineTopUp}
              enableStripeTopUp={enableStripeTopUp}
              enableCreemTopUp={enableCreemTopUp}
              enableWechatTopup={enableWechatTopup}
              creemProducts={creemProducts}
              creemPreTopUp={creemPreTopUp}
              presetAmounts={presetAmounts}
              selectedPreset={selectedPreset}
              selectPresetAmount={selectPresetAmount}
              formatLargeNumber={formatLargeNumber}
              priceRatio={priceRatio}
              topUpCount={topUpCount}
              minTopUp={minTopUp}
              renderQuotaWithAmount={renderQuotaWithAmount}
              getMinTopUpByPayWay={getMinTopUpByPayWay}
              estimateAmount={estimateAmount}
              setTopUpCount={setTopUpCount}
              setSelectedPreset={setSelectedPreset}
              renderAmount={renderAmount}
              amountLoading={amountLoading}
              payMethods={payMethods}
              preTopUp={preTopUp}
              paymentLoading={paymentLoading}
              payWay={payWay}
              redemptionCode={redemptionCode}
              setRedemptionCode={setRedemptionCode}
              topUp={topUp}
              isSubmitting={isSubmitting}
              topUpLink={topUpLink}
              openTopUpLink={openTopUpLink}
              userState={userState}
              renderQuota={renderQuota}
              statusLoading={statusLoading}
              topupInfo={topupInfo}
              autoRefreshEnabled={autoRefreshEnabled}
              setAutoRefreshEnabled={setAutoRefreshEnabled}
              onOpenHistory={handleOpenHistory}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default TopUp;
