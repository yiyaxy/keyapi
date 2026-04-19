import { BarChart3, Building2, Gauge, Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

export function HomePage() {
  const { t } = useTranslation('public');
  return (
    <div className='space-y-16'>
      <section className='pt-10 text-center'>
        <h1 className='text-40 font-semibold leading-tight tracking-tight'>{t('home.tagline')}</h1>
        <p className='mx-auto mt-4 max-w-xl text-15 text-fg-2'>{t('home.sub')}</p>
        <div className='mt-8 flex justify-center gap-3'>
          <Link to='/register'>
            <Button size='lg'>{t('home.cta.primary')}</Button>
          </Link>
          <Link to='/pricing'>
            <Button size='lg' variant='secondary'>
              {t('home.cta.secondary')}
            </Button>
          </Link>
        </div>
      </section>

      <section>
        <h2 className='text-center text-20 font-semibold'>{t('home.features.title')}</h2>
        <div className='mt-8 grid grid-cols-1 gap-4 md:grid-cols-2'>
          <Feature
            icon={Plug}
            title={t('home.features.multi.title')}
            body={t('home.features.multi.body')}
          />
          <Feature
            icon={Gauge}
            title={t('home.features.quota.title')}
            body={t('home.features.quota.body')}
          />
          <Feature
            icon={Building2}
            title={t('home.features.tenants.title')}
            body={t('home.features.tenants.body')}
          />
          <Feature
            icon={BarChart3}
            title={t('home.features.logs.title')}
            body={t('home.features.logs.body')}
          />
        </div>
      </section>
    </div>
  );
}

function Feature({ icon: Icon, title, body }: { icon: typeof Plug; title: string; body: string }) {
  return (
    <div className='rounded-md border border-line bg-bg-1 p-5'>
      <Icon className='text-primary' size={20} strokeWidth={1.5} />
      <div className='mt-3 text-15 font-medium'>{title}</div>
      <div className='mt-1 text-13 text-fg-2'>{body}</div>
    </div>
  );
}
