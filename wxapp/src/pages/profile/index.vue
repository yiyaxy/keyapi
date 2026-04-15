<template>
  <view class="page">
    <!-- 自定义导航栏 -->
    <view class="nav" :style="{ paddingTop: statusBarH + 'px' }">
      <view class="nav-inner">
        <text class="nav-title">我的</text>
      </view>
    </view>

    <scroll-view
      scroll-y
      class="scroll"
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onPullDown"
    >
      <!-- 用户头像 + 基本信息 -->
      <view class="user-header">
        <view class="avatar">
          <text class="avatar-letter">{{ avatarLetter }}</text>
        </view>
        <view class="user-info">
          <text class="username">{{ displayName }}</text>
          <text class="user-id">ID: {{ userInfo?.id || '--' }}</text>
        </view>
        <view class="balance-chip">
          <text class="chip-label">当前余额</text>
          <text class="chip-val">{{ q2cny(userInfo?.quota) }}</text>
        </view>
      </view>

      <!-- 功能菜单 -->
      <view class="menu-card">
        <view class="menu-item" @click="nav('/pages/apikey/index')">
          <view class="menu-left">
            <view class="menu-icon" style="background:#eef1ff;">
              <u-icon name="setting" size="40" color="#4F6EF7" />
            </view>
            <text class="menu-label">API Key 管理</text>
          </view>
          <u-icon name="arrow-right" size="30" color="#9ca3af" />
        </view>
        <view class="menu-div" />

        <view class="menu-item" @click="nav('/pages/usage-records/index')">
          <view class="menu-left">
            <view class="menu-icon" style="background:#fff7e8;">
              <u-icon name="clock" size="40" color="#f59e0b" />
            </view>
            <text class="menu-label">消费记录</text>
          </view>
          <u-icon name="arrow-right" size="30" color="#9ca3af" />
        </view>
        <view class="menu-div" />

        <view class="menu-item" @click="nav('/pages/redeem/index')">
          <view class="menu-left">
            <view class="menu-icon" style="background:#e8faf0;">
              <u-icon name="coupon" size="40" color="#18A058" />
            </view>
            <text class="menu-label">兑换码充值</text>
          </view>
          <u-icon name="arrow-right" size="30" color="#9ca3af" />
        </view>
        <view class="menu-div" />

        <view class="menu-item" @click="switchTab('/pages/invite/index')">
          <view class="menu-left">
            <view class="menu-icon" style="background:#ffeef2;">
              <u-icon name="share" size="40" color="#ef4444" />
            </view>
            <text class="menu-label">邀请中心</text>
          </view>
          <u-icon name="arrow-right" size="30" color="#9ca3af" />
        </view>
      </view>

      <!-- 账户信息 -->
      <view class="info-card">
        <text class="info-title">账户信息</text>
        <view class="info-row">
          <text class="info-key">用户名</text>
          <text class="info-val">{{ userInfo?.username || '--' }}</text>
        </view>
        <view class="info-div" />
        <view class="info-row">
          <text class="info-key">账号状态</text>
          <view class="status-badge" :class="userInfo?.status === 1 ? 'status-ok' : 'status-err'">
            <text>{{ userInfo?.status === 1 ? '正常' : '受限' }}</text>
          </view>
        </view>
        <view class="info-div" />
        <view class="info-row">
          <text class="info-key">累计消费</text>
          <text class="info-val">{{ q2cny(userInfo?.used_quota) }}</text>
        </view>
        <view class="info-div" />
        <view class="info-row">
          <text class="info-key">累计请求</text>
          <text class="info-val">{{ userInfo?.request_count || 0 }} 次</text>
        </view>
      </view>

      <!-- 退出登录 -->
      <view class="logout-btn" @click="doLogout">
        <u-icon name="logout" size="36" color="#ef4444" />
        <text class="logout-txt">退出登录</text>
      </view>

      <view style="height:48rpx;" />
    </scroll-view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'
import { getSelf } from '@/services/api.js'
import { renderQuota } from '@/utils/quota.js'

const statusBarH = ref(0)
const refreshing = ref(false)
const userInfo = ref(null)

const displayName = computed(() => {
  const u = userInfo.value
  return u?.display_name || u?.username || '用户'
})

const avatarLetter = computed(() => {
  const name = displayName.value
  return name ? name.charAt(0).toUpperCase() : 'U'
})

function q2cny(quota) { return renderQuota(quota) }

function nav(url) { uni.navigateTo({ url }) }
function switchTab(url) { uni.switchTab({ url }) }

async function loadData() {
  refreshing.value = true
  try {
    const data = await getSelf()
    userInfo.value = data
    userStore.setUserInfo(data)
  } catch {
    // 已 toast
  } finally {
    refreshing.value = false
    uni.stopPullDownRefresh()
  }
}

function doLogout() {
  uni.showModal({
    title: '确认退出',
    content: '退出登录后需重新输入账号密码',
    confirmText: '确认退出',
    confirmColor: '#ef4444',
    cancelText: '取消',
    success(res) {
      if (res.confirm) {
        userStore.clear()
        uni.reLaunch({ url: '/pages/login/index' })
      }
    },
  })
}

async function onPullDown() {
  await loadData()
}

onLoad(() => {
  statusBarH.value = uni.getSystemInfoSync().statusBarHeight
  if (!userStore.isLoggedIn) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  if (userStore.userInfo) userInfo.value = userStore.userInfo
  loadData()
})

onShow(() => {
  if (userStore.isLoggedIn) loadData()
})
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: #f5f5f7; display: flex; flex-direction: column; }

.nav {
  background: #fff;
  box-shadow: 0 1rpx 0 #f0f0f0;
  position: sticky; top: 0; z-index: 100;
}
.nav-inner {
  height: 88rpx; display: flex; align-items: center;
  padding: 0 32rpx;
}
.nav-title { font-size: 34rpx; font-weight: 600; color: #1a1a2e; }
.scroll { flex: 1; }

/* 用户头部 */
.user-header {
  margin: 24rpx;
  background: linear-gradient(135deg, #4F6EF7, #7B9BFF);
  border-radius: 24rpx; padding: 40rpx 32rpx;
  display: flex; align-items: center;
  box-shadow: 0 10rpx 32rpx rgba(79,110,247,0.28);
}
.avatar {
  width: 96rpx; height: 96rpx;
  background: rgba(255,255,255,0.25);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  margin-right: 24rpx; flex-shrink: 0;
}
.avatar-letter { font-size: 44rpx; font-weight: 700; color: #fff; }
.user-info { flex: 1; }
.username { display: block; font-size: 32rpx; font-weight: 600; color: #fff; margin-bottom: 8rpx; }
.user-id { font-size: 24rpx; color: rgba(255,255,255,0.72); }
.balance-chip {
  background: rgba(255,255,255,0.2);
  border-radius: 16rpx; padding: 14rpx 20rpx;
  text-align: center; flex-shrink: 0;
}
.chip-label { display: block; font-size: 22rpx; color: rgba(255,255,255,0.8); margin-bottom: 6rpx; }
.chip-val { font-size: 28rpx; font-weight: 700; color: #fff; }

/* 功能菜单 */
.menu-card {
  margin: 0 24rpx;
  background: #fff; border-radius: 20rpx;
  box-shadow: 0 2rpx 10rpx rgba(0,0,0,0.05);
  overflow: hidden;
}
.menu-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 28rpx 32rpx;
}
.menu-left { display: flex; align-items: center; }
.menu-icon {
  width: 72rpx; height: 72rpx; border-radius: 16rpx;
  display: flex; align-items: center; justify-content: center;
  margin-right: 20rpx;
}
.menu-label { font-size: 28rpx; color: #1a1a2e; font-weight: 500; }
.menu-div { height: 1rpx; background: #f5f5f7; margin: 0 32rpx; }

/* 账户信息 */
.info-card {
  margin: 24rpx 24rpx 0;
  background: #fff; border-radius: 20rpx; padding: 32rpx;
  box-shadow: 0 2rpx 10rpx rgba(0,0,0,0.05);
}
.info-title { display: block; font-size: 28rpx; font-weight: 600; color: #1a1a2e; margin-bottom: 24rpx; }
.info-row { display: flex; align-items: center; justify-content: space-between; padding: 16rpx 0; }
.info-key { font-size: 26rpx; color: #6b7280; }
.info-val { font-size: 26rpx; color: #1a1a2e; font-weight: 500; }
.info-div { height: 1rpx; background: #f5f5f7; }
.status-badge {
  padding: 4rpx 16rpx; border-radius: 20rpx; font-size: 22rpx;
}
.status-ok { background: #e8faf0; color: #18A058; }
.status-err { background: #fff0f0; color: #D03050; }

/* 退出按钮 */
.logout-btn {
  margin: 24rpx;
  background: #fff; border-radius: 16rpx; padding: 32rpx;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2rpx 10rpx rgba(0,0,0,0.05);
}
.logout-txt { font-size: 30rpx; color: #ef4444; font-weight: 600; margin-left: 12rpx; }
</style>
