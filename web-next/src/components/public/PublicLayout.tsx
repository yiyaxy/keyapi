import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet } from 'react-router-dom';

import { Logo } from '@/components/layout/Logo';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useSiteBranding } from '@/hooks/useSiteBranding';
import { cn } from '@/lib/utils';

export function PublicLayout() {
  const { t } = useTranslation('public');
  const { status } = useAuth();
  const { systemName, logo, footerHtml } = useSiteBranding();
  const appName = systemName || t('app.name', { ns: 'common' });
  const year = new Date().getFullYear();

  return (
    <div className='flex min-h-screen flex-col bg-bg-0 text-fg-0'>
      <header className='border-b border-line'>
        <div className='mx-auto flex h-14 max-w-[1180px] items-center gap-6 px-4'>
          <Link to='/' className='flex items-center gap-2'>
            <Logo size={22} url={logo} alt={appName} />
            <span className='font-semibold'>{appName}</span>
          </Link>
          <nav className='flex items-center gap-1 text-13'>
            <PublicLink to='/' label={t('nav.home')} end />
            <PublicLink to='/pricing' label={t('nav.pricing')} />
            <PublicLink to='/apps' label={t('nav.apps')} />
            <PublicLink to='/about' label={t('nav.about')} />
            <a
              href='https://www.kdocs.cn/l/cgMS9PoVquM0'
              target='_blank'
              rel='noopener noreferrer'
              className='rounded-sm px-3 py-1.5 text-fg-2 transition-colors hover:text-fg-1'
            >
              {t('nav.docs')}
            </a>
          </nav>
          <div className='ml-auto flex items-center gap-2'>
            {status === 'authenticated' ? (
              <Link to='/dashboard'>
                <Button size='sm'>{t('nav.dashboard')}</Button>
              </Link>
            ) : (
              <>
                <Link to='/login'>
                  <Button variant='ghost' size='sm'>
                    {t('nav.login')}
                  </Button>
                </Link>
                <Link to='/register'>
                  <Button size='sm'>{t('nav.register')}</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main className='flex-1'>
        <div className='mx-auto max-w-[1180px] px-4 py-10'>
          <Outlet />
        </div>
      </main>
      <footer className='border-t border-line'>
        {footerHtml ? (
          <div
            className='mx-auto max-w-[1180px] px-4 py-4 text-12 text-fg-2'
            dangerouslySetInnerHTML={{ __html: footerHtml }}
          />
        ) : (
          <div className='mx-auto flex max-w-[1180px] items-center justify-between px-4 py-4 text-12 text-fg-2'>
            <div>{t('footer.rights', { year })}</div>
            <nav className='flex gap-4'>
              <Link to='/user-agreement' className='hover:text-fg-1'>
                {t('legal.terms.title')}
              </Link>
              <Link to='/privacy-policy' className='hover:text-fg-1'>
                {t('legal.privacy.title')}
              </Link>
              <Link to='/refund-policy' className='hover:text-fg-1'>
                {t('legal.refund.title')}
              </Link>
            </nav>
          </div>
        )}
      </footer>
    </div>
  );
}

function PublicLink({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'rounded-sm px-3 py-1.5 transition-colors',
          isActive ? 'text-fg-0' : 'text-fg-2 hover:text-fg-1'
        )
      }
    >
      {label}
    </NavLink>
  );
}
