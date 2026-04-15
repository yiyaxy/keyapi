import { reactive } from 'vue'

export const userStore = reactive({
  token: '',        // session cookie string
  userInfo: null,   // from /api/user/self
  isLoggedIn: false,

  setToken(val) {
    this.token = val
    this.isLoggedIn = !!val
    uni.setStorageSync('token', val)
  },

  loadToken() {
    this.token = uni.getStorageSync('token') || ''
    this.isLoggedIn = !!this.token
  },

  setUserInfo(info) {
    this.userInfo = info
  },

  clear() {
    this.token = ''
    this.userInfo = null
    this.isLoggedIn = false
    uni.removeStorageSync('token')
  }
})
