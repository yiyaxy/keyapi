<template>
  <view class="page">
    <!-- 背景辉光 -->
    <view class="bg-glow bg-glow-1" />
    <view class="bg-glow bg-glow-2" />

    <scroll-view
      scroll-y
      class="scroll"
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onPullDown"
    >
      <view class="content" :style="{ paddingTop: statusBarH + 'px' }">

        <!-- 骨架屏 -->
        <template v-if="firstLoading">
          <view class="skeleton skeleton-hero" />
          <view class="skeleton skeleton-card" />
          <view class="skeleton skeleton-grid" />
        </template>

        <template v-else>
          <!-- 头部白卡：标题 + 标语 + chip + 主按钮 -->
          <view class="hero-card">
            <text class="hero-title">全球大模型算力超市</text>
            <text class="hero-sub">{{ heroSub }}</text>
            <view class="chips">
              <text class="chip">统一结算</text>
              <text class="chip">按量消耗</text>
              <text class="chip">API 接入</text>
              <text class="chip">应用直用</text>
            </view>

            <view class="actions">
              <view v-if="userStore.wxPayEnabled" class="btn btn-primary" @click="onRecharge">
                <text class="btn-txt">立即充值</text>
              </view>
              <view class="btn btn-ghost" @click="onCreateKey">
                <text class="btn-ghost-txt">创建 API Key</text>
              </view>
            </view>
          </view>

          <!-- 余额玻璃卡 -->
          <view v-if="userStore.wxPayEnabled" class="balance-card">
            <view class="balance-header">
              <view class="balance-icon">
                <u-icon name="rmb" size="14" color="#FFB84A" />
              </view>
              <text class="balance-title">我的算力余额</text>
            </view>

            <view class="balance-grid">
              <view class="bg-item">
                <text class="bg-label">可用余额</text>
                <text class="bg-val gold">{{ cny(userInfo?.quota) }}</text>
                <text class="bg-sub">{{ tokenStr(userInfo?.quota) }} 积分</text>
              </view>
              <view class="bg-item">
                <text class="bg-label">累计消耗</text>
                <text class="bg-val">{{ cny(userInfo?.used_quota) }}</text>
                <text class="bg-sub">{{ tokenStr(userInfo?.used_quota) }} 积分</text>
              </view>
              <view class="bg-item">
                <text class="bg-label">今日消耗</text>
                <text class="bg-val gold">{{ cny(todayQuota) }}</text>
                <text class="bg-sub">{{ tokenStr(todayQuota) }} 积分</text>
              </view>
              <view class="bg-item">
                <text class="bg-label">本月消耗</text>
                <text class="bg-val">{{ cny(monthQuota) }}</text>
                <text class="bg-sub">{{ tokenStr(monthQuota) }} 积分</text>
              </view>
            </view>

            <view class="balance-link" @click="onViewLogs">
              <text class="link-txt">查看明细</text>
              <u-icon name="arrow-right" size="13" color="#FFB84A" />
            </view>
          </view>

          <!-- 签到 -->
          <view v-if="userStore.wxPayEnabled && userStore.checkinEnabled && userStore.isLoggedIn" class="checkin">
            <view class="checkin-left">
              <view class="checkin-icon" :class="{ done: checkedInToday }">
                <u-icon :name="checkedInToday ? 'checkmark' : 'gift'" size="20" :color="checkedInToday ? '#00F5FF' : '#FFB84A'" />
              </view>
              <view class="checkin-text">
                <text class="checkin-title">{{ checkedInToday ? '今日已签到' : '每日签到' }}</text>
                <text class="checkin-sub">{{ checkinRewardLabel }} · 本月 {{ checkinStats.checkin_count || 0 }} 次 · 累计 {{ q2cny(checkinStats.total_quota || 0) }}</text>
              </view>
            </view>
            <view class="checkin-btn" :class="{ disabled: checkedInToday || checkinLoading }" @click="handleCheckin">
              <text>{{ checkedInToday ? '已完成' : (checkinLoading ? '签到中' : '立即签到') }}</text>
            </view>
          </view>

          <!-- AI 应用推荐 -->
          <view class="section-head">
            <view class="section-dot" />
            <text class="section-title">AI 应用推荐</text>
          </view>

          <view class="app-grid">
            <view
              v-for="(app, index) in appList"
              :key="app.id || app.slug"
              class="app-card"
              :style="{ background: cardBackground(app, index) }"
              @click="useApp(app)"
            >
              <image
                v-if="appPoster(app)"
                class="app-poster-img"
                :src="assetUrl(appPoster(app))"
                mode="aspectFill"
              />
              <view class="app-shade" />
              <view class="app-bottom">
                <view class="app-head-row">
                  <view class="app-mini-icon">
                    <image
                      v-if="app.icon_url"
                      class="app-mini-img"
                      :src="assetUrl(app.icon_url)"
                      mode="aspectFill"
                    />
                    <text v-else class="app-mini-letter">{{ firstLetter(app.name) }}</text>
                  </view>
                  <text class="app-title">{{ app.name }}</text>
                </view>
                <text v-if="app.description" class="app-desc">{{ app.description }}</text>
                <!-- 应用消耗记录先隐藏，后续有明确计费展示规则后再打开。
                <view class="app-foot">
                  <text class="app-foot-label">积分消耗</text>
                  <text class="app-foot-cost">{{ app.cost }}</text>
                </view>
                -->
              </view>
            </view>
          </view>
        </template>

        <!-- 占位防止被底部 nav 遮挡 -->
        <view style="height: 200rpx;" />
      </view>
    </scroll-view>

    <!-- 底部导航 -->
    <tab-bar active="home" />
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'
import { doCheckin, getAppSessionToken, getCheckinStatus, getPublicApps, getSelf, getTodayStat, getMonthStat, getStatus } from '@/services/api.js'
import env from '@/config/env.js'
import { renderQuota } from '@/utils/quota.js'

const statusBarH = ref(0)
const firstLoading = ref(true)
const refreshing = ref(false)
const userInfo = ref(null)
const todayQuota = ref(0)
const monthQuota = ref(0)
const checkinLoading = ref(false)
const checkinInfo = ref(null)

const heroSub = '一份积分，调用 GPT / Claude / Gemini /\nDeepSeek / Qwen / Kimi'

const apps = [
  { id: 'diagnose', title: '形象诊断', desc: '多维度分析气质与着装建议', cost: '50K / 次', icon: 'star',
    bg: 'linear-gradient(135deg, #2a2a2a 0%, #4a3f3a 100%)' },
  { id: 'hair',     title: '发型设计', desc: '基于脸型的 AI 虚拟发型预览', cost: '80K / 次', icon: 'scissor',
    bg: 'linear-gradient(135deg, #5a4a3a 0%, #2a1f15 100%)' },
  { id: 'face',     title: '面相手相', desc: '传统玄学与大模型图像识别', cost: '120K / 次', icon: 'eye',
    bg: 'linear-gradient(135deg, #1f2937 0%, #4a3a2f 100%)' },
  { id: 'xhs',      title: '小红书文案', desc: '爆款模版，快速生成种草笔记', cost: '15K / 篇', icon: 'edit-pen',
    bg: 'linear-gradient(135deg, #6b3a3a 0%, #2a1818 100%)' },
]

const appList = ref([])
const activeSlug = ref('')

const cardGradients = [
  'linear-gradient(135deg, #2a2a2a 0%, #4a3f3a 100%)',
  'linear-gradient(135deg, #5a4a3a 0%, #2a1f15 100%)',
  'linear-gradient(135deg, #1f2937 0%, #4a3a2f 100%)',
  'linear-gradient(135deg, #6b3a3a 0%, #2a1818 100%)',
  'linear-gradient(135deg, #22322c 0%, #141c18 100%)',
  'linear-gradient(135deg, #2e3140 0%, #161822 100%)',
]

const checkinStats = computed(() => checkinInfo.value?.stats || {})
const checkedInToday = computed(() => checkinStats.value?.checked_in_today === true)
const checkinMinQuota = computed(() => Number(checkinInfo.value?.min_quota ?? userStore.checkinMinQuota) || 0)
const checkinMaxQuota = computed(() => Number(checkinInfo.value?.max_quota ?? userStore.checkinMaxQuota) || 0)
const checkinRewardLabel = computed(() => {
  const min = checkinMinQuota.value
  const max = checkinMaxQuota.value
  if (min <= 0 && max <= 0) return '按后台配置发放'
  if (max <= min) return `每次 ${q2cny(min)}`
  return `每次 ${q2cny(min)}-${q2cny(max)}`
})

function tokenStr(q) {
  return Number(q || 0).toLocaleString()
}
function q2cny(q) { return renderQuota(q) }
function cny(q) {
  return renderQuota(q)
}

function firstLetter(name) {
  return String(name || 'A').slice(0, 1).toUpperCase()
}

function cardBackground(app, index) {
  const seed = String(app?.slug || app?.name || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return cardGradients[(seed + index) % cardGradients.length]
}

function appPoster(app) {
  return app?.poster_url || app?.cover_url || app?.banner_url || app?.icon_url || ''
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

function onRecharge() {
  if (!userStore.isLoggedIn) return goLogin()
  uni.navigateTo({ url: '/pages/redeem/index' })
}
function onCreateKey() {
  if (!userStore.isLoggedIn) return goLogin()
  uni.navigateTo({ url: '/pages/apikey/index' })
}
function onViewLogs() {
  if (!userStore.isLoggedIn) return goLogin()
  uni.navigateTo({ url: '/pages/usage-records/index' })
}
function onAppTap() {
  uni.showToast({ title: '即将上线，敬请期待', icon: 'none' })
}

function goLogin() { uni.navigateTo({ url: '/pages/login/index' }) }

async function loadCheckinStatus() {
  if (!userStore.checkinEnabled || !userStore.isLoggedIn) {
    checkinInfo.value = null
    return
  }
  try {
    checkinInfo.value = await getCheckinStatus()
    userStore.checkinMinQuota = Number(checkinInfo.value?.min_quota) || userStore.checkinMinQuota
    userStore.checkinMaxQuota = Number(checkinInfo.value?.max_quota) || userStore.checkinMaxQuota
  } catch { checkinInfo.value = null }
}

async function handleCheckin() {
  if (checkedInToday.value || checkinLoading.value) return
  checkinLoading.value = true
  try {
    const data = await doCheckin()
    const awarded = Number(data?.quota_awarded || 0)
    if (awarded > 0 && userInfo.value) {
      userInfo.value = { ...userInfo.value, quota: Number(userInfo.value.quota || 0) + awarded }
      userStore.setUserInfo(userInfo.value)
    }
    uni.showToast({ title: `签到成功 +${q2cny(awarded)}`, icon: 'none' })
    await refresh()
  } catch {
    await loadCheckinStatus()
  } finally {
    checkinLoading.value = false
  }
}

async function refresh() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    const statusRes = await Promise.resolve(getStatus()).catch(() => null)
    if (statusRes) userStore.applyStatus(statusRes)

    const appRes = await Promise.resolve(getPublicApps()).catch(() => null)
    if (Array.isArray(appRes)) appList.value = appRes.slice(0, 4)

    if (userStore.isLoggedIn) {
      const [selfRes, todayRes, monthRes] = await Promise.allSettled([
        getSelf(), getTodayStat(), getMonthStat(),
      ])
      if (selfRes.status === 'fulfilled') {
        userInfo.value = selfRes.value
        userStore.setUserInfo(selfRes.value)
      }
      if (todayRes.status === 'fulfilled') todayQuota.value = todayRes.value?.quota || 0
      if (monthRes.status === 'fulfilled') monthQuota.value = monthRes.value?.quota || 0
      await loadCheckinStatus()
    }
  } finally {
    firstLoading.value = false
    refreshing.value = false
    uni.stopPullDownRefresh()
  }
}

async function onPullDown() { await refresh() }

onLoad(() => {
  statusBarH.value = uni.getSystemInfoSync().statusBarHeight
  refresh()
})

onShow(() => {
  if (!firstLoading.value) refresh()
})
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #faf7f0;
  position: relative;
  overflow: hidden;
}

/* 背景辉光 */
.bg-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(120rpx);
  pointer-events: none;
  z-index: 0;
}
.bg-glow-1 {
  top: -20%; left: -20%;
  width: 600rpx; height: 600rpx;
  background: rgba(255, 184, 74, 0.16);
}
.bg-glow-2 {
  top: 30%; right: -25%;
  width: 500rpx; height: 500rpx;
  background: rgba(157, 78, 221, 0.08);
}

.scroll { position: relative; z-index: 1; height: 100vh; }
.content { padding: 0 32rpx; }

/* 骨架 */
.skeleton {
  margin-top: 32rpx;
  background: linear-gradient(90deg, rgba(0,0,0,0.04) 25%, rgba(0,0,0,0.07) 50%, rgba(0,0,0,0.04) 75%);
  background-size: 200% 100%;
  border-radius: 20rpx;
  animation: shimmer 1.4s infinite;
}
.skeleton-hero { height: 280rpx; }
.skeleton-card { height: 360rpx; }
.skeleton-grid { height: 600rpx; }
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Hero 区域（无卡，直接铺背景） */
.hero-card {
  padding: 56rpx 12rpx 16rpx;
  text-align: center;
}
.hero-title {
  display: block;
  font-size: 52rpx;
  font-weight: 800;
  color: #1a1a2e;
  letter-spacing: -1rpx;
  line-height: 1.2;
  margin-bottom: 20rpx;
}
.hero-sub {
  display: block;
  font-size: 26rpx;
  color: #1a1a2e;
  line-height: 1.7;
  margin-bottom: 32rpx;
  white-space: pre-line;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 14rpx 12rpx;
}
.chip {
  font-size: 24rpx;
  color: #1a1a2e;
  border: 2rpx solid #FFB84A;
  background: #ffffff;
  padding: 10rpx 26rpx;
  border-radius: 999rpx;
  font-weight: 500;
}

/* 主按钮 */
.actions {
  display: flex;
  gap: 24rpx;
  margin-top: 40rpx;
}
.btn {
  flex: 1;
  min-height: 96rpx;
  padding: 18rpx 12rpx;
  border-radius: 999rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
.btn-primary {
  background: #FFB84A;
  box-shadow: 0 8rpx 20rpx rgba(255,184,74,0.4);
}
.btn-txt { color: #1a1a2e; font-size: 30rpx; font-weight: 700; }
.btn-ghost {
  background: #ffffff;
  border: 2rpx solid #FFB84A;
}
.btn-ghost-txt {
  color: #1a1a2e;
  font-size: 28rpx;
  font-weight: 700;
  text-align: center;
  line-height: 1.3;
}

/* 余额卡 */
.balance-card {
  background: #ffffff;
  border: 1rpx solid rgba(0,0,0,0.04);
  border-radius: 48rpx;
  padding: 44rpx 40rpx 36rpx;
  margin-top: 32rpx;
  margin-bottom: 40rpx;
  position: relative;
  overflow: hidden;
  box-shadow:
    0 24rpx 56rpx rgba(20, 16, 8, 0.08),
    0 8rpx 20rpx rgba(20, 16, 8, 0.04),
    0 1rpx 2rpx rgba(255, 255, 255, 0.6) inset;
}
.balance-header {
  display: flex;
  align-items: center;
  margin-bottom: 32rpx;
}
.balance-icon {
  width: 40rpx; height: 40rpx;
  border-radius: 10rpx;
  background: rgba(255,184,74,0.15);
  border: 1rpx solid rgba(255,184,74,0.4);
  display: flex; align-items: center; justify-content: center;
  margin-right: 14rpx;
}
.balance-title {
  font-size: 36rpx;
  color: #1a1a2e;
  font-weight: 800;
  letter-spacing: -0.5rpx;
}
.balance-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32rpx 24rpx;
}
.bg-item { display: flex; flex-direction: column; }
.bg-label {
  font-size: 22rpx;
  color: #1a1a2e;
  font-weight: 600;
  margin-bottom: 8rpx;
}
.bg-val {
  font-size: 40rpx;
  color: #1a1a2e;
  font-weight: 800;
  letter-spacing: -0.5rpx;
  margin-bottom: 4rpx;
}
.bg-val.gold { color: #FFB84A; }
.bg-val.gold-dim { color: #FFB84A; }
.bg-sub {
  font-size: 18rpx;
  color: #9ca3af;
}
.balance-link {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: 24rpx;
}
.link-txt {
  font-size: 24rpx;
  color: #FFB84A;
  font-weight: 600;
  margin-right: 6rpx;
}

/* 签到 */
.checkin {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #ffffff;
  border: 1rpx solid rgba(0,0,0,0.05);
  border-radius: 24rpx;
  padding: 24rpx 28rpx;
  margin-bottom: 32rpx;
  box-shadow: 0 4rpx 16rpx rgba(20,16,8,0.04);
}
.checkin-left { display: flex; align-items: center; flex: 1; min-width: 0; }
.checkin-icon {
  width: 64rpx; height: 64rpx;
  border-radius: 16rpx;
  background: rgba(255,184,74,0.18);
  display: flex; align-items: center; justify-content: center;
  margin-right: 18rpx;
  flex-shrink: 0;
}
.checkin-icon.done { background: rgba(24,160,88,0.12); }
.checkin-text { min-width: 0; flex: 1; }
.checkin-title {
  display: block;
  font-size: 28rpx;
  color: #1a1a2e;
  font-weight: 600;
  margin-bottom: 4rpx;
}
.checkin-sub {
  display: block;
  font-size: 22rpx;
  color: #6b7280;
}
.checkin-btn {
  min-width: 130rpx;
  height: 60rpx;
  border-radius: 999rpx;
  background: linear-gradient(90deg, #FFB84A 0%, #ff9c1f 100%);
  display: flex; align-items: center; justify-content: center;
  color: #050a10;
  font-size: 24rpx;
  font-weight: 700;
  margin-left: 18rpx;
  padding: 0 24rpx;
}
.checkin-btn.disabled {
  background: #f3f4f6;
  color: #9ca3af;
}

/* 分组标题 */
.section-head {
  display: flex;
  align-items: center;
  margin: 16rpx 0 24rpx;
}
.section-dot {
  width: 12rpx; height: 12rpx;
  border-radius: 50%;
  background: #FFB84A;
  box-shadow: 0 0 12rpx #FFB84A;
  margin-right: 14rpx;
}
.section-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #1a1a2e;
}

/* AI 应用网格 */
.app-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20rpx;
}
.app-card {
  position: relative;
  border-radius: 28rpx;
  border: 1rpx solid rgba(0,0,0,0.05);
  aspect-ratio: 1 / 1;
  overflow: hidden;
  box-shadow: 0 6rpx 20rpx rgba(20,16,8,0.08);
}
.app-poster-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.app-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.65) 100%);
}
.app-bottom {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  padding: 20rpx;
}
.app-head-row {
  display: flex; align-items: center;
  margin-bottom: 6rpx;
}
.app-mini-icon {
  width: 32rpx; height: 32rpx;
  border-radius: 8rpx;
  background: rgba(255,184,74,0.2);
  display: flex; align-items: center; justify-content: center;
  margin-right: 10rpx;
  overflow: hidden;
}
.app-mini-img {
  width: 100%;
  height: 100%;
}
.app-mini-letter {
  font-size: 18rpx;
  color: #FFB84A;
  font-weight: 800;
}
.app-title {
  font-size: 28rpx;
  font-weight: 700;
  color: #ffffff;
}
.app-desc {
  display: block;
  font-size: 20rpx;
  color: rgba(255,255,255,0.55);
  line-height: 1.4;
  margin-bottom: 12rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.app-foot-label {
  font-size: 18rpx;
  color: rgba(255,255,255,0.4);
}
.app-foot-cost {
  font-size: 22rpx;
  color: #FFB84A;
  font-weight: 700;
}
</style>
