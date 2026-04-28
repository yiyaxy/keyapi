import { describe, expect, it, vi } from 'vitest';

import { getUILocaleAndResources } from './getUILocaleAndResources';

describe('getUILocaleAndResources', () => {
  it('should return zh-CN locale and zhCn resources for zh-CN', async () => {
    const result = await getUILocaleAndResources('zh-CN');
    expect(result.locale).toBe('zh-CN');
    expect(result.resources).toBeDefined();
  });

  it('should normalize zh-TW to zh-CN because only simplified Chinese is shipped', async () => {
    const result = await getUILocaleAndResources('zh-TW');
    expect(result.locale).toBe('zh-CN');
    expect(result.resources).toBeDefined();
  });

  it('should return en-US locale and en resources for English', async () => {
    expect((await getUILocaleAndResources('en-US')).locale).toBe('en-US');
    expect((await getUILocaleAndResources('en')).locale).toBe('en-US');
  });

  it('should use zh-CN for auto and unsupported locales', async () => {
    expect((await getUILocaleAndResources('auto')).locale).toBe('zh-CN');
    expect((await getUILocaleAndResources('unknown-locale')).locale).toBe('zh-CN');
  });

  it('should fallback to @lobehub/ui builtin resources if business ui.json is missing', async () => {
    vi.resetModules();
    vi.doMock('@/../locales/zh-CN/ui.json', () => ({ default: null }));

    const { getUILocaleAndResources: getWithFallback } = await import('./getUILocaleAndResources');
    const result = await getWithFallback('unknown-locale');
    expect(result.locale).toBe('zh-CN');
    expect(result.resources).toBeDefined();
  });
});
