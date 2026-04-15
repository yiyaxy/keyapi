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
      <text class="card-title">账号登录</text>

      <!-- 用户名 -->
      <view class="field">
        <view class="field-label">
          <u-icon name="account" size="34" color="#4F6EF7" />
          <text class="label-text">用户名</text>
        </view>
        <input
          class="field-input"
          v-model="username"
          placeholder="请输入用户名"
          placeholder-class="ph"
          :disabled="loading"
          confirm-type="next"
        />
      </view>

      <view class="divider" />

      <!-- 密码 -->
      <view class="field">
        <view class="field-label">
          <u-icon name="lock" size="34" color="#4F6EF7" />
          <text class="label-text">密码</text>
        </view>
        <input
          class="field-input"
          v-model="password"
          placeholder="请输入密码"
          placeholder-class="ph"
          password
          :disabled="loading"
          confirm-type="done"
          @confirm="doLogin"
        />
      </view>

      <!-- 登录按钮 -->
      <view
        class="btn-login"
        :class="{ 'btn-loading': loading }"
        @click="doLogin"
      >
        <text v-if="!loading">登 录</text>
        <view v-else class="btn-spin">
          <u-loading-icon color="#fff" size="32" />
          <text style="margin-left: 12rpx;">登录中...</text>
        </view>
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
const username = ref('')
const password = ref('')

onLoad(() => {
  statusBarH.value = uni.getSystemInfoSync().statusBarHeight
  if (userStore.isLoggedIn) {
    uni.reLaunch({ url: '/pages/home/index' })
  }
})

async function doLogin() {
  const u = username.value.trim()
  const p = password.value.trim()
  if (!u) return uni.showToast({ title: '请输入用户名', icon: 'none' })
  if (!p) return uni.showToast({ title: '请输入密码', icon: 'none' })

  loading.value = true
  try {
    await new Promise((resolve, reject) => {
      uni.request({
        url: env.basePath + '/api/user/login',
        method: 'POST',
        data: { username: u, password: p },
        header: { 'Content-Type': 'application/json' },
        success(res) {
          const body = res.data
          if (!body) return reject(new Error('响应为空'))

          if (body.success === false) {
            return reject(new Error(body.message || '用户名或密码错误'))
          }

          // 提取 Set-Cookie（微信小程序需要手动处理）
          const rawCookie =
            res.header['Set-Cookie'] ||
            res.header['set-cookie'] ||
            ''
          const cookie = request.extractCookie(rawCookie)
          userStore.setToken(cookie)

          // 缓存基本用户信息
          if (body.data) userStore.setUserInfo(body.data)

          resolve()
        },
        fail(err) {
          reject(new Error('网络连接失败'))
        },
      })
    })

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
  margin-top: 100rpx;
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
  padding: 48rpx 40rpx;
  box-shadow: 0 8rpx 40rpx rgba(0, 0, 0, 0.08);
}
.card-title {
  font-size: 34rpx;
  font-weight: 600;
  color: #1a1a2e;
  display: block;
  margin-bottom: 40rpx;
}

/* 字段 */
.field {
  margin-bottom: 8rpx;
}
.field-label {
  display: flex;
  align-items: center;
  margin-bottom: 14rpx;
}
.label-text {
  font-size: 26rpx;
  color: #6b7280;
  margin-left: 10rpx;
}
.field-input {
  width: 100%;
  height: 88rpx;
  background: #f8f9ff;
  border-radius: 12rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
  color: #1a1a2e;
  box-sizing: border-box;
}
.ph {
  color: #9ca3af;
}
.divider {
  height: 1rpx;
  background: #f0f0f0;
  margin: 20rpx 0 28rpx;
}

/* 登录按钮 */
.btn-login {
  margin-top: 48rpx;
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
}
.btn-loading {
  opacity: 0.8;
}
.btn-spin {
  display: flex;
  align-items: center;
  font-size: 28rpx;
  color: #fff;
}

/* 底部提示 */
.footer-tip {
  font-size: 22rpx;
  color: #9ca3af;
  margin-top: 48rpx;
  text-align: center;
}
</style>
