import { useState, useCallback, useEffect } from 'react';
import { API, showError, showSuccess } from '../../../helpers';

/**
 * 当前租户信息的 fetch/update hook。
 * GET  /api/tenant/info  → { success, data: Tenant }
 * PUT  /api/tenant/       → { success, data: Tenant }
 */
export function useTenantInfo() {
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/tenant/info');
      if (res?.data?.success) {
        setTenant(res.data.data);
      } else {
        showError(res?.data?.message || '加载租户信息失败');
      }
    } catch (err) {
      showError(err?.message || '加载租户信息失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const update = useCallback(async ({ name, status }) => {
    setSubmitting(true);
    try {
      const payload = {};
      if (typeof name === 'string' && name.trim() !== '') payload.name = name.trim();
      if (typeof status === 'number' && status > 0) payload.status = status;
      const res = await API.put('/api/tenant/', payload);
      if (res?.data?.success) {
        setTenant(res.data.data);
        showSuccess('租户信息已更新');
        return true;
      }
      showError(res?.data?.message || '更新失败');
      return false;
    } catch (err) {
      showError(err?.message || '更新失败');
      return false;
    } finally {
      setSubmitting(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { tenant, loading, submitting, reload: load, update };
}
