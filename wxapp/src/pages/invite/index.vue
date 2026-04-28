<template>
  <view class="page">
    <view class="nav" :style="{ paddingTop: statusBarH + 'px' }">
      <view class="nav-inner">
        <view class="back-btn" @click="goBack">
          <u-icon name="arrow-left" size="20" color="#1a1a2e" />
        </view>
        <text class="nav-title">我的下级</text>
        <view class="nav-btn" @click="loadData">
          <u-icon name="reload" size="21" color="#4F6EF7" />
        </view>
      </view>
    </view>

    <scroll-view scroll-y class="scroll" :style="scrollOffsetStyle">
      <template v-if="!userStore.isLoggedIn">
        <view class="login-prompt">
          <u-icon name="account" size="50" color="#9ca3af" />
          <text class="prompt-title">登录后查看下级</text>
          <text class="prompt-sub">分享小程序给新用户，好友登录后自动成为你的下级</text>
          <view class="prompt-btn" @click="goLogin">立即登录</view>
        </view>
      </template>

      <template v-else>
        <view class="share-card">
          <view class="share-copy">
            <text class="share-title">分享小程序拉新</text>
            <text class="share-sub">新用户通过你的分享进入并完成微信登录后，会自动绑定为你的下级。</text>
          </view>
          <button class="share-btn" open-type="share">
            <u-icon name="weixin-fill" size="18" color="#fff" />
            <text class="share-btn-text">分享给好友</text>
          </button>
        </view>

        <text class="section-title">拉新收益</text>
        <view class="stats-grid">
          <view class="s-item">
            <text class="s-val">{{ userInfo?.aff_count || 0 }}</text>
            <text class="s-label">我的下级</text>
          </view>
          <view class="s-item">
            <text class="s-val">{{ rewardLimitText }}</text>
            <text class="s-label">奖励上限</text>
          </view>
          <view class="s-item">
            <text class="s-val accent">{{ q2cny(userInfo?.aff_quota) }}</text>
            <text class="s-label">待转换奖励</text>
          </view>
          <view class="s-item">
            <text class="s-val">{{ q2cny(userInfo?.aff_history_quota) }}</text>
            <text class="s-label">累计总奖励</text>
          </view>
        </view>

        <text class="section-title">下级列表</text>
        <view class="invitee-card">
          <view v-if="invitees.length === 0 && !loading" class="empty">
            <u-icon name="account-fill" size="42" color="#cbd5e1" />
            <text class="empty-title">还没有下级</text>
            <text class="empty-sub">点击上方按钮分享小程序，邀请新用户加入。</text>
          </view>

          <view v-for="item in invitees" :key="item.id" class="invitee-item">
            <view class="invitee-avatar">
              <text>{{ avatarText(item) }}</text>
            </view>
            <view class="invitee-main">
              <text class="invitee-name">{{ item.display_name || item.username || '用户' }}</text>
              <text class="invitee-meta">ID: {{ item.id }} · 充值 {{ item.top_up_count || 0 }} 次</text>
            </view>
            <view class="invitee-status" :class="item.status === 1 ? 'ok' : 'disabled'">
              <text>{{ item.status === 1 ? '正常' : '受限' }}</text>
            </view>
          </view>

          <view v-if="hasMore" class="load-more" @click="loadMore">
            {{ loading ? '加载中...' : '加载更多' }}
          </view>
        </view>

        <text class="section-title">规则说明</text>
        <view class="rule-card">
          <view class="rule-item" v-for="(r, i) in rules" :key="i">
            <view class="rule-num">{{ i + 1 }}</view>
            <text class="rule-txt">{{ r }}</text>
          </view>
        </view>
      </template>

      <view style="height:48rpx;" />
    </scroll-view>
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

const scrollOffsetStyle = computed(() => ({
  paddingTop: `calc(${statusBarH.value}px + 88rpx)`,
  height: `calc(100vh - ${statusBarH.value}px - 88rpx)`,
}))

const rewardLimitText = computed(() => {
  const limit = Number(userStore.inviteRewardLimit || 0)
  return limit > 0 ? `${limit} 人` : '不限'
})

const hasMore = computed(() => invitees.value.length < total.value)

const rules = computed(() => [
  '分享小程序给新用户，对方通过分享进入并完成微信登录后自动成为你的下级。',
  '新用户登录成功后，系统立即按后台配置发放拉新注册奖励。',
  '注册拉新奖励可设置人数上限，达到上限后仍会保留上下级关系。',
  '下级后续充值时，仍按原有充值返利规则给上级返利。',
])

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

function goBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack({ delta: 1 })
  else uni.switchTab({ url: '/pages/profile/index' })
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
.page { min-height: 100vh; background: #f5f5f7; display: flex; flex-direction: column; }
.nav {
  background: #fff;
  box-shadow: 0 1rpx 0 #f0f0f0;
  position: fixed; left: 0; right: 0; top: 0; z-index: 100;
}
.nav-inner {
  height: 88rpx;
  display: grid; grid-template-columns: 80rpx 1fr 80rpx;
  align-items: center;
  padding: 0 20rpx;
}
.back-btn, .nav-btn { width: 64rpx; height: 64rpx; display: flex; align-items: center; justify-content: center; }
.nav-title { font-size: 34rpx; font-weight: 600; color: #1a1a2e; text-align: center; }
.scroll { flex: 1; box-sizing: border-box; }

.login-prompt {
  margin: 80rpx 24rpx 40rpx;
  background: #fff; border-radius: 24rpx; padding: 60rpx 40rpx;
  display: flex; flex-direction: column; align-items: center;
  box-shadow: 0 4rpx 20rpx rgba(0,0,0,0.06);
}
.prompt-title { font-size: 32rpx; font-weight: 600; color: #1a1a2e; margin: 24rpx 0 12rpx; }
.prompt-sub { font-size: 26rpx; color: #6b7280; margin-bottom: 40rpx; text-align: center; line-height: 1.6; }
.prompt-btn {
  width: 100%; height: 88rpx;
  background: linear-gradient(135deg, #4F6EF7, #6C8EFF);
  border-radius: 14rpx;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 30rpx; font-weight: 600;
}

.share-card {
  margin: 24rpx;
  background: linear-gradient(135deg, #4F6EF7, #7B9BFF);
  border-radius: 24rpx; padding: 36rpx 32rpx;
  box-shadow: 0 12rpx 36rpx rgba(79,110,247,0.24);
}
.share-copy { margin-bottom: 28rpx; }
.share-title { display: block; font-size: 36rpx; font-weight: 700; color: #fff; margin-bottom: 12rpx; }
.share-sub { display: block; font-size: 25rpx; line-height: 1.6; color: rgba(255,255,255,0.82); }
.share-btn {
  height: 88rpx; border-radius: 16rpx; border: 0; padding: 0;
  background: #09bb07; color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 30rpx; font-weight: 600;
}
.share-btn::after { border: 0; }
.share-btn-text { margin-left: 10rpx; color: #fff; }

.section-title {
  display: block;
  font-size: 28rpx; font-weight: 600; color: #6b7280;
  padding: 32rpx 32rpx 16rpx;
}
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

.invitee-card, .rule-card {
  margin: 0 24rpx; background: #fff;
  border-radius: 20rpx; padding: 12rpx 0;
  box-shadow: 0 2rpx 10rpx rgba(0,0,0,0.05);
  overflow: hidden;
}
.invitee-item {
  display: flex; align-items: center;
  padding: 24rpx 28rpx;
  border-bottom: 1rpx solid #f3f4f6;
}
.invitee-item:last-child { border-bottom: 0; }
.invitee-avatar {
  width: 72rpx; height: 72rpx; border-radius: 50%;
  background: #eef1ff; color: #4F6EF7;
  display: flex; align-items: center; justify-content: center;
  font-size: 30rpx; font-weight: 700;
  margin-right: 20rpx; flex-shrink: 0;
}
.invitee-main { flex: 1; min-width: 0; }
.invitee-name { display: block; font-size: 28rpx; font-weight: 600; color: #111827; }
.invitee-meta { display: block; margin-top: 6rpx; font-size: 23rpx; color: #8a8f98; }
.invitee-status { border-radius: 999rpx; padding: 6rpx 16rpx; font-size: 22rpx; }
.invitee-status.ok { background: #e8faf0; color: #18A058; }
.invitee-status.disabled { background: #fff0f0; color: #D03050; }
.empty {
  padding: 56rpx 32rpx;
  display: flex; flex-direction: column; align-items: center;
}
.empty-title { font-size: 30rpx; font-weight: 600; color: #374151; margin-top: 18rpx; }
.empty-sub { font-size: 24rpx; color: #8a8f98; margin-top: 10rpx; text-align: center; }
.load-more {
  height: 88rpx; display: flex; align-items: center; justify-content: center;
  font-size: 26rpx; color: #4F6EF7;
}

.rule-card { padding: 32rpx; }
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
