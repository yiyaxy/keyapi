import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import enAuth from './locales/en/auth.json';
import enCommon from './locales/en/common.json';
import enDashboard from './locales/en/dashboard.json';
import enErrors from './locales/en/errors.json';
import enKeys from './locales/en/keys.json';
import enLogs from './locales/en/logs.json';
import enShell from './locales/en/shell.json';
import zhAuth from './locales/zh/auth.json';
import zhCommon from './locales/zh/common.json';
import zhDashboard from './locales/zh/dashboard.json';
import zhErrors from './locales/zh/errors.json';
import zhKeys from './locales/zh/keys.json';
import zhLogs from './locales/zh/logs.json';
import zhShell from './locales/zh/shell.json';

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
      },
      en: {
        common: enCommon,
        auth: enAuth,
        shell: enShell,
        errors: enErrors,
        keys: enKeys,
        dashboard: enDashboard,
        logs: enLogs,
      },
    },
    fallbackLng: 'zh',
    supportedLngs: ['zh', 'en'],
    ns: ['common', 'auth', 'shell', 'errors', 'keys', 'dashboard', 'logs'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'new-api.lang',
    },
  });

export default i18n;
