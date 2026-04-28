/**
 * Normalize language code
 */
export const normalizeLocale = (locale: string) => {
  const normalized = locale.toLowerCase().replace('_', '-');

  if (normalized.startsWith('zh') || normalized.startsWith('cn')) return 'zh-CN';
  if (normalized.startsWith('en')) return 'en';

  return 'zh-CN';
};

/**
 * Load translation resources on demand
 */
export const loadResources = async (lng: string, ns: string) => {
  const normalizedLng = normalizeLocale(lng);

  // All en-* locales fallback to 'en' and use default TypeScript files
  if (normalizedLng === 'en') {
    try {
      const { default: content } = await import(`@/locales/default/${ns}.ts`);

      return content;
    } catch (error) {
      console.error(`[I18n] Unable to load translation file: ${ns}`, error);
      return {};
    }
  }

  try {
    const { default: content } = await import(`@/../../resources/locales/${normalizedLng}/${ns}.json`);

    return content;
  } catch (error) {
    console.error(`Unable to load translation file: ${normalizedLng} - ${ns}`, error);
    return {};
  }
};
