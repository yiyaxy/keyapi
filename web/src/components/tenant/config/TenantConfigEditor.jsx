import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card,
  Button,
  Input,
  Switch,
  Space,
  Banner,
  Tag,
  Typography,
  Popconfirm,
  Spin,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess } from '../../../helpers';
import {
  TENANT_CONFIG_KEY_METADATA,
  TENANT_CONFIG_GROUP_TITLES,
} from '../../../types/tenant';

const { TextArea } = Input;
const { Text } = Typography;

/**
 * Tenant configuration editor — grouped preset cards.
 *
 * Backend:
 *   GET /api/tenant/config       → [{ key, value, overridden }]
 *   PUT /api/tenant/config       body: { key, value }
 *   DELETE /api/tenant/config    body: { key }
 *
 * The flat key-value list has been replaced with 5 type-aware Cards
 * (brand / auth / features / billing / webhook). Each row tracks
 * a draft value so the Save button is disabled until the user edits it.
 */
export default function TenantConfigEditor() {
  const { t } = useTranslation();

  // Map<key, { value, overridden, draft, savingState }>
  const [state, setState] = useState({});
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState(null);
  const [resettingKey, setResettingKey] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/tenant/config');
      if (res?.data?.success) {
        const d = res.data.data;
        const next = {};
        if (Array.isArray(d)) {
          for (const item of d) {
            const value = typeof item.value === 'string' ? item.value : '';
            next[item.key] = {
              value,
              overridden: !!item.overridden,
              draft: value,
            };
          }
        } else if (d && typeof d === 'object') {
          // Tolerant fallback for legacy {key: value} shape.
          for (const [key, value] of Object.entries(d)) {
            const v =
              typeof value === 'string' ? value : JSON.stringify(value);
            next[key] = { value: v, overridden: false, draft: v };
          }
        }
        // Ensure every metadata key exists in state, even if backend hasn't
        // returned it yet (forward-compatible with Slice E webhook keys).
        for (const meta of TENANT_CONFIG_KEY_METADATA) {
          if (!(meta.key in next)) {
            next[meta.key] = { value: '', overridden: false, draft: '' };
          }
        }
        setState(next);
      } else {
        showError(res?.data?.message || t('加载配置失败'));
      }
    } catch (e) {
      showError(e?.message || t('加载配置失败'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const updateDraft = (key, draft) => {
    setState((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || { value: '', overridden: false }), draft },
    }));
  };

  const handleSave = async (key) => {
    const entry = state[key];
    if (!entry) return;
    setSavingKey(key);
    try {
      const res = await API.put('/api/tenant/config', {
        key,
        value: entry.draft ?? '',
      });
      if (res?.data?.success) {
        showSuccess(t('已保存'));
        await load();
      } else {
        showError(res?.data?.message || t('保存失败'));
      }
    } catch (e) {
      showError(e?.message || t('保存失败'));
    } finally {
      setSavingKey(null);
    }
  };

  const handleReset = async (key) => {
    setResettingKey(key);
    try {
      const res = await API.delete('/api/tenant/config', {
        data: { key },
      });
      if (res?.data?.success) {
        showSuccess(t('已重置为平台默认'));
        await load();
      } else {
        showError(res?.data?.message || t('重置失败'));
      }
    } catch (e) {
      showError(e?.message || t('重置失败'));
    } finally {
      setResettingKey(null);
    }
  };

  // Group metadata by group preserving original order.
  const groupedMeta = useMemo(() => {
    const map = new Map();
    for (const meta of TENANT_CONFIG_KEY_METADATA) {
      if (!map.has(meta.group)) map.set(meta.group, []);
      map.get(meta.group).push(meta);
    }
    return map;
  }, []);

  const renderControl = (meta, entry) => {
    const draft = entry?.draft ?? '';
    const onText = (v) => updateDraft(meta.key, v ?? '');
    switch (meta.type) {
      case 'bool': {
        const checked = draft === 'true';
        return (
          <Switch
            checked={checked}
            onChange={(v) => updateDraft(meta.key, v ? 'true' : 'false')}
          />
        );
      }
      case 'textarea':
        return (
          <TextArea
            autosize={{ minRows: 3, maxRows: 8 }}
            value={draft}
            placeholder={meta.placeholder}
            onChange={onText}
          />
        );
      case 'password':
        return (
          <Input
            mode='password'
            value={draft}
            placeholder={meta.placeholder}
            onChange={onText}
          />
        );
      case 'url':
        return (
          <Input
            value={draft}
            placeholder={meta.placeholder || 'https://...'}
            onChange={onText}
          />
        );
      case 'list':
        return (
          <Input
            value={draft}
            placeholder={meta.placeholder || t('使用英文逗号分隔')}
            onChange={onText}
          />
        );
      case 'string':
      default:
        return (
          <Input
            value={draft}
            placeholder={meta.placeholder}
            onChange={onText}
          />
        );
    }
  };

  const renderRow = (meta) => {
    const entry = state[meta.key] || {
      value: '',
      overridden: false,
      draft: '',
    };
    const dirty = (entry.draft ?? '') !== (entry.value ?? '');
    const saving = savingKey === meta.key;
    const resetting = resettingKey === meta.key;

    return (
      <div
        key={meta.key}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: '12px 0',
          borderBottom: '1px dashed var(--semi-color-border)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <Space>
            <Text strong>{t(meta.labelKey)}</Text>
            <Text type='tertiary' size='small'>
              {meta.key}
            </Text>
            {entry.overridden && (
              <Tag color='blue' size='small'>
                {t('租户覆盖中')}
              </Tag>
            )}
          </Space>
          <Space>
            <Button
              size='small'
              type='primary'
              theme='solid'
              disabled={!dirty || saving || resetting}
              loading={saving}
              onClick={() => handleSave(meta.key)}
            >
              {t('保存')}
            </Button>
            <Popconfirm
              title={t('确认重置为平台默认？')}
              onConfirm={() => handleReset(meta.key)}
            >
              <Button
                size='small'
                type='danger'
                disabled={!entry.overridden || saving || resetting}
                loading={resetting}
              >
                {t('重置为平台默认')}
              </Button>
            </Popconfirm>
          </Space>
        </div>
        <div>{renderControl(meta, entry)}</div>
        {meta.type === 'url' && meta.key === 'Logo' && entry.draft ? (
          <div style={{ marginTop: 4 }}>
            <Text type='tertiary' size='small'>
              {t('预览')}:
            </Text>{' '}
            <img
              src={entry.draft}
              alt='logo preview'
              style={{
                maxHeight: 32,
                verticalAlign: 'middle',
                marginLeft: 6,
              }}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
        ) : null}
      </div>
    );
  };

  const groupOrder = ['brand', 'auth', 'features', 'billing', 'webhook'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Banner
        type='info'
        description={t(
          '在此编辑的配置项仅对当前租户生效，覆盖平台默认值。重置后恢复平台默认。',
        )}
      />
      <Spin spinning={loading}>
        {groupOrder.map((groupKey) => {
          const items = groupedMeta.get(groupKey) || [];
          if (items.length === 0) return null;
          return (
            <Card
              key={groupKey}
              title={t(TENANT_CONFIG_GROUP_TITLES[groupKey])}
              style={{ marginBottom: 16 }}
            >
              {items.map(renderRow)}
            </Card>
          );
        })}
      </Spin>
    </div>
  );
}
