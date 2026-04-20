<template>
  <view class="page">
    <view :style="{ height: statusBarH + 'px' }" />

    <!-- Logo 区域 -->
    <view class="logo-area">
      <view class="logo-icon">
        <text class="logo-letter">C</text>
      </view>
      <text class="logo-title">CaMeL API</text>
      <text class="logo-sub">AI 接口管理平台</text>
    </view>

    <!-- 登录卡片 -->
    <view class="login-card">
      <text class="card-title">欢迎登录</text>
      <text class="card-desc">使用微信账号一键登录</text>

      <!-- 微信登录按钮 -->
      <view
        class="btn-wechat"
        :class="{ 'btn-loading': loading }"
        @click="doWechatLogin"
      >
        <u-icon
          v-if="!loading"
          name="weixin-fill"
          size="40"
          color="#fff"
          style="margin-right: 14rpx;"
        />
        <u-loading-icon v-else color="#fff" size="32" />
        <text style="margin-left: 12rpx;">
          {{ loading ? '登录中...' : '微信一键登录' }}
        </text>
      </view>
    </view>

    <text class="footer-tip">登录即表示您同意相关服务条款</text>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'
import request from '@/services/request.js'
import env from '@/config/env.js'

const statusBarH = ref(0)
const loading = ref(false)

onLoad(() => {
  statusBarH.value = uni.getSystemInfoSync().statusBarHeight
  if (userStore.isLoggedIn) {
    uni.reLaunch({ url: '/pages/home/index' })
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

function postLogin(code) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: env.basePath + '/api/oauth/wx_mini/login',
      method: 'POST',
      data: { code },
      header: { 'Content-Type': 'application/json' },
      success(res) {
        const body = res.data
        if (!body) return reject(new Error('响应为空'))
        if (body.success === false) {
          return reject(new Error(body.message || '登录失败'))
        }
        const rawCookie = res.header['Set-Cookie'] || res.header['set-cookie'] || ''
        const cookie = request.extractCookie(rawCookie)
        if (!cookie) return reject(new Error('未收到登录会话，请重试'))
        userStore.setToken(cookie)
        if (body.data) userStore.setUserInfo(body.data)
        resolve()
      },
      fail() {
        reject(new Error('网络连接失败'))
      },
    })
  })
}

async function doWechatLogin() {
  if (loading.value) return
  loading.value = true
  try {
    const code = await wxGetCode()
    await postLogin(code)
    uni.showToast({ title: '登录成功', icon: 'success', duration: 1000 })
    setTimeout(() => uni.reLaunch({ url: '/pages/home/index' }), 900)
  } catch (err) {
    uni.showToast({
      title: err.message || '登录失败，请重试',
      icon: 'none',
      duration: 2500,
    })
  } finally {
    loading.value = false
  }
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

/* Logo */
.logo-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 120rpx;
  margin-bottom: 72rpx;
}
.logo-icon {
  width: 120rpx;
  height: 120rpx;
  border-radius: 30rpx;
  background: linear-gradient(135deg, #4F6EF7, #6C8EFF);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 12rpx 32rpx rgba(79, 110, 247, 0.3);
  margin-bottom: 24rpx;
}
.logo-letter {
  font-size: 60rpx;
  font-weight: 700;
  color: #fff;
}
.logo-title {
  font-size: 46rpx;
  font-weight: 700;
  color: #1a1a2e;
  letter-spacing: 2rpx;
}
.logo-sub {
  font-size: 26rpx;
  color: #6b7280;
  margin-top: 12rpx;
}

/* 卡片 */
.login-card {
  width: 100%;
  background: #fff;
  border-radius: 24rpx;
  padding: 56rpx 40rpx 48rpx;
  box-shadow: 0 8rpx 40rpx rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  align-items: center;
}
.card-title {
  font-size: 36rpx;
  font-weight: 600;
  color: #1a1a2e;
  margin-bottom: 16rpx;
}
.card-desc {
  font-size: 26rpx;
  color: #6b7280;
  margin-bottom: 56rpx;
}

/* 微信登录按钮 */
.btn-wechat {
  width: 100%;
  height: 96rpx;
  background: linear-gradient(135deg, #09BB07, #07a405);
  border-radius: 14rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 32rpx;
  font-weight: 600;
  box-shadow: 0 8rpx 24rpx rgba(9, 187, 7, 0.35);
  letter-spacing: 2rpx;
}
.btn-loading {
  opacity: 0.8;
}

/* 底部提示 */
.footer-tip {
  font-size: 22rpx;
  color: #9ca3af;
  margin-top: 48rpx;
  text-align: center;
}
</style>
