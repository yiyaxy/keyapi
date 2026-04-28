// Shared route variants utilities for desktop and web builds

export const DEFAULT_LANG = 'zh-CN';

// Supported locales (keep aligned with web resources)
export const locales = [
  'zh-CN',
  'en-US',
] as const;

export type Locales = (typeof locales)[number];

export interface IRouteVariants {
  isMobile: boolean;
  locale: Locales;
  neutralColor?: string;
  primaryColor?: string;
}

export const DEFAULT_VARIANTS: IRouteVariants = {
  isMobile: false,
  locale: DEFAULT_LANG,
};

const SPLITTER = '__';

export class RouteVariants {
  static serializeVariants = (variants: IRouteVariants): string =>
    [variants.locale, Number(variants.isMobile)].join(SPLITTER);

  static deserializeVariants = (serialized: string): IRouteVariants => {
    try {
      const [locale, isMobile] = serialized.split(SPLITTER);

      return {
        isMobile: isMobile === '1',
        locale: RouteVariants.isValidLocale(locale) ? (locale as Locales) : DEFAULT_VARIANTS.locale,
      };
    } catch {
      return { ...DEFAULT_VARIANTS };
    }
  };

  static createVariants = (options: Partial<IRouteVariants> = {}): IRouteVariants => ({
    ...DEFAULT_VARIANTS,
    ...options,
  });

  private static isValidLocale = (locale: string): boolean => locales.includes(locale as any);
}
