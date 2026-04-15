<template>
  <view class="login-page">
    <!-- Status bar placeholder -->
    <view :style="{ height: statusBarHeight + 'px' }" />

    <!-- Logo area -->
    <view class="logo-area">
      <view class="logo-icon">
        <text class="logo-letter">C</text>
      </view>
      <text class="logo-title">CaMeL API</text>
      <text class="logo-subtitle">AI 接口管理平台</text>
    </view>

    <!-- Login card -->
    <view class="login-card">
      <text class="card-title">账号登录</text>

      <view class="input-group">
        <view class="input-label">
          <u-icon name="account" size="36" color="#4F6EF7" />
          <text class="label-text">用户名</text>
        </view>
        <u-input
          v-model="form.username"
          placeholder="请输入用户名"
          :border="'none'"
          :custom-style="inputStyle"
          :disabled="loading"
          @confirm="doLogin"
        />
      </view>

      <view class="divider" />

      <view class="input-group">
        <view class="input-label">
          <u-icon name="lock" size="36" color="#4F6EF7" />
          <text class="label-text">密码</text>
        </view>
        <u-input
          v-model="form.password"
          placeholder="请输入密码"
          type="password"
          :border="'none'"
          :custom-style="inputStyle"
          :disabled="loading"
          @confirm="doLogin"
        />
      </view>

      <u-button
        type="primary"
        :loading="loading"
        :disabled="loading"
        :custom-style="btnStyle"
        @click="doLogin"
      >
        {{ loading ? '登录中...' : '登录' }}
      </u-button>
    </view>

    <!-- Footer -->
    <view class="footer">
      <text class="footer-text">登录即表示您同意相关服务条款</text>
    </view>
  </view>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'
import request from '@/services/request.js'
import env from '@/config/env.js'

const statusBarHeight = ref(0)
const loading = ref(false)

const form = reactive({
  username: '',
  password: '',
})

const inputStyle = {
  backgroundColor: '#f8f9ff',
  borderRadius: '12rpx',
  padding: '0 24rpx',
  fontSize: '28rpx',
}

const btnStyle = {
  background: 'linear-gradient(135deg, #4F6EF7, #6C8EFF)',
  borderRadius: '14rpx',
  height: '96rpx',
  fontSize: '32rpx',
  fontWeight: '600',
  border: 'none',
  marginTop: '48rpx',
  boxShadow: '0 8rpx 24rpx rgba(79, 110, 247, 0.35)',
}

onLoad(() => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight
  // If already logged in, go home
  if (userStore.isLoggedIn) {
    uni.reLaunch({ url: '/pages/home/index' })
  }
})

async function doLogin() {
  if (!form.username.trim()) {
    uni.showToast({ title: '请输入用户名', icon: 'none' })
    return
  }
  if (!form.password.trim()) {
    uni.showToast({ title: '请输入密码', icon: 'none' })
    return
  }

  loading.value = true

  try {
    const result = await new Promise((resolve, reject) => {
      uni.request({
        url: env.basePath + '/api/user/login',
        method: 'POST',
        data: { username: form.username, password: form.password },
        header: { 'Content-Type': 'application/json' },
        success(res) {
          if (res.data && res.data.success) {
            // Extract Set-Cookie header (name=value part only)
            const rawCookie =
              res.header['Set-Cookie'] ||
              res.header['set-cookie'] ||
              ''
            const sessionCookie = request.extractCookie(rawCookie)
            resolve({ data: res.data.data, cookie: sessionCookie })
          } else {
            reject(new Error(res.data?.message || '用户名或密码错误'))
          }
        },
        fail() {
          reject(new Error('网络连接失败'))
        },
      })
    })

    userStore.setToken(result.cookie)
    userStore.setUserInfo(result.data)

    uni.showToast({ title: '登录成功', icon: 'success', duration: 1000 })

    setTimeout(() => {
      uni.reLaunch({ url: '/pages/home/index' })
    }, 800)
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
.login-page {
  min-height: 100vh;
  background: linear-gradient(160deg, #eef1ff 0%, #f5f5f7 50%, #f0f4ff 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 48rpx;
}

.logo-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 100rpx;
  margin-bottom: 80rpx;

  .logo-icon {
    width: 120rpx;
    height: 120rpx;
    border-radius: 30rpx;
    background: linear-gradient(135deg, #4F6EF7, #6C8EFF);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 12rpx 32rpx rgba(79, 110, 247, 0.35);
    margin-bottom: 24rpx;
  }

  .logo-letter {
    font-size: 64rpx;
    font-weight: 700;
    color: #fff;
  }

  .logo-title {
    font-size: 48rpx;
    font-weight: 700;
    color: #1a1a2e;
    letter-spacing: 2rpx;
  }

  .logo-subtitle {
    font-size: 26rpx;
    color: #6b7280;
    margin-top: 12rpx;
    letter-spacing: 1rpx;
  }
}

.login-card {
  width: 100%;
  background: #fff;
  border-radius: 24rpx;
  padding: 48rpx 40rpx;
  box-shadow: 0 8rpx 40rpx rgba(0, 0, 0, 0.08);

  .card-title {
    font-size: 36rpx;
    font-weight: 600;
    color: #1a1a2e;
    margin-bottom: 40rpx;
    display: block;
  }

  .input-group {
    margin-bottom: 8rpx;

    .input-label {
      display: flex;
      align-items: center;
      margin-bottom: 12rpx;

      .label-text {
        font-size: 26rpx;
        color: #6b7280;
        margin-left: 10rpx;
      }
    }
  }

  .divider {
    height: 1rpx;
    background: #f0f0f0;
    margin: 16rpx 0 24rpx;
  }
}

.footer {
  margin-top: 48rpx;

  .footer-text {
    font-size: 22rpx;
    color: #9ca3af;
    text-align: center;
  }
}
</style>
