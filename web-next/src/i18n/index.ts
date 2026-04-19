import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import enAccount from './locales/en/account.json';
import enAuth from './locales/en/auth.json';
import enChannels from './locales/en/channels.json';
import enCommon from './locales/en/common.json';
import enDashboard from './locales/en/dashboard.json';
import enErrors from './locales/en/errors.json';
import enInbox from './locales/en/inbox.json';
import enKeys from './locales/en/keys.json';
import enLogs from './locales/en/logs.json';
import enPublic from './locales/en/public.json';
import enRedemption from './locales/en/redemption.json';
import enSetup from './locales/en/setup.json';
import enShell from './locales/en/shell.json';
import enTenant from './locales/en/tenant.json';
import enTickets from './locales/en/tickets.json';
import enTopup from './locales/en/topup.json';
import enUsers from './locales/en/users.json';
import zhAccount from './locales/zh/account.json';
import zhAuth from './locales/zh/auth.json';
import zhChannels from './locales/zh/channels.json';
import zhCommon from './locales/zh/common.json';
import zhDashboard from './locales/zh/dashboard.json';
import zhErrors from './locales/zh/errors.json';
import zhInbox from './locales/zh/inbox.json';
import zhKeys from './locales/zh/keys.json';
import zhLogs from './locales/zh/logs.json';
import zhPublic from './locales/zh/public.json';
import zhRedemption from './locales/zh/redemption.json';
import zhSetup from './locales/zh/setup.json';
import zhShell from './locales/zh/shell.json';
import zhTenant from './locales/zh/tenant.json';
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
