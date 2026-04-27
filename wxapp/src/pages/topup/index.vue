<template>
  <view class="page">
    <view :style="{ height: statusBarH + 'px' }" />

    <!-- 标题 -->
    <view class="header">
      <view class="back-btn" @click="goBack">
        <u-icon name="arrow-left" size="20" color="#1a1a2e" />
      </view>
      <text class="header-title">充值</text>
    </view>

    <!-- 余额卡 -->
    <view class="balance-card">
      <text class="balance-label">当前余额</text>
      <text class="balance-num">{{ fmtQuota(userStore.userInfo?.quota) }}</text>
    </view>

    <!-- 金额选择 -->
    <view class="section">
      <text class="section-title">常用金额</text>
      <view class="preset-grid">
        <view
          v-for="v in PRESETS"
          :key="v"
          class="preset-item"
          :class="{ active: amount === v && !customMode }"
          @click="selectPreset(v)"
        >
          <text class="preset-num">¥{{ v }}</text>
        </view>
      </view>

      <view class="custom-row">
        <text class="custom-label">自定义金额</text>
        <input
          v-model="customInput"
          class="custom-input"
          type="digit"
          placeholder="1 - 10000 元"
          placeholder-class="ph"
          @input="onCustomInput"
        />
      </view>
    </view>

    <!-- 支付按钮 -->
    <view class="section">
      <view
        class="btn-wechat"
        :class="{ 'btn-disabled': !canPay || paying }"
        @click="doPay"
      >
        <u-icon
          v-if="!paying"
          name="weixin-fill"
          size="20"
          color="#fff"
          style="margin-right: 14rpx;"
        />
        <u-loading-icon v-else color="#fff" size="32" />
        <text style="margin-left: 12rpx;">
          {{ paying ? '支付中...' : `微信支付 ¥${amount.toFixed(2)}` }}
        </text>
      </view>
      <text class="tip">支付成功后额度立即到账</text>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'
import { createWechatTopupJsapi, getPaymentOrder, getSelf } from '@/services/api.js'

const PRESETS = [20, 50, 100, 200, 500]
const MIN_AMOUNT = 1
const MAX_AMOUNT = 10000

const statusBarH = ref(0)
const preset = ref(PRESETS[1])
const customInput = ref('')
const customMode = ref(false)
const paying = ref(false)

const amount = computed(() => {
  if (customMode.value) {
    const n = Number(customInput.value)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  return preset.value
})

const canPay = computed(
  () => amount.value >= MIN_AMOUNT && amount.value <= MAX_AMOUNT,
)

onLoad(() => {
  statusBarH.value = uni.getSystemInfoSync().statusBarHeight
})

function selectPreset(v) {
  preset.value = v
  customMode.value = false
  customInput.value = ''
}

function onCustomInput() {
  customMode.value = customInput.value !== ''
}

function goBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    const prevRoute = pages[pages.length - 2]?.route || ''
    if (prevRoute === 'pages/home/index') {
      uni.navigateBack()
    } else {
      uni.switchTab({ url: '/pages/home/index' })
    }
  } else {
    uni.switchTab({ url: '/pages/home/index' })
  }
}

/** 格式化额度显示（和 PC 一致，走 quotaPerUnit） */
function fmtQuota(q) {
  if (q == null) return '—'
  const per = userStore.quotaPerUnit || 500000
  const v = (q / per).toFixed(2)
  const type = userStore.quotaDisplayType
  if (type === 'CNY') return `¥${(Number(v) * userStore.usdExchangeRate).toFixed(2)}`
  if (type === 'TOKENS') return `${q.toLocaleString ? q.toLocaleString() : q}`
  return `$${v}`
}

function callWxPayment(sign) {
  return new Promise((resolve, reject) => {
    uni.requestPayment({
      provider: 'wxpay',
      // WeChat's mini-program wx.requestPayment expects camelCase keys;
      // backend returns snake_case so we remap here.
      timeStamp: sign.timestamp,
      nonceStr: sign.nonce_str,
      package: sign.package,
      signType: sign.sign_type || 'RSA',
      paySign: sign.pay_sign,
      success: resolve,
      fail: (err) => reject(new Error(err?.errMsg || '支付已取消')),
    })
  })
}

async function pollUntilPaid(outTradeNo) {
  // 回调到账一般 1-3 秒，轮询 6 次 * 1s 基本够了；超时不代表失败，告诉用户
  // 稍后刷新即可——回调 / reconcile loop 会兜底。
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    try {
      const o = await getPaymentOrder(outTradeNo)
      if (o && o.status && o.status !== 'pending') return o.status
    } catch (_) {
      // 忽略单次查询失败，继续下一轮
    }
  }
  return 'pending'
}

async function doPay() {
  if (!canPay.value || paying.value) return
  paying.value = true
  try {
    // 1. 下单
    const data = await createWechatTopupJsapi(amount.value)
    const sign = data?.response
    const order = data?.order
    if (!sign || !sign.prepay_id) {
      throw new Error('服务端未返回支付签名')
    }

    // 2. 拉起微信支付面板
    await callWxPayment(sign)

    // 3. 等回调到账
    uni.showLoading({ title: '正在确认到账', mask: true })
    const finalStatus = await pollUntilPaid(order.out_trade_no)
    uni.hideLoading()

    if (finalStatus === 'paid' || finalStatus === 'partial_refunded' || finalStatus === 'fully_refunded') {
      // 4. 刷新用户额度
      try {
        const me = await getSelf()
        if (me) userStore.setUserInfo(me)
      } catch (_) { /* toast 已给足反馈 */ }
      uni.showToast({ title: '充值成功', icon: 'success', duration: 1500 })
      setTimeout(() => goBack(), 1200)
    } else if (finalStatus === 'expired' || finalStatus === 'closed') {
      uni.showToast({ title: `订单已${finalStatus === 'expired' ? '过期' : '关闭'}`, icon: 'none' })
    } else {
      uni.showToast({
        title: '支付已受理，稍后下拉刷新余额',
        icon: 'none',
        duration: 2500,
      })
    }
  } catch (err) {
    uni.hideLoading()
    uni.showToast({
      title: err.message || '支付失败',
      icon: 'none',
      duration: 2500,
    })
  } finally {
    paying.value = false
  }
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: linear-gradient(160deg, #eef1ff 0%, #f5f5f7 50%, #f0f4ff 100%);
  padding-bottom: 80rpx;
  box-sizing: border-box;
}

.header {
  display: flex;
  align-items: center;
  padding: 24rpx 32rpx;
  position: relative;
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

.balance-card {
  margin: 16rpx 48rpx 32rpx;
  background: linear-gradient(135deg, #4F6EF7, #6C8EFF);
  border-radius: 24rpx;
  padding: 48rpx 40rpx;
  color: #fff;
  box-shadow: 0 8rpx 32rpx rgba(79, 110, 247, 0.3);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.balance-label {
  font-size: 26rpx;
  opacity: 0.85;
  margin-bottom: 16rpx;
}
.balance-num {
  font-size: 60rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
  font-variant-numeric: tabular-nums;
}

.section {
  margin: 32rpx 48rpx;
  background: #fff;
  border-radius: 20rpx;
  padding: 32rpx;
  box-shadow: 0 4rpx 20rpx rgba(0, 0, 0, 0.04);
}
.section-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #1a1a2e;
  margin-bottom: 24rpx;
  display: block;
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20rpx;
  margin-bottom: 24rpx;
}
.preset-item {
  padding: 28rpx 0;
  border-radius: 14rpx;
  background: #f8f9ff;
  border: 2rpx solid #e5e9f7;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.preset-item.active {
  background: linear-gradient(135deg, #4F6EF7, #6C8EFF);
  border-color: transparent;
}
.preset-num {
  font-size: 32rpx;
  font-weight: 600;
  color: #4F6EF7;
  font-variant-numeric: tabular-nums;
}
.preset-item.active .preset-num {
  color: #fff;
}

.custom-row {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding-top: 24rpx;
  border-top: 1rpx solid #f0f0f0;
}
.custom-label {
  font-size: 26rpx;
  color: #6b7280;
  white-space: nowrap;
}
.custom-input {
  flex: 1;
  height: 72rpx;
  background: #f8f9ff;
  border-radius: 12rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
  color: #1a1a2e;
  box-sizing: border-box;
  font-variant-numeric: tabular-nums;
}
.ph {
  color: #9ca3af;
}

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
  font-variant-numeric: tabular-nums;
}
.btn-disabled {
  opacity: 0.5;
}
.tip {
  display: block;
  margin-top: 20rpx;
  font-size: 22rpx;
  color: #9ca3af;
  text-align: center;
}
</style>
