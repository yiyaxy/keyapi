import { describe, expect, it } from 'vitest';

import { parseBrowserLanguage } from './locale';

describe('parseBrowserLanguage', () => {
  const createHeaders = (acceptLanguage?: string) => {
    const headers = new Headers();
    if (acceptLanguage) headers.set('accept-language', acceptLanguage);
    return headers;
  };

  it('should return zh-CN by default', () => {
    expect(parseBrowserLanguage(createHeaders())).toBe('zh-CN');
  });

  it('should keep the provided non-English default language', () => {
    expect(parseBrowserLanguage(createHeaders('en-US,en;q=0.9'), 'zh-CN')).toBe('zh-CN');
  });

  it('should resolve between Chinese and English when en-US is explicitly used as default', () => {
    expect(parseBrowserLanguage(createHeaders('en-US,en;q=0.9'), 'en-US')).toBe('en-US');
    expect(parseBrowserLanguage(createHeaders('zh-CN,zh;q=0.9,en;q=0.8'), 'en-US')).toBe('zh-CN');
  });

  it('should fallback unsupported browser languages to the provided default', () => {
    expect(parseBrowserLanguage(createHeaders('fr-FR,fr;q=0.9'), 'en-US')).toBe('en-US');
  });
});
