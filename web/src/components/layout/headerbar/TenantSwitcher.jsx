import React, { useCallback, useEffect, useState } from 'react';
import { Dropdown, Button, Typography, Spin } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess, updateAPI } from '../../../helpers';

/**
 * 租户切换器：显示当前租户名 + 下拉列出用户可访问的所有租户。
 * 切换成功后会刷新页面让所有数据重新拉取。
 *
 * 对于只有一个租户的用户直接隐藏（不占 header 空间）。
 */
export default function TenantSwitcher() {
  const { t } = useTranslation();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(false);

  const currentTenantId = (() => {
    try {
      const raw = localStorage.getItem('user');
      if (!raw) return null;
      const u = JSON.parse(raw);
      return u?.tenant_id ?? null;
    } catch (e) {
      return null;
    }
  })();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/user/tenants');
      if (res?.data?.success) setTenants(res.data.data || []);
    } catch (e) {
      // ignore — 未登录时忽略
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSwitch = async (tenantId) => {
    if (tenantId === currentTenantId) return;
    try {
      const res = await API.post('/api/user/tenant/switch', { tenant_id: tenantId });
      if (res?.data?.success) {
        // 更新 localStorage.user 中的 tenant_id 等字段
        try {
          const raw = localStorage.getItem('user');
          if (raw) {
            const u = JSON.parse(raw);
            u.tenant_id = res.data.data?.tenant_id;
            u.tenant_role = res.data.data?.tenant_role;
            u.role = res.data.data?.role;
            localStorage.setItem('user', JSON.stringify(u));
          }
        } catch (e) {
          // ignore
        }
        updateAPI();
        showSuccess(t('已切换到租户：{{name}}', { name: res.data.data?.tenant_name || '' }));
        // 刷新页面以让所有 API 调用走新租户
        window.location.reload();
      } else {
        showError(res?.data?.message || t('切换失败'));
      }
    } catch (e) {
      showError(e?.message || t('切换失败'));
    }
  };

  if (loading && tenants.length === 0) return <Spin size='small' />;
  if (!tenants || tenants.length <= 1) return null; // 只有一个租户就不显示切换器

  const current = tenants.find((x) => x.tenant_id === currentTenantId) || tenants[0];

  const menu = (
    <Dropdown.Menu>
      {tenants.map((tt) => (
        <Dropdown.Item
          key={tt.tenant_id}
          active={tt.tenant_id === currentTenantId}
          onClick={() => handleSwitch(tt.tenant_id)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 160 }}>
            <span>{tt.tenant_name}</span>
            <Typography.Text type='tertiary' size='small'>
              {tt.tenant_slug}
              {tt.tenant_role === 10 ? ` · ${t('管理员')}` : ''}
            </Typography.Text>
          </div>
        </Dropdown.Item>
      ))}
    </Dropdown.Menu>
  );

  return (
    <Dropdown trigger='click' render={menu}>
      <Button size='small'>
        {t('租户')}: {current?.tenant_name || t('未知')}
      </Button>
    </Dropdown>
  );
}
