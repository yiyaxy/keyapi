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
              <text class="head-chip-emoji">∞</text>
            </view>
            <view class="head-chip-text">
              <text class="head-chip-num">{{ tokenStr(userInfo?.quota) }}</text>
              <text class="head-chip-label">Tokens</text>
            </view>
          </view>
        </view>

        <!-- 双列瀑布流 -->
        <view class="masonry">
          <!-- 左列 -->
          <view class="col">
            <!-- AI 形象诊断 大卡 -->
            <view class="img-card big-card" :style="{ background: 'linear-gradient(160deg,#1f2024 0%,#2a2826 60%,#3a3833 100%)' }" @click="onAppTap">
              <view class="card-shade" />
              <view class="card-overlay">
                <view class="card-title-row">
                  <text class="card-title-lg">AI 形象诊断</text>
                  <view class="badge-tk">
                    <text class="badge-tk-txt">∞ 50</text>
                  </view>
                </view>
                <text class="card-desc-lg">上传照片，获取多维度面部结构与风格深度解析报告。</text>
                <view class="tag-row">
                  <text class="tag-pill">面部比例</text>
                  <text class="tag-pill">风格建议</text>
                  <text class="tag-pill">高清输出</text>
                </view>
                <view class="btn-yellow">
                  <text class="btn-yellow-txt">立即体验</text>
                </view>
              </view>
            </view>

            <!-- 最近使用 -->
            <view class="recent-card">
              <view class="recent-head">
                <view class="recent-head-left">
                  <u-icon name="clock" size="16" color="#1a1a2e" />
                  <text class="recent-head-title">最近使用</text>
                </view>
                <text class="recent-link">查看全部</text>
              </view>
              <view class="recent-list">
                <view v-for="i in 3" :key="i" class="recent-item">
                  <view class="recent-mini">
                    <u-icon name="star" size="12" color="#1a1a2e" />
                  </view>
                  <text class="recent-text">AI 形象诊断</text>
                </view>
              </view>
            </view>

            <!-- 我的生成记录 -->
            <view class="folder-card" @click="onAppTap">
              <view class="folder-icon">
                <u-icon name="folder" size="22" color="#6b7280" />
              </view>
              <text class="folder-title">我的生成记录</text>
              <text class="folder-sub">查看所有历史分析报告与生成的资产</text>
              <view class="folder-arrow">
                <u-icon name="arrow-right" size="14" color="#9ca3af" />
              </view>
            </view>
          </view>

          <!-- 右列 -->
          <view class="col">
            <!-- AI 手相分享 -->
            <view class="img-card med-card" :style="{ background: 'linear-gradient(160deg,#3d2b1f 0%,#4a3120 50%,#1f1410 100%)' }" @click="onAppTap">
              <view class="card-shade" />
              <view class="card-overlay">
                <view class="card-title-row">
                  <text class="card-title-md">AI 手相分享</text>
                  <view class="badge-share">
                    <text class="badge-share-txt">分享免 Token</text>
                  </view>
                </view>
                <text class="card-desc-md">扫描掌纹，解读运势密码，分享可获取额外 Tokens。</text>
                <view class="tag-row">
                  <text class="tag-pill">面部比例</text>
                  <text class="tag-pill">风格建议</text>
                  <text class="tag-pill">高清输出</text>
                </view>
                <view class="btn-dark">
                  <text class="btn-dark-txt">去测试</text>
                </view>
              </view>
            </view>

            <!-- 小红书内容诊断 -->
            <view class="img-card med-card" :style="{ background: 'linear-gradient(160deg,#2c2c2c 0%,#1f1f1f 60%,#0f0f0f 100%)' }" @click="onAppTap">
              <view class="card-shade" />
              <view class="card-overlay">
                <view class="card-title-row">
                  <text class="card-title-md">小红书内容诊断</text>
                  <view class="badge-tk">
                    <text class="badge-tk-txt">∞ 20</text>
                  </view>
                </view>
                <text class="card-desc-md">爆款逻辑拆解，文案优化建议，提升笔记流量。</text>
                <view class="tag-row">
                  <text class="tag-pill">面部比例</text>
                  <text class="tag-pill">风格建议</text>
                  <text class="tag-pill">高清输出</text>
                </view>
                <view class="btn-dark">
                  <text class="btn-dark-txt">开始诊断</text>
                </view>
              </view>
            </view>

            <!-- 最近使用 - 副 -->
            <view class="recent-card mini">
              <view class="recent-head">
                <view class="recent-head-left">
                  <u-icon name="clock" size="14" color="#1a1a2e" />
                  <text class="recent-head-title">最近使用</text>
                </view>
                <text class="recent-link">查看全部</text>
              </view>
              <view class="folder-icon mini-folder">
                <u-icon name="folder" size="20" color="#6b7280" />
              </view>
            </view>

            <!-- 我的生成记录 - 副 -->
            <view class="folder-card" @click="onAppTap">
              <view class="folder-icon">
                <u-icon name="folder" size="22" color="#6b7280" />
              </view>
              <text class="folder-title">我的生成记录</text>
              <text class="folder-sub">查看所有历史分析报告与生成的资产</text>
              <view class="folder-arrow">
                <u-icon name="arrow-right" size="14" color="#9ca3af" />
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
  top: -10%; right: -20%;
  width: 500rpx; height: 500rpx;
  background: rgba(157, 78, 221, 0.08);
}
.bg-glow-2 {
  bottom: 10%; left: -25%;
  width: 500rpx; height: 500rpx;
  background: rgba(255, 184, 74, 0.12);
}

.scroll { position: relative; z-index: 1; height: 100vh; }
.content { padding: 0 32rpx; }

/* 顶部 */
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 36rpx;
}
.head-title {
  display: block;
  font-size: 40rpx;
  color: #1a1a2e;
  font-weight: 800;
  margin-bottom: 6rpx;
  letter-spacing: -0.5rpx;
}
.head-sub {
  display: block;
  font-size: 22rpx;
  color: #6b7280;
}
.head-chip {
  display: flex;
  align-items: center;
  background: #ffffff;
  border: 1rpx solid rgba(0,0,0,0.06);
  border-radius: 999rpx;
  padding: 12rpx 20rpx;
  box-shadow: 0 4rpx 12rpx rgba(20,16,8,0.04);
}
.head-chip-icon {
  width: 36rpx; height: 36rpx;
  border-radius: 50%;
  background: #1a1a2e;
  display: flex; align-items: center; justify-content: center;
  margin-right: 10rpx;
}
.head-chip-emoji {
  font-size: 20rpx;
  color: #ffffff;
  font-weight: 800;
}
.head-chip-text { display: flex; flex-direction: column; align-items: flex-start; }
.head-chip-num {
  font-size: 22rpx;
  color: #1a1a2e;
  font-weight: 700;
  line-height: 1.2;
}
.head-chip-label {
  font-size: 18rpx;
  color: #6b7280;
  line-height: 1.2;
}

/* 双列瀑布流 */
.masonry {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20rpx;
  align-items: start;
}
.col {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

/* 图片卡（形象诊断/手相/小红书）共用 */
.img-card {
  position: relative;
  border-radius: 32rpx;
  overflow: hidden;
  border: 1rpx solid rgba(0,0,0,0.05);
  box-shadow: 0 8rpx 24rpx rgba(20,16,8,0.1);
}
.big-card { aspect-ratio: 3 / 6.3; }
.med-card { aspect-ratio: 3 / 4; }
.card-shade {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.5) 100%);
}
.card-overlay {
  position: absolute;
  left: 14rpx; right: 14rpx;
  top: 66.67%;
  bottom: 14rpx;
  background: rgba(255, 247, 240, 0.94);
  border: 1rpx solid rgba(255,255,255,0.4);
  border-radius: 22rpx;
  padding: 18rpx;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
}
.big-card .card-overlay { padding: 24rpx; }
.med-card .card-overlay { padding: 14rpx; }
.card-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8rpx;
}
.med-card .card-title-row { margin-bottom: 4rpx; }
.big-card .card-title-row { margin-bottom: 8rpx; }
.card-title-lg {
  font-size: 32rpx;
  color: #1a1a2e;
  font-weight: 800;
  letter-spacing: -0.5rpx;
}
.card-title-md {
  font-size: 24rpx;
  color: #1a1a2e;
  font-weight: 800;
  letter-spacing: -0.3rpx;
}
.badge-tk {
  background: rgba(0,0,0,0.06);
  border-radius: 999rpx;
  padding: 3rpx 10rpx;
  flex-shrink: 0;
}
.badge-tk-txt {
  font-size: 16rpx;
  color: #1a1a2e;
  font-weight: 700;
}
.badge-share {
  background: #FFB84A;
  border-radius: 6rpx;
  padding: 3rpx 8rpx;
  flex-shrink: 0;
}
.badge-share-txt {
  font-size: 14rpx;
  color: #1a1a2e;
  font-weight: 700;
}
.card-desc-lg {
  display: block;
  font-size: 22rpx;
  color: #4b5563;
  line-height: 1.55;
  margin-bottom: 12rpx;
}
.card-desc-md {
  display: block;
  font-size: 18rpx;
  color: #4b5563;
  line-height: 1.4;
  margin-bottom: 6rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.tag-row {
  display: flex;
  flex-wrap: nowrap;
  gap: 6rpx;
  overflow: hidden;
}
.big-card .tag-row { margin-bottom: 14rpx; gap: 8rpx; }
.med-card .tag-row { margin-bottom: 6rpx; }
.tag-pill {
  font-size: 14rpx;
  color: #6b7280;
  background: rgba(255,255,255,0.7);
  border: 1rpx solid rgba(0,0,0,0.06);
  padding: 2rpx 8rpx;
  border-radius: 6rpx;
  white-space: nowrap;
  flex-shrink: 0;
}
.big-card .tag-pill {
  font-size: 18rpx;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
}
.btn-yellow {
  height: 64rpx;
  border-radius: 16rpx;
  background: #FFB84A;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4rpx 12rpx rgba(255,184,74,0.3);
}
.btn-yellow-txt {
  font-size: 24rpx;
  color: #1a1a2e;
  font-weight: 700;
}
.btn-dark {
  height: 44rpx;
  border-radius: 12rpx;
  background: #1a1a2e;
  display: flex; align-items: center; justify-content: center;
}
.btn-dark-txt {
  font-size: 18rpx;
  color: #FFB84A;
  font-weight: 700;
}

/* 最近使用 卡 */
.recent-card {
  background: #ffffff;
  border: 1rpx solid rgba(0,0,0,0.05);
  border-radius: 28rpx;
  padding: 22rpx;
  box-shadow: 0 4rpx 16rpx rgba(20,16,8,0.04);
}
.recent-card.mini { padding: 18rpx; }
.recent-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18rpx;
}
.recent-head-left {
  display: flex;
  align-items: center;
  gap: 8rpx;
}
.recent-head-title {
  font-size: 24rpx;
  font-weight: 700;
  color: #1a1a2e;
}
.recent-link {
  font-size: 20rpx;
  color: #9ca3af;
}
.recent-list {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}
.recent-item {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 12rpx 14rpx;
  border: 1rpx solid rgba(0,0,0,0.06);
  border-radius: 999rpx;
}
.recent-mini {
  width: 32rpx; height: 32rpx;
  border-radius: 50%;
  background: rgba(0,0,0,0.05);
  display: flex; align-items: center; justify-content: center;
}
.recent-text {
  font-size: 22rpx;
  color: #1a1a2e;
  font-weight: 500;
}

.mini-folder {
  margin: 0 auto !important;
  width: 56rpx; height: 56rpx;
}

/* 我的生成记录卡 */
.folder-card {
  background: #ffffff;
  border: 1rpx solid rgba(0,0,0,0.05);
  border-radius: 28rpx;
  padding: 28rpx 22rpx 22rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  box-shadow: 0 4rpx 16rpx rgba(20,16,8,0.04);
}
.folder-icon {
  width: 64rpx; height: 64rpx;
  border-radius: 50%;
  background: rgba(0,0,0,0.05);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 16rpx;
}
.folder-title {
  font-size: 28rpx;
  font-weight: 800;
  color: #1a1a2e;
  margin-bottom: 8rpx;
}
.folder-sub {
  font-size: 20rpx;
  color: #9ca3af;
  line-height: 1.5;
  margin-bottom: 14rpx;
}
.folder-arrow {
  width: 40rpx; height: 40rpx;
  display: flex; align-items: center; justify-content: center;
}
</style>
