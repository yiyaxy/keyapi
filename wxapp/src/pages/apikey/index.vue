<template>
  <view class="apikey-page">
    <u-navbar title="API Key" :auto-back="true" />

    <!-- Security notice -->
    <view class="notice-bar">
      <u-icon name="info-circle" size="32" color="#f59e0b" />
      <text class="notice-text">API Key 是您访问接口的凭证，请妥善保管，勿泄露给他人</text>
    </view>

    <view v-if="loading" class="loading-wrap">
      <u-loading-icon size="60" />
    </view>

    <view v-else-if="tokens.length === 0" class="empty-state">
      <u-empty mode="data" text="暂无 API Key" />
    </view>

    <view v-else class="tokens-list">
      <view
        v-for="token in tokens"
        :key="token.id"
        class="token-card"
      >
        <view class="token-header">
          <view class="token-name-row">
            <text class="token-name">{{ token.name || '未命名' }}</text>
            <view class="status-badge" :class="token.status === 1 ? 'active' : 'disabled'">
              <text>{{ token.status === 1 ? '正常' : '已禁用' }}</text>
            </view>
          </view>
          <text class="token-quota">
            余额: {{ token.unlimited_quota ? '无限制' : quotaToUSD(token.remain_quota || 0) }}
          </text>
        </view>

        <view class="token-key-row">
          <text class="token-key">{{ getDisplayKey(token) }}</text>
          <view class="key-actions">
            <view
              class="icon-btn"
              @click="toggleReveal(token)"
            >
              <u-icon
                :name="token._revealed ? 'eye-off' : 'eye'"
                size="36"
                color="#4F6EF7"
              />
            </view>
            <view
              class="icon-btn"
              @click="copyKey(token)"
            >
              <u-icon name="copy" size="36" color="#4F6EF7" />
            </view>
          </view>
        </view>

        <view v-if="token._loading" class="key-loading">
          <u-loading-icon size="30" />
          <text class="loading-text">获取中...</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'
import { getTokens, getTokenKey } from '@/services/api.js'
import env from '@/config/env.js'

const loading = ref(false)
const tokens = ref([])

function quotaToUSD(quota) {
  return '$' + (quota / env.quotaPerUnit).toFixed(2)
}

function getDisplayKey(token) {
  if (token._revealed && token._fullKey) {
    return token._fullKey
  }
  const k = token.key || ''
  if (k.length <= 8) return k
  return k.substring(0, 8) + '••••••••••••••••'
}

async function toggleReveal(token) {
  if (token._revealed) {
    token._revealed = false
    return
  }

  // Already fetched
  if (token._fullKey) {
    token._revealed = true
    return
  }

  token._loading = true
  try {
    const res = await getTokenKey(token.id)
    token._fullKey = res?.key || res
    token._revealed = true
  } catch (e) {
    // error shown by request.js
  } finally {
    token._loading = false
  }
}

function copyKey(token) {
  const key = token._fullKey || token.key
  if (!key) {
    uni.showToast({ title: '请先点击查看完整 Key', icon: 'none' })
    return
  }
  uni.setClipboardData({
    data: key,
    success() {
      uni.showToast({ title: '已复制', icon: 'none' })
    }
  })
}

async function loadTokens() {
  loading.value = true
  try {
    const list = await getTokens()
    tokens.value = (Array.isArray(list) ? list : []).map(t => ({
      ...t,
      _revealed: false,
      _fullKey: '',
      _loading: false,
    }))
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

onLoad(() => {
  if (!userStore.isLoggedIn) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  loadTokens()
})
</script>

<style lang="scss" scoped>
.apikey-page {
  min-height: 100vh;
  background: #f5f5f7;
}

.notice-bar {
  display: flex;
  align-items: flex-start;
  background: #fffbeb;
  border-bottom: 1rpx solid #fde68a;
  padding: 20rpx 32rpx;

  .notice-text {
    font-size: 24rpx;
    color: #92400e;
    margin-left: 12rpx;
    line-height: 1.5;
  }
}

.loading-wrap {
  display: flex;
  justify-content: center;
  padding-top: 120rpx;
}

.empty-state {
  padding-top: 120rpx;
}

.tokens-list {
  padding: 24rpx;

  .token-card {
    background: #fff;
    border-radius: 20rpx;
    padding: 32rpx;
    margin-bottom: 20rpx;
    box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.05);

    .token-header {
      margin-bottom: 20rpx;

      .token-name-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8rpx;

        .token-name {
          font-size: 30rpx;
          font-weight: 600;
          color: #1a1a2e;
        }

        .status-badge {
          padding: 4rpx 16rpx;
          border-radius: 20rpx;
          font-size: 20rpx;

          &.active {
            background: #d1fae5;
            color: #065f46;
          }

          &.disabled {
            background: #fee2e2;
            color: #991b1b;
          }
        }
      }

      .token-quota {
        font-size: 24rpx;
        color: #6b7280;
      }
    }

    .token-key-row {
      display: flex;
      align-items: center;
      background: #f8f9ff;
      border-radius: 12rpx;
      padding: 16rpx 20rpx;

      .token-key {
        flex: 1;
        font-size: 24rpx;
        color: #374151;
        font-family: 'Courier New', monospace;
        word-break: break-all;
      }

      .key-actions {
        display: flex;
        align-items: center;
        margin-left: 12rpx;

        .icon-btn {
          padding: 8rpx;
          margin-left: 8rpx;
        }
      }
    }

    .key-loading {
      display: flex;
      align-items: center;
      margin-top: 12rpx;

      .loading-text {
        font-size: 22rpx;
        color: #6b7280;
        margin-left: 10rpx;
      }
    }
  }
}
</style>
