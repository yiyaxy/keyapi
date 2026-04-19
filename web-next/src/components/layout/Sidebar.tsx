import {
  Activity,
  AlertCircle,
  Building2,
  ClipboardList,
  Coins,
  Database,
  FileText,
  Gauge,
  Gem,
  Gift,
  Globe,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  List,
  Play,
  Plug,
  Receipt,
  ScrollText,
  Settings2,
  Ticket,
  Users,
  UserCog,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/hooks/useAuth';
import { useUnreadCount } from '@/hooks/useInbox';

import { Logo } from './Logo';
import { NavItem } from './NavItem';
import { SidebarGroup } from './SidebarGroup';
import { UserChip } from './UserChip';

const ROLE_ADMIN = 10;
const ROLE_PLATFORM = 100;

export function Sidebar() {
  const { t } = useTranslation('shell');
  const { user } = useAuth();
  const isAdmin =
    user !== null && Math.max(user.role, user.platform_role, user.tenant_role) >= ROLE_ADMIN;
  const isPlatform =
    user !== null && Math.max(user.role, user.platform_role, user.tenant_role) >= ROLE_PLATFORM;
  const unread = useUnreadCount();

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
          <NavItem to='/plan' label={t('nav.plan')} icon={Gem} />
          <NavItem to='/invoice' label={t('nav.invoice')} icon={ScrollText} />
          <NavItem to='/smart-cache' label={t('nav.smart_cache')} icon={Database} />
          <NavItem to='/inbox' label={t('nav.inbox')} icon={Inbox} badge={unread.data} />
          <NavItem to='/tickets' label={t('nav.tickets')} icon={LifeBuoy} />
          <NavItem to='/aff-transfer' label={t('nav.aff_transfer')} icon={Coins} />
        </SidebarGroup>
        {isAdmin && (
          <>
            <SidebarGroup label={t('nav.admin')}>
              <NavItem to='/admin/channels' label={t('nav.admin.channels')} icon={Plug} />
              <NavItem to='/admin/users' label={t('nav.admin.users')} icon={Users} />
              <NavItem to='/admin/redemption' label={t('nav.admin.redemption')} icon={Ticket} />
              <NavItem to='/admin/logs' label={t('nav.admin.logs')} icon={List} />
              <NavItem to='/admin/tickets' label={t('nav.admin.tickets')} icon={LifeBuoy} />
              <NavItem to='/admin/invoices' label={t('nav.admin.invoices')} icon={ScrollText} />
              <NavItem to='/admin/subscriptions' label={t('nav.admin.subscriptions')} icon={Gem} />
              <NavItem to='/admin/site-rpm' label={t('nav.admin.site_rpm')} icon={Gauge} />
              <NavItem
                to='/admin/channel-monitor'
                label={t('nav.admin.channel_monitor')}
                icon={Activity}
              />
              <NavItem
                to='/admin/request-trace'
                label={t('nav.admin.request_trace')}
                icon={Activity}
              />
              <NavItem to='/admin/aff-transfer' label={t('nav.admin.aff_transfer')} icon={Coins} />
              <NavItem
                to='/admin/rebate-settings'
                label={t('nav.admin.rebate_settings')}
                icon={Gift}
              />
            </SidebarGroup>
            <SidebarGroup label={t('nav.tenant')}>
              <NavItem
                to='/tenant/dashboard'
                label={t('nav.tenant.dashboard')}
                icon={LayoutDashboard}
              />
              <NavItem to='/tenant/info' label={t('nav.tenant.info')} icon={Building2} />
              <NavItem to='/tenant/members' label={t('nav.tenant.members')} icon={UserCog} />
              <NavItem to='/tenant/plan' label={t('nav.tenant.plan')} icon={Gem} />
              <NavItem to='/tenant/bills' label={t('nav.tenant.bills')} icon={FileText} />
              <NavItem to='/tenant/alerts' label={t('nav.tenant.alerts')} icon={AlertCircle} />
              <NavItem to='/tenant/config' label={t('nav.tenant.config')} icon={Settings2} />
              <NavItem to='/tenant/audit' label={t('nav.tenant.audit')} icon={ClipboardList} />
            </SidebarGroup>
          </>
        )}
        {isPlatform && (
          <SidebarGroup label={t('nav.platform')}>
            <NavItem
              to='/admin/platform-tenants'
              label={t('nav.admin.platform_tenants')}
              icon={Globe}
            />
            <NavItem to='/admin/models' label={t('nav.admin.models')} icon={Database} />
          </SidebarGroup>
        )}
      </nav>
      <div className='border-t border-line p-3'>
        <UserChip />
      </div>
    </aside>
  );
}
