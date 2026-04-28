<template>
  <view class="page">
    <view :style="{ height: statusBarH + 'px' }" />

    <view v-if="canGoBack" class="back-bar">
      <view class="back-btn" @click="goBack">
        <u-icon name="arrow-left" size="20" color="#1a1a2e" />
        <text class="back-txt">返回</text>
      </view>
    </view>

    <view class="logo-area">
      <view class="logo-icon">
        <text class="logo-letter">A</text>
      </view>
      <text class="logo-title">ALl Models</text>
      <text class="logo-sub">AI 接口管理平台</text>
    </view>

    <view class="login-card">
      <text class="card-title">欢迎登录</text>
      <text class="card-desc">使用微信账号快速登录平台</text>

      <view class="privacy-notice">
        <text class="notice-title">登录授权说明</text>
        <text class="notice-text">
          为完成账号登录、创建平台账号、维护登录状态、展示余额订单与提供 API Key 服务，我们将在你同意后调用微信登录能力，获取微信登录凭证（code），并由服务端换取 openid/unionid 等账号标识。
        </text>
        <text class="notice-text">
          我们不会在未取得你同意前调用微信登录，也不会将你的账号信息用于本服务以外的用途。
        </text>
      </view>

      <view class="agreement-row" @click="toggleAgreement">
        <view class="check-box" :class="{ checked: agreed }">
          <u-icon v-if="agreed" name="checkbox-mark" size="14" color="#fff" />
        </view>
        <view class="agreement-text">
          <text>我已阅读并同意</text>
          <text class="link" @click.stop="openAgreement">《用户服务协议》</text>
          <text>和</text>
          <text class="link" @click.stop="openPrivacy">《隐私政策》</text>
        </view>
      </view>

      <view class="btn-wechat" :class="{ 'btn-loading': loading, disabled: !agreed }" @click="doWechatLogin">
        <u-icon
          v-if="!loading"
          name="weixin-fill"
          size="20"
          color="#fff"
          style="margin-right: 14rpx;"
        />
        <u-loading-icon v-else color="#fff" size="32" />
        <text style="margin-left: 12rpx;">
          {{ loading ? '登录中...' : '微信一键登录' }}
        </text>
      </view>
    </view>

    <text class="footer-tip">请先阅读并勾选协议后再登录</text>

    <view v-if="docVisible" class="doc-mask" @click="closeDoc">
      <view class="doc-panel" @click.stop>
        <view class="doc-header">
          <text class="doc-title">{{ activeDoc.title }}</text>
          <view class="doc-close" @click="closeDoc">
            <u-icon name="close" size="18" color="#6b7280" />
          </view>
        </view>
        <scroll-view scroll-y class="doc-body">
          <view v-for="(section, index) in activeDoc.sections" :key="index" class="doc-section">
            <text class="doc-section-title">{{ section.title }}</text>
            <text class="doc-section-text">{{ section.body }}</text>
          </view>
        </scroll-view>
        <view class="doc-footer">
          <view class="doc-confirm" @click="agreeFromDoc">已阅读并同意</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { userStore } from '@/store/user.js'
import request from '@/services/request.js'
import env from '@/config/env.js'
import { clearPendingInviterId, getPendingInviterId } from '@/utils/share.js'

const statusBarH = ref(0)
const loading = ref(false)
const canGoBack = ref(false)
const agreed = ref(false)
const docVisible = ref(false)
const docType = ref('privacy')

const agreementDoc = {
  title: '用户服务协议',
  sections: [
    {
      title: '一、服务内容',
      body: '本平台为用户提供 AI 模型接口调用、API Key 管理、余额充值、订单查询、消费记录、邀请返利等服务。你登录并使用本服务，即表示你理解并同意按照平台规则使用相关能力。',
    },
    {
      title: '二、账号登录与使用',
      body: '你可以使用微信账号登录本平台。登录成功后，平台会为你创建或匹配平台账号，用于保存余额、订单、API Key、邀请关系和使用记录。你应妥善保管账号、登录状态和 API Key，不得将账号或 Key 用于违法违规用途。',
    },
    {
      title: '三、API Key 与模型调用',
      body: '你可以在平台中创建或使用默认 API Key，并将 Base URL、模型名称和 API Key 配置到支持 OpenAI 兼容接口的客户端中。模型调用会按照平台计费规则消耗余额。',
    },
    {
      title: '四、充值、订单与返利',
      body: '你可以通过平台提供的支付方式充值。支付成功后，余额会计入账号。分享拉新、上下级关系和充值返利以平台后台配置为准，返利可能受用户等级、次数、比例、订单状态等因素影响。',
    },
    {
      title: '五、用户行为规范',
      body: '你不得利用本服务生成、传播或处理违法违规内容，不得攻击平台系统、盗用他人账号、转售未经授权的服务或绕过计费规则。违反规则时，平台有权限制、暂停或终止服务。',
    },
    {
      title: '六、协议更新',
      body: '平台可能根据业务或法律要求更新本协议。更新后会在登录页或相关页面展示，继续使用服务视为你已阅读并接受更新内容。',
    },
  ],
}

const privacyDoc = {
  title: '隐私政策',
  sections: [
    {
      title: '一、我们收集的信息',
      body: '为完成登录和账号识别，我们会在你勾选同意后调用微信登录能力，获取微信登录凭证（code），并由服务端向微信换取 openid/unionid 等账号标识。我们还会保存你的平台用户 ID、登录状态、余额、订单、充值记录、消费记录、API Key 信息、邀请关系和必要的操作日志。',
    },
    {
      title: '二、收集信息的目的',
      body: '上述信息用于账号登录与身份识别、创建和维护平台账号、展示余额和订单、提供 API Key 与模型调用服务、处理充值和返利、保障账号安全、排查异常请求、满足必要的合规和审计要求。',
    },
    {
      title: '三、收集信息的方式',
      body: '你勾选同意并点击微信一键登录后，我们才会调用微信登录接口获取登录凭证。你通过分享进入、登录、充值、调用模型、创建 API Key 或查看订单时，系统会根据你的操作生成相应业务记录。',
    },
    {
      title: '四、信息的使用范围',
      body: '我们仅在提供本平台服务所必需的范围内使用你的信息，不会将你的微信账号标识、订单、余额、API Key 或使用记录出售给无关第三方。涉及支付、云服务或模型上游服务时，仅会在完成服务所需范围内进行必要处理。',
    },
    {
      title: '五、信息保存与安全',
      body: '我们会采取合理的技术措施保护你的账号和业务数据。请不要向他人泄露 API Key、登录态或账号信息。如发现 Key 泄露，请及时删除或重置。',
    },
    {
      title: '六、你的选择与权利',
      body: '如果你不同意本隐私政策，可以不勾选协议并停止登录。登录后，你可以联系平台管理员查询、更正或处理你的账号信息，也可以按平台规则申请注销或删除相关数据。',
    },
    {
      title: '七、未成年人保护',
      body: '未成年人使用本服务前，应取得监护人同意。监护人如认为未成年人信息被不当收集或使用，可以联系平台管理员处理。',
    },
  ],
}

const activeDoc = computed(() => (docType.value === 'agreement' ? agreementDoc : privacyDoc))

onLoad(() => {
  statusBarH.value = uni.getSystemInfoSync().statusBarHeight
  canGoBack.value = getCurrentPages().length > 1
  if (userStore.isLoggedIn) {
    uni.reLaunch({ url: '/pages/home/index' })
  }
})

function goBack() {
  uni.navigateBack({ delta: 1 })
}

function toggleAgreement() {
  agreed.value = !agreed.value
}

function openAgreement() {
  docType.value = 'agreement'
  docVisible.value = true
}

function openPrivacy() {
  docType.value = 'privacy'
  docVisible.value = true
}

function closeDoc() {
  docVisible.value = false
}

function agreeFromDoc() {
  agreed.value = true
  closeDoc()
}

function wxGetCode() {
  return new Promise((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success(res) {
        if (res.code) return resolve(res.code)
        reject(new Error(res.errMsg || '获取微信登录凭证失败'))
      },
      fail(err) {
        reject(new Error(err?.errMsg || '调用微信登录失败'))
      },
    })
  })
}

function postLogin(code) {
  return new Promise((resolve, reject) => {
    const inviterId = getPendingInviterId()
    const data = inviterId > 0 ? { code, inviter_id: inviterId } : { code }
    uni.request({
      url: env.basePath + '/api/oauth/wx_mini/login',
      method: 'POST',
      data,
      header: { 'Content-Type': 'application/json' },
      success(res) {
        const body = res.data
        if (!body) return reject(new Error('响应为空'))
        if (body.success === false) {
          return reject(new Error(body.message || '登录失败'))
        }
        const rawCookie = res.header['Set-Cookie'] || res.header['set-cookie'] || ''
        const cookie = request.extractCookie(rawCookie)
        if (!cookie) return reject(new Error('未收到登录会话，请重试'))
        userStore.setToken(cookie)
        if (body.data) userStore.setUserInfo(body.data)
        clearPendingInviterId()
        resolve()
      },
      fail() {
        reject(new Error('网络连接失败'))
      },
    })
  })
}

async function doWechatLogin() {
  if (loading.value) return
  if (!agreed.value) {
    uni.showToast({
      title: '请先阅读并同意用户服务协议和隐私政策',
      icon: 'none',
      duration: 2500,
    })
    return
  }
  loading.value = true
  try {
    const code = await wxGetCode()
    await postLogin(code)
    uni.showToast({ title: '登录成功', icon: 'success', duration: 1000 })
    setTimeout(() => uni.reLaunch({ url: '/pages/home/index' }), 900)
  } catch (err) {
    uni.showToast({
      title: err.message || '登录失败，请重试',
      icon: 'none',
      duration: 2500,
    })
  } finally {
    loading.value = false
  }
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #f5f7fb;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 48rpx 80rpx;
  box-sizing: border-box;
}

.back-bar {
  width: 100%;
  padding: 16rpx 24rpx 0;
  box-sizing: border-box;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  padding: 12rpx 20rpx;
}

.back-txt {
  font-size: 28rpx;
  color: #1a1a2e;
  margin-left: 8rpx;
}

.logo-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 96rpx;
  margin-bottom: 56rpx;
}

.logo-icon {
  width: 120rpx;
  height: 120rpx;
  border-radius: 30rpx;
  background: #4f6ef7;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 12rpx 32rpx rgba(79, 110, 247, 0.24);
  margin-bottom: 24rpx;
}

.logo-letter {
  font-size: 60rpx;
  font-weight: 700;
  color: #fff;
}

.logo-title {
  font-size: 46rpx;
  font-weight: 700;
  color: #1a1a2e;
  letter-spacing: 1rpx;
}

.logo-sub {
  font-size: 26rpx;
  color: #6b7280;
  margin-top: 12rpx;
}

.login-card {
  width: 100%;
  background: #fff;
  border-radius: 24rpx;
  padding: 48rpx 40rpx 42rpx;
  box-shadow: 0 8rpx 40rpx rgba(31, 41, 55, 0.08);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.card-title {
  font-size: 36rpx;
  font-weight: 600;
  color: #1a1a2e;
  margin-bottom: 16rpx;
}

.card-desc {
  font-size: 26rpx;
  color: #6b7280;
  margin-bottom: 32rpx;
}

.privacy-notice {
  width: 100%;
  background: #f8fafc;
  border: 1rpx solid #e5e7eb;
  border-radius: 18rpx;
  padding: 24rpx;
  box-sizing: border-box;
  margin-bottom: 28rpx;
}

.notice-title {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: #111827;
  margin-bottom: 12rpx;
}

.notice-text {
  display: block;
  font-size: 23rpx;
  line-height: 1.65;
  color: #4b5563;
  margin-top: 8rpx;
}

.agreement-row {
  width: 100%;
  display: flex;
  align-items: flex-start;
  margin-bottom: 28rpx;
}

.check-box {
  width: 34rpx;
  height: 34rpx;
  border-radius: 8rpx;
  border: 2rpx solid #cbd5e1;
  margin-top: 2rpx;
  margin-right: 14rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  flex-shrink: 0;
}

.check-box.checked {
  background: #2563eb;
  border-color: #2563eb;
}

.agreement-text {
  flex: 1;
  font-size: 24rpx;
  line-height: 1.5;
  color: #4b5563;
}

.link {
  color: #2563eb;
}

.btn-wechat {
  width: 100%;
  height: 96rpx;
  background: #09bb07;
  border-radius: 14rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 32rpx;
  font-weight: 600;
  box-shadow: 0 8rpx 24rpx rgba(9, 187, 7, 0.28);
  letter-spacing: 1rpx;
}

.btn-loading {
  opacity: 0.8;
}

.btn-wechat.disabled {
  background: #9ca3af;
  box-shadow: none;
}

.footer-tip {
  font-size: 22rpx;
  color: #9ca3af;
  margin-top: 40rpx;
  text-align: center;
}

.doc-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 300;
  background: rgba(17, 24, 39, 0.48);
  display: flex;
  align-items: flex-end;
}

.doc-panel {
  width: 100%;
  max-height: 82vh;
  background: #fff;
  border-radius: 28rpx 28rpx 0 0;
  display: flex;
  flex-direction: column;
}

.doc-header {
  height: 104rpx;
  padding: 0 32rpx;
  border-bottom: 1rpx solid #eef2f7;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.doc-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #111827;
}

.doc-close {
  width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.doc-body {
  max-height: 58vh;
  padding: 12rpx 32rpx 24rpx;
  box-sizing: border-box;
}

.doc-section {
  padding: 20rpx 0;
}

.doc-section-title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: #111827;
  margin-bottom: 10rpx;
}

.doc-section-text {
  display: block;
  font-size: 25rpx;
  line-height: 1.75;
  color: #4b5563;
}

.doc-footer {
  padding: 20rpx 32rpx 40rpx;
  border-top: 1rpx solid #eef2f7;
  flex-shrink: 0;
}

.doc-confirm {
  height: 88rpx;
  border-radius: 16rpx;
  background: #2563eb;
  color: #fff;
  font-size: 30rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
