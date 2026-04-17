/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import { useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { UserContext } from '../../context/User';

// user.role >= 100 is the root / super-admin level (see helpers/auth.jsx RootRoute)
function isSuperAdmin(user) {
  return typeof user?.role === 'number' && user.role >= 100;
}

// tenant_role >= 10 grants tenant-admin access; platform role >= 10 also qualifies
// (mirrors TenantAdminRoute in helpers/auth.jsx)
function isTenantAdmin(user) {
  const platformRole = user?.platform_role ?? user?.role ?? 0;
  const tenantRole = user?.tenant_role ?? 0;
  return platformRole >= 10 || tenantRole >= 10;
}

export function hasMultipleTenants(user) {
  return Array.isArray(user?.tenants) && user.tenants.length >= 2;
}

const RAW_GROUPS = [
  {
    group: 'OVERVIEW',
    i18nKey: 'nav.group.overview',
    items: [
      {
        id: 'dashboard',
        icon: 'IconHome',
        to: '/console',
        i18nKey: 'nav.dashboard',
      },
      {
        id: 'logs',
        icon: 'IconHistory',
        to: '/console/log',
        i18nKey: 'nav.logs',
      },
      {
        id: 'request-trace',
        icon: 'IconSearch',
        to: '/console/request-trace',
        i18nKey: 'nav.requestTrace',
      },
      {
        id: 'analytics',
        icon: 'IconLineChartStroked',
        to: '/console/analytics',
        i18nKey: 'nav.analytics',
      },
    ],
  },
  {
    group: 'BILLING',
    i18nKey: 'nav.group.billing',
    items: [
      {
        id: 'topup',
        icon: 'IconCreditCard',
        to: '/console/topup',
        i18nKey: 'nav.topup',
      },
      {
        id: 'subscription',
        icon: 'IconGift',
        to: '/console/subscription',
        i18nKey: 'nav.subscription',
      },
      {
        id: 'redemption',
        icon: 'IconTicketCode',
        to: '/console/redemption',
        i18nKey: 'nav.redemption',
      },
      {
        id: 'invoices',
        icon: 'IconFile',
        to: '/console/invoice',
        i18nKey: 'nav.invoices',
      },
    ],
  },
  {
    group: 'DEVELOP',
    i18nKey: 'nav.group.develop',
    items: [
      {
        id: 'api-keys',
        icon: 'IconKey',
        to: '/console/token',
        i18nKey: 'nav.apiKeys',
      },
      {
        id: 'playground',
        icon: 'IconCode',
        to: '/console/playground',
        i18nKey: 'nav.playground',
      },
      {
        id: 'chat',
        icon: 'IconComment',
        to: '/console/chat',
        i18nKey: 'nav.chat',
      },
      {
        id: 'models',
        icon: 'IconBox',
        to: '/pricing',
        i18nKey: 'nav.modelsAndPricing',
      },
    ],
  },
  {
    group: 'SUPPORT',
    i18nKey: 'nav.group.support',
    items: [
      {
        id: 'tickets',
        icon: 'IconHelpCircle',
        to: '/console/tickets',
        i18nKey: 'nav.tickets',
      },
      {
        id: 'inbox',
        icon: 'IconMail',
        to: '/console/inbox',
        i18nKey: 'nav.inbox',
      },
    ],
  },
  {
    group: 'TENANT_ADMIN',
    requireRole: 'tenant_admin',
    i18nKey: 'nav.group.tenant',
    items: [
      {
        id: 'tenant-dashboard',
        icon: 'IconServer',
        to: '/console/tenant-dashboard',
        i18nKey: 'nav.tenantDashboard',
      },
      {
        id: 'tenant-members',
        icon: 'IconUserGroup',
        to: '/console/tenant-members',
        i18nKey: 'nav.members',
      },
      {
        id: 'tenant-plan',
        icon: 'IconGift',
        to: '/console/tenant-plan',
        i18nKey: 'nav.plan',
      },
      {
        id: 'tenant-config',
        icon: 'IconSetting',
        to: '/console/tenant-config',
        i18nKey: 'nav.tenantConfig',
      },
      {
        id: 'tenant-bills',
        icon: 'IconNoteMoneyStroked',
        to: '/console/tenant-bills',
        i18nKey: 'nav.tenantBills',
      },
      {
        id: 'tenant-alerts',
        icon: 'IconBell',
        to: '/console/tenant-alerts',
        i18nKey: 'nav.alerts',
      },
      {
        id: 'tenant-audit',
        icon: 'IconShield',
        to: '/console/tenant-audit',
        i18nKey: 'nav.audit',
      },
      {
        id: 'channels',
        icon: 'IconLink',
        to: '/console/channel',
        i18nKey: 'nav.channels',
      },
    ],
  },
  {
    group: 'PLATFORM',
    requireRole: 'super_admin',
    i18nKey: 'nav.group.platform',
    items: [
      {
        id: 'tenants',
        icon: 'IconHome',
        to: '/console/platform-tenants',
        i18nKey: 'nav.platformTenants',
      },
      {
        id: 'agents',
        icon: 'IconUser',
        to: '/console/agent-log',
        i18nKey: 'nav.agents',
      },
      {
        id: 'admin-invoices',
        icon: 'IconFile',
        to: '/console/invoice-admin',
        i18nKey: 'nav.adminInvoices',
      },
      {
        id: 'admin-tickets',
        icon: 'IconHelpCircle',
        to: '/console/tickets-admin',
        i18nKey: 'nav.adminTickets',
      },
      {
        id: 'site-settings',
        icon: 'IconSetting',
        to: '/console/setting',
        i18nKey: 'nav.siteSettings',
      },
    ],
  },
];

export function useNavItems() {
  const [userState] = useContext(UserContext);
  const { t } = useTranslation();
  const user = userState.user;

  return useMemo(() => {
    return RAW_GROUPS.filter((g) => {
      if (g.requireRole === 'tenant_admin') return isTenantAdmin(user);
      if (g.requireRole === 'super_admin') return isSuperAdmin(user);
      return true;
    }).map((g) => ({
      ...g,
      label: t(g.i18nKey),
      items: g.items.map((it) => ({ ...it, label: t(it.i18nKey) })),
    }));
  }, [user, t]);
}
