import { normalizeLocale } from '@/locales/resources';

// eager: true — antd locale fully inlined at build time
const antdLocaleModules = import.meta.glob(
  '/node_modules/antd/es/locale/{en_US,zh_CN}.js',
  { eager: true },
);

export const getAntdLocale = async (lang?: string) => {
  let normalLang: any = normalizeLocale(lang);

  const localePath = `/node_modules/antd/es/locale/${normalLang.replace('-', '_')}.js`;
  const mod = antdLocaleModules[localePath];

  if (!mod) {
    throw new Error(`Unsupported antd locale: ${normalLang}`);
  }

  return (mod as any).default;
};
