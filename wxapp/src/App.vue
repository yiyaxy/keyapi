<script>
import { userStore } from '@/store/user.js'
import { getStatus } from '@/services/api.js'
import { captureInviteSource, registerShareMenu } from '@/utils/share.js'

const updateManager = uni.getUpdateManager()

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
  background-color: #f5f5f7;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif;
  color: #1a1a2e;
}

/* 通用工具类 */
.overflow {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 通用卡片样式 */
.card {
  background: #fff;
  border-radius: 16rpx;
  padding: 32rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.06);
}
</style>
