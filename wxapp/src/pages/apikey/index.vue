<template>
  <view class="page">
    <view :style="{ height: statusBarH + 'px' }" />
    <view class="header">
      <view class="back-btn" @click="goBack">
        <u-icon name="arrow-left" size="20" color="#1a1a2e" />
      </view>
      <text class="header-title">API Key</text>
      <view class="header-create" @click="openCreateDialog">
        <u-icon name="plus" size="17" color="#4F6EF7" />
      </view>
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
        <text class="empty-sub">创建一个 Key 后即可在 OpenAI 兼容客户端中使用</text>
        <view class="primary-btn empty-create" @click="openCreateDialog">
          <u-icon name="plus" size="16" color="#fff" />
          <text class="primary-btn-txt">新建 API Key</text>
        </view>
      </view>

      <!-- Token 列表 -->
      <view class="token-list" v-else>
        <view class="list-toolbar">
          <view class="list-summary">
            <text class="list-title">我的 API Key</text>
            <text class="list-count">共 {{ tokens.length }} 个，可继续创建多个 Key</text>
          </view>
          <view class="list-create-btn" @click="openCreateDialog">
            <u-icon name="plus" size="15" color="#fff" />
            <text class="list-create-txt">新建</text>
          </view>
        </view>

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
              创建：{{ formatDate(tokenCreatedAt(token)) }}
              <text v-if="userStore.wxPayEnabled && token.remain_quota >= 0">
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

    <view class="create-mask" v-if="createVisible" @click="closeCreateDialog">
      <view class="create-panel" @click.stop>
        <view class="create-head">
          <text class="create-title">新建 API Key</text>
          <view class="close-btn" @click="closeCreateDialog">
            <u-icon name="close" size="18" color="#6b7280" />
          </view>
        </view>

        <view class="field">
          <text class="field-label">名称</text>
          <input
            class="field-input"
            v-model="createForm.name"
            maxlength="50"
            placeholder="例如：小程序默认 Key"
            placeholder-class="input-placeholder"
          />
        </view>

        <view class="field">
          <text class="field-label">额度</text>
          <view class="segmented">
            <view class="seg-item" :class="{ 'seg-active': createForm.unlimited }" @click="createForm.unlimited = true">无限额度</view>
            <view class="seg-item" :class="{ 'seg-active': !createForm.unlimited }" @click="createForm.unlimited = false">限定额度</view>
          </view>
          <input
            v-if="!createForm.unlimited"
            class="field-input quota-input"
            type="number"
            v-model="createForm.quota"
            placeholder="请输入原始额度，例如 100000"
            placeholder-class="input-placeholder"
          />
        </view>

        <view class="field">
          <text class="field-label">有效期</text>
          <view class="expire-grid">
            <view class="expire-item" :class="{ 'expire-active': createForm.expireMode === 'never' }" @click="createForm.expireMode = 'never'">永不过期</view>
            <view class="expire-item" :class="{ 'expire-active': createForm.expireMode === '7d' }" @click="createForm.expireMode = '7d'">7 天</view>
            <view class="expire-item" :class="{ 'expire-active': createForm.expireMode === '30d' }" @click="createForm.expireMode = '30d'">30 天</view>
          </view>
        </view>

        <view class="create-actions">
          <view class="cancel-btn" @click="closeCreateDialog">取消</view>
          <view class="submit-btn" :class="{ 'submit-disabled': creating }" @click="submitCreate">
            <u-loading-icon v-if="creating" color="#fff" size="24" />
            <text>{{ creating ? '创建中...' : '创建 Key' }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'
import { createToken, getTokens, getTokenKey } from '@/services/api.js'
import { renderQuota } from '@/utils/quota.js'

const statusBarH = ref(0)
const loading = ref(false)
const creating = ref(false)
const createVisible = ref(false)
// token 列表，每条附加 _revealed / _fullKey / _revealing 字段
const tokens = ref([])

const createForm = reactive({
  name: '',
  unlimited: true,
  quota: '',
  expireMode: 'never',
})

const guides = [
  '将 API Key 设置在请求头：Authorization: Bearer sk-xxxxx',
  'API 请求地址请参考管理员提供的接入文档。',
  '如 Key 泄露请及时删除或重新创建。',
  '创建时可选择无限额度或设置单个 Key 的额度上限。',
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

function tokenCreatedAt(token) {
  return token.created_at || token.created_time || token.createdTime
}

function openCreateDialog() {
  createForm.name = `小程序 Key ${formatDate(Math.floor(Date.now() / 1000))}`
  createForm.unlimited = true
  createForm.quota = ''
  createForm.expireMode = 'never'
  createVisible.value = true
}

function closeCreateDialog() {
  if (creating.value) return
  createVisible.value = false
}

function resolveExpiredTime() {
  const now = Math.floor(Date.now() / 1000)
  if (createForm.expireMode === '7d') return now + 7 * 86400
  if (createForm.expireMode === '30d') return now + 30 * 86400
  return -1
}

async function submitCreate() {
  if (creating.value) return

  const name = createForm.name.trim()
  if (!name) {
    uni.showToast({ title: '请输入 Key 名称', icon: 'none' })
    return
  }

  const remainQuota = createForm.unlimited ? 0 : Number(createForm.quota)
  if (!createForm.unlimited && (!Number.isFinite(remainQuota) || remainQuota <= 0)) {
    uni.showToast({ title: '请输入有效额度', icon: 'none' })
    return
  }

  creating.value = true
  try {
    await createToken({
      name,
      unlimited_quota: createForm.unlimited,
      remain_quota: createForm.unlimited ? 0 : Math.floor(remainQuota),
      expired_time: resolveExpiredTime(),
    })
    uni.showToast({ title: '创建成功', icon: 'success' })
    createVisible.value = false
    await loadTokens()
  } finally {
    creating.value = false
  }
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
  if (!token._revealed || !token._fullKey) {
    uni.showToast({ title: '请先查看 Key 后复制', icon: 'none' })
    return
  }

  const key = 'sk-' + token._fullKey

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
.header-create {
  position: absolute;
  right: 24rpx;
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: #eef2ff;
  display: flex;
  align-items: center;
  justify-content: center;
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
.primary-btn {
  height: 76rpx;
  padding: 0 30rpx;
  border-radius: 16rpx;
  background: #4F6EF7;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
}
.primary-btn-txt { font-size: 26rpx; color: #fff; font-weight: 600; }
.empty-create { margin-top: 8rpx; }

/* Token 卡片 */
.list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18rpx;
}
.list-summary {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.list-title { font-size: 30rpx; font-weight: 700; color: #111827; }
.list-count { font-size: 23rpx; color: #8a94a6; }
.list-create-btn {
  height: 68rpx;
  padding: 0 24rpx;
  border-radius: 14rpx;
  background: #4F6EF7;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
}
.list-create-txt { font-size: 25rpx; color: #fff; font-weight: 600; }
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

/* 创建弹窗 */
.create-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 99;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: flex-end;
}
.create-panel {
  width: 100%;
  background: #fff;
  border-radius: 28rpx 28rpx 0 0;
  padding: 32rpx 28rpx calc(32rpx + env(safe-area-inset-bottom));
}
.create-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 28rpx;
}
.create-title { font-size: 34rpx; font-weight: 700; color: #111827; }
.close-btn {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  background: #f3f4f6;
  display: flex;
  align-items: center;
  justify-content: center;
}
.field { margin-bottom: 28rpx; }
.field-label {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: #374151;
  margin-bottom: 14rpx;
}
.field-input {
  height: 84rpx;
  border-radius: 14rpx;
  background: #f8fafc;
  padding: 0 22rpx;
  font-size: 28rpx;
  color: #111827;
  border: 1rpx solid #e5e7eb;
}
.input-placeholder { color: #a1a1aa; }
.segmented {
  display: flex;
  padding: 6rpx;
  background: #f3f4f6;
  border-radius: 16rpx;
}
.seg-item {
  flex: 1;
  height: 72rpx;
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
  color: #6b7280;
}
.seg-active {
  background: #fff;
  color: #4F6EF7;
  font-weight: 700;
  box-shadow: 0 2rpx 8rpx rgba(79, 110, 247, 0.18);
}
.quota-input { margin-top: 16rpx; }
.expire-grid { display: flex; gap: 14rpx; }
.expire-item {
  flex: 1;
  height: 72rpx;
  border-radius: 14rpx;
  background: #f8fafc;
  border: 1rpx solid #e5e7eb;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 25rpx;
  color: #4b5563;
}
.expire-active {
  border-color: #4F6EF7;
  background: #eef2ff;
  color: #4F6EF7;
  font-weight: 700;
}
.create-actions {
  display: flex;
  gap: 18rpx;
  margin-top: 34rpx;
}
.cancel-btn,
.submit-btn {
  flex: 1;
  height: 84rpx;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  font-weight: 700;
}
.cancel-btn { background: #f3f4f6; color: #4b5563; }
.submit-btn { background: #4F6EF7; color: #fff; gap: 10rpx; }
.submit-disabled { opacity: 0.65; }
</style>
