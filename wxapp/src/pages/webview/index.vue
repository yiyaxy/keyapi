<template>
  <view class="page">
    <web-view v-if="src" :src="src" />
    <view v-else class="empty">
      <u-icon name="warning" size="32" color="#ef4444" />
      <text class="empty-title">应用地址无效</text>
      <text class="empty-desc">请返回应用中心重新打开</text>
      <view class="back-btn" @click="goBack">
        <text class="back-text">返回</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'

const src = ref('')

onLoad((options = {}) => {
  const url = safeDecode(options.url || '')
  const title = safeDecode(options.title || '')
  if (title) uni.setNavigationBarTitle({ title })
  if (/^https?:\/\//i.test(url)) {
    src.value = url
  }
})

function safeDecode(value) {
  try {
    return decodeURIComponent(String(value || ''))
  } catch {
    return String(value || '')
  }
}

function goBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack({ delta: 1 })
  } else {
    uni.reLaunch({ url: '/pages/apps/index' })
  }
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #f7f3ea;
}

.empty {
  min-height: 100vh;
  padding: 160rpx 48rpx 80rpx;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.empty-title {
  margin-top: 24rpx;
  font-size: 34rpx;
  color: #111827;
  font-weight: 800;
}

.empty-desc {
  margin-top: 12rpx;
  font-size: 26rpx;
  color: #6b7280;
}

.back-btn {
  margin-top: 40rpx;
  min-width: 180rpx;
  height: 76rpx;
  border-radius: 18rpx;
  background: #111827;
  display: flex;
  align-items: center;
  justify-content: center;
}

.back-text {
  font-size: 26rpx;
  color: #fff;
  font-weight: 700;
}
</style>
