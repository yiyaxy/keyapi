import { reactive } from 'vue'

export const userStore = reactive({
  token: '',
  userInfo: null,
  isLoggedIn: false,

  // 以下字段全部来自 /api/status，与 PC 端保持一致
  quotaPerUnit: 500000,
  quotaDisplayType: 'USD',       // 'USD' | 'CNY' | 'CUSTOM' | 'TOKENS'
  usdExchangeRate: 1,            // CNY 模式时的汇率
  customCurrencySymbol: '¤',
  customCurrencyRate: 1,

  /** 登录后保存 cookie */
  setToken(val) {
    this.token = val || ''
    this.isLoggedIn = !!this.token
    uni.setStorageSync('session_token', this.token)
  },

  /** App 启动时从本地存储恢复 */
  loadToken() {
    this.token = uni.getStorageSync('session_token') || ''
    this.isLoggedIn = !!this.token
    // 恢复缓存的用户信息（含 id，用于 New-Api-User 请求头）
    const u = uni.getStorageSync('user_info')
    if (u) { try { this.userInfo = JSON.parse(u) } catch {} }
    // 恢复 status 配置
    const s = uni.getStorageSync('api_status')
    if (s) { try { this.applyStatus(JSON.parse(s)) } catch {} }
  },

  /** 更新用户信息并持久化 */
  setUserInfo(info) {
    this.userInfo = info
    if (info) uni.setStorageSync('user_info', JSON.stringify(info))
  },

  /**
   * 从 /api/status 响应中提取并保存所有展示配置
   * 与 PC 端 setStatusData 逻辑对应
   */
  applyStatus(data) {
    if (!data) return
    if (data.quota_per_unit)           this.quotaPerUnit           = Number(data.quota_per_unit) || 500000
    if (data.quota_display_type)       this.quotaDisplayType       = data.quota_display_type
    if (data.usd_exchange_rate)        this.usdExchangeRate        = Number(data.usd_exchange_rate) || 1
    if (data.custom_currency_symbol)   this.customCurrencySymbol   = data.custom_currency_symbol
    if (data.custom_currency_exchange_rate) {
      this.customCurrencyRate = Number(data.custom_currency_exchange_rate) || 1
    }
    uni.setStorageSync('api_status', JSON.stringify(data))
  },

  /** 退出登录，清除所有状态 */
  clear() {
    this.token = ''
    this.userInfo = null
    this.isLoggedIn = false
    uni.removeStorageSync('session_token')
    uni.removeStorageSync('user_info')
  },
})
