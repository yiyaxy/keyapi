<template>
  <view class="tabbar">
    <view
      v-for="t in visibleTabs"
      :key="t.id"
      class="tab"
      :class="{ active: active === t.id }"
      @click="onTab(t)"
    >
      <view class="dot" v-if="active === t.id" />
      <view class="icon-wrap">
        <u-icon :name="t.icon" size="22" :color="active === t.id ? '#FFB84A' : '#9ca3af'" />
      </view>
      <text class="label" :class="{ active: active === t.id }">{{ t.label }}</text>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue'
import { userStore } from '@/store/user.js'

defineProps({
  active: { type: String, default: 'home' }
})

const tabs = [
  { id: 'home',    label: '首页', icon: 'home',           path: '/pages/home/index' },
  { id: 'apps',    label: '应用', icon: 'grid',           path: '/pages/apps/index' },
  { id: 'invite',  label: '邀请', icon: 'share',          path: '/pages/invite/index' },
  { id: 'profile', label: '我的', icon: 'account',        path: '/pages/profile/index' },
]

const visibleTabs = computed(() => {
  if (userStore.wxPayEnabled) return tabs
  return tabs.filter((t) => t.id !== 'invite')
})

function onTab(t) {
  if (t.id === activeId()) return
  uni.reLaunch({ url: t.path })
}

function activeId() {
  // 通过当前页路径推断（兜底）
  const pages = getCurrentPages()
  const route = pages[pages.length - 1]?.route || ''
  if (route.includes('home')) return 'home'
  if (route.includes('apps')) return 'apps'
  if (route.includes('invite')) return 'invite'
  if (route.includes('profile')) return 'profile'
  return ''
}
</script>

<style lang="scss" scoped>
.tabbar {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(24rpx);
  border-top: 1rpx solid rgba(0,0,0,0.05);
  box-shadow: 0 -2rpx 16rpx rgba(20,16,8,0.04);
  padding: 12rpx 32rpx calc(16rpx + env(safe-area-inset-bottom));
  display: flex;
  align-items: center;
  justify-content: space-around;
  z-index: 999;
}
.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  padding: 8rpx 0;
}
.dot {
  position: absolute;
  top: -2rpx;
  width: 8rpx; height: 8rpx;
  background: #FFB84A;
  border-radius: 50%;
  box-shadow: 0 0 10rpx #FFB84A;
}
.icon-wrap {
  width: 48rpx; height: 48rpx;
  display: flex; align-items: center; justify-content: center;
  transition: transform 0.2s;
}
.tab.active .icon-wrap { transform: scale(1.05); }
.label {
  font-size: 20rpx;
  color: #9ca3af;
  margin-top: 4rpx;
  font-weight: 500;
}
.label.active { color: #FFB84A; }
</style>
