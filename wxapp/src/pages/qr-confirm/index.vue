<template>
  <view class="page">
    <view :style="{ height: statusBarH + 'px' }" />

    <view class="logo-area">
      <view class="logo-icon">
        <text class="logo-letter">C</text>
      </view>
      <text class="logo-title">CaMeL API</text>
      <text class="logo-sub">网页版扫码登录</text>
    </view>

    <view class="card">
      <block v-if="state === 'ready'">
        <text class="title">确认在网页端登录</text>
        <text class="desc">点击下方按钮后，{{ siteLabel }} 将使用你的微信账号登录</text>
        <view class="btn-primary" @click="doConfirm">
          <text>确认登录</text>
        </view>
        <view class="btn-ghost" @click="cancel">
          <text>取消</text>
        </view>
      </block>

      <block v-else-if="state === 'submitting'">
        <u-loading-icon color="#4F6EF7" size="48" />
        <text class="title" style="margin-top: 32rpx;">正在确认...</text>
      </block>

      <block v-else-if="state === 'success'">
        <view class="icon-ok">
          <u-icon name="checkmark" size="56" color="#fff" />
        </view>
        <text class="title">登录成功</text>
        <text class="desc">请回到电脑浏览器继续操作，本页可关闭</text>
      </block>

      <block v-else-if="state === 'error'">
        <view class="icon-error">
          <u-icon name="close" size="48" color="#fff" />
        </view>
        <text class="title">{{ errorMsg || '登录失败' }}</text>
        <view class="btn-ghost" @click="cancel">
          <text>返回</text>
        </view>
      </block>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import env from '@/config/env.js'

const statusBarH = ref(0)
const ticket = ref('')
const state = ref('ready') // ready | submitting | success | error
const errorMsg = ref('')
const siteLabel = ref('网页端')

onLoad((options) => {
  statusBarH.value = uni.getSystemInfoSync().statusBarHeight
  // When opened from a scanned 小程序码, uni-app delivers the scene param.
  const sceneRaw = options?.scene ? decodeURIComponent(options.scene) : ''
  ticket.value = sceneRaw || options?.ticket || ''
  if (!ticket.value) {
    state.value = 'error'
    errorMsg.value = '未检测到登录凭证'
  }
})

function wxGetCode() {
  return new Promise((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success(res) {
        if (res.code) return resolve(res.code)
        reject(new Error(res.errMsg || '获取微信登录凭证失败'))
      },
      fail(err) {
        reject(new Error(err?.errMsg || '调用微信登录失败'))
      },
    })
  })
}

function postConfirm(code) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: env.basePath + '/api/oauth/wx_qr/confirm',
      method: 'POST',
      data: { ticket: ticket.value, code },
      header: { 'Content-Type': 'application/json' },
      success(res) {
        const body = res.data
        if (!body) return reject(new Error('响应为空'))
        if (body.success === false) {
          return reject(new Error(body.message || '登录失败'))
        }
        resolve()
      },
      fail() {
        reject(new Error('网络连接失败'))
      },
    })
  })
}

async function doConfirm() {
  if (state.value !== 'ready') return
  state.value = 'submitting'
  try {
    const code = await wxGetCode()
    await postConfirm(code)
    state.value = 'success'
  } catch (err) {
    state.value = 'error'
    errorMsg.value = err.message || '登录失败，请重试'
  }
}

function cancel() {
  uni.navigateBack({ delta: 1, fail: () => uni.reLaunch({ url: '/pages/home/index' }) })
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: linear-gradient(160deg, #eef1ff 0%, #f5f5f7 50%, #f0f4ff 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 48rpx 80rpx;
  box-sizing: border-box;
}

.logo-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 120rpx;
  margin-bottom: 56rpx;
}
.logo-icon {
  width: 104rpx;
  height: 104rpx;
  border-radius: 26rpx;
  background: linear-gradient(135deg, #4F6EF7, #6C8EFF);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 12rpx 32rpx rgba(79, 110, 247, 0.3);
  margin-bottom: 20rpx;
}
.logo-letter {
  font-size: 54rpx;
  font-weight: 700;
  color: #fff;
}
.logo-title {
  font-size: 40rpx;
  font-weight: 700;
  color: #1a1a2e;
}
.logo-sub {
  font-size: 24rpx;
  color: #6b7280;
  margin-top: 10rpx;
}

.card {
  width: 100%;
  background: #fff;
  border-radius: 24rpx;
  padding: 56rpx 40rpx 48rpx;
  box-shadow: 0 8rpx 40rpx rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  align-items: center;
}
.title {
  font-size: 34rpx;
  font-weight: 600;
  color: #1a1a2e;
  margin-bottom: 16rpx;
}
.desc {
  font-size: 26rpx;
  color: #6b7280;
  text-align: center;
  line-height: 40rpx;
  margin-bottom: 48rpx;
}

.btn-primary {
  width: 100%;
  height: 96rpx;
  background: linear-gradient(135deg, #4F6EF7, #6C8EFF);
  border-radius: 14rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 32rpx;
  font-weight: 600;
  box-shadow: 0 8rpx 24rpx rgba(79, 110, 247, 0.35);
  letter-spacing: 4rpx;
  margin-bottom: 24rpx;
}
.btn-ghost {
  width: 100%;
  height: 88rpx;
  border-radius: 14rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #4F6EF7;
  font-size: 28rpx;
  background: transparent;
}

.icon-ok {
  width: 120rpx;
  height: 120rpx;
  border-radius: 60rpx;
  background: #10b981;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 28rpx;
}
.icon-error {
  width: 120rpx;
  height: 120rpx;
  border-radius: 60rpx;
  background: #ef4444;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 28rpx;
}
</style>
