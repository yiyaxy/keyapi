import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Loader2, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';

import { MobileChat } from '@/components/mobile/MobileAppPortal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { usePublicApps, useGetSessionToken, useGetGuestToken, type AiApp } from '@/hooks/useAiApps';

function launchApp(app: AiApp, key: string) {
  const targetUrl = new URL(app.target_url, window.location.origin);
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

function AppCard({ app }: { app: AiApp }) {
  const { t } = useTranslation('apps');
  const { user } = useAuth();
  const sessionMut = useGetSessionToken(app.slug);
  const guestMut = useGetGuestToken(app.slug);
  const tags = app.tags ? app.tags.split(',').filter(Boolean) : [];

  async function handleUse() {
    try {
      let key: string;
      if (user) {
        const res = await sessionMut.mutateAsync();
        key = res.key;
      } else if (app.guest_quota > 0) {
        const res = await guestMut.mutateAsync();
        key = res.key;
      } else {
        toast.error(t('login_required'));
        window.location.href = '/login';
        return;
      }

      launchApp(app, key);
    } catch {
      toast.error(t('token_error'));
    }
  }

  const isLoading = sessionMut.isPending || guestMut.isPending;

  const visibleTags = tags.slice(0, 2);

  return (
    <button
      type='button'
      onClick={() => void handleUse()}
      disabled={isLoading}
      className='flex min-h-[156px] flex-col rounded-lg border border-line bg-bg-0 p-3 text-left transition hover:border-primary/30 hover:shadow-sm disabled:cursor-wait disabled:opacity-70'
    >
      <div className='mb-2 flex items-start gap-2.5'>
        {app.icon_url ? (
          <img
            src={app.icon_url}
            alt={app.name}
            className='h-9 w-9 shrink-0 rounded-md object-cover'
          />
        ) : (
          <div className='flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-bg-2 text-16 font-bold text-fg-2'>
            {app.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className='min-w-0'>
          <h3 className='truncate text-14 font-semibold leading-snug'>{app.name}</h3>
          {visibleTags.length > 0 && (
            <div className='mt-1 flex flex-wrap gap-1'>
              {visibleTags.map((tag) => (
                <Badge key={tag} variant='secondary' className='h-5 px-1.5 text-10'>
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className='mb-3 flex-1 text-12 leading-5 text-fg-2 line-clamp-2'>
        {app.description || t('no_description')}
      </p>
      <div className='flex items-center justify-between gap-2'>
        {app.guest_quota > 0 && !user && (
          <span className='text-12 text-success'>{t('free_trial')}</span>
        )}
        {isLoading ? <Loader2 className='ml-auto h-4 w-4 animate-spin text-fg-2' /> : null}
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

  const apps = (list.data ?? []).filter(
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
