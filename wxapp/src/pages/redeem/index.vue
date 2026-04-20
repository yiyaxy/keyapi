<template>
  <view class="page">
    <u-navbar title="兑换码充值" :auto-back="true" bgColor="#fff" :placeholder="true" />

    <view class="content">
      <!-- 说明区 -->
      <view class="tip-card">
        <u-icon name="coupon" size="60" color="#4F6EF7" />
        <view class="tip-text-wrap">
          <text class="tip-title">兑换码充值</text>
          <text class="tip-desc">输入有效的兑换码，可为当前账户增加 API 调用额度</text>
        </view>
      </view>

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
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'
import { redeemCode, getSelf } from '@/services/api.js'
import { renderQuota } from '@/utils/quota.js'

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
  const key = code.value.trim()
  if (!key) return uni.showToast({ title: '请输入兑换码', icon: 'none' })
  if (submitting.value) return

  submitting.value = true
  try {
    // redeemCode 成功时返回充值的额度数值
    const quotaAdded = await redeemCode(key)
    addedQuota.value = Number(quotaAdded) || 0

    // 刷新用户余额
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

onLoad(() => {
  if (!userStore.isLoggedIn) {
    uni.navigateTo({ url: '/pages/login/index' })
  }
})
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: #f5f5f7; }
.content { padding: 24rpx; }

/* 说明卡片 */
.tip-card {
  display: flex; align-items: center;
  background: linear-gradient(135deg, #eef1ff, #f0f4ff);
  border-radius: 20rpx; padding: 32rpx;
  margin-bottom: 24rpx;
  border: 1rpx solid rgba(79,110,247,0.12);
}
.tip-text-wrap { margin-left: 20rpx; flex: 1; }
.tip-title { display: block; font-size: 30rpx; font-weight: 600; color: #4F6EF7; margin-bottom: 8rpx; }
.tip-desc { font-size: 24rpx; color: #6b7280; line-height: 1.6; }

/* 成功卡片 */
.success-card {
  background: #fff; border-radius: 24rpx; padding: 60rpx 40rpx;
  display: flex; flex-direction: column; align-items: center;
  box-shadow: 0 4rpx 20rpx rgba(0,0,0,0.06);
}
.success-title { font-size: 36rpx; font-weight: 700; color: #18A058; margin: 24rpx 0 12rpx; }
.success-quota { font-size: 48rpx; font-weight: 700; color: #1a1a2e; margin-bottom: 12rpx; }
.success-balance { font-size: 26rpx; color: #6b7280; margin-bottom: 40rpx; }
.success-btn {
  width: 100%;
  height: 88rpx;
  background: linear-gradient(135deg, #4F6EF7, #6C8EFF);
  border-radius: 14rpx;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 30rpx; font-weight: 600;
  box-shadow: 0 6rpx 20rpx rgba(79,110,247,0.3);
}

/* 输入卡片 */
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
.btn-disabled { opacity: 0.5; }

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
