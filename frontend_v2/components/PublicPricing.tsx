import React, { useEffect, useState } from 'react';
import { API } from '../lib/api';
import { useTranslation } from '../lib/i18n';

interface SubscriptionPlan {
  id: number;
  title: string;
  subtitle: string;
  price_amount: number;
  currency: string;
  duration_unit: string;
  duration_value: number;
  total_amount: number;
}

interface PricingModel {
  model_name: string;
  model_ratio: number;
  model_price: number;
  quota_type: number;
  completion_ratio: number;
  owner_by: string;
}

interface PublicPricingProps {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  onBack: () => void;
  onLogin: () => void;
  onRegister: () => void;
  onPricing: () => void;
  onPrivacy: () => void;
  onTerms: () => void;
  onRefund: () => void;
}

const formatUSD = (v: number) => `$${v.toFixed(v >= 1 ? 4 : 6)}`;

const PublicPricing: React.FC<PublicPricingProps> = ({ theme, toggleTheme, onBack, onLogin, onRegister, onPricing, onPrivacy, onTerms, onRefund }) => {
  const { t, language, setLanguage } = useTranslation();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [models, setModels] = useState<PricingModel[]>([]);
  const [search, setSearch] = useState('');
  const [selectedVendor, setSelectedVendor] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      API.get('/api/subscription/plans'),
      API.get('/api/pricing'),
    ]).then(([plansRes, pricingRes]) => {
      if (plansRes.data?.success && Array.isArray(plansRes.data.data)) {
        setPlans(plansRes.data.data.filter((p: any) => p.enabled));
      }
      if (pricingRes.data?.success && Array.isArray(pricingRes.data.data)) {
        setModels(pricingRes.data.data);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const durationLabel = (p: SubscriptionPlan) => {
    const units: Record<string, [string, string]> = { day: ['天', 'day'], month: ['月', 'mo'], year: ['年', 'yr'] };
    const [zh, en] = units[p.duration_unit] || [p.duration_unit, p.duration_unit];
    return `${p.duration_value} ${language === 'zh' ? zh : en}`;
  };

  const vendors = Array.from(new Set(models.map(m => m.owner_by))).sort();
  const filtered = models.filter(m => {
    const matchSearch = !search || m.model_name.toLowerCase().includes(search.toLowerCase()) || m.owner_by.toLowerCase().includes(search.toLowerCase());
    const matchVendor = !selectedVendor || m.owner_by === selectedVendor;
    return matchSearch && matchVendor;
  });

  return (
    <div className="min-h-screen bg-[#f6f8fb] dark:bg-[#0b1220] text-slate-900 dark:text-slate-100" style={{ fontFamily: '"Space Grotesk","Inter",sans-serif' }}>
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/85 dark:bg-[#0b1220]/80 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white flex items-center justify-center shadow-lg">
              <span className="material-symbols-outlined text-[20px]">hub</span>
            </div>
            <div>
              <div className="font-bold leading-none">CaMeL AI</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">CaMeL AI Platform</div>
            </div>
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')} className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
              {language === 'zh' ? 'EN' : '中文'}
            </button>
            <button onClick={toggleTheme} className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button onClick={onLogin} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              {t('public.login')}
            </button>
            <button onClick={onRegister} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors">
              {t('public.register')}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12 space-y-12">
        {loading ? (
          <div className="flex justify-center py-20">
            <span className="material-symbols-outlined animate-spin text-3xl text-slate-400">progress_activity</span>
          </div>
        ) : (
          <>
            {/* Subscription Plans */}
            {plans.length > 0 && (
              <section>
                <h2 className="text-2xl font-black mb-6">{t('pricing.title')}</h2>
                <div className="grid md:grid-cols-3 gap-4">
                  {plans.map(p => (
                    <div key={p.id} className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1a2b] flex flex-col">
                      <h3 className="font-bold text-lg">{p.title}</h3>
                      {p.subtitle && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{p.subtitle}</p>}
                      <div className="mt-4 flex items-baseline gap-1">
                        <span className="text-3xl font-black">{p.currency === 'cny' ? '¥' : '$'}{(p.price_amount / 100).toFixed(2)}</span>
                        <span className="text-sm text-slate-500">/ {durationLabel(p)}</span>
                      </div>
                      {p.total_amount > 0 && (
                        <p className="text-xs text-slate-400 mt-1">{t('pricing.includes')} {p.total_amount.toLocaleString()} {t('pricing.quota')}</p>
                      )}
                      <button onClick={onRegister} className="mt-auto pt-4">
                        <span className="block w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold text-center transition-colors">
                          {t('pricing.signup')}
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Model Pricing Table */}
            <section>
              <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
                <h2 className="text-2xl font-black">{t('pricing.models_title')}</h2>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={t('pricing.search')}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0f1a2b] text-sm w-64 outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  onClick={() => setSelectedVendor('')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${!selectedVendor ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                >
                  {t('pricing.all')} ({models.length})
                </button>
                {vendors.map(v => {
                  const count = models.filter(m => m.owner_by === v).length;
                  return (
                    <button
                      key={v}
                      onClick={() => setSelectedVendor(v === selectedVendor ? '' : v)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${selectedVendor === v ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                    >
                      {v} ({count})
                    </button>
                  );
                })}
              </div>
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1a2b] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
                        <th className="text-left px-4 py-3 font-semibold">{t('pricing.table.model')}</th>
                        <th className="text-left px-4 py-3 font-semibold">{t('pricing.table.vendor')}</th>
                        <th className="text-left px-4 py-3 font-semibold">{t('pricing.table.type')}</th>
                        <th className="text-right px-4 py-3 font-semibold">{t('pricing.table.input')}</th>
                        <th className="text-right px-4 py-3 font-semibold">{t('pricing.table.output')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(m => {
                        const isToken = m.quota_type === 0;
                        const input = isToken ? formatUSD(m.model_ratio * 2) + ' /1M' : formatUSD(m.model_price / 500000 * 1000) + ' /1K';
                        const output = isToken ? formatUSD(m.model_ratio * 2 * m.completion_ratio) + ' /1M' : '-';
                        return (
                          <tr key={m.model_name} className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-900/30">
                            <td className="px-4 py-3 font-mono text-xs">{m.model_name}</td>
                            <td className="px-4 py-3 text-slate-500">{m.owner_by}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${isToken ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'}`}>
                                {isToken ? 'Token' : t('pricing.per_call')}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs">{input}</td>
                            <td className="px-4 py-3 text-right font-mono text-xs">{output}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {filtered.length === 0 && (
                  <div className="px-4 py-8 text-center text-slate-400">{t('pricing.no_match')}</div>
                )}
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-[#0b1220]/50">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-wrap items-center justify-between gap-4">
          <span className="text-xs text-slate-400">&copy; {new Date().getFullYear()} CaMeL AI</span>
          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span>联系邮箱: <a href="mailto:support@kr777.top" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">support@kr777.top</a></span>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <span>QQ群号: 1080898797</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
            <button onClick={onPrivacy} className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{t('public.footer.privacy')}</button>
            <button onClick={onTerms} className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{t('public.footer.terms')}</button>
            <button onClick={onRefund} className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{t('public.footer.refund')}</button>
            <button onClick={onPricing} className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{t('public.footer.pricing')}</button>
          </div>
        </div>
        <div className="text-center pb-4 text-xs text-slate-400 dark:text-slate-500">
          沪ICP备2022024740号-4
        </div>
      </footer>
    </div>
  );
};

export default PublicPricing;
