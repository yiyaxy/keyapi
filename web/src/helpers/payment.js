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
