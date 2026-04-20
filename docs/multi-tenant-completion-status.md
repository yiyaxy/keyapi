# Multi-Tenant SaaS 改造完成状态

**最后更新**: 2026-04-16
**分支**: dev
**累计改动**: 96+ files, +4200/-1400

---

## 阶段完成情况

### Phase 0: 预治理审计 ✅
- 43 张表分类（租户隔离 / 全局共享 / 系统表）
- 42 个热路径函数审计
- 89 条 SQL 操作编目
- 62+ OptionMap 键值清单
- 23 项转化矩阵

### Phase 1: 身份、路由与核心数据隔离 ✅
**Commit**: `4fe3fc6`

- Tenant 模型 + DefaultTenantId 常量
- TenantResolve 中间件（域名 → tenant_id）
- Session 注入 tenant_id
- 5 核心表加 tenant_id: users, tokens, channels, abilities, logs
- Channel 缓存加 tenantGroupKey 复合键
- AutoMigrate + backfillTenantId

### Phase 1.5: Guardrail 升级 ✅
**Commit**: `b1813af`

- `ExplicitTenantIDFromContext()` — background context 返回 0 而非 DefaultTenantId
- Create callback: fail-closed（TenantId=0 拒绝写入）
- Query/Update/Delete callback: ERROR 日志（将在后续升级为 fail-closed）
- `WithTenantBypass(DB)` 用于迁移/bootstrap/超管操作
- 6 个单元测试覆盖 context 提取 + guardrail 行为

### Phase 2: 业务表租户化 ✅
**Commit**: `3b1f7b8`

21 张业务表全部加 TenantId:
- **金融**: top_ups, redemptions, subscription_plans, subscription_orders, user_subscriptions, subscription_pre_consume_records
- **发票**: invoice_applications, invoice_items, invoice_uploads, invoice_files
- **工单**: tickets, ticket_replies, ticket_attachments, ticket_uploads
- **佣金**: aff_rebate_logs, aff_transfer_requests
- **消息**: messages, message_read_statuses
- **分析**: user_ip_records, quota_data, agent_logs, agent_reports

~98 个 CRUD 函数加 tenantId 参数 + WHERE 过滤。
所有 controller handler 传入 `middleware.GetTenantId(c)`。
26 表全部注册 guardrail + 回填逻辑。

### 遗留债务清理 ✅
**Commit**: `c3294ca`

- purchase_analytics.go: 36 条 DB.Table() 全部加 tenantId
- ip_analytics.go: 6 条 DB.Raw() + 14 个 GORM 函数全部加 tenantId
- log.go: 6 条高风险路径（SumUsedToken, RPM/TPM, channel/user 解析）
- channel_monitor.go, model_meta.go, usedata.go 零散高风险修复
- Quota 热路径 7 个函数加 variadic tenantId + RelayInfo.TenantId 全链路透传

### 安全修复 ✅
**Commits**: `620163d`, `a2016cf`, `485aca6`

- UpdateMessage/RecallMessage/SubscriptionPlan 更新: RowsAffected 检查防跨租户副作用
- 用户管理接口 (GetUser/UpdateUser/DeleteUser/ManageUser): RequireTenantMembership 门禁
- 用户列表查询: 改为 JOIN tenant_memberships 子查询
- ProcessTopUpRebate: 邀请者/被邀请者更新加 tenant_id WHERE
- Token Redis 缓存: 读取时校验 TenantId 一致性

### Phase 3 基础: 成员体系 ✅
**Commit**: `105a145`

- TenantMembership 模型 (tenant_id + user_id + role + status)
- RequireTenantMembership 门禁函数
- /api/tenant/members CRUD API
- RequireTenantAdmin / RequirePlatformAdmin 中间件
- 认证中间件注入 platform_role + tenant_role + effectiveRole
- OAuth 全链路租户感知 (GitHub/Discord/OIDC/LinuxDO/Telegram/WeChat)
- Channel/Log 管理加 tenant 过滤
- utils.go batch 路径传 tenantId
- 路由按租户角色分组

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
| GetSubscriptionOrderByTradeNo | MEDIUM | ✅ |
| User.Update/Edit tenant | MEDIUM | ✅ |
| Token Redis 缓存 tenant | MEDIUM | ✅ |
| 0行更新翻译误删 | HIGH | ✅ |
| 用户列表 membership 查询 | MEDIUM | ✅ |
| User.ClearBinding | MEDIUM | 记录, 低频 |
| GetSiteRPM 全局查询 | MEDIUM | 记录, 限 platform admin |
| GetCacheSavings | MEDIUM | 记录, 限 platform admin |
| Channel 管理接口 | MEDIUM | ✅ Phase 3 修复 |

---

## 未开始阶段

| 阶段 | 说明 | 预估 |
|---|---|---|
| **Phase 3 收尾** | 前端接入 /api/tenant/members, 成员邀请流程 | 1 周 |
| **Phase 4** | 配置系统拆分 (OptionMap → Platform/Tenant/Runtime 三层) | 2-3 周 |
| **Phase 5** | 租户计费/套餐/续费/停服 | 2-3 周 |
| **Phase 6** | 前端 SaaS Console (租户切换/成员管理/配置面板) | 3-4 周 |
| **Phase 7** | 运维/监控/审计 (租户级指标/限流/审计日志) | 2-3 周 |

---

## Commit 历史

```
105a145 feat(multi-tenant): Phase 3 基础 — 成员体系、角色中间件、OAuth 租户绑定
485aca6 fix(multi-tenant): ProcessTopUpRebate 加 tenant WHERE + Token 缓存租户校验
a2016cf fix(multi-tenant): 用户管理接口加租户门禁 + 列表查询改走 membership
620163d fix(multi-tenant): 修复跨租户 0 行更新静默成功导致翻译被误删
c3294ca fix(multi-tenant): 清理遗留债务 — Raw SQL 租户过滤 + Quota 热路径隔离
3b1f7b8 feat(multi-tenant): Phase 2 — 业务表租户化，21 表全量 tenant_id 隔离
b1813af feat(multi-tenant): Phase 1.5 — 租户隔离收口与 guardrail 升级
4fe3fc6 feat(multi-tenant): Phase 1 — 身份、路由与核心数据隔离
```
