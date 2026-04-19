<template>
  <view class="page">
    <!-- 自定义导航栏 -->
    <view class="nav" :style="{ paddingTop: statusBarH + 'px' }">
      <view class="nav-inner">
        <text class="nav-title">首页</text>
        <view class="nav-btn" @click="refresh">
          <u-icon name="reload" size="42" :color="refreshing ? '#9ca3af' : '#4F6EF7'" />
        </view>
      </view>
    </view>

    <scroll-view
      scroll-y
      class="scroll"
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onPullDown"
    >
      <!-- 骨架屏 -->
      <template v-if="firstLoading">
        <view class="skeleton-hero" />
        <view class="skeleton-grid" />
      </template>

      <template v-else>
        <!-- 余额英雄卡片 -->
        <view class="hero">
          <view class="hero-top">
            <view>
              <text class="greeting">你好，{{ displayName }} 👋</text>
              <text class="greeting-sub">欢迎使用 CaMeL API</text>
            </view>
            <view class="balance-box">
              <text class="balance-label">账户余额</text>
              <text class="balance-val">{{ q2cny(userInfo?.quota) }}</text>
            </view>
          </view>

          <!-- 今日 / 本月消费 -->
          <view class="stats-row">
            <view class="stat-item">
              <text class="stat-val">{{ q2cny(todayQuota) }}</text>
              <text class="stat-label">今日消费</text>
            </view>
            <view class="stat-sep" />
            <view class="stat-item">
              <text class="stat-val">{{ q2cny(monthQuota) }}</text>
              <text class="stat-label">本月消费</text>
            </view>
            <view class="stat-sep" />
            <view class="stat-item">
              <text class="stat-val">{{ userInfo?.request_count || 0 }}</text>
              <text class="stat-label">累计请求</text>
            </view>
          </view>
        </view>

        <!-- 快捷入口 -->
        <text class="section-title">快捷功能</text>
        <view class="grid">
          <view class="grid-item" @click="nav('/pages/topup/index')">
            <view class="grid-icon" style="background:#e8faf0;">
              <u-icon name="rmb-circle-fill" size="52" color="#09BB07" />
            </view>
            <text class="grid-label">微信充值</text>
          </view>
          <view class="grid-item" @click="nav('/pages/redeem/index')">
            <view class="grid-icon" style="background:#eef1ff;">
              <u-icon name="coupon" size="52" color="#4F6EF7" />
            </view>
            <text class="grid-label">兑换码充值</text>
          </view>
          <view class="grid-item" @click="nav('/pages/apikey/index')">
            <view class="grid-icon" style="background:#e8faf0;">
              <u-icon name="setting" size="52" color="#18A058" />
            </view>
            <text class="grid-label">API Key</text>
          </view>
          <view class="grid-item" @click="nav('/pages/usage-records/index')">
            <view class="grid-icon" style="background:#fff7e8;">
              <u-icon name="clock" size="52" color="#f59e0b" />
            </view>
            <text class="grid-label">消费记录</text>
          </view>
          <view class="grid-item" @click="switchTab('/pages/invite/index')">
            <view class="grid-icon" style="background:#ffeef2;">
              <u-icon name="share" size="52" color="#ef4444" />
            </view>
            <text class="grid-label">邀请中心</text>
          </view>
        </view>

        <!-- 邀请摘要卡片 -->
        <text class="section-title">邀请信息</text>
        <view class="invite-card">
          <view class="invite-top">
            <view>
              <text class="invite-key-label">我的邀请码</text>
              <text class="invite-code">{{ userInfo?.aff_code || '--' }}</text>
            </view>
            <view class="copy-btn" @click="copyCode(userInfo?.aff_code)">
              <u-icon name="copy" size="34" color="#4F6EF7" />
              <text class="copy-text">复制</text>
            </view>
          </view>
          <view class="invite-div" />
          <view class="invite-stats">
            <view class="inv-stat">
              <text class="inv-val">{{ userInfo?.aff_count || 0 }}</text>
              <text class="inv-label">已邀请人数</text>
            </view>
            <view class="inv-stat">
              <text class="inv-val">{{ q2cny(userInfo?.aff_quota) }}</text>
              <text class="inv-label">待转换奖励</text>
            </view>
            <view class="inv-stat">
              <text class="inv-val">{{ q2cny(userInfo?.aff_history_quota) }}</text>
              <text class="inv-label">累计奖励</text>
            </view>
          </view>
        </view>

        <view style="height:48rpx;" />
      </template>
    </scroll-view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'
import { getSelf, getTodayStat, getMonthStat, getStatus } from '@/services/api.js'
import { renderQuota } from '@/utils/quota.js'

const statusBarH = ref(0)
const firstLoading = ref(true)
const refreshing = ref(false)
const userInfo = ref(null)
const todayQuota = ref(0)
const monthQuota = ref(0)

const displayName = computed(() => {
  const u = userInfo.value
  return u?.display_name || u?.username || '用户'
})

function q2cny(quota) { return renderQuota(quota) }

function nav(url) { uni.navigateTo({ url }) }
function switchTab(url) { uni.switchTab({ url }) }

function copyCode(code) {
  if (!code) return
  uni.setClipboardData({
    data: code,
    success: () => uni.showToast({ title: '邀请码已复制', icon: 'none' }),
  })
}

async function refresh() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    // 并发请求：系统配置 + 用户信息 + 今日统计 + 本月统计
    // getStatus 无需登录态，用于获取服务器真实 quota_per_unit
    const [statusRes, selfRes, todayRes, monthRes] = await Promise.allSettled([
      getStatus(),
      getSelf(),
      getTodayStat(),
      getMonthStat(),
    ])

    // 必须先更新 status 配置（含 quota_per_unit / exchange rate 等），再渲染金额
    if (statusRes.status === 'fulfilled' && statusRes.value) {
      userStore.applyStatus(statusRes.value)
    }
    if (selfRes.status === 'fulfilled') {
      userInfo.value = selfRes.value
      userStore.setUserInfo(selfRes.value)
    }
    if (todayRes.status === 'fulfilled') {
      todayQuota.value = todayRes.value?.quota || 0
    }
    if (monthRes.status === 'fulfilled') {
      monthQuota.value = monthRes.value?.quota || 0
    }
  } finally {
    firstLoading.value = false
    refreshing.value = false
    uni.stopPullDownRefresh()
  }
}

async function onPullDown() {
  await refresh()
}

onLoad(() => {
  statusBarH.value = uni.getSystemInfoSync().statusBarHeight
  if (!userStore.isLoggedIn) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  refresh()
})

onShow(() => {
  // 从其他页返回时刷新余额（例如兑换成功后）
  if (!firstLoading.value && userStore.isLoggedIn) {
    refresh()
  }
})
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #f5f5f7;
  display: flex;
  flex-direction: column;
}

/* 导航栏 */
.nav {
  background: #fff;
  box-shadow: 0 1rpx 0 #f0f0f0;
  position: sticky;
  top: 0;
  z-index: 100;
}
.nav-inner {
  height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 32rpx;
}
.nav-title { font-size: 34rpx; font-weight: 600; color: #1a1a2e; }
.nav-btn { padding: 10rpx; }

/* 滚动容器 */
.scroll { flex: 1; }

/* 骨架屏 */
.skeleton-hero {
  margin: 24rpx;
  height: 320rpx;
  background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  border-radius: 24rpx;
  animation: shimmer 1.4s infinite;
}
.skeleton-grid {
  margin: 0 24rpx;
  height: 220rpx;
  background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  border-radius: 20rpx;
  animation: shimmer 1.4s infinite;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* 英雄卡片 */
.hero {
  margin: 24rpx 24rpx 0;
  background: linear-gradient(135deg, #4F6EF7 0%, #7B9BFF 100%);
  border-radius: 24rpx;
  padding: 36rpx;
  box-shadow: 0 12rpx 40rpx rgba(79, 110, 247, 0.28);
}
.hero-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 32rpx;
}
.greeting {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: #fff;
  margin-bottom: 8rpx;
}
.greeting-sub {
  display: block;
  font-size: 24rpx;
  color: rgba(255,255,255,0.72);
}
.balance-box { text-align: right; }
.balance-label {
  display: block;
  font-size: 22rpx;
  color: rgba(255,255,255,0.72);
  margin-bottom: 6rpx;
}
.balance-val {
  display: block;
  font-size: 44rpx;
  font-weight: 700;
  color: #fff;
}

/* 统计行 */
.stats-row {
  display: flex;
  align-items: center;
  background: rgba(255,255,255,0.15);
  border-radius: 14rpx;
  padding: 20rpx 0;
}
.stat-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.stat-val {
  font-size: 28rpx;
  font-weight: 600;
  color: #fff;
  margin-bottom: 6rpx;
}
.stat-label {
  font-size: 22rpx;
  color: rgba(255,255,255,0.72);
}
.stat-sep {
  width: 1rpx;
  height: 48rpx;
  background: rgba(255,255,255,0.3);
}

/* 分组标题 */
.section-title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: #6b7280;
  padding: 32rpx 32rpx 16rpx;
  letter-spacing: 1rpx;
}

/* 快捷入口网格 */
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20rpx;
  padding: 0 24rpx;
}
.grid-item {
  background: #fff;
  border-radius: 20rpx;
  padding: 32rpx 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: 0 2rpx 10rpx rgba(0,0,0,0.05);
}
.grid-icon {
  width: 96rpx;
  height: 96rpx;
  border-radius: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16rpx;
}
.grid-label {
  font-size: 26rpx;
  color: #1a1a2e;
  font-weight: 500;
}

/* 邀请卡片 */
.invite-card {
  margin: 0 24rpx;
  background: #fff;
  border-radius: 20rpx;
  padding: 32rpx;
  box-shadow: 0 2rpx 10rpx rgba(0,0,0,0.05);
}
.invite-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.invite-key-label {
  display: block;
  font-size: 24rpx;
  color: #6b7280;
  margin-bottom: 8rpx;
}
.invite-code {
  font-size: 36rpx;
  font-weight: 700;
  color: #4F6EF7;
  letter-spacing: 4rpx;
}
.copy-btn {
  display: flex;
  align-items: center;
  background: #eef1ff;
  border-radius: 12rpx;
  padding: 12rpx 20rpx;
}
.copy-text {
  font-size: 26rpx;
  color: #4F6EF7;
  margin-left: 8rpx;
}
.invite-div {
  height: 1rpx;
  background: #f5f5f7;
  margin: 24rpx 0;
}
.invite-stats {
  display: flex;
  justify-content: space-around;
}
.inv-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.inv-val {
  font-size: 28rpx;
  font-weight: 600;
  color: #1a1a2e;
  margin-bottom: 6rpx;
}
.inv-label {
  font-size: 22rpx;
  color: #6b7280;
}
</style>
