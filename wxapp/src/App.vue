<script>
import { userStore } from '@/store/user.js'
import { getStatus } from '@/services/api.js'
import { captureInviteSource, registerShareMenu } from '@/utils/share.js'

const updateManager = uni.getUpdateManager()
const startupSafePage = '/pages/home/index'
const paymentPageRoute = 'pages/redeem/index'

function normalizeRoute(route) {
  return String(route || '').replace(/^\/+/, '').split('?')[0]
}

export default {
  onLaunch(options) {
    captureInviteSource(options)
    registerShareMenu()
    // 恢复登录态
    userStore.loadToken()
    // 获取系统配置（quota_per_unit 等）
    this.loadStatus()
    // 检查小程序更新
    this.checkUpdate()
    this.redirectPaymentStartup(options)
  },
  onShow(options) {
    captureInviteSource(options)
  },
  onHide() {},
  methods: {
    async loadStatus() {
      try {
        const data = await getStatus()
        if (data) {
          userStore.applyStatus(data)
        }
      } catch (e) {
        // 忽略，使用默认值
      }
    },
    redirectPaymentStartup(options = {}) {
      if (normalizeRoute(options.path) !== paymentPageRoute) return
      setTimeout(() => {
        const pages = getCurrentPages()
        const currentRoute = normalizeRoute(pages[pages.length - 1]?.route)
        if (currentRoute === paymentPageRoute) {
          uni.reLaunch({ url: startupSafePage })
        }
      }, 0)
    },
    checkUpdate() {
      updateManager.onCheckForUpdate(function(res) {
        console.log('Has update:', res.hasUpdate)
      })
      updateManager.onUpdateReady(function() {
        uni.showModal({
          title: '更新提示',
          content: '新版本已经准备好，是否重启应用？',
          success(res) {
            if (res.confirm) updateManager.applyUpdate()
          },
        })
      })
      updateManager.onUpdateFailed(function() {
        uni.showModal({
          title: '已有新版本',
          content: '请删除当前小程序后重新搜索打开',
          showCancel: false,
        })
      })
    },
  },
}
</script>

<style lang="scss">
@import './common/uni.css';
@import 'uview-plus/index.scss';

page {
  background-color: #faf7f0;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif;
  color: #1a1a2e;
}

/* 通用工具类 */
.overflow {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 浅色卡片 */
.glass-card {
  background: #ffffff;
  border: 1rpx solid rgba(0, 0, 0, 0.05);
  border-radius: 24rpx;
  box-shadow: 0 4rpx 16rpx rgba(20, 16, 8, 0.04);
}
.glass-card-glow {
  background: #ffffff;
  border: 1rpx solid rgba(255, 184, 74, 0.3);
  border-radius: 24rpx;
  box-shadow: 0 8rpx 28rpx rgba(255, 184, 74, 0.12);
}
</style>
