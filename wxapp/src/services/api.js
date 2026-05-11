/**
 * new-api 接口封装
 * 所有方法返回 Promise，resolve 时返回 data 字段内容
 */
import request from './request.js'

// ─── 系统 ───────────────────────────────────────────────
/** 获取系统状态（含 quota_per_unit、system_name 等） */
export const getStatus = () => request.get('/api/status', null, false)

// ─── 认证 ───────────────────────────────────────────────
/**
 * 账号密码登录
 * 注意：登录页需直接用 uni.request 才能获取 Set-Cookie 响应头，
 * 此方法仅作补充，实际登录在页面内处理。
 */
export const login = (username, password) =>
  request.post('/api/user/login', { username, password }, false)

// ─── 用户 ───────────────────────────────────────────────
/**
 * 获取当前用户信息
 * 返回字段：id, username, display_name, quota, used_quota, request_count,
 *           aff_code, aff_count, aff_quota, aff_history_quota, status
 */
export const getSelf = () => request.get('/api/user/self')

/**
 * 兑换码充值
 * @param {string} key 兑换码
 * 成功时 data 为充值的额度数值
 */
export const redeemCode = (key) => request.post('/api/user/topup', { key })

// ─── 签到 ───────────────────────────────────────────────
export const getCheckinStatus = (month) =>
  request.get('/api/user/checkin', month ? { month } : undefined)

export const doCheckin = () => request.post('/api/user/checkin', {})

// ─── 日志统计 ───────────────────────────────────────────
/**
 * 获取指定时间范围内的用量统计
 * @param {number} startTs Unix 时间戳（秒）
 * @param {number} endTs   Unix 时间戳（秒）
 * 返回字段：quota（消费额度）, token（token 数量）
 */
export const getLogStat = (startTs, endTs) =>
  request.get('/api/log/self/stat', {
    type: 2,           // 2=消费日志
    start_timestamp: startTs,
    end_timestamp: endTs,
    token_name: '',
    model_name: '',
    group: '',
  })

/**
 * 获取今日统计
 */
export const getTodayStat = () => {
  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  return getLogStat(
    Math.floor(start.getTime() / 1000),
    Math.floor(end.getTime() / 1000),
  )
}

/**
 * 获取本月统计
 */
export const getMonthStat = () => {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
  return getLogStat(
    Math.floor(start.getTime() / 1000),
    Math.floor(end.getTime() / 1000),
  )
}

// ─── 消费记录 ───────────────────────────────────────────
/**
 * 获取消费记录列表
 * @param {number} p         页码（从 1 开始）
 * @param {number} pageSize  每页条数
 * 返回字段：page, page_size, total, items[]
 * items 字段：id, created_at(Unix秒), type, model_name,
 *             prompt_tokens, completion_tokens, quota, token_name
 *
 * 注意：路径末尾需要有斜杠 /api/log/self/
 */
export const getLogs = (p = 1, pageSize = 20) =>
  request.get('/api/log/self/', {
    p,
    page_size: pageSize,
    type: 2,             // 只查消费日志
    token_name: '',
    model_name: '',
    start_timestamp: '',
    end_timestamp: '',
    group: '',
    request_id: '',
  })

// ─── API Token ─────────────────────────────────────────
/**
 * 获取 Token 列表
 * 注意参数是 size 不是 page_size
 * 返回字段：page, page_size, total, items[]
 * items 字段：id, name, status(1启用/2禁用), key(掩码), remain_quota,
 *             used_quota, request_count, created_at(Unix秒)
 */
export const getTokens = (p = 1, size = 50) =>
  request.get('/api/token/', { p, size })

/**
 * 创建 Token
 * @param {object} payload
 * @param {string} payload.name Key 名称
 * @param {boolean} payload.unlimited_quota 是否无限额度
 * @param {number} payload.remain_quota 限额模式下的额度
 * @param {number} payload.expired_time 过期时间 Unix 秒，-1 表示永不过期
 */
export const createToken = (payload = {}) =>
  request.post('/api/token/', {
    name: payload.name || '小程序 Key',
    group: payload.group || '',
    cross_group_retry: payload.cross_group_retry ?? false,
    unlimited_quota: payload.unlimited_quota ?? true,
    remain_quota: payload.remain_quota ?? 0,
    expired_time: payload.expired_time ?? -1,
    enable_image_gen: payload.enable_image_gen ?? true,
  })

/**
 * 获取 Token 完整 key
 * @param {number} id token id
 * 返回字段：key（完整 key，前端显示时通常需要加 sk- 前缀）
 */
export const getTokenKey = (id) =>
  request.post(`/api/token/${id}/key`, {})

// ─── 邀请 / 返利 ────────────────────────────────────────
/**
 * 提交邀请奖励转换申请（创建待审核记录）
 * @param {number} quota 申请转换的额度数值
 * 服务端会将 aff_quota 减少并创建 pending 记录等待管理员审核
 */
export const transferAff = (quota) =>
  request.post('/api/aff_transfer/', { quota })

/**
 * 获取自己的转换记录列表
 * 返回字段：page, page_size, total, items[]
 * items 字段：id, quota, status(1待审/2通过/3拒绝), created_at, admin_remark
 */
export const getAffTransferHistory = (p = 1, size = 20) =>
  request.get('/api/aff_transfer/self', { p, size })

export const getInvitees = (p = 1, size = 20) =>
  request.get('/api/user/aff/invitees', { p, page_size: size })

export const bindInviteCode = (affCode) =>
  request.post('/api/user/aff/bind', { aff_code: affCode })

// ─── 微信支付充值 ───────────────────────────────────────
export const getTopupPreview = (amount) =>
  request.post('/api/user/topup/preview', { amount })

/**
 * 发起微信小程序 JSAPI 充值下单
 * @param {number} amount 充值金额（与 PC 端一致：显示单位，USD/CNY/TOKENS 模式自动换算）
 * 返回字段：
 *   order:    { out_trade_no, amount }  // amount 单位：分
 *   response: { prepay_id, package, nonce_str, timestamp, sign_type, pay_sign }
 *   —— response 里的字段直接喂给 uni.requestPayment
 * 说明：openid 由后端从 session 用户的 wechat_id 里解析，客户端无需传
 */
export const createWechatTopupJsapi = (amount) =>
  request.post('/api/payment/wechat/topup/jsapi', { amount })

export const getWxminiTopupTiers = (platform = 'android') =>
  request.get('/api/payment/wxmini/topup/tiers', { platform })

export const createWxminiTopupXpay = (tierCode, platform = 'android') =>
  request.post('/api/payment/wxmini/topup/xpay', {
    tier_code: tierCode,
    platform,
  })

export const requestWxminiVirtualPayment = (xpayResponse) =>
  new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || typeof wx.requestVirtualPayment !== 'function') {
      reject(new Error('wx.requestVirtualPayment is not available'))
      return
    }
    wx.requestVirtualPayment({
      mode: xpayResponse.mode || 'short_series_goods',
      signData: xpayResponse.sign_data,
      paySig: xpayResponse.pay_sig,
      signature: xpayResponse.signature,
      success: resolve,
      fail: (err) => reject(new Error(err?.errMsg || '支付失败')),
    })
  })

/**
 * 查询支付订单状态
 * @param {string} outTradeNo 订单号
 * 返回字段：id, out_trade_no, status(pending/paid/closed/expired/...),
 *            amount, paid_at, ...
 */
export const getPaymentOrder = (outTradeNo) =>
  request.get(`/api/payment/orders/${outTradeNo}`)

/**
 * 获取当前用户的支付订单列表（订单中心）
 * @param {number} page      页码（从 1 开始）
 * @param {number} pageSize  每页条数
 * @param {string} [orderType] 可选过滤：topup | sub
 * 返回字段：items[], total, page, page_size
 * items 字段：id, out_trade_no, provider, order_type, product_form,
 *             amount(分), currency, status, paid_at, expires_at, created_at
 */
export const getMyOrders = (page = 1, pageSize = 20, orderType = '') => {
  const params = { page, page_size: pageSize }
  if (orderType) params.order_type = orderType
  return request.get('/api/payment/orders', params)
}

// AI 应用广场
export const getPublicApps = () => request.get('/api/app', null, false)

export const getAppSessionToken = (slug) =>
  request.post(`/api/app/${encodeURIComponent(slug)}/session`, {})

export const getAppGuestToken = (slug) =>
  request.post(`/api/app/${encodeURIComponent(slug)}/guest-session`, {}, false)

export const getPricingModels = () => request.get('/api/pricing', null, false)

function normalizeBearerToken(token) {
  const value = String(token || '').trim()
  if (!value) return ''
  return value.startsWith('sk-') ? value : `sk-${value}`
}

export const createMobileChatCompletion = ({ model, messages, token, tenantId }) => {
  const bearerToken = normalizeBearerToken(token)
  if (!bearerToken) return Promise.reject(new Error('未获取到 AI 对话应用访问令牌'))
  const headers = {
    Authorization: `Bearer ${bearerToken}`,
  }
  if (tenantId !== undefined && tenantId !== null && tenantId !== '') {
    headers['X-Tenant-Id'] = String(tenantId)
  }
  return request.postRaw('/v1/chat/completions', {
    model,
    messages,
    stream: false,
  }, headers, false)
}

function utf8Bytes(value) {
  const text = String(value)
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text)
  const encoded = unescape(encodeURIComponent(text))
  const bytes = new Uint8Array(encoded.length)
  for (let index = 0; index < encoded.length; index += 1) {
    bytes[index] = encoded.charCodeAt(index)
  }
  return bytes
}

function toBytes(data) {
  if (typeof Uint8Array !== 'undefined' && data instanceof Uint8Array) return data
  if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) return new Uint8Array(data)
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView?.(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  return utf8Bytes(data || '')
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  parts.forEach((part) => {
    merged.set(part, offset)
    offset += part.byteLength
  })
  return merged.buffer
}

function multipartFilename(value, fallback) {
  return String(value || fallback || 'image.jpg').replace(/["\r\n]/g, '_')
}

function buildImageUploadBody(files) {
  const boundary = `----new-api-app-image-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const parts = []
  ;(files || []).forEach((file, index) => {
    const filename = multipartFilename(file.filename || file.name, `reference-${index + 1}.jpg`)
    const contentType = file.contentType || 'image/jpeg'
    parts.push(
      utf8Bytes(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="files"; filename="${filename}"\r\n` +
          `Content-Type: ${contentType}\r\n\r\n`
      )
    )
    parts.push(toBytes(file.data))
    parts.push(utf8Bytes('\r\n'))
  })
  parts.push(utf8Bytes(`--${boundary}--\r\n`))
  return {
    body: concatBytes(parts),
    boundary,
  }
}

export const uploadAppImages = (files) => {
  const { body, boundary } = buildImageUploadBody(files)
  return request.postRaw(
    '/api/app/image-uploads',
    body,
    {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    true
  )
}

export const createMobileImageGeneration = ({ model, prompt, images = [], size = '1024x1024' }) => {
  const imageUrls = Array.isArray(images) ? images.filter(Boolean).slice(0, 16) : []
  const body = {
    model,
    prompt,
    size,
    n: 1,
    response_format: 'url',
    output_format: 'png',
    quality: 'medium',
  }
  if (imageUrls.length > 0) {
    body.image = imageUrls[0]
    body.images = imageUrls
  }
  return request.post('/pg/images/async', body)
}

export const getMobileImageTask = (taskId) =>
  request.get(`/pg/images/async/${encodeURIComponent(taskId)}`)
