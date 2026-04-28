import { normalizeLocale } from '@/locales/resources';

// Use antd ESM locale (es/locale) - CJS locale (locale/*.js) uses module.exports and breaks in Vite
const antdLocaleLoaders = import.meta.glob(
  '/node_modules/antd/es/locale/{en_US,zh_CN}.js',
);

export const getAntdLocale = async (lang?: string) => {
  let normalLang: any = normalizeLocale(lang);

  const localePath = `/node_modules/antd/es/locale/${normalLang.replace('-', '_')}.js`;
  const loadLocale = antdLocaleLoaders[localePath];

  if (!loadLocale) {
    throw new Error(`Unsupported antd locale: ${normalLang}`);
  }

  const mod = (await loadLocale()) as Record<string, unknown>;
  return mod.default;
};
