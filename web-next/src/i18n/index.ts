import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import enAuth from './locales/en/auth.json';
import enCommon from './locales/en/common.json';
import enErrors from './locales/en/errors.json';
import enShell from './locales/en/shell.json';
import zhAuth from './locales/zh/auth.json';
import zhCommon from './locales/zh/common.json';
import zhErrors from './locales/zh/errors.json';
import zhShell from './locales/zh/shell.json';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      zh: { common: zhCommon, auth: zhAuth, shell: zhShell, errors: zhErrors },
      en: { common: enCommon, auth: enAuth, shell: enShell, errors: enErrors },
    },
    fallbackLng: 'zh',
    supportedLngs: ['zh', 'en'],
    ns: ['common', 'auth', 'shell', 'errors'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'new-api.lang',
    },
  });

export default i18n;
