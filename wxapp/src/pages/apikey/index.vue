<template>
  <view class="page">
    <view :style="{ height: statusBarH + 'px' }" />
    <view class="header">
      <view class="back-btn" @click="goBack">
        <u-icon name="arrow-left" size="20" color="#1a1a2e" />
      </view>
      <text class="header-title">API Key</text>
    </view>

    <view class="content">
      <!-- 安全提醒 -->
      <view class="warn-card">
        <u-icon name="warning" size="18" color="#f59e0b" />
        <text class="warn-txt">API Key 是您访问服务的凭证，请妥善保管，不要泄露给他人</text>
      </view>

      <!-- 加载中 -->
      <view class="loading-wrap" v-if="loading">
        <u-loading-icon size="60" color="#4F6EF7" />
        <text class="loading-txt">加载中...</text>
      </view>

      <!-- 空状态 -->
      <view class="empty-wrap" v-else-if="tokens.length === 0">
        <u-icon name="file-text" size="50" color="#9ca3af" />
        <text class="empty-txt">暂无 API Key</text>
        <text class="empty-sub">请联系管理员创建 Token</text>
      </view>

      <!-- Token 列表 -->
      <view class="token-list" v-else>
        <view
          class="token-card"
          v-for="token in tokens"
          :key="token.id"
        >
          <view class="token-header">
            <view class="token-name-row">
              <text class="token-name">{{ token.name || '未命名 Key' }}</text>
              <view class="status-badge" :class="token.status === 1 ? 'badge-ok' : 'badge-err'">
                <text>{{ token.status === 1 ? '启用' : '禁用' }}</text>
              </view>
            </view>
            <text class="token-meta">
              创建：{{ formatDate(token.created_at) }}
              <text v-if="token.remain_quota >= 0">
                · 剩余：{{ q2cny(token.remain_quota) }}
              </text>
            </text>
          </view>

          <!-- Key 展示区 -->
          <view class="key-wrap">
            <text class="key-text" :class="{ 'key-masked': !token._revealed }">
              {{ token._revealed ? ('sk-' + token._fullKey) : maskKey(token.key) }}
            </text>
          </view>

          <!-- 操作按钮 -->
          <view class="token-actions">
            <view
              class="action-btn"
              @click="toggleReveal(token)"
              :class="{ 'btn-loading': token._revealing }"
            >
              <u-loading-icon v-if="token._revealing" color="#4F6EF7" size="24" />
              <u-icon v-else-if="token._revealed" name="eye-off" size="15" color="#4F6EF7" />
              <u-icon v-else name="eye" size="15" color="#4F6EF7" />
              <text class="action-txt">{{ token._revealed ? '隐藏' : '查看' }}</text>
            </view>

            <view class="action-btn" @click="copyKey(token)">
              <u-icon name="copy" size="15" color="#18A058" />
              <text class="action-txt copy-green">复制 Key</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 使用说明 -->
      <view class="guide-card" v-if="tokens.length > 0">
        <text class="guide-title">使用说明</text>
        <view class="guide-item" v-for="(g, i) in guides" :key="i">
          <text class="guide-dot">·</text>
          <text class="guide-txt">{{ g }}</text>
        </view>
      </view>

      <view style="height:48rpx;" />
    </view>
  </view>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'
import { getTokens, getTokenKey } from '@/services/api.js'
import { renderQuota } from '@/utils/quota.js'

const statusBarH = ref(0)
const loading = ref(false)
// token 列表，每条附加 _revealed / _fullKey / _revealing 字段
const tokens = ref([])

const guides = [
  '将 API Key 设置在请求头：Authorization: Bearer sk-xxxxx',
  'API 请求地址请参考管理员提供的接入文档。',
  '如 Key 泄露请联系管理员禁用并重新创建。',
  '每个 Key 可设置额度限制，超出后将停止服务。',
]

function q2cny(quota) {
  const n = Number(quota) || 0
  if (n < 0) return '无限'
  return renderQuota(quota)
}

function maskKey(key) {
  if (!key) return 'sk-••••••••••••••••'
  // 后端返回的 key 已经是掩码，直接加 sk- 前缀
  return 'sk-' + key
}

function formatDate(ts) {
  if (!ts) return '--'
  const d = new Date(ts * 1000)
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

async function toggleReveal(token) {
  // 已展示 → 隐藏
  if (token._revealed) {
    token._revealed = false
    token._fullKey = ''
    return
  }
  // 已有完整 key 直接展示
  if (token._fullKey) {
    token._revealed = true
    return
  }
  // 请求完整 key
  token._revealing = true
  try {
    const data = await getTokenKey(token.id)
    // 接口返回 {key: "完整key字符串"}
    token._fullKey = data?.key || ''
    token._revealed = true
  } catch {
    // 已 toast
  } finally {
    token._revealing = false
  }
}

function copyKey(token) {
  const key = token._revealed
    ? 'sk-' + token._fullKey
    : ('sk-' + token.key)

  if (!key || key === 'sk-') return uni.showToast({ title: '请先查看 Key', icon: 'none' })

  uni.setClipboardData({
    data: key,
    success: () => uni.showToast({ title: 'Key 已复制', icon: 'none' }),
  })
}

async function loadTokens() {
  loading.value = true
  try {
    // 接口返回 {page, page_size, total, items: [...]}
    const data = await getTokens(1, 50)
    const items = data?.items || []
    tokens.value = items.map(t => ({
      ...t,
      _revealed: false,
      _fullKey: '',
      _revealing: false,
    }))
  } catch {
    // 已 toast
  } finally {
    loading.value = false
  }
}

function goBack() {
  uni.navigateBack({ delta: 1, fail: () => uni.switchTab({ url: '/pages/profile/index' }) })
}

onLoad(() => {
  statusBarH.value = uni.getSystemInfoSync().statusBarHeight
  if (!userStore.isLoggedIn) {
    uni.navigateTo({ url: '/pages/login/index' })
    return
  }
  loadTokens()
})
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: #f5f5f7; }

.header {
  height: 88rpx;
  background: #fff;
  display: flex;
  align-items: center;
  padding: 0 24rpx;
  position: relative;
  box-shadow: 0 1rpx 0 #f0f0f0;
}
.back-btn {
  width: 72rpx; height: 72rpx;
  display: flex; align-items: center; justify-content: center;
}
.header-title {
  position: absolute;
  left: 50%; transform: translateX(-50%);
  font-size: 32rpx; font-weight: 600; color: #1a1a2e;
}

.content { padding: 24rpx; }

/* 安全提醒 */
.warn-card {
  display: flex; align-items: flex-start;
  background: #fffbeb; border-radius: 16rpx; padding: 24rpx;
  border: 1rpx solid #fde68a; margin-bottom: 24rpx;
}
.warn-txt { font-size: 24rpx; color: #92400e; line-height: 1.6; margin-left: 12rpx; flex: 1; }

/* 加载 / 空状态 */
.loading-wrap, .empty-wrap {
  display: flex; flex-direction: column; align-items: center;
  padding: 80rpx 0; gap: 20rpx;
}
.loading-txt, .empty-txt { font-size: 28rpx; color: #6b7280; }
.empty-sub { font-size: 24rpx; color: #9ca3af; }

/* Token 卡片 */
.token-card {
  background: #fff; border-radius: 20rpx; padding: 32rpx;
  box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.06);
  margin-bottom: 20rpx;
}
.token-header { margin-bottom: 20rpx; }
.token-name-row { display: flex; align-items: center; margin-bottom: 10rpx; }
.token-name { font-size: 30rpx; font-weight: 600; color: #1a1a2e; flex: 1; }
.status-badge {
  font-size: 22rpx; padding: 4rpx 14rpx; border-radius: 20rpx;
}
.badge-ok { background: #e8faf0; color: #18A058; }
.badge-err { background: #fff0f0; color: #D03050; }
.token-meta { font-size: 22rpx; color: #9ca3af; }

/* Key 展示 */
.key-wrap {
  background: #f8f9ff; border-radius: 12rpx;
  padding: 20rpx 24rpx; margin-bottom: 20rpx;
}
.key-text {
  font-size: 26rpx; color: #1a1a2e;
  word-break: break-all; line-height: 1.5;
  font-family: 'Courier New', monospace;
}
.key-masked { color: #9ca3af; letter-spacing: 4rpx; }

/* 操作按钮 */
.token-actions { display: flex; gap: 20rpx; }
.action-btn {
  flex: 1; height: 72rpx;
  background: #f5f5f7; border-radius: 12rpx;
  display: flex; align-items: center; justify-content: center; gap: 8rpx;
}
.action-txt { font-size: 26rpx; color: #4F6EF7; }
.copy-green { color: #18A058; }
.btn-loading { opacity: 0.7; }

/* 使用说明 */
.guide-card {
  background: #fff; border-radius: 20rpx; padding: 32rpx;
  box-shadow: 0 2rpx 10rpx rgba(0,0,0,0.05);
  margin-top: 4rpx;
}
.guide-title { display: block; font-size: 28rpx; font-weight: 600; color: #1a1a2e; margin-bottom: 20rpx; }
.guide-item { display: flex; margin-bottom: 16rpx; }
.guide-dot { font-size: 28rpx; color: #4F6EF7; margin-right: 12rpx; }
.guide-txt { font-size: 26rpx; color: #4b5563; line-height: 1.6; flex: 1; }
</style>
