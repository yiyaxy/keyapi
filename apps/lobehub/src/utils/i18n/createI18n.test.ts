// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const loadI18nNamespaceModule = vi.fn(async ({ lng, ns }: { lng: string; ns: string }) => ({
  default: {
    key: `${lng}:${ns}`,
  },
}));

vi.mock('./loadI18nNamespaceModule', () => ({
  loadI18nNamespaceModule,
}));

describe('createI18nNext', () => {
  it('initializes synchronously with bundled default Chinese resources', async () => {
    const { createI18nNext } = await import('@/locales/create');

    const i18n = createI18nNext('zh-CN');
    const reloadSpy = vi.spyOn(i18n.instance, 'reloadResources');
    const initPromise = i18n.init({ initAsync: false });

    expect(i18n.instance.isInitialized).toBe(true);
    expect(i18n.instance.getResource('zh-CN', 'common', 'copy')).toBeDefined();

    await initPromise;
    await Promise.resolve();
    await Promise.resolve();

    expect(i18n.instance.hasResourceBundle('zh-CN', 'common')).toBe(true);
    expect(i18n.instance.hasResourceBundle('zh-CN', 'chat')).toBe(true);
    expect(i18n.instance.hasResourceBundle('zh-CN', 'error')).toBe(true);

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(loadI18nNamespaceModule).not.toHaveBeenCalled();
  });
});
