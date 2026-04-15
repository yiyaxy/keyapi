<template>
  <view class="page">
    <u-navbar title="消费记录" :auto-back="true" bgColor="#fff" :placeholder="true" />

    <view class="content">
      <!-- 统计头部 -->
      <view class="stat-card">
        <view class="stat-item">
          <text class="stat-val">{{ q2cny(todayQuota) }}</text>
          <text class="stat-label">今日消费</text>
        </view>
        <view class="stat-div" />
        <view class="stat-item">
          <text class="stat-val">{{ monthCount }}</text>
          <text class="stat-label">本月请求</text>
        </view>
        <view class="stat-div" />
        <view class="stat-item">
          <text class="stat-val">{{ q2cny(monthQuota) }}</text>
          <text class="stat-label">本月消费</text>
        </view>
      </view>

      <!-- 加载中骨架 -->
      <template v-if="firstLoading">
        <view class="skeleton-row" v-for="i in 5" :key="i" />
      </template>

      <!-- 空状态 -->
      <view class="empty-wrap" v-else-if="!firstLoading && logs.length === 0">
        <u-icon name="file-text" size="100" color="#9ca3af" />
        <text class="empty-txt">暂无消费记录</text>
      </view>

      <!-- 记录列表 -->
      <view class="log-list" v-else>
        <view class="log-item" v-for="log in logs" :key="log.id">
          <view class="log-left">
            <view class="model-row">
              <text class="model-name">{{ log.model_name || '未知模型' }}</text>
              <view class="status-dot" :class="log.quota > 0 ? 'dot-ok' : 'dot-grey'" />
            </view>
            <text class="log-time">{{ formatRelTime(log.created_at) }}</text>
            <text class="log-tokens" v-if="log.prompt_tokens || log.completion_tokens">
              {{ log.prompt_tokens || 0 }} + {{ log.completion_tokens || 0 }} tokens
            </text>
          </view>
          <view class="log-right">
            <text class="log-cost">{{ q2cny(log.quota) }}</text>
            <text class="log-token-name" v-if="log.token_name">{{ log.token_name }}</text>
          </view>
        </view>

        <!-- 加载更多 -->
        <view class="load-more" v-if="hasMore" @click="loadMore">
          <u-loading-icon v-if="loadingMore" color="#4F6EF7" size="36" />
          <text v-else class="more-txt">加载更多</text>
        </view>
        <view class="no-more" v-else-if="logs.length > 0">
          <text class="no-more-txt">— 已显示全部记录 —</text>
        </view>
      </view>

      <view style="height:48rpx;" />
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'
import { getLogs, getTodayStat, getMonthStat } from '@/services/api.js'
import { renderQuota } from '@/utils/quota.js'

const PAGE_SIZE = 20

const firstLoading = ref(true)
const loadingMore = ref(false)
const logs = ref([])
const page = ref(1)
const total = ref(0)
const hasMore = ref(false)

const todayQuota = ref(0)
const monthQuota = ref(0)
const monthCount = ref(0)

function q2cny(quota) { return renderQuota(quota) }

/**
 * 相对时间格式化
 * 输入：Unix 时间戳（秒）
 */
function formatRelTime(ts) {
  if (!ts) return '--'
  const now = Date.now() / 1000
  const diff = Math.floor(now - ts)
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`
  const d = new Date(ts * 1000)
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

async function loadStats() {
  const [todayRes, monthRes] = await Promise.allSettled([
    getTodayStat(),
    getMonthStat(),
  ])
  if (todayRes.status === 'fulfilled') {
    todayQuota.value = todayRes.value?.quota || 0
  }
  if (monthRes.status === 'fulfilled') {
    monthQuota.value = monthRes.value?.quota || 0
    monthCount.value = monthRes.value?.token || 0  // token 字段实际是请求次数
  }
}

async function loadLogs(p = 1, append = false) {
  if (append) loadingMore.value = true
  try {
    // 接口路径：/api/log/self/  参数：p, page_size, type=2
    const data = await getLogs(p, PAGE_SIZE)
    const items = data?.items || []
    const tot = data?.total || 0

    if (append) {
      logs.value = [...logs.value, ...items]
    } else {
      logs.value = items
    }

    total.value = tot
    page.value = p
    hasMore.value = logs.value.length < tot
  } catch {
    // 已 toast
  } finally {
    firstLoading.value = false
    loadingMore.value = false
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  await loadLogs(page.value + 1, true)
}

onLoad(async () => {
  if (!userStore.isLoggedIn) {
    uni.redirectTo({ url: '/pages/login/index' })
    return
  }
  // 并发加载统计和日志列表
  await Promise.allSettled([loadStats(), loadLogs(1, false)])
})
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: #f5f5f7; }
.content { padding: 24rpx; }

/* 统计卡片 */
.stat-card {
  display: flex; align-items: center;
  background: linear-gradient(135deg, #4F6EF7, #7B9BFF);
  border-radius: 20rpx; padding: 32rpx 0;
  box-shadow: 0 8rpx 28rpx rgba(79,110,247,0.25);
  margin-bottom: 24rpx;
}
.stat-item { flex: 1; display: flex; flex-direction: column; align-items: center; }
.stat-val { font-size: 30rpx; font-weight: 600; color: #fff; margin-bottom: 8rpx; }
.stat-label { font-size: 22rpx; color: rgba(255,255,255,0.78); }
.stat-div { width: 1rpx; height: 48rpx; background: rgba(255,255,255,0.3); }

/* 骨架 */
.skeleton-row {
  height: 120rpx;
  background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  border-radius: 16rpx; margin-bottom: 16rpx;
  animation: shimmer 1.4s infinite;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* 空状态 */
.empty-wrap {
  display: flex; flex-direction: column; align-items: center;
  padding: 80rpx 0; gap: 20rpx;
}
.empty-txt { font-size: 28rpx; color: #6b7280; }

/* 日志列表 */
.log-list { }
.log-item {
  display: flex; align-items: flex-start; justify-content: space-between;
  background: #fff; border-radius: 16rpx; padding: 28rpx;
  margin-bottom: 16rpx;
  box-shadow: 0 2rpx 8rpx rgba(0,0,0,0.05);
}
.log-left { flex: 1; margin-right: 20rpx; }
.model-row { display: flex; align-items: center; margin-bottom: 8rpx; }
.model-name {
  font-size: 28rpx; font-weight: 600; color: #1a1a2e;
  max-width: 380rpx;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.status-dot {
  width: 12rpx; height: 12rpx; border-radius: 50%; margin-left: 12rpx; flex-shrink: 0;
}
.dot-ok { background: #18A058; }
.dot-grey { background: #9ca3af; }
.log-time { display: block; font-size: 22rpx; color: #9ca3af; margin-bottom: 6rpx; }
.log-tokens { display: block; font-size: 22rpx; color: #9ca3af; }

.log-right { text-align: right; flex-shrink: 0; }
.log-cost { display: block; font-size: 28rpx; font-weight: 600; color: #1a1a2e; margin-bottom: 6rpx; }
.log-token-name {
  display: block; font-size: 20rpx; color: #9ca3af;
  max-width: 160rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 加载更多 */
.load-more {
  height: 80rpx; display: flex; align-items: center; justify-content: center;
  background: #fff; border-radius: 14rpx; margin-top: 8rpx;
}
.more-txt { font-size: 26rpx; color: #4F6EF7; }
.no-more {
  height: 60rpx; display: flex; align-items: center; justify-content: center;
}
.no-more-txt { font-size: 24rpx; color: #9ca3af; }
</style>
