# 2026-04-16 SaaS 全路线图（补档版）

> 说明：原路线图文件缺失，本文件依据当前仓库代码、现存完成状态文档和多租户提交记录重建。
> 基线：`dev` 分支，已核对至 commit `0a44d2f`
> 关联文档：[2026-04-16-completion-status.md](2026-04-16-completion-status.md) | [2026-04-16-saas-multi-tenancy-phase1.md](2026-04-16-saas-multi-tenancy-phase1.md) | [2026-04-16-phase0-audit.md](2026-04-16-phase0-audit.md)

---

## 1. 目标

把当前单站点后台演进为“共享代码库 + 租户隔离 + 租户级运营面板 + 租户级套餐与告警”的 SaaS 平台，同时保留默认租户兼容旧部署。

核心目标：

- 请求进入系统后，`tenant_id` 必须在路由、认证、控制器、模型、日志、计费链路中持续可用。
- 所有租户业务数据必须显式隔离，默认拒绝无 `tenant_id` 的写入和敏感查询。
- 平台级配置和租户级配置必须分层，避免继续把所有能力都堆在全局 `OptionMap`。
- 租户必须有独立的成员体系、计划/限额、指标与告警。
- 前端最终要形成独立的 SaaS Console，而不是继续让租户管理员直接使用平台后台的通用页面。

---

## 2. 当前基线

截至当前代码，后端多租户主干已经不是“规划中”，而是“基础框架已落地”：

- 租户识别已落地：[middleware/tenant.go](../../../middleware/tenant.go) 在 API 和 Relay 路由最前面解析 `tenant_id`。
- 请求上下文已贯通：`tenant_id` 会写入 `gin.Context` 与 `c.Request.Context()`，模型层可通过 [model/tenant_scope.go](../../../model/tenant_scope.go) 读取。
- 已有 28 张 tenant-scoped 表注册 GORM guardrail，核心业务隔离已经形成框架。
- 成员体系、租户 CRUD、邀请、租户配置、租户计划、指标、告警、租户 API 限流都已有后端接口。
- Relay 已执行租户级配额、RPM、模型访问控制。
- 前端仍缺租户 Console，当前只有一批通用后台页面和用户页面可复用。

一句话概括：后端骨架已成，前端 SaaS Console 和商业化闭环还没补完。

---

## 3. 阶段总览

| 阶段 | 目标 | 当前状态 | 已有产出 | 仍缺内容 |
|------|------|----------|----------|----------|
| Phase 0 | 预治理审计 | ✅ 已完成 | 表分类、热路径、SQL 风险、OptionMap 面 | 原始审计文档已丢失，现已补档 |
| Phase 1 | 身份、路由、核心数据隔离 | ✅ 已完成 | TenantResolve、核心表 `tenant_id`、默认租户回填 | 无 |
| Phase 1.5 | Guardrail 收口 | ⚠️ 85% | Create fail-closed、30 表注册、Raw SQL 已过滤 | **Query/Update/Delete 仍为 warn-only，未 fail-closed** |
| Phase 2 | 业务表租户化 | ✅ 已完成 | 金融/发票/工单/佣金/消息/分析表 tenant 化 | 无 |
| 债务清理 | Raw SQL 与热路径修补 | ✅ 已完成 | purchase/ip/log/quota 等高风险路径清理 | 长尾查询仍需持续 review |
| 安全修复 | 评审问题收口 | ✅ 已完成 | membership 门禁、RowsAffected 检查、缓存租户校验 | 持续回归即可 |
| Phase 3 | 权限与成员体系 | ⚠️ 后端 85% | membership、角色中间件、租户 CRUD、邀请 | 缺成员管理/租户切换 UI、邀请邮件通知 |
| Phase 4 | 配置系统三层化 | ⚠️ **20%** | `tenant_options`、19 key、三层函数已实现 | **全站 197 处直读 OptionMap，`GetConfig()` 仅 4 处调用；typed schema、前端面板均缺** |
| Phase 5 | 租户计费与套餐执行 | ⚠️ **75%** | quota/RPM/TPM/allowed_models/max_tokens/max_channels 6 项有运行时拦截 | **无账单/续费/停服体系** |
| Phase 6 | SaaS Console 前端 | ❌ 未开始 | 只有可复用的通用后台页面 | 租户切换、成员/计划/配置/指标页面 |
| Phase 7 | 运维、监控、审计 | ⚠️ **30%** | dashboard/trend/model usage/alerts API 已有 | **告警为无状态即时计算，无持久化；前端 0%；无审计日志导出** |

---

## 4. 分阶段说明

### Phase 0：预治理审计

目标不是写代码，而是回答三件事：

- 哪些表必须 tenant 化，哪些表应保持全局共享。
- 哪些调用链路在 tenant 化后最容易漏筛选条件。
- 哪些系统配置不能继续停留在全局 `OptionMap`。

补档版见：[2026-04-16-phase0-audit.md](2026-04-16-phase0-audit.md)

### Phase 1：身份、路由与核心数据隔离

关键交付：

- `TenantResolve` 负责 header/subdomain/default tenant 三段式解析。
- `tenant_id` 注入到 `gin.Context` 和 `request context`。
- 核心表 `users / tokens / channels / abilities / logs` 增加 `tenant_id`。
- 默认租户引导与历史数据回填。
- 渠道缓存改为 `tenantId:group` 复合键，避免跨租户取错能力集。

补档版见：[2026-04-16-saas-multi-tenancy-phase1.md](2026-04-16-saas-multi-tenancy-phase1.md)

### Phase 1.5：Guardrail 升级（85%）

已交付：

- `ExplicitTenantIDFromContext()` 把”业务 fallback”与”guardrail 判断”分开。
- Create 路径：无租户上下文时 **fail-closed 拒绝写入** tenant-scoped 表。✅
- Query/Update/Delete：自动注入显式上下文中的 `tenant_id`，否则记录 ERROR 日志。
- `WithTenantBypass()` 为迁移、bootstrap、平台级跨租户管理保留显式逃生口（42 处使用均合理）。
- 30 张表已注册 guardrail，Raw SQL 路径已手动过滤。

⚠️ **关键未完成项**：Query/Update/Delete 目前仅为 **warn-only**（记录日志但不拦截），尚未升级为 fail-closed。这意味着无 tenant_id 的查询/更新/删除仍能执行成功，框架只记录错误而非阻止操作。

这一步的初衷是把”依赖开发者记得写 where 条件”升级为”框架默认防漏”，但目前 Create 做到了，Query/Update/Delete 还停留在”记录但不拦截”阶段。

### Phase 2：业务表租户化

已覆盖：

- 金融：充值、兑换码、订阅、预扣费记录
- 发票：申请、明细、上传、文件
- 工单：工单、回复、附件、上传
- 返佣：返利日志、划转请求
- 消息：站内消息、已读状态
- 分析：登录/IP、配额快照、Agent 日志/报告

这一步后，租户不再只体现在用户和 token，而是贯穿业务闭环。

### Phase 3：权限与成员体系

后端已落地：

- `tenant_memberships` 模型、角色与状态语义
- `TenantAdminAuth` / `PlatformAdminAuth`
- `/api/tenant/members`
- `/api/platform/tenants`
- `/api/tenant/invite/accept`
- DeleteSelf / DeleteUser / OAuth 管理 / ClearBinding 均已对齐 membership 语义

仍缺前端：

- 成员列表、邀请、移除、禁用、角色切换页面
- 当前租户信息页与基础设置页
- 浏览器内租户切换与 session 刷新策略

### Phase 4：配置系统三层化（20%）

现状 — 管道已通，但全站几乎没在用：

- 已有 `tenant_options` 表 + CRUD + 缓存失效
- 已有 19 个可租户覆盖 key（品牌展示、功能开关、注册认证、计费展示）
- 已有三层读取函数：`GetConfig()` / `GetConfigBool()` / `GetConfigInt()` / `GetConfigFloat64()`
- 已有 `/api/tenant/config` GET / PUT / DELETE 端点

⚠️ **核心问题：三层机制形同虚设**

- `GetConfig()` 仅在 **4 个文件** 中被调用
- 全站直接读 `common.OptionMap` 的地方有 **197 处**
- 即使租户配置了覆盖值，绝大多数业务路径仍走全局 OptionMap，租户覆盖实际不生效

仍缺：

- **将 197 处 OptionMap 直接读取迁移到 GetConfig() 调用**（这是让三层机制真正生效的前提）
- `OptionMap` typed schema / 配置项元数据与分组
- 平台/租户配置的表单化管理前端
- 把 161 个全局 key 中适合下放的部分继续切到租户层

### Phase 5：计费与商业化（75%）

已落地（6/7 限制有运行时执行）：

- `tenant_plans` 模型 + 新租户自动 free plan + 缓存
- 计划字段齐全：quota_limit、rpm_limit、tpm_limit、max_members、max_tokens、max_channels、allowed_models、status、expires_at
- Relay 侧 4 项检查已接入：`CheckTenantQuota` ✅ / `CheckTenantRPM` ✅ / `CheckTenantTPM` ✅ / `CheckTenantModelAccess` ✅
- TPM 累计：`IncrementTenantTPM` 已接入文本 / WSS / Audio 三条成功计费路径
- 创建时上限校验：`AddToken` 校验 `MaxTokens`、`AddChannel` 校验 `MaxChannels`（含 batch，best-effort + 告警兜底）
- 邀请流程接入 `max_members` 上限
- 平台侧 `/api/platform/tenants/plans` + `PUT /:id/plan`，租户侧 `GET /api/tenant/plan`

| 限制 | 运行时执行 | 说明 |
|------|-----------|------|
| `quota_limit` | ✅ | Relay 前检查 |
| `rpm_limit` | ✅ | Relay 前检查（Redis/内存） |
| `allowed_models` | ✅ | Relay 前检查 |
| `tpm_limit` | ✅ | Relay 前检查 + 3 条 billing 路径累计（Plan 1 交付） |
| `max_tokens` | ✅ | AddToken 内校验（Plan 1 交付，best-effort） |
| `max_channels` | ✅ | AddChannel 内校验（Plan 1 交付，best-effort） |
| `max_members` | ⚠️ | 仅邀请时检查 |

仍缺：

- 租户级账单/账本（无 tenant_bills 表）
- 套餐续费/升级/降级逻辑
- 到期停服/宽限期/自动恢复状态机
- 计划变更与告警联动

### Phase 6：SaaS Console 前端

这是当前最明显的缺口。

需要新增的租户控制台能力：

- 租户切换器
- 成员管理
- 租户计划页
- 租户配置页
- 租户 dashboard / trend / alerts 页
- 品牌配置与自定义内容页

可复用但不能直接当 SaaS Console 的现有页面：

- `/console/topup`
- `/console/site-rpm`
- `InvoiceAdmin`
- `RebateSettings`
- `PurchaseAnalytics`

### Phase 7：运维、监控与审计（30%）

已落地（后端 API 层）：

- 租户 dashboard summary（成员/令牌/渠道/quota/request 统计）
- 7-90 天 usage trend
- model usage 聚合
- 8 种告警类型：plan_disabled/expired/expiring、quota_80/100、rpm_high、member_limit、token_limit
- API 级 tenant rate limit（600/60s，Redis 后端）
- 4 个 API 端点：`/api/tenant/dashboard`、`/usage/trend`、`/usage/models`、`/alerts`

⚠️ **关键偏差**：告警为无状态即时计算

- `CheckTenantAlerts()` 每次调用时实时计算，无数据库表存储历史
- 无告警确认/解除/去重机制
- 无定时巡检任务，仅在 API 调用时触发
- 无主动推送能力（邮件/Webhook/站内信）

仍缺：

- 告警持久化表（`tenant_alerts`）与状态管理
- 告警推送渠道
- 租户审计日志导出（无专用审计日志表）
- 异常检测与长期时序
- 面向租户的可视化监控前端（API 已有，UI 为 0%）

---

## 5. 推荐执行顺序（2026-04-17 修订）

> 上一版是线性 Phase 6 → 4 → 5 → 7。实际做完 Plan 1（Phase 5 TPM/max_tokens/max_channels 强制执行）后重新梳理依赖，发现**线性顺序浪费并行机会**。下文按"硬依赖 / 软依赖 / 独立任务"重排。

### 5.1 剩余工作依赖图

```
                       ┌──────────────────────────┐
                       │ Plan 3: Guardrail        │  独立
                       │ fail-closed 升级         │  (部署前做)
                       └──────────────────────────┘

                       ┌──────────────────────────┐
                       │ Plan 4: OptionMap 懒迁移 │  独立 / 按需
                       └──────────────────────────┘

                       ┌──────────────────────────┐
                       │ 邀请邮件投递 (SMTP 基础) │  独立
                       └──────────────────────────┘
                                  │ 共用 SMTP
                                  ▼
   ┌──────────────┐        ┌─────────────┐        ┌─────────────────┐
   │ 告警持久化    │───────▶│ 告警推送     │        │ Phase 3 邀请    │
   │ tenant_alerts │         │ 邮件/Webhook│        │ 邮件流          │
   └──────────────┘         └─────────────┘        └─────────────────┘
                                                            │
                                                            │ 前端依赖
                                                            ▼
                       ┌──────────────────────────┐
                       │ Plan 2: Phase 6 前端     │◀─── 监控/告警前端
                       │ SaaS Console 框架        │◀─── 账单/套餐管理 UI
                       │                          │◀─── 发票 UI
                       └──────────────────────────┘
                                  ▲  (展示载体)
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
┌──────────────┐          ┌──────────────┐          ┌──────────────┐
│ 账单体系      │          │ 套餐续费/    │          │ 到期停服/    │
│ tenant_bills │          │ 升级/降级    │          │ 状态机       │
└──────────────┘          └──────────────┘          └──────────────┘
                                                            │ 触发通知
                                                            ▼
                                                   [复用告警推送]
```

### 5.2 三类依赖

**硬依赖（必须先做前者）**
1. 告警推送 ← 告警持久化（没事件表就没事件可推）
2. 监控/告警前端 ← Plan 2 框架（进 Console 才能看）
3. 到期停服状态机的用户通知 ← 告警推送

**软依赖（共享基础设施）**
1. 告警邮件推送 与 Phase 3 邀请邮件 共用 SMTP 发送基础 — 谁先做谁建
2. Plan 2 前端邀请流程想跑通需要邀请邮件投递
3. 套餐变更通知（若做）走告警推送通道

**完全独立**
1. **Plan 3**（Guardrail fail-closed）— 前置 Phase 2 已完成，可随时做
2. **Plan 4**（OptionMap 懒迁移）— 按需单点迁，零依赖
3. **告警持久化后端** — 独立建表 + 改 CheckTenantAlerts
4. **账单后端** — 独立建 tenant_bills / tenant_ledgers

### 5.3 分阶段执行计划

**阶段 A — 并行起步**（三条线并行）
- 🔵 **Plan 2 Phase 6 前端框架** + 租户切换/成员/计划/配置页面（只接已有 API）
- 🟢 **邀请邮件投递**（Plan 2 成员邀请流程需要；同时是告警邮件的基础）
- 🟡 **告警持久化后端**（`tenant_alerts` 表 + ack/dismiss API + CheckTenantAlerts 改写）

**阶段 B — Plan 2 框架就位后**
- 🔵 **监控前端 / 告警前端**（挂到 Plan 2 框架）
- 🟡 **账单后端** + **账单前端**（tenant_bills / tenant_ledgers + Console 展示）
- 🟢 **告警推送**（依赖告警持久化 + 邀请邮件 SMTP 已建）

**阶段 C — 功能齐全后**
- 🟣 **Phase 5 套餐续费/升级/降级**（依赖 subscription_orders 基础 + 前端可用）
- 🟣 **Phase 5 到期停服状态机**（触发告警推送通知用户）
- 📎 **发票管理员 UI / 用户发票页**（挂到 Plan 2 框架）

**阶段 D — 部署前安全检查**
- 🔴 **Plan 3 Guardrail fail-closed 升级**（warn-only 上线 = 裸奔）
  - 前提：升级前全量 grep 扫描，确认所有 caller tenant-aware
  - 升级 Query/Update/Delete callback 为 fail-closed
  - `ability.go` 的 `FixAbility()` TRUNCATE 显式 PlatformAdmin 校验

**阶段 E — 按需，可能永远不做**
- 🟠 **Plan 4 OptionMap → GetConfig 迁移**（YAGNI：只在某 key 真需要租户覆盖时单点迁，不 mass migrate）

### 5.4 核心判断

- **Plan 2 是主干**：账单、套餐、告警、监控、发票的后端做完都要前端才有用户价值，但 Plan 2 本身只需现有 API 就能起步。
- **Plan 3 是出厂前的安全检查**：不做不能部署，但做早了可能挡住还没 tenant 化的新代码 — 放在临近部署时做。
- **Plan 4 懒做**：没真实租户反馈前，不知道 19 个可覆盖 key 里哪些真的需要覆盖（YAGNI 违反）。
- **Phase 5/7 后端可在 Plan 2 期间并行推**：独立任务不必等 Plan 2 完成。

---

## 6. 风险与约束

- 默认租户兼容性不能破：`DefaultTenantId = 1` 仍承担旧部署兜底。
- `DB.Table()` / `Raw()` 天生绕过 GORM guardrail，必须继续人工 review。
- 会话租户和请求租户不一致时会被拒绝，前端租户切换必须处理 session 刷新。
- `OptionMap` 仍是进程级全局状态，Phase 4 完成前不应继续大量新增全局配置。
- 平台管理员的跨租户操作必须显式使用 `WithTenantBypass()` 或平台级路由，不能混入普通租户调用链。

---

## 7. 关键代码落点

- 路由入口：[router/api-router.go](../../../router/api-router.go) | [router/relay-router.go](../../../router/relay-router.go)
- 租户解析：[middleware/tenant.go](../../../middleware/tenant.go)
- 权限体系：[middleware/auth.go](../../../middleware/auth.go) | [middleware/tenant_role.go](../../../middleware/tenant_role.go)
- guardrail：[model/tenant_scope.go](../../../model/tenant_scope.go)
- 默认租户与回填：[model/main.go](../../../model/main.go) | [model/tenant.go](../../../model/tenant.go)
- 租户配置：[model/tenant_option.go](../../../model/tenant_option.go) | [service/tenant_config.go](../../../service/tenant_config.go)
- 租户计划与执行：[model/tenant_plan.go](../../../model/tenant_plan.go) | [service/tenant_quota.go](../../../service/tenant_quota.go)
- 指标与告警：[service/tenant_metrics.go](../../../service/tenant_metrics.go) | [service/tenant_alerts.go](../../../service/tenant_alerts.go)
