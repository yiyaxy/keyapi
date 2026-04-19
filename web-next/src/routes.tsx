import { createBrowserRouter } from 'react-router-dom';

import { AdminRoute } from '@/components/common/AdminRoute';
import { ComingSoon } from '@/components/common/ComingSoon';
import { Forbidden } from '@/components/common/Forbidden';
import { NotFound } from '@/components/common/NotFound';
import { ProtectedRoute } from '@/components/common/ProtectedRoute';
import { RootLayout } from '@/components/common/RootLayout';
import { RouteErrorFallback } from '@/components/common/RouteErrorFallback';
import { AppShell } from '@/components/layout/AppShell';
import { PublicLayout } from '@/components/public/PublicLayout';
import { AboutPage } from '@/pages/About';
import { AccountPage } from '@/pages/Account';
import { AffTransferAdminPage } from '@/pages/AffTransferAdmin';
import { AffTransferPage } from '@/pages/AffTransfer';
import { ChannelMonitorPage } from '@/pages/ChannelMonitor';
import { ChannelsAdminPage } from '@/pages/ChannelsAdmin';
import { DashboardPage } from '@/pages/Dashboard';
import { Forgot } from '@/pages/Forgot';
import { HomePage } from '@/pages/Home';
import { InboxPage } from '@/pages/Inbox';
import { InvoicesAdminPage } from '@/pages/InvoicesAdmin';
import { InvoicesPage } from '@/pages/Invoices';
import { KeysPage } from '@/pages/Keys';
import { LegalPage } from '@/pages/Legal';
import { Login } from '@/pages/Login';
import { LogsAdminPage } from '@/pages/LogsAdmin';
import { LogsPage } from '@/pages/Logs';
import { ModelsAdminPage } from '@/pages/ModelsAdmin';
import { PlanPage } from '@/pages/PlanPage';
import { PlatformTenantsPage } from '@/pages/PlatformTenants';
import { PricingPage } from '@/pages/Pricing';
import { PromptRuleAdminPage } from '@/pages/PromptRuleAdmin';
import { RebateSettingsAdminPage } from '@/pages/RebateSettingsAdmin';
import { RedemptionAdminPage } from '@/pages/RedemptionAdmin';
import { RequestTracePage } from '@/pages/RequestTrace';
import { SiteRPMPage } from '@/pages/SiteRPM';
import { SmartCachePage } from '@/pages/SmartCache';
import { SubscriptionAdminPage } from '@/pages/SubscriptionAdmin';
import { Register } from '@/pages/Register';
import { Reset } from '@/pages/Reset';
import { SetupPage } from '@/pages/Setup';
import { TenantAlertsPage } from '@/pages/TenantAlerts';
import { TenantAuditPage } from '@/pages/TenantAudit';
import { TenantBillsPage } from '@/pages/TenantBills';
import { TenantConfigPage } from '@/pages/TenantConfig';
import { TenantDashboardPage } from '@/pages/TenantDashboard';
import { TenantInfoPage } from '@/pages/TenantInfo';
import { TenantMembersPage } from '@/pages/TenantMembers';
import { TenantPlanPage } from '@/pages/TenantPlan';
import { TicketAdminDetailPage } from '@/pages/TicketAdminDetail';
import { TicketDetailPage } from '@/pages/TicketDetail';
import { TicketsAdminPage } from '@/pages/TicketsAdmin';
import { TicketsPage } from '@/pages/Tickets';
import { TopupPage } from '@/pages/Topup';
import { UsersAdminPage } from '@/pages/UsersAdmin';

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteErrorFallback />,
    children: [
      { path: '/login', element: <Login /> },
      { path: '/register', element: <Register /> },
      { path: '/forgot', element: <Forgot /> },
      { path: '/reset', element: <Reset /> },
      { path: '/user/reset', element: <Reset /> },
      { path: '/forbidden', element: <Forbidden /> },
      { path: '/setup', element: <SetupPage /> },
      {
        element: <PublicLayout />,
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/about', element: <AboutPage /> },
          { path: '/pricing', element: <PricingPage /> },
          { path: '/user-agreement', element: <LegalPage kind='terms' /> },
          { path: '/privacy-policy', element: <LegalPage kind='privacy' /> },
          { path: '/refund-policy', element: <LegalPage kind='refund' /> },
        ],
      },
      {
        element: <ProtectedRoute />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: '/dashboard', element: <DashboardPage /> },
              { path: '/keys', element: <KeysPage /> },
              { path: '/playground', element: <ComingSoon feature='Playground' /> },
              { path: '/logs', element: <LogsPage /> },
              { path: '/topup', element: <TopupPage /> },
              { path: '/plan', element: <PlanPage /> },
              { path: '/account', element: <AccountPage /> },
              { path: '/inbox', element: <InboxPage /> },
              { path: '/invoice', element: <InvoicesPage /> },
              { path: '/smart-cache', element: <SmartCachePage /> },
              { path: '/tickets', element: <TicketsPage /> },
              { path: '/tickets/:id', element: <TicketDetailPage /> },
              { path: '/aff-transfer', element: <AffTransferPage /> },
              { path: '/midjourney', element: <ComingSoon feature='Midjourney' /> },
              { path: '/task', element: <ComingSoon feature='Async tasks' /> },
              { path: '/chat/:id?', element: <ComingSoon feature='Chat' /> },
              { path: '/chat2link', element: <ComingSoon feature='Chat2Link' /> },
              {
                element: <AdminRoute />,
                children: [
                  { path: '/admin/channels', element: <ChannelsAdminPage /> },
                  { path: '/admin/users', element: <UsersAdminPage /> },
                  { path: '/admin/redemption', element: <RedemptionAdminPage /> },
                  { path: '/admin/logs', element: <LogsAdminPage /> },
                  { path: '/admin/tickets', element: <TicketsAdminPage /> },
                  { path: '/admin/tickets/:id', element: <TicketAdminDetailPage /> },
                  { path: '/admin/invoices', element: <InvoicesAdminPage /> },
                  {
                    path: '/admin/subscriptions',
                    element: <SubscriptionAdminPage />,
                  },
                  { path: '/admin/site-rpm', element: <SiteRPMPage /> },
                  {
                    path: '/admin/channel-monitor',
                    element: <ChannelMonitorPage />,
                  },
                  {
                    path: '/admin/analytics',
                    element: <ComingSoon feature='Analytics' />,
                  },
                  {
                    path: '/admin/purchase',
                    element: <ComingSoon feature='Purchase orders' />,
                  },
                  {
                    path: '/admin/purchase-analytics',
                    element: <ComingSoon feature='Purchase analytics' />,
                  },
                  {
                    path: '/admin/ip-analysis',
                    element: <ComingSoon feature='IP analysis' />,
                  },
                  { path: '/admin/prompt-rule', element: <PromptRuleAdminPage /> },
                  {
                    path: '/admin/aff-transfer',
                    element: <AffTransferAdminPage />,
                  },
                  {
                    path: '/admin/rebate-settings',
                    element: <RebateSettingsAdminPage />,
                  },
                  {
                    path: '/admin/message',
                    element: <ComingSoon feature='Message center' />,
                  },
                  {
                    path: '/admin/agent-log',
                    element: <ComingSoon feature='Agent log' />,
                  },
                  {
                    path: '/admin/agent-report',
                    element: <ComingSoon feature='Agent report' />,
                  },
                  { path: '/admin/request-trace', element: <RequestTracePage /> },
                  {
                    path: '/admin/request-trace/:requestId',
                    element: <RequestTracePage />,
                  },
                  {
                    path: '/admin/settings',
                    element: <ComingSoon feature='System settings' />,
                  },
                  { path: '/tenant/dashboard', element: <TenantDashboardPage /> },
                  { path: '/tenant/info', element: <TenantInfoPage /> },
                  { path: '/tenant/members', element: <TenantMembersPage /> },
                  { path: '/tenant/plan', element: <TenantPlanPage /> },
                  { path: '/tenant/bills', element: <TenantBillsPage /> },
                  { path: '/tenant/alerts', element: <TenantAlertsPage /> },
                  { path: '/tenant/config', element: <TenantConfigPage /> },
                  { path: '/tenant/audit', element: <TenantAuditPage /> },
                ],
              },
              {
                element: <AdminRoute minRole={100} />,
                children: [
                  {
                    path: '/admin/platform-tenants',
                    element: <PlatformTenantsPage />,
                  },
                  { path: '/admin/models', element: <ModelsAdminPage /> },
                  {
                    path: '/admin/deployment',
                    element: <ComingSoon feature='Model deployment' />,
                  },
                  {
                    path: '/admin/ticket-storage',
                    element: <ComingSoon feature='Ticket storage' />,
                  },
                ],
              },
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
]);
