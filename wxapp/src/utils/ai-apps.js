export const WXAPP_CHAT_APP_SLUG = 'wxapp-chat'

const WXAPP_CHAT_APP_KEYS = [
  WXAPP_CHAT_APP_SLUG,
  'wxapp-ai-chat',
  'wx-mini-chat',
  'miniapp-chat',
  'mini-program-chat',
  'mp-chat',
]

function normalizeTokens(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[,\uFF0C\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function isWxappChatApp(app) {
  const slug = String((app && app.slug) || '').toLowerCase()
  const tags = normalizeTokens((app && app.tags) || '')
  return WXAPP_CHAT_APP_KEYS.includes(slug) || tags.some((tag) => WXAPP_CHAT_APP_KEYS.includes(tag))
}

export function findWxappChatApp(apps) {
  return (Array.isArray(apps) ? apps : []).find(isWxappChatApp) || null
}

export function filterMarketplaceApps(apps) {
  return (Array.isArray(apps) ? apps : []).filter((app) => !isWxappChatApp(app))
}
