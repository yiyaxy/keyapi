<template>
  <view class="usage-page">
    <u-navbar title="消费记录" :auto-back="true" />

    <!-- Stat header -->
    <view class="stat-header">
      <view class="stat-item">
        <text class="stat-value">{{ quotaToUSD(statToday) }}</text>
        <text class="stat-label">今日消费</text>
      </view>
      <view class="stat-divider" />
      <view class="stat-item">
        <text class="stat-value">{{ statTodayCount }}</text>
        <text class="stat-label">今日调用次数</text>
      </view>
    </view>

    <!-- Loading -->
    <view v-if="loading && records.length === 0" class="loading-wrap">
      <u-loading-icon size="60" />
    </view>

    <!-- Empty -->
    <view v-else-if="!loading && records.length === 0" class="empty-state">
      <u-empty mode="history" text="暂无消费记录" />
    </view>

    <!-- Records list -->
    <scroll-view
      v-else
      scroll-y
      style="flex: 1;"
      @scrolltolower="loadMore"
      :lower-threshold="100"
    >
      <view class="records-list">
        <view
          v-for="record in records"
          :key="record.id"
          class="record-card"
        >
          <view class="record-left">
            <text class="record-model">{{ formatModel(record.model_name) }}</text>
            <text class="record-time">{{ formatTime(record.created_at) }}</text>
          </view>
          <view class="record-right">
            <view class="status-dot" :class="record.code === 200 ? 'success' : 'error'" />
            <text class="record-cost">-{{ quotaToUSD(record.quota || 0) }}</text>
          </view>
        </view>
      </view>

      <!-- Load more -->
      <view class="load-more" v-if="loadingMore">
        <u-loading-icon size="40" />
        <text class="load-more-text">加载更多...</text>
      </view>
      <view class="no-more" v-if="noMore && records.length > 0">
        <text>— 已加载全部记录 —</text>
      </view>

      <view style="height: 40rpx;" />
    </scroll-view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'
import { getLogs, getLogStat } from '@/services/api.js'
import env from '@/config/env.js'

const loading = ref(false)
const loadingMore = ref(false)
const records = ref([])
const page = ref(1)
const noMore = ref(false)
const statToday = ref(0)
const statTodayCount = ref(0)

const PAGE_SIZE = 20

function quotaToUSD(quota) {
  return '$' + (quota / env.quotaPerUnit).toFixed(2)
}

function formatModel(name) {
  if (!name) return '未知模型'
  if (name.length > 24) return name.substring(0, 24) + '...'
  return name
}

function formatTime(ts) {
  if (!ts) return ''
  const now = Date.now()
  const t = ts * 1000
  const diff = now - t
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
  if (diff < 604800000) return Math.floor(diff / 86400000) + '天前'
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

async function loadStat() {
  try {
    const stat = await getLogStat()
    statToday.value = stat?.today?.quota || 0
    statTodayCount.value = stat?.today?.count || 0
  } catch (e) {}
}

async function loadRecords(isLoadMore = false) {
  if (noMore.value && isLoadMore) return

  if (isLoadMore) {
    loadingMore.value = true
  } else {
    loading.value = true
    page.value = 1
    noMore.value = false
  }

  try {
    const p = isLoadMore ? page.value : 1
    const list = await getLogs(p, PAGE_SIZE)
    const arr = Array.isArray(list) ? list : []

    if (isLoadMore) {
      records.value = [...records.value, ...arr]
    } else {
      records.value = arr
    }

    if (arr.length < PAGE_SIZE) {
      noMore.value = true
    }
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function loadMore() {
  if (loadingMore.value || noMore.value) return
  page.value += 1
  await loadRecords(true)
}

onLoad(() => {
  if (!userStore.isLoggedIn) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  loadStat()
  loadRecords()
})
</script>

<style lang="scss" scoped>
.usage-page {
  min-height: 100vh;
  background: #f5f5f7;
  display: flex;
  flex-direction: column;
}

.stat-header {
  display: flex;
  align-items: center;
  background: linear-gradient(135deg, #4F6EF7, #6C8EFF);
  padding: 32rpx 48rpx;
  box-shadow: 0 4rpx 20rpx rgba(79, 110, 247, 0.2);

  .stat-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;

    .stat-value {
      font-size: 36rpx;
      font-weight: 700;
      color: #fff;
      margin-bottom: 6rpx;
    }

    .stat-label {
      font-size: 22rpx;
      color: rgba(255, 255, 255, 0.75);
    }
  }

  .stat-divider {
    width: 1rpx;
    height: 60rpx;
    background: rgba(255, 255, 255, 0.3);
  }
}

.loading-wrap {
  display: flex;
  justify-content: center;
  padding-top: 120rpx;
}

.empty-state {
  padding-top: 80rpx;
}

.records-list {
  padding: 16rpx 24rpx 0;

  .record-card {
    background: #fff;
    border-radius: 16rpx;
    padding: 24rpx 28rpx;
    margin-bottom: 16rpx;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: 0 1rpx 8rpx rgba(0, 0, 0, 0.04);

    .record-left {
      flex: 1;
      margin-right: 20rpx;

      .record-model {
        display: block;
        font-size: 28rpx;
        font-weight: 500;
        color: #1a1a2e;
        margin-bottom: 8rpx;
      }

      .record-time {
        font-size: 22rpx;
        color: #9ca3af;
      }
    }

    .record-right {
      display: flex;
      align-items: center;

      .status-dot {
        width: 12rpx;
        height: 12rpx;
        border-radius: 50%;
        margin-right: 12rpx;

        &.success {
          background: #18A058;
        }

        &.error {
          background: #D03050;
        }
      }

      .record-cost {
        font-size: 28rpx;
        font-weight: 600;
        color: #D03050;
      }
    }
  }
}

.load-more {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24rpx;

  .load-more-text {
    font-size: 24rpx;
    color: #9ca3af;
    margin-left: 12rpx;
  }
}

.no-more {
  text-align: center;
  padding: 24rpx;
  font-size: 22rpx;
  color: #9ca3af;
}
</style>
