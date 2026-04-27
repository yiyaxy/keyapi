/**
 * 额度渲染工具，逻辑与 PC 端 render.jsx renderQuota 完全一致
 *
 * 依赖 userStore 中的：
 *   quotaPerUnit        — 从 /api/status quota_per_unit
 *   quotaDisplayType    — 'USD' | 'CNY' | 'CUSTOM' | 'TOKENS'
 *   usdExchangeRate     — usd_exchange_rate
 *   customCurrencySymbol
 *   customCurrencyRate
 */
import { userStore } from '@/store/user.js'

export function renderQuota(quota, digits = 2) {
  const n = Number(quota) || 0
  const {
    quotaPerUnit,
    quotaDisplayType,
    usdExchangeRate,
    customCurrencySymbol,
    customCurrencyRate,
  } = userStore

  if (quotaDisplayType === 'TOKENS') {
    return n.toLocaleString()
  }

  const usdValue = n / quotaPerUnit

  if (quotaDisplayType === 'CNY') {
    const cny = usdValue * (usdExchangeRate || 1)
    return '¥' + cny.toFixed(digits)
  }

  if (quotaDisplayType === 'CUSTOM') {
    const val = usdValue * (customCurrencyRate || 1)
    return (customCurrencySymbol || '¤') + val.toFixed(digits)
  }

  // 默认 USD
  return '$' + usdValue.toFixed(digits)
}
