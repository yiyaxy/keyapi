import { userStore } from '@/store/user.js'

function ceilPoints(value) {
  if (!Number.isFinite(value)) return 0
  if (value >= 0) return Math.ceil(value - 1e-9)
  return Math.floor(value + 1e-9)
}

export function quotaToPoints(quota) {
  const n = Number(quota) || 0
  const quotaPerUnit = Number(userStore.quotaPerUnit) || 500000
  const rate = Number(userStore.usdExchangeRate) || 1
  return ceilPoints((n / quotaPerUnit) * rate * 100)
}

export function renderQuota(quota) {
  return quotaToPoints(quota).toLocaleString() + '积分'
}
