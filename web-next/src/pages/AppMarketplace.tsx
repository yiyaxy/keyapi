import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Loader2, Tag } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import {
  usePublicApps,
  useGetSessionToken,
  useGetGuestToken,
  type AiApp,
} from '@/hooks/useAiApps';

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
      const url = new URL(app.target_url);
      url.searchParams.set('token', key);
      window.open(url.toString(), '_blank', 'noopener,noreferrer');
    } catch {
      toast.error(t('token_error'));
    }
  }

  const isLoading = sessionMut.isPending || guestMut.isPending;

  return (
    <div className='flex flex-col rounded-xl border border-line bg-bg-0 p-5 transition hover:shadow-md'>
      <div className='mb-3 flex items-start gap-3'>
        {app.icon_url ? (
          <img
            src={app.icon_url}
            alt={app.name}
            className='h-12 w-12 shrink-0 rounded-lg object-cover'
          />
        ) : (
          <div className='flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-bg-2 text-2xl font-bold text-fg-2'>
            {app.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className='min-w-0'>
          <h3 className='truncate font-semibold leading-snug'>{app.name}</h3>
          {tags.length > 0 && (
            <div className='mt-1 flex flex-wrap gap-1'>
              {tags.map((tag) => (
                <Badge key={tag} variant='secondary' className='text-11'>
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className='mb-4 flex-1 text-13 text-fg-2 line-clamp-3'>
        {app.description || t('no_description')}
      </p>
      <div className='flex items-center justify-between gap-2'>
        {app.guest_quota > 0 && !user && (
          <span className='text-12 text-success'>{t('free_trial')}</span>
        )}
        <div className='ml-auto flex gap-2'>
          <Button
            size='sm'
            variant='secondary'
            asChild
          >
            <a href={app.target_url} target='_blank' rel='noopener noreferrer'>
              <ExternalLink className='mr-1 h-3.5 w-3.5' />
              {t('preview')}
            </a>
          </Button>
          <Button size='sm' onClick={handleUse} disabled={isLoading}>
            {isLoading && <Loader2 className='mr-1 h-3.5 w-3.5 animate-spin' />}
            {t('use_app')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AppMarketplacePage() {
  const { t } = useTranslation('apps');
  const [search, setSearch] = useState('');
  const list = usePublicApps();

  const apps = (list.data ?? []).filter(
    (a) =>
      !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.tags.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className='mx-auto max-w-5xl px-4 py-10'>
      <div className='mb-8 text-center'>
        <div className='mb-2 flex items-center justify-center gap-2 text-fg-2'>
          <Tag className='h-5 w-5' />
          <span className='text-13 uppercase tracking-wider'>{t('section_label')}</span>
        </div>
        <h1 className='text-3xl font-bold'>{t('title')}</h1>
        <p className='mt-2 text-fg-2'>{t('subtitle')}</p>
      </div>

      <div className='mb-6'>
        <input
          type='text'
          className='w-full rounded-lg border border-line bg-bg-0 px-4 py-2 text-14 outline-none placeholder:text-fg-3 focus:border-primary'
          placeholder={t('search_placeholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {list.isPending ? (
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className='h-48 w-full rounded-xl' />
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
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {apps.map((app) => (
            <AppCard key={app.id} app={app} />
          ))}
        </div>
      )}
    </div>
  );
}
