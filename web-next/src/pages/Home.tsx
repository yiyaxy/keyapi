import { marked } from 'marked';
import {
  Activity,
  BarChart3,
  Building2,
  Check,
  Copy,
  DollarSign,
  Gauge,
  Plug,
  Shield,
  Terminal,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useHomePageContent,
  useUptimeStatus,
  type UptimeMonitor,
} from '@/hooks/useHomeContent';

const ENDPOINT_SAMPLES = [
  '/v1/chat/completions',
  '/v1/embeddings',
  '/v1/images/generations',
  '/v1/audio/speech',
  '/v1/audio/transcriptions',
];

function HeroDefault() {
  const { t } = useTranslation('public');
  const baseUrl =
    typeof window === 'undefined' ? '' : window.location.origin;
  const [endpointIdx, setEndpointIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const id = setInterval(
      () => setEndpointIdx((p) => (p + 1) % ENDPOINT_SAMPLES.length),
      3000
    );
    return () => clearInterval(id);
  }, []);

  async function copyBaseUrl() {
    try {
      await navigator.clipboard.writeText(baseUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <section className='grid gap-8 py-12 md:grid-cols-[1.1fr_1fr] md:items-center'>
      <div className='space-y-6'>
        <h1 className='text-40 font-semibold leading-tight tracking-tight md:text-48'>
          {t('home.tagline')}
        </h1>
        <p className='max-w-xl text-15 text-fg-2'>{t('home.sub')}</p>
        <div className='flex flex-wrap gap-2'>
          <span className='inline-flex items-center gap-1 rounded-full border border-line bg-bg-1 px-3 py-1 text-12'>
            <DollarSign size={12} className='text-accent' />
            {t('home.pill.price')}
          </span>
          <span className='inline-flex items-center gap-1 rounded-full border border-line bg-bg-1 px-3 py-1 text-12'>
            <Shield size={12} className='text-success' />
            {t('home.pill.stable')}
          </span>
        </div>
        <div className='flex items-center gap-2 rounded-md border border-line bg-bg-1 px-3 py-2 font-mono text-12'>
          <Terminal size={14} className='text-fg-2' />
          <span className='text-fg-2'>$</span>
          <span className='truncate text-fg-0'>{baseUrl}</span>
          <span className='truncate text-accent'>
            {ENDPOINT_SAMPLES[endpointIdx]}
          </span>
          <button
            type='button'
            onClick={copyBaseUrl}
            title={copied ? t('home.terminal.copied') : t('home.terminal.copy')}
            className='ml-auto rounded p-1 text-fg-2 hover:bg-bg-0 hover:text-fg-0'
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        <div className='flex gap-3'>
          <Link to='/login'>
            <Button size='lg'>{t('home.cta.primary')}</Button>
          </Link>
          <Link to='/pricing'>
            <Button size='lg' variant='secondary'>
              {t('home.cta.secondary')}
            </Button>
          </Link>
        </div>
      </div>
      <UptimePanel />
    </section>
  );
}

function UptimePanel() {
  const { t } = useTranslation('public');
  const uptime = useUptimeStatus();

  const monitors: UptimeMonitor[] = useMemo(() => {
    const out: UptimeMonitor[] = [];
    for (const g of uptime.data ?? []) {
      for (const m of g.monitors ?? []) out.push(m);
    }
    return out;
  }, [uptime.data]);

  const overall = useMemo(() => {
    if (monitors.length === 0) return 0;
    const sum = monitors.reduce((acc, m) => acc + (m.uptime ?? 0), 0);
    return (sum / monitors.length) * 100;
  }, [monitors]);

  return (
    <div className='flex h-full flex-col gap-3 rounded-xl border border-line bg-bg-1 p-5'>
      <div className='flex items-center gap-2 text-12 uppercase tracking-wide text-fg-2'>
        <Activity size={14} className='text-success' />
        {t('home.uptime.title')}
      </div>
      {uptime.isPending ? (
        <Skeleton className='h-10 w-32' />
      ) : monitors.length === 0 ? (
        <div className='flex flex-1 items-center justify-center py-10 text-13 text-fg-2'>
          {t('home.uptime.empty')}
        </div>
      ) : (
        <>
          <div>
            <div className='text-32 font-semibold tabular-nums leading-none'>
              {overall.toFixed(1)}%
            </div>
            <div className='mt-1 text-11 text-fg-2'>
              {t('home.uptime.overall')}
            </div>
          </div>
          <div className='flex h-10 items-end gap-[2px]'>
            {monitors.slice(0, 48).map((m, i) => {
              const pct = (m.uptime ?? 0) * 100;
              const color =
                m.status === 1
                  ? 'var(--success)'
                  : m.status === 0
                    ? 'var(--danger)'
                    : 'var(--warn)';
              return (
                <div
                  key={i}
                  title={`${m.name}: ${pct.toFixed(2)}%`}
                  className='flex-1'
                  style={{
                    height: `${Math.max(pct * 0.4, 4)}px`,
                    backgroundColor: color,
                    minWidth: 3,
                    borderRadius: 1,
                  }}
                />
              );
            })}
          </div>
          <div className='-mx-1 max-h-52 overflow-y-auto px-1'>
            <ul className='divide-y divide-line text-12'>
              {monitors.map((m, i) => {
                const pct = (m.uptime ?? 0) * 100;
                return (
                  <li
                    key={i}
                    className='flex items-center justify-between gap-2 py-1.5'
                  >
                    <span className='flex min-w-0 items-center gap-2'>
                      <span
                        className='inline-block h-1.5 w-1.5 shrink-0 rounded-full'
                        style={{
                          backgroundColor:
                            m.status === 1
                              ? 'var(--success)'
                              : m.status === 0
                                ? 'var(--danger)'
                                : 'var(--warn)',
                        }}
                      />
                      <span className='truncate font-medium'>{m.name}</span>
                    </span>
                    <span className='shrink-0 font-mono tabular-nums text-fg-2'>
                      {pct.toFixed(2)}%
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function FeaturesGrid() {
  const { t } = useTranslation('public');
  const features = [
    { icon: Plug, key: 'multi' },
    { icon: Gauge, key: 'quota' },
    { icon: Building2, key: 'tenants' },
    { icon: BarChart3, key: 'logs' },
  ] as const;
  return (
    <section className='py-8'>
      <h2 className='text-center text-20 font-semibold'>
        {t('home.features.title')}
      </h2>
      <div className='mt-8 grid grid-cols-1 gap-4 md:grid-cols-2'>
        {features.map(({ icon: Icon, key }) => (
          <div
            key={key}
            className='rounded-md border border-line bg-bg-1 p-5'
          >
            <Icon className='text-primary' size={20} strokeWidth={1.5} />
            <div className='mt-3 text-15 font-medium'>
              {t(`home.features.${key}.title`)}
            </div>
            <div className='mt-1 text-13 text-fg-2'>
              {t(`home.features.${key}.body`)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

export function HomePage() {
  const content = useHomePageContent();
  const raw = (content.data ?? '').trim();

  if (content.isPending) {
    return (
      <div className='py-12'>
        <Skeleton className='h-64 w-full' />
      </div>
    );
  }

  if (raw && isUrl(raw)) {
    return (
      <iframe
        src={raw}
        title='Home'
        className='h-[calc(100vh-64px)] w-full border-none'
      />
    );
  }

  if (raw) {
    const html = marked.parse(raw, { async: false }) as string;
    return (
      <article
        className='prose max-w-none py-8 text-15'
        // Admin-owned content, same treatment as legacy.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  // Default hero
  return (
    <div className='space-y-10'>
      <HeroDefault />
      <FeaturesGrid />
    </div>
  );
}
