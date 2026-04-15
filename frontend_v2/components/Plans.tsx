import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from '../lib/i18n';
import { API } from '../lib/api';
import { toast } from 'react-hot-toast';

interface SubscriptionPlan {
  id: number;
  title: string;
  subtitle: string;
  price_amount: number;
  currency: string;
  duration_unit: string;
  duration_value: number;
  custom_seconds: number;
  enabled: boolean;
  sort_order: number;
  stripe_price_id: string;
  creem_product_id: string;
  max_purchase_per_user: number;
  upgrade_group: string;
  total_amount: number;
  quota_reset_period: string;
  quota_reset_custom_seconds: number;
  created_at: number;
  updated_at: number;
}

interface SubscriptionPlanDTO {
  plan: SubscriptionPlan;
}

interface UserSummary {
  quota: number;
  used_quota: number;
  request_count: number;
}

interface UserSubscriptionEntry {
  id: number;
  plan_id: number;
  amount_total: number;
  amount_used: number;
  end_time: number;
  status: string;
}

interface TopUpRecord {
  id: number;
  trade_no: string;
  amount: number;
  money: number;
  create_time: number;
  status: string;
  payment_method: string;
}

interface PayMethod {
  name: string;
  type: string;
}

interface CreemProduct {
  productId: string;
  name: string;
  price: number | string;
  currency?: string;
  quota?: number;
}

const Plans: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'overview' | 'market'>('overview');
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Wallet & Priority State
  const [priority, setPriority] = useState<'subscription_first' | 'wallet_first' | 'subscription_only' | 'wallet_only'>('subscription_first');
  const [userSummary, setUserSummary] = useState<UserSummary>({ quota: 0, used_quota: 0, request_count: 0 });
  const [activeSubscriptions, setActiveSubscriptions] = useState<UserSubscriptionEntry[]>([]);
  const [topUpHistory, setTopUpHistory] = useState<TopUpRecord[]>([]);
  const [payMethods, setPayMethods] = useState<PayMethod[]>([]);
  const [creemProducts, setCreemProducts] = useState<CreemProduct[]>([]);
  const [enableCreem, setEnableCreem] = useState(false);
  const [paying, setPaying] = useState(false);
  const [subscribingPlanId, setSubscribingPlanId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [affCode, setAffCode] = useState('');
  const [affQuota, setAffQuota] = useState(0);
  const [affHistoryQuota, setAffHistoryQuota] = useState(0);
  const [affCount, setAffCount] = useState(0);
  const [rebateCount, setRebateCount] = useState(0);
  const [rebatePercent, setRebatePercent] = useState(0);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [subPurchasePlan, setSubPurchasePlan] = useState<SubscriptionPlan | null>(null);

  // Currency display config from /api/status
  const [currencySymbol, setCurrencySymbol] = useState('$');
  const [currencyRate, setCurrencyRate] = useState(1);
  const [quotaPerUnit, setQuotaPerUnit] = useState(500000);
  const [priceRate, setPriceRate] = useState(1);

  /** Convert internal quota to display currency string */
  const quotaToDisplay = (quota: number, digits = 2): string => {
    const usd = quota / quotaPerUnit;
    return (usd * currencyRate).toFixed(digits);
  };

  /** Format value with currency symbol */
  const fmtCurrency = (value: string | number): string => {
    return `${currencySymbol}${value}`;
  };

  /** Count how many times the user has purchased each plan (all statuses count) */
  const planPurchaseCountMap = React.useMemo(() => {
    const map = new Map<number, number>();
    (activeSubscriptions || []).forEach((sub: any) => {
      const planId = sub?.plan_id;
      if (planId) {
        map.set(planId, (map.get(planId) || 0) + 1);
      }
    });
    return map;
  }, [activeSubscriptions]);

  useEffect(() => {
    fetchPlans();
    fetchOverviewData();
  }, []);

  const fetchPlans = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await API.get<{ success: boolean; data: SubscriptionPlanDTO[] }>('/api/subscription/plans');
      if (response.data.success && response.data.data) {
        setPlans(response.data.data.map(dto => dto.plan));
      }
    } catch (err: any) {
      console.error('Failed to fetch subscription plans:', err);
      setError(err.response?.data?.message || 'Failed to load subscription plans');
    } finally {
      setLoading(false);
    }
  };

  const fetchOverviewData = async () => {
    try {
      const [userRes, subRes, historyRes, topupInfoRes, affRes, statusRes] = await Promise.all([
        API.get('/api/user/self'),
        API.get('/api/subscription/self'),
        API.get('/api/user/topup/self', { params: { p: 1, page_size: 20 } }),
        API.get('/api/user/topup/info'),
        API.get('/api/user/aff'),
        API.get('/api/status'),
      ]);

      if (userRes.data?.success) {
        setUserSummary({
          quota: userRes.data?.data?.quota || 0,
          used_quota: userRes.data?.data?.used_quota || 0,
          request_count: userRes.data?.data?.request_count || 0,
        });
        setAffQuota(userRes.data?.data?.aff_quota || 0);
        setAffHistoryQuota(userRes.data?.data?.aff_history_quota || 0);
        setAffCount(userRes.data?.data?.aff_count || 0);
      }

      if (subRes.data?.success) {
        const pref = subRes.data?.data?.billing_preference;
        if (['subscription_first', 'wallet_first', 'subscription_only', 'wallet_only'].includes(pref)) {
          setPriority(pref);
        } else {
          setPriority('subscription_first');
        }
        const subs = (subRes.data?.data?.all_subscriptions || subRes.data?.data?.subscriptions || [])
          .map((item: any) => item.subscription || item)
          .filter(Boolean);
        setActiveSubscriptions(subs);
      }

      if (historyRes.data?.success) {
        setTopUpHistory(historyRes.data?.data?.items || []);
      }

      if (topupInfoRes.data?.success) {
        let methods = topupInfoRes.data?.data?.pay_methods || [];
        if (typeof methods === 'string') {
          try {
            methods = JSON.parse(methods);
          } catch {
            methods = [];
          }
        }
        if (Array.isArray(methods)) {
          setPayMethods(
            methods
              .filter((m) => m?.name && m?.type)
              .map((m) => ({
                name: String(m.name),
                type: String(m.type),
              })),
          );
        } else {
          setPayMethods([]);
        }

        // Creem products
        const enableCreemFlag =
          topupInfoRes.data?.data?.enable_creem_topup ||
          topupInfoRes.data?.data?.enable_creem ||
          false;
        setEnableCreem(enableCreemFlag);
        let cProducts = topupInfoRes.data?.data?.creem_products || [];
        if (typeof cProducts === 'string') {
          try { cProducts = JSON.parse(cProducts); } catch { cProducts = []; }
        }
        if (Array.isArray(cProducts)) {
          setCreemProducts(
            cProducts
              .filter((p) => p?.productId)
              .map((p) => ({
                productId: String(p.productId),
                name: String(p.name || ''),
                price: p.price ?? 0,
                currency: p.currency,
                quota: p.quota,
              })),
          );
        } else {
          setCreemProducts([]);
        }
      }

      if (affRes.data?.success) {
        setAffCode(affRes.data?.data || '');
      }

      if (statusRes.data?.success) {
        const sd = statusRes.data?.data;
        setRebateCount(sd?.top_up_rebate_count || 0);
        setRebatePercent(sd?.top_up_rebate_percent || 0);
        // Currency config
        if (sd?.quota_per_unit) setQuotaPerUnit(sd.quota_per_unit);
        const displayType = sd?.quota_display_type || 'USD';
        if (displayType === 'CNY') {
          setCurrencySymbol('¥');
          setCurrencyRate(sd?.usd_exchange_rate || 7);
        } else if (displayType === 'CUSTOM') {
          setCurrencySymbol(sd?.custom_currency_symbol || '¤');
          setCurrencyRate(sd?.custom_currency_exchange_rate || 1);
        } else {
          setCurrencySymbol('$');
          setCurrencyRate(1);
        }
        if (sd?.price) setPriceRate(sd.price);
      }
    } catch (err) {
      console.error('Failed to fetch overview data:', err);
    }
  };

  const isValidUrl = (url: string): boolean => {
    if (!url) return false;
    // Allow relative paths
    if (url.startsWith('/')) return true;
    // Only allow https URLs
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const submitPaymentForm = (url: string, params: Record<string, string>) => {
    // Validate URL
    if (!isValidUrl(url)) {
      toast.error(t('plans.error.invalid_url'));
      return;
    }

    // Whitelist of allowed payment parameters
    const allowedParams = new Set([
      'amount', 'order_id', 'return_url', 'notify_url', 'sign', 'timestamp',
      'user_id', 'product_id', 'currency', 'description', 'merchant_id',
      'nonce', 'signature', 'callback_url', 'success_url', 'cancel_url',
      'payment_method', 'trade_no', 'out_trade_no', 'subject', 'body',
      'pid', 'type', 'name', 'money', 'device', 'sign_type'
    ]);

    // Suspicious parameter names that should be rejected
    const suspiciousParams = ['redirect', 'eval', 'script', 'onclick', 'onerror',
                              'onload', 'javascript', 'data', 'src', 'href'];

    // Sanitize parameters
    const sanitizedParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      const lowerKey = key.toLowerCase();

      // Reject suspicious parameter names
      if (suspiciousParams.some(suspicious => lowerKey.includes(suspicious))) {
        console.warn(`Rejected suspicious parameter: ${key}`);
        continue;
      }

      // Only include whitelisted parameters
      if (allowedParams.has(key)) {
        sanitizedParams[key] = value;
      } else {
        console.warn(`Parameter not in whitelist: ${key}`);
      }
    }

    const form = document.createElement('form');
    form.action = url;
    form.method = 'POST';
    form.target = '_blank';
    Object.entries(sanitizedParams).forEach(([key, value]) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = value;
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  };

  const handlePriorityChange = async (value: 'subscription_first' | 'wallet_first' | 'subscription_only' | 'wallet_only') => {
    const previous = priority;
    setPriority(value);
    setActionError(null);
    try {
      const response = await API.put('/api/subscription/self/preference', {
        billing_preference: value,
      });
      if (!response.data?.success) {
        throw new Error(response.data?.message || t('plans.error.preference'));
      }
    } catch (err: any) {
      setPriority(previous);
      setActionError(err.response?.data?.message || err.message || t('plans.error.preference'));
    }
  };

  const handleTopUp = async (
    amount: number,
    method: string,
    creemProductId?: string,
  ) => {
    setPaying(true);
    setActionError(null);
    try {
      if (method === 'stripe') {
        const response = await API.post('/api/user/stripe/pay', {
          amount: Math.floor(amount),
          payment_method: 'stripe',
        });
        if (response.data?.message === 'success' && response.data?.data?.pay_link) {
          window.open(response.data.data.pay_link, '_blank');
        } else {
          throw new Error(response.data?.data || response.data?.message || t('plans.error.payment'));
        }
      } else if (method === 'creem') {
        const payload: Record<string, unknown> = {
          payment_method: 'creem',
        };

        // New flow uses fixed Creem product_id. Keep amount fallback for compatibility.
        if (creemProductId) {
          payload.product_id = creemProductId;
        } else {
          payload.amount = Math.floor(amount);
        }

        const response = await API.post('/api/user/creem/pay', payload);
        const checkoutUrl =
          response.data?.data?.checkout_url || response.data?.data?.pay_link;
        if (response.data?.message === 'success' && checkoutUrl) {
          window.open(checkoutUrl, '_blank');
        } else {
          throw new Error(response.data?.data || response.data?.message || t('plans.error.payment'));
        }
      } else {
        const response = await API.post('/api/user/pay', {
          amount: Math.floor(amount),
          payment_method: method,
        });
        if (response.data?.message === 'success' && response.data?.url && response.data?.data) {
          submitPaymentForm(response.data.url, response.data.data);
        } else {
          throw new Error(response.data?.data || response.data?.message || t('plans.error.payment'));
        }
      }
      setIsTopUpOpen(false);
      fetchOverviewData();
    } catch (err: any) {
      setActionError(err.response?.data?.message || err.message || t('plans.error.topup'));
    } finally {
      setPaying(false);
    }
  };

  const handleSubscribePlan = (plan: SubscriptionPlan) => {
    setSubPurchasePlan(plan);
  };

  const executeSubscription = async (plan: SubscriptionPlan, method: string) => {
    setSubscribingPlanId(plan.id);
    setActionError(null);
    try {
      if (method === 'stripe' && plan.stripe_price_id) {
        const response = await API.post('/api/subscription/stripe/pay', { plan_id: plan.id });
        const payLink = response.data?.data?.pay_link;
        if (response.data?.message === 'success' && payLink) {
          window.open(payLink, '_blank');
        } else {
          throw new Error(response.data?.data || response.data?.message || t('plans.error.subscribe'));
        }
      } else if (method === 'creem' && plan.creem_product_id) {
        const response = await API.post('/api/subscription/creem/pay', { plan_id: plan.id });
        const checkoutUrl = response.data?.data?.checkout_url;
        if (response.data?.message === 'success' && checkoutUrl) {
          window.open(checkoutUrl, '_blank');
        } else {
          throw new Error(response.data?.data || response.data?.message || t('plans.error.subscribe'));
        }
      } else {
        const response = await API.post('/api/subscription/epay/pay', {
          plan_id: plan.id,
          payment_method: method,
        });
        if (response.data?.message === 'success' && response.data?.url && response.data?.data) {
          submitPaymentForm(response.data.url, response.data.data);
        } else {
          throw new Error(response.data?.data || response.data?.message || t('plans.error.subscribe'));
        }
      }
      setSubPurchasePlan(null);
      fetchOverviewData();
    } catch (err: any) {
      setActionError(err.response?.data?.message || err.message || t('plans.error.subscribe'));
    } finally {
      setSubscribingPlanId(null);
    }
  };

  const handleAffTransfer = async (amount: number) => {
    setTransferring(true);
    setActionError(null);
    try {
      const response = await API.post('/api/user/aff_transfer', { quota: amount });
      if (response.data?.success) {
        toast.success(t('plans.invite.transfer_success'));
        setIsTransferOpen(false);
        fetchOverviewData();
      } else {
        throw new Error(response.data?.message || t('plans.invite.transfer_failed'));
      }
    } catch (err: any) {
      setActionError(err.response?.data?.message || err.message || t('plans.invite.transfer_failed'));
    } finally {
      setTransferring(false);
    }
  };

  const affLink = affCode ? `${window.location.origin}/register?aff=${affCode}` : '';

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('plans.invite.copied'));
    } catch {
      console.error('Copy failed');
    }
  };

  return (
    <div className="flex flex-col w-full h-full relative">
        {actionError && (
          <div className="mx-6 md:mx-10 mt-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 text-sm text-red-700 dark:text-red-400">
            {actionError}
          </div>
        )}
        {/* Top Up Modal Overlay */}
        {isTopUpOpen && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                <div 
                    className="w-full max-w-2xl animate-in fade-in zoom-in duration-200"
                    onClick={(e) => e.stopPropagation()}
                >
                   <RechargeModal
                     onClose={() => setIsTopUpOpen(false)}
                     t={t}
                     payMethods={payMethods}
                     onTopUp={handleTopUp}
                     loading={paying}
                     userSummary={userSummary}
                     topUpHistory={topUpHistory}
                     enableCreem={enableCreem}
                     creemProducts={creemProducts}
                     quotaToDisplay={quotaToDisplay}
                     fmtCurrency={fmtCurrency}
                     currencySymbol={currencySymbol}
                     priceRate={priceRate}
                     currencyRate={currencyRate}
                   />
                </div>
                <div className="absolute inset-0 -z-10" onClick={() => setIsTopUpOpen(false)}></div>
            </div>
        )}

        {/* Subscription Purchase Modal */}
        {subPurchasePlan && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                <div className="w-full max-w-md animate-in fade-in zoom-in duration-200" onClick={(e) => e.stopPropagation()}>
                    <SubscriptionPurchaseModal
                        plan={subPurchasePlan}
                        onClose={() => setSubPurchasePlan(null)}
                        onPay={(method: string) => executeSubscription(subPurchasePlan, method)}
                        t={t}
                        payMethods={payMethods}
                        loading={subscribingPlanId === subPurchasePlan.id}
                        planPurchaseCountMap={planPurchaseCountMap}
                    />
                </div>
                <div className="absolute inset-0 -z-10" onClick={() => setSubPurchasePlan(null)}></div>
            </div>
        )}

        {/* Transfer Modal */}
        {isTransferOpen && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                <div className="w-full max-w-sm animate-in fade-in zoom-in duration-200" onClick={(e) => e.stopPropagation()}>
                    <TransferModal
                        onClose={() => setIsTransferOpen(false)}
                        t={t}
                        affQuota={affQuota}
                        onTransfer={handleAffTransfer}
                        loading={transferring}
                        quotaToDisplay={quotaToDisplay}
                        fmtCurrency={fmtCurrency}
                        currencySymbol={currencySymbol}
                        quotaPerUnit={quotaPerUnit}
                        currencyRate={currencyRate}
                    />
                </div>
                <div className="absolute inset-0 -z-10" onClick={() => setIsTransferOpen(true)}></div>
            </div>
        )}

        {/* History Modal Overlay */}
        {isHistoryOpen && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                <div 
                    className="w-full max-w-4xl animate-in fade-in zoom-in duration-200"
                    onClick={(e) => e.stopPropagation()}
                >
                   <HistoryModal onClose={() => setIsHistoryOpen(false)} t={t} records={topUpHistory} currencySymbol={currencySymbol} />
                </div>
                <div className="absolute inset-0 -z-10" onClick={() => setIsHistoryOpen(false)}></div>
            </div>
        )}

        {/* Top Header */}
        <div className="px-6 md:px-10 py-12 bg-white dark:bg-dark-surface relative overflow-hidden border-b border-slate-200 dark:border-dark-border">
             <div className="absolute top-0 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl -mr-32 -mt-32 pointer-events-none"></div>
             <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl -ml-20 -mb-20 pointer-events-none"></div>

             <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-end justify-between gap-8 relative z-10">
                <div>
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider mb-4">
                        <span className="material-symbols-outlined text-sm">payments</span>
                        {t('nav.plans')}
                    </div>
                    <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">{t('plans.title')}</h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-2 max-w-xl text-lg leading-relaxed">{t('plans.subtitle')}</p>
                </div>
                <div className="flex bg-slate-100 dark:bg-[#1c2536] p-1.5 rounded-xl shadow-inner border border-slate-200 dark:border-dark-border/50">
                    <button 
                        onClick={() => setActiveTab('overview')}
                        className={`px-6 py-2.5 text-sm font-bold rounded-lg transition-all duration-300 ${activeTab === 'overview' ? 'bg-white dark:bg-primary text-slate-900 dark:text-white shadow-md' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                    >
                        {t('plans.tab.overview')}
                    </button>
                    <button 
                        onClick={() => setActiveTab('market')}
                        className={`px-6 py-2.5 text-sm font-bold rounded-lg transition-all duration-300 ${activeTab === 'market' ? 'bg-white dark:bg-primary text-slate-900 dark:text-white shadow-md' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                    >
                        {t('plans.tab.market')}
                    </button>
                </div>
            </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-dark-bg">
            <div className="max-w-7xl mx-auto px-6 md:px-10 py-8">
                {activeTab === 'overview' ? (
                    <OverviewTab
                        priority={priority}
                        setPriority={handlePriorityChange}
                        t={t}
                        onTopUp={() => setIsTopUpOpen(true)}
                        onHistory={() => setIsHistoryOpen(true)}
                        userSummary={userSummary}
                        subscriptions={activeSubscriptions}
                        plans={plans}
                        setActiveTab={setActiveTab}
                        affQuota={affQuota}
                        affHistoryQuota={affHistoryQuota}
                        affCount={affCount}
                        affLink={affLink}
                        rebateCount={rebateCount}
                        rebatePercent={rebatePercent}
                        onCopyLink={() => copyToClipboard(affLink)}
                        onTransfer={() => setIsTransferOpen(true)}
                        quotaToDisplay={quotaToDisplay}
                        fmtCurrency={fmtCurrency}
                        currencySymbol={currencySymbol}
                    />
                ) : (
                    <MarketplaceTab t={t} plans={plans} loading={loading} error={error} onSubscribe={handleSubscribePlan} subscribingPlanId={subscribingPlanId} quotaToDisplay={quotaToDisplay} fmtCurrency={fmtCurrency} planPurchaseCountMap={planPurchaseCountMap} />
                )}
            </div>
        </div>
    </div>
  );
};

const OverviewTab = ({ priority, setPriority, t, onTopUp, onHistory, userSummary, subscriptions, plans, setActiveTab, affQuota, affHistoryQuota, affCount, affLink, rebateCount, rebatePercent, onCopyLink, onTransfer, quotaToDisplay, fmtCurrency, currencySymbol }: any) => {
    const [activeSubscriptions, setActiveSubscriptions] = useState<any[]>([]);
    const [expiredSubscriptions, setExpiredSubscriptions] = useState<any[]>([]);
    const [showExpired, setShowExpired] = useState(false);

    const dragItem = useRef<number | null>(null);

    useEffect(() => {
        const now = Math.floor(Date.now() / 1000);
        const planMap = new Map<number, any>((plans || []).map((p: any) => [p.id, p]));
        const active: any[] = [];
        const expired: any[] = [];

        (subscriptions || []).forEach((sub: any, index: number) => {
            const plan = planMap.get(sub.plan_id) as any;
            const amountTotal = Number(sub.amount_total || 0);
            const amountUsed = Number(sub.amount_used || 0);
            const percentage = amountTotal > 0 ? Math.min(100, Math.round((amountUsed / amountTotal) * 100)) : 0;
            const isExpired = sub.status !== 'active' || (sub.end_time > 0 && sub.end_time < now);

            const item = {
                id: String(sub.id),
                type: plan?.title || t('plans.subscription'),
                name: plan?.subtitle || `Plan #${sub.plan_id}`,
                limit: amountTotal === 0 ? t('plans.unlimited') : fmtCurrency(quotaToDisplay(amountTotal)),
                used: fmtCurrency(quotaToDisplay(amountUsed)),
                percentage,
                date: sub.end_time > 0 ? new Date(sub.end_time * 1000).toLocaleDateString() : t('plans.never'),
                color: index % 2 === 0 ? 'primary' : 'purple',
                isExpired,
            };

            if (isExpired) {
                expired.push(item);
            } else {
                active.push(item);
            }
        });

        setActiveSubscriptions(active);
        setExpiredSubscriptions(expired);
    }, [subscriptions, plans]);

    const handleDragStart = (e: React.DragEvent, position: number) => {
        dragItem.current = position;
        e.currentTarget.classList.add('opacity-50');
    };

    const handleDragEnter = (e: React.DragEvent, position: number) => {
        e.preventDefault();

        // Live Swapping Logic
        if (dragItem.current !== null && dragItem.current !== position) {
            const newList = [...activeSubscriptions];
            const draggedItemContent = newList[dragItem.current];

            // Remove from old pos and insert at new pos
            newList.splice(dragItem.current, 1);
            newList.splice(position, 0, draggedItemContent);

            setActiveSubscriptions(newList);
            // Update the dragItem ref to the new position to continue tracking correctly
            dragItem.current = position;
        }
    };

    const handleDragEnd = (e: React.DragEvent) => {
        e.currentTarget.classList.remove('opacity-50');
        dragItem.current = null;
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column: Wallet & Priority */}
            <div className="space-y-8">
                {/* Wallet Card */}
                <div className="bg-gradient-to-br from-[#1e293b] to-[#0f172a] dark:from-dark-surface dark:to-[#0a0c10] rounded-[2rem] p-8 shadow-2xl border border-slate-700 dark:border-dark-border relative overflow-hidden group">
                    <div className="absolute -top-24 -right-24 w-64 h-64 bg-primary/20 rounded-full blur-3xl group-hover:bg-primary/30 transition-all duration-700"></div>
                    <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl group-hover:bg-emerald-500/20 transition-all duration-700"></div>
                    
                    <div className="relative z-10">
                        <div className="flex justify-between items-start mb-8">
                            <div className="flex items-center gap-3 px-4 py-2 bg-white/5 backdrop-blur-md rounded-full border border-white/10">
                                <span className="material-symbols-outlined text-primary-light text-xl">account_balance_wallet</span>
                                <span className="text-xs font-bold text-slate-300 uppercase tracking-[0.15em]">{t('plans.wallet.balance')}</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('plans.wallet.auto_reload')}</span>
                                <button className="w-10 h-5 bg-slate-700/50 rounded-full relative p-1 transition-colors hover:bg-slate-600/50">
                                    <div className="w-3 h-3 bg-slate-500 rounded-full"></div>
                                </button>
                            </div>
                        </div>
                        
                        <div className="mb-10">
                            <div className="flex items-baseline gap-2">
                                <span className="text-2xl font-bold text-slate-400">{currencySymbol}</span>
                                <span className="text-6xl font-black text-white tracking-tighter drop-shadow-2xl">
                                    {quotaToDisplay(Number(userSummary?.quota || 0))}
                                </span>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <button 
                                onClick={onTopUp}
                                className="group/btn relative flex items-center justify-center gap-3 py-4 rounded-2xl bg-primary text-white font-bold hover:bg-primary-hover shadow-xl shadow-primary/30 transition-all active:scale-95 overflow-hidden"
                            >
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover/btn:translate-x-full duration-1000 transition-transform"></div>
                                <span className="material-symbols-outlined text-[20px]">add_circle</span>
                                {t('plans.wallet.topup')}
                            </button>
                            <button 
                                onClick={onHistory}
                                className="flex items-center justify-center gap-3 py-4 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 text-white font-bold hover:bg-white/10 transition-all active:scale-95"
                            >
                                <span className="material-symbols-outlined text-[20px]">history</span>
                                {t('plans.history_btn')}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Priority Settings */}
                <div className="bg-white dark:bg-dark-surface rounded-[2rem] p-8 shadow-xl border border-slate-200 dark:border-dark-border">
                    <h3 className="text-xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">{t('plans.priority.title')}</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-8 leading-relaxed">{t('plans.priority.desc')}</p>

                    <div className="grid grid-cols-1 gap-4">
                        {[
                          { value: 'subscription_first', icon: 'layers', label: t('plans.priority.sub_first'), desc: t('plans.priority.sub_first_desc') },
                          { value: 'wallet_first', icon: 'account_balance_wallet', label: t('plans.priority.wallet_first'), desc: t('plans.priority.wallet_first_desc') },
                          { value: 'subscription_only', icon: 'auto_awesome_motion', label: t('plans.priority.sub_only'), desc: t('plans.priority.sub_only_desc') },
                          { value: 'wallet_only', icon: 'payments', label: t('plans.priority.wallet_only'), desc: t('plans.priority.wallet_only_desc') },
                        ].map((opt) => (
                          <div
                            key={opt.value}
                            onClick={() => setPriority(opt.value as any)}
                            className={`group relative flex items-start gap-4 p-5 rounded-2xl border transition-all duration-300 cursor-pointer ${
                              priority === opt.value
                                ? 'bg-primary/5 border-primary shadow-lg shadow-primary/10'
                                : 'bg-slate-50 dark:bg-[#161b22] border-slate-200 dark:border-dark-border hover:border-slate-400 dark:hover:border-slate-500 hover:shadow-md'
                            }`}
                          >
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                                priority === opt.value ? 'bg-primary text-white' : 'bg-slate-200 dark:bg-[#1c2536] text-slate-500 dark:text-slate-400'
                            }`}>
                                <span className="material-symbols-outlined text-[20px]">{opt.icon}</span>
                            </div>
                            <div className="flex-1 pr-8">
                              <div className={`font-bold text-sm mb-1 ${priority === opt.value ? 'text-primary' : 'text-slate-900 dark:text-white'}`}>
                                {opt.label}
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
                                {opt.desc}
                              </div>
                            </div>
                            <div className={`absolute top-5 right-5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                                priority === opt.value ? 'border-primary bg-primary' : 'border-slate-300 dark:border-slate-600'
                            }`}>
                                {priority === opt.value && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
                            </div>
                          </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Right Column: Active Plans (Draggable) */}
            <div className="lg:col-span-2 space-y-4">
                <div className="flex justify-between items-end mb-2">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary">verified</span>
                        {t('plans.active_subs')}
                    </h3>
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">drag_indicator</span>
                        {t('plans.drag_hint')}
                    </span>
                </div>

                <div className="space-y-4" onDragOver={(e) => e.preventDefault()}>
                    {/* 没有活跃订阅时显示引导 */}
                    {activeSubscriptions.length === 0 && (
                        <div className="text-center py-10 bg-white dark:bg-dark-surface border border-slate-200 dark:border-dark-border rounded-2xl">
                            <p className="text-slate-500 dark:text-slate-400 mb-4">
                                {t('plans.no_subs')}
                            </p>
                            <button
                                onClick={() => setActiveTab('market')}
                                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                            >
                                {t('plans.browse')}
                            </button>
                        </div>
                    )}

                    {/* 活跃订阅列表（可拖拽） */}
                    {activeSubscriptions.map((sub, index) => (
                        <div
                            key={sub.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, index)}
                            onDragEnter={(e) => handleDragEnter(e, index)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => e.preventDefault()}
                            className="cursor-move transform transition-all duration-200"
                        >
                            <div className="flex items-center gap-3">
                                <div className="flex flex-col items-center justify-center gap-1 text-slate-300 dark:text-slate-600">
                                    <span className="text-xs font-bold text-slate-400 dark:text-slate-500">#{index + 1}</span>
                                    <span className="material-symbols-outlined text-[20px]">drag_indicator</span>
                                </div>
                                <div className="flex-1">
                                    <ActivePlanCard
                                        {...sub}
                                        dateLabel={t('plans.renew')}
                                        t={t}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}

                    {/* 过期订阅折叠区域 */}
                    {expiredSubscriptions.length > 0 && (
                        <div className="mt-6">
                            <button
                                onClick={() => setShowExpired(!showExpired)}
                                className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300 transition-colors"
                            >
                                <span className={`material-symbols-outlined text-[18px] transition-transform ${showExpired ? 'rotate-90' : ''}`}>
                                    chevron_right
                                </span>
                                {t('plans.expired_subs')} ({expiredSubscriptions.length})
                            </button>

                            {showExpired && (
                                <div className="mt-4 space-y-3">
                                    {expiredSubscriptions.map((sub) => (
                                        <div key={sub.id} className="ml-6">
                                            <ActivePlanCard
                                                {...sub}
                                                dateLabel={t('plans.status')}
                                                t={t}
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

const ActivePlanCard = ({ type, name, limit, used, percentage, date, dateLabel, color, isExpired, t }: any) => {
    // Dynamic styles
    const colors: any = {
        primary: { bar: 'bg-primary', glow: 'shadow-[0_0_15px_rgba(19,91,236,0.5)]', text: 'text-primary', bg: 'bg-primary/10' },
        purple: { bar: 'bg-purple-600', glow: 'shadow-[0_0_15px_rgba(147,51,234,0.5)]', text: 'text-purple-600', bg: 'bg-purple-600/10' },
        slate: { bar: 'bg-slate-500', glow: 'shadow-[0_0_15px_rgba(100,116,139,0.5)]', text: 'text-slate-500', bg: 'bg-slate-500/10' }
    };
    const c = colors[color] || colors.slate;

    return (
        <div className={`group bg-white dark:bg-dark-surface rounded-[2rem] p-8 border transition-all duration-500 ${isExpired ? 'border-slate-200 dark:border-dark-border opacity-70 grayscale' : 'border-slate-200 dark:border-dark-border shadow-lg hover:shadow-2xl hover:border-primary/20 hover:-translate-y-1'} select-none relative overflow-hidden`}>
            {!isExpired && (
                <div className={`absolute top-0 left-0 w-2 h-full ${c.bar}`}></div>
            )}
            
            <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-6 mb-8 relative z-10">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-3">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.2em] ${c.bg} ${c.text}`}>
                            {type}
                        </span>
                        {percentage >= 90 && !isExpired && (
                            <span className="px-3 py-1 rounded-full bg-red-100 text-red-600 text-[10px] font-black uppercase tracking-[0.2em]">
                                {t('plans.sub.low_quota')}
                            </span>
                        )}
                    </div>
                    <h4 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight leading-tight group-hover:text-primary transition-colors">{name}</h4>
                </div>
                <div className="flex flex-col sm:items-end bg-slate-50 dark:bg-[#1c2536] p-4 rounded-2xl border border-slate-100 dark:border-dark-border/50 shadow-inner min-w-[140px]">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{dateLabel}</span>
                    <span className="font-mono text-sm font-bold text-slate-900 dark:text-white">{date}</span>
                </div>
            </div>

            <div className="relative z-10">
                <div className="mb-4 flex justify-between items-end">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('plans.sub.usage')}</span>
                        <div className="flex items-baseline gap-1">
                            <span className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{used}</span>
                            <span className="text-slate-400 font-medium">/ {limit}</span>
                        </div>
                    </div>
                    <div className="text-right flex flex-col items-end">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('plans.sub.percentage')}</span>
                        <span className={`text-2xl font-black tracking-tighter ${percentage >= 90 ? 'text-red-500' : 'text-slate-900 dark:text-white'}`}>
                            {percentage}%
                        </span>
                    </div>
                </div>
                
                <div className="w-full h-4 bg-slate-100 dark:bg-[#111722] rounded-full overflow-hidden p-1 shadow-inner border border-slate-200/50 dark:border-dark-border">
                    <div 
                        className={`h-full rounded-full transition-all duration-1000 ease-out ${c.bar} ${!isExpired ? c.glow : ''}`} 
                        style={{ width: `${Math.min(percentage, 100)}%` }}
                    ></div>
                </div>
            </div>
        </div>
    )
}

const RechargeModal = ({
  onClose,
  t,
  payMethods,
  onTopUp,
  loading,
  userSummary,
  topUpHistory,
  enableCreem,
  creemProducts,
  quotaToDisplay,
  fmtCurrency,
  currencySymbol,
  priceRate,
  currencyRate,
}: any) => {
  const [amount, setAmount] = useState(100);
  const [method, setMethod] = useState('alipay');
  const [selectedCreemProductId, setSelectedCreemProductId] = useState('');

  const normalizedCreemProducts = React.useMemo(() => {
    if (!Array.isArray(creemProducts)) return [];
    return creemProducts.filter((p: any) => p?.productId);
  }, [creemProducts]);

  const thisMonthAmount = React.useMemo(() => {
    if (!topUpHistory || !Array.isArray(topUpHistory)) return 0;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
    return topUpHistory
      .filter((r: any) => r.status === 'success' && r.create_time >= monthStart)
      .reduce((sum: number, r: any) => sum + Number(r.money || 0), 0);
  }, [topUpHistory]);

  const walletBalance = quotaToDisplay(Number(userSummary?.quota || 0));

  const methodList = React.useMemo(() => {
    const methods = Array.isArray(payMethods) && payMethods.length > 0
      ? [...payMethods]
      : [];
    if (enableCreem && !methods.some((m: any) => m.type === 'creem')) {
      methods.push({ type: 'creem', name: 'Creem' });
    }
    return methods;
  }, [payMethods, enableCreem]);

  useEffect(() => {
    if (!methodList.length) return;
    if (!methodList.some((m: any) => m.type === method)) {
      setMethod(methodList[0].type);
    }
  }, [methodList, method]);

  useEffect(() => {
    if (method !== 'creem') return;
    if (!normalizedCreemProducts.length) return;
    if (!selectedCreemProductId) {
      const first = normalizedCreemProducts[0];
      setSelectedCreemProductId(first.productId);
      const firstPrice = Number(first.price || 0);
      if (Number.isFinite(firstPrice) && firstPrice > 0) {
        setAmount(firstPrice);
      }
    }
  }, [method, normalizedCreemProducts, selectedCreemProductId]);

  return (
    <div className="bg-white dark:bg-[#0f1115] w-full rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col md:flex-row border border-slate-200 dark:border-dark-border">
       {/* Left Side: Summary & Balance */}
       <div className="w-full md:w-1/3 bg-slate-50 dark:bg-[#161b22] p-10 border-r border-slate-100 dark:border-dark-border flex flex-col justify-between relative">
           <div className="absolute top-0 left-0 w-full h-1 bg-primary"></div>
           <div>
               <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">{t('plans.wallet.balance')}</h3>
               <div className="flex items-baseline gap-1 mb-2">
                   <span className="text-xl font-bold text-slate-400">{currencySymbol}</span>
                   <div className="text-5xl font-black text-slate-900 dark:text-white tracking-tighter">{walletBalance}</div>
               </div>
               <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 dark:bg-emerald-500/10 rounded-full text-[10px] text-emerald-600 dark:text-emerald-400 font-black uppercase tracking-widest">
                   <span className="material-symbols-outlined text-[14px]">trending_up</span>
                   + {currencySymbol}{thisMonthAmount.toFixed(2)} {t('plans.recharge.this_month')}
               </div>
           </div>
           
           <div className="mt-12 space-y-6">
               <div className="flex justify-between items-center text-sm font-medium">
                   <span className="text-slate-500">{t('plans.recharge.title')}</span>
                   <span className="text-slate-900 dark:text-white font-bold">{fmtCurrency((amount * currencyRate).toFixed(2))}</span>
               </div>
               <div className="flex justify-between items-center text-sm font-medium">
                   <span className="text-slate-500">{t('plans.recharge.fee')}</span>
                   <span className="text-slate-900 dark:text-white font-bold">{currencySymbol}0.00</span>
               </div>
               <div className="pt-6 border-t border-slate-200 dark:border-dark-border flex justify-between items-center">
                   <span className="text-xs font-black text-slate-400 uppercase tracking-widest">{t('plans.recharge.total')}</span>
                   <span className="font-black text-3xl text-primary tracking-tighter">{fmtCurrency((amount * currencyRate).toFixed(2))}</span>
               </div>
           </div>
       </div>

       {/* Right Side: Actions */}
       <div className="w-full md:w-2/3 p-10 relative">
           <div className="flex justify-between items-center mb-10">
               <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('plans.recharge.title')}</h2>
               <button onClick={onClose} className="w-10 h-10 rounded-full bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-all flex items-center justify-center active:scale-90">
                   <span className="material-symbols-outlined">close</span>
               </button>
           </div>

           {/* Amount Selection */}
           <div className="mb-10">
               <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">{t('plans.recharge.select_amount')}</label>
               <div className="grid grid-cols-3 gap-3 mb-6">
                   {[10, 25, 50, 100, 200, 500].map((val) => (
                       <button
                           key={val}
                           onClick={() => setAmount(val)}
                           className={`py-3 px-4 rounded-2xl text-sm font-bold border transition-all duration-300 ${
                               amount === val
                               ? 'border-primary bg-primary text-white shadow-lg shadow-primary/20'
                               : 'border-slate-100 dark:border-dark-border text-slate-600 dark:text-slate-400 hover:border-primary/50 bg-slate-50 dark:bg-slate-800/50'
                           }`}
                       >
                           {fmtCurrency(currencyRate > 1 ? (val * currencyRate).toFixed(0) : val)}
                       </button>
                   ))}
               </div>
               <div className="relative group">
                   <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">{currencySymbol}</span>
                   <input
                        type="number"
                        placeholder={t('plans.recharge.custom_amount')}
                        className="w-full pl-10 pr-6 py-4 bg-slate-50 dark:bg-dark-surface border border-slate-100 dark:border-dark-border rounded-2xl text-sm font-bold focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all dark:text-white shadow-inner"
                        onChange={(e) => setAmount(Number(e.target.value))}
                   />
               </div>
           </div>

           {/* Payment Method */}
           <div className="mb-10">
               <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">{t('plans.recharge.method')}</label>
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                   {methodList.map((item: any) => (
                    <div
                        key={item.type}
                        onClick={() => setMethod(item.type)}
                        className={`flex items-center gap-4 p-4 rounded-2xl border cursor-pointer transition-all duration-300 ${
                            method === item.type ? 'border-primary bg-primary/5 shadow-md shadow-primary/5' : 'border-slate-100 dark:border-dark-border hover:border-slate-300 dark:hover:border-slate-600 bg-slate-50/50 dark:bg-slate-800/30'
                        }`}
                    >
                        <div className={`w-12 h-10 rounded-xl flex items-center justify-center transition-colors ${
                            method === item.type ? 'bg-primary text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                        }`}>
                            <span className="material-symbols-outlined text-[20px]">payments</span>
                        </div>
                        <div className="flex-1">
                            <div className={`text-xs font-black uppercase tracking-wider ${method === item.type ? 'text-primary' : 'text-slate-900 dark:text-white'}`}>{item.name || item.type}</div>
                            <div className="text-[10px] font-bold text-slate-400">{item.type}</div>
                        </div>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${method === item.type ? 'border-primary bg-primary' : 'border-slate-300 dark:border-slate-600'}`}>
                            {method === item.type && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
                        </div>
                   </div>
                   ))}
               </div>
           </div>

           <button
               onClick={() => onTopUp(amount, method, selectedCreemProductId)}
               disabled={
                 loading ||
                 amount <= 0 ||
                 methodList.length === 0 ||
                 (method === 'creem' &&
                   normalizedCreemProducts.length > 0 &&
                   !selectedCreemProductId)
               }
               className="w-full py-5 rounded-[2rem] bg-primary hover:bg-primary-hover text-white font-black text-xs uppercase tracking-[0.2em] shadow-[0_20px_40px_-10px_rgba(19,91,236,0.3)] transition-all active:scale-[0.98] flex items-center justify-center gap-3 disabled:opacity-50 relative overflow-hidden group/btn"
           >
               <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover/btn:translate-x-full duration-1000 transition-transform"></div>
               <span className="material-symbols-outlined text-[18px]">verified_user</span>
               {loading ? t('plans.processing') : t('plans.recharge.confirm')}
           </button>
       </div>
    </div>
  )
}

const HistoryModal = ({ onClose, t, records, currencySymbol }: any) => {
    return (
        <div className="bg-white dark:bg-[#0f1115] w-full rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] border border-slate-200 dark:border-dark-border">
            <div className="flex justify-between items-center p-10 border-b border-slate-100 dark:border-dark-border">
               <div>
                   <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('plans.history.title')}</h2>
                   <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">{t('plans.history.subtitle') || 'Recent Wallet Transactions'}</p>
               </div>
               <button onClick={onClose} className="w-12 h-12 rounded-full bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-all flex items-center justify-center active:scale-90">
                   <span className="material-symbols-outlined">close</span>
               </button>
           </div>
           
           <div className="overflow-y-auto flex-1 p-0 custom-scrollbar">
               <table className="w-full text-left border-collapse">
                   <thead>
                       <tr className="bg-slate-50/50 dark:bg-slate-800/30">
                           <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{t('plans.history.id')}</th>
                           <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{t('plans.history.type')}</th>
                           <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{t('plans.history.amount')}</th>
                           <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{t('plans.history.date')}</th>
                           <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{t('plans.history.status')}</th>
                           <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] text-right">{t('plans.history.invoice')}</th>
                       </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-50 dark:divide-dark-border/50">
                       {(records || []).map((tx: any) => (
                           <tr key={tx.id} className="group hover:bg-slate-50 dark:hover:bg-primary/5 transition-all duration-300">
                               <td className="px-8 py-6">
                                   <div className="flex items-center gap-3">
                                       <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-400 group-hover:bg-primary/10 group-hover:text-primary transition-colors">ID</div>
                                       <span className="text-xs font-mono font-bold text-slate-500 dark:text-slate-400">{tx.trade_no || tx.id}</span>
                                   </div>
                               </td>
                               <td className="px-8 py-6">
                                   <div className="flex flex-col">
                                       <span className="text-sm font-black text-slate-900 dark:text-white tracking-tight">
                                           {t('plans.history.type.recharge')}
                                       </span>
                                       <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{tx.payment_method || '-'}</span>
                                   </div>
                               </td>
                               <td className="px-8 py-6">
                                   <span className="text-lg font-black font-mono text-emerald-500 tracking-tighter">
                                       +{currencySymbol}{Number(tx.money || 0).toFixed(2)}
                                   </span>
                               </td>
                               <td className="px-8 py-6">
                                   <div className="flex flex-col">
                                       <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{tx.create_time ? new Date(tx.create_time * 1000).toLocaleDateString() : '-'}</span>
                                       <span className="text-[10px] font-medium text-slate-400">{tx.create_time ? new Date(tx.create_time * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-'}</span>
                                   </div>
                               </td>
                               <td className="px-8 py-6">
                                   <span className={`inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                                       tx.status === 'success'
                                         ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                         : tx.status === 'pending'
                                           ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                           : 'bg-slate-500/10 text-slate-600 dark:text-slate-400'
                                   }`}>
                                       {tx.status || '-'}
                                   </span>
                               </td>
                               <td className="px-8 py-6 text-right">
                                   <button className="w-10 h-10 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-primary hover:bg-primary/10 transition-all flex items-center justify-center ml-auto active:scale-90">
                                       <span className="material-symbols-outlined text-[20px]">download</span>
                                   </button>
                               </td>
                           </tr>
                       ))}
                       {(!records || records.length === 0) && (
                           <tr>
                               <td className="px-8 py-20 text-sm text-slate-500 dark:text-slate-400 text-center font-bold" colSpan={6}>
                                   <div className="flex flex-col items-center gap-4">
                                       <span className="material-symbols-outlined text-4xl text-slate-200 dark:text-slate-800">receipt_long</span>
                                       {t('plans.no_history')}
                                   </div>
                               </td>
                           </tr>
                       )}
                   </tbody>
               </table>
           </div>
           
           <div className="p-8 border-t border-slate-100 dark:border-dark-border bg-slate-50/50 dark:bg-slate-800/20 flex justify-center">
               <button className="px-6 py-2 rounded-full text-xs font-black uppercase tracking-widest text-primary hover:bg-primary/5 transition-all">{t('plans.view_all_tx')}</button>
           </div>
        </div>
    )
}

const MarketplaceTab = ({ t, plans, loading, error, onSubscribe, subscribingPlanId, quotaToDisplay, fmtCurrency, planPurchaseCountMap }: any) => {
    // Categorize plans
    const categories = React.useMemo(() => {
        if (!plans) return { monthly: [], yearly: [], flexible: [], other: [] };
        
        const groups: { monthly: any[], yearly: any[], flexible: any[], other: any[] } = {
            monthly: [],
            yearly: [],
            flexible: [],
            other: []
        };

        plans.forEach((plan: SubscriptionPlan) => {
            const unit = plan.duration_unit;
            const val = plan.duration_value;

            if (unit === 'month' && val === 1) {
                groups.monthly.push(plan);
            } else if (unit === 'year' || (unit === 'month' && val >= 12)) {
                groups.yearly.push(plan);
            } else if (unit === 'day' || unit === 'week' || unit === 'hour') {
                groups.flexible.push(plan);
            } else {
                groups.other.push(plan);
            }
        });

        // Sort each group by price
        Object.values(groups).forEach(group => group.sort((a, b) => a.price_amount - b.price_amount));
        
        return groups;
    }, [plans]);

    if (loading) {
        return (
            <div className="flex flex-col justify-center items-center py-32 space-y-4">
                <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                <div className="text-slate-500 dark:text-slate-400 font-bold tracking-widest uppercase text-xs animate-pulse">{t('plans.loading')}</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex justify-center items-center py-20">
                <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-6 py-4 rounded-2xl border border-red-100 dark:border-red-900/30 font-bold">{error}</div>
            </div>
        );
    }

    const formatDuration = (unit: string, value: number) => {
        const unitMap: Record<string, string> = {
            'day': t('plans.card.day'),
            'month': t('plans.card.month'),
            'year': t('plans.duration.year'),
            'hour': t('plans.duration.hour'),
        };
        return `${value} ${unitMap[unit] || unit}`;
    };

    const formatResetPeriod = (period: string) => {
        const periodMap: Record<string, string> = {
            'daily': t('plans.card.every_day'),
            'weekly': t('plans.reset.weekly'),
            'monthly': t('plans.reset.monthly'),
            'never': t('plans.reset.never'),
        };
        return periodMap[period] || period;
    };

    const formatQuotaLimit = (totalAmount: number) => {
        if (totalAmount === 0) return t('plans.no_limit');
        return fmtCurrency(quotaToDisplay(totalAmount));
    };

    const renderSection = (title: string, subtitle: string, plans: any[], theme: 'blue' | 'gold' | 'emerald' | 'slate') => {
        if (plans.length === 0) return null;

        return (
            <div className="w-full mb-24">
                <div className="flex flex-col mb-10 border-l-4 border-primary/20 pl-6">
                    <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{title}</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 font-medium mt-1 uppercase tracking-widest">{subtitle}</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
                    {plans.map((plan: any, idx: number) => (
                        <MarketCard
                            key={plan.id}
                            planId={plan.id}
                            title={plan.title}
                            subtitle={plan.subtitle}
                            price={plan.price_amount.toFixed(2)}
                            currency={plan.currency === 'USD' ? '$' : '¥'}
                            theme={theme}
                            features={[
                                { icon: 'calendar_today', label: t('plans.card.validity'), value: formatDuration(plan.duration_unit, plan.duration_value) },
                                { icon: 'history', label: t('plans.card.reset'), value: formatResetPeriod(plan.quota_reset_period) },
                                { icon: 'speed', label: t('plans.card.limit'), value: formatQuotaLimit(plan.total_amount) }
                            ]}
                            t={t}
                            onSubscribe={() => onSubscribe(plan)}
                            loading={subscribingPlanId === plan.id}
                            purchaseCount={planPurchaseCountMap.get(plan.id) || 0}
                            maxPurchase={plan.max_purchase_per_user}
                            isPopular={theme === 'blue' && idx === 0}
                        />
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col items-center w-full pb-20">
             <div className="text-center max-w-2xl mb-24 relative">
                <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-40 h-40 bg-primary/10 rounded-full blur-3xl -z-10 animate-pulse"></div>
                <h2 className="text-6xl font-black tracking-tighter mb-6 text-slate-900 dark:text-white leading-tight">
                    {t('plans.market.title')}
                </h2>
                <p className="text-xl text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                    {t('plans.market.subtitle')}
                </p>
            </div>

            <div className="w-full max-w-7xl">
                {renderSection(t('plans.market.monthly') || 'Monthly Pass', t('plans.market.monthly_desc') || 'The most popular choice for professionals', categories.monthly, 'blue')}
                {renderSection(t('plans.market.yearly') || 'Yearly Membership', t('plans.market.yearly_desc') || 'Maximum savings for power users', categories.yearly, 'gold')}
                {renderSection(t('plans.market.flexible') || 'Flexible Access', t('plans.market.flexible_desc') || 'Trial and light usage solutions', categories.flexible, 'emerald')}
                {renderSection(t('plans.market.other') || 'Other Solutions', t('plans.market.other_desc') || 'Special customized plans', categories.other, 'slate')}
                
                {plans.length === 0 && (
                    <div className="flex flex-col justify-center items-center py-32 space-y-4 bg-white dark:bg-dark-surface rounded-[3rem] border border-slate-200 dark:border-dark-border shadow-inner w-full">
                        <span className="material-symbols-outlined text-6xl text-slate-200 dark:text-slate-700">inventory_2</span>
                        <div className="text-slate-500 dark:text-slate-400 font-bold">{t('plans.no_plans')}</div>
                    </div>
                )}
            </div>
        </div>
    )
}

const MarketCard = ({ title, subtitle, price, currency, features, theme, t, onSubscribe, loading, purchaseCount, maxPurchase, isPopular }: any) => {
    const reachedLimit = maxPurchase > 0 && purchaseCount >= maxPurchase;

    const themeStyles: any = {
        blue: {
            border: 'border-primary/20',
            bg: 'bg-primary/[0.02]',
            accent: 'text-primary',
            btn: 'bg-primary text-white shadow-primary/30',
            icon: 'bg-primary/10 text-primary',
            badge: 'bg-primary text-white'
        },
        gold: {
            border: 'border-amber-500/30',
            bg: 'bg-amber-500/[0.03] dark:bg-amber-500/[0.05]',
            accent: 'text-amber-600 dark:text-amber-500',
            btn: 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/30',
            icon: 'bg-amber-500/10 text-amber-600',
            badge: 'bg-amber-500 text-white',
            highlight: 'shadow-[0_20px_50px_-12px_rgba(245,158,11,0.2)]'
        },
        emerald: {
            border: 'border-emerald-500/20',
            bg: 'bg-emerald-500/[0.02]',
            accent: 'text-emerald-600',
            btn: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/30',
            icon: 'bg-emerald-500/10 text-emerald-600',
            badge: 'bg-emerald-500 text-white'
        },
        slate: {
            border: 'border-slate-300 dark:border-dark-border',
            bg: 'bg-white dark:bg-dark-surface',
            accent: 'text-slate-900 dark:text-white',
            btn: 'bg-slate-900 dark:bg-white text-white dark:text-slate-900',
            icon: 'bg-slate-100 dark:bg-slate-800 text-slate-400',
            badge: 'bg-slate-500 text-white'
        }
    };

    const s = themeStyles[theme] || themeStyles.slate;

    return (
        <div className={`flex flex-col p-10 rounded-[3rem] border transition-all duration-500 group relative ${s.border} ${s.bg} ${isPopular || theme === 'gold' ? (s.highlight || 'shadow-2xl scale-105 z-10 border-primary/40') : 'hover:shadow-2xl hover:border-primary/30'} ${theme === 'gold' ? 'scale-105 z-10' : ''}`}>
            {(isPopular || theme === 'gold') && (
                <div className={`absolute -top-5 left-1/2 -translate-x-1/2 px-6 py-2 ${s.badge} text-[10px] font-black uppercase tracking-[0.2em] rounded-full shadow-lg z-20`}>
                    {theme === 'gold' ? (t('plans.card.best_value') || 'Best Value') : (t('plans.card.popular') || 'Popular')}
                </div>
            )}
            
            <div className="mb-10">
                <h3 className={`text-2xl font-black mb-3 tracking-tight group-hover:${s.accent} transition-colors ${theme === 'gold' ? s.accent : 'text-slate-900 dark:text-white'}`}>{title}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 font-medium leading-relaxed line-clamp-2">{subtitle}</p>
            </div>
            
            <div className="flex items-baseline gap-2 mb-12">
                <span className="text-3xl font-bold text-slate-400">{currency}</span>
                <span className={`text-7xl font-black tracking-tighter drop-shadow-sm ${theme === 'gold' ? s.accent : 'text-slate-900 dark:text-white'}`}>{price}</span>
                <span className="text-slate-400 font-bold uppercase tracking-widest text-[10px] ml-2">/ {t('plans.card.period')}</span>
            </div>

            <div className="space-y-6 mb-12 flex-1">
                {features.map((f: any, i: number) => (
                    <div key={i} className="flex items-center gap-4 group/item">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 ${s.icon} group-hover/item:scale-110`}>
                            <span className="material-symbols-outlined text-[20px]">{f.icon}</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{f.label}</span>
                            <span className="text-sm font-bold text-slate-900 dark:text-white">{f.value}</span>
                        </div>
                    </div>
                ))}
            </div>

            <button
                onClick={onSubscribe}
                disabled={loading || reachedLimit}
                className={`w-full py-5 rounded-[2rem] font-black text-[10px] uppercase tracking-[0.2em] transition-all duration-300 relative overflow-hidden group/btn ${
                    reachedLimit
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-200 dark:border-dark-border'
                        : `${s.btn} hover:shadow-xl active:scale-95`
                }`}
            >
                {!reachedLimit && !loading && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover/btn:translate-x-full duration-1000 transition-transform"></div>
                )}
                {reachedLimit
                    ? t('plans.card.reached_limit')
                    : loading
                        ? t('plans.processing')
                        : t('plans.card.subscribe')
                }
            </button>
        </div>
    )
}

const SubscriptionPurchaseModal = ({ plan, onClose, onPay, t, payMethods, loading, planPurchaseCountMap }: any) => {
  const [selectedMethod, setSelectedMethod] = useState('');
  const purchaseCount = planPurchaseCountMap?.get(plan.id) || 0;
  const reachedLimit = plan.max_purchase_per_user > 0 && purchaseCount >= plan.max_purchase_per_user;

  const availableMethods: Array<{type: string; name: string}> = [];
  if (plan.stripe_price_id) {
    availableMethods.push({ type: 'stripe', name: 'Stripe' });
  }
  if (plan.creem_product_id) {
    availableMethods.push({ type: 'creem', name: 'Creem' });
  }
  if (Array.isArray(payMethods)) {
    payMethods.filter((m: any) => m?.type && m.type !== 'stripe' && m.type !== 'creem').forEach((m: any) => {
      availableMethods.push({ type: m.type, name: m.name || m.type });
    });
  }

  useEffect(() => {
    if (availableMethods.length > 0 && !selectedMethod) {
      setSelectedMethod(availableMethods[0].type);
    }
  }, [availableMethods, selectedMethod]);

  return (
    <div className="bg-white dark:bg-[#0f1115] rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-200 dark:border-dark-border">
      <div className="p-10 border-b border-slate-100 dark:border-dark-border relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-primary"></div>
        <div className="flex justify-between items-center relative z-10">
          <div>
              <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('plans.sub_purchase.title')}</h2>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">{t('plans.sub_purchase.subtitle') || 'Review your subscription'}</p>
          </div>
          <button onClick={onClose} className="w-12 h-12 rounded-full bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-all flex items-center justify-center active:scale-90">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>

      <div className="p-10">
        <div className="bg-slate-50 dark:bg-[#161b22] rounded-[2rem] p-8 mb-10 border border-slate-100 dark:border-dark-border shadow-inner group">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 group-hover:text-primary transition-colors">{plan.title}</div>
          <div className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">
            {plan.currency === 'USD' ? '$' : '¥'}{plan.price_amount.toFixed(2)}
          </div>
        </div>

        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">{t('plans.sub_purchase.select_method')}</label>
        <div className="grid grid-cols-1 gap-4 mb-10">
          {availableMethods.map((m) => (
            <div
              key={m.type}
              onClick={() => setSelectedMethod(m.type)}
              className={`flex items-center gap-4 p-5 rounded-2xl border cursor-pointer transition-all duration-300 ${
                selectedMethod === m.type ? 'border-primary bg-primary/5 shadow-md shadow-primary/5' : 'border-slate-100 dark:border-dark-border hover:border-slate-300 dark:hover:border-slate-600 bg-slate-50/50 dark:bg-slate-800/30'
              }`}
            >
              <div className={`w-12 h-10 rounded-xl flex items-center justify-center transition-colors ${
                  selectedMethod === m.type ? 'bg-primary text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
              }`}>
                <span className="material-symbols-outlined text-[20px]">payments</span>
              </div>
              <div className="flex-1">
                <div className={`text-xs font-black uppercase tracking-wider ${selectedMethod === m.type ? 'text-primary' : 'text-slate-900 dark:text-white'}`}>{m.name}</div>
                <div className="text-[10px] font-bold text-slate-400">{m.type}</div>
              </div>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${selectedMethod === m.type ? 'border-primary bg-primary' : 'border-slate-300 dark:border-slate-600'}`}>
                {selectedMethod === m.type && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
              </div>
            </div>
          ))}
          {availableMethods.length === 0 && (
            <div className="text-center py-10 text-xs font-bold text-slate-400 uppercase tracking-widest bg-slate-50 dark:bg-slate-800/50 rounded-2xl border-2 border-dashed border-slate-200 dark:border-dark-border">{t('plans.error.no_method')}</div>
          )}
        </div>

        <button
          onClick={() => onPay(selectedMethod)}
          disabled={loading || !selectedMethod || reachedLimit}
          className={`w-full py-5 rounded-[2rem] font-black text-xs uppercase tracking-[0.2em] shadow-[0_20px_40px_-10px_rgba(19,91,236,0.3)] transition-all active:scale-[0.98] flex items-center justify-center gap-3 disabled:opacity-50 relative overflow-hidden group/btn ${
            reachedLimit
              ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
              : 'bg-primary text-white'
          }`}
        >
          {!reachedLimit && !loading && (
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover/btn:translate-x-full duration-1000 transition-transform"></div>
          )}
          <span className="material-symbols-outlined text-[18px]">{reachedLimit ? 'block' : 'lock_open'}</span>
          {reachedLimit
            ? t('plans.card.reached_limit')
            : loading
              ? t('plans.processing')
              : t('plans.sub_purchase.confirm')
          }
        </button>
      </div>
    </div>
  );
};

const TransferModal = ({ onClose, t, affQuota, onTransfer, loading, quotaToDisplay, fmtCurrency, currencySymbol, quotaPerUnit, currencyRate }: any) => {
  const maxAmount = affQuota || 0;
  const maxDisplay = Number(quotaToDisplay(maxAmount));
  const [amount, setAmount] = useState(maxDisplay);

  return (
    <div className="bg-white dark:bg-[#0f1115] rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-200 dark:border-dark-border">
      <div className="p-10 border-b border-slate-100 dark:border-dark-border relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
        <div className="flex justify-between items-center relative z-10">
          <div>
              <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('plans.invite.transfer_title')}</h2>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">{t('plans.invite.transfer_subtitle') || 'Move rewards to your wallet'}</p>
          </div>
          <button onClick={onClose} className="w-12 h-12 rounded-full bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-all flex items-center justify-center active:scale-90">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      <div className="p-10">
        <div className="mb-8">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">{t('plans.invite.available')}</label>
          <div className="text-4xl font-black text-emerald-500 tracking-tighter shadow-emerald-500/10 drop-shadow-sm">{fmtCurrency(maxDisplay.toFixed(2))}</div>
        </div>
        <div className="mb-10">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">{t('plans.invite.transfer_amount')}</label>
          <div className="relative group">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">{currencySymbol}</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Math.min(Number(e.target.value), maxDisplay))}
              min={0}
              max={maxDisplay}
              step={0.01}
              className="w-full pl-10 pr-6 py-4 bg-slate-50 dark:bg-dark-surface border border-slate-100 dark:border-dark-border rounded-2xl text-sm font-bold focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none transition-all dark:text-white shadow-inner"
            />
          </div>
        </div>
        <button
          onClick={() => onTransfer(Math.floor(amount / currencyRate * quotaPerUnit))}
          disabled={loading || amount <= 0 || amount > maxDisplay}
          className="w-full py-5 rounded-[2rem] bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-[0.2em] shadow-[0_20px_40px_-10px_rgba(16,185,129,0.3)] transition-all active:scale-[0.98] disabled:opacity-50 relative overflow-hidden group/btn"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover/btn:translate-x-full duration-1000 transition-transform"></div>
          {loading ? t('plans.processing') : t('plans.invite.confirm_transfer')}
        </button>
      </div>
    </div>
  );
};

export default Plans;
