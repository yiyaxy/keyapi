# SaaS 改造完成状态追踪

> 最后更新：2026-04-16
> 基于分支：`dev`（已核对至 commit `0a44d2f`）
> 补充来源：`docs/multi-tenant-completion-status.md`、`VERSIONS.md`、`ToDos.md`、后续多租户提交

---

## 总览

| 阶段 | 名称 | 状态 | 完成度 |
|------|------|------|--------|
| Phase 0 | 预备治理 | **已完成** | 100% |
| Phase 1 | 身份、路由与核心数据隔离 | **已完成** | 100% |
| Phase 1.5 | Guardrail 升级 | **基础设施完成，Query/Update/Delete 仍为 warn-only** | 85% |
| Phase 2 | 剩余业务表租户化 | **已完成** | 100% |
| 遗留债务 | Raw SQL + Quota 热路径 | **已完成** | 100% |
| 安全修复 | 评审问题修复 | **已完成** | 100% |
| Phase 3 | 权限与成员体系 | **后端基本完成，前端 0%** | 85% |
| Phase 4 | 配置系统重构 | **管道已通，全站采用率极低** | 20% |
| Phase 5 | 计费与商业化 | **6/7 限制有运行时执行，无账单体系** | 75% |
| Phase 6 | 前端 SaaS 后台 | **Part A 已完成（租户信息 + 成员管理）** | 15% |
| Phase 7 | 运维、监控与审计 | **指标/告警 API 已有，告警无持久化，前端 0%** | 30% |

---

## Phase 0：预备治理 ✅ 100%

| 产出物 | 状态 | 文档 |
|--------|------|------|
| 数据分类表（43 表） | ✅ | [phase0-audit.md](2026-04-16-phase0-audit.md) §2 |
| 热路径函数清单（42 个） | ✅ | [phase0-audit.md](2026-04-16-phase0-audit.md) §3 |
| 风险 SQL 清单（89 条） | ✅ | [phase0-audit.md](2026-04-16-phase0-audit.md) §4 |
| OptionMap 全局状态清单（62+ key） | ✅ | [phase0-audit.md](2026-04-16-phase0-audit.md) §5 |
| 改造任务矩阵（23 项） | ✅ | [phase0-audit.md](2026-04-16-phase0-audit.md) §6 |

---

## Phase 1：身份、路由与核心数据隔离 ✅ 100%
**Commit**: `4fe3fc6`

- Tenant 模型 + DefaultTenantId 常量
- TenantResolve 中间件（域名 → tenant_id）
- Session 注入 tenant_id
- 5 核心表 tenant_id: users, tokens, channels, abilities, logs
- Channel 缓存 tenantGroupKey 复合键
- AutoMigrate + backfillTenantId
- GetTokenByKeyWithContext / GetUserByIdWithContext 租户隔离

---

## Phase 1.5：Guardrail 升级 ⚠️ 85%
**Commit**: `b1813af`

### 已完成
- `ExplicitTenantIDFromContext()` — background context 返回 0
- Create callback: **fail-closed**（TenantId=0 拒绝写入）✅
- Query/Update/Delete callback: ERROR 日志 + context 自动注入
- `WithTenantBypass(DB)` 用于迁移/bootstrap/超管操作（42 处使用，均为合理跨租户场景）
- `GetUserTenantId(userId)` model 层辅助函数
- Log 读写路径全面租户隔离
- 30 张表已注册 guardrail
- Raw SQL（7 处 `DB.Raw()`、19 处 `DB.Table()`）均已手动加 tenant_id 过滤
- 6 个单元测试

### ⚠️ 关键偏差：Query/Update/Delete 仍为 warn-only
- Create 是真正的 fail-closed（tenant_id=0 拒绝写入）
- **Query/Update/Delete 仅记录 ERROR 日志，但允许操作继续执行**
- 代码注释标注 "Phase 2 will become fail-closed when all callers are confirmed tenant-aware"
- 实际含义：未加 tenant_id 的查询/更新/删除不会被拦截，只会被记录
- 风险等级：MEDIUM — 依赖开发者不犯错，而非框架强制防护

### 未完成
- Query/Update/Delete 升级为 fail-closed
- `ability.go` 中 `FixAbility()` 的 TRUNCATE 操作缺少显式 PlatformAdmin 校验（依赖路由层保护）

---

## Phase 2：业务表租户化 ✅ 100%
**Commit**: `3b1f7b8`

21 张业务表全部加 TenantId + guardrail 注册 + 回填逻辑:

| 分类 | 表 |
|------|-----|
| 金融 | top_ups, redemptions, subscription_plans, subscription_orders, user_subscriptions, subscription_pre_consume_records |
| 发票 | invoice_applications, invoice_items, invoice_uploads, invoice_files |
| 工单 | tickets, ticket_replies, ticket_attachments, ticket_uploads |
| 佣金 | aff_rebate_logs, aff_transfer_requests |
| 消息 | messages, message_read_statuses |
| 分析 | user_ip_records, quota_data, agent_logs, agent_reports |

~98 个 CRUD 函数加 tenantId 参数。所有 Controller handler 传入 `middleware.GetTenantId(c)`。所有 Create 路径显式设 TenantId。

---

## 遗留债务清理 ✅ 100%
**Commit**: `c3294ca`

| 类型 | 数量 | 覆盖 |
|------|------|------|
| purchase_analytics.go DB.Table | 36 条 | 14 个分析函数 |
| ip_analytics.go DB.Raw + GORM | 6+14 条 | 14 个 IP 分析函数 |
| log.go 高风险路径 | 6 条 | SumUsedToken, RPM/TPM, channel/user 解析 |
| 零散高风险 | 3 条 | channel_monitor, model_meta, usedata |
| Quota 热路径 | 7 个函数 | GetUserQuota, Increase/DecreaseUserQuota, UpdateUserUsedQuotaAndRequestCount, Increase/DecreaseTokenQuota |
| RelayInfo | +TenantId 字段 | 全链路透传 |

---

## 安全修复 ✅ 100%
**Commits**: `620163d`, `a2016cf`, `485aca6`, `0ef6f77`, `1f18fb4`, `f604307`

| 修复 | 说明 |
|------|------|
| RowsAffected 检查 | UpdateMessage/RecallMessage/SubscriptionPlan 更新 0 行时返回 not found，不执行翻译删除 |
| 用户管理门禁 | GetUser/UpdateUser/DeleteUser/ManageUser 加 RequireTenantMembership |
| 用户列表查询 | 改为 JOIN tenant_memberships 子查询 |
| ProcessTopUpRebate | 邀请者/被邀请者更新加 tenant_id WHERE |
| Token 缓存校验 | Redis 缓存命中后校验 TenantId 一致性 |
| DeleteUser/DeleteSelf 语义 | 删除逻辑改为以 membership 为准，而不是错误依赖 home tenant |
| OAuth 管理接口 | 管理操作补 tenant membership 门禁 |
| AdminClearUserBinding | 增加租户门禁，guest member 走用户真实 TenantId 执行解绑 |

---

## Phase 3：权限与成员体系 ⚠️ 85%
**Commits**: `105a145`, `4fbe038`, `0ef6f77`, `1f18fb4`, `f604307`

### 已完成
- TenantMembership 模型 (tenant_id + user_id + role + status)
- RequireTenantMembership 门禁函数
- /api/tenant/members CRUD API
- RequireTenantAdmin / RequirePlatformAdmin 中间件
- 认证中间件注入 platform_role + tenant_role + effectiveRole
- OAuth 全链路租户感知
- Platform Admin: CreateTenant / DeleteTenant API
- 邀请流程后端已打通：InviteMember / AcceptInvite、existing user 直加入、48 小时 token、接受时二次校验成员上限
- 默认租户最后一个管理员保护
- DeleteUser / DeleteSelf / AdminClearUserBinding / OAuth 管理接口 已对齐 membership 语义
- 路由按租户角色分组

### 未完成
- 前端接入 /api/tenant/members（成员管理 UI）
- 邀请邮件/站内通知投递
- 跨租户浏览器切换
- 租户信息 / 计划 / 配置页面前端

---

## Phase 4：配置系统重构 ⚠️ 20%
**Commit**: `4fbe038`

### 已完成
- `tenant_options` 模型已落地，支持租户级覆盖和缓存失效
- `/api/tenant/config` GET / PUT / DELETE 已提供
- 已明确 19 个可租户覆盖 key（品牌展示、开关项、注册登录限制、计费展示等）
- 三层读取优先级函数已实现：`GetConfig()` / `GetConfigBool()` / `GetConfigInt()` / `GetConfigFloat64()`

### ⚠️ 关键偏差：三层机制几乎未被采用
- `GetConfig()` 仅在 **4 个文件** 中被调用（controller/misc.go、controller/tenant_config.go 等）
- 全站直接读 `OptionMap` 的地方有 **197 处**
- 三层优先级机制形同虚设 — 管道已通但水量极小
- 即使租户配置了覆盖值，绝大多数业务路径仍走全局 OptionMap，租户覆盖不生效

### 未完成
- 将 197 处 `OptionMap` 直接读取迁移到 `GetConfig()` 调用（核心阻塞项）
- `OptionMap` typed schema / 配置项元数据与分组
- 161 个全局 key 中适合下放的部分继续切到租户层
- 前端配置管理面板

---

## Phase 5：计费与商业化 ⚠️ 75%
**Commit**: `0a44d2f`

### 已完成
- `TenantPlan` 模型已落地：quota_limit、rpm_limit、tpm_limit、max_members、max_tokens、max_channels、allowed_models、status、expires_at
- 新租户自动创建默认 free plan
- 平台侧已提供 `/api/platform/tenants/plans` 和 `PUT /api/platform/tenants/:id/plan`
- 租户管理员可读当前计划：`GET /api/tenant/plan`
- Relay 执行链路已接入 3 项校验：`CheckTenantQuota()` ✅ / `CheckTenantRPM()` ✅ / `CheckTenantModelAccess()` ✅
- 成员邀请流程已接入 `max_members` 上限检查

### 7 个计划字段的运行时执行情况（Plan 2 后）
| 限制类型 | 模型字段 | 运行时拦截 | 说明 |
|----------|---------|-----------|------|
| quota_limit | ✅ | ✅ | Relay 前检查，超限返 429 |
| rpm_limit | ✅ | ✅ | Relay 前检查，Redis/内存计数 |
| allowed_models | ✅ | ✅ | Relay 前检查，白名单拦截 |
| tpm_limit | ✅ | ✅ | CheckTenantTPM() + IncrementTenantTPM()，Redis/内存双模式 |
| max_tokens | ✅ | ✅ | AddToken 内校验 plan.MaxTokens，配 CountTenantTokens |
| max_channels | ✅ | ✅ | AddChannel 内校验（单+批量），配 CountTenantChannels |
| max_members | ✅ | ⚠️ | 仅在邀请流程检查，告警用于 80% 阈值 |

### 未完成
- 租户级账单/账本（无 tenant_bills / tenant_ledgers 表）
- 套餐续费/升级/降级逻辑
- 到期停服/宽限期/自动恢复状态机
- 计划变更与告警联动

---

## Phase 6：前端 SaaS 后台 ⚠️ 15%

### 已完成（Part A — 2026-04-17）
- 前端 TS 类型：`web/src/types/tenant.ts`（Tenant / TenantMembership / TenantMemberListItem / 常量）
- `X-Tenant-Id` 请求头注入：`web/src/helpers/api.js` 加请求拦截器，登录/登出 header 自动同步
- 租户信息页：`/console/tenant-info`（view/edit name/status，GET /api/tenant/info + PUT /api/tenant/）
- 成员管理页：`/console/tenant-members`（list + invite + 角色/状态编辑 + 移除；走 /api/tenant/members CRUD + /api/tenant/invite）
- 侧边栏：`admin` 分组新增 `tenantInfo` / `tenantMembers` 两个入口

### 未完成
- Part B：租户计划页（/api/tenant/plan）、租户配置页（/api/tenant/config）、平台级租户管理（/api/platform/tenants）、品牌配置、自定义域名
- Part C：监控前端（dashboard/trend/models/alerts 已有 API，UI 未做）
- Part D：跨租户浏览器切换（多 membership 用户选 tenant）、`TenantAdminRoute`（tenant-only admin 的前端路由守卫）
- 邀请邮件/站内通知投递（阶段 A 独立 plan）
- 现有 `/console/topup`、`/console/site-rpm`、`InvoiceAdmin`、`RebateSettings` 仍是通用后台页面，未 Console 化

---

## Phase 7：运维、监控与审计 ⚠️ 30%
**Commits**: `4fbe038`, `0a44d2f`

### 已完成
- 租户 dashboard 汇总已落地：成员、令牌、渠道、累计/当日 quota 与 request
- 租户 usage trend 已支持 7-90 天
- 租户 model usage 聚合已落地
- 9 种告警类型已接通 Plan：`plan_disabled`、`plan_expired`、`plan_expiring`、`quota_80`、`quota_100`、`rpm_high`、`member_limit`、`token_limit`、`channel_limit`
- `TenantAPIRateLimit()` 已挂到 `apiRouter`（600/60s，Redis 后端）
- 4 个 API 端点已注册：`GET /api/tenant/dashboard`、`/usage/trend`、`/usage/models`、`/alerts`

### ⚠️ 关键偏差：告警为无状态即时计算，非持久化事件
- `CheckTenantAlerts()` 每次 API 调用时实时计算，**无数据库表存储告警历史**
- 不存在告警确认/解除/去重机制
- 不存在定时告警巡检任务
- 告警仅在调用 API 时触发，无主动推送能力

### 未完成
- 告警持久化（需 `tenant_alerts` 表存储状态、时间戳、确认状态）
- 告警推送渠道（邮件/站内信/Webhook）
- 租户级审计日志导出（无专用审计日志表）
- 异常检测与长期时序存储
- 面向租户的监控前端页面（API 已有，UI 为 0%）

---

## 并行完成的配套能力

- 商业化基础：管理员订单管理 API/页面、用户首选订阅扣费、个性化邀请返现设置、订阅套餐 `promo_highlights`、钱包 `/console/topup` UI 重构 已落地，可直接复用到后续租户套餐与自助续费
- 发票基础：invoice models / service / presign / finalize 已落地；`InvoiceAdmin` 已支持票通支付宝乐企联用支付信息录入；用户发票页和完整管理员流程 UI 仍待补
- 运维分析基础：管理员 analytics 面板、PurchaseAnalytics 口径修正、`site_rpm_snapshots` 与 `/api/analytics/site-rpm/history` 以及 `/console/site-rpm` 已落地，可复用为租户监控视图

---

## 评审清单最终状态

| 项目 | 严重度 | 状态 |
|---|---|---|
| 批量更新路径传 tenantId | HIGH | ✅ |
| ProcessSubscriptionRebate tenant WHERE | HIGH | ✅ |
| ProcessTopUpRebate tenant WHERE | HIGH | ✅ |
| FillUserByXxx 租户过滤 | HIGH | ✅ |
| 唯一性检查租户过滤 | HIGH | ✅ |
| 用户管理接口跨租户访问 | HIGH | ✅ |
| 0行更新翻译误删 | HIGH | ✅ |
| GetSubscriptionOrderByTradeNo | MEDIUM | ✅ |
| User.Update/Edit tenant | MEDIUM | ✅ |
| Token Redis 缓存 tenant | MEDIUM | ✅ |
| 用户列表 membership 查询 | MEDIUM | ✅ |
| Channel 管理接口 | MEDIUM | ✅ |
| DeleteUser/DeleteSelf membership 语义 | MEDIUM | ✅ |
| OAuth 管理接口跨租户访问 | MEDIUM | ✅ |
| AdminClearUserBinding / guest member 语义 | MEDIUM | ✅ |
| GetSiteRPM 全局查询 | MEDIUM | 记录, 限 platform admin |
| GetCacheSavings | MEDIUM | 记录, 限 platform admin |

---

## Commit 历史

``` 
0a44d2f feat(multi-tenant): Sprint 2 并行交付 — 租户计费/配额执行 + 告警接通Plan + 邀请限额
4fbe038 feat(multi-tenant): Sprint 1 并行交付 — 租户CRUD/邀请 + 配置系统 + 监控指标
f604307 fix(multi-tenant): AdminClearUserBinding 加租户门禁 + 修复 guest member 语义
1f18fb4 fix(multi-tenant): OAuth 管理接口加租户门禁 + DeleteSelf 对齐 membership
0ef6f77 fix(multi-tenant): DeleteUser 语义对齐 membership 体系
c9f56c4 docs: 多租户改造完成状态文档
105a145 feat(multi-tenant): Phase 3 基础 — 成员体系、角色中间件、OAuth 租户绑定
485aca6 fix(multi-tenant): ProcessTopUpRebate 加 tenant WHERE + Token 缓存租户校验
a2016cf fix(multi-tenant): 用户管理接口加租户门禁 + 列表查询改走 membership
620163d fix(multi-tenant): 修复跨租户 0 行更新静默成功导致翻译被误删
c3294ca fix(multi-tenant): 清理遗留债务 — Raw SQL 租户过滤 + Quota 热路径隔离
3b1f7b8 feat(multi-tenant): Phase 2 — 业务表租户化，21 表全量 tenant_id 隔离
b1813af feat(multi-tenant): Phase 1.5 — 租户隔离收口与 guardrail 升级
4fe3fc6 feat(multi-tenant): Phase 1 — 身份、路由与核心数据隔离
```

---

## 关联文档

- 总路线图：[2026-04-16-saas-full-roadmap-zh.md](2026-04-16-saas-full-roadmap-zh.md)
- Phase 1 实施文档：[2026-04-16-saas-multi-tenancy-phase1.md](2026-04-16-saas-multi-tenancy-phase1.md)
- Phase 0 审计产出：[2026-04-16-phase0-audit.md](2026-04-16-phase0-audit.md)
- 综合完成文档：[multi-tenant-completion-status.md](../../../docs/multi-tenant-completion-status.md)
- 变更记录补充：[VERSIONS.md](../../../VERSIONS.md)
- 任务清单补充：[ToDos.md](../../../ToDos.md)
