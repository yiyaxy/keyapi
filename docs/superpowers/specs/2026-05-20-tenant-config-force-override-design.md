# 租户配置"固化为租户值"按钮设计

> 状态：草稿
> 日期：2026-05-20
> 影响范围：`web-next/` 前端，租户后台 `TenantConfig` 页面
> 后端：不动

## 1. 背景与问题

`controller/tenant/config.go:42` 通过 `service.GetConfig(tenantId, key, "")` 解析配置，该函数会**回落到平台 `OptionMap`**。因此租户后台展示的字段值即使没有租户级覆盖（`tenant_options` 表里没有这一行），也会显示出**平台默认值**，并附"平台默认"徽标。

而发邮件链路走 `service.GetTenantSMTPConfig` → `service/tenant_mail.go:46-54` 的 `getSMTPConfig`，**刻意不回落平台**（出于 SaaS 隔离需求，由 `TestGetTenantSMTPConfig_DoesNotUsePlatformFallbackForTenant` 锁定）。结果是租户看到 `smtp.qq.com`、`465`、`251052078@qq.com` 这些值"明明配着"，但发邮件时拿到空字符串：

```
dial tcp :465: connect: connection refused
```

前端 `web-next/src/components/settings/FieldRows.tsx:189-233` 的 `TextRow` 用 `dirty = draft !== initial` 控制保存按钮的 `disabled`。当用户想"把平台默认值固化为租户值"时，输入框里值跟显示值一字不差，按钮永远灰着，**没法保存**。`KvMapEditor`、`StringListEditor` 同病；`BoolRow`/`SelectRow` 是 onChange 即存，"原值固化"根本无路径触发。

## 2. 目标 / 非目标

**目标**：

- 在租户后台，对每个"未覆盖"（`overrideMeta.isOverridden === false`）的字段提供"固化为租户值"动作，把当前展示值原样写入 `tenant_options`。
- 不动后端、不动平台后台（`SettingsAdmin.tsx` 不传 `overrideMeta`，自动保持原有 dirty 行为）。

**非目标**：

- 不改后端"租户 SMTP 不回落平台"的隔离设计（这是 SaaS 安全保证）。
- 不重写 `TenantConfig` 的 fetch / 三层 fallback 逻辑。
- 不动 `SecretRow`——它本来就拿不到平台明文，"原值固化"无意义。

## 3. 设计

### 3.1 新概念

```ts
const canForceOverride = !!overrideMeta && !overrideMeta.isOverridden;
```

仅当组件由租户后台调用（传了 `overrideMeta`）、且当前未被覆盖时为真。平台后台 `SettingsAdmin.tsx` 不传 `overrideMeta`，`canForceOverride` 恒为 `false`，行为不变。

### 3.2 各控件改动

| 控件 | 改动 | 备注 |
|---|---|---|
| `TextRow` | 保存按钮 `disabled` 改为 `(!dirty && !canForceOverride) \|\| pending`；非 dirty 但 `canForceOverride` 时按钮文案换为 `action.force_override` | 主路径，命中 SMTPServer/Port/Account/From 等 |
| `BoolRow` | 在 `ResetButton` 旁加一个仅在 `canForceOverride` 时显示的小按钮"固化为租户值"，点击触发 `mutate({key, value})`（提交当前 value） | onChange 即存的开关无法走 dirty 路径，必须显式按钮 |
| `SelectRow` | 同 `BoolRow` | |
| `SecretRow` | **保持不变** | 你看不到平台明文，原值固化无意义 |
| `KvMapEditor` | 同 `TextRow`：保存按钮的 disabled 与文案同步切换；`save()` 内部不变（仍序列化当前 `rows`） | |
| `StringListEditor` | 同 `KvMapEditor` | |

### 3.3 UI 文案

新增 1 个 i18n key：

| key | zh | en |
|---|---|---|
| `action.force_override` | `固化为租户值` | `Lock as tenant value` |

文件：

- `web-next/src/i18n/locales/zh/settings.json`
- `web-next/src/i18n/locales/en/settings.json`

### 3.4 按钮渲染规则（TextRow 等）

```tsx
const canForceOverride = !!overrideMeta && !overrideMeta.isOverridden;
const inForceMode = !dirty && canForceOverride;

<Button
  type='button' size='sm'
  disabled={(!dirty && !canForceOverride) || update.isPending}
  onClick={save}
>
  {update.isPending ? t('action.saving')
    : inForceMode ? t('action.force_override')
    : dirty ? t('action.save')
    : t('action.saved')}
</Button>
```

### 3.5 BoolRow / SelectRow 的固化按钮

```tsx
{canForceOverride && (
  <Button
    type='button' variant='outline' size='sm'
    disabled={update.isPending}
    onClick={() => update.mutate(
      { key: field.key, value }, // 当前展示值（平台默认）
      {
        onSuccess: () => { onSaved(value); toast.success(t('toast.save.success')); },
        onError: (e) => toast.error((e as Error).message),
      },
    )}
  >
    {t('action.force_override')}
  </Button>
)}
```

注意：`BoolRow` 的 `value` 是字符串 `"true"`/`"false"`，符合 `mutate` 的 `string | boolean | number` 类型签名。

## 4. 数据流不变量

保存路径仍走：

```
mutation.mutate → useSetTenantConfig → PUT /api/tenant/config
  → controller/tenant/config.go:UpdateTenantConfig
  → model.SetTenantOption (upsert tenant_options)
  → service.InvalidateTenantOptionCacheKey
       → tenantOptionCache.Delete
       → common.PublishInvalidate → Redis Pub/Sub
       → 另一实例订阅者 → InvalidateTenantOptionKey 清本机 cache
```

- 后端不需要任何改动。
- 多实例 Redis 同步已具备，无需新建。
- 审计日志（`controller/tenant/config.go:82-91`）继续工作。

## 5. 测试策略

新增 `web-next/src/components/settings/FieldRows.test.tsx`：

**TextRow**：

- `overrideMeta={isOverridden:false}` + `value='smtp.qq.com'` + 不动 input：按钮文案 = `"固化为租户值"`，**可点**；点击触发 `mutation.mutate({key:'SMTPServer', value:'smtp.qq.com'})`。
- 同条件下改一个字符：按钮文案 = `"保存"`，可点。
- `overrideMeta={isOverridden:true}` + 不改值：按钮 disabled（行为同今天）。
- **不传** `overrideMeta`：按钮 disabled（平台后台行为不变）。

**BoolRow**：

- `overrideMeta={isOverridden:false}` + `value='true'`：渲染出"固化为租户值"按钮；点击触发 `mutation.mutate({key, value:'true'})`，**不**修改 `checked` 状态。
- `overrideMeta={isOverridden:true}`：不渲染"固化"按钮。
- 不传 `overrideMeta`：不渲染。

**SelectRow**：同 `BoolRow` 模式。

**SecretRow**：单测确认即使传 `overrideMeta={isOverridden:false}` 也**不**出现"固化"按钮（行为完全不变）。

**KvMapEditor / StringListEditor**：各加 1 个 happy-path 测试：`overrideMeta={isOverridden:false}` + 不动 rows 时按钮文案 = `"固化为租户值"`，点击触发 `mutation.mutate` 提交序列化后的当前值。

新增 `mutation` 用 `vi.fn()` 桩，按 `InlineBanner.test.tsx` 的写法。

## 6. 边界与不动的地方

- `SettingsAdmin.tsx`：不传 `overrideMeta` → 所有控件 `canForceOverride = false`，回退到现有行为。无需任何改动。
- `SecretRow`：完全不动，含已有的 `disabled={!draft}` 约束。
- `BoolRow` / `SelectRow` 的 `onCheckedChange`/`onValueChange`：保持原有的"切换即存"语义，不与"固化"按钮冲突——切换后值不同 → onChange 触发存盘；想保持当前值则点"固化"按钮。
- 当 `update.isPending` 时，所有按钮都 disable，避免双击。
- "固化"成功后，`onSaved(value)` 会把值塞进 `TenantConfig` 的 `overrides[key]` 本地态，下次 `items` 刷新时该字段的 `overridden=true`，徽标变为"租户覆盖"，固化按钮自然消失。

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 用户误点"固化"导致租户表多出大量与平台一模一样的行，未来调整平台默认无法穿透 | 这是**期望行为**——一旦租户覆盖，就脱钩。提供"恢复默认"（已有 `action.reset`）回退路径 |
| 用户混淆"保存" vs "固化" | 按钮文案随状态切换；同一时刻只暴露一个语义按钮（TextRow/Kv/List），BoolRow/SelectRow 的"固化"按钮独立于 `Switch`/`Select` 控件本身，不会同时触发 |
| i18n 漏添 key 导致控件渲染 raw key | 测试用例覆盖按钮文案断言；CI 跑 vitest 时会失败 |
| 平台后台被误改 | 已通过"不传 `overrideMeta`"的天然隔离保证；测试用例显式覆盖该分支 |

## 8. 实施清单（给 writing-plans 接力）

1. **i18n**：`web-next/src/i18n/locales/{zh,en}/settings.json` 加 `action.force_override`。
2. **FieldRows.tsx**：
   - `TextRow`：`canForceOverride`、`disabled`、按钮文案。
   - `BoolRow`：在 `ResetButton` 旁加 `ForceOverrideButton`（仅 `canForceOverride` 时渲染）。
   - `SelectRow`：同 `BoolRow`。
   - `SecretRow`：不动。
3. **KvMapEditor.tsx**：保存按钮 `disabled`、文案、加 `canForceOverride`。
4. **StringListEditor.tsx**：同 `KvMapEditor`。
5. **新增 FieldRows.test.tsx**（按 §5 用例）。
6. **跑测试**：`bun --cwd web-next test` / `vitest run`。
7. **手动验证**：起前端，用 SMTP 服务器场景复现这次的 bug —— 重现路径为「平台配过 SMTP → 进入租户配置 SMTP 邮件 tab → 不改任何字段 → 各字段点『固化为租户值』」，最后触发发送邮件，应正常发出。
