# 多租户共享渠道（平台 + BYOK 混合）— 设计文档

> 日期：2026-04-20
> 基于分支：`dev`（commit `fdff73b`）
> 关联背景：`controller/channel.go` 当前仅做了部分租户隔离；`model/tenant_scope.go` 已做 fail-closed guardrail
>
> **v1 Scope 明确**：给现有多租户 SaaS 的渠道层加入"平台共享渠道 + 租户私有渠道 (BYOK)"混合模式。
> **v1 不覆盖**：跨组织共享、团队级渠道、第三方 channel 市场、自动定价（动态 markup）。

---

## 1. 背景与目标

### 1.1 现状

- `channels` 表所有行都带 `tenant_id > 0`，完全按租户隔离；租户要用任何模型都必须自己配 key（BYOK）。
- `abilities` 路由表同样按 `tenant_id` 隔离，`GetRandomSatisfiedChannel(tenantId, group, model, retry)` 查询时会加 `tenant_id` 条件。
- Guardrail `tenant_scope.go` 对未带 `tenant_id` 的读/写/删操作 fail-closed（Check 3 按主键/唯一索引自动放行）。
- `tenant_plans` 已支持 `QuotaLimit / RPMLimit / TPMLimit / MaxMembers / MaxTokens / MaxChannels`。
- 管理员角色：`common.RoleRootUser = 100`（platform admin）、`RoleAdminUser = 10`（tenant admin）、`RoleCommonUser` 等。

### 1.2 本次目标（v1）

给 SaaS 补齐"平台共享渠道"能力：

- **平台（super admin）可以维护一组共享渠道**，所有租户可透明复用
- **租户同时可维护私有渠道（BYOK）**，不与平台渠道互斥
- **路由按租户偏好**在平台/私有两池间选（可选"私有优先/平台优先/仅私有/仅平台"）
- **计费分层**：平台渠道按 channel 或 plan 级 markup 加价扣 quota，私有渠道按原价
- **租户可见但不可编辑**平台渠道，并可对自身租户禁用特定平台渠道
- **顺手修复** `controller/channel.go` 的 IDOR 漏洞（因为本次大改这个文件）

### 1.3 v1 明确不做

- 跨租户复用计费账户 / 分账
- 动态 markup（按时间、负载变化）
- 每 model 级别的路由模式（只做租户级全局模式）
- 平台渠道的 A/B test / canary
- 自动从平台渠道 fork 为私有并注入租户 key

---

## 2. 关键决策记录

| 决策项 | 选择 | 理由 |
|--------|------|------|
| **租户可见性** | B：可见但不可编辑（只读展示），租户可对自身禁用 | 用户有知情权；不允许编辑防止污染平台资源 |
| **计费模型** | C：平台渠道加价（markup），私有渠道原价 | OpenRouter 模式；靠差价赚钱又鼓励 BYOK |
| **路由优先级** | C：租户级全局模式开关（4 种：`private_priority` / `platform_priority` / `only_private` / `only_platform`），默认 `private_priority` | 既保留 BYOK 直觉又给平台推广路径 |
| **数据模型** | B：`channels` 加 `scope` 枚举列（不用 `tenant_id=0` 魔法值） | 语义显式、可扩展 |
| **Markup 配置** | B + C：`channel.markup_ratio` 优先，未配置时回落 `tenant_plans.platform_markup` | 灵活性与默认值兼得 |
| **Plan 门槛** | A：所有租户默认可用平台渠道 | 获客友好；plan 层的 QuotaLimit/RPM/TPM 已足够控量 |
| **ability 表结构** | A：同表加 `scope` 列，查询时 `WHERE scope='platform' OR tenant_id=?` | 一次 SQL 拿到全部候选，路由代码改动最小 |
| **租户级配置存储** | A：模式存 `tenant_options`，禁用关系存新表 `tenant_channel_overrides` | KV 配置走 tenant_options 很自然；稀疏的禁用关系用独立表 |
| **迁移** | 跳过（项目未部署，直接新建表带 `scope` 默认值即可） | 无存量数据 |
| **Guardrail** | 读操作遇到 `scope='platform'` 自动放行；写/改/删仍需 RoleRoot + `WithTenantBypass` | 读必须跨租户可见；写严格锁在平台 admin |

---

## 3. 数据模型变更

### 3.1 `channels` 表

```go
type Channel struct {
    // ...现有字段
    Scope       string   `json:"scope" gorm:"type:varchar(16);not null;default:'tenant';index"` // 'platform' | 'tenant'
    MarkupRatio *float64 `json:"markup_ratio" gorm:"type:decimal(10,4);default:null"`          // nil = 回落到 plan.platform_markup
}
```

**约束（代码层）**：
- `Scope == "platform"` → `TenantId == 0`
- `Scope == "tenant"`   → `TenantId > 0`
- `Scope` 不可变（不允许把平台渠道改成租户渠道或反之）

**索引**：`idx_scope_tenant (scope, tenant_id)` —— 路由查询高频两字段复合。

### 3.2 `abilities` 表

```go
type Ability struct {
    // ...现有字段
    Scope string `json:"scope" gorm:"type:varchar(16);not null;default:'tenant';index"` // 跟 channels.scope 同步
}
```

当 channel 的 ability 被生成/更新时（`AddAbilities` / `UpdateAbilities`），`Scope` 同步写入。

### 3.3 `tenant_plans` 表

```go
type TenantPlan struct {
    // ...现有字段
    PlatformMarkup float64 `json:"platform_markup" gorm:"type:decimal(10,4);not null;default:1.0000"`
}
```

语义：租户用**没配 markup_ratio 的平台渠道**时，适用此系数。默认 `1.0000`（不加价）。

### 3.4 `tenant_options`（已有表）新增 KV

```
key   = "platform_channel_mode"
value ∈ { "private_priority", "platform_priority", "only_private", "only_platform" }
默认  = "private_priority"（未设置时走这个）
```

### 3.5 新表 `tenant_channel_overrides`

```go
type TenantChannelOverride struct {
    TenantId  int   `gorm:"primaryKey;not null"`
    ChannelId int   `gorm:"primaryKey;not null;index"`
    Disabled  bool  `gorm:"not null;default:true"`
    CreatedAt int64 `gorm:"bigint;autoCreateTime"`
}
```

**表语义**：
- **只记录"禁用"关系**；未出现 = 默认启用。
- `(tenant_id, channel_id)` 联合主键。
- 副索引 `idx_channel_id` 用于平台 admin 反查"哪些租户禁用了此渠道"。
- **只针对 `scope='platform'` 的 channel 有意义**；对租户私有 channel 应用层校验拒绝写入。

### 3.6 表注册到 Guardrail

- `channels`、`abilities` **已注册**（保持）
- `tenant_channel_overrides` **需要注册**为 tenant-scoped（按 `tenant_id` 隔离）

---

## 4. 路由查询改造

### 4.1 SQL 层

`model/ability.go` 的 `GetGroupEnabledModels` / 相关查询改造：

```sql
-- 现状
WHERE tenant_id = ? AND "group" = ? AND model = ? AND enabled = true

-- 目标
WHERE "group" = ? AND model = ? AND enabled = true
  AND (scope = 'platform' OR tenant_id = ?)
```

`model/channel_cache.go` 的 `GetRandomSatisfiedChannel(tenantId, group, model, retry)` 内部：
- 从 cache 拿到候选集合（同时包含 platform + tenant 的 abilities）
- 传入**应用层过滤器**（见 4.2）

### 4.2 应用层过滤（在 channel_cache 选渠道时）

伪代码：

```go
func filterByTenantMode(candidates []Ability, tenantId int) []Ability {
    mode := GetTenantOption(tenantId, "platform_channel_mode") // default private_priority
    disabled := LoadTenantDisabledChannels(tenantId)            // Set[channelId]

    platform := []Ability{}
    tenantOwn := []Ability{}
    for _, a := range candidates {
        if a.Scope == "platform" {
            if _, ok := disabled[a.ChannelId]; ok { continue } // 租户禁用
            platform = append(platform, a)
        } else {
            tenantOwn = append(tenantOwn, a)
        }
    }

    switch mode {
    case "only_private":     return tenantOwn
    case "only_platform":    return platform
    case "platform_priority":
        if len(platform) > 0 { return platform } // 平台有就不用私有
        return tenantOwn
    case "private_priority", "": // default
        if len(tenantOwn) > 0 { return tenantOwn }
        return platform
    }
    return tenantOwn // safe default
}
```

**关键细节**：
- "优先"语义是**分层兜底**，不是混合排序——如果私有有候选，根本不进入平台池（反之亦然）。符合用户直觉（"我自己的 key 没坏就别扣我平台 quota"）。
- 在同一层内仍按现有 `priority desc, weight` 排序 + 随机。
- "禁用"的平台渠道永远不进入候选（无论哪种模式）。

### 4.3 Cache 刷新

- `InitChannelCache()` 调用处：加载 abilities 时不再按 tenantId 过滤（拿所有 + scope），而是把 platform + tenant 都入 cache。
- `tenant_channel_overrides` 变更时要 invalidate 对应 tenant 的缓存。`tenant_options.platform_channel_mode` 变更同理。
- 若性能敏感：将 override 做成 `map[tenantId]map[channelId]struct{}` 内存索引，启动加载 + 增量更新。

---

## 5. 计费与账单

### 5.1 `effective_markup` 计算

```go
func effectiveMarkup(ch *Channel, plan *TenantPlan) (float64, string) {
    if ch.Scope != "platform" {
        return 1.0, "none"
    }
    if ch.MarkupRatio != nil {
        return *ch.MarkupRatio, "channel"
    }
    if plan != nil && plan.PlatformMarkup > 0 {
        return plan.PlatformMarkup, "plan"
    }
    return 1.0, "none"
}
```

### 5.2 应用到计费路径

现有计费点（`service/billing.go` / `relay/*` 的 `PostConsumeQuota`）拿到最终扣费时：

```
final_quota = base_quota(model_ratio, completion_ratio, group_ratio, tokens) * effective_markup
```

**注意**：`group_ratio` 和 `effective_markup` 是独立维度——group 是用户组的价格系数，markup 是平台渠道加价系数，二者相乘。

### 5.3 账单日志

`logs` 表（或等效位置）的额外字段：

```go
IsPlatformChannel bool   // scope=='platform'
MarkupRatio       float64
MarkupSource      string // "channel" | "plan" | "none"
```

便于审计与客服排查"为什么这次扣多了"。

---

## 6. 租户级配置

### 6.1 模式开关

- 读：`tenant_options` 的 `platform_channel_mode` key
- 写：租户 admin 在 `/console/settings` 或 `/console/channels` 页面切换
- 校验：值必须 ∈ `{private_priority, platform_priority, only_private, only_platform}`

### 6.2 租户对平台渠道的启用/禁用

- API：`POST /api/tenant/channel/:channelId/toggle`（body: `{disabled: true|false}`）
- 权限：当前租户的 admin
- 约束：目标 channel 必须 `scope='platform'`，否则 400
- 实现：`disabled=true` → upsert 一行到 `tenant_channel_overrides`；`disabled=false` → 删除该行
- 每次变更后 invalidate 该 tenant 的 channel_cache

---

## 7. 平台渠道管理 UI 与权限

### 7.1 Super admin 入口

- 新路由：`/admin/platform/channels`（只有 `RoleRootUser` 可访问）
- 复用现有 `ChannelsAdmin` 组件，但传入 `scope='platform'` 参数
- 创建渠道时 `Scope='platform'`、`TenantId=0`、可填 `MarkupRatio`
- 列表显示"被多少租户禁用"等统计

### 7.2 Tenant admin 入口

- 现有 `/admin/channels` 列出**自己的私有渠道 + 所有未被自己禁用的平台渠道**
- 平台渠道行用 badge 标识（"共享"），操作列只有"禁用/启用"按钮，没有编辑/删除
- 平台渠道 key 一律不返回（即使 `GetChannelKey` 也 403）
- 顶部加一个 Segment：模式切换（4 选 1）

### 7.3 后端路由权限

| 路由 | Super Admin (root=100) | Tenant Admin (10) | 备注 |
|------|:-:|:-:|------|
| `POST /api/channel/` `scope=platform` | ✅ | ❌ | 创建平台渠道 |
| `POST /api/channel/` `scope=tenant` | ✅ | ✅ | 创建自己的私有渠道 |
| `PUT /api/channel/` 针对 platform 行 | ✅ | ❌ | 编辑平台渠道 |
| `PUT /api/channel/` 针对自己 tenant 行 | ✅ | ✅ | 编辑自己的私有渠道 |
| `DELETE /api/channel/:id` platform | ✅ | ❌ | 删除平台渠道 |
| `DELETE /api/channel/:id` 自己 tenant | ✅ | ✅ | 删除自己的 |
| `GET /api/channel/:id/key` platform | ✅ | ❌ | 看平台 key（仅超管） |
| `GET /api/channel/:id/key` 自己 tenant | ✅ | ✅ | 看自己的 key |
| `POST /api/tenant/channel/:id/toggle` | ✅ | ✅ | 禁用/启用平台渠道 |

---

## 8. Guardrail 变更

### 8.1 读操作白名单

`model/tenant_scope.go` 的 `tenantGuardScope` 在 table 命中 `channels` / `abilities` 时：

```
Check 0（新）：如果是 SELECT 且 WHERE 里命中 scope='platform'（或对 abilities 同理），放行
```

**更精确的实现**：在 guardrail 里识别 `(scope = 'platform' OR tenant_id = ?)` 形式的子表达式，视为"已做正确隔离"。

### 8.2 写/改/删仍然 fail-closed

- `scope='platform'` 的写操作必须显式用 `WithTenantBypass`（已有机制），且 controller 先校验 `user.Role == RoleRootUser`
- 普通租户 admin 调用 `UpdateChannel` 时，先按 `channel.TenantId = GetTenantId(c)` 查出原 channel；若 `channel.Scope == 'platform'` 一律 403

### 8.3 `tenant_channel_overrides` 的 guardrail

- 注册为 tenant-scoped
- 正常查询/写入走 `TenantDB(ctx)` 或显式 `.Where("tenant_id = ?", ...)`

---

## 9. `controller/channel.go` IDOR 修复（in-scope）

因为本次大改此文件，顺手把以下裸 `GetChannelById(id, ...)` 全部换成 `GetChannelByIdWithTenant(id, tenantId, ...)`，并在所有 platform 相关写操作加 role 检查：

| 函数 | 当前问题 | 修复 |
|------|----------|------|
| `GetChannel` | 无 tenant 过滤 | 用 `GetChannelByIdWithTenant`；platform 渠道允许任何租户读（不回 key） |
| `GetChannelKey` | **严重**：跨租户读 key | tenant 渠道强制 `tenant_id` 匹配；platform 渠道强制 `role == RoleRootUser` |
| `UpdateChannel` | 无 tenant 过滤 | 先按 tenant 查原 channel；`scope=platform` 要求 root |
| `DeleteChannel` | 无 tenant 过滤 | 同上 |
| `CopyChannel` | 无 tenant 过滤 | 原 channel 必须是自己租户的（或者自己是 root 复制 platform） |
| `ManageMultiKeys` | 无 tenant 过滤 | 同 UpdateChannel |
| `BatchSetChannelTag` | 未传 tenantId | 传入 `tenantId`，model 层加 where |
| `GetTagModels` | 未传 tenantId | 同上 |
| `OllamaPullModel` / `Stream` / `Delete` / `Version` | 无 tenant 过滤 | 同 UpdateChannel |
| `FixChannelsAbilities` | 跨租户 TRUNCATE | 限制为 `RoleRootUser`；分两个 API：全量（仅 root）、按租户（tenant admin），前者用 `WithTenantBypass` |

---

## 10. 测试策略

### 10.1 单元测试

- `TestEffectiveMarkup`：覆盖 channel/plan/none 三个来源的返回
- `TestFilterByTenantMode`：4 种模式 × (有私有/无私有) × (有可用平台/全被禁用) 的矩阵
- `TestPlatformChannelScopeInvariant`：写入 `scope=platform` 但 `tenant_id != 0` 被拒绝；反之亦然

### 10.2 集成测试

- `TestTenantCannotEditPlatformChannel`：tenant admin `PUT /channel` 对 platform id → 403
- `TestTenantCannotReadPlatformChannelKey`：tenant admin `GET /channel/:id/key` 对 platform id → 403
- `TestSuperAdminCreatesPlatformChannel`：root 创建 `scope=platform`、`tenant_id=0`，数据库可查到
- `TestTenantOverrideDisablesPlatformChannel`：租户禁用后路由不再返回此 channel；启用后恢复
- `TestModeSwitchEndToEnd`：切换到 `only_private`，调用 platform-only model → 404 no_channel；切回 `private_priority` 正常
- `TestBillingMarkupApplied`：跑一次平台渠道请求，核对 log.markup_ratio 和 final_quota

### 10.3 Guardrail 回归

- `TestGuardrailAllowsPlatformRead`：`SELECT * FROM channels WHERE scope='platform'` 不带 tenant_id 也不被拒
- `TestGuardrailBlocksUnscopedWriteOnPlatform`：不带 bypass 的 `UPDATE channels WHERE scope='platform'` 仍被拒

---

## 11. 非目标 (Non-goals)

明确 v1 不做以下内容：

- **组织/团队级渠道**：只有 platform 和 tenant 两层
- **按 model 级别的路由模式**：只做租户级全局模式
- **动态定价**：markup 静态配置
- **平台渠道之间的租户白名单/黑名单**：只支持租户自己"禁用"
- **跨租户 channel 复用计费**（单 channel 的 quota 在多租户间分摊）
- **平台渠道的 A/B / 金丝雀发布**
- **从 platform fork 为 tenant**（用户可手工新建）
- **平台渠道的观测面板**（使用量、成功率）——记账字段打上 `is_platform_channel`，后续另做仪表盘

---

## 12. 未解决问题 / 后续扩展

| 问题 | 处理 |
|------|------|
| ability cache 规模 | 现有内存 cache 已按租户 partition，platform 部分多一份全局副本即可；上百万 tenant × 上百 platform channel 再考虑 |
| platform channel 用量归属 | `logs.is_platform_channel` 字段记录，便于后续做"平台成本池"仪表盘 |
| platform 渠道失败熔断 | 现有 channel-level 熔断保持，不做租户级熔断（v2 再考虑） |
| 禁用后是否影响统计 | 禁用 = 不路由，但历史账单仍能查到；UI 要清楚标识 |
| root 创建 platform 时 TenantId 填什么 | 统一 `TenantId = 0`；DB 约束 + 代码校验双重保证 |
| `ChannelAffinityCache` 是否需要区分 scope | 需要，因为"亲和性"是按租户维持的；v1 先按现有 tenantId 做 key，不分 scope |

---

## 13. 实施顺序建议（写 plan 时用）

粗略 6 个 milestone（详细 plan 下一步生成）：

1. **Schema 迁移** — 加列、加新表、注册 guardrail
2. **Guardrail 白名单** — 放行 `scope='platform'` 读
3. **路由层改造** — SQL + 应用层模式过滤 + cache 更新
4. **Controller 权限 + IDOR 修复** — 顺手修完 channel.go 所有越权
5. **计费 markup 注入** — effective_markup + 账单字段
6. **UI 变更** — super admin 入口、tenant 视角 readonly 展示、模式切换、禁用按钮

每个 milestone 独立可 commit、可 review、可回滚。
