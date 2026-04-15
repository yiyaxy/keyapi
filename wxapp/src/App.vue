<script>
import { userStore } from '@/store/user.js'

const updateManager = uni.getUpdateManager()

export default {
  onLaunch() {
    userStore.loadToken()
    this.checkUpdate()
  },
  onShow() {},
  onHide() {},
  methods: {
    checkUpdate() {
      updateManager.onCheckForUpdate(function(res) {
        console.log('Has update:', res.hasUpdate)
      })
      updateManager.onUpdateReady(function() {
        uni.showModal({
          title: '更新提示',
          content: '新版本已经准备好，请重启应用',
          success(res) {
            if (res.confirm) {
              updateManager.applyUpdate()
            }
          }
        })
      })
      updateManager.onUpdateFailed(function() {
        uni.showModal({
          title: '已有新版本',
          content: '新版本已上线，请删除当前小程序后重新搜索打开',
          showCancel: false
        })
      })
    }
  }
}
</script>

<style lang="scss">
/* 公共样式 */
@import './common/uni.css';
@import "uview-plus/index.scss";

page {
  background-color: #f5f5f7;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif;
}

.overflow {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overflow-2 {
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* Common card style */
.card {
  background: #fff;
  border-radius: 16rpx;
  padding: 32rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.06);
}
</style>
