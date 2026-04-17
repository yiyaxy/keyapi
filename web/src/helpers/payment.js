import { API } from './api';

export async function getTenantPaymentConfigs() {
  const res = await API.get('/api/tenant/payment/configs');
  return res.data;
}

export async function updateWechatConfig(payload) {
  const res = await API.put('/api/tenant/payment/configs/wechat', payload);
  return res.data;
}

export async function testWechatConfig() {
  const res = await API.post('/api/tenant/payment/configs/wechat/test');
  return res.data;
}

export async function deleteWechatConfig() {
  const res = await API.delete('/api/tenant/payment/configs/wechat');
  return res.data;
}

// ---------- S2 Ordering & Query ----------

export async function createWechatTopup(productForm, payload) {
  // productForm: 'native' | 'h5' | 'jsapi'
  const res = await API.post(`/api/payment/wechat/topup/${productForm}`, payload);
  return res.data;
}

export async function createWechatSub(productForm, payload) {
  // NOTE: sub lives under the tenant-admin scope, so URL prefix is
  // /api/tenant/payment/... (NOT /api/payment/... like topup). This is
  // because tenantRoute is the gin group with tenant-admin auth.
  const res = await API.post(`/api/tenant/payment/wechat/sub/${productForm}`, payload);
  return res.data;
}

export async function getPaymentOrder(outTradeNo) {
  const res = await API.get(`/api/payment/orders/${encodeURIComponent(outTradeNo)}`);
  return res.data;
}

export async function listTenantPaymentOrders(params = {}) {
  const res = await API.get('/api/tenant/payment/orders', { params });
  return res.data;
}
