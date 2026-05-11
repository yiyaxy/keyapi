import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ImageIcon, Loader2, MessageCircle, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { MobileChat } from '@/components/mobile/MobileAppPortal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { usePublicApps, useGetSessionToken, useGetGuestToken, type AiApp } from '@/hooks/useAiApps';
import { filterMarketplaceApps } from '@/lib/aiAppVisibility';
import { getLlmTenantId, LLM_BASE_URL } from '@/lib/llm';

function shouldAttachLlmBaseUrl(app: AiApp) {
  const value = `${app.slug} ${app.target_url}`.toLowerCase();
  return value.includes('noterx');
}

function persistSameOriginNoterxConfig(targetUrl: URL, key: string) {
  sessionStorage.setItem('noterx.session_token', key);
  const llmBaseUrl = targetUrl.searchParams.get('llm_base_url');
  if (llmBaseUrl) sessionStorage.setItem('noterx.llm_base_url', llmBaseUrl);
  const tenantId = targetUrl.searchParams.get('tenant_id');
  if (tenantId) sessionStorage.setItem('noterx.tenant_id', tenantId);
}

function getSessionKey(res: { key?: string; data?: { key?: string } }) {
  return res.key || res.data?.key || '';
}

function launchApp(app: AiApp, key: string) {
  const targetUrl = new URL(app.target_url, window.location.origin);
  const isNoteRx = shouldAttachLlmBaseUrl(app);
  if (isNoteRx) {
    targetUrl.searchParams.set('llm_base_url', LLM_BASE_URL);
    targetUrl.searchParams.set('token', key);
    const tenantId = getLlmTenantId();
    if (tenantId) targetUrl.searchParams.set('tenant_id', String(tenantId));
    if (targetUrl.origin === window.location.origin) {
      persistSameOriginNoterxConfig(targetUrl, key);
    }
    window.location.href = targetUrl.toString();
    return;
  }
  if (targetUrl.origin === window.location.origin) {
    targetUrl.searchParams.set('token', key);
    window.location.href = targetUrl.toString();
    return;
  }

  const loginUrl = new URL('/api/auth/token-login', targetUrl);
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = loginUrl.toString();
  form.style.display = 'none';

  const tokenInput = document.createElement('input');
  tokenInput.type = 'hidden';
  tokenInput.name = 'token';
  tokenInput.value = key;
  form.append(tokenInput);

  const callbackInput = document.createElement('input');
  callbackInput.type = 'hidden';
  callbackInput.name = 'callbackUrl';
  callbackInput.value = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
  form.append(callbackInput);

  document.body.append(form);
  form.submit();
}

function parseTags(tags: string) {
  return tags
    .split(/[,\uFF0C]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function getInitial(name: string) {
  return (name.trim().slice(0, 1) || 'A').toUpperCase();
}

const posterPalettes = [
  ['#0f766e', '#38bdf8', '#111827'],
  ['#be123c', '#f97316', '#1f2937'],
  ['#15803d', '#a3e635', '#172554'],
  ['#0369a1', '#22c55e', '#312e81'],
  ['#7c2d12', '#facc15', '#1e293b'],
  ['#4338ca', '#06b6d4', '#134e4a'],
] as const;

function posterGradient(seed: string) {
  const index =
    seed.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % posterPalettes.length;
  const [from, via, to] = posterPalettes[index];
  return `linear-gradient(135deg, ${from} 0%, ${via} 50%, ${to} 100%)`;
}

function normalizeImageUrl(url: string) {
  const value = url.trim();
  if (!value) return '';
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:')) return value;
  return value.startsWith('/') ? value : `/${value}`;
}

function AppPoster({ app }: { app: AiApp }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = normalizeImageUrl(app.icon_url || '');

  if (imageUrl && !failed) {
    return (
      <div className='relative aspect-[16/9] overflow-hidden bg-bg-2'>
        <img
          src={imageUrl}
          alt={app.name}
          className='h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]'
          loading='lazy'
          onError={() => setFailed(true)}
        />
        <div className='absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/45 to-transparent' />
      </div>
    );
  }

  return (
    <div
      className='relative aspect-[16/9] overflow-hidden text-white'
      style={{ background: posterGradient(`${app.slug}:${app.name}`) }}
    >
      <div className='absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/16' />
      <div className='absolute bottom-4 right-5 h-14 w-14 rotate-12 rounded-lg bg-white/12' />
      <div className='absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-md bg-white/18 backdrop-blur'>
        <ImageIcon className='h-5 w-5' />
      </div>
      <div className='absolute bottom-4 left-4 right-4'>
        <div className='mb-2 text-32 font-semibold leading-none'>{getInitial(app.name)}</div>
        <div className='truncate text-13 font-medium text-white/90'>{app.name || app.slug}</div>
      </div>
    </div>
  );
}

function AppCard({ app }: { app: AiApp }) {
  const { t } = useTranslation('apps');
  const { user } = useAuth();
  const sessionMut = useGetSessionToken(app.slug);
  const guestMut = useGetGuestToken(app.slug);
  const tags = parseTags(app.tags || '');

  async function handleUse() {
    try {
      let key: string;
      if (user) {
        const res = await sessionMut.mutateAsync();
        key = getSessionKey(res);
      } else if (app.guest_quota > 0) {
        const res = await guestMut.mutateAsync();
        key = getSessionKey(res);
      } else {
        toast.error(t('login_required'));
        window.location.href = '/login';
        return;
      }
      if (!key) throw new Error('missing app token');

      launchApp(app, key);
    } catch {
      toast.error(t('token_error'));
    }
  }

  const isLoading = sessionMut.isPending || guestMut.isPending;

  const visibleTags = tags.slice(0, 3);
  const canGuestUse = app.guest_quota > 0 && !user;

  return (
    <button
      type='button'
      onClick={() => void handleUse()}
      disabled={isLoading}
      className='group flex min-h-[300px] flex-col overflow-hidden rounded-lg border border-line bg-bg-0 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md disabled:cursor-wait disabled:opacity-70'
    >
      <div className='relative'>
        <AppPoster app={app} />
        <div className='absolute left-3 top-3 flex flex-wrap gap-1.5'>
          {canGuestUse && (
            <Badge className='border-white/20 bg-white/90 text-fg-0 shadow-sm hover:bg-white/90'>
              {t('free_trial')}
            </Badge>
          )}
        </div>
      </div>

      <div className='flex flex-1 flex-col p-3.5'>
        <div className='min-w-0'>
          <h3 className='truncate text-16 font-semibold leading-6 text-fg-0'>{app.name}</h3>
          <p className='mt-1 min-h-[42px] text-13 leading-5 text-fg-2 line-clamp-2'>
            {app.description || t('no_description')}
          </p>
        </div>

        <div className='mt-3 flex min-h-6 flex-wrap gap-1.5'>
          {visibleTags.length > 0 ? (
            <>
              {visibleTags.map((tag) => (
                <Badge key={tag} variant='secondary' className='h-6 px-2 text-11'>
                  {tag}
                </Badge>
              ))}
              {tags.length > visibleTags.length && (
                <Badge variant='secondary' className='h-6 px-2 text-11'>
                  +{tags.length - visibleTags.length}
                </Badge>
              )}
            </>
          ) : (
            <span className='inline-flex h-6 items-center gap-1.5 text-12 text-fg-2'>
              <Sparkles className='h-3.5 w-3.5' />
              AI
            </span>
          )}
        </div>

        <div className='mt-auto flex items-center justify-between gap-2 pt-4'>
          <span className='text-12 text-fg-2'>{app.slug}</span>
          <span className='inline-flex h-8 items-center rounded-md bg-primary px-3 text-12 font-medium text-primary-foreground'>
            {isLoading ? <Loader2 className='h-4 w-4 animate-spin' /> : t('use_app')}
          </span>
        </div>
      </div>
    </button>
  );
}

function ChatEntryCard() {
  const { t } = useTranslation('apps');
  const { user } = useAuth();

  return (
    <section className='min-w-0 lg:sticky lg:top-20'>
      {user ? (
        <MobileChat desktop />
      ) : (
        <div className='rounded-xl border border-primary/20 bg-primary/5 p-5'>
          <div className='flex min-w-0 items-start gap-3'>
            <div className='flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground'>
              <MessageCircle className='h-6 w-6' />
            </div>
            <div className='min-w-0'>
              <h2 className='text-18 font-semibold'>{t('chat_entry.title')}</h2>
              <p className='mt-1 text-13 leading-6 text-fg-2'>{t('chat_entry.subtitle')}</p>
            </div>
          </div>
          <Button className='mt-5 w-full' asChild>
            <a href='/login?redirect=/apps'>{t('login_required')}</a>
          </Button>
        </div>
      )}
    </section>
  );
}

export function AppMarketplacePage() {
  const { t } = useTranslation('apps');
  const [search, setSearch] = useState('');
  const list = usePublicApps();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(max-width: 767px)').matches) {
      window.location.replace('/m/apps');
    }
  }, []);

  const apps = filterMarketplaceApps(list.data ?? []).filter(
    (a) =>
      !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.tags.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className='mx-auto max-w-[1440px] px-4 py-4 lg:px-6'>
      <div className='grid gap-5 lg:grid-cols-[minmax(0,1fr)_500px] xl:grid-cols-[minmax(0,1fr)_540px] 2xl:grid-cols-[minmax(0,1fr)_560px] lg:items-start'>
        <aside className='min-w-0'>
          <div className='mb-4'>
            <div className='mb-3'>
              <h1 className='text-22 font-semibold'>{t('title')}</h1>
              <p className='mt-1 text-13 text-fg-2'>{t('subtitle')}</p>
            </div>
            <input
              type='text'
              className='w-full rounded-lg border border-line bg-bg-0 px-4 py-2 text-14 outline-none placeholder:text-fg-3 focus:border-primary'
              placeholder={t('search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {list.isPending ? (
            <div className='grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3'>
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className='h-40 w-full rounded-lg' />
              ))}
            </div>
          ) : list.isError ? (
            <div className='rounded-xl border border-danger/30 bg-danger/5 p-6 text-center text-danger'>
              {t('load_error')}
            </div>
          ) : apps.length === 0 ? (
            <div className='rounded-xl border border-line bg-bg-1 p-12 text-center text-fg-2'>
              {search ? t('no_results') : t('empty')}
            </div>
          ) : (
            <div className='grid max-h-[calc(100vh-168px)] grid-cols-1 gap-3 overflow-y-auto pr-1 md:grid-cols-2 2xl:grid-cols-3'>
              {apps.map((app) => (
                <AppCard key={app.id} app={app} />
              ))}
            </div>
          )}
        </aside>

        <ChatEntryCard />
      </div>
    </div>
  );
}

export function AppsChatPage() {
  return (
    <main className='min-h-screen bg-bg-1 px-4 py-4 lg:px-6'>
      <div className='mx-auto flex h-[calc(100vh-32px)] max-w-5xl flex-col gap-3'>
        <div className='flex shrink-0 items-center justify-between'>
          <Button variant='secondary' size='sm' asChild>
            <a href='/apps'>
              <ArrowLeft className='mr-1 h-4 w-4' />
              返回应用广场
            </a>
          </Button>
        </div>
        <div className='min-h-0 flex-1'>
          <MobileChat desktop desktopFullscreenLink={false} />
        </div>
      </div>
    </main>
  );
}
