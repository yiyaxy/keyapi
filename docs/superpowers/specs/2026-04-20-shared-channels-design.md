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
| **路由架构** | 拆 3 个 group：`/api/channel/*`（RootAuth，保留）+ `/api/tenant-channel/*`（新建，AdminAuth）+ `/api/admin/tenant/:tid/channel/*`（新建，RootAuth） | 现有全组 RootAuth 和"tenant admin 管理自己 BYOK"冲突；强制拆分避免 handler 内杂乱的 role 分支 |
| **字段脱敏** | `sanitizeForTenantView` 对 platform 渠道剥离 Setting/HeaderOverride/ParamOverride/OtherSettings/Other/BaseURL/StatusCodeMapping/AutoBan/Balance/UsedQuota/ChannelInfo 细节 | 仅藏 key 不够；Proxy/SystemPrompt/ModelRatioOverride 等运营配置同样敏感 |
| **Search 防 oracle** | Tenant-side `SearchChannelsForTenant` 删除 `key = ?` 谓词；Tag search 同样 | `key=?` 精确匹配 + 结果存在性 = key 存在性 oracle |

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

`model/ability.go` 的 `GetGroupEnabledModels` / `GetEnabledModels` / `GetChannelEnabledModelsAndChannels` 等查询统一改造：

```sql
-- 现状
WHERE tenant_id = ? AND "group" = ? AND model = ? AND enabled = true

-- 目标
WHERE "group" = ? AND model = ? AND enabled = true
  AND (scope = 'platform' OR tenant_id = ?)
```

**注意：SQL 扩大范围只是第一步，不等于用户最终可见/可路由的集合**。`scope='platform'` 的 ability 命中后还要再经过：
- 租户 `platform_channel_mode` 过滤（可能裁掉全部 platform）
- 租户 `tenant_channel_overrides` 过滤（裁掉被自己禁用的具体 channel）
- channel 本身 `Status=Enabled`（现有检查）

所以 **路由选择 (§4.2-4.4) 和模型/组发现 (§4.5) 必须走同一套过滤函数**，否则会出现"discovery 列出的 model 调用时却 no_channel"。

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

### 4.3 Channel Cache（`model/channel_cache.go`）分桶改造

**当前现状**（`model/channel_cache.go:17-23`）：
```go
var group2model2channels map[string]map[string][]int
// key = tenantGroupKey(tenantId, group) = "tenantId:group"
```
`GetRandomSatisfiedChannel(tenantId, group, ...)` 只读 `group2model2channels["<tenantId>:<group>"]`。**平台 channel 的 ability 存储在 `"0:<group>"` 桶里不会被任何租户的 lookup 读到**。

**改造方案**：

1. **分桶结构保留**：tenant channel 仍按 `tenantId:group` 分桶，platform channel 按 `0:group` 分桶（`scope='platform'` 的 ability `tenant_id=0`）。
2. **Lookup 时合并**：`GetRandomSatisfiedChannel(tenantId, group, model, retry)` 内部：
   ```go
   tenantCandidates   := group2model2channels[tenantGroupKey(tenantId, group)][model]
   platformCandidates := group2model2channels[tenantGroupKey(0,         group)][model]
   merged := append(tenantCandidates, platformCandidates...)
   // 应用 §4.2 的 filterByTenantMode + 禁用过滤
   ```
3. **不做爆炸式复制**：不把 platform ability 塞进每个租户的桶（见 §2 决策：A 方案）。
4. **Override & Mode 的内存索引**：
   - `tenantPlatformChannelMode map[int]string`（tenantId → mode）
   - `tenantDisabledPlatformChannel map[int]map[int]struct{}`（tenantId → set of channelId）
   - `InitChannelCache()` 启动时加载
   - 写路径（toggle/mode 切换）调用 `InvalidateTenantRoutingCache(tenantId)` 重新加载单租户项
5. **platform 侧变更影响所有租户**：super admin 改平台 channel 时全量 `InitChannelCache()`（已有行为）。

### 4.4 Channel Affinity Cache（`service/channel_affinity.go`）改造

**当前现状**（`service/channel_affinity.go:322`）：
```go
buildChannelAffinityCacheKeySuffix(rule, usingGroup, affinityValue)
  // 结果："<rule.Name>:<usingGroup>:<affinityValue>"，无 tenantId
```
`middleware/distributor.go:104` 命中后直接 `model.CacheGetChannel(preferredChannelID)`，**不重新走 §4.2 过滤**。

**后果（不改会发生的事）**：
- **跨租户串扰**：租户 A 亲和过的 channel_id，租户 B 同 affinityValue 会命中同一条 cache entry，无视该 channel 对 B 是否可见/禁用。
- **Mode / Disable 延迟失效**：租户改了 `platform_channel_mode=only_private` 或禁用了 platform channel，affinity cache 里指向 platform channel 的条目仍然生效到 TTL 结束。
- **性能/合规兼坏**：计费会按平台 markup 扣费，但租户其实应该禁用。

**改造方案（必须全做）**：

1. **Cache key 加 tenantId 前缀**：
   ```go
   buildChannelAffinityCacheKeySuffix(rule, tenantId, usingGroup, affinityValue)
     // "<tenantId>:<rule.Name>:<usingGroup>:<affinityValue>"
   ```
   彻底隔离跨租户命中。
2. **取回后二次校验**（在 `distributor.go` 的命中分支）：
   - 拿到 `preferred *Channel` 后检查：
     - `preferred.Scope == "tenant"` → 必须 `preferred.TenantId == currentTenantId`，否则丢弃 affinity 走正常路由
     - `preferred.Scope == "platform"` → 检查当前租户的 mode 是否允许 platform；检查该 channel 是否在租户 disable 集合里；不满足则丢弃
3. **租户级失效**：租户切换 mode / toggle platform channel 时，清理该 tenantId 命名空间下的所有 affinity entry（namespace 扫描：`channelAffinity:<tenantId>:*`）。
4. **Platform 侧删除**：super admin 删掉一个 platform channel 时，所有租户的 affinity 命中都会因为二次校验而 fallback——不强制 purge，TTL 自然过期即可。

### 4.5 Discovery 接口过滤（模型列表 / 组列表 / model details）

以下接口**必须使用和路由相同的过滤逻辑**，否则列出可选 model 但调用必 `no_channel`：

| 接口 / 函数 | 当前位置 | 现行为 | 改造 |
|-------------|----------|--------|------|
| `model.GetGroupEnabledModels(group, tenantId)` | `model/ability.go:45` | SQL `tenant_id=?` | 用 `(scope='platform' OR tenant_id=?)` + 应用层剔除被租户禁用的 platform channel；只有 `only_platform` 模式时剔除所有 tenant 行；只有 `only_private` 时剔除所有 platform 行 |
| `model.GetEnabledModels(tenantId)` | `model/ability.go:55` | SQL `tenant_id=?` | 同上 |
| `model.GetChannelGroupsCopy(tenantId)` | `model/channel_cache.go`（用 `GetChannelGroupsCopy`） | 读 `tenantId:group` 桶 | 合并 `0:group` 桶 + 当前 tenant 桶，扣掉所有 platform channel 均被禁用的 group |
| `model.GetBoundChannelsByModelsMap(modelNames, tenantId)` | `model/model_meta.go:112` | SQL 仅 `channels.tenant_id=?`（可选） | JOIN 加 `AND (channels.scope='platform' OR channels.tenant_id=?)`；**并且**在 map 组装前按 tenant 的 `mode` + `override` 过滤（结果里出现的 channel 必须是 `EffectiveRoutingSet` 里实际可用的那批） |
| `controller/catalog/meta.go:187,274`（模型详情页的 `BoundChannels`） | 调用 `GetBoundChannelsByModelsMap(..., tenantId)` | 下游自动受益 | 无需改 controller，但 e2e 测试要确保：禁用 platform 渠道后模型详情页不再列出该 channel；切 `only_private` 模式后 platform 渠道从 BoundChannels 消失 |
| `controller/catalog/registry.go:174` (`GetUserModels`) | 现调用 `GetGroupEnabledModels(..., tid)` | 下游自动受益 | 无需改，但 e2e 测试要加平台渠道的用例 |
| `controller/group.go:58` (`GetChannelGroups`) | 现调用 `GetChannelGroupsCopy(tid)` | 下游受益 | 同上 |

**实现策略**：抽一个 helper `EffectiveRoutingSet(tenantId, group, model) -> []Ability` 被路由 + discovery **共用**（包括 `GetBoundChannelsByModelsMap` 的结果过滤），保证所有链路永远一致。**契约**：任何对外暴露"某 model 有哪些可用 channel"的接口都必须经过 `EffectiveRoutingSet`；直接查 DB 绕过此 helper 的新代码需要在 review 时被拒。

### 4.6 Cache 刷新与失效

- `InitChannelCache()`：调用 `WithTenantBypass(DB).Find(&abilities)` 拿全量 abilities（已有做法，保持），分桶时 platform ability 落 `0:group`，tenant ability 落 `tenantId:group`（已有做法，保持）。
- 每次 `tenant_channel_overrides` 或 `tenant_options.platform_channel_mode` 变更 → 清理该 tenant 的 affinity 命名空间 + 更新内存 map（§4.3 第 4 项）。
- platform 侧 channel/ability 变更 → 全量 `InitChannelCache()`（已有）+ 不影响 affinity key（但二次校验兜底）。

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

### 5.2 应用到计费路径（**含预扣，不是只挂 PostConsume**）

重要：当前计费走**两阶段**，不能只改末端：

1. **Pre-charge**：`relay/helper/price.go` 的 `ModelPriceHelper` 计算 `preConsumedQuota`，由 `service/billing_session.go` 的 `preConsume → PreConsumeTokenQuota` 预扣到 token/user balance。**选渠道发生在 distributor 阶段**（在 `ModelPriceHelper` 之前 / 之后取决于分支，但到 PriceHelper 执行时 `c.Keys["channel_id"]` 已经被 distributor 写入），所以此时**已经可以解析出 channel.Scope / channel.MarkupRatio**。
2. **Post-consume**：`PostConsumeQuota` 按实际 token 补扣（或退多扣）。

**改造**：

- `ModelPriceHelper` 内部在算出 `preConsumedQuota` 后，**立即乘 effective_markup**（若 channel 是 platform）：
  ```go
  channel := model.CacheGetChannel(info.ChannelId)
  plan, _ := model.GetTenantPlan(info.TenantId)
  mk, source := effectiveMarkup(channel, plan)
  preConsumedQuota = int(math.Ceil(float64(preConsumedQuota) * mk))
  info.PriceMarkupRatio = mk
  info.PriceMarkupSource = source
  ```
  `info *RelayInfo` 里持久化 markup 给 PostConsume 用，避免重新查。
- `PostConsumeQuota` 读 `info.PriceMarkupRatio`，对最终 `quota`（或其 delta 部分）也乘 markup。**两阶段用同一系数**，不允许 pre/post 取到不同值（防止路由重试切换 channel 后 markup 不一致 —— 如果中途 failover 到另一个 channel，应按最终落地的 channel 重算，此时 PostConsume 拿最终 channel 重算 markup，而 pre-charge 的差额在 retry 时补算。详细见 §5.4 重试与切换场景）。

```
final_quota = base_quota(model_ratio, completion_ratio, group_ratio, tokens) × effective_markup
preConsumed_quota = base_preConsumed × effective_markup
```

**`group_ratio` 和 `effective_markup` 是独立维度**——group 是用户组的价格系数，markup 是平台渠道加价系数，二者相乘。

### 5.3 重试与 channel 切换

Relay 失败重试会切换 channel（`middleware/distributor.go` 的 retry 逻辑）。若重试把请求从**私有渠道**切到**平台渠道**（或反之），markup 发生变化。处理方案：

- **每次 retry 选到新 channel 后，重新调用 `effectiveMarkup`**，更新 `info.PriceMarkupRatio`。
- PostConsume 以**最后实际成功的 channel** 的 markup 为准结算。
- Pre-charge 的差额：
  - 若新 markup > 旧：需要再预扣 `(new - old) × base_preConsumed`；失败则请求中止（和当前"预扣失败"同等处理）。
  - 若新 markup < 旧：在 PostConsume 时自动退差（现有 `quota_delta` 机制支持）。
- 账单日志记录**最终生效的 markup**（retry 之间的 pre-charge 波动不单独记）。

### 5.3 账单日志

`logs` 表（或等效位置）的额外字段：

```go
IsPlatformChannel bool   // scope=='platform'
MarkupRatio       float64
MarkupSource      string // "channel" | "plan" | "none"
```

（注：本小节是 §5.4，由于 §5.3 被"重试与 channel 切换"占用，此节可理解为"5.4 账单日志"。最终落地 PR 时按顺序编号即可。）

便于审计与客服排查"为什么这次扣多了"。

---

## 6. 租户级配置

### 6.1 模式开关

- 读：`tenant_options` 的 `platform_channel_mode` key
- 写：租户 admin 在 `/console/settings` 或 `/console/channels` 页面切换
- 校验：值必须 ∈ `{private_priority, platform_priority, only_private, only_platform}`

### 6.2 租户对平台渠道的启用/禁用

- **API（租户端）**：`POST /api/tenant-channel/:channelId/toggle`（body: `{disabled: true|false}`）
  - 权限：**仅当前租户的 admin**，使用新的 `TenantAdminOnlyAuth()` 中间件（见 §7.3-G）——注意**不能**简单用 `AdminAuth()`，因为 `AdminAuth` 不拦 root
  - tenantId 从 JWT / session 取，**URL 里没有 tenant selector**
  - root（`RoleRootUser`）命中此端点会被 `TenantAdminOnlyAuth` 以 403 拒绝，提示走下面的 admin 端 API
- **API（root 端，代租户操作）**：`POST /api/admin/tenant/:tenantId/channel/:channelId/toggle`（body 同上）
  - 权限：仅 `RoleRootUser`（`RootAuth()` 已足够）
  - 显式 `tenantId` 路径参数；后端 `WithTenantBypass` 写 `tenant_channel_overrides`
  - 用途：运营代操作、排障
- 约束（两个接口共用）：目标 channel 必须 `scope='platform'`，否则 400
- 实现：`disabled=true` → upsert 一行到 `tenant_channel_overrides`；`disabled=false` → 删除该行
- 每次变更后 invalidate 该 tenant 的 channel_cache **以及 affinity cache 的 `<tenantId>:*` 命名空间**（见 §4.4）

---

## 7. 平台渠道管理 UI 与权限

### 7.1 Super admin 入口

- 新路由：`/admin/platform/channels`（只有 `RoleRootUser` 可访问）
- 复用现有 `ChannelsAdmin` 组件，但传入 `scope='platform'` 参数
- 创建渠道时 `Scope='platform'`、`TenantId=0`、可填 `MarkupRatio`
- 列表显示"被多少租户禁用"等统计

### 7.2 Tenant admin 入口

- 现有 `/admin/channels` 分两个区域展示：
  - **我的渠道**：所有 `scope='tenant'` 且 `tenant_id=当前租户` 的渠道（可编辑/删除）
  - **平台渠道**：所有 `scope='platform'` 的渠道，**无论是否被自己禁用都展示**（禁用的用灰色样式 + "已禁用" 徽标 + "启用"按钮；启用的显示"禁用"按钮）
- 平台渠道行用 badge 标识（"共享"），操作列只有"禁用/启用"切换，**没有编辑/删除**
- 平台渠道 key 一律不返回（即使 `GetChannelKey` 也 403，除非 root）
- 顶部加一个 Segment：模式切换（4 选 1，写入 `tenant_options.platform_channel_mode`）
- UI 禁用/启用按钮都可见，避免"禁用后找不到开关"的死循环（原 Open Question #1）

### 7.3 路由层重构（**必要**：现状是全组 RootAuth，与本设计冲突）

**现状**（`router/api-router.go:298`）：整个 `/api/channel/*` 组都挂 `middleware.RootAuth()`——只有 root 能访问。`controller/channel/channel.go:567` 强写 `TenantId = GetTenantId(c)`、`:648` 按 tenant `MaxChannels` 校验。**与本设计（tenant admin 管理自己的 BYOK、platform 渠道 tenant_id=0）直接冲突**。

**改造方案**（决策：两个独立 route group）：

**A. `/api/channel/*`（RootAuth 保持不变）—— 平台管理员入口**
- 用途：super admin 管理**所有**渠道（含平台渠道和代租户操作租户渠道）
- 不变：现有 handlers 可以沿用，但需要修改 `AddChannel` / `UpdateChannel` 语义：
  - `AddChannel` body 接受 `scope`（默认 `tenant`）和 `tenant_id`（仅 `scope=tenant` 时必填且 > 0）
  - `scope=platform` 时 `TenantId` 强制为 `0`
  - `MaxChannels` 配额检查**仅当 `scope=tenant`** 时执行（当前 `:648` 的逻辑加 if 分支）
- 子路由（root 独占）：`/fix`（全局重建 abilities）、`/copy/:id`（允许跨 scope 复制）、`/multi_key/manage`（platform 渠道的多 key 管理）等

**B. `/api/tenant-channel/*`（新建，`TenantAdminOnlyAuth()` + tenant 上下文）—— 租户管理员入口**
- 用途：tenant admin 管理**自己租户的渠道**（BYOK）+ 查看/toggle 平台渠道
- **关键：不能用 `AdminAuth()`**——`AdminAuth()` 只检查 `effectiveRole >= RoleAdminUser(10)`，root（100）也能过，不满足"只有租户 admin 能命中"的要求。见 §7.3-G 新中间件定义。
- 关键：所有写操作**强制** `TenantId = GetTenantId(c)` + `Scope = "tenant"`（body 里即便传 `scope=platform` 也被覆盖）
- 端点：
  ```
  GET    /api/tenant-channel/                        列表（我的 + 平台，走 §7.2 分区展示，§7.4 脱敏）
  GET    /api/tenant-channel/search                  搜索（不含 key 精确匹配，见 §7.5）
  GET    /api/tenant-channel/:id                     单条详情（§7.4 脱敏）
  POST   /api/tenant-channel/                        新建（强制 tenant scope + tenant_id）
  PUT    /api/tenant-channel/                        更新（严格 tenant 匹配，拒绝 platform）
  DELETE /api/tenant-channel/:id                     删除（同上）
  POST   /api/tenant-channel/:id/key                 查看自己的 key（SecureVerification）
  POST   /api/tenant-channel/:id/toggle              toggle 平台渠道禁用态（原 §6.2 的租户端）
  POST   /api/tenant-channel/batch                   批量删除（限自己租户）
  POST   /api/tenant-channel/batch/tag               批量打 tag（限自己租户）
  DELETE /api/tenant-channel/disabled                清理被禁渠道（限自己租户）
  POST   /api/tenant-channel/tag/disabled            tag 级禁用（限自己租户）
  POST   /api/tenant-channel/tag/enabled             同上
  PUT    /api/tenant-channel/tag                     tag 级编辑（限自己租户）
  GET    /api/tenant-channel/tag/models              按 tag 查模型（限自己租户）
  POST   /api/tenant-channel/fix                     按 tenant 重建 abilities（租户版）
  POST   /api/tenant-channel/ollama/*                Ollama 管理（限自己租户拥有的 Ollama 渠道）
  ```
- `GetChannelKey` / `UpdateChannel` / 等沿用 `controller/channel/*`，但入口不同：route 层注入 `ctxKey: "allowPlatformWrite" = false`，controller 读取决定是否拒绝 platform 写。

**C. `/api/admin/tenant/:tenantId/channel/*`（新建，`RootAuth`）—— root 代租户入口**
- 用途：运营/排障 —— root 代任意租户做操作，`tenantId` 显式在 path 里
- 端点（最少集合，用到再加）：
  ```
  POST /api/admin/tenant/:tenantId/channel/:channelId/toggle     代租户 toggle 平台渠道
  POST /api/admin/tenant/:tenantId/channel/fix                   代租户重建 abilities
  ```
- 实现：从 path 取 `tenantId`，后端 `WithTenantBypass` 手动设置 tenant 上下文后调用复用的 handler

**D. 权限矩阵（route-level，最终形态）**

| 路由 | RootAuth | TenantAdminOnlyAuth | 备注 |
|------|:-:|:-:|------|
| `POST /api/channel/` scope=platform | ✅ | — | 平台渠道，tenant_id=0 |
| `POST /api/channel/` scope=tenant | ✅ | — | root 代某租户建（body 传 tenant_id） |
| `PUT /api/channel/` 任意 scope | ✅ | — | root 全权 |
| `DELETE /api/channel/:id` 任意 | ✅ | — | root 全权 |
| `POST /api/channel/:id/key` 任意 | ✅ | — | root 全权（含 SecureVerification + CriticalRateLimit） |
| `POST /api/channel/fix` | ✅ | — | 全局重建 abilities |
| `POST /api/tenant-channel/` | — | ✅ | 强制 tenant scope + 本租户 tenant_id |
| `PUT /api/tenant-channel/` | — | ✅ | 严格本租户；若 orig.scope=platform 返 403 |
| `DELETE /api/tenant-channel/:id` | — | ✅ | 同上 |
| `POST /api/tenant-channel/:id/key` | — | ✅ | 严格本租户；platform 返 403 |
| `POST /api/tenant-channel/:id/toggle` | — | ✅ | 仅 platform 渠道可 toggle |
| `POST /api/admin/tenant/:tid/channel/:id/toggle` | ✅ | — | root 代租户操作，显式 tenantId（回答 Open Q #1） |

**E. Controller 分裂策略**

两个方案选一：
- **E1（推荐）**：沿用同一组 handler，route 层通过中间件往 context 里写入 `role_scope`（`platform_admin` vs `tenant_admin`）和 `allow_platform_write` flag，handler 根据 flag 决定是否接受 `scope=platform`、是否跳过 MaxChannels 检查
- **E2**：复制一套 handler 到 `controller/tenant_channel/` 子包，两套独立演化。YAGNI，除非发现逻辑分歧太大

初版走 E1，发现分叉后再重构。

**F. 向后兼容**
当前前端只调 `/api/channel/*`（因为只有 root 能用），改造后：
- super admin UI 继续用 `/api/channel/*`
- 新的 tenant admin UI 指向 `/api/tenant-channel/*`
- 两套 API 长期共存，不做 URL alias 混淆

**G. `TenantAdminOnlyAuth()` 中间件定义（新）**

现有 `AdminAuth()`（`middleware/auth.go:221`）只看 `effectiveRole >= RoleAdminUser(10)`，会放行 root（`platform_role=100`）。租户端路由需要"**tenant admin 可通行、root 被拒**"的精确语义，所以加一个新中间件：

```go
// 仅允许"本租户的 admin"访问；root（平台管理员）应走 /api/admin/tenant/... 代操作端点
func TenantAdminOnlyAuth() func(c *gin.Context) {
    return func(c *gin.Context) {
        // 先过 authHelper 做会话/token 校验（沿用现有逻辑）
        if !authHelper(c, common.RoleAdminUser) {
            return
        }
        // 额外拒绝 root：强制走 /api/admin/tenant/... 代操作路径
        platformRole := c.GetInt("platform_role")
        if platformRole >= common.RoleRootUser {
            c.JSON(http.StatusForbidden, gin.H{
                "success": false,
                "message": "root 用户请使用 /api/admin/tenant/:tenantId/channel/* 端点代租户操作",
            })
            c.Abort()
            return
        }
        // 额外校验：当前用户必须在当前 tenant 有 TenantRoleAdmin（不只是平台 role）
        tenantRole := c.GetInt("tenant_role")
        if tenantRole < model.TenantRoleAdmin {
            c.JSON(http.StatusForbidden, gin.H{
                "success": false,
                "message": "需要当前租户的 admin 角色",
            })
            c.Abort()
            return
        }
        c.Next()
    }
}
```

**设计理由**：
- `platform_role` 和 `tenant_role` 在 `authHelper` 的 `c.Set` 里已经分开（`middleware/auth.go:191-193`），直接读取即可，不需要额外查表
- 拒绝 root 是**架构明确性**而非"权限不足"——root 有权，但走错路径；提示里给出正确端点
- 要求 `tenant_role >= TenantRoleAdmin` 确保用户不只是 platform admin 混入租户，而是确实被授予了本租户的 admin 角色

**其他写作注意**：文档里所有"AdminAuth + tenant context"表述都要改为"TenantAdminOnlyAuth"。

### 7.4 Tenant 视角的字段脱敏（必做，否则平台渠道是敏感运营信息的泄漏源）

`model.Channel` struct（`model/channel.go:40-60`）有多个默认随 GET 返回的文本字段：`Setting`（含 `dto.ChannelSettings` 里的 `Proxy`、`SystemPrompt`、`ChannelRatio`、`ModelRatioOverride` 等）、`HeaderOverride`、`ParamOverride`、`OtherSettings`、`Other`、`BaseURL`、`StatusCodeMapping`、`AutoBan`、`Balance`、`UsedQuota`。

**规则：当调用方是 tenant（不是 root），且返回的 channel 是 `scope='platform'` 时，后端必须剥离下列字段再返回**：

| 字段 | 平台渠道返回给 tenant 时 | 理由 |
|------|:-:|------|
| `Key` / `Keys` | ❌ 置空 | 敏感凭证（已有） |
| `Setting` | ❌ 置空 | 含 Proxy、SystemPrompt、ModelRatioOverride 等运营敏感配置 |
| `HeaderOverride` | ❌ 置空 | 可能含 API key 替换模板（`{api_key}` 被填入时） |
| `ParamOverride` | ❌ 置空 | 平台定制参数覆盖策略（商业机密） |
| `OtherSettings` (`settings`) | ⚠️ 白名单 | 只返回 `VertexKeyType` 等非敏感子字段；运营字段不返回 |
| `Other` | ❌ 置空 | 部署地区等内部 |
| `BaseURL` | ⚠️ 置空或只露 domain | 默认置空；如果前端确实需要展示"供应商地址"，只露 host，不露 path/query |
| `StatusCodeMapping` | ❌ 置空 | 状态码映射规则 |
| `AutoBan` | ❌ 置空 | 运营参数 |
| `Balance` / `BalanceUpdatedTime` | ❌ 置空 | 余额信息（跨租户统计泄漏） |
| `UsedQuota` | ❌ 置空 | 用量数据 |
| `ChannelInfo.MultiKeyStatusList` / `MultiKeyDisabledReason` / `MultiKeyDisabledTime` | ❌ 置空 | 多 key 运营状态 |
| `MarkupRatio` | ✅ 保留 | 税透明，租户有权知道加价倍数 |
| `Scope` / `Type` / `Name` / `Models` / `Groups` / `Status` / `Tag` | ✅ 保留 | 必需展示项 |

**实现位置**：`clearChannelInfo` 已有（见 `controller/channel.go:65-70`），扩展为 `sanitizeForTenantView(ch *Channel, viewerScope string)`：
- `viewerScope = "platform_admin"` → 返回原样
- `viewerScope = "tenant_admin" && ch.Scope == "platform"` → 应用上表剥离
- `viewerScope = "tenant_admin" && ch.Scope == "tenant"` → 只 omit `Key`（现有行为）

所有 tenant-side 读取入口（`/api/tenant-channel/*` 的 GET / search / list）在返回前统一调用此 helper。

### 7.5 Search 接口防"key oracle"

**问题**：`model/channel.go:351,354` 的 `SearchChannelsByTenant` 在 WHERE 里含 `key = ?` 精确匹配谓词。Tenant 搜索 `keyword="sk-abc123"` 时，若结果集非空，即可确认"某平台渠道 key = sk-abc123"。即使返回结果里不含 key 字段，**存在性本身已泄漏**（oracle）。

**改造**：拆两个 search helper：
```go
// 现有函数：仅 root 调用，保留 key 精确匹配
func SearchChannelsAdmin(tenantId int, keyword, group, model string, idSort bool) ([]*Channel, error)

// 新：tenant 调用，谓词里删除 `key = ?`
func SearchChannelsForTenant(tenantId int, keyword, group, model string, idSort bool) ([]*Channel, error) {
    // WHERE 子句只保留：id = ? OR name LIKE ? OR base_url LIKE ?
    // 对 platform 渠道，base_url 同样走 §7.4 脱敏（搜索也不放行）
    // 结果集 Scope='platform' 的行走 sanitizeForTenantView
}
```

同样处理：`SearchTags`（§9 Finding 3 会提）的谓词 `key = ?`（如果有）必须删除。

### 7.6 解决前两轮 Open Questions 的最终形态

- **Open Q #1**（toggle 端点的 tenant selector）：
  - Tenant 端 `POST /api/tenant-channel/:id/toggle`——无 selector，tenantId 从 JWT 解析；root **不允许**命中此端点（AdminAuth 中间件就会拦到，root 即便角色 >= admin 也不经过此路径）
  - Root 代操作走 `POST /api/admin/tenant/:tenantId/channel/:id/toggle`——显式 path selector
  - 两个端点签名/鉴权/副作用都不同，不会互相混淆

- **Open Q #2**（禁用后无 re-enable 入口）：
  - `/api/tenant-channel/` 列表始终返回**所有平台渠道**（无论是否被本租户禁用）；前端按 `ch.tenant_disabled`（后端 join `tenant_channel_overrides` 打 flag）做灰色+启用按钮
  - 响应体增加字段 `tenant_disabled bool`（仅 tenant-side 返回）

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

因为本次大改此文件，顺手修。**但原方案"把 `GetChannelById` 全部换成 `GetChannelByIdWithTenant`"是错的**——后者（`model/channel.go:370-389`）是严格 `WHERE id=? AND tenant_id=?` 匹配，传租户 id 去查平台渠道（`tenant_id=0`）会 not found。

### 9.1 model 层新增两个 helper（先做）

```go
// 读：允许"属于当前租户" 或 "平台渠道"
func GetVisibleChannelForTenant(id int, tenantId int, selectAll bool) (*Channel, error) {
    query := DB.Where("id = ? AND (scope = 'platform' OR tenant_id = ?)", id, tenantId)
    // ...
}

// 写：严格匹配 tenantId，确保调用方不会误改平台渠道或他租户渠道
// 等价于现有 GetChannelByIdWithTenant，但重命名强调语义
func GetOwnedChannelForTenant(id int, tenantId int, selectAll bool) (*Channel, error) {
    query := DB.Where("id = ? AND tenant_id = ?", id, tenantId)
    // 注：scope='tenant' 的检查由约束保证 tenant_id > 0
}
```

（`GetChannelByIdWithTenant` 本身保留，但 callers 切到上面两个语义更清晰的命名。）

### 9.2 Controller 逐函数修复清单

所有修复前先 `tenantId := middleware.GetTenantId(c)`、`role := c.GetInt("role")`。下表"读/写"指该函数的主要动作。

| 函数 | 动作 | 当前问题 | 修复 |
|------|------|----------|------|
| `GetChannel` | 读 | 无 tenant 过滤 | `GetVisibleChannelForTenant(id, tenantId)`；返回时平台渠道剥掉 key |
| `GetChannelKey` | 读 | **严重**：跨租户读 key | tenant 渠道：`GetOwnedChannelForTenant(id, tenantId, selectAll=true)`；platform 渠道：要求 `role >= RoleRootUser`，再 `WithTenantBypass` 查 |
| `UpdateChannel` | 写 | 无 tenant 过滤 | `orig := GetVisibleChannelForTenant(...)` 先确认存在；若 `orig.Scope=='platform'` 必须 `role == RoleRootUser`，否则 403；否则 `GetOwnedChannelForTenant` 严格校验后写 |
| `DeleteChannel` | 写 | 无 tenant 过滤 | 同 UpdateChannel 的分支 |
| `CopyChannel` | 读+写 | 无 tenant 过滤；且原逻辑整行 shallow copy 会带上 key/Setting 等敏感字段 | **Tenant 端路径强制拒绝复制 platform 渠道**：`orig := GetOwnedChannelForTenant(id, tenantId, selectAll=true)` —— 严格匹配 tenant_id，platform 渠道（tenant_id=0）天然不匹配返 not found/403。**不提供"从 platform fork 为 tenant"能力**（与 §11 非目标保持一致）。Root 端 `/api/channel/copy/:id` 保留完整能力（可以跨 scope 复制），但**复制后必须显式走 `sanitizeForCopy`**（见下一行） |
| `sanitizeForCopy`（新 helper） | — | CopyChannel 的 shallow copy 不安全 | 定义白名单字段：`Type / Name / Models / Groups / ModelMapping / Priority / Weight / Tag / Setting?`（Setting 在 platform→tenant 时需要白名单剥离 Proxy/ModelRatioOverride 等运营字段）；**Key / HeaderOverride / ParamOverride / OtherSettings / Other / ChannelInfo（多 key 状态）/ Balance / UsedQuota / TestTime / ResponseTime 一律不复制**。Root 跨 scope 复制 platform→tenant 时用户必须在 UI 或 API body 里重新提供 Key |
| `ManageMultiKeys` | 写 | 无 tenant 过滤 | `GetOwnedChannelForTenant`（平台渠道的多 key 只能由 root 管，复用 super admin 的 `/admin/platform/channels` 路径，不走此 controller） |
| `BatchSetChannelTag` | 写 | 未传 tenantId | 传入 `tenantId`；`model.BatchSetChannelTag` 加 `WHERE tenant_id=?`；平台渠道的 tag 只能由 root 修改（独立路由） |
| `GetTagModels` | 读 | 未传 tenantId | 传入 `tenantId`；按 "tenant_id=? OR scope='platform'" 查 tag |
| `OllamaPullModel` / `Stream` / `Delete` / `Version` | 写 | 无 tenant 过滤 | `GetOwnedChannelForTenant`；平台 Ollama 渠道的拉取 / 删除只能 root 做 |
| `FixChannelsAbilities` | 写（全局） | 跨租户 TRUNCATE | 限制为 `RoleRootUser` + `WithTenantBypass`；**同时**提供按租户的版本 `FixTenantChannelsAbilities(tenantId)` 给 tenant admin 用（只 truncate 该 tenant 的 abilities 行，且重建时跳过 platform） |
| `FetchUpstreamModels` | 读 | 已用 `GetChannelByIdWithTenant` | 改 `GetVisibleChannelForTenant`，因为平台渠道也应该允许当前租户查看其支持的模型（key 仍不返回） |
| `GetAllChannels`（**tag_mode** 分支） | 读 | `GetPaginatedTags` / `GetChannelsByTag` 全局无 tenant filter | 新增 `GetPaginatedTagsForTenant(tenantId, offset, limit)` 和 `GetChannelsByTagForTenant(tag, tenantId, ...)`；按 `(scope='platform' OR tenant_id=?)` 扫描 tag/channels |
| `SearchChannels`（**tag_mode** 分支） | 读 | `SearchTags` / `GetChannelsByTag` 全局无 tenant filter | 新增 `SearchTagsForTenant(tenantId, keyword, group, model, idSort)`；同样按 scope+tenant 过滤，且删除 `key=?` 谓词（§7.5） |
| `DisableTagChannels` / `EnableTagChannels` / `EditTagChannels` | 写 | 已传 tenantId 给 model 层 | 保持；额外校验：tenant 端 handler **禁止** tag 操作命中 `scope='platform'` 的渠道（model 层加 `AND scope='tenant'`） |

### 9.3 `model` 层 tag 相关 helper 补齐

| 现有函数 | 问题 | 新增/改写 |
|----------|------|----------|
| `GetPaginatedTags(offset, limit)` `model/channel.go:850` | 无 tenant filter，跨租户泄漏 | 新增 `GetPaginatedTagsForTenant(tenantId int, offset, limit int) ([]*string, error)`：`WHERE tag != '' AND (scope='platform' OR tenant_id=?)` |
| `SearchTags(keyword, group, model, idSort)` `model/channel.go:856` | 无 tenant filter；WHERE 里含 `key = ?` oracle | 新增 `SearchTagsForTenant(...)`：加 tenant 过滤 + 删除 `key=?` 谓词 |
| `GetChannelsByTag(tag, idSort, selectAll)` `model/channel.go:300` | 无 tenant filter | 新增 `GetChannelsByTagForTenant(tag, tenantId, idSort, selectAll)`：`WHERE tag=? AND (scope='platform' OR tenant_id=?)` |

Super admin（`/api/channel/*`）仍可用原版 helper（全局扫描），显式 `WithTenantBypass` 包裹。

### 9.4 Controller 原则提炼

- **读的入口**走 `GetVisibleChannelForTenant` / `*ForTenant` 系列（租户视角：自己的 + 平台的）
- **写的入口**走 `GetOwnedChannelForTenant`（严格租户匹配，防止误改）
- **涉及平台渠道的写**额外要求 `role == RoleRootUser`
- **跨租户全局操作**（`FixChannelsAbilities`、全局 tag 扫描）要求 root + 显式 `WithTenantBypass`
- **Tag 相关 helper** 必须有 `ForTenant` 版本；`controller/tenant-channel/*` 只能用 `ForTenant` 版本
- **返回 body** 走 §7.4 的 `sanitizeForTenantView`——平台渠道向 tenant 输出时剥离敏感字段

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
- `TestBillingMarkupAppliedPreAndPost`：**关键回归**——平台渠道请求的 `preConsumedQuota` 和 `PostConsumeQuota` 均应包含 markup；log 记录最终 markup
- `TestRetryAcrossScopeRecalculatesMarkup`：首次路由到 tenant 渠道失败，retry 切到 platform 渠道；最终扣费按 platform markup 结算，并补扣 pre-charge 差额
- `TestAffinityCacheRespectsTenantDisable`：租户 A 的 affinity cache 命中 platform channel 后，切换到禁用该 channel 或改为 `only_private` 应立即失效（清理 `<tenantA>:*`）
- `TestAffinityCacheIsolatesTenants`：租户 A 和 B 同一 affinityValue 在 cache 里是两条 entry，A 的路由不影响 B
- `TestDiscoveryMatchesRouting`：`GetGroupEnabledModels(group, tenantId)` 返回的每一个 model 调用后**都能**成功路由（对每个 mode × override 组合）；反之路由成功的 model 必定在 discovery 里
- `TestBoundChannelsMatchesRouting`：模型详情页 `BoundChannels`（通过 `GetBoundChannelsByModelsMap`）与 `EffectiveRoutingSet` 返回的 channel 集合逐一相等；禁用 platform 渠道后立即消失；切 `only_private` 后所有 platform 渠道从 BoundChannels 剔除
- `TestSanitizeForTenantViewStripsSensitiveFields`：tenant 获取 platform 渠道时，`Setting` / `HeaderOverride` / `ParamOverride` / `OtherSettings` / `Other` / `BaseURL` / `StatusCodeMapping` / `Balance` / `UsedQuota` / `ChannelInfo.MultiKeyStatusList` 等字段均为空；`MarkupRatio` / `Models` / `Groups` 保留
- `TestSearchCannotOracleKey`：tenant 调 `/api/tenant-channel/search?keyword=<具体 key>` 返回空（即使 DB 里确实有匹配的 platform key）；root 同查询走 `/api/channel/search` 可命中
- `TestTagModeTenantIsolation`：租户 A 用 tag_mode 查询，只看到自己的 tag 和 platform 渠道的 tag，看不到租户 B 的 tag；tag_mode 禁用/启用/编辑不影响租户 B 的渠道
- `TestTagEditOnPlatformDenied`：tenant 端 `PUT /api/tenant-channel/tag` 命中 platform 渠道所用 tag 时 → 只影响自己租户的渠道，不动 platform 渠道
- `TestTenantCreateChannelForcesScope`：tenant 端 `POST /api/tenant-channel/` body 传 `scope=platform`、`tenant_id=0` → 实际插入 `scope=tenant`、`tenant_id=<当前 tenant>`；MaxChannels 检查生效
- `TestRootCreatePlatformChannelSkipsMaxChannels`：root 端 `POST /api/channel/` `scope=platform` 不受任何 tenant MaxChannels 影响（只受 platform 全局限额，如果有）
- `TestTenantListAlwaysShowsDisabledPlatform`：租户禁用 platform channel #5 后，列表仍返回 #5 带 `tenant_disabled=true` 标志（验证 Open Q #2 最终形态）
- `TestTenantToggleNoSelectorRespectsJWT`：租户 A 调 `POST /api/tenant-channel/:id/toggle`，即使 JWT 被篡改 tenantId 或 body 带 tenantId 字段，后端只信 JWT；租户 A 无法改租户 B 的 override

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
- **Tenant 端 "从 platform fork 为 tenant"**：tenant 端 `/api/tenant-channel/copy/:id` 不允许 source 是 platform 渠道（见 §9.2 CopyChannel 行）。Root 端 `/api/channel/copy/:id` 允许跨 scope 复制但走 `sanitizeForCopy` 白名单，Key 必须重新提供（不自动继承平台 key）。这不是 "完整 fork"，是 "从 platform 创建新的 tenant 渠道模板"
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
| `ChannelAffinityCache` 是否需要区分 scope | 已升级：v1 **必须**加 tenantId 到 cache key，并在 distributor 命中后做 scope/mode/disable 二次校验（见 §4.4） |
| Pre-charge 时 channel 是否已选定 | distributor 先于 `ModelPriceHelper` 执行（见 `middleware/distributor.go` 注入 `ContextKeyChannelId`），所以 pre-charge 能拿到 channel.Scope；若发现某些路径不是这个顺序，需要在 plan 阶段核实并调整 |
| `sanitizeForTenantView` 对 `channel_info` 内嵌字段的精度 | v1 粗粒度整块置空 `ChannelInfo.MultiKeyStatusList` 等；如果未来 UI 需要展示"平台渠道有多少个 key 健康"这种聚合统计，单独加一个聚合 API 而不是放开字段 |
| tag_mode tenant 端能否对 platform 渠道批量操作 | v1 **不能**——tenant-side 的 tag 操作只影响 `scope='tenant'` 的渠道；平台渠道的 tag 只有 root 能改（避免租户靠 tag 绕过禁用） |
| `/api/channel/*` 被现有前端调用的位置 | Milestone 6 前必须 grep 前端确认调用点；切 `/api/tenant-channel/*` 时 UI 要同步改，不做 URL 兼容层（避免长期维护 shim） |

---

## 13. 实施顺序建议（写 plan 时用）

粗略 10 个 milestone（详细 plan 下一步生成）：

1. **Schema 迁移** — 加列（channels.scope, channels.markup_ratio, abilities.scope, tenant_plans.platform_markup）、加新表 `tenant_channel_overrides`、注册 guardrail
2. **Guardrail 白名单** — 放行 `scope='platform'` 读；`tenant_channel_overrides` 纳入 tenant-scoped
3. **model 层 helpers** — `GetVisibleChannelForTenant` / `GetOwnedChannelForTenant` / `effectiveRoutingSet(tenantId, group)` / `effectiveMarkup`
4. **路由层改造（两条链路一致）**
   - `channel_cache` 的 lookup 合并 `tenantId:group` + `0:group` 桶 + 应用 §4.2 过滤
   - affinity cache key 加 tenantId 前缀 + distributor 命中后二次校验
   - discovery 接口（`GetGroupEnabledModels` / `GetEnabledModels` / `GetChannelGroupsCopy`）复用 `effectiveRoutingSet`
5. **计费 markup 注入（pre + post）** — `ModelPriceHelper` 按 channel 结算；`RelayInfo` 持久化 markup；PostConsume 读取；retry 切换后重算
6. **路由层重构** — 按 §7.3 拆三个 group（`/api/channel` 保 RootAuth；新 `/api/tenant-channel`、`/api/admin/tenant/:tid/channel`）；修改 `AddChannel` 接受 `scope`/`tenant_id` body 参数并条件跳过 MaxChannels；中间件注入 `role_scope` / `allow_platform_write`
7. **Controller IDOR 修复 + tag_mode 补齐** — 按 §9.2 / §9.3 新增 `GetVisibleChannelForTenant` / `GetOwnedChannelForTenant` / `*ForTenant` tag helpers；所有 handler 切到 For-Tenant 版本（tenant-side）或显式 bypass（platform-side）
8. **字段脱敏 + Search oracle 防护** — 实现 `sanitizeForTenantView`；新增 `SearchChannelsForTenant` / `SearchTagsForTenant` 删除 `key=?` 谓词；tenant-side 接口全部经过
9. **UI 变更** — super admin `/admin/platform/channels`；tenant 端 `/console/channels` 分区（我的 / 平台）；禁用渠道灰显 + 启用按钮；模式切换 Segment
10. **Cache 失效钩子** — mode / override 变更 → 单租户 routing cache + affinity `<tenantId>:*` 双清

每个 milestone 独立可 commit、可 review、可回滚。依赖关系：
- Milestone 1-2 先做（schema + guardrail 基础）
- Milestone 3 先于 4-5（helpers 是后续依赖）
- Milestone 6 和 7 有耦合：6 重构路由分组后，7 才能把 handler 逻辑清晰地按 role_scope 分叉；**不建议**把 route 拆分和 IDOR 修复混在同一个 commit
- Milestone 4-5（路由 + 计费）可并行（不同文件）
- Milestone 8 依赖 7（sanitize helper 在 handler 里挂）
- Milestone 9（UI）基本可在后端 milestone 5-8 中后期开始
