<template>
  <view class="page">
    <view class="nav" :style="{ paddingTop: statusBarH + 'px' }">
      <view class="nav-inner">
        <text class="nav-title">邀请中心</text>
        <view class="nav-btn" @click="loadData">
          <u-icon name="reload" size="42" color="#4F6EF7" />
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
      <!-- 未登录提示 -->
      <template v-if="!userStore.isLoggedIn">
        <view class="login-prompt">
          <u-icon name="account" size="100" color="#9ca3af" />
          <text class="prompt-title">登录后查看邀请数据</text>
          <text class="prompt-sub">邀请好友注册，即可获得奖励额度</text>
          <view class="prompt-btn" @click="goLogin">立即登录</view>
        </view>
      </template>

      <!-- 已登录内容 -->
      <template v-else>
        <!-- 邀请码卡片 -->
        <view class="code-card">
          <text class="code-title">我的邀请码</text>
          <view class="code-row">
            <text class="code-val">{{ userInfo?.aff_code || '--' }}</text>
            <view class="copy-btn" @click="copyCode">
              <u-icon name="copy" size="36" color="#4F6EF7" />
              <text class="copy-txt">复制邀请码</text>
            </view>
          </view>
          <text class="code-tip">将邀请码分享给好友，好友注册后你将获得奖励</text>
        </view>

        <!-- 数据统计 -->
        <text class="section-title">邀请收益</text>
        <view class="stats-grid">
          <view class="s-item">
            <text class="s-val">{{ userInfo?.aff_count || 0 }}</text>
            <text class="s-label">已邀请人数</text>
          </view>
          <view class="s-item">
            <text class="s-val">{{ q2cny(userInfo?.aff_history_quota) }}</text>
            <text class="s-label">累计总奖励</text>
          </view>
          <view class="s-item">
            <text class="s-val accent">{{ q2cny(userInfo?.aff_quota) }}</text>
            <text class="s-label">待转换奖励</text>
          </view>
          <view class="s-item">
            <text class="s-val">{{ q2cny(Number(userInfo?.aff_history_quota || 0) - Number(userInfo?.aff_quota || 0)) }}</text>
            <text class="s-label">已转换额度</text>
          </view>
        </view>
      </template>

      <!-- 规则说明（访客也可见） -->
      <text class="section-title">邀请规则</text>
      <view class="rule-card">
        <view class="rule-item" v-for="(r, i) in rules" :key="i">
          <view class="rule-num">{{ i + 1 }}</view>
          <text class="rule-txt">{{ r }}</text>
        </view>
      </view>

      <view style="height:48rpx;" />
    </scroll-view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'
import { getSelf } from '@/services/api.js'
import { renderQuota } from '@/utils/quota.js'

const statusBarH = ref(0)
const refreshing = ref(false)
const userInfo = ref(null)

const rules = [
  '通过分享你的邀请码，邀请好友注册本平台。',
  '好友使用你的邀请码注册后，你将获得对应的奖励额度。',
  '好友产生消费时，你还可能获得额外的返利奖励。',
  '积累的奖励可联系管理员转换为账户余额。',
]

function q2cny(quota) { return renderQuota(quota) }

function copyCode() {
  const code = userInfo.value?.aff_code
  if (!code) return uni.showToast({ title: '邀请码为空', icon: 'none' })
  uni.setClipboardData({
    data: code,
    success: () => uni.showToast({ title: '邀请码已复制', icon: 'none' }),
  })
}

async function loadData() {
  refreshing.value = true
  try {
    const data = await getSelf()
    userInfo.value = data
    userStore.setUserInfo(data)
  } finally {
    refreshing.value = false
    uni.stopPullDownRefresh()
  }
}

async function onPullDown() {
  await loadData()
}

function goLogin() { uni.navigateTo({ url: '/pages/login/index' }) }

onLoad(() => {
  statusBarH.value = uni.getSystemInfoSync().statusBarHeight
  if (userStore.isLoggedIn) {
    if (userStore.userInfo) userInfo.value = userStore.userInfo
    loadData()
  }
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
  height: 88rpx;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 32rpx;
}
.nav-title { font-size: 34rpx; font-weight: 600; color: #1a1a2e; }
.nav-btn { padding: 10rpx; }
.scroll { flex: 1; }

.section-title {
  display: block;
  font-size: 28rpx; font-weight: 600; color: #6b7280;
  padding: 32rpx 32rpx 16rpx; letter-spacing: 1rpx;
}

/* 未登录提示 */
.login-prompt {
  margin: 80rpx 24rpx 40rpx;
  background: #fff; border-radius: 24rpx; padding: 60rpx 40rpx;
  display: flex; flex-direction: column; align-items: center;
  box-shadow: 0 4rpx 20rpx rgba(0,0,0,0.06);
}
.prompt-title { font-size: 32rpx; font-weight: 600; color: #1a1a2e; margin: 24rpx 0 12rpx; }
.prompt-sub { font-size: 26rpx; color: #6b7280; margin-bottom: 40rpx; }
.prompt-btn {
  width: 100%; height: 88rpx;
  background: linear-gradient(135deg, #4F6EF7, #6C8EFF);
  border-radius: 14rpx;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 30rpx; font-weight: 600;
  box-shadow: 0 6rpx 20rpx rgba(79,110,247,0.3);
}

.code-card {
  margin: 24rpx;
  background: linear-gradient(135deg, #4F6EF7, #7B9BFF);
  border-radius: 24rpx; padding: 40rpx;
  box-shadow: 0 12rpx 36rpx rgba(79,110,247,0.28);
}
.code-title { display: block; font-size: 26rpx; color: rgba(255,255,255,0.8); margin-bottom: 20rpx; }
.code-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20rpx; }
.code-val { font-size: 48rpx; font-weight: 700; color: #fff; letter-spacing: 6rpx; }
.copy-btn {
  display: flex; align-items: center;
  background: rgba(255,255,255,0.2);
  border-radius: 12rpx; padding: 12rpx 20rpx;
}
.copy-txt { font-size: 26rpx; color: #fff; margin-left: 8rpx; }
.code-tip { font-size: 22rpx; color: rgba(255,255,255,0.7); }

.stats-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 16rpx; padding: 0 24rpx;
}
.s-item {
  background: #fff; border-radius: 16rpx; padding: 28rpx 20rpx;
  display: flex; flex-direction: column; align-items: center;
  box-shadow: 0 2rpx 8rpx rgba(0,0,0,0.05);
}
.s-val { font-size: 30rpx; font-weight: 600; color: #1a1a2e; margin-bottom: 8rpx; }
.s-val.accent { color: #4F6EF7; }
.s-label { font-size: 24rpx; color: #6b7280; }

.rule-card {
  margin: 0 24rpx; background: #fff;
  border-radius: 20rpx; padding: 32rpx;
  box-shadow: 0 2rpx 10rpx rgba(0,0,0,0.05);
}
.rule-item { display: flex; align-items: flex-start; margin-bottom: 24rpx; }
.rule-item:last-child { margin-bottom: 0; }
.rule-num {
  width: 40rpx; height: 40rpx; min-width: 40rpx;
  background: #eef1ff; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 22rpx; font-weight: 600; color: #4F6EF7;
  margin-right: 16rpx; margin-top: 2rpx;
}
.rule-txt { font-size: 26rpx; color: #4b5563; line-height: 1.7; flex: 1; }
</style>
