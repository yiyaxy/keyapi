<template>
  <view class="page">
    <view class="bg-glow bg-glow-1" />
    <view class="bg-glow bg-glow-2" />

    <scroll-view scroll-y class="scroll">
      <view class="content" :style="{ paddingTop: (statusBarH + 24) + 'px' }">
        <view class="head">
          <text class="head-title">REWARD HUB</text>
        </view>

        <template v-if="!userStore.isLoggedIn">
          <view class="login-prompt">
            <u-icon name="account" size="44" color="#9ca3af" />
            <text class="prompt-title">登录后查看下级</text>
            <text class="prompt-sub">分享小程序给新用户，好友登录后自动成为你的下级</text>
            <view class="prompt-btn" @click="goLogin">立即登录</view>
          </view>
        </template>

        <template v-else>
          <!-- Banner -->
          <view class="banner" :style="{ background: 'linear-gradient(120deg, #1E1B4B 0%, #4338CA 50%, #7E22CE 100%)' }">
            <view class="banner-shade" />
            <view class="banner-text">
              <text class="banner-title">邀请好友赚 Token</text>
              <text class="banner-sub">好友注册、使用、充值，你都可以获得奖励。构建你的算力网络。</text>
            </view>
            <button class="banner-share" open-type="share">
              <u-icon name="weixin-fill" size="16" color="#050a10" />
              <text class="banner-share-txt">分享</text>
            </button>
          </view>

          <!-- 奖励里程碑 -->
          <text class="section-label">REWARD MILESTONES</text>
          <view class="milestones">
            <view v-for="(m, i) in milestones" :key="i" class="milestone-card">
              <view class="ms-icon">
                <u-icon :name="m.icon" size="20" color="#FFB84A" />
              </view>
              <text class="ms-label">{{ m.label }}</text>
              <text class="ms-value">{{ m.value }}</text>
            </view>
          </view>

          <!-- 拉新数据 -->
          <text class="section-label">MY STATS</text>
          <view class="stat-row">
            <view class="stat-card stat-card-glow">
              <text class="stat-num">{{ userInfo?.aff_count || 0 }}</text>
              <text class="stat-label">已邀请人数</text>
            </view>
            <view class="stat-card">
              <text class="stat-num gold">{{ q2cny(userInfo?.aff_quota) }}</text>
              <text class="stat-label">待转换奖励</text>
            </view>
            <view class="stat-card">
              <text class="stat-num">{{ q2cny(userInfo?.aff_history_quota) }}</text>
              <text class="stat-label">累计奖励</text>
            </view>
          </view>

          <!-- 充值返佣 -->
          <text class="section-label">RECHARGE BONUS</text>
          <view class="bonus-card">
            <view class="bonus-left">
              <text class="bonus-pct">10%</text>
              <text class="bonus-title">终身返佣</text>
            </view>
            <view class="bonus-right">
              <text class="bonus-r-1">实时结算</text>
              <text class="bonus-r-2">RMB / TKN</text>
            </view>
          </view>

          <!-- 下级列表 -->
          <view class="list-tabs">
            <view
              class="list-tab"
              :class="{ active: activeTab === 'invitees' }"
              @click="activeTab = 'invitees'"
            >
              <text>邀请记录</text>
              <view v-if="activeTab === 'invitees'" class="tab-underline" />
            </view>
            <view
              class="list-tab"
              :class="{ active: activeTab === 'rules' }"
              @click="activeTab = 'rules'"
            >
              <text>规则说明</text>
              <view v-if="activeTab === 'rules'" class="tab-underline" />
            </view>
          </view>

          <view v-if="activeTab === 'invitees'" class="list">
            <view v-if="invitees.length === 0 && !loading" class="empty">
              <u-icon name="account-fill" size="40" color="#d1d5db" />
              <text class="empty-title">还没有下级</text>
              <text class="empty-sub">点击上方按钮分享小程序，邀请新用户</text>
            </view>
            <view v-for="item in invitees" :key="item.id" class="list-row">
              <view class="row-left">
                <view class="row-avatar">
                  <text>{{ avatarText(item) }}</text>
                </view>
                <view class="row-meta">
                  <text class="row-name">{{ item.display_name || item.username || '用户' }}</text>
                  <text class="row-sub">ID: {{ item.id }} · 充值 {{ item.top_up_count || 0 }} 次</text>
                </view>
              </view>
              <view class="row-right">
                <text class="row-status" :class="item.status === 1 ? 'ok' : 'err'">
                  {{ item.status === 1 ? '正常' : '受限' }}
                </text>
                <view class="row-dot" />
              </view>
            </view>
            <view v-if="hasMore" class="load-more" @click="loadMore">
              {{ loading ? '加载中...' : '加载更多' }}
            </view>
          </view>

          <view v-else class="rule-card">
            <view v-for="(r, i) in rules" :key="i" class="rule-item">
              <view class="rule-num"><text>{{ i + 1 }}</text></view>
              <text class="rule-text">{{ r }}</text>
            </view>
          </view>
        </template>

        <view style="height: 200rpx;" />
      </view>
    </scroll-view>

    <tab-bar active="invite" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'
import { getInvitees, getSelf } from '@/services/api.js'
import { renderQuota } from '@/utils/quota.js'

const statusBarH = ref(0)
const loading = ref(false)
const userInfo = ref(null)
const invitees = ref([])
const page = ref(1)
const total = ref(0)
const pageSize = 20
const activeTab = ref('invitees')

const milestones = [
  { label: '注册奖励', value: '+50 TKN', icon: 'account-fill' },
  { label: '首次使用', value: '+100 TKN', icon: 'star-fill' },
  { label: '双方互赏', value: '+20 TKN', icon: 'gift-fill' },
]

const rules = [
  '分享小程序给新用户，对方通过分享进入并完成微信登录后自动成为你的下级。',
  '新用户登录成功后，系统立即按后台配置发放拉新注册奖励。',
  '注册拉新奖励可设置人数上限，达到上限后仍会保留上下级关系。',
  '下级后续充值时，仍按原有充值返利规则给上级返利。',
]

const hasMore = computed(() => invitees.value.length < total.value)

function q2cny(quota) { return renderQuota(quota) }
function avatarText(item) {
  const name = item.display_name || item.username || 'U'
  return name.charAt(0).toUpperCase()
}

async function loadData() {
  if (loading.value) return
  loading.value = true
  try {
    const [self, list] = await Promise.all([
      getSelf(),
      getInvitees(1, pageSize),
    ])
    userInfo.value = self
    userStore.setUserInfo(self)
    page.value = 1
    invitees.value = list?.items || []
    total.value = Number(list?.total || 0)
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (loading.value || !hasMore.value) return
  loading.value = true
  try {
    const nextPage = page.value + 1
    const list = await getInvitees(nextPage, pageSize)
    page.value = nextPage
    invitees.value = invitees.value.concat(list?.items || [])
    total.value = Number(list?.total || total.value)
  } finally {
    loading.value = false
  }
}

function goLogin() { uni.navigateTo({ url: '/pages/login/index' }) }

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
  top: -10%; left: -20%;
  width: 500rpx; height: 500rpx;
  background: rgba(157, 78, 221, 0.1);
}
.bg-glow-2 {
  bottom: 20%; right: -25%;
  width: 500rpx; height: 500rpx;
  background: rgba(255, 184, 74, 0.12);
}

.scroll { position: relative; z-index: 1; height: 100vh; }
.content { padding: 0 32rpx; }

.head {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 32rpx;
}
.head-title {
  font-size: 28rpx;
  color: #1a1a2e;
  font-weight: 700;
  letter-spacing: 6rpx;
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
  text-align: center;
  line-height: 1.6;
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

/* Banner */
.banner {
  position: relative;
  border-radius: 32rpx;
  overflow: hidden;
  border: 1rpx solid rgba(255,255,255,0.06);
  padding: 36rpx 32rpx;
  margin-bottom: 36rpx;
  box-shadow: 0 16rpx 40rpx rgba(126, 34, 206, 0.25);
}
.banner-shade {
  position: absolute; inset: 0;
  background: linear-gradient(110deg, rgba(0,0,0,0.5) 0%, transparent 70%);
}
.banner-text {
  position: relative;
  z-index: 2;
  margin-bottom: 24rpx;
}
.banner-title {
  display: block;
  font-size: 40rpx;
  color: #ffffff;
  font-weight: 800;
  margin-bottom: 12rpx;
  letter-spacing: -0.5rpx;
}
.banner-sub {
  display: block;
  font-size: 22rpx;
  color: rgba(255,255,255,0.7);
  line-height: 1.6;
  max-width: 480rpx;
}
.banner-share {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  background: #FFB84A;
  border: 0;
  border-radius: 999rpx;
  padding: 0 28rpx;
  height: 64rpx;
  width: auto;
  min-width: 0;
  margin: 0;
  line-height: 1;
}
.banner-share::after { border: 0; }
.banner-share-txt {
  font-size: 24rpx;
  color: #050a10;
  font-weight: 700;
  margin-left: 8rpx;
}

/* Section label */
.section-label {
  display: block;
  font-size: 22rpx;
  color: #9ca3af;
  font-weight: 700;
  letter-spacing: 4rpx;
  margin: 16rpx 0 20rpx;
}

/* Milestones */
.milestones {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16rpx;
  margin-bottom: 36rpx;
}
.milestone-card {
  background: #ffffff;
  border: 1rpx solid rgba(0,0,0,0.05);
  border-radius: 24rpx;
  padding: 28rpx 16rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  box-shadow: 0 4rpx 16rpx rgba(20,16,8,0.04);
}
.ms-icon {
  width: 64rpx; height: 64rpx;
  border-radius: 18rpx;
  background: rgba(255,184,74,0.18);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 16rpx;
}
.ms-label {
  font-size: 22rpx;
  color: #6b7280;
  margin-bottom: 8rpx;
}
.ms-value {
  font-size: 24rpx;
  color: #d97706;
  font-weight: 700;
}

/* Stats row */
.stat-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16rpx;
  margin-bottom: 36rpx;
}
.stat-card {
  background: #ffffff;
  border: 1rpx solid rgba(0,0,0,0.05);
  border-radius: 20rpx;
  padding: 24rpx 16rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: 0 4rpx 16rpx rgba(20,16,8,0.04);
}
.stat-card-glow {
  border-color: rgba(255,184,74,0.4);
  box-shadow: 0 6rpx 20rpx rgba(255,184,74,0.15);
}
.stat-num {
  font-size: 30rpx;
  color: #1a1a2e;
  font-weight: 700;
  margin-bottom: 6rpx;
}
.stat-num.gold { color: #d97706; }
.stat-label {
  font-size: 20rpx;
  color: #9ca3af;
}

/* Bonus */
.bonus-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #ffffff;
  border: 1rpx solid rgba(255,184,74,0.4);
  box-shadow: 0 8rpx 28rpx rgba(255,184,74,0.15);
  border-radius: 24rpx;
  padding: 32rpx 28rpx;
  margin-bottom: 36rpx;
}
.bonus-left { display: flex; align-items: center; gap: 18rpx; }
.bonus-pct {
  font-size: 52rpx;
  font-weight: 800;
  color: #d97706;
  letter-spacing: -1rpx;
}
.bonus-title {
  font-size: 32rpx;
  color: #1a1a2e;
  font-weight: 700;
}
.bonus-right { text-align: right; }
.bonus-r-1 {
  display: block;
  font-size: 20rpx;
  color: #9ca3af;
  margin-bottom: 4rpx;
}
.bonus-r-2 {
  display: block;
  font-size: 20rpx;
  color: #1a1a2e;
  font-weight: 700;
  letter-spacing: 1rpx;
}

/* List tabs */
.list-tabs {
  display: flex;
  gap: 56rpx;
  border-bottom: 1rpx solid rgba(0,0,0,0.06);
  margin-bottom: 24rpx;
  padding-top: 8rpx;
}
.list-tab {
  position: relative;
  padding-bottom: 18rpx;
  font-size: 26rpx;
  color: #9ca3af;
  font-weight: 700;
}
.list-tab.active { color: #1a1a2e; }
.tab-underline {
  position: absolute;
  bottom: -1rpx;
  left: 0; right: 0;
  height: 4rpx;
  background: #FFB84A;
  border-radius: 4rpx;
}

/* List rows */
.list { display: flex; flex-direction: column; }
.empty {
  padding: 60rpx 32rpx;
  display: flex; flex-direction: column; align-items: center;
}
.empty-title {
  font-size: 26rpx;
  color: #4b5563;
  font-weight: 600;
  margin-top: 16rpx;
}
.empty-sub {
  font-size: 22rpx;
  color: #9ca3af;
  margin-top: 8rpx;
  text-align: center;
}
.list-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 0;
  border-bottom: 1rpx solid rgba(0,0,0,0.04);
}
.row-left { display: flex; align-items: center; }
.row-avatar {
  width: 64rpx; height: 64rpx;
  border-radius: 50%;
  background: rgba(255,184,74,0.18);
  display: flex; align-items: center; justify-content: center;
  margin-right: 18rpx;
  color: #d97706;
  font-size: 26rpx;
  font-weight: 700;
}
.row-name {
  display: block;
  font-size: 26rpx;
  color: #1a1a2e;
  font-weight: 600;
}
.row-sub {
  display: block;
  font-size: 20rpx;
  color: #9ca3af;
  margin-top: 4rpx;
}
.row-right { display: flex; align-items: center; gap: 10rpx; }
.row-status {
  font-size: 22rpx;
  font-weight: 700;
}
.row-status.ok { color: #d97706; }
.row-status.err { color: #ef4444; }
.row-dot {
  width: 10rpx; height: 10rpx;
  border-radius: 50%;
  background: #FFB84A;
}
.load-more {
  height: 88rpx;
  display: flex; align-items: center; justify-content: center;
  font-size: 24rpx;
  color: #9ca3af;
}

/* Rules */
.rule-card {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  padding: 8rpx 0;
}
.rule-item {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
}
.rule-num {
  width: 40rpx; height: 40rpx;
  min-width: 40rpx;
  border-radius: 50%;
  background: rgba(255,184,74,0.15);
  display: flex; align-items: center; justify-content: center;
  margin-top: 2rpx;
}
.rule-num text {
  font-size: 22rpx;
  color: #FFB84A;
  font-weight: 700;
}
.rule-text {
  flex: 1;
  font-size: 24rpx;
  color: #4b5563;
  line-height: 1.7;
}
</style>
