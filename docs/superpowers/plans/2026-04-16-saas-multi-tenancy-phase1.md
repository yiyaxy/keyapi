# 2026-04-16 多租户 Phase 1 实施文档（补档版）

> 说明：原 Phase 1 文档缺失，本文件依据当前实现和相关提交重建。
> 主要对应提交：`4fe3fc6`（Phase 1）、`b1813af`（Phase 1.5）
> 关联文档：[2026-04-16-saas-full-roadmap-zh.md](2026-04-16-saas-full-roadmap-zh.md) | [2026-04-16-completion-status.md](2026-04-16-completion-status.md)

---

## 1. Phase 1 的目标

Phase 1 不是一次性做完所有租户化，而是先把“租户身份”和“核心数据面”稳住。

它要解决四件事：

- 每个请求都能被稳定解析成一个 `tenant_id`
- 这个 `tenant_id` 能沿请求链路一路传到模型层
- 核心身份/渠道/日志表先完成 tenant 隔离
- 历史单租户数据能平滑回填到默认租户，不影响旧部署

Phase 1 不包含：

- 发票、工单、返佣、消息等业务表 tenant 化
- 成员体系与租户角色
- 租户级配置、套餐、监控前端

---

## 2. 关键设计

### 2.1 租户解析顺序

实现位置：[middleware/tenant.go](../../../middleware/tenant.go)

解析顺序固定为：

1. `X-Tenant-Id` header
2. 子域名，如 `acme.example.com`
3. 回退到 `DefaultTenantId`

这里的设计重点有两个：

- API 客户端和测试可直接用 header 指定租户
- 旧部署和未配置子域名的环境仍能跑在默认租户上

### 2.2 `tenant_id` 双写入上下文

`TenantResolve()` 不只写 `gin.Context`，还会写 `c.Request.Context()`。

原因是很多模型层调用依赖 `WithContext(ctx)` 或直接读取 `request context`，如果只写 `c.Get("tenant_id")`，模型层会错误回退到默认租户。

实现位置：

- [middleware/tenant.go](../../../middleware/tenant.go)
- [model/tenant_scope.go](../../../model/tenant_scope.go)

### 2.3 默认租户兼容旧数据

核心常量定义在：[model/tenant.go](../../../model/tenant.go)

- `DefaultTenantId = 1`
- 系统启动时会调用 `EnsureDefaultTenant()`
- 旧数据里 `tenant_id = 0` 的记录会统一回填到默认租户

这个机制保证多租户改造能在旧库上增量落地，而不是强制一次性迁库。

---

## 3. Phase 1 落地内容

### 3.1 新增租户实体

实现位置：[model/tenant.go](../../../model/tenant.go)

模型字段：

- `id`
- `name`
- `slug`
- `status`
- `created_at`
- `updated_at`

基础能力：

- `GetTenantById`
- `GetTenantBySlug`
- `CreateTenant`
- `UpdateTenant`
- `EnsureDefaultTenant`

### 3.2 核心表 tenant 化

Phase 1 只先处理 5 张基础表：

- `users`
- `tokens`
- `channels`
- `abilities`
- `logs`

这些表承担的是整个平台的身份、访问授权、路由能力和审计入口。一旦它们不隔离，后面的业务表隔离也没有意义。

### 3.3 渠道缓存 tenant 隔离

实现位置：[model/channel_cache.go](../../../model/channel_cache.go)

原先渠道缓存只按 group/model 组织，Phase 1 改成：

- `tenantGroupKey = tenantId:group`

这样可避免以下问题：

- 不同租户同名 group 互相污染
- `GroupHasChannels()` 在多租户环境误报可用
- 渠道选择命中别的租户的 enabled channel

### 3.4 路由入口提前挂 TenantResolve

实现位置：

- [router/api-router.go](../../../router/api-router.go)
- [router/relay-router.go](../../../router/relay-router.go)

挂载顺序上，`TenantResolve()` 在认证前执行，原因是：

- access token 校验本身就要 tenant-aware
- session / membership 校验也要知道当前请求租户
- relay 请求在选模型、查 quota、记日志前就要知道租户

### 3.5 登录后把租户写入 session

实现位置：[controller/user.go](../../../controller/user.go)

`setupLogin()` 在保存 session 时会写入：

- `tenant_id`
- `role`
- `platform_role`
- `tenant_role`

这样 session 登录态能和“当前租户上下文”绑定，而不是只表示“某个用户已登录”。

### 3.6 session 请求租户一致性检查

实现位置：[middleware/auth.go](../../../middleware/auth.go)

规则：

- access token 登录：token 查询本身已按租户过滤
- session 登录：如果 session 里的 `tenant_id` 与当前请求租户不一致，直接拒绝

这条规则是未来做浏览器内租户切换时必须保留的，否则一个租户的 session 会误落到另一个租户。

---

## 4. 模型层约束

### 4.1 业务 helper 与 guardrail 分离

实现位置：[model/tenant_scope.go](../../../model/tenant_scope.go)

这里有两套取 tenant 的语义：

- `TenantIDFromContext(ctx)`：取不到时回退默认租户，适合普通业务路径
- `ExplicitTenantIDFromContext(ctx)`：取不到时返回 `0`，适合 guardrail 和安全判断

为什么要分开：

- 业务逻辑需要兼容默认租户
- guardrail 不能把 `context.Background()` 误判成“tenant 1”

### 4.2 Guardrail 行为

Phase 1 / 1.5 的 guardrail 注册在：[model/tenant_scope.go](../../../model/tenant_scope.go)

当前行为：

- Create：
  - 优先从上下文自动填 `tenant_id`
  - 仍然拿不到时，拒绝写入 tenant-scoped 表
- Query / Update / Delete：
  - 如果 WHERE 已含 `tenant_id`，放行
  - 如果上下文里显式带了 `tenant_id`，自动注入
  - 否则记录错误日志

显式绕过方式：

- `WithTenantBypass(db)`

用途只限：

- 默认租户引导
- 历史数据回填
- 平台管理员跨租户操作

### 4.3 guardrail 的边界

guardrail 并不能覆盖：

- `DB.Raw(...)`
- `DB.Exec(...)`
- `DB.Table(...)`

所以 Phase 2 之后仍然有一次专门的“遗留债务清理”，把这些高风险路径逐个补 tenant 条件。

---

## 5. 迁移与回填

实现位置：[model/main.go](../../../model/main.go)

启动流程中的关键动作：

1. `AutoMigrate(...)`
2. `EnsureDefaultTenant()`
3. `backfillTenantId()`
4. `backfillTenantMemberships()`（Phase 3 后追加）

`backfillTenantId()` 的职责：

- 把旧表里 `tenant_id = 0` 的记录回填为 `DefaultTenantId`
- 覆盖核心表和后续已 tenant 化的业务表
- 若 `LOG_DB` 独立，也同步处理 logs

这个回填是幂等的，所以可以在多次启动时重复执行。

---

## 6. 请求链路说明

一次标准 API/Relay 请求的 Phase 1 路径如下：

1. Router 进入后先执行 `TenantResolve`
2. `tenant_id` 写入 gin/request context
3. 认证层按当前请求租户校验 access token / session / membership
4. Controller 通过 `middleware.GetTenantId(c)` 显式下传租户
5. Model 层通过 `tenant_id` where 条件或 context helper 执行查询
6. 日志通过 `RecordLogCtx` / `RecordLogWithTenant` 记录租户信息

相关文件：

- [router/api-router.go](../../../router/api-router.go)
- [router/relay-router.go](../../../router/relay-router.go)
- [middleware/tenant.go](../../../middleware/tenant.go)
- [middleware/auth.go](../../../middleware/auth.go)
- [controller/relay.go](../../../controller/relay.go)
- [model/log.go](../../../model/log.go)

---

## 7. 对开发者的约束

Phase 1 之后，新代码必须遵守这些规则：

- Controller 层凡是租户业务，优先显式传 `middleware.GetTenantId(c)`
- 需要把上下文下沉到模型层时，传 `c.Request.Context()`，不要传 `context.Background()`
- 新增 tenant-scoped 表时，要同时完成：
  - 模型字段 `tenant_id`
  - `AutoMigrate`
  - `RegisterTenantScopedTable`
  - `backfillTenantId`
  - controller/service 调用链 tenant 透传
- 平台级跨租户查询要显式使用 `WithTenantBypass`
- 遇到 `Raw` / `Table` / `Exec`，默认按高风险处理

---

## 8. 测试与验证

现有多租户单测位于：[unit_test/tenant_test.go](../../../unit_test/tenant_test.go)

已覆盖的关键点：

- header/subdomain/default tenant 解析
- `tenant_id` 注入 `request context`
- `TenantIDFromContext` 与 `ExplicitTenantIDFromContext` 的差异
- 关键 struct 是否包含 `TenantId`
- membership 角色合法性与 effective role 映射

Phase 1 真正避免的回归，是这类问题：

- `TenantResolve()` 只写 gin context，模型层读不到 tenant
- 没有显式 tenant 的 create 写到了默认租户
- guardrail 把 `context.Background()` 误重写成 tenant 1

---

## 9. Phase 1 结束时的已知缺口

Phase 1 结束后，系统虽然已经具备多租户主骨架，但还留有三类明显缺口：

- 业务表还没全部 tenant 化
- `DB.Raw / DB.Table` 高风险路径还没有统一清理
- 前端完全没有租户管理界面

所以才会继续进入：

- Phase 2：业务表租户化
- 债务清理：Raw SQL / 热路径修复
- Phase 3+：成员、配置、计划、监控、前端 Console

