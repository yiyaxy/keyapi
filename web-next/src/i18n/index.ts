import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import enAccount from './locales/en/account.json';
import enAff from './locales/en/aff.json';
import enAgent from './locales/en/agent.json';
import enAnalytics from './locales/en/analytics.json';
import enAuth from './locales/en/auth.json';
import enChannels from './locales/en/channels.json';
import enCommon from './locales/en/common.json';
import enDashboard from './locales/en/dashboard.json';
import enErrors from './locales/en/errors.json';
import enInbox from './locales/en/inbox.json';
import enInvoice from './locales/en/invoice.json';
import enIp from './locales/en/ip.json';
import enKeys from './locales/en/keys.json';
import enLogs from './locales/en/logs.json';
import enMessage from './locales/en/message.json';
import enModels from './locales/en/models.json';
import enOps from './locales/en/ops.json';
import enOrders from './locales/en/orders.json';
import enPlan from './locales/en/plan.json';
import enPlatform from './locales/en/platform.json';
import enPrompt from './locales/en/prompt.json';
import enPublic from './locales/en/public.json';
import enRebate from './locales/en/rebate.json';
import enRedemption from './locales/en/redemption.json';
import enSettings from './locales/en/settings.json';
import enSetup from './locales/en/setup.json';
import enShell from './locales/en/shell.json';
import enTenant from './locales/en/tenant.json';
import enTenantPay from './locales/en/tenantpay.json';
import enTickets from './locales/en/tickets.json';
import enTopup from './locales/en/topup.json';
import enUsers from './locales/en/users.json';
import zhAccount from './locales/zh/account.json';
import zhAff from './locales/zh/aff.json';
import zhAgent from './locales/zh/agent.json';
import zhAnalytics from './locales/zh/analytics.json';
import zhAuth from './locales/zh/auth.json';
import zhChannels from './locales/zh/channels.json';
import zhCommon from './locales/zh/common.json';
import zhDashboard from './locales/zh/dashboard.json';
import zhErrors from './locales/zh/errors.json';
import zhInbox from './locales/zh/inbox.json';
import zhInvoice from './locales/zh/invoice.json';
import zhIp from './locales/zh/ip.json';
import zhKeys from './locales/zh/keys.json';
import zhLogs from './locales/zh/logs.json';
import zhMessage from './locales/zh/message.json';
import zhModels from './locales/zh/models.json';
import zhOps from './locales/zh/ops.json';
import zhOrders from './locales/zh/orders.json';
import zhPlan from './locales/zh/plan.json';
import zhPlatform from './locales/zh/platform.json';
import zhPrompt from './locales/zh/prompt.json';
import zhPublic from './locales/zh/public.json';
import zhRebate from './locales/zh/rebate.json';
import zhRedemption from './locales/zh/redemption.json';
import zhSettings from './locales/zh/settings.json';
import zhSetup from './locales/zh/setup.json';
import zhShell from './locales/zh/shell.json';
import zhTenant from './locales/zh/tenant.json';
import zhTenantPay from './locales/zh/tenantpay.json';
import zhTickets from './locales/zh/tickets.json';
import zhTopup from './locales/zh/topup.json';
import zhUsers from './locales/zh/users.json';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      zh: {
        common: zhCommon,
        auth: zhAuth,
        shell: zhShell,
        errors: zhErrors,
        keys: zhKeys,
        dashboard: zhDashboard,
        logs: zhLogs,
        account: zhAccount,
        topup: zhTopup,
        channels: zhChannels,
        users: zhUsers,
        redemption: zhRedemption,
        tenant: zhTenant,
        inbox: zhInbox,
        tickets: zhTickets,
        public: zhPublic,
        setup: zhSetup,
        platform: zhPlatform,
        invoice: zhInvoice,
        plan: zhPlan,
        ops: zhOps,
        models: zhModels,
        orders: zhOrders,
        aff: zhAff,
        rebate: zhRebate,
        prompt: zhPrompt,
        message: zhMessage,
        agent: zhAgent,
        ip: zhIp,
        analytics: zhAnalytics,
        settings: zhSettings,
        tenantpay: zhTenantPay,
      },
      en: {
        common: enCommon,
        auth: enAuth,
        shell: enShell,
        errors: enErrors,
        keys: enKeys,
        dashboard: enDashboard,
        logs: enLogs,
        account: enAccount,
        topup: enTopup,
        channels: enChannels,
        users: enUsers,
        redemption: enRedemption,
        tenant: enTenant,
        inbox: enInbox,
        tickets: enTickets,
        public: enPublic,
        setup: enSetup,
        platform: enPlatform,
        invoice: enInvoice,
        plan: enPlan,
        ops: enOps,
        models: enModels,
        orders: enOrders,
        aff: enAff,
        rebate: enRebate,
        prompt: enPrompt,
        message: enMessage,
        agent: enAgent,
        ip: enIp,
        analytics: enAnalytics,
        settings: enSettings,
        tenantpay: enTenantPay,
      },
    },
    fallbackLng: 'zh',
    supportedLngs: ['zh', 'en'],
    ns: [
      'common',
      'auth',
      'shell',
      'errors',
      'keys',
      'dashboard',
      'logs',
      'account',
      'topup',
      'channels',
      'users',
      'redemption',
      'tenant',
      'inbox',
      'tickets',
      'public',
      'setup',
      'platform',
      'invoice',
      'plan',
      'ops',
      'models',
      'orders',
      'aff',
      'rebate',
      'prompt',
      'message',
      'agent',
      'ip',
      'analytics',
      'settings',
      'tenantpay',
    ],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'new-api.lang',
    },
  });

export default i18n;
