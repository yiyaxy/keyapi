import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router-dom';

import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

const TITLES: Record<string, string> = {
  '/dashboard': 'nav.dashboard',
  '/keys': 'nav.keys',
  '/playground': 'nav.playground',
  '/logs': 'nav.logs',
  '/topup': 'nav.topup',
  '/plan': 'nav.topup',
  '/account': 'usermenu.account',
  '/inbox': 'nav.inbox',
  '/tickets': 'nav.tickets',
  '/admin/channels': 'nav.admin.channels',
  '/admin/users': 'nav.admin.users',
  '/admin/redemption': 'nav.admin.redemption',
  '/admin/logs': 'nav.admin.logs',
  '/admin/platform-tenants': 'nav.admin.platform_tenants',
  '/tenant/info': 'nav.tenant.info',
  '/tenant/members': 'nav.tenant.members',
};

export function AppShell() {
  const { t } = useTranslation('shell');
  const location = useLocation();
  const [wide, setWide] = useState<boolean>(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= 1024
  );
  useEffect(() => {
    function onResize() {
      setWide(window.innerWidth >= 1024);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!wide) {
    return (
      <div className='flex h-screen items-center justify-center bg-bg-0 p-6 text-center'>
        <p className='text-13 text-fg-1'>{t('viewport.too_narrow', { ns: 'common' })}</p>
      </div>
    );
  }

  const key = Object.keys(TITLES).find((k) => location.pathname.startsWith(k));
  const titleKey = key ? TITLES[key] : 'nav.dashboard';

  return (
    <div className='flex h-screen overflow-hidden'>
      <Sidebar />
      <main className='flex flex-1 flex-col overflow-hidden'>
        <Topbar title={t(titleKey)} />
        <div className='flex-1 overflow-y-auto'>
          <div className='mx-auto max-w-[1280px] px-6 py-6'>
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
