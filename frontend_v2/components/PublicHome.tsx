import React, { useEffect, useMemo, useState } from 'react';
import { API } from '../lib/api';
import { useTranslation } from '../lib/i18n';

interface PublicHomeProps {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  onLogin: () => void;
  onRegister: () => void;
  onPricing: () => void;
  onPrivacy: () => void;
  onTerms: () => void;
  onRefund: () => void;
}

interface StatusData {
  system_name?: string;
  version?: string;
  start_time?: number;
  docs_link?: string;
  uptime_kuma_enabled?: boolean;
}

interface UptimeHeartbeat {
  status: number;
  time: string;
}

interface UptimeMonitor {
  name: string;
  uptime: number;
  uptime_7d: number;
  status: number;
  group?: string;
  heartbeats: UptimeHeartbeat[];
}

interface UptimeGroup {
  categoryName: string;
  monitors: UptimeMonitor[];
}

const PublicHome: React.FC<PublicHomeProps> = ({ theme, toggleTheme, onLogin, onRegister, onPricing, onPrivacy, onTerms, onRefund }) => {
  const { t, language, setLanguage } = useTranslation();

  const toggleLanguage = () => {
    setLanguage(language === 'zh' ? 'en' : 'zh');
  };

  const [status, setStatus] = useState<StatusData>({});
  const [planCount, setPlanCount] = useState(0);
  const [modelCount, setModelCount] = useState(0);
  const [vendorCount, setVendorCount] = useState(0);
  const [uptimeData, setUptimeData] = useState<UptimeGroup[]>([]);
  const [uptimeLoading, setUptimeLoading] = useState(false);

  useEffect(() => {
    const fetchPublicData = async () => {
      try {
        const [statusRes, plansRes, pricingRes] = await Promise.all([
          API.get('/api/status'),
          API.get('/api/subscription/plans'),
          API.get('/api/pricing'),
        ]);

        if (statusRes.data?.success) {
          setStatus(statusRes.data?.data || {});
        }

        if (plansRes.data?.success && Array.isArray(plansRes.data?.data)) {
          setPlanCount(plansRes.data.data.length);
        }

        if (pricingRes.data?.success) {
          const pricingItems = Array.isArray(pricingRes.data?.data) ? pricingRes.data.data : [];
          setModelCount(pricingItems.length);

          const vendorSet = new Set<string>();
          pricingItems.forEach((item: any) => {
            if (item?.owner_by) vendorSet.add(item.owner_by);
          });
          if (Array.isArray(pricingRes.data?.vendors)) {
            pricingRes.data.vendors.forEach((v: any) => {
              if (v?.name) vendorSet.add(v.name);
            });
          }
          setVendorCount(vendorSet.size);
        }
      } catch (error) {
        console.error('Failed to fetch public homepage data:', error);
      }
    };

    fetchPublicData();
  }, []);

  useEffect(() => {
    if (!status.uptime_kuma_enabled) return;
    const fetchUptime = async () => {
      setUptimeLoading(true);
      try {
        const res = await API.get('/api/uptime/status' + (language !== 'zh' ? `?lang=${language}` : ''));
        if (res.data?.success && Array.isArray(res.data?.data)) {
          setUptimeData(res.data.data);
        }
      } catch (e) {
        console.error('Failed to fetch uptime data:', e);
      } finally {
        setUptimeLoading(false);
      }
    };
    fetchUptime();
  }, [status.uptime_kuma_enabled, language]);

  const uptimeDays = useMemo(() => {
    const now = Date.now();
    const start = new Date('2026-02-04T00:00:00+08:00').getTime();
    return Math.max(0, Math.floor((now - start) / (1000 * 60 * 60 * 24)));
  }, []);

  const calculateUptimeFromHeartbeats = (heartbeats: UptimeHeartbeat[]): number => {
    if (!heartbeats || heartbeats.length === 0) return 0;
    const now = Date.now();
    const since = new Date('2026-02-04T00:00:00+08:00').getTime();
    const recentHeartbeats = heartbeats.filter(hb => new Date(hb.time).getTime() >= since);
    if (recentHeartbeats.length === 0) return 0;
    const upCount = recentHeartbeats.filter(hb => hb.status === 1).length;
    return upCount / recentHeartbeats.length;
  };

  const allMonitors = useMemo(() => uptimeData.flatMap(g => g.monitors), [uptimeData]);
  const overallUptime = useMemo(() => {
    if (allMonitors.length === 0) return 0;
    return allMonitors.reduce((sum, m) => sum + calculateUptimeFromHeartbeats(m.heartbeats), 0) / allMonitors.length * 100;
  }, [allMonitors]);

  const text = {
    systemName: status.system_name || 'CaMeL AI',
    heroTitle: t('public.hero_title'),
    heroSubtitle: t('public.hero_desc'),
    ctaPrimary: t('public.enter_console'),
    ctaSecondary: t('public.create_account'),
    docs: t('public.read_docs'),
    section1: t('public.features_title'),
    section2: t('public.flow_title'),
    section3: t('public.coverage_title'),
    quote: t('public.quote.content'),
    quoteAuthor: t('public.quote.author'),
    cooperation: t('public.coop_labs'),
    cards: [
      {
        title: t('public.feature.gateway'),
        desc: t('public.feature.gateway_desc'),
      },
      {
        title: t('public.feature.billing'),
        desc: t('public.feature.billing_desc'),
      },
      {
        title: t('public.feature.ops'),
        desc: t('public.feature.ops_desc'),
      },
    ],
    flow: [
      t('public.flow.step1'),
      t('public.flow.step2'),
      t('public.flow.step3'),
      t('public.flow.step4'),
    ],
    modulesTitle: t('public.no_feature_loss'),
    modules: [
      t('public.module.channel'),
      t('public.module.token'),
      t('public.module.wallet'),
      t('public.module.message'),
    ],
    footer: t('public.sign_in_hint'),
  };

  const statusColorMap: Record<number, string> = {
    1: '#10b981',  // green - up
    0: '#ef4444',  // red - down
    2: '#f59e0b',  // amber - degraded
    3: '#3b82f6',  // blue - maintenance
  };

  const statusDotColor = (s: number) => statusColorMap[s] || '#94a3b8';

  interface Bucket { status: number; start: number; end: number }
  const processHeartbeats = (heartbeats: UptimeHeartbeat[], hours: number = 168): Bucket[] => {
    const segments = 90;
    const now = Date.now();
    const rangeStart = now - hours * 60 * 60 * 1000;
    const bucketSize = (now - rangeStart) / segments;
    const statuses: number[] = new Array(segments).fill(-1);

    for (const hb of heartbeats) {
      const ts = new Date(hb.time).getTime();
      if (ts < rangeStart || ts > now) continue;
      const idx = Math.min(Math.floor((ts - rangeStart) / bucketSize), segments - 1);
      if (statuses[idx] === -1 || hb.status < statuses[idx]) {
        statuses[idx] = hb.status;
      }
    }
    for (let i = 1; i < segments; i++) {
      if (statuses[i] === -1 && statuses[i - 1] !== -1) statuses[i] = statuses[i - 1];
    }
    for (let i = segments - 2; i >= 0; i--) {
      if (statuses[i] === -1 && statuses[i + 1] !== -1) statuses[i] = statuses[i + 1];
    }
    return statuses.map((s, i) => ({ status: s, start: rangeStart + i * bucketSize, end: rangeStart + (i + 1) * bucketSize }));
  };

  const statusLabel = (s: number) => {
    const map: Record<number, string> = { 1: 'Up', 0: 'Down', 2: 'Degraded', 3: 'Maintenance', [-1]: 'No Data' };
    return map[s] || 'Unknown';
  };
  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  const UptimeBar: React.FC<{ monitor: UptimeMonitor }> = ({ monitor }) => {
    const [expanded, setExpanded] = useState(false);
    const [activeBucket, setActiveBucket] = useState<{ id: string; bucket: Bucket; idx: number } | null>(null);
    const buckets24h = useMemo(() => processHeartbeats(monitor.heartbeats || [], 24), [monitor.heartbeats]);
    const buckets7d = useMemo(() => processHeartbeats(monitor.heartbeats || [], 168), [monitor.heartbeats]);
    const pct24h = (monitor.uptime * 100).toFixed(2);
    const effectiveUptime7d = monitor.uptime_7d > 0
      ? monitor.uptime_7d
      : calculateUptimeFromHeartbeats(monitor.heartbeats);
    const pct7d = (effectiveUptime7d * 100).toFixed(2);
    const renderBars = (buckets: Bucket[], barId: string) => (
      <div className="relative">
        <div className="flex gap-[1.5px] h-8 rounded-md overflow-hidden">
          {buckets.map((b, i) => (
            <div
              key={i}
              className="flex-1 transition-all duration-200 hover:opacity-80 hover:scale-y-110 origin-bottom cursor-pointer"
              style={{ backgroundColor: b.status === -1 ? '#e2e8f0' : statusColorMap[b.status] || '#94a3b8', minWidth: '1px' }}
              onClick={(e) => { e.stopPropagation(); setActiveBucket(prev => prev?.id === barId && prev?.idx === i ? null : { id: barId, bucket: b, idx: i }); }}
            />
          ))}
        </div>
        {activeBucket?.id === barId && (
          <div
            className="absolute z-10 mt-1 px-3 py-2 rounded-lg shadow-lg border text-xs bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
            style={{ left: `${Math.min(Math.max((activeBucket.idx / buckets.length) * 100, 5), 85)}%`, transform: 'translateX(-50%)' }}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: activeBucket.bucket.status === -1 ? '#e2e8f0' : statusColorMap[activeBucket.bucket.status] || '#94a3b8' }} />
              <span className="font-semibold text-slate-700 dark:text-slate-200">{statusLabel(activeBucket.bucket.status)}</span>
            </div>
            <div className="text-slate-500 dark:text-slate-400 whitespace-nowrap">{fmtTime(activeBucket.bucket.start)} — {fmtTime(activeBucket.bucket.end)}</div>
          </div>
        )}
      </div>
    );
    return (
      <div className="py-3">
        <div
          className="flex items-center justify-between mb-1.5 cursor-pointer select-none"
          onClick={() => setExpanded(e => !e)}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 dark:text-slate-500 w-4 transition-transform duration-200" style={{ display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'none' }}>&#9654;</span>
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: statusDotColor(monitor.status) }} />
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[200px]">{monitor.name}</span>
          </div>
          <span className="text-sm font-mono font-bold" style={{ color: monitor.uptime >= 0.99 ? '#10b981' : monitor.uptime >= 0.95 ? '#f59e0b' : '#ef4444' }}>{pct24h}%</span>
        </div>
        {renderBars(buckets24h, '24h')}
        {expanded && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1 text-xs text-slate-400 dark:text-slate-500">
              <span>7 {t('public.uptime.days_label') || 'days'}</span>
              <span style={{ color: effectiveUptime7d >= 0.99 ? '#10b981' : effectiveUptime7d >= 0.95 ? '#f59e0b' : '#ef4444' }}>{pct7d}%</span>
            </div>
            {renderBars(buckets7d, '7d')}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#f6f8fb] dark:bg-[#0b1220] text-slate-900 dark:text-slate-100" style={{ fontFamily: '"Space Grotesk","Inter",sans-serif' }}>
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/85 dark:bg-[#0b1220]/80 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white flex items-center justify-center shadow-lg">
              <span className="material-symbols-outlined text-[20px]">hub</span>
            </div>
            <div>
              <div className="font-bold leading-none">{text.systemName}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">CaMeL AI Platform</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onPricing} className="px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
              {t('public.pricing')}
            </button>
            <button onClick={toggleLanguage} className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
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
        <section className="relative overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1a2b] p-10">
          <div className="absolute -top-16 -right-16 w-72 h-72 rounded-full bg-cyan-500/15 blur-3xl" />
          <div className="absolute -bottom-16 -left-16 w-72 h-72 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="relative z-10 grid md:grid-cols-2 gap-8 items-center">
            <div>
              <p className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                {t('public.operational')}
              </p>
              <h1 className="mt-4 text-4xl leading-tight font-black tracking-tight">{text.heroTitle}</h1>
              <p className="mt-4 text-slate-600 dark:text-slate-300 leading-relaxed">{text.heroSubtitle}</p>
              <div className="mt-4 p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
                <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">"{text.quote}"</p>
                <p className="text-xs mt-2 text-slate-500 dark:text-slate-400">- {text.quoteAuthor}</p>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <button onClick={onLogin} className="px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold">
                  {text.ctaPrimary}
                </button>
                <button onClick={onRegister} className="px-5 py-3 rounded-xl border border-slate-300 dark:border-slate-700 font-semibold">
                  {text.ctaSecondary}
                </button>
                {status.docs_link && (
                  <button onClick={() => window.open(status.docs_link, '_blank')} className="px-5 py-3 rounded-xl bg-slate-100 dark:bg-slate-800 font-semibold">
                    {text.docs}
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label={t('public.stat.models')} value={modelCount.toString()} />
              <StatCard label={t('public.stat.vendors')} value={vendorCount.toString()} />
              <StatCard label={t('public.stat.plans')} value={planCount.toString()} />
              <StatCard label={t('public.stat.uptime')} value={uptimeDays.toString()} />
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-black mb-5">{text.section1}</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {text.cards.map((card) => (
              <div key={card.title} className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1a2b]">
                <h3 className="font-bold text-lg">{card.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{card.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {(status.uptime_kuma_enabled && (uptimeLoading || allMonitors.length > 0)) && (
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1a2b] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-black">{t('public.uptime.title')}</h2>
              <div className="text-right">
                <span className="ml-2 text-lg font-bold font-mono text-emerald-500">{uptimeDays} {t('public.uptime.days_label') || 'days'}</span>
              </div>
            </div>
            {uptimeLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="animate-pulse">
                    <div className="flex justify-between mb-1.5">
                      <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded" />
                      <div className="h-4 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
                    </div>
                    <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded-md" />
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {allMonitors.map((monitor, idx) => (
                    <UptimeBar key={`${monitor.name}-${idx}`} monitor={monitor} />
                  ))}
                </div>
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  {[
                    { status: 1, key: 'public.uptime.up' },
                    { status: 0, key: 'public.uptime.down' },
                    { status: 2, key: 'public.uptime.degraded' },
                    { status: 3, key: 'public.uptime.maintenance' },
                  ].map(({ status, key }) => (
                    <div key={key} className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: statusColorMap[status] }} />
                      <span className="text-xs text-slate-500 dark:text-slate-400">{t(key)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        <section className="grid md:grid-cols-2 gap-6">
          <div className="group p-8 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-[#0f1a2b]/50 hover:bg-white dark:hover:bg-[#0f1a2b] transition-all duration-500 relative overflow-hidden shadow-sm hover:shadow-xl hover:shadow-cyan-500/10">
            <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl -mr-32 -mt-32 group-hover:bg-cyan-500/20 transition-all duration-700 ease-in-out"></div>
            <div className="relative z-10">
              <div className="w-12 h-12 rounded-xl bg-cyan-100 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300 shadow-inner">
                <span className="material-symbols-outlined text-[24px]">rocket_launch</span>
              </div>
              <h2 className="text-2xl font-black mb-6 tracking-tight bg-gradient-to-r from-slate-900 to-slate-600 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">{language === 'zh' ? '极致的性能体验' : 'Ultimate Performance'}</h2>
              <ul className="space-y-4">
                {[
                  language === 'zh' ? '毫秒级网关路由，极低延迟响应' : 'Millisecond gateway routing, ultra-low latency',
                  language === 'zh' ? '高并发智能调度，无缝容灾切换' : 'High concurrency scheduling, seamless failover',
                  language === 'zh' ? '全球边缘节点加速，智能网络优化' : 'Global edge node acceleration, smart network',
                  language === 'zh' ? '全链路流式传输，丝滑打字机体验' : 'Full-link streaming, smooth typing experience'
                ].map((item, idx) => (
                  <li key={idx} className="flex items-center gap-4 transform group-hover:translate-x-2 transition-transform duration-500 ease-out" style={{ transitionDelay: `${idx * 100}ms` }}>
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white shadow-md shadow-cyan-500/20 flex-shrink-0">
                      <span className="material-symbols-outlined text-[14px] font-bold">check</span>
                    </div>
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="group p-8 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-[#0f1a2b]/50 hover:bg-white dark:hover:bg-[#0f1a2b] transition-all duration-500 relative overflow-hidden shadow-sm hover:shadow-xl hover:shadow-blue-500/10">
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -ml-32 -mb-32 group-hover:bg-blue-500/20 transition-all duration-700 ease-in-out"></div>
            <div className="relative z-10">
              <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:-rotate-3 transition-transform duration-300 shadow-inner">
                <span className="material-symbols-outlined text-[24px] group-hover:animate-pulse">memory</span>
              </div>
              <h2 className="text-2xl font-black mb-6 tracking-tight bg-gradient-to-r from-slate-900 to-slate-600 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">{language === 'zh' ? '前沿的技术架构' : 'Cutting-edge Stack'}</h2>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { title: 'Rust Core', desc: language === 'zh' ? '极致的底层引擎' : 'Extreme Core Engine', icon: 'settings_b_roll' },
                  { title: 'Go Microservices', desc: language === 'zh' ? '高并发微服务集群' : 'High-concurrency cluster', icon: 'hub' },
                  { title: 'Redis Cluster', desc: language === 'zh' ? '分布式内存级缓存' : 'Distributed Cache', icon: 'database' },
                  { title: 'React 18', desc: language === 'zh' ? '现代化响应式前端' : 'Reactive Frontend', icon: 'view_quilt' }
                ].map((tech, idx) => (
                  <div key={idx} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 hover:bg-white dark:hover:bg-slate-700 border border-transparent hover:border-blue-200 dark:hover:border-blue-700/50 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-lg hover:shadow-blue-500/10 cursor-default">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="material-symbols-outlined text-[16px] text-blue-500 dark:text-blue-400">{tech.icon}</span>
                      <div className="font-bold text-sm text-slate-800 dark:text-slate-200">{tech.title}</div>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{tech.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-[#0b1220]/50">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-wrap items-center justify-between gap-4">
          <span className="text-xs text-slate-400">&copy; {new Date().getFullYear()} {text.systemName}</span>
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

const StatCard = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4">
    <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
    <div className="mt-2 text-2xl font-black">{value}</div>
  </div>
);

export default PublicHome;
