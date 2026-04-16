# SaaS 改造完成状态追踪

> 最后更新：2026-04-16
> 基于分支：`dev`（commit `34dad87`）
> 累计改动：96+ files, +4200/-1400

---

## 总览

| 阶段 | 名称 | 状态 | 完成度 |
|------|------|------|--------|
| Phase 0 | 预备治理 | **已完成** | 100% |
| Phase 1 | 身份、路由与核心数据隔离 | **已完成** | 100% |
| Phase 1.5 | Guardrail 升级 | **已完成** | 100% |
| Phase 2 | 剩余业务表租户化 | **已完成** | 100% |
| 遗留债务 | Raw SQL + Quota 热路径 | **已完成** | 100% |
| 安全修复 | 评审问题修复 | **已完成** | 100% |
| Phase 3 | 权限与成员体系 | **基础完成** | 70% |
| Phase 4 | 配置系统重构 | 未开始 | 0% |
| Phase 5 | 计费与商业化 | 部分基础存在 | 10% |
| Phase 6 | 前端 SaaS 后台 | 未开始 | 0% |
| Phase 7 | 运维、监控与审计 | 极少 | 5% |

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

## Phase 1.5：Guardrail 升级 ✅ 100%
**Commit**: `b1813af`

- `ExplicitTenantIDFromContext()` — background context 返回 0
- Create callback: fail-closed（TenantId=0 拒绝写入）
- Query/Update/Delete callback: ERROR 日志 + context 自动注入
- `WithTenantBypass(DB)` 用于迁移/bootstrap/超管操作
- `GetUserTenantId(userId)` model 层辅助函数
- Log 读写路径全面租户隔离
- 6 个单元测试

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
**Commits**: `620163d`, `a2016cf`, `485aca6`

| 修复 | 说明 |
|------|------|
| RowsAffected 检查 | UpdateMessage/RecallMessage/SubscriptionPlan 更新 0 行时返回 not found，不执行翻译删除 |
| 用户管理门禁 | GetUser/UpdateUser/DeleteUser/ManageUser 加 RequireTenantMembership |
| 用户列表查询 | 改为 JOIN tenant_memberships 子查询 |
| ProcessTopUpRebate | 邀请者/被邀请者更新加 tenant_id WHERE |
| Token 缓存校验 | Redis 缓存命中后校验 TenantId 一致性 |

---

## Phase 3：权限与成员体系 ⚠️ 70%
**Commit**: `105a145`

### 已完成
- TenantMembership 模型 (tenant_id + user_id + role + status)
- RequireTenantMembership 门禁函数
- /api/tenant/members CRUD API
- RequireTenantAdmin / RequirePlatformAdmin 中间件
- 认证中间件注入 platform_role + tenant_role + effectiveRole
- OAuth 全链路租户感知
- 路由按租户角色分组

### 未完成
- 前端接入 /api/tenant/members（成员管理 UI）
- 成员邀请邮件/链接流程
- 跨租户浏览器切换
- 租户创建/删除 API

---

## Phase 4：配置系统重构 — 未开始

- `OptionMap` 仍是进程级全局状态（62 个唯一 key，95+ 处读取）
- 需拆分为 PlatformConfigService / TenantConfigService / RuntimeConfigCache
- 读取优先级：租户配置 → 平台默认 → 代码默认

---

## Phase 5：计费与商业化 — 10%

- 用户级订阅/套餐模型已存在且已租户化
- 发票/充值已有 tenant_id
- 缺：租户级账单、配额上限、续费/停服逻辑

---

## Phase 6：前端 SaaS 后台 — 未开始

- Session 中有 tenant_id，但前端无租户切换 UI
- 缺：成员管理页面、租户级管理视图、品牌配置、自定义域名

---

## Phase 7：运维、监控与审计 — 5%

- Log 有 tenant_id 字段可过滤
- 缺：租户级限流/配额/告警/异常检测/数据导出

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
| User.ClearBinding | MEDIUM | 记录, 低频 |
| GetSiteRPM 全局查询 | MEDIUM | 记录, 限 platform admin |
| GetCacheSavings | MEDIUM | 记录, 限 platform admin |

---

## Commit 历史

```
34dad87 docs: 多租户改造完成状态文档
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
