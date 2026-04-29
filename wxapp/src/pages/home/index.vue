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
          <!-- 头部 -->
          <view class="hero">
            <text class="hero-title">全球大模型算力超市</text>
            <text class="hero-sub">{{ heroSub }}</text>
            <view class="chips">
              <text class="chip">统一结算</text>
              <text class="chip">按量消耗</text>
              <text class="chip">API 接入</text>
              <text class="chip">应用直用</text>
            </view>
          </view>

          <!-- 主要按钮 -->
          <view class="actions">
            <view class="btn btn-primary" @click="onRecharge">
              <text class="btn-txt">立即充值</text>
            </view>
            <view class="btn btn-ghost" @click="onCreateKey">
              <text class="btn-ghost-txt">创建 API Key</text>
            </view>
          </view>

          <!-- 余额玻璃卡 -->
          <view class="balance-card">
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
                <text class="bg-sub">{{ tokenStr(userInfo?.quota) }} Token</text>
              </view>
              <view class="bg-item">
                <text class="bg-label">累计消耗</text>
                <text class="bg-val">{{ cny(userInfo?.used_quota) }}</text>
                <text class="bg-sub">{{ tokenStr(userInfo?.used_quota) }} Token</text>
              </view>
              <view class="bg-item">
                <text class="bg-label">今日消耗</text>
                <text class="bg-val gold-dim">{{ cny(todayQuota) }}</text>
                <text class="bg-sub">{{ tokenStr(todayQuota) }} Token</text>
              </view>
              <view class="bg-item">
                <text class="bg-label">本月消耗</text>
                <text class="bg-val">{{ cny(monthQuota) }}</text>
                <text class="bg-sub">{{ tokenStr(monthQuota) }} Token</text>
              </view>
            </view>

            <view class="balance-link" @click="onViewLogs">
              <text class="link-txt">查看明细</text>
              <u-icon name="arrow-right" size="13" color="#FFB84A" />
            </view>
          </view>

          <!-- 签到 -->
          <view v-if="userStore.checkinEnabled && userStore.isLoggedIn" class="checkin">
            <view class="checkin-left">
              <view class="checkin-icon" :class="{ done: checkedInToday }">
                <u-icon :name="checkedInToday ? 'checkmark' : 'gift'" size="20" :color="checkedInToday ? '#00F5FF' : '#FFB84A'" />
              </view>
              <view class="checkin-text">
                <text class="checkin-title">{{ checkedInToday ? '今日已签到' : '每日签到' }}</text>
                <text class="checkin-sub">本月 {{ checkinStats.checkin_count || 0 }} 次 · 累计 {{ q2cny(checkinStats.total_quota || 0) }}</text>
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
              v-for="app in apps"
              :key="app.id"
              class="app-card"
              :style="{ background: app.bg }"
              @click="onAppTap(app)"
            >
              <view class="app-shade" />
              <view class="app-bottom">
                <view class="app-head-row">
                  <view class="app-mini-icon">
                    <u-icon :name="app.icon" size="12" color="#FFB84A" />
                  </view>
                  <text class="app-title">{{ app.title }}</text>
                </view>
                <text class="app-desc">{{ app.desc }}</text>
                <view class="app-foot">
                  <text class="app-foot-label">Token 消耗</text>
                  <text class="app-foot-cost">{{ app.cost }}</text>
                </view>
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
import { doCheckin, getCheckinStatus, getSelf, getTodayStat, getMonthStat, getStatus } from '@/services/api.js'
import { renderQuota } from '@/utils/quota.js'

const statusBarH = ref(0)
const firstLoading = ref(true)
const refreshing = ref(false)
const userInfo = ref(null)
const todayQuota = ref(0)
const monthQuota = ref(0)
const checkinLoading = ref(false)
const checkinInfo = ref(null)

const heroSub = '一份 Token，调用 GPT / Claude / Gemini /\nDeepSeek / Qwen / Kimi'

const apps = [
  { id: 'diagnose', title: '形象诊断', desc: '多维度分析气质与着装建议', cost: '50K / 次', icon: 'star',
    bg: 'linear-gradient(135deg, #5B21B6 0%, #1E3A8A 100%)' },
  { id: 'hair',     title: '发型设计', desc: '基于脸型的 AI 虚拟发型预览', cost: '80K / 次', icon: 'scissor',
    bg: 'linear-gradient(135deg, #7C2D12 0%, #831843 100%)' },
  { id: 'face',     title: '面相手相', desc: '传统玄学与大模型图像识别', cost: '120K / 次', icon: 'eye',
    bg: 'linear-gradient(135deg, #064E3B 0%, #312E81 100%)' },
  { id: 'xhs',      title: '小红书文案', desc: '爆款模版，快速生成种草笔记', cost: '15K / 篇', icon: 'edit-pen',
    bg: 'linear-gradient(135deg, #9F1239 0%, #831843 100%)' },
]

const checkinStats = computed(() => checkinInfo.value?.stats || {})
const checkedInToday = computed(() => checkinStats.value?.checked_in_today === true)

function tokenStr(q) {
  return Number(q || 0).toLocaleString()
}
function q2cny(q) { return renderQuota(q) }
function cny(q) {
  const n = Number(q) || 0
  const perUnit = Number(userStore.quotaPerUnit) || 500000
  const rate = Number(userStore.usdExchangeRate) || 1
  return '¥' + (n / perUnit * rate).toFixed(2)
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
  try { checkinInfo.value = await getCheckinStatus() } catch { checkinInfo.value = null }
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
  background: #050a10;
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
  background: rgba(35, 150, 237, 0.18);
}
.bg-glow-2 {
  top: 30%; right: -25%;
  width: 500rpx; height: 500rpx;
  background: rgba(157, 78, 221, 0.15);
}

.scroll { position: relative; z-index: 1; height: 100vh; }
.content { padding: 0 32rpx; }

/* 骨架 */
.skeleton {
  margin-top: 32rpx;
  background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%);
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

/* Hero */
.hero {
  padding: 60rpx 0 16rpx;
  text-align: center;
}
.hero-title {
  display: block;
  font-size: 48rpx;
  font-weight: 800;
  color: #ffffff;
  letter-spacing: -1rpx;
  line-height: 1.2;
  margin-bottom: 16rpx;
}
.hero-sub {
  display: block;
  font-size: 24rpx;
  color: rgba(255,255,255,0.55);
  line-height: 1.7;
  margin-bottom: 32rpx;
  white-space: pre-line;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12rpx;
}
.chip {
  font-size: 22rpx;
  color: #FFB84A;
  border: 1rpx solid rgba(255,184,74,0.4);
  background: rgba(255,184,74,0.05);
  padding: 8rpx 22rpx;
  border-radius: 999rpx;
}

/* 主按钮 */
.actions {
  display: flex;
  gap: 20rpx;
  margin: 36rpx 0;
}
.btn {
  flex: 1;
  height: 88rpx;
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.btn-primary {
  background: linear-gradient(90deg, #2396ED 0%, #9D4EDD 100%);
  box-shadow: 0 8rpx 24rpx rgba(35,150,237,0.25);
}
.btn-txt { color: #ffffff; font-size: 28rpx; font-weight: 600; }
.btn-ghost {
  background: rgba(0,245,255,0.05);
  border: 1rpx solid rgba(0,245,255,0.4);
}
.btn-ghost-txt { color: #00F5FF; font-size: 28rpx; font-weight: 600; }

/* 余额卡 */
.balance-card {
  background: rgba(255,255,255,0.04);
  backdrop-filter: blur(20rpx);
  border: 1rpx solid rgba(255,255,255,0.08);
  border-radius: 28rpx;
  padding: 36rpx 32rpx;
  margin-bottom: 40rpx;
  position: relative;
  overflow: hidden;
}
.balance-header {
  display: flex;
  align-items: center;
  margin-bottom: 32rpx;
}
.balance-icon {
  width: 44rpx; height: 44rpx;
  border-radius: 12rpx;
  background: rgba(255,184,74,0.18);
  display: flex; align-items: center; justify-content: center;
  margin-right: 16rpx;
}
.balance-title {
  font-size: 32rpx;
  color: #ffffff;
  font-weight: 700;
}
.balance-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 36rpx 24rpx;
}
.bg-item { display: flex; flex-direction: column; }
.bg-label {
  font-size: 22rpx;
  color: rgba(255,255,255,0.5);
  margin-bottom: 8rpx;
}
.bg-val {
  font-size: 38rpx;
  color: #ffffff;
  font-weight: 600;
  letter-spacing: -0.5rpx;
  margin-bottom: 4rpx;
}
.bg-val.gold { color: #FFB84A; }
.bg-val.gold-dim { color: rgba(255,184,74,0.75); }
.bg-sub {
  font-size: 20rpx;
  color: rgba(255,255,255,0.32);
}
.balance-link {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: 32rpx;
}
.link-txt {
  font-size: 24rpx;
  color: #FFB84A;
  font-weight: 500;
  margin-right: 6rpx;
}

/* 签到 */
.checkin {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255,255,255,0.04);
  border: 1rpx solid rgba(255,255,255,0.08);
  border-radius: 24rpx;
  padding: 24rpx 28rpx;
  margin-bottom: 32rpx;
}
.checkin-left { display: flex; align-items: center; flex: 1; min-width: 0; }
.checkin-icon {
  width: 64rpx; height: 64rpx;
  border-radius: 16rpx;
  background: rgba(255,184,74,0.15);
  display: flex; align-items: center; justify-content: center;
  margin-right: 18rpx;
  flex-shrink: 0;
}
.checkin-icon.done { background: rgba(0,245,255,0.12); }
.checkin-text { min-width: 0; flex: 1; }
.checkin-title {
  display: block;
  font-size: 28rpx;
  color: #ffffff;
  font-weight: 600;
  margin-bottom: 4rpx;
}
.checkin-sub {
  display: block;
  font-size: 22rpx;
  color: rgba(255,255,255,0.5);
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
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.5);
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
  color: #ffffff;
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
  border: 1rpx solid rgba(255,255,255,0.06);
  aspect-ratio: 1 / 1;
  overflow: hidden;
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
