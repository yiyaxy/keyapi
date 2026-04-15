<template>
  <view class="redeem-page">
    <u-navbar title="兑换码充值" :auto-back="true" />

    <view class="content">
      <!-- Description -->
      <view class="desc-card">
        <u-icon name="coupon" size="60" color="#4F6EF7" />
        <view class="desc-text">
          <text class="desc-title">输入兑换码</text>
          <text class="desc-sub">兑换码充值后额度将立即到账</text>
        </view>
      </view>

      <!-- Input area -->
      <view class="input-card">
        <text class="input-label">兑换码</text>
        <u-input
          v-model="code"
          placeholder="请输入兑换码"
          :border="'surround'"
          :custom-style="inputStyle"
          :disabled="submitting"
          :clearable="true"
          @confirm="doRedeem"
        />

        <u-button
          type="primary"
          :loading="submitting"
          :disabled="submitting || !code.trim()"
          :custom-style="btnStyle"
          @click="doRedeem"
        >
          {{ submitting ? '兑换中...' : '立即兑换' }}
        </u-button>
      </view>

      <!-- Success result -->
      <view v-if="successMsg" class="success-card">
        <u-icon name="checkmark-circle-fill" size="80" color="#18A058" />
        <text class="success-text">{{ successMsg }}</text>
        <u-button
          type="success"
          :custom-style="backBtnStyle"
          @click="goBack"
        >
          返回首页
        </u-button>
      </view>

      <!-- Tips -->
      <view class="tips-card">
        <text class="tips-title">使用说明</text>
        <view class="tip-item">
          <text class="tip-num">1</text>
          <text class="tip-text">每个兑换码只能使用一次</text>
        </view>
        <view class="tip-item">
          <text class="tip-num">2</text>
          <text class="tip-text">兑换成功后额度立即到账，可在首页查看</text>
        </view>
        <view class="tip-item">
          <text class="tip-num">3</text>
          <text class="tip-text">兑换码区分大小写，请准确输入</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { userStore } from '@/store/user.js'
import { redeemCode, getSelf } from '@/services/api.js'

const code = ref('')
const submitting = ref(false)
const successMsg = ref('')

const inputStyle = {
  fontSize: '30rpx',
  borderRadius: '12rpx',
  minHeight: '88rpx',
}

const btnStyle = {
  background: 'linear-gradient(135deg, #4F6EF7, #6C8EFF)',
  borderRadius: '14rpx',
  height: '88rpx',
  fontSize: '30rpx',
  border: 'none',
  marginTop: '32rpx',
  boxShadow: '0 6rpx 20rpx rgba(79, 110, 247, 0.3)',
}

const backBtnStyle = {
  borderRadius: '14rpx',
  height: '80rpx',
  fontSize: '28rpx',
  marginTop: '24rpx',
}

async function doRedeem() {
  const key = code.value.trim()
  if (!key) {
    uni.showToast({ title: '请输入兑换码', icon: 'none' })
    return
  }

  submitting.value = true
  successMsg.value = ''

  try {
    const res = await redeemCode(key)
    // Refresh user info to get new balance
    try {
      const self = await getSelf()
      userStore.setUserInfo(self)
    } catch (_) {}

    successMsg.value = res?.message || '兑换成功！额度已到账'
    code.value = ''
    uni.showToast({ title: '兑换成功', icon: 'success' })
  } catch (e) {
    // Error already shown by request.js
  } finally {
    submitting.value = false
  }
}

function goBack() {
  uni.switchTab({ url: '/pages/home/index' })
}
</script>

<style lang="scss" scoped>
.redeem-page {
  min-height: 100vh;
  background: #f5f5f7;
}

.content {
  padding: 24rpx;
}

.desc-card {
  background: #fff;
  border-radius: 20rpx;
  padding: 36rpx;
  display: flex;
  align-items: center;
  margin-bottom: 24rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.05);

  .desc-text {
    margin-left: 24rpx;

    .desc-title {
      display: block;
      font-size: 32rpx;
      font-weight: 600;
      color: #1a1a2e;
      margin-bottom: 8rpx;
    }

    .desc-sub {
      font-size: 24rpx;
      color: #6b7280;
    }
  }
}

.input-card {
  background: #fff;
  border-radius: 20rpx;
  padding: 36rpx;
  margin-bottom: 24rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.05);

  .input-label {
    display: block;
    font-size: 26rpx;
    font-weight: 500;
    color: #374151;
    margin-bottom: 16rpx;
  }
}

.success-card {
  background: linear-gradient(135deg, #e8faf0, #f0fdf4);
  border-radius: 20rpx;
  padding: 48rpx;
  margin-bottom: 24rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  border: 1rpx solid #d1fae5;

  .success-text {
    font-size: 30rpx;
    color: #18A058;
    font-weight: 600;
    margin-top: 20rpx;
    text-align: center;
  }
}

.tips-card {
  background: #fff;
  border-radius: 20rpx;
  padding: 36rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.05);

  .tips-title {
    display: block;
    font-size: 28rpx;
    font-weight: 600;
    color: #1a1a2e;
    margin-bottom: 24rpx;
  }

  .tip-item {
    display: flex;
    align-items: flex-start;
    margin-bottom: 16rpx;

    .tip-num {
      width: 40rpx;
      height: 40rpx;
      border-radius: 50%;
      background: #eef1ff;
      color: #4F6EF7;
      font-size: 22rpx;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 16rpx;
      flex-shrink: 0;
    }

    .tip-text {
      font-size: 26rpx;
      color: #374151;
      line-height: 1.6;
      padding-top: 6rpx;
    }
  }
}
</style>
