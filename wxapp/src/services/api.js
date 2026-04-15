import request from './request.js'

// Auth — no token needed
export const login = (data) => request.post('/api/user/login', data, false)

// User
export const getSelf = () => request.get('/api/user/self')
export const redeemCode = (key) => request.post('/api/user/topup', { key })
export const transferAff = (quota) => request.post('/api/user/aff_transfer', { quota })

// API Tokens
export const getTokens = () => request.get('/api/token/', { p: 1, size: 50 })
export const getTokenKey = (id) => request.post(`/api/token/${id}/key`, {})

// Usage Logs
export const getLogs = (p = 1, size = 20) => request.get('/api/log/self', { p, size, type: 2 })
export const getLogStat = () => request.get('/api/log/self/stat')

// Aff Transfer
export const getPendingAffQuota = () => request.get('/api/aff_transfer/pending_quota')
