<template>
  <view class="page">
    <view class="bg-glow bg-glow-1" />
    <view class="bg-glow bg-glow-2" />

    <scroll-view scroll-y class="scroll" refresher-enabled :refresher-triggered="refreshing" @refresherrefresh="refresh">
      <view class="content" :style="{ paddingTop: (statusBarH + 24) + 'px' }">
        <view class="head">
          <view class="head-main">
            <text class="eyebrow">APP CENTER</text>
            <text class="head-title">AI 应用中心</text>
            <text class="head-sub">使用平台 Token，直接体验已接入的 AI 应用</text>
          </view>
          <view v-if="userStore.wxPayEnabled" class="quota-pill">
            <u-icon name="server-fill" size="17" color="#111827" />
            <view class="quota-text">
              <text class="quota-num">{{ tokenStr(userInfo?.quota) }}</text>
              <text class="quota-label">Tokens</text>
            </view>
          </view>
        </view>

        <view class="search-box">
          <u-icon name="search" size="18" color="#9ca3af" />
          <input
            v-model="search"
            class="search-input"
            confirm-type="search"
            placeholder="搜索应用名称或标签"
            placeholder-class="search-placeholder"
          />
          <view v-if="search" class="search-clear" @click="search = ''">
            <u-icon name="close" size="14" color="#9ca3af" />
          </view>
        </view>

        <view class="native-chat-panel">
          <view class="native-chat-head">
            <view class="native-chat-heading">
              <view class="native-chat-icon">
                <text>AI</text>
              </view>
              <view class="native-chat-title-wrap">
                <text class="native-chat-kicker">AI CHAT</text>
                <text class="native-chat-title">AI 快捷使用</text>
              </view>
            </view>
          </view>
          <view class="native-chat-box" @click="focusQuickChat">
            <textarea
              v-model="quickChatInput"
              class="native-chat-input"
              auto-height
              maxlength="1000"
              :focus="quickChatFocus"
              placeholder="直接问问模型：帮我写一段小程序介绍..."
              placeholder-class="native-chat-placeholder"
              @blur="quickChatFocus = false"
            />
          </view>
          <view class="native-chat-actions">
            <view class="native-chat-tip">
              <u-icon name="server-fill" size="14" color="#6b7280" />
              <text>使用你的平台余额结算</text>
            </view>
            <view class="native-chat-buttons">
              <view class="native-chat-btn secondary" @click="openNativeChat('', 'image')">
                <text>图片生成</text>
              </view>
              <view class="native-chat-btn" @click="openNativeChat(quickChatInput, 'chat')">
                <text>{{ quickChatInput.trim() ? '开始对话' : '打开聊天' }}</text>
                <u-icon name="arrow-rightward" size="15" color="#111827" />
              </view>
            </view>
          </view>
        </view>

        <view v-if="loading" class="state-list">
          <view v-for="i in 4" :key="i" class="skeleton-card">
            <view class="skeleton-icon" />
            <view class="skeleton-line w1" />
            <view class="skeleton-line w2" />
            <view class="skeleton-line w3" />
          </view>
        </view>

        <view v-else-if="loadError" class="empty-card">
          <u-icon name="warning" size="28" color="#ef4444" />
          <text class="empty-title">应用列表加载失败</text>
          <text class="empty-desc">请检查网络或后台 /api/app 接口</text>
          <view class="retry-btn" @click="loadApps">
            <text class="retry-text">重新加载</text>
          </view>
        </view>

        <view v-else class="app-list">
          <view
            v-for="(app, index) in filteredApps"
            :key="app.id || app.slug"
            class="app-card"
            :style="{ background: cardBackground(app, index) }"
            @click="useApp(app)"
          >
            <view class="app-top">
              <image v-if="app.icon_url" class="app-icon-img" :src="assetUrl(app.icon_url)" mode="aspectFill" />
              <view v-else class="app-icon-fallback">
                <text class="app-icon-letter">{{ firstLetter(app.name) }}</text>
              </view>

              <view class="app-info">
                <view class="app-title-row">
                  <text class="app-title">{{ app.name }}</text>
                </view>
                <view v-if="tagsOf(app).length" class="tag-row">
                  <text v-for="tag in tagsOf(app)" :key="tag" class="tag">{{ tag }}</text>
                </view>
              </view>
            </view>

            <text class="app-desc">{{ app.description || '这个应用暂未填写介绍' }}</text>

            <view class="app-actions">
              <view class="use-btn" :class="{ disabled: activeSlug === app.slug }">
                <u-loading-icon v-if="activeSlug === app.slug" size="28" color="#111827" />
                <u-icon v-else name="arrow-rightward" size="16" color="#111827" />
                <text class="use-text">{{ activeSlug === app.slug ? '准备中' : '立即使用' }}</text>
              </view>
            </view>
          </view>

          <view v-if="filteredApps.length === 0" class="empty-inline">
            <text>{{ search ? '没有找到匹配应用' : '暂无其他可用应用' }}</text>
          </view>
        </view>

        <view style="height: 180rpx;" />
      </view>
    </scroll-view>

    <tab-bar active="apps" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getAppSessionToken, getPublicApps, getSelf } from '@/services/api.js'
import env from '@/config/env.js'
import { userStore } from '@/store/user.js'

const statusBarH = ref(0)
const apps = ref([])
const loading = ref(false)
const refreshing = ref(false)
const loadError = ref(false)
const search = ref('')
const activeSlug = ref('')
const userInfo = ref(null)
const quickChatInput = ref('')
const quickChatFocus = ref(false)

const filteredApps = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  if (!keyword) return apps.value
  return apps.value.filter((app) => {
    const haystack = `${app.name || ''} ${app.description || ''} ${app.tags || ''}`.toLowerCase()
    return haystack.includes(keyword)
  })
})

const cardGradients = [
  'linear-gradient(135deg, #2a2a2a 0%, #4a3f3a 100%)',
  'linear-gradient(135deg, #5a4a3a 0%, #2a1f15 100%)',
  'linear-gradient(135deg, #1f2937 0%, #4a3a2f 100%)',
  'linear-gradient(135deg, #6b3a3a 0%, #2a1818 100%)',
  'linear-gradient(135deg, #22322c 0%, #141c18 100%)',
  'linear-gradient(135deg, #2e3140 0%, #161822 100%)',
]

function tokenStr(q) {
  return Number(q || 0).toLocaleString()
}

function firstLetter(name) {
  return String(name || 'A').slice(0, 1).toUpperCase()
}

function tagsOf(app) {
  return String(app.tags || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 4)
}

function cardBackground(app, index) {
  const seed = String(app?.slug || app?.name || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return cardGradients[(seed + index) % cardGradients.length]
}

function assetUrl(url) {
  const value = String(url || '').trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  return `${env.basePath.replace(/\/$/, '')}/${value.replace(/^\//, '')}`
}

function toAbsoluteTarget(rawUrl) {
  const value = String(rawUrl || '').trim()
  const base = env.basePath.replace(/\/$/, '')
  if (!value) return `${base}/`
  if (/^https?:\/\//i.test(value)) return value
  return value.startsWith('/') ? `${base}${value}` : `${base}/${value}`
}

function setQueryParam(url, key, value) {
  const hashIndex = url.indexOf('#')
  const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : ''
  const queryIndex = beforeHash.indexOf('?')
  const path = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : ''
  const encodedKey = encodeURIComponent(key)
  const nextQuery = query
    .split('&')
    .filter(Boolean)
    .filter((item) => decodeURIComponent(item.split('=')[0] || '') !== key)
  nextQuery.push(`${encodedKey}=${encodeURIComponent(value)}`)
  return `${path}?${nextQuery.join('&')}${hash}`
}

function urlOrigin(url) {
  const match = String(url || '').match(/^(https?:\/\/[^/?#]+)/i)
  return match ? match[1].replace(/\/$/, '').toLowerCase() : ''
}

function pathWithSearchAndHash(url) {
  const value = String(url || '')
  const match = value.match(/^https?:\/\/[^/?#]+(.*)$/i)
  return match ? (match[1] || '/') : '/'
}

function buildTokenHandoffUrl(targetUrl, token) {
  const targetWithToken = setQueryParam(targetUrl, 'token', token)
  const base = env.basePath.replace(/\/$/, '')
  if (urlOrigin(targetWithToken) !== urlOrigin(base)) return targetWithToken

  const callbackUrl = pathWithSearchAndHash(targetWithToken)
  return `${base}/api/auth/token-login?token=${encodeURIComponent(token)}&callbackUrl=${encodeURIComponent(callbackUrl)}`
}

function openWebView(targetUrl, title = '') {
  if (!/^https?:\/\//i.test(targetUrl)) {
    uni.showToast({ title: '应用地址必须是 http 或 https', icon: 'none' })
    return
  }
  const query = encodeURIComponent(targetUrl)
  const pageTitle = encodeURIComponent(title || 'AI 应用')
  uni.navigateTo({ url: `/pages/webview/index?url=${query}&title=${pageTitle}` })
}

function notifyLogin(message = '请先登录后使用应用') {
  uni.showToast({ title: message, icon: 'none', duration: 1800 })
  setTimeout(() => uni.navigateTo({ url: '/pages/login/index' }), 700)
}

async function ensureValidLogin() {
  if (!userStore.isLoggedIn || !userStore.token) {
    notifyLogin()
    return false
  }

  try {
    const data = await getSelf()
    if (!data?.id) throw new Error('Invalid session')
    userInfo.value = data
    userStore.setUserInfo(data)
    return true
  } catch {
    notifyLogin('登录已失效，请重新登录')
    return false
  }
}

async function useApp(app) {
  if (!app?.slug || activeSlug.value) return

  activeSlug.value = app.slug
  try {
    if (!(await ensureValidLogin())) {
      return
    }

    const data = await getAppSessionToken(app.slug)
    const token = data?.key || ''
    if (!token) throw new Error('未获取到应用访问令牌')
    const targetUrl = buildTokenHandoffUrl(toAbsoluteTarget(app.target_url), token)
    openWebView(targetUrl, app.name)
  } catch (err) {
    uni.showToast({ title: err?.message || '应用启动失败，请稍后重试', icon: 'none' })
  } finally {
    activeSlug.value = ''
  }
}

function focusQuickChat() {
  quickChatFocus.value = true
}

async function openNativeChat(draft = '', mode = 'chat') {
  if (!(await ensureValidLogin())) return
  const text = String(draft || '').trim()
  const params = []
  if (text) params.push(`draft=${encodeURIComponent(text)}`)
  if (mode === 'image') params.push('mode=image')
  const suffix = params.length ? `?${params.join('&')}` : ''
  uni.navigateTo({ url: `/pages/apps/chat${suffix}` })
}

async function loadApps() {
  loading.value = true
  loadError.value = false
  try {
    const data = await getPublicApps()
    apps.value = Array.isArray(data) ? data : []
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function refresh() {
  refreshing.value = true
  await loadApps()
}

async function syncUser() {
  userInfo.value = userStore.userInfo
  if (!userStore.isLoggedIn) return
  try {
    const data = await getSelf()
    if (data) {
      userStore.setUserInfo(data)
      userInfo.value = data
    }
  } catch {
    userInfo.value = userStore.userInfo
  }
}

onLoad(() => {
  statusBarH.value = uni.getSystemInfoSync().statusBarHeight || 0
  loadApps()
})

onShow(() => {
  syncUser()
})
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #f7f3ea;
  position: relative;
  overflow: hidden;
}

.bg-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(110rpx);
  pointer-events: none;
  z-index: 0;
}

.bg-glow-1 {
  top: -120rpx;
  right: -180rpx;
  width: 520rpx;
  height: 520rpx;
  background: rgba(35, 150, 237, 0.12);
}

.bg-glow-2 {
  left: -220rpx;
  bottom: 160rpx;
  width: 560rpx;
  height: 560rpx;
  background: rgba(255, 184, 74, 0.16);
}

.scroll {
  position: relative;
  z-index: 1;
  height: 100vh;
}

.content {
  padding: 0 32rpx;
  box-sizing: border-box;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24rpx;
  margin-bottom: 28rpx;
}

.head-main {
  min-width: 0;
  flex: 1;
}

.eyebrow {
  display: block;
  font-size: 20rpx;
  color: #b8780c;
  font-weight: 800;
  margin-bottom: 8rpx;
}

.head-title {
  display: block;
  font-size: 44rpx;
  line-height: 1.18;
  color: #111827;
  font-weight: 900;
}

.head-sub {
  display: block;
  font-size: 24rpx;
  color: #6b7280;
  margin-top: 10rpx;
  line-height: 1.5;
}

.quota-pill {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 14rpx 18rpx;
  background: #fff;
  border: 1rpx solid rgba(17, 24, 39, 0.08);
  border-radius: 999rpx;
  box-shadow: 0 8rpx 24rpx rgba(20, 16, 8, 0.05);
  max-width: 240rpx;
  flex-shrink: 0;
}

.quota-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.quota-num {
  font-size: 22rpx;
  color: #111827;
  font-weight: 800;
  max-width: 150rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quota-label {
  font-size: 18rpx;
  color: #9ca3af;
}

.search-box {
  height: 88rpx;
  border-radius: 24rpx;
  background: #fff;
  border: 1rpx solid rgba(17, 24, 39, 0.08);
  padding: 0 24rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
  box-shadow: 0 8rpx 24rpx rgba(20, 16, 8, 0.04);
  margin-bottom: 24rpx;
}

.search-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  font-size: 28rpx;
  color: #111827;
}

.search-placeholder {
  color: #9ca3af;
}

.search-clear {
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.native-chat-panel {
  margin-bottom: 24rpx;
  border-radius: 28rpx;
  padding: 28rpx;
  background: linear-gradient(135deg, #132033 0%, #315b7c 56%, #b87b2d 100%);
  box-shadow: 0 12rpx 32rpx rgba(24, 38, 58, 0.18);
}

.native-chat-head {
  display: flex;
  align-items: center;
}

.native-chat-heading {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.native-chat-icon {
  width: 76rpx;
  height: 76rpx;
  border-radius: 22rpx;
  background: #ffb84a;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8rpx 20rpx rgba(255, 184, 74, 0.28);
  flex-shrink: 0;
}

.native-chat-icon text {
  color: #111827;
  font-size: 28rpx;
  font-weight: 950;
}

.native-chat-title-wrap {
  min-width: 0;
}

.native-chat-kicker {
  display: block;
  color: rgba(255, 255, 255, 0.62);
  font-size: 19rpx;
  font-weight: 850;
}

.native-chat-title {
  display: block;
  margin-top: 6rpx;
  color: #fff;
  font-size: 34rpx;
  font-weight: 900;
}

.native-chat-box {
  margin-top: 24rpx;
  min-height: 132rpx;
  border-radius: 22rpx;
  padding: 22rpx;
  background: rgba(255, 255, 255, 0.96);
}

.native-chat-input {
  width: 100%;
  min-height: 88rpx;
  max-height: 180rpx;
  color: #111827;
  font-size: 27rpx;
  line-height: 1.5;
}

.native-chat-placeholder {
  color: #9ca3af;
}

.native-chat-actions {
  margin-top: 20rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
}

.native-chat-tip {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8rpx;
  color: rgba(255, 255, 255, 0.72);
  font-size: 22rpx;
}

.native-chat-buttons {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-shrink: 0;
}

.native-chat-btn {
  flex-shrink: 0;
  height: 64rpx;
  padding: 0 20rpx;
  border-radius: 999rpx;
  background: #ffb84a;
  display: flex;
  align-items: center;
  gap: 8rpx;
  color: #111827;
  font-size: 24rpx;
  font-weight: 850;
  box-shadow: 0 8rpx 20rpx rgba(255, 184, 74, 0.26);
}

.native-chat-btn.secondary {
  background: rgba(255, 255, 255, 0.94);
  color: #111827;
  box-shadow: none;
}

.state-list,
.app-list {
  display: flex;
  flex-direction: column;
  gap: 22rpx;
}

.app-card,
.skeleton-card,
.empty-card {
  background: #fff;
  border: 1rpx solid rgba(17, 24, 39, 0.08);
  border-radius: 24rpx;
  box-shadow: 0 8rpx 28rpx rgba(20, 16, 8, 0.05);
}

.app-card {
  padding: 26rpx;
}

.app-top {
  display: flex;
  gap: 20rpx;
  align-items: flex-start;
}

.app-icon-img,
.app-icon-fallback {
  width: 92rpx;
  height: 92rpx;
  border-radius: 20rpx;
  flex-shrink: 0;
}

.app-icon-img {
  background: #f3f4f6;
}

.app-icon-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #111827 0%, #334155 100%);
}

.app-icon-letter {
  color: #ffb84a;
  font-size: 42rpx;
  font-weight: 900;
}

.app-info {
  flex: 1;
  min-width: 0;
}

.app-title-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  min-width: 0;
}

.app-title {
  flex: 1;
  min-width: 0;
  font-size: 32rpx;
  color: #111827;
  font-weight: 850;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  margin-top: 12rpx;
}

.tag {
  font-size: 20rpx;
  color: #6b7280;
  padding: 5rpx 12rpx;
  border-radius: 999rpx;
  background: #f3f4f6;
}

.app-desc {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-top: 22rpx;
  min-height: 100rpx;
  font-size: 25rpx;
  line-height: 1.55;
  color: #4b5563;
}

.app-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16rpx;
  margin-top: 24rpx;
}

.use-btn,
.retry-btn {
  height: 72rpx;
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
}

.use-btn {
  min-width: 184rpx;
  background: #ffb84a;
  box-shadow: 0 8rpx 20rpx rgba(255, 184, 74, 0.28);
}

.use-btn.disabled {
  opacity: 0.76;
}

.use-text {
  font-size: 26rpx;
  color: #111827;
  font-weight: 800;
}

.empty-card {
  min-height: 420rpx;
  padding: 48rpx 36rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  text-align: center;
}

.empty-title {
  margin-top: 18rpx;
  font-size: 30rpx;
  color: #111827;
  font-weight: 800;
}

.empty-desc {
  margin-top: 10rpx;
  font-size: 24rpx;
  color: #6b7280;
}

.retry-btn {
  margin-top: 28rpx;
  min-width: 180rpx;
  background: #111827;
}

.retry-text {
  color: #fff;
  font-size: 25rpx;
  font-weight: 700;
}

.skeleton-card {
  padding: 28rpx;
}

.skeleton-icon,
.skeleton-line {
  background: linear-gradient(90deg, #f1f5f9 0%, #e5e7eb 50%, #f1f5f9 100%);
  border-radius: 16rpx;
}

.skeleton-icon {
  width: 92rpx;
  height: 92rpx;
  margin-bottom: 22rpx;
}

.skeleton-line {
  height: 26rpx;
  margin-top: 16rpx;
}

.skeleton-line.w1 {
  width: 60%;
}

.skeleton-line.w2 {
  width: 92%;
}

.skeleton-line.w3 {
  width: 74%;
}

/* Home-style AI recommendation cards */
.app-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20rpx;
}

.app-card {
  position: relative;
  min-height: 0;
  aspect-ratio: 1 / 1;
  padding: 0;
  overflow: hidden;
  border-radius: 28rpx;
  border: 1rpx solid rgba(0, 0, 0, 0.05);
  box-shadow: 0 6rpx 20rpx rgba(20, 16, 8, 0.08);
}

.app-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.02) 0%, rgba(0, 0, 0, 0.72) 100%);
  pointer-events: none;
}

.app-top {
  position: absolute;
  left: 20rpx;
  right: 20rpx;
  bottom: 126rpx;
  z-index: 1;
  display: block;
}

.app-icon-img,
.app-icon-fallback {
  width: 36rpx;
  height: 36rpx;
  border-radius: 9rpx;
  background: rgba(255, 184, 74, 0.2);
  border: 1rpx solid rgba(255, 184, 74, 0.24);
}

.app-icon-letter {
  color: #ffb84a;
  font-size: 20rpx;
}

.app-title-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-top: 8rpx;
}

.app-title {
  color: #ffffff;
  font-size: 28rpx;
  font-weight: 800;
}

.tag-row {
  flex-wrap: nowrap;
  gap: 6rpx;
  margin-top: 8rpx;
  overflow: hidden;
}

.tag {
  flex-shrink: 0;
  max-width: 120rpx;
  padding: 3rpx 8rpx;
  overflow: hidden;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.72);
  font-size: 18rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-desc {
  position: absolute;
  left: 20rpx;
  right: 20rpx;
  bottom: 74rpx;
  z-index: 1;
  display: block;
  min-height: 0;
  margin: 0;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.58);
  font-size: 20rpx;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-actions {
  position: absolute;
  left: 20rpx;
  right: 20rpx;
  bottom: 18rpx;
  z-index: 1;
  justify-content: flex-end;
  gap: 12rpx;
  margin: 0;
}

.use-btn {
  height: 48rpx;
  border-radius: 999rpx;
  backdrop-filter: blur(18rpx);
}

.use-btn {
  min-width: 128rpx;
  background: #ffb84a;
  box-shadow: 0 6rpx 16rpx rgba(255, 184, 74, 0.28);
}

.use-text {
  color: #111827;
  font-size: 21rpx;
}

.empty-inline {
  grid-column: 1 / -1;
  min-height: 96rpx;
  border-radius: 24rpx;
  background: rgba(255, 255, 255, 0.74);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
  font-size: 24rpx;
}
</style>
