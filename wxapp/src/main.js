import { createSSRApp } from "vue"
import App from "./App.vue"
import uviewPlus from 'uview-plus'
import { buildShareMessage, captureInviteSource } from '@/utils/share.js'

export function createApp() {
  const app = createSSRApp(App)
  app.use(uviewPlus)
  app.mixin({
    onLoad(options) {
      captureInviteSource(options)
    },
    onShareAppMessage() {
      return buildShareMessage()
    },
    onShareTimeline() {
      return buildShareMessage()
    },
  })
  uni.$u.config.unit = 'rpx'
  return { app }
}
