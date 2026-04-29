<template>
  <view class="page">
    <view class="bg-glow bg-glow-1" />
    <view class="bg-glow bg-glow-2" />

    <scroll-view scroll-y class="scroll">
      <view class="content" :style="{ paddingTop: (statusBarH + 24) + 'px' }">

        <!-- Header -->
        <view class="head">
          <view>
            <text class="head-title">AI 应用中心</text>
            <text class="head-sub">使用 Token，直接体验热门 AI 能力</text>
          </view>
          <view class="head-chip">
            <view class="head-chip-icon">
              <u-icon name="star" size="11" color="#FFB84A" />
            </view>
            <view class="head-chip-text">
              <text class="head-chip-num">{{ tokenStr(userInfo?.quota) }}</text>
              <text class="head-chip-label">Tokens</text>
            </view>
          </view>
        </view>

        <!-- Featured 大卡 -->
        <view class="featured" :style="{ background: 'linear-gradient(135deg,#1E1B4B 0%,#312E81 50%,#831843 100%)' }" @click="onAppTap">
          <view class="featured-shade" />
          <view class="featured-inner">
            <view class="featured-title-row">
              <text class="featured-title">AI 形象诊断</text>
              <view class="featured-tag">
                <text>⚡ 50K</text>
              </view>
            </view>
            <text class="featured-desc">上传照片，获取多维度面部结构与风格深度解析报告</text>
            <view class="featured-tags">
              <text class="featured-tag-pill">面部比例</text>
              <text class="featured-tag-pill">风格建议</text>
              <text class="featured-tag-pill">高清输出</text>
            </view>
            <view class="featured-btn">
              <text>立即体验</text>
            </view>
          </view>
        </view>

        <!-- 双列小卡 -->
        <view class="duo">
          <!-- 左列 -->
          <view class="col">
            <!-- 最近使用 -->
            <view class="card-recent">
              <view class="card-recent-head">
                <u-icon name="search" size="14" color="#00F5FF" />
                <text class="card-recent-title">最近使用</text>
              </view>
              <view class="recent-list">
                <view v-for="i in 3" :key="i" class="recent-item">
                  <view class="recent-mini">
                    <u-icon name="star" size="10" color="#FFB84A" />
                  </view>
                  <text class="recent-text">AI 形象诊断</text>
                </view>
              </view>
            </view>

            <!-- 我的生成记录 -->
            <view class="card-history" @click="onAppTap">
              <view class="history-icon">
                <u-icon name="clock" size="18" color="rgba(255,255,255,0.6)" />
              </view>
              <text class="history-title">我的生成记录</text>
              <text class="history-sub">查看所有历史分析报告与生成的资产</text>
              <u-icon name="arrow-right" size="14" color="rgba(255,255,255,0.35)" />
            </view>
          </view>

          <!-- 右列 -->
          <view class="col">
            <!-- 手相 -->
            <view class="img-card-tall" :style="{ background: 'linear-gradient(135deg,#7C2D12 0%,#451A03 100%)' }" @click="onAppTap">
              <view class="img-card-shade" />
              <view class="img-card-inner">
                <view class="card-title-row">
                  <text class="card-title">AI 手相诊断</text>
                  <view class="badge"><text>分享免 Token</text></view>
                </view>
                <text class="card-desc">扫描掌纹，解读运势密码</text>
                <view class="card-btn"><text>去测试</text></view>
              </view>
            </view>

            <!-- 小红书 -->
            <view class="img-card-square" :style="{ background: 'linear-gradient(135deg,#9F1239 0%,#500724 100%)' }" @click="onAppTap">
              <view class="img-card-shade" />
              <view class="img-card-inner">
                <text class="card-title">小红书文案诊断</text>
                <text class="card-desc">爆款逻辑拆解，文案优化</text>
                <view class="card-btn"><text>开始诊断</text></view>
              </view>
            </view>
          </view>
        </view>

        <view style="height: 200rpx;" />
      </view>
    </scroll-view>

    <tab-bar active="apps" />
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'

const statusBarH = ref(0)
const userInfo = ref(null)

function tokenStr(q) { return Number(q || 0).toLocaleString() }

function onAppTap() {
  uni.showToast({ title: '即将上线，敬请期待', icon: 'none' })
}

onLoad(() => {
  statusBarH.value = uni.getSystemInfoSync().statusBarHeight
  if (userStore.userInfo) userInfo.value = userStore.userInfo
})
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #050a10;
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
  top: -10%; right: -20%;
  width: 500rpx; height: 500rpx;
  background: rgba(157, 78, 221, 0.18);
}
.bg-glow-2 {
  bottom: 10%; left: -25%;
  width: 500rpx; height: 500rpx;
  background: rgba(35, 150, 237, 0.15);
}

.scroll { position: relative; z-index: 1; height: 100vh; }
.content { padding: 0 32rpx; }

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 36rpx;
}
.head-title {
  display: block;
  font-size: 40rpx;
  color: #ffffff;
  font-weight: 700;
  margin-bottom: 6rpx;
}
.head-sub {
  display: block;
  font-size: 22rpx;
  color: rgba(255,255,255,0.45);
}
.head-chip {
  display: flex;
  align-items: center;
  background: rgba(255,255,255,0.05);
  border: 1rpx solid rgba(255,255,255,0.08);
  border-radius: 999rpx;
  padding: 10rpx 18rpx;
}
.head-chip-icon {
  width: 32rpx; height: 32rpx;
  border-radius: 50%;
  background: rgba(255,184,74,0.2);
  display: flex; align-items: center; justify-content: center;
  margin-right: 10rpx;
}
.head-chip-text { display: flex; flex-direction: column; align-items: flex-end; }
.head-chip-num {
  font-size: 20rpx;
  color: rgba(255,255,255,0.45);
  line-height: 1.1;
}
.head-chip-label {
  font-size: 20rpx;
  color: rgba(255,255,255,0.7);
  font-weight: 700;
  line-height: 1.1;
}

/* Featured 大卡 */
.featured {
  position: relative;
  border-radius: 36rpx;
  overflow: hidden;
  border: 1rpx solid rgba(255,255,255,0.06);
  aspect-ratio: 4 / 5;
  margin-bottom: 36rpx;
  box-shadow: 0 16rpx 48rpx rgba(0,0,0,0.4);
}
.featured-shade {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, transparent 35%, rgba(0,0,0,0.85) 100%);
}
.featured-inner {
  position: absolute; left: 32rpx; right: 32rpx; bottom: 36rpx;
  background: rgba(0,0,0,0.4);
  backdrop-filter: blur(20rpx);
  border: 1rpx solid rgba(255,255,255,0.08);
  border-radius: 28rpx;
  padding: 32rpx;
}
.featured-title-row {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14rpx;
}
.featured-title {
  font-size: 36rpx;
  color: #ffffff;
  font-weight: 700;
}
.featured-tag {
  background: rgba(255,255,255,0.1);
  border-radius: 999rpx;
  padding: 6rpx 14rpx;
}
.featured-tag text {
  font-size: 20rpx;
  color: #FFB84A;
  font-weight: 600;
}
.featured-desc {
  display: block;
  font-size: 24rpx;
  color: rgba(255,255,255,0.7);
  line-height: 1.6;
  margin-bottom: 20rpx;
}
.featured-tags {
  display: flex;
  gap: 10rpx;
  margin-bottom: 28rpx;
}
.featured-tag-pill {
  font-size: 20rpx;
  color: rgba(255,255,255,0.55);
  background: rgba(255,255,255,0.05);
  padding: 6rpx 14rpx;
  border-radius: 8rpx;
}
.featured-btn {
  height: 76rpx;
  border-radius: 14rpx;
  background: linear-gradient(90deg, #2396ED 0%, #9D4EDD 100%);
  display: flex; align-items: center; justify-content: center;
}
.featured-btn text {
  color: #ffffff;
  font-size: 26rpx;
  font-weight: 700;
}

/* 双列 */
.duo {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20rpx;
}
.col {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.card-recent {
  background: rgba(255,255,255,0.04);
  border: 1rpx solid rgba(0,245,255,0.12);
  border-radius: 24rpx;
  padding: 24rpx;
  aspect-ratio: 1 / 1;
  display: flex;
  flex-direction: column;
}
.card-recent-head {
  display: flex; align-items: center;
  margin-bottom: 16rpx;
}
.card-recent-title {
  margin-left: 10rpx;
  font-size: 24rpx;
  font-weight: 700;
  color: #ffffff;
}
.recent-list { display: flex; flex-direction: column; gap: 12rpx; }
.recent-item {
  display: flex; align-items: center;
  background: rgba(255,255,255,0.05);
  border-radius: 12rpx;
  padding: 12rpx;
}
.recent-mini {
  width: 28rpx; height: 28rpx;
  border-radius: 50%;
  background: rgba(255,184,74,0.12);
  display: flex; align-items: center; justify-content: center;
  margin-right: 10rpx;
}
.recent-text {
  font-size: 20rpx;
  color: rgba(255,255,255,0.7);
}

.card-history {
  background: rgba(255,255,255,0.04);
  border: 1rpx solid rgba(255,255,255,0.06);
  border-radius: 24rpx;
  padding: 24rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.history-icon {
  width: 60rpx; height: 60rpx;
  border-radius: 50%;
  background: rgba(255,255,255,0.06);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 14rpx;
}
.history-title {
  font-size: 24rpx;
  font-weight: 700;
  color: #ffffff;
  margin-bottom: 6rpx;
}
.history-sub {
  font-size: 18rpx;
  color: rgba(255,255,255,0.4);
  line-height: 1.5;
  margin-bottom: 12rpx;
}

.img-card-tall, .img-card-square {
  position: relative;
  border-radius: 32rpx;
  overflow: hidden;
  border: 1rpx solid rgba(255,255,255,0.06);
}
.img-card-tall { aspect-ratio: 2 / 3; }
.img-card-square { aspect-ratio: 1 / 1; }
.img-card-shade {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.8) 100%);
}
.img-card-inner {
  position: absolute; left: 14rpx; right: 14rpx; bottom: 14rpx;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(14rpx);
  border-radius: 18rpx;
  padding: 16rpx;
}
.card-title-row {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6rpx;
}
.card-title {
  font-size: 22rpx;
  color: #ffffff;
  font-weight: 700;
  display: block;
}
.badge {
  background: rgba(255,184,74,0.2);
  border-radius: 6rpx;
  padding: 4rpx 8rpx;
}
.badge text {
  font-size: 16rpx;
  color: #FFB84A;
}
.card-desc {
  display: block;
  font-size: 18rpx;
  color: rgba(255,255,255,0.45);
  line-height: 1.4;
  margin: 6rpx 0 12rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-btn {
  height: 48rpx;
  border-radius: 999rpx;
  border: 1rpx solid rgba(255,255,255,0.2);
  background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center;
}
.card-btn text {
  font-size: 20rpx;
  color: #ffffff;
}
</style>
