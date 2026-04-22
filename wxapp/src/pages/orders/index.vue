<template>
  <view class="page">
    <view :style="{ height: statusBarH + 'px' }" />

    <!-- 标题栏 -->
    <view class="header">
      <view class="back-btn" @click="goBack">
        <u-icon name="arrow-left" size="40" color="#1a1a2e" />
      </view>
      <text class="header-title">订单中心</text>
    </view>

    <!-- 筛选 Tab -->
    <view class="tab-bar">
      <view
        v-for="tab in TABS"
        :key="tab.value"
        class="tab-item"
        :class="{ 'tab-active': activeTab === tab.value }"
        @click="switchTab(tab.value)"
      >
        <text class="tab-text">{{ tab.label }}</text>
      </view>
    </view>

    <!-- 骨架屏 -->
    <template v-if="firstLoading">
      <view class="skeleton-row" v-for="i in 5" :key="i" />
    </template>

    <!-- 空状态 -->
    <view class="empty-wrap" v-else-if="!firstLoading && orders.length === 0">
      <u-icon name="order" size="100" color="#9ca3af" />
      <text class="empty-txt">暂无订单记录</text>
    </view>

    <!-- 订单列表 -->
    <scroll-view
      v-else
      scroll-y
      class="list-scroll"
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onPullDown"
    >
      <view class="order-list">
        <view
          class="order-card"
          v-for="order in orders"
          :key="order.id"
          @click="viewDetail(order)"
        >
          <view class="card-top">
            <view class="order-type-badge" :class="'badge-' + order.order_type">
              <text>{{ orderTypeLabel(order.order_type) }}</text>
            </view>
            <view class="status-chip" :class="'chip-' + order.status">
              <text>{{ statusLabel(order.status) }}</text>
            </view>
          </view>

          <view class="card-mid">
            <text class="amount">¥{{ fmtAmount(order.amount) }}</text>
            <text class="currency">{{ order.currency || 'CNY' }}</text>
          </view>

          <view class="card-bot">
            <text class="order-no">{{ order.out_trade_no }}</text>
            <text class="order-time">{{ fmtTime(order.created_at) }}</text>
          </view>

          <view class="paid-row" v-if="order.paid_at">
            <text class="paid-label">支付时间</text>
            <text class="paid-time">{{ fmtTime(order.paid_at) }}</text>
          </view>
        </view>

        <!-- 加载更多 -->
        <view class="load-more" v-if="hasMore" @click="loadMore">
          <u-loading-icon v-if="loadingMore" color="#4F6EF7" size="36" />
          <text v-else class="more-txt">加载更多</text>
        </view>
        <view class="no-more" v-else-if="orders.length > 0">
          <text class="no-more-txt">— 已显示全部订单 —</text>
        </view>
      </view>

      <view style="height:48rpx;" />
    </scroll-view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'
import { getMyOrders } from '@/services/api.js'

const PAGE_SIZE = 20

const TABS = [
  { label: '全部', value: '' },
  { label: '充值', value: 'topup' },
  { label: '订阅', value: 'sub' },
]

const statusBarH = ref(0)
const activeTab = ref('')
const firstLoading = ref(true)
const refreshing = ref(false)
const loadingMore = ref(false)
const orders = ref([])
const page = ref(1)
const total = ref(0)
const hasMore = ref(false)

function orderTypeLabel(t) {
  if (t === 'topup') return '充值'
  if (t === 'sub') return '订阅'
  return t || '未知'
}

function statusLabel(s) {
  const map = {
    pending: '待支付',
    paid: '已支付',
    partial_refunded: '部分退款',
    fully_refunded: '全额退款',
    closed: '已关闭',
    expired: '已过期',
  }
  return map[s] || s
}

function fmtAmount(fen) {
  if (fen == null) return '0.00'
  return (fen / 100).toFixed(2)
}

function fmtTime(ts) {
  if (!ts) return '--'
  const d = new Date(ts * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function goBack() {
  uni.navigateBack({
    delta: 1,
    fail: () => uni.reLaunch({ url: '/pages/home/index' }),
  })
}

function viewDetail(order) {
  uni.showModal({
    title: '订单详情',
    content: [
      `订单号：${order.out_trade_no}`,
      `金额：¥${fmtAmount(order.amount)} ${order.currency || 'CNY'}`,
      `状态：${statusLabel(order.status)}`,
      `类型：${orderTypeLabel(order.order_type)}`,
      order.paid_at ? `支付时间：${fmtTime(order.paid_at)}` : `创建时间：${fmtTime(order.created_at)}`,
    ].join('\n'),
    showCancel: false,
    confirmText: '确定',
  })
}

async function loadOrders(p = 1, append = false) {
  if (append) loadingMore.value = true
  try {
    const data = await getMyOrders(p, PAGE_SIZE, activeTab.value)
    const items = data?.items || []
    const tot = data?.total || 0
    orders.value = append ? [...orders.value, ...items] : items
    total.value = tot
    page.value = p
    hasMore.value = orders.value.length < tot
  } catch {
    // toast already shown by request.js
  } finally {
    firstLoading.value = false
    loadingMore.value = false
    refreshing.value = false
    uni.stopPullDownRefresh()
  }
}

async function switchTab(val) {
  if (activeTab.value === val) return
  activeTab.value = val
  firstLoading.value = true
  orders.value = []
  await loadOrders(1, false)
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  await loadOrders(page.value + 1, true)
}

async function onPullDown() {
  if (refreshing.value) return
  refreshing.value = true
  await loadOrders(1, false)
}

onLoad(() => {
  statusBarH.value = uni.getSystemInfoSync().statusBarHeight
  if (!userStore.isLoggedIn) {
    uni.navigateTo({ url: '/pages/login/index' })
    return
  }
  loadOrders(1, false)
})
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #f5f5f7;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  align-items: center;
  padding: 24rpx 32rpx;
  background: #fff;
  position: relative;
  box-shadow: 0 1rpx 0 #f0f0f0;
}
.back-btn {
  width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.header-title {
  position: absolute;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 34rpx;
  font-weight: 600;
  color: #1a1a2e;
  pointer-events: none;
}

/* 筛选 Tab */
.tab-bar {
  display: flex;
  background: #fff;
  padding: 0 24rpx;
  border-bottom: 1rpx solid #f0f0f0;
}
.tab-item {
  padding: 24rpx 32rpx;
  position: relative;
}
.tab-text {
  font-size: 28rpx;
  color: #6b7280;
}
.tab-active .tab-text {
  color: #4F6EF7;
  font-weight: 600;
}
.tab-active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 32rpx;
  right: 32rpx;
  height: 4rpx;
  background: #4F6EF7;
  border-radius: 2rpx;
}

/* 骨架 */
.skeleton-row {
  height: 180rpx;
  background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  border-radius: 16rpx;
  margin: 16rpx 24rpx 0;
  animation: shimmer 1.4s infinite;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* 空状态 */
.empty-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 100rpx 0;
  gap: 20rpx;
}
.empty-txt {
  font-size: 28rpx;
  color: #6b7280;
}

/* 订单列表 */
.list-scroll {
  flex: 1;
}
.order-list {
  padding: 24rpx;
}
.order-card {
  background: #fff;
  border-radius: 20rpx;
  padding: 32rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.06);
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24rpx;
}
.order-type-badge {
  padding: 6rpx 18rpx;
  border-radius: 20rpx;
  font-size: 22rpx;
  font-weight: 600;
}
.badge-topup {
  background: #eef1ff;
  color: #4F6EF7;
}
.badge-sub {
  background: #fff7e8;
  color: #f59e0b;
}

.status-chip {
  padding: 6rpx 18rpx;
  border-radius: 20rpx;
  font-size: 22rpx;
  font-weight: 500;
}
.chip-pending { background: #fff7e8; color: #f59e0b; }
.chip-paid { background: #e8faf0; color: #18A058; }
.chip-partial_refunded { background: #eef1ff; color: #4F6EF7; }
.chip-fully_refunded { background: #f0f4ff; color: #6366f1; }
.chip-closed { background: #f5f5f5; color: #6b7280; }
.chip-expired { background: #fff0f0; color: #ef4444; }

.card-mid {
  display: flex;
  align-items: baseline;
  gap: 8rpx;
  margin-bottom: 20rpx;
}
.amount {
  font-size: 52rpx;
  font-weight: 700;
  color: #1a1a2e;
  font-variant-numeric: tabular-nums;
}
.currency {
  font-size: 24rpx;
  color: #9ca3af;
}

.card-bot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.order-no {
  font-size: 20rpx;
  color: #9ca3af;
  max-width: 380rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.order-time {
  font-size: 22rpx;
  color: #9ca3af;
  flex-shrink: 0;
}

.paid-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid #f5f5f7;
}
.paid-label { font-size: 22rpx; color: #9ca3af; }
.paid-time { font-size: 22rpx; color: #6b7280; }

/* 加载更多 */
.load-more {
  height: 80rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border-radius: 14rpx;
  margin-top: 8rpx;
}
.more-txt { font-size: 26rpx; color: #4F6EF7; }
.no-more {
  height: 60rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.no-more-txt { font-size: 24rpx; color: #9ca3af; }
</style>
