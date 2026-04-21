<template>
  <view class="page">
    <u-navbar title="充值" :auto-back="true" bgColor="#fff" :placeholder="true" />

    <!-- Tab 切换 -->
    <view class="tab-bar">
      <view
        class="tab-item"
        :class="{ active: activeTab === 'wechat' }"
        @click="activeTab = 'wechat'"
      >微信支付</view>
      <view
        class="tab-item"
        :class="{ active: activeTab === 'redeem' }"
        @click="activeTab = 'redeem'"
      >兑换码</view>
    </view>

    <!-- 微信支付区域 -->
    <view class="content" v-if="activeTab === 'wechat'">
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
            size="40"
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

    <!-- 兑换码区域 -->
    <view class="content" v-else>
      <!-- 兑换成功提示 -->
      <view class="success-card" v-if="success">
        <u-icon name="checkmark-circle" size="80" color="#18A058" />
        <text class="success-title">兑换成功！</text>
        <text class="success-quota">已充值 {{ q2cny(addedQuota) }}</text>
        <text class="success-balance">当前余额：{{ q2cny(newBalance) }}</text>
        <view class="success-btn" @click="reset">继续兑换</view>
      </view>

      <!-- 输入区 -->
      <template v-else>
        <view class="input-card">
          <text class="input-label">兑换码</text>
          <view class="input-wrap">
            <input
              class="code-input"
              v-model="code"
              placeholder="请输入兑换码"
              placeholder-class="ph"
              :disabled="submitting"
              @confirm="doRedeem"
              maxlength="64"
            />
            <view class="clear-btn" v-if="code" @click="code = ''">
              <u-icon name="close-circle-fill" size="36" color="#9ca3af" />
            </view>
          </view>

          <view
            class="submit-btn"
            :class="{ 'btn-disabled': !code.trim() || submitting }"
            @click="doRedeem"
          >
            <u-loading-icon v-if="submitting" color="#fff" size="28" />
            <text v-else>立即兑换</text>
          </view>
        </view>

        <!-- 使用说明 -->
        <view class="guide-card">
          <text class="guide-title">使用说明</text>
          <view class="guide-item" v-for="(g, i) in guides" :key="i">
            <text class="guide-dot">·</text>
            <text class="guide-txt">{{ g }}</text>
          </view>
        </view>
      </template>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'
import { redeemCode, getSelf, createWechatTopupJsapi, getPaymentOrder } from '@/services/api.js'
import { renderQuota } from '@/utils/quota.js'

// ─── Tab ────────────────────────────────────────────────────────────────────
const activeTab = ref('wechat')

// ─── 微信支付 ────────────────────────────────────────────────────────────────
const PRESETS = [1, 5, 10, 20, 50, 100]
const MIN_AMOUNT = 1
const MAX_AMOUNT = 10000

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

function selectPreset(v) {
  preset.value = v
  customMode.value = false
  customInput.value = ''
}

function onCustomInput() {
  customMode.value = customInput.value !== ''
}

function fmtQuota(q) {
  if (q == null) return '—'
  const per = userStore.quotaPerUnit || 500000
  const v = (q / per).toFixed(2)
  const type = userStore.quotaDisplayType
  if (type === 'CNY') return `¥${(Number(v) * userStore.usdExchangeRate).toFixed(2)}`
  if (type === 'TOKENS') return `${q.toLocaleString?.() ?? q}`
  return `$${v}`
}

function callWxPayment(sign) {
  return new Promise((resolve, reject) => {
    uni.requestPayment({
      provider: 'wxpay',
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
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    try {
      const o = await getPaymentOrder(outTradeNo)
      if (o && o.status && o.status !== 'pending') return o.status
    } catch (_) {}
  }
  return 'pending'
}

async function doPay() {
  if (!canPay.value || paying.value) return
  if (!userStore.isLoggedIn) {
    uni.navigateTo({ url: '/pages/login/index' })
    return
  }
  paying.value = true
  try {
    const data = await createWechatTopupJsapi(amount.value)
    const sign = data?.response
    const order = data?.order
    if (!sign || !sign.prepay_id) {
      throw new Error('服务端未返回支付签名')
    }

    await callWxPayment(sign)

    uni.showLoading({ title: '正在确认到账', mask: true })
    const finalStatus = await pollUntilPaid(order.out_trade_no)
    uni.hideLoading()

    if (finalStatus === 'paid' || finalStatus === 'partial_refunded' || finalStatus === 'fully_refunded') {
      try {
        const me = await getSelf()
        if (me) userStore.setUserInfo(me)
      } catch (_) {}
      uni.showToast({ title: '充值成功', icon: 'success', duration: 1500 })
    } else if (finalStatus === 'expired' || finalStatus === 'closed') {
      uni.showToast({ title: `订单已${finalStatus === 'expired' ? '过期' : '关闭'}`, icon: 'none' })
    } else {
      uni.showToast({ title: '支付已受理，稍后下拉刷新余额', icon: 'none', duration: 2500 })
    }
  } catch (err) {
    uni.hideLoading()
    uni.showToast({ title: err.message || '支付失败', icon: 'none', duration: 2500 })
  } finally {
    paying.value = false
  }
}

// ─── 兑换码 ──────────────────────────────────────────────────────────────────
const code = ref('')
const submitting = ref(false)
const success = ref(false)
const addedQuota = ref(0)
const newBalance = ref(0)

const guides = [
  '每个兑换码只能使用一次。',
  '兑换成功后额度立即到账，可在首页余额查看。',
  '兑换码不区分大小写，请避免输入多余空格。',
  '如有问题，请联系客服或管理员。',
]

function q2cny(quota) { return renderQuota(quota) }

function reset() {
  code.value = ''
  success.value = false
  addedQuota.value = 0
  newBalance.value = 0
}

async function doRedeem() {
  if (!userStore.isLoggedIn) {
    uni.navigateTo({ url: '/pages/login/index' })
    return
  }
  const key = code.value.trim()
  if (!key) return uni.showToast({ title: '请输入兑换码', icon: 'none' })
  if (submitting.value) return

  submitting.value = true
  try {
    const quotaAdded = await redeemCode(key)
    addedQuota.value = Number(quotaAdded) || 0

    try {
      const self = await getSelf()
      newBalance.value = self?.quota || 0
      userStore.setUserInfo(self)
    } catch {
      newBalance.value = 0
    }

    success.value = true
  } catch {
    // request.js 已经 toast 过错误了
  } finally {
    submitting.value = false
  }
}

onLoad(() => {})
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: #f5f5f7; }
.content { padding: 24rpx; }

/* Tab 切换 */
.tab-bar {
  display: flex;
  background: #fff;
  border-bottom: 1rpx solid #f0f0f0;
  padding: 0 32rpx;
}
.tab-item {
  flex: 1;
  height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  color: #6b7280;
  font-weight: 500;
  position: relative;
}
.tab-item.active {
  color: #4F6EF7;
  font-weight: 600;
}
.tab-item.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 20%;
  right: 20%;
  height: 4rpx;
  background: #4F6EF7;
  border-radius: 4rpx;
}

/* 余额卡 */
.balance-card {
  background: linear-gradient(135deg, #4F6EF7, #6C8EFF);
  border-radius: 20rpx;
  padding: 40rpx;
  color: #fff;
  box-shadow: 0 8rpx 28rpx rgba(79, 110, 247, 0.28);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin-bottom: 24rpx;
}
.balance-label {
  font-size: 26rpx;
  opacity: 0.85;
  margin-bottom: 12rpx;
}
.balance-num {
  font-size: 56rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
  font-variant-numeric: tabular-nums;
}

/* 金额选择 */
.section {
  background: #fff;
  border-radius: 20rpx;
  padding: 32rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.05);
  margin-bottom: 24rpx;
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
}
.preset-item.active {
  background: linear-gradient(135deg, #4F6EF7, #6C8EFF);
  border-color: transparent;
}
.preset-num {
  font-size: 30rpx;
  font-weight: 600;
  color: #4F6EF7;
  font-variant-numeric: tabular-nums;
}
.preset-item.active .preset-num { color: #fff; }

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
  box-shadow: 0 8rpx 24rpx rgba(9, 187, 7, 0.3);
  letter-spacing: 2rpx;
  font-variant-numeric: tabular-nums;
}
.btn-disabled { opacity: 0.5; }
.tip {
  display: block;
  margin-top: 20rpx;
  font-size: 22rpx;
  color: #9ca3af;
  text-align: center;
}

/* 兑换成功卡片 */
.success-card {
  background: #fff; border-radius: 24rpx; padding: 60rpx 40rpx;
  display: flex; flex-direction: column; align-items: center;
  box-shadow: 0 4rpx 20rpx rgba(0,0,0,0.06);
}
.success-title { font-size: 36rpx; font-weight: 700; color: #18A058; margin: 24rpx 0 12rpx; }
.success-quota { font-size: 48rpx; font-weight: 700; color: #1a1a2e; margin-bottom: 12rpx; }
.success-balance { font-size: 26rpx; color: #6b7280; margin-bottom: 40rpx; }
.success-btn {
  width: 100%; height: 88rpx;
  background: linear-gradient(135deg, #4F6EF7, #6C8EFF);
  border-radius: 14rpx;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 30rpx; font-weight: 600;
  box-shadow: 0 6rpx 20rpx rgba(79,110,247,0.3);
}

/* 兑换码输入卡片 */
.input-card {
  background: #fff; border-radius: 20rpx; padding: 36rpx;
  box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.06);
  margin-bottom: 24rpx;
}
.input-label {
  display: block; font-size: 28rpx; font-weight: 600; color: #1a1a2e; margin-bottom: 20rpx;
}
.input-wrap {
  position: relative; display: flex; align-items: center;
  background: #f8f9ff; border-radius: 14rpx;
  border: 2rpx solid #e8ecff;
  margin-bottom: 32rpx;
}
.code-input {
  flex: 1; height: 100rpx; padding: 0 24rpx;
  font-size: 28rpx; color: #1a1a2e;
}
.ph { color: #9ca3af; }
.clear-btn { padding: 20rpx 20rpx 20rpx 0; }
.submit-btn {
  height: 96rpx;
  background: linear-gradient(135deg, #4F6EF7, #6C8EFF);
  border-radius: 14rpx;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 32rpx; font-weight: 600;
  box-shadow: 0 6rpx 20rpx rgba(79,110,247,0.3);
}

/* 使用说明 */
.guide-card {
  background: #fff; border-radius: 20rpx; padding: 32rpx;
  box-shadow: 0 2rpx 10rpx rgba(0,0,0,0.05);
}
.guide-title { display: block; font-size: 28rpx; font-weight: 600; color: #1a1a2e; margin-bottom: 20rpx; }
.guide-item { display: flex; margin-bottom: 16rpx; }
.guide-dot { font-size: 28rpx; color: #4F6EF7; margin-right: 12rpx; }
.guide-txt { font-size: 26rpx; color: #4b5563; line-height: 1.6; flex: 1; }
</style>
