import { userStore } from '@/store/user.js'

const PENDING_INVITER_KEY = 'pending_inviter_id'
const SHARE_TITLE = 'ALl Models'
const SHARE_IMAGE_URL = 'https://power-sass.oss-cn-beijing.aliyuncs.com/activitySuppement/APIToken/token-share.png'

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value
}

export function captureInviteSource(options = {}) {
  const query = options.query || options || {}
  const raw = firstValue(query.i || query.inviter_id || query.inviterId)
  const inviterId = Number(raw || 0)
  if (Number.isInteger(inviterId) && inviterId > 0) {
    uni.setStorageSync(PENDING_INVITER_KEY, inviterId)
  }
}

export function getPendingInviterId() {
  const inviterId = Number(uni.getStorageSync(PENDING_INVITER_KEY) || 0)
  return Number.isInteger(inviterId) && inviterId > 0 ? inviterId : 0
}

export function clearPendingInviterId() {
  uni.removeStorageSync(PENDING_INVITER_KEY)
}

export function buildSharePath(page = '/pages/home/index') {
  const inviterId = Number(userStore.userInfo?.id || 0)
  if (!inviterId) return page
  return `${page}?i=${encodeURIComponent(inviterId)}`
}

export function buildShareMessage(options = {}) {
  const title = options.title || `来 ${SHARE_TITLE} 领取你的 AI 接口额度`
  const path = options.path || buildSharePath()
  const message = { title, path }
  if (SHARE_IMAGE_URL) message.imageUrl = SHARE_IMAGE_URL
  return message
}

export function registerShareMenu() {
  if (typeof uni.showShareMenu !== 'function') return
  uni.showShareMenu({
    withShareTicket: true,
    menus: ['shareAppMessage', 'shareTimeline'],
  })
}
