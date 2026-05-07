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
  const header = { 'Content-Type': 'application/json' }
  if (withToken && userStore.token) {
    header['Cookie'] = userStore.token
    // 后端 authHelper 要求此头与 session 中的 id 匹配
    const userId = userStore.userInfo?.id
    if (userId !== undefined && userId !== null) {
      header['New-Api-User'] = String(userId)
    }
  }
  return header
}

/**
 * 核心请求方法
 * 成功时 resolve(data.data)，不存在 data.data 时 resolve(data)
 * 失败时 reject(Error)，并视情况 toast 或跳登录
 */
function request(url, method, data, withToken = true, customHeader = {}) {
  return new Promise((resolve, reject) => {
    const header = {
      ...buildHeader(withToken),
      ...(customHeader || {}),
    }
    uni.request({
      url: BASE_URL + url,
      method: method.toUpperCase(),
      data: data || undefined,
      header,
      success(res) {
        const { statusCode, data: body } = res

        // HTTP 层 401
        if (statusCode === 401) {
          redirectToLogin()
          return reject(new Error('未授权，请重新登录'))
        }

        if (!body) {
          showError('响应数据为空')
          return reject(new Error('Empty response'))
        }

        // 业务层失败
        if (body.success === false) {
          const msg = body.message || '请求失败'
          // 登录态失效判断
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

        // 业务层成功
        const result = body.data !== undefined ? body.data : body
        resolve(result)
      },
      fail(err) {
        showError('网络连接失败，请检查网络')
        reject(err)
      },
    })
  })
}

/**
 * 从 Set-Cookie 响应头中提取 name=value 部分
 * 例: "session=xxxx; Path=/; HttpOnly" → "session=xxxx"
 */
function extractCookie(rawCookie) {
  if (!rawCookie) return ''
  // 微信小程序有时返回数组，有时返回字符串
  const str = Array.isArray(rawCookie) ? rawCookie[0] : rawCookie
  return (str || '').split(';')[0].trim()
}

export default {
  get(url, params, withToken = true) {
    // GET 请求将 params 对象拼到 URL query
    let fullUrl = url
    if (params && Object.keys(params).length > 0) {
      const qs = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
      if (qs) fullUrl += (url.includes('?') ? '&' : '?') + qs
    }
    return request(fullUrl, 'GET', null, withToken)
  },

  post(url, data, withToken = true) {
    return request(url, 'POST', data, withToken)
  },

  postRaw(url, data, header = {}, withToken = true) {
    return request(url, 'POST', data, withToken, header)
  },

  extractCookie,
}
