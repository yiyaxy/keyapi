import { DEFAULT_LANG } from '@/const/locale';

import type resources from './default';

export const locales = ['zh-CN', 'en-US'] as const;

export type DefaultResources = typeof resources;
export type NS = keyof DefaultResources;
export type Locales = (typeof locales)[number];

export const normalizeLocale = (locale?: string): Locales => {
  if (!locale) return DEFAULT_LANG;

  const normalized = locale.replace('_', '-').toLowerCase();

  if (normalized.startsWith('zh') || normalized.startsWith('cn')) return 'zh-CN';
  if (normalized.startsWith('en')) return 'en-US';

  return DEFAULT_LANG;
};

type LocaleOptions = {
  label: string;
  value: Locales;
}[];

export const localeOptions: LocaleOptions = [
  {
    label: '简体中文',
    value: 'zh-CN',
  },
  {
    label: 'English',
    value: 'en-US',
  },
] as LocaleOptions;

export const supportLocales: string[] = [...locales, 'zh', 'en'];
