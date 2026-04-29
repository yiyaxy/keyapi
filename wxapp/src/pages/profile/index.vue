<template>
  <view class="page">
    <view class="bg-glow bg-glow-1" />
    <view class="bg-glow bg-glow-2" />

    <scroll-view scroll-y class="scroll">
      <view class="content" :style="{ paddingTop: (statusBarH + 24) + 'px' }">
        <view class="head">
          <text class="head-title">AI 算力账户中心</text>
        </view>

        <template v-if="!userStore.isLoggedIn">
          <view class="login-prompt">
            <u-icon name="account" size="44" color="#9ca3af" />
            <text class="prompt-title">登录后查看个人信息</text>
            <text class="prompt-sub">管理 API Key、查看消费记录</text>
            <view class="prompt-btn" @click="goLogin">立即登录</view>
          </view>
        </template>

        <template v-else>
          <!-- 用户信息 -->
          <view class="user-row">
            <view class="avatar">
              <text class="avatar-letter">{{ avatarLetter }}</text>
            </view>
            <view class="user-meta">
              <text class="user-name">{{ displayName }}</text>
              <view class="user-tags">
                <text class="user-id">ID: {{ userInfo?.id || '--' }}</text>
                <view class="user-level">
                  <text>{{ levelName }}</text>
                </view>
              </view>
            </view>
          </view>

          <!-- 总资产卡 -->
          <view class="assets-card">
            <view class="assets-head">
              <view class="assets-icon">
                <u-icon name="rmb" size="14" color="#1a1a2e" />
              </view>
              <text class="assets-label">总算力资产</text>
            </view>

            <view class="assets-main">
              <text class="assets-num">{{ tokenStr(totalAssets) }}</text>
              <text class="assets-unit">代币</text>
            </view>

            <view class="assets-grid">
              <view class="ag-cell">
                <text class="ag-label">已用算力</text>
                <text class="ag-val">{{ tokenStr(userInfo?.used_quota) }}</text>
              </view>
              <view class="ag-cell">
                <text class="ag-label">可用算力</text>
                <text class="ag-val">{{ tokenStr(userInfo?.quota) }}</text>
              </view>
            </view>

            <view class="progress-block">
              <text class="progress-label">累积消耗</text>
              <view class="progress-bar">
                <view class="progress-fill" :style="{ width: usedPct + '%' }" />
              </view>
              <text class="progress-text">{{ tokenStr(userInfo?.used_quota) }} 代币</text>
            </view>
          </view>

          <!-- 快捷入口 -->
          <view class="quick-grid">
            <view class="q-item" @click="nav('/pages/redeem/index')">
              <view class="q-icon-bare">
                <u-icon name="rmb-circle" size="28" color="#1a1a2e" />
              </view>
              <text class="q-label">充值</text>
            </view>
            <view class="q-item" @click="nav('/pages/apikey/index')">
              <view class="q-icon-bare">
                <u-icon name="setting" size="28" color="#1a1a2e" />
              </view>
              <text class="q-label">API 密钥</text>
            </view>
            <view class="q-item" @click="nav('/pages/usage-records/index')">
              <view class="q-icon-bare">
                <u-icon name="file-text" size="28" color="#1a1a2e" />
              </view>
              <text class="q-label">财务明细</text>
            </view>
            <!-- 客服入口暂时隐藏
            <view class="q-item" @click="onContactCS">
              <view class="q-icon-bare">
                <u-icon name="server-man" size="28" color="#1a1a2e" />
              </view>
              <text class="q-label">在线客服</text>
            </view>
            -->
          </view>

          <!-- 菜单列表（合并为一张白卡） -->
          <view class="menu-card">
            <view class="menu-row" @click="nav('/pages/orders/index')">
              <view class="menu-left">
                <u-icon name="server" size="20" color="#1a1a2e" />
                <text class="menu-text">充值记录</text>
              </view>
              <u-icon name="arrow-right" size="14" color="#9ca3af" />
            </view>
            <view class="menu-divider" />
            <view class="menu-row" @click="nav('/pages/usage-records/index')">
              <view class="menu-left">
                <u-icon name="more-circle" size="20" color="#1a1a2e" />
                <text class="menu-text">API 调用日志</text>
              </view>
              <u-icon name="arrow-right" size="14" color="#9ca3af" />
            </view>
            <view class="menu-divider" />
            <view class="menu-row" @click="onAppTap">
              <view class="menu-left">
                <u-icon name="grid" size="20" color="#1a1a2e" />
                <text class="menu-text">应用消耗记录</text>
              </view>
              <u-icon name="arrow-right" size="14" color="#9ca3af" />
            </view>
          </view>

          <!-- 退出登录 -->
          <view class="logout" @click="doLogout">
            <u-icon name="close-circle" size="18" color="#ef4444" />
            <text class="logout-txt">退出登录</text>
          </view>
        </template>

        <view style="height: 200rpx;" />
      </view>
    </scroll-view>

    <tab-bar active="profile" />
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'
import { getSelf } from '@/services/api.js'
import { renderQuota } from '@/utils/quota.js'

const statusBarH = ref(0)
const userInfo = ref(null)

const displayName = computed(() => {
  const u = userInfo.value
  return u?.display_name || u?.username || '用户'
})

const avatarLetter = computed(() => {
  const name = displayName.value
  return name ? name.charAt(0).toUpperCase() : 'U'
})

const levelName = computed(() => userInfo.value?.level_name || (userInfo.value?.level_id ? `等级 #${userInfo.value.level_id}` : '普通用户'))

const usedPct = computed(() => {
  const used = Number(userInfo.value?.used_quota || 0)
  const total = used + Number(userInfo.value?.quota || 0)
  if (!total) return 0
  return Math.min(100, Math.round(used * 100 / total))
})

const totalAssets = computed(() => {
  return Number(userInfo.value?.used_quota || 0) + Number(userInfo.value?.quota || 0)
})

function tokenStr(q) { return Number(q || 0).toLocaleString() }
function q2cny(q) { return renderQuota(q) }
function nav(url) { uni.navigateTo({ url }) }
function goLogin() { uni.navigateTo({ url: '/pages/login/index' }) }
function onContactCS() { uni.showToast({ title: '客服暂未开通', icon: 'none' }) }
function onAppTap() { uni.showToast({ title: '即将上线', icon: 'none' }) }

async function loadData() {
  try {
    const data = await getSelf()
    userInfo.value = data
    userStore.setUserInfo(data)
  } catch {}
}

function doLogout() {
  uni.showModal({
    title: '确认退出',
    content: '退出登录后需重新登录',
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

onLoad(() => {
  statusBarH.value = uni.getSystemInfoSync().statusBarHeight
  if (userStore.isLoggedIn) {
    if (userStore.userInfo) userInfo.value = userStore.userInfo
    loadData()
  }
})
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #faf7f0;
  position: relative;
  overflow: hidden;
}
.bg-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(120rpx);
  pointer-events: none;
  z-index: 0;
}
.bg-glow-1 {
  top: 5%; right: -25%;
  width: 500rpx; height: 500rpx;
  background: rgba(35, 150, 237, 0.08);
}
.bg-glow-2 {
  bottom: 15%; left: -25%;
  width: 500rpx; height: 500rpx;
  background: rgba(255, 184, 74, 0.12);
}

.scroll { position: relative; z-index: 1; height: 100vh; }
.content { padding: 0 32rpx; }

.head {
  display: flex; justify-content: center;
  margin-bottom: 40rpx;
}
.head-title {
  font-size: 34rpx;
  color: #1a1a2e;
  font-weight: 800;
}

.login-prompt {
  margin-top: 80rpx;
  background: #ffffff;
  border: 1rpx solid rgba(0,0,0,0.05);
  border-radius: 28rpx;
  padding: 60rpx 40rpx;
  display: flex; flex-direction: column; align-items: center;
  box-shadow: 0 4rpx 16rpx rgba(20,16,8,0.04);
}
.prompt-title {
  font-size: 30rpx;
  color: #1a1a2e;
  font-weight: 600;
  margin: 24rpx 0 12rpx;
}
.prompt-sub {
  font-size: 24rpx;
  color: #6b7280;
  margin-bottom: 36rpx;
}
.prompt-btn {
  width: 100%;
  height: 84rpx;
  background: linear-gradient(90deg, #2396ED 0%, #9D4EDD 100%);
  border-radius: 16rpx;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 28rpx; font-weight: 600;
}

/* User row */
.user-row {
  display: flex;
  align-items: center;
  margin-bottom: 36rpx;
  padding: 0 8rpx;
}
.avatar {
  width: 124rpx; height: 124rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, #1a1a2e 0%, #4a4a6a 100%);
  display: flex; align-items: center; justify-content: center;
  margin-right: 28rpx;
  flex-shrink: 0;
}
.avatar-letter {
  font-size: 56rpx;
  color: #ffffff;
  font-weight: 800;
}
.user-meta { flex: 1; min-width: 0; }
.user-name {
  display: block;
  font-size: 44rpx;
  color: #1a1a2e;
  font-weight: 800;
  margin-bottom: 12rpx;
  letter-spacing: -0.5rpx;
}
.user-tags {
  display: flex;
  align-items: center;
  gap: 14rpx;
  flex-wrap: wrap;
}
.user-id {
  font-size: 24rpx;
  color: #1a1a2e;
  font-weight: 500;
}
.user-level {
  border: 1rpx solid rgba(0,0,0,0.2);
  border-radius: 999rpx;
  padding: 4rpx 18rpx;
  background: transparent;
}
.user-level text {
  font-size: 22rpx;
  color: #1a1a2e;
}

/* Assets card */
.assets-card {
  background: #ffffff;
  border-radius: 48rpx;
  padding: 36rpx 36rpx 32rpx;
  margin-bottom: 36rpx;
  box-shadow:
    0 24rpx 56rpx rgba(20, 16, 8, 0.08),
    0 8rpx 20rpx rgba(20, 16, 8, 0.04),
    0 1rpx 2rpx rgba(255, 255, 255, 0.6) inset;
}
.assets-head {
  display: flex; align-items: center;
  margin-bottom: 16rpx;
}
.assets-icon {
  width: 36rpx; height: 36rpx;
  border-radius: 8rpx;
  border: 1rpx solid rgba(0,0,0,0.15);
  display: flex; align-items: center; justify-content: center;
  margin-right: 12rpx;
}
.assets-label {
  font-size: 26rpx;
  color: #1a1a2e;
  font-weight: 600;
}
.assets-main {
  display: flex;
  align-items: baseline;
  gap: 10rpx;
  margin-bottom: 28rpx;
}
.assets-num {
  font-size: 72rpx;
  color: #1a1a2e;
  font-weight: 800;
  letter-spacing: -2rpx;
  line-height: 1.1;
}
.assets-unit {
  font-size: 22rpx;
  color: #FFB84A;
  font-weight: 700;
}
.assets-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16rpx;
  border-top: 1rpx solid rgba(0,0,0,0.08);
  padding-top: 22rpx;
  margin-bottom: 22rpx;
}
.ag-cell { display: flex; flex-direction: column; }
.ag-label {
  font-size: 22rpx;
  color: #1a1a2e;
  margin-bottom: 4rpx;
}
.ag-val {
  font-size: 30rpx;
  color: #1a1a2e;
  font-weight: 700;
}
.progress-block {
  border-top: 1rpx solid rgba(0,0,0,0.08);
  padding-top: 22rpx;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}
.progress-label {
  display: block;
  font-size: 22rpx;
  color: #1a1a2e;
}
.progress-bar {
  width: 100%;
  height: 12rpx;
  background: rgba(255,184,74,0.18);
  border-radius: 999rpx;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #FFB84A 0%, #ffd685 100%);
  border-radius: 999rpx;
  transition: width 0.4s;
}
.progress-text {
  font-size: 26rpx;
  color: #1a1a2e;
  font-weight: 700;
}

/* Quick grid（无背景） */
.quick-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16rpx;
  margin-bottom: 32rpx;
  padding: 0 8rpx;
}
.q-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
}
.q-icon-bare {
  width: 56rpx; height: 56rpx;
  display: flex; align-items: center; justify-content: center;
}
.q-label {
  font-size: 24rpx;
  color: #1a1a2e;
  font-weight: 500;
}

/* Menu 单卡（带分隔） */
.menu-card {
  background: #ffffff;
  border-radius: 32rpx;
  padding: 8rpx 0;
  box-shadow:
    0 16rpx 40rpx rgba(20, 16, 8, 0.06),
    0 4rpx 12rpx rgba(20, 16, 8, 0.03);
}
.menu-row {
  padding: 28rpx 32rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.menu-left { display: flex; align-items: center; gap: 18rpx; }
.menu-text {
  font-size: 28rpx;
  color: #1a1a2e;
  font-weight: 500;
}
.menu-divider {
  height: 1rpx;
  background: rgba(0,0,0,0.06);
  margin: 0 32rpx;
}

/* Logout */
.logout {
  margin-top: 32rpx;
  background: rgba(239, 68, 68, 0.08);
  border: 1rpx solid rgba(239, 68, 68, 0.25);
  border-radius: 20rpx;
  padding: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
}
.logout-txt {
  font-size: 28rpx;
  color: #ef4444;
  font-weight: 600;
}
</style>
