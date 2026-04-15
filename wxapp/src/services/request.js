import env from '@/config/env.js'
import { userStore } from '@/store/user.js'

const BASE_URL = env.basePath

function showError(msg) {
  uni.showToast({
    title: msg || '网络异常',
    icon: 'none',
    duration: 2500,
  })
}

function redirectToLogin() {
  userStore.clear()
  uni.reLaunch({ url: '/pages/login/index' })
}

function buildHeader(withToken = true) {
  const header = {
    'Content-Type': 'application/json',
  }
  if (withToken && userStore.token) {
    header['Cookie'] = userStore.token
  }
  return header
}

function handleResponse(res, resolve, reject) {
  const { statusCode, data } = res

  if (statusCode === 401) {
    redirectToLogin()
    return reject(new Error('Unauthorized'))
  }

  if (!data) {
    showError('响应数据为空')
    return reject(new Error('Empty response'))
  }

  if (data.success === false) {
    const msg = data.message || '请求失败'
    // auth-related failure messages
    if (
      msg.includes('登录') ||
      msg.includes('未授权') ||
      msg.includes('token') ||
      msg.includes('session') ||
      statusCode === 401
    ) {
      redirectToLogin()
    } else {
      showError(msg)
    }
    return reject(new Error(msg))
  }

  return resolve(data.data !== undefined ? data.data : data)
}

function request(url, method, data, withToken = true) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: BASE_URL + url,
      method: method.toUpperCase(),
      data: data,
      header: buildHeader(withToken),
      success(res) {
        handleResponse(res, resolve, reject)
      },
      fail(err) {
        showError('网络连接失败')
        reject(err)
      },
    })
  })
}

export default {
  /**
   * GET request
   * @param {string} url
   * @param {object} params - query params (passed as data for GET)
   * @param {boolean} withToken
   */
  get(url, params, withToken = true) {
    return request(url, 'GET', params, withToken)
  },

  /**
   * POST request with JSON body
   * @param {string} url
   * @param {object} data
   * @param {boolean} withToken
   */
  post(url, data, withToken = true) {
    return request(url, 'POST', data, withToken)
  },

  /**
   * Extract session cookie from Set-Cookie header value
   * Returns only the name=value part (strips Path, HttpOnly, etc.)
   */
  extractCookie(rawCookie) {
    if (!rawCookie) return ''
    return rawCookie.split(';')[0].trim()
  },
}
