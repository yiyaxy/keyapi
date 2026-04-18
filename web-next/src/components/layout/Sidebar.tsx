import { KeyRound, LayoutDashboard, List, Play, Receipt } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Logo } from './Logo';
import { NavItem } from './NavItem';
import { SidebarGroup } from './SidebarGroup';
import { UserChip } from './UserChip';

export function Sidebar() {
  const { t } = useTranslation('shell');
  return (
    <aside className='flex w-[240px] shrink-0 flex-col border-r border-line bg-bg-0'>
      <div className='flex h-14 items-center gap-2 border-b border-line px-4'>
        <Logo size={24} />
        <span className='font-semibold'>{t('app.name', { ns: 'common' })}</span>
      </div>
      <nav className='flex-1 overflow-y-auto p-3'>
        <SidebarGroup label={t('nav.build')}>
          <NavItem to='/dashboard' label={t('nav.dashboard')} icon={LayoutDashboard} />
          <NavItem to='/keys' label={t('nav.keys')} icon={KeyRound} />
          <NavItem to='/playground' label={t('nav.playground')} icon={Play} />
          <NavItem to='/logs' label={t('nav.logs')} icon={List} />
        </SidebarGroup>
        <SidebarGroup label={t('nav.billing')}>
          <NavItem to='/topup' label={t('nav.topup')} icon={Receipt} />
        </SidebarGroup>
      </nav>
      <div className='border-t border-line p-3'>
        <UserChip />
      </div>
    </aside>
  );
}
