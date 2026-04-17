import React, { useEffect, useState } from 'react';
import {
  Card, Button, Banner, Typography, Space, Toast,
  Input, TextArea, Switch,
} from '@douyinfe/semi-ui';
import {
  getTenantPaymentConfigs,
  updateWechatConfig,
  testWechatConfig,
  deleteWechatConfig,
} from '../../helpers/payment';

const { Title, Text } = Typography;

// Row renders a single labeled field; plain flex to keep state fully
// controlled by the parent (avoids Semi UI Form's internal state which
// ignores post-mount value changes and only honors initValue).
function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 16 }}>
      <div style={{ width: 180, paddingTop: 6, flexShrink: 0 }}>
        <Text>{label}</Text>
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

export default function WechatConfig() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({
    enabled: false,
    app_id: '',
    mchid: '',
    serial_no: '',
    app_secret: '',
    apiv3_key: '',
    private_key: '',
  });

  const load = async () => {
    setLoading(true);
    try {
      const data = await getTenantPaymentConfigs();
      const list = data?.data || [];
      const wechat = list.find((c) => c.provider === 'wechat') || null;
      setCfg(wechat);
      if (wechat) {
        setForm({
          enabled: wechat.enabled,
          app_id: wechat.app_id,
          mchid: wechat.mchid,
          serial_no: wechat.serial_no,
          // Secrets: always start empty, user fills only if replacing.
          app_secret: '',
          apiv3_key: '',
          private_key: '',
        });
      }
    } catch (e) {
      Toast.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const onSave = async () => {
    setSaving(true);
    try {
      const res = await updateWechatConfig(form);
      if (res?.success) {
        Toast.success('保存成功');
        await load();
      } else {
        Toast.error(res?.message || '保存失败');
      }
    } catch (e) {
      Toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    setTesting(true);
    try {
      const res = await testWechatConfig();
      if (res?.success) {
        Toast.success('连接成功');
      } else {
        Toast.error(res?.message || '连接失败');
      }
      await load();
    } catch (e) {
      Toast.error(String(e));
    } finally {
      setTesting(false);
    }
  };

  const onDelete = async () => {
    if (!window.confirm('确认清除微信支付配置？')) return;
    try {
      const res = await deleteWechatConfig();
      if (res?.success) {
        Toast.success('已清除');
      } else {
        Toast.error(res?.message || '清除失败');
      }
      await load();
    } catch (e) {
      Toast.error(String(e));
    }
  };

  if (loading) return <Card loading />;

  const locked = cfg?.platform_locked;
  const inputsDisabled = locked || saving || testing;
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Card>
      <Title heading={5} style={{ marginBottom: 16 }}>微信支付（WeChat Pay v3）</Title>

      {locked && (
        <Banner
          type="danger"
          description="平台管理员已禁用该租户的支付能力"
          style={{ marginBottom: 16 }}
        />
      )}
      {cfg?.last_test_at > 0 && !cfg.last_test_ok && (
        <Banner
          type="warning"
          description={`上次凭据测试失败：${cfg.last_test_error || '未知原因'}`}
          style={{ marginBottom: 16 }}
        />
      )}

      <Row label="启用">
        <Switch
          checked={form.enabled}
          onChange={set('enabled')}
          disabled={inputsDisabled}
        />
      </Row>
      <Row label="AppID">
        <Input
          value={form.app_id}
          onChange={set('app_id')}
          placeholder="wx1234567890abcdef"
          disabled={inputsDisabled}
        />
      </Row>
      <Row label="商户号 MCHID">
        <Input
          value={form.mchid}
          onChange={set('mchid')}
          placeholder="1700000000"
          disabled={inputsDisabled}
        />
      </Row>
      <Row label="商户 API 证书序列号">
        <Input
          value={form.serial_no}
          onChange={set('serial_no')}
          disabled={inputsDisabled}
        />
      </Row>
      <Row label="AppSecret（小程序）">
        <Input
          mode="password"
          value={form.app_secret}
          onChange={set('app_secret')}
          placeholder={cfg?.app_secret_set ? '已设置（留空表示不修改）' : '请输入'}
          disabled={inputsDisabled}
        />
      </Row>
      <Row label="APIv3 密钥">
        <Input
          mode="password"
          value={form.apiv3_key}
          onChange={set('apiv3_key')}
          placeholder={cfg?.apiv3_key_set ? '已设置（留空表示不修改）' : '请输入（32 字节）'}
          disabled={inputsDisabled}
        />
      </Row>
      <Row label="商户 API 证书私钥 PEM">
        <TextArea
          value={form.private_key}
          onChange={set('private_key')}
          rows={8}
          placeholder={cfg?.private_key_set
            ? '已设置（留空表示不修改）'
            : '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'}
          disabled={inputsDisabled}
        />
      </Row>

      <Space style={{ marginTop: 24 }}>
        <Button theme="solid" loading={saving} onClick={onSave} disabled={locked}>
          保存
        </Button>
        <Button loading={testing} onClick={onTest} disabled={locked || !cfg}>
          测试连接
        </Button>
        <Button type="danger" onClick={onDelete} disabled={locked || !cfg}>
          清除配置
        </Button>
      </Space>
    </Card>
  );
}
