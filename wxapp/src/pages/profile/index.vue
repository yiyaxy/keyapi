<template>
  <view class="profile-page">
    <!-- Custom Nav Bar -->
    <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-content">
        <text class="nav-title">我的</text>
      </view>
    </view>

    <scroll-view scroll-y style="flex: 1;" refresher-enabled @refresherrefresh="onRefresh" :refresher-triggered="refreshing">
      <!-- User info header -->
      <view class="user-header">
        <view class="avatar">
          <text class="avatar-letter">{{ avatarLetter }}</text>
        </view>
        <view class="user-info">
          <text class="username">{{ displayName }}</text>
          <text class="user-id">ID: {{ userInfo?.id || '--' }}</text>
        </view>
        <view class="balance-chip">
          <text class="chip-label">余额</text>
          <text class="chip-value">{{ quotaToUSD(userInfo?.quota || 0) }}</text>
        </view>
      </view>

      <!-- Menu list -->
      <view class="menu-section">
        <view class="menu-card">
          <view class="menu-item" @click="go('/pages/apikey/index')">
            <view class="menu-left">
              <view class="menu-icon" style="background: #eef1ff;">
                <u-icon name="setting" size="40" color="#4F6EF7" />
              </view>
              <text class="menu-label">API Key 管理</text>
            </view>
            <u-icon name="arrow-right" size="32" color="#9ca3af" />
          </view>

          <view class="menu-divider" />

          <view class="menu-item" @click="go('/pages/usage-records/index')">
            <view class="menu-left">
              <view class="menu-icon" style="background: #fff7e8;">
                <u-icon name="clock" size="40" color="#f59e0b" />
              </view>
              <text class="menu-label">消费记录</text>
            </view>
            <u-icon name="arrow-right" size="32" color="#9ca3af" />
          </view>

          <view class="menu-divider" />

          <view class="menu-item" @click="go('/pages/redeem/index')">
            <view class="menu-left">
              <view class="menu-icon" style="background: #e8faf0;">
                <u-icon name="coupon" size="40" color="#18A058" />
              </view>
              <text class="menu-label">兑换码充值</text>
            </view>
            <u-icon name="arrow-right" size="32" color="#9ca3af" />
          </view>

          <view class="menu-divider" />

          <view class="menu-item" @click="goInvite">
            <view class="menu-left">
              <view class="menu-icon" style="background: #ffeef2;">
                <u-icon name="share" size="40" color="#ef4444" />
              </view>
              <text class="menu-label">邀请中心</text>
            </view>
            <u-icon name="arrow-right" size="32" color="#9ca3af" />
          </view>
        </view>
      </view>

      <!-- Logout button -->
      <view class="logout-section">
        <u-button
          type="error"
          :custom-style="logoutBtnStyle"
          @click="doLogout"
        >
          退出登录
        </u-button>
      </view>

      <view class="version-text">
        <text>CaMeL API · v1.0.0</text>
      </view>

      <view style="height: 40rpx;" />
    </scroll-view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'
import { getSelf } from '@/services/api.js'
import env from '@/config/env.js'

const statusBarHeight = ref(0)
const loading = ref(false)
const refreshing = ref(false)
const userInfo = ref(null)

const displayName = computed(() => {
  const u = userInfo.value
  if (!u) return ''
  return u.display_name || u.username || ''
})

const avatarLetter = computed(() => {
  const name = displayName.value
  return name ? name.charAt(0).toUpperCase() : 'U'
})

function quotaToUSD(quota) {
  return '$' + (quota / env.quotaPerUnit).toFixed(2)
}

function go(url) {
  uni.navigateTo({ url })
}

function goInvite() {
  uni.switchTab({ url: '/pages/invite/index' })
}

const logoutBtnStyle = {
  borderRadius: '14rpx',
  height: '88rpx',
  fontSize: '30rpx',
  fontWeight: '500',
}

async function loadData() {
  loading.value = true
  try {
    const data = await getSelf()
    userInfo.value = data
    userStore.setUserInfo(data)
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
    refreshing.value = false
    uni.stopPullDownRefresh()
  }
}

async function onRefresh() {
  refreshing.value = true
  await loadData()
}

function doLogout() {
  uni.showModal({
    title: '确认退出',
    content: '确认退出登录？',
    success(res) {
      if (res.confirm) {
        userStore.clear()
        uni.reLaunch({ url: '/pages/login/index' })
      }
    }
  })
}

onLoad(() => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight
  if (!userStore.isLoggedIn) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  // Use cached info first, then refresh
  if (userStore.userInfo) {
    userInfo.value = userStore.userInfo
  }
  loadData()
})

onShow(() => {
  if (userInfo.value) loadData()
})

onPullDownRefresh(() => {
  loadData()
})
</script>

<style lang="scss" scoped>
.profile-page {
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
    padding: 0 32rpx;

    .nav-title {
      font-size: 34rpx;
      font-weight: 600;
      color: #1a1a2e;
    }
  }
}

.user-header {
  margin: 24rpx;
  background: linear-gradient(135deg, #4F6EF7, #6C8EFF);
  border-radius: 24rpx;
  padding: 36rpx;
  display: flex;
  align-items: center;
  box-shadow: 0 12rpx 40rpx rgba(79, 110, 247, 0.3);

  .avatar {
    width: 96rpx;
    height: 96rpx;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.25);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 24rpx;
    flex-shrink: 0;

    .avatar-letter {
      font-size: 44rpx;
      font-weight: 700;
      color: #fff;
    }
  }

  .user-info {
    flex: 1;

    .username {
      display: block;
      font-size: 32rpx;
      font-weight: 600;
      color: #fff;
      margin-bottom: 6rpx;
    }

    .user-id {
      font-size: 22rpx;
      color: rgba(255, 255, 255, 0.7);
    }
  }

  .balance-chip {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 12rpx;
    padding: 12rpx 20rpx;
    text-align: center;

    .chip-label {
      display: block;
      font-size: 20rpx;
      color: rgba(255, 255, 255, 0.75);
      margin-bottom: 4rpx;
    }

    .chip-value {
      font-size: 28rpx;
      font-weight: 700;
      color: #fff;
    }
  }
}

.menu-section {
  padding: 0 24rpx;

  .menu-card {
    background: #fff;
    border-radius: 20rpx;
    overflow: hidden;
    box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.05);
  }

  .menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 28rpx 32rpx;

    .menu-left {
      display: flex;
      align-items: center;

      .menu-icon {
        width: 72rpx;
        height: 72rpx;
        border-radius: 16rpx;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-right: 24rpx;
      }

      .menu-label {
        font-size: 30rpx;
        color: #1a1a2e;
        font-weight: 500;
      }
    }
  }

  .menu-divider {
    height: 1rpx;
    background: #f5f5f7;
    margin: 0 32rpx;
  }
}

.logout-section {
  padding: 48rpx 24rpx 0;
}

.version-text {
  text-align: center;
  padding: 32rpx 0 16rpx;
  font-size: 22rpx;
  color: #9ca3af;
}
</style>
