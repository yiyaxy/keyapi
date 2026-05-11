import type { AiApp } from '@/hooks/useAiApps';

export const WXAPP_CHAT_APP_SLUG = 'wxapp-chat';

const WXAPP_CHAT_APP_KEYS = new Set([
  WXAPP_CHAT_APP_SLUG,
  'wxapp-ai-chat',
  'wx-mini-chat',
  'miniapp-chat',
  'mini-program-chat',
  'mp-chat',
]);

function normalizeTags(tags?: string) {
  return (tags || '')
    .toLowerCase()
    .split(/[,\uFF0C\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function isWxappChatApp(app: Pick<AiApp, 'slug' | 'tags'>) {
  const slug = (app.slug || '').toLowerCase();
  return WXAPP_CHAT_APP_KEYS.has(slug) || normalizeTags(app.tags).some((tag) => WXAPP_CHAT_APP_KEYS.has(tag));
}

export function filterMarketplaceApps<T extends Pick<AiApp, 'slug' | 'tags'>>(apps: T[]) {
  return apps.filter((app) => !isWxappChatApp(app));
}
