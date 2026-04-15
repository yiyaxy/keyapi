<template>
  <view class="home-page">
    <!-- Custom Nav Bar -->
    <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-content">
        <text class="nav-title">首页</text>
        <view class="nav-action" @click="loadData">
          <u-icon name="reload" size="40" color="#4F6EF7" />
        </view>
      </view>
    </view>

    <!-- Skeleton loading -->
    <view v-if="loading && !userInfo" class="skeleton-wrap">
      <view class="skeleton-hero" />
      <view class="skeleton-stats" />
      <view class="skeleton-grid" />
    </view>

    <scroll-view
      v-else
      scroll-y
      style="flex: 1;"
      @scrolltolower="() => {}"
    >
      <!-- Hero card: balance -->
      <view class="hero-card">
        <view class="hero-top">
          <view>
            <text class="hero-greeting">你好，{{ displayName }} 👋</text>
            <text class="hero-sub">欢迎使用 CaMeL API</text>
          </view>
          <view class="balance-wrap">
            <text class="balance-label">账户余额</text>
            <text class="balance-value">{{ quotaToUSD(userInfo?.quota || 0) }}</text>
          </view>
        </view>

        <!-- Stats row -->
        <view class="stats-row">
          <view class="stat-item">
            <text class="stat-label">今日消费</text>
            <text class="stat-value">{{ quotaToUSD(todayStat) }}</text>
          </view>
          <view class="stat-divider" />
          <view class="stat-item">
            <text class="stat-label">本月消费</text>
            <text class="stat-value">{{ quotaToUSD(monthStat) }}</text>
          </view>
        </view>
      </view>

      <!-- Quick actions grid -->
      <view class="section-title">快捷功能</view>
      <view class="actions-grid">
        <view class="action-item" @click="go('/pages/redeem/index')">
          <view class="action-icon" style="background: #eef1ff;">
            <u-icon name="coupon" size="52" color="#4F6EF7" />
          </view>
          <text class="action-label">兑换码充值</text>
        </view>
        <view class="action-item" @click="go('/pages/apikey/index')">
          <view class="action-icon" style="background: #e8faf0;">
            <u-icon name="setting" size="52" color="#18A058" />
          </view>
          <text class="action-label">API Key</text>
        </view>
        <view class="action-item" @click="go('/pages/usage-records/index')">
          <view class="action-icon" style="background: #fff7e8;">
            <u-icon name="clock" size="52" color="#f59e0b" />
          </view>
          <text class="action-label">消费记录</text>
        </view>
        <view class="action-item" @click="goTab(1)">
          <view class="action-icon" style="background: #ffeef2;">
            <u-icon name="share" size="52" color="#ef4444" />
          </view>
          <text class="action-label">邀请中心</text>
        </view>
      </view>

      <!-- Invite summary card -->
      <view class="section-title">邀请信息</view>
      <view class="invite-card">
        <view class="invite-row">
          <view class="invite-info">
            <text class="invite-label">我的邀请码</text>
            <text class="invite-code">{{ userInfo?.aff_code || '--' }}</text>
          </view>
          <u-button
            size="mini"
            type="primary"
            :custom-style="{ borderRadius: '20rpx', fontSize: '24rpx' }"
            @click="copyInviteCode"
          >
            复制
          </u-button>
        </view>
        <view class="divider" />
        <view class="invite-stats">
          <view class="invite-stat">
            <text class="i-stat-value">{{ userInfo?.aff_history_quota || 0 }}</text>
            <text class="i-stat-label">累计邀请奖励 (配额)</text>
          </view>
          <view class="invite-stat">
            <text class="i-stat-value">{{ quotaToUSD(userInfo?.aff_quota || 0) }}</text>
            <text class="i-stat-label">待转换奖励</text>
          </view>
        </view>
      </view>

      <view style="height: 40rpx;" />
    </scroll-view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'
import { getSelf, getLogStat } from '@/services/api.js'
import env from '@/config/env.js'

const statusBarHeight = ref(0)
const loading = ref(false)
const userInfo = ref(null)
const todayStat = ref(0)
const monthStat = ref(0)

const displayName = computed(() => {
  const u = userInfo.value
  if (!u) return ''
  return u.display_name || u.username || ''
})

function quotaToUSD(quota) {
  return '$' + (quota / env.quotaPerUnit).toFixed(2)
}

function go(url) {
  uni.navigateTo({ url })
}

function goTab(index) {
  uni.switchTab({ url: ['', '/pages/invite/index', '/pages/profile/index'][index] })
}

async function loadData() {
  loading.value = true
  try {
    const [self, stat] = await Promise.allSettled([getSelf(), getLogStat()])

    if (self.status === 'fulfilled') {
      userInfo.value = self.value
      userStore.setUserInfo(self.value)
    }

    if (stat.status === 'fulfilled') {
      const s = stat.value
      // stat returns today and this month consumed quota
      todayStat.value = s?.today?.quota || 0
      monthStat.value = s?.month?.quota || 0
    }
  } catch (e) {
    console.error('loadData error', e)
  } finally {
    loading.value = false
    uni.stopPullDownRefresh()
  }
}

function copyInviteCode() {
  const code = userInfo.value?.aff_code
  if (!code) return
  uni.setClipboardData({
    data: code,
    success() {
      uni.showToast({ title: '邀请码已复制', icon: 'none' })
    }
  })
}

onLoad(() => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight
  if (!userStore.isLoggedIn) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  loadData()
})

onShow(() => {
  // Refresh if userInfo already loaded (e.g. coming back from another page)
  if (userInfo.value) {
    loadData()
  }
})

onPullDownRefresh(() => {
  loadData()
})
</script>

<style lang="scss" scoped>
.home-page {
  min-height: 100vh;
  background: #f5f5f7;
  display: flex;
  flex-direction: column;
}

.nav-bar {
  background: #fff;
  box-shadow: 0 1rpx 0 #f0f0f0;

  .nav-content {
    height: 88rpx;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 32rpx;

    .nav-title {
      font-size: 34rpx;
      font-weight: 600;
      color: #1a1a2e;
    }

    .nav-action {
      padding: 10rpx;
    }
  }
}

.skeleton-wrap {
  padding: 24rpx;

  .skeleton-hero {
    height: 280rpx;
    background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
    border-radius: 20rpx;
    margin-bottom: 24rpx;
    animation: shimmer 1.5s infinite;
  }

  .skeleton-stats {
    height: 100rpx;
    background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
    border-radius: 16rpx;
    margin-bottom: 24rpx;
    animation: shimmer 1.5s infinite;
  }

  .skeleton-grid {
    height: 200rpx;
    background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
    border-radius: 16rpx;
    animation: shimmer 1.5s infinite;
  }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.hero-card {
  margin: 24rpx 24rpx 0;
  background: linear-gradient(135deg, #4F6EF7 0%, #6C8EFF 100%);
  border-radius: 24rpx;
  padding: 36rpx;
  box-shadow: 0 12rpx 40rpx rgba(79, 110, 247, 0.3);

  .hero-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 32rpx;
  }

  .hero-greeting {
    display: block;
    font-size: 34rpx;
    font-weight: 600;
    color: #fff;
    margin-bottom: 8rpx;
  }

  .hero-sub {
    display: block;
    font-size: 24rpx;
    color: rgba(255, 255, 255, 0.7);
  }

  .balance-wrap {
    text-align: right;

    .balance-label {
      display: block;
      font-size: 22rpx;
      color: rgba(255, 255, 255, 0.7);
      margin-bottom: 6rpx;
    }

    .balance-value {
      display: block;
      font-size: 44rpx;
      font-weight: 700;
      color: #fff;
    }
  }

  .stats-row {
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 14rpx;
    padding: 20rpx 0;

    .stat-item {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;

      .stat-label {
        font-size: 22rpx;
        color: rgba(255, 255, 255, 0.75);
        margin-bottom: 6rpx;
      }

      .stat-value {
        font-size: 30rpx;
        font-weight: 600;
        color: #fff;
      }
    }

    .stat-divider {
      width: 1rpx;
      height: 48rpx;
      background: rgba(255, 255, 255, 0.3);
    }
  }
}

.section-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #6b7280;
  padding: 32rpx 32rpx 16rpx;
  letter-spacing: 1rpx;
}

.actions-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20rpx;
  padding: 0 24rpx;

  .action-item {
    background: #fff;
    border-radius: 20rpx;
    padding: 32rpx 20rpx;
    display: flex;
    flex-direction: column;
    align-items: center;
    box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.05);
    active-opacity: 0.85;

    .action-icon {
      width: 96rpx;
      height: 96rpx;
      border-radius: 24rpx;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16rpx;
    }

    .action-label {
      font-size: 26rpx;
      color: #1a1a2e;
      font-weight: 500;
    }
  }
}

.invite-card {
  margin: 0 24rpx;
  background: #fff;
  border-radius: 20rpx;
  padding: 32rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.05);

  .invite-row {
    display: flex;
    align-items: center;
    justify-content: space-between;

    .invite-info {
      .invite-label {
        display: block;
        font-size: 24rpx;
        color: #6b7280;
        margin-bottom: 8rpx;
      }

      .invite-code {
        font-size: 32rpx;
        font-weight: 600;
        color: #4F6EF7;
        letter-spacing: 2rpx;
      }
    }
  }

  .divider {
    height: 1rpx;
    background: #f5f5f7;
    margin: 24rpx 0;
  }

  .invite-stats {
    display: flex;
    justify-content: space-around;

    .invite-stat {
      display: flex;
      flex-direction: column;
      align-items: center;

      .i-stat-value {
        font-size: 28rpx;
        font-weight: 600;
        color: #1a1a2e;
        margin-bottom: 6rpx;
      }

      .i-stat-label {
        font-size: 22rpx;
        color: #6b7280;
      }
    }
  }
}
</style>
