# 租户创建与数据库填充

本文档描述「一个用户 : 一个租户 = 一个独立平台」模型下的两条核心链路：

1. 平台管理员通过 API 创建一个新租户（含初始 admin）
2. 服务启动时数据库的 schema 迁移与租户数据填充

---

## 1. 租户创建

### 1.1 入口

- **路由**：`POST /api/platform/tenants`
- **权限**：`RoleRootUser`（平台超管）
- **Handler**：`controller/tenant/crud.go:47 CreateTenant`

### 1.2 请求体

```json
{
  "name": "Acme Corp",
  "slug": "acme",
  "admin_username": "alice",
  "admin_password": "Passw0rd!",
  "admin_email": "alice@acme.com",
  "admin_display_name": "Alice"
}
```

| 字段 | 必填 | 校验 |
|------|------|------|
| `name` | ✅ | 非空 |
| `slug` | ✅ | 正则 `^[a-z0-9][a-z0-9\-]{1,62}[a-z0-9]$`；进程内 `tenantSlugCache` 查重 |
| `admin_username` | ✅ | 正则 `^[A-Za-z0-9_\-\.]{1,20}$` |
| `admin_password` | ✅ | 长度 8–20，入库前 bcrypt |
| `admin_email` | ❌ | 入库时 `strings.ToLower` |
| `admin_display_name` | ❌ | 缺省回退到 `admin_username` |

> 平台超管自己**不**会被加入新租户的 `tenant_memberships`。跨租户管理走平台级
> `RoleRootUser` 权限位，不依赖成员关系。

### 1.3 事务流程

整个写库走一个 `DB.Transaction`，4 步任一失败整单回滚，避免「slug 占用但没有可登录 admin」的半成品状态。失败后 UI 可以直接用原 slug 重试。

| 步骤 | 表 | 关键操作 | 备注 |
|------|----|---------|------|
| 1 | `tenants` | `tx.Create(&Tenant{ Name, Slug, Status:Active })` | `tenants` 表不在 tenant-scoped 名单里，guardrail 不插手 |
| 2 | `tenant_plans` | INSERT 默认 free plan | `QuotaLimit / RPMLimit / TPMLimit / MaxMembers / MaxTokens / MaxChannels = -1`（无限制），`PlatformMarkup = 1.0`，`Status = Active`。用 `WithTenantBypass(tx)` 显式开闸 |
| 3 | `users` | `adminUser.TenantId = tenant.Id` → `adminUser.InsertWithTx(tx, 0)` | bcrypt 密码、`Quota = QuotaForNewUser`、4 字符随机 `AffCode`、空 `Setting`；guardrail 自动验证 `tenant_id` 已写入 |
| 4 | `tenant_memberships` | INSERT `{ Role:TenantRoleAdmin, Status:Active, InvitedBy:operatorId }` | `operatorId` 取自 `c.GetInt("id")`，即触发本次创建的超管 |

`tenant.Id` 在步骤 1 提交后由 GORM 回填到结构体，步骤 3 才能正确赋给 `adminUser.TenantId`——这是上面强调"事务内有顺序依赖"的原因。

### 1.4 事务后副作用

- `adminUser.FinalizeOAuthUserCreation(0)`（`model/user.go:574`）
  - 按 admin role 生成默认 sidebar 配置写回 `users.setting`
  - 写一条「新用户注册赠送 X」系统日志到 `LogTypeSystem`
  - 之所以挪到事务外：日志可能写到独立的 `LOG_DB` 连接，写失败不应回滚已经成立的 admin 账号——日志可丢，账号不能丢
- `model.ClearTenantCache()`
  - 清进程内的 `tenantSlugCache` / `tenantIdCache`
  - 不清的话，刚建完用 `GetTenantBySlug(slug)` 会读不到（缓存里仍是缺失态）

### 1.5 响应

```json
{
  "success": true,
  "data": {
    "tenant": { "id": 6, "name": "Acme Corp", "slug": "acme", "status": 1, ... },
    "admin_user_id": 42,
    "admin_username": "alice"
  }
}
```

### 1.6 失败处理

- 任一步 SQL 出错：整个 tx 回滚 → 返回原始 error 文本
- `slug` 重复：在 tx 之前就被 `GetTenantBySlug` 拦下
- `admin_username` 在该租户内重复：步骤 3 触发复合 UNIQUE `(tenant_id, username)`，整单回滚

---

## 2. 数据库初始化与填充

### 2.1 入口

- `model/main.go:208 InitDB`
- 在程序 `main` 启动早期被调用，先于 `InitLogDB()`

### 2.2 启动顺序

```
InitDB()
 ├─ chooseDB("SQL_DSN")             ── 按 DSN 前缀挑驱动
 │   ├─ postgres:// → PostgreSQL
 │   ├─ local       → SQLite (走 SQLite 路径)
 │   └─ 其它         → MySQL（自动追加 ?parseTime=true）
 ├─ relaymetrics.RegisterGormCallbacks(DB)
 ├─ RegisterTenantCallbacks(DB)     ── 挂 tenant guardrail（必须在任何业务写入前）
 ├─ checkMySQLChineseSupport(DB)    ── MySQL 校验字符集是否支持中文
 ├─ 设置连接池                       ── MaxIdleConns=100 / MaxOpenConns=1000 / Lifetime=60s
 └─ migrateDB()                     ── 见下
```

### 2.3 `migrateDB()` 双路径

`migrateDB` 永远先 `AutoMigrate(&Setup{})`（schema_version 自己住的表），然后比对版本号决定走哪条路。

#### 路径 A：版本匹配（日常启动）

`GetSchemaVersion() == CurrentSchemaVersion` 时只跑：

1. `LoadIpBanCache()`
2. `LoadPromptRuleCache()`
3. `EnsureDefaultTenant()`（幂等兜底）

毫秒级返回。

#### 路径 B：版本不匹配（首次部署 / 升级）

按顺序：

| # | 步骤 | 作用 |
|---|------|------|
| 1 | `migrateSubscriptionPlanPriceAmount()` | `subscription_plans.price_amount` float/double → `decimal(10,6)`。先查 `information_schema` 类型，已是 decimal 跳过；SQLite 因类型亲和性直接跳过 |
| 2 | `migrateTokenModelLimitsToText()` | `tokens.model_limits` varchar(1024) → text。同样先查类型再决定是否 ALTER |
| 3 | `migrateUsersUsernameUnique()` | DROP 老的单列 `UNIQUE(username)`，给新模型的复合 `UNIQUE(tenant_id, username)` 让位。候选索引名：`uni_users_username` (GORM v2) / `users_username_key` (PG 默认)。SQLite 不支持原位 DROP UNIQUE，只打 NOTE |
| 4 | `migrateDBFast()` | **串行** AutoMigrate 60+ 张表（model 清单维护在 `main.go:442-505`）。注释明确说不能并行：`PreparedStmtDB` 不并发安全，并行会触发 `prepare_stmt.go` 的 nil panic |
| 5 | `migrateUsersExternalIdUnique()` | 给 `github_id / discord_id / oidc_id / wechat_id / telegram_id / linux_do_id` 加 partial UNIQUE：`(tenant_id, <col>) WHERE <col> <> ''`。PG 9.5+ 和 SQLite 3.8+ 支持，MySQL 不支持 partial index → 打 NOTE 退回 app-level dedup |
| 6 | `LoadIpBanCache()` / `LoadPromptRuleCache()` | 缓存预热 |
| 7 | `EnsureDefaultTenant()` | 见 §2.4 |
| 8 | `backfillTenantId()` | 见 §2.5 |
| 9 | `backfillTenantMemberships()` | 见 §2.6 |
| 10 | `SaveSchemaVersion(CurrentSchemaVersion)` | 写完，下次启动走路径 A |

### 2.4 `EnsureDefaultTenant`

`model/tenant.go:101`：

```go
COUNT(*) FROM tenants WHERE id = 1
若为 0 → INSERT { Id:1, Name:"Default", Slug:"default", Status:Active }
```

幂等。`DefaultTenantId = 1` 是全局常量。

### 2.5 `backfillTenantId`

`main.go:349-389`。给 30+ 张 tenant-scoped 表中 `tenant_id = 0` 的遗留行 UPDATE 成 `DefaultTenantId(1)`：

```sql
UPDATE <table> SET tenant_id = 1 WHERE tenant_id = 0
```

涉及表：

- **核心 5 张**：`users`, `channels`, `tokens`, `abilities`, `logs`
- **金融**：`top_ups`, `redemptions`, `subscription_plans`, `subscription_orders`, `user_subscriptions`, `subscription_pre_consume_records`
- **发票**：`invoice_applications`, `invoice_items`, `invoice_uploads`, `invoice_files`
- **工单**：`tickets`, `ticket_replies`, `ticket_attachments`, `ticket_uploads`
- **佣金**：`aff_rebate_logs`, `aff_transfer_requests`
- **消息**：`messages`, `message_read_statuses`
- **分析与审计**：`user_ip_records`, `quota_data`, `agent_logs`, `agent_reports`
- **成员关系**：`tenant_memberships`
- **Plan / Bill**：`tenant_plans`

如果 `LOG_DB != DB`（独立日志库），单独再跑一次 `UPDATE logs SET tenant_id = 1 WHERE tenant_id = 0`。

注意：此函数运行在 `InitDB() → migrateDB()` 内部，**早于** `InitLogDB()`。所以判断 `LOG_DB != nil` 是必要的——首次启动时 LOG_DB 仍是 nil。

### 2.6 `backfillTenantMemberships`

`main.go:391-435`。扫所有 `users`，给每个 user 在 `tenant_memberships` 里 `FirstOrCreate` 一行：

```
For each user:
  tenantId = user.TenantId 若 > 0，否则 DefaultTenantId
  role     = TenantRoleAdmin  若 user.Role >= RoleAdminUser，否则 TenantRoleMember
  status   = TenantMembershipStatusActive  若 user.Status == Enabled，否则 Disabled
  FirstOrCreate(TenantMembership{ tenantId, userId }) with Assign({ role, status })
```

幂等：`FirstOrCreate` + `Assign` 保证已存在的 membership 也会被回写最新 `role/status`。

---

## 3. Guardrail 与 tenant_id 的关系

### 3.1 写入侧

- `RegisterTenantCallbacks` 在 `gorm:create` 之前挂 `tenantGuardCreate`
- 对 tenant-scoped 表的每条 INSERT：
  - 若结构体的 `tenant_id` 已是非 0 → 放行
  - 否则按优先级回填：goroutine-local（HTTP 路径）→ ctx 显式 key
  - 仍为 0 → fail-closed，AddError 拒绝写入

> 创建租户的步骤 3（admin user）显式给了 `adminUser.TenantId = tenant.Id`，所以 guardrail 走"已是非 0 → 放行"分支。

### 3.2 查询侧

- `tenantGuardScope` 在 `gorm:query/update/delete` 之前
- 检查 WHERE / SQL 是否引用 `tenant_id`，没有就：
  - 如果是 PK 等值或单列 unique 等值 → 放行（`hasUniqueKeyEquality`）
  - 否则尝试自动注入 `WHERE tenant_id = ?`（goroutine-local > ctx）
  - 都不行 → fail-closed

### 3.3 Bypass

`WithTenantBypass(db)` 在 `gorm.Statement.Settings` 里打一个 `tenant:bypass = true` 标记，guardrail 看到就直接放行。仅限：

- 数据迁移（`backfillTenantId` / `backfillTenantMemberships`）
- 系统 bootstrap（`createRootAccountIfNeed`）
- 平台超管跨租户操作（`ListAllTenants`）
- 跨租户唯一性查找（OAuth `provider_id` lookup、登录前的 username/email 反查）

---

## 4. 实操注意事项

### 4.1 新建租户后，admin 立刻可用

无需手动 `RegisterTenantScopedTable` 或刷缓存——`InsertWithTx` 用的是同一个 tx 内的 DB 句柄，所有 tenant 表 callback 自动生效；`ClearTenantCache` 在 commit 后立即让 `GetTenantBySlug(slug)` 能读到新租户。

### 4.2 删除租户是软删除

`DeleteTenant`（`crud.go:197`）只把 `tenants.status` 置 `TenantStatusDeleted = 3`，并 `RemoveAllTenantMemberships(id)`。租户下的 users / channels / tokens / logs / 订单 / 账单等**不会被物理删除**。要真清，需要额外一轮带 `WithTenantBypass` 的批量 DELETE。

### 4.3 默认租户不可删

`DeleteTenant` 显式拒绝 `id == DefaultTenantId(1)`。这是因为遗留数据 backfill 全压在租户 1 上，删了会让所有历史数据成孤儿。

### 4.4 租户 id 与子域名

`middleware/tenant.go TenantResolve` 解析顺序：`X-Tenant-Id` header → 子域名（`xxx.example.com` 中的 `xxx` 当作 slug 查 `GetTenantBySlug`）。两条都不命中 → tenantId 保持 0，不走 fallback 到 1，让 guardrail fail-closed。

### 4.5 升级现有部署的清单

从单租户老库升到多租户：

1. 备份 DB
2. 拉新代码、重启 → 自动触发路径 B 的完整迁移
3. 验证：`SELECT COUNT(*) FROM users WHERE tenant_id != 1`（应为 0），`SELECT COUNT(*) FROM tenant_memberships`（应等于 `users` 行数）
4. 通过 `POST /api/platform/tenants` 创建第一个真实业务租户

---

## 附：关键文件索引

| 路径 | 作用 |
|------|------|
| `controller/tenant/crud.go` | 租户 CRUD HTTP handler |
| `model/tenant.go` | `Tenant` 模型、缓存、`EnsureDefaultTenant` |
| `model/main.go` | `InitDB` / `migrateDB` / `backfillTenantId` / `backfillTenantMemberships` |
| `model/tenant_scope.go` | guardrail callback、`WithTenantBypass`、`TenantIDFromContext` |
| `model/tenant_membership.go` | `TenantMembership` 模型、`ApplyMembershipView` |
| `middleware/tenant.go` | `TenantResolve` HTTP 中间件、`GetTenantId` |
| `common/tenant_ctx/tenant_ctx.go` | goroutine-local tenant_id 容器 |
| `model/user.go` | `User.InsertWithTx` / `FinalizeOAuthUserCreation` / `ValidateAndFillWithTenant` |
