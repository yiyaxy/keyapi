/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Select, Spin } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess, updateAPI } from '../../../helpers';

const RECENT_STORAGE_KEY = 'keyapi.recentTenantIds';
const RECENT_MAX = 3;

function readCurrentTenantId() {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    const u = JSON.parse(raw);
    return u?.tenant_id ?? null;
  } catch {
    return null;
  }
}

function readRecentIds() {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pushRecentId(tenantId) {
  const prev = readRecentIds().filter((id) => id !== tenantId);
  const next = [tenantId, ...prev].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export default function TenantSwitcher() {
  const { t } = useTranslation();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(false);

  const currentTenantId = readCurrentTenantId();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/user/tenants');
      if (res?.data?.success) setTenants(res.data.data || []);
    } catch {
      // ignore — unauthenticated or network error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleChange = async (value) => {
    if (value === '__recent__' || value === '__all__') return;
    if (value === currentTenantId) return;
    try {
      const res = await API.post('/api/user/tenant/switch', {
        tenant_id: value,
      });
      if (res?.data?.success) {
        // Persist updated fields into localStorage user payload
        try {
          const raw = localStorage.getItem('user');
          if (raw) {
            const u = JSON.parse(raw);
            u.tenant_id = res.data.data?.tenant_id;
            u.tenant_role = res.data.data?.tenant_role;
            u.role = res.data.data?.role;
            localStorage.setItem('user', JSON.stringify(u));
          }
        } catch {
          /* ignore */
        }
        pushRecentId(value);
        updateAPI();
        showSuccess(
          t('已切换到租户：{{name}}', {
            name: res.data.data?.tenant_name || '',
          }),
        );
        window.location.reload();
      } else {
        showError(res?.data?.message || t('切换失败'));
      }
    } catch (e) {
      showError(e?.message || t('切换失败'));
    }
  };

  const options = useMemo(() => {
    if (!tenants.length) return [];

    const recentIds = readRecentIds().slice(0, RECENT_MAX);
    const recentSet = new Set(recentIds);
    const recent = recentIds
      .map((id) => tenants.find((tnt) => tnt.tenant_id === id))
      .filter(Boolean);
    const rest = tenants.filter((tnt) => !recentSet.has(tnt.tenant_id));

    const opts = [];
    if (recent.length) {
      opts.push({
        label: t('header.tenantSwitcher.recent'),
        value: '__recent__',
        disabled: true,
      });
      opts.push(
        ...recent.map((x) => ({
          label: x.tenant_name,
          value: x.tenant_id,
        })),
      );
    }
    if (rest.length) {
      opts.push({
        label: t('header.tenantSwitcher.all'),
        value: '__all__',
        disabled: true,
      });
      opts.push(
        ...rest.map((x) => ({
          label: x.tenant_name,
          value: x.tenant_id,
        })),
      );
    }
    return opts;
  }, [tenants, t]);

  if (loading && tenants.length === 0) return <Spin size='small' />;
  if (!Array.isArray(tenants) || tenants.length < 2) return null;

  return (
    <Select
      value={currentTenantId}
      onChange={handleChange}
      placeholder={t('header.tenantSwitcher.placeholder')}
      optionList={options}
      filter
      style={{ minWidth: 160 }}
      size='default'
      aria-label={t('header.tenantSwitcher.placeholder')}
    />
  );
}
