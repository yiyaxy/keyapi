<template>
  <view class="invite-page">
    <!-- Custom Nav Bar -->
    <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-content">
        <text class="nav-title">邀请中心</text>
        <view class="nav-action" @click="loadData">
          <u-icon name="reload" size="40" color="#4F6EF7" />
        </view>
      </view>
    </view>

    <scroll-view scroll-y style="flex: 1;" refresher-enabled @refresherrefresh="onRefresh" :refresher-triggered="refreshing">
      <!-- Invite code card -->
      <view class="code-card">
        <text class="code-label">我的专属邀请码</text>
        <view class="code-display">
          <text class="code-value">{{ userInfo?.aff_code || '--' }}</text>
        </view>
        <view class="code-actions">
          <u-button
            type="primary"
            :custom-style="copyBtnStyle"
            @click="copyCode"
          >
            复制邀请码
          </u-button>
        </view>
        <text class="code-hint">邀请好友注册并消费，即可获得奖励</text>
      </view>

      <!-- Stats cards -->
      <view class="stats-grid">
        <view class="stat-card">
          <text class="stat-number">{{ userInfo?.aff_history_quota || 0 }}</text>
          <text class="stat-name">累计奖励配额</text>
        </view>
        <view class="stat-card accent">
          <text class="stat-number">{{ quotaToUSD(userInfo?.aff_quota || 0) }}</text>
          <text class="stat-name">待转换奖励</text>
        </view>
        <view class="stat-card">
          <text class="stat-number">{{ quotaToUSD(pendingAffQuota) }}</text>
          <text class="stat-name">待审核转换</text>
        </view>
      </view>

      <!-- Transfer button -->
      <view class="transfer-section">
        <view class="transfer-card">
          <view class="transfer-header">
            <text class="transfer-title">转换为账户余额</text>
            <text class="transfer-sub">当前可转换: {{ quotaToUSD(userInfo?.aff_quota || 0) }}</text>
          </view>
          <u-button
            type="primary"
            :loading="transferring"
            :disabled="transferring || !userInfo?.aff_quota"
            :custom-style="transferBtnStyle"
            @click="doTransfer"
          >
            {{ transferring ? '转换中...' : '立即转换' }}
          </u-button>
        </view>
      </view>

      <!-- Rules section -->
      <view class="rules-card">
        <text class="rules-title">邀请规则</text>
        <view class="rule-item" v-for="(rule, i) in rules" :key="i">
          <view class="rule-dot" :style="{ background: rule.color }" />
          <text class="rule-text">{{ rule.text }}</text>
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
import { getSelf, transferAff, getPendingAffQuota } from '@/services/api.js'
import env from '@/config/env.js'

const statusBarHeight = ref(0)
const loading = ref(false)
const refreshing = ref(false)
const transferring = ref(false)
const userInfo = ref(null)
const pendingAffQuota = ref(0)

function quotaToUSD(quota) {
  return '$' + (quota / env.quotaPerUnit).toFixed(2)
}

const copyBtnStyle = {
  background: 'linear-gradient(135deg, #4F6EF7, #6C8EFF)',
  borderRadius: '14rpx',
  height: '80rpx',
  fontSize: '28rpx',
  border: 'none',
  width: '320rpx',
  boxShadow: '0 6rpx 20rpx rgba(79, 110, 247, 0.3)',
}

const transferBtnStyle = {
  background: 'linear-gradient(135deg, #18A058, #36c070)',
  borderRadius: '14rpx',
  height: '88rpx',
  fontSize: '30rpx',
  border: 'none',
  boxShadow: '0 6rpx 20rpx rgba(24, 160, 88, 0.3)',
}

const rules = [
  { text: '邀请好友成功注册后，好友消费即可为您带来奖励', color: '#4F6EF7' },
  { text: '邀请奖励以配额形式累积在"待转换奖励"中', color: '#18A058' },
  { text: '点击"立即转换"将奖励转换为账户余额（需审核）', color: '#f59e0b' },
  { text: '每次转换请求将进入审核队列，管理员审核通过后到账', color: '#ef4444' },
]

function copyCode() {
  const code = userInfo.value?.aff_code
  if (!code) return
  uni.setClipboardData({
    data: code,
    success() {
      uni.showToast({ title: '邀请码已复制', icon: 'none' })
    }
  })
}

async function doTransfer() {
  const quota = userInfo.value?.aff_quota
  if (!quota || quota <= 0) {
    uni.showToast({ title: '暂无可转换奖励', icon: 'none' })
    return
  }

  uni.showModal({
    title: '确认转换',
    content: `确认将 ${quotaToUSD(quota)} 的奖励转换为账户余额？需要管理员审核后到账。`,
    success: async (res) => {
      if (!res.confirm) return
      transferring.value = true
      try {
        await transferAff(quota)
        uni.showToast({ title: '转换申请已提交', icon: 'success' })
        await loadData()
      } catch (e) {
        // error shown by request.js
      } finally {
        transferring.value = false
      }
    }
  })
}

async function loadData() {
  loading.value = true
  try {
    const [self, pending] = await Promise.allSettled([getSelf(), getPendingAffQuota()])
    if (self.status === 'fulfilled') {
      userInfo.value = self.value
      userStore.setUserInfo(self.value)
    }
    if (pending.status === 'fulfilled') {
      pendingAffQuota.value = pending.value?.quota || pending.value || 0
    }
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

onLoad(() => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight
  if (!userStore.isLoggedIn) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
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
.invite-page {
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

.code-card {
  margin: 24rpx 24rpx 0;
  background: linear-gradient(135deg, #4F6EF7, #6C8EFF);
  border-radius: 24rpx;
  padding: 40rpx 36rpx;
  box-shadow: 0 12rpx 40rpx rgba(79, 110, 247, 0.3);
  display: flex;
  flex-direction: column;
  align-items: center;

  .code-label {
    font-size: 26rpx;
    color: rgba(255, 255, 255, 0.8);
    margin-bottom: 24rpx;
  }

  .code-display {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 16rpx;
    padding: 20rpx 48rpx;
    margin-bottom: 28rpx;

    .code-value {
      font-size: 48rpx;
      font-weight: 700;
      color: #fff;
      letter-spacing: 4rpx;
    }
  }

  .code-actions {
    margin-bottom: 20rpx;
  }

  .code-hint {
    font-size: 22rpx;
    color: rgba(255, 255, 255, 0.65);
    text-align: center;
  }
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16rpx;
  padding: 24rpx;

  .stat-card {
    background: #fff;
    border-radius: 16rpx;
    padding: 24rpx 16rpx;
    display: flex;
    flex-direction: column;
    align-items: center;
    box-shadow: 0 2rpx 10rpx rgba(0, 0, 0, 0.05);

    &.accent {
      background: linear-gradient(135deg, #e8f5e9, #f0faf2);
    }

    .stat-number {
      font-size: 28rpx;
      font-weight: 700;
      color: #1a1a2e;
      margin-bottom: 8rpx;
    }

    .stat-name {
      font-size: 20rpx;
      color: #6b7280;
      text-align: center;
      line-height: 1.4;
    }
  }
}

.transfer-section {
  padding: 0 24rpx;
  margin-bottom: 24rpx;

  .transfer-card {
    background: #fff;
    border-radius: 20rpx;
    padding: 32rpx;
    box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.05);

    .transfer-header {
      margin-bottom: 24rpx;

      .transfer-title {
        display: block;
        font-size: 30rpx;
        font-weight: 600;
        color: #1a1a2e;
        margin-bottom: 8rpx;
      }

      .transfer-sub {
        font-size: 24rpx;
        color: #6b7280;
      }
    }
  }
}

.rules-card {
  margin: 0 24rpx;
  background: #fff;
  border-radius: 20rpx;
  padding: 32rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.05);

  .rules-title {
    display: block;
    font-size: 30rpx;
    font-weight: 600;
    color: #1a1a2e;
    margin-bottom: 24rpx;
  }

  .rule-item {
    display: flex;
    align-items: flex-start;
    margin-bottom: 20rpx;

    .rule-dot {
      width: 12rpx;
      height: 12rpx;
      border-radius: 50%;
      margin-top: 10rpx;
      margin-right: 16rpx;
      flex-shrink: 0;
    }

    .rule-text {
      font-size: 26rpx;
      color: #374151;
      line-height: 1.6;
    }
  }
}
</style>
