# 2026-04-16 Phase 0 预治理审计（补档版）

> 说明：原审计文档缺失，本文件依据当前代码与现存里程碑记录重建。
> 计数口径：`43 表 / 42 热路径 / 89 SQL / 62+ OptionMap key / 23 项矩阵` 继承自现存完成状态文档；详细条目按当前代码重建。
> 当前代码基线：`dev` 分支，已核对至 commit `0a44d2f`

---

## 1. 审计目标

Phase 0 的任务不是直接改代码，而是先回答下面五个问题：

1. 哪些表必须 tenant 隔离，哪些表必须保持平台级共享？
2. 哪些调用链路最容易在 tenant 化时漏传 `tenant_id`？
3. 哪些 SQL 形式会绕过框架默认保护？
4. 哪些系统配置以后应该下放到租户层？
5. 哪些任务可以分阶段切，不会把系统一次性改崩？

---

## 2. 审计结果摘要

### 2.1 里程碑口径

- 43 张高相关表完成分类
- 42 个热路径函数完成梳理
- 89 条高风险 SQL / ORM 操作完成编目
- 62+ 个 `OptionMap` key 被识别为后续拆层候选
- 23 项改造任务形成分阶段矩阵

### 2.2 当前代码的后续增量

由于代码已经继续演进，当前仓库相较原始审计范围还有明显增量：

- 当前 `AutoMigrate` 模型数：50
- 当前 tenant-scoped 表注册数：28
- 当前 `OptionMap` 静态 key 数约 160+，且还会叠加动态模型配置
- 当前 tenant-overridable key 数：19

也就是说，原始 Phase 0 审计确实存在，但今天补档时必须同时标出“后续新增面”，否则路线图会低估系统复杂度。

---

## 3. 43 表分类（按原审计口径重建）

> 说明：下面的 43 表，是按“2026-04-16 多租户改造主线最相关表”重建的核心范围。后续新增的 `tenant_memberships`、`tenant_invites`、`tenant_options`、`tenant_plans`、`site_rpm_snapshots` 等，不强行塞回原 43 表口径。

### 3.1 租户隔离表（26）

这些表里的数据天然属于某个租户，必须最终具备 `tenant_id` 并参与隔离：

- 核心：`users`、`tokens`、`channels`、`abilities`、`logs`
- 金融：`top_ups`、`redemptions`、`subscription_plans`、`subscription_orders`、`user_subscriptions`、`subscription_pre_consume_records`
- 发票：`invoice_applications`、`invoice_items`、`invoice_uploads`、`invoice_files`
- 工单：`tickets`、`ticket_replies`、`ticket_attachments`、`ticket_uploads`
- 返佣：`aff_rebate_logs`、`aff_transfer_requests`
- 消息：`messages`、`message_read_statuses`
- 分析：`user_ip_records`、`quota_data`、`agent_logs`、`agent_reports`

### 3.2 平台级共享表（10）

这些表更接近平台配置、元数据或公共能力，不适合直接 tenant 化：

- `options`
- `models`
- `vendors`
- `prefill_groups`
- `setups`
- `prompt_rules`
- `message_translations`
- `content_translations`
- `custom_oauth_providers`
- `ip_bans`

### 3.3 系统/认证/集成支撑表（7）

这些表更偏平台认证、系统支撑或运营辅助，Phase 0 的结论通常不是“立即 tenant 化”，而是“明确访问边界”：

- `tenants`
- `user_oauth_bindings`
- `passkey_credentials`
- `two_fas`
- `two_fa_backup_codes`
- `tasks`
- `checkins`

---

## 4. 热路径审计（按家族重建）

> 原始文档记录为 42 个函数。由于原逐函数清单已丢失，下面用“热路径家族”重建，覆盖当时真正高风险的调用面。

### 4.1 身份与认证

- 登录 / 注册 / Reset Password
- access token 校验
- OAuth / Telegram / WeChat / LinuxDO / Discord / OIDC 登录与绑定
- `GetSelf` / `GetUser` / `UpdateUser` / `DeleteUser`

风险点：

- 用户唯一性冲突是否按租户检查
- session / access token 是否绑定当前请求租户
- 非 home tenant 的成员是否仍能被正确识别

### 4.2 渠道路由与模型可见性

- 渠道查询与编辑
- `GetEnabledModels`
- `GetGroupEnabledModels`
- 渠道缓存同步与命中
- relay 渠道选择

风险点：

- group/model cache 是否被别的租户污染
- ability/channel join 是否漏 tenant 条件

### 4.3 计费与消费

- relay 预扣费 / 结算
- `GetUserQuota`
- quota 增减
- log 记账
- topup / subscription 完成回调

风险点：

- 消费日志与配额是否记到错误租户
- 返利、扣费、副作用更新是否带 tenant where

### 4.4 订单与商业化

- 充值订单列表/补单/过期/删除
- 订阅订单列表/补单/过期/删除
- 发票申请与文件下载
- 用户首选订阅扣费

风险点：

- 管理员订单查询是否跨租户泄露
- 发票与订单关联是否跨租户串单

### 4.5 运维与分析

- `SumUsedQuota`
- `GetSiteRPM`
- `GetCacheSavings`
- PurchaseAnalytics
- IP Analytics

风险点：

- 聚合统计默认按全平台，tenant 化后极易漏筛选
- `DB.Raw` / `DB.Table` 查询最容易漏 tenant 条件

---

## 5. SQL 风险面（89 条口径的压缩版）

> 原始记录为 89 条 SQL / ORM 操作。现补档版不逐行恢复，而按风险形态归类。

### 5.1 最高风险：天然绕过 guardrail

- `DB.Raw(...)`
- `DB.Exec(...)`
- `DB.Table(...)`

代表文件：

- [model/purchase_analytics.go](../../../model/purchase_analytics.go)
- [model/ip_analytics.go](../../../model/ip_analytics.go)
- [model/log.go](../../../model/log.go)
- [model/usedata.go](../../../model/usedata.go)

### 5.2 高风险：多表 join / 子查询

- 用户列表通过 membership 查可见用户
- OAuth binding 通过 users join 查租户
- 发票、工单、消息列表存在父子表 join
- 订单/返利/分析查询常有子查询和 group by

### 5.3 中风险：缓存与聚合

- channel cache
- token cache
- log stat / cache savings / RPM
- purchase analytics dashboard

### 5.4 中高风险：副作用更新

- 更新消息并删除翻译
- 返利结算
- 用户解绑第三方账号
- 订单补单、过期、删除

这些操作的共性是：即使查询本身 tenant 化了，后面的副作用更新也可能忘记继续带 tenant where。

---

## 6. `OptionMap` 审计

### 6.1 原始结论

原始里程碑里记录为 62+ key，已经足够证明：

- `OptionMap` 是进程级全局状态
- 配置读写没有 tenant 边界
- 多数控制器和服务直接读全局 map

### 6.2 当前代码现状

当前 [model/option.go](../../../model/option.go) 中可识别的静态 key 已在 160 个以上，且还会叠加动态模型配置，远超最初口径。

大致可分为：

- 品牌与展示：`SystemName`、`Logo`、`Footer`、`Notice`、`HomePageContent`
- 注册与认证：`PasswordLoginEnabled`、`RegisterEnabled`、`EmailVerificationEnabled`
- 计费与支付：`Price`、`MinTopUp`、`Stripe*`、`Creem*`、`Waffo*`
- 发票：`Invoice*`
- 模型倍率与限流：`ModelRatio`、`ModelPrice`、`CacheRatio`、`GroupRatio`
- 安全与风控：`SensitiveWords`、`CheckSensitiveEnabled`
- 数据与导出：`DataExport*`
- 运营设置：返利、邀请、Sidebar/Header 模块等

### 6.3 已下放到租户层的第一批 key（19）

实现位置：[service/tenant_config_keys.go](../../../service/tenant_config_keys.go)

当前已允许租户覆盖：

- 展示：`SystemName`、`Logo`、`Footer`、`Notice`、`About`、`HomePageContent`
- 功能开关：`DrawingEnabled`、`TaskEnabled`、`DataExportEnabled`、`DisplayInCurrencyEnabled`、`DisplayTokenStatEnabled`
- 注册与认证：`PasswordLoginEnabled`、`PasswordRegisterEnabled`、`RegisterEnabled`、`EmailVerificationEnabled`、`EmailDomainRestrictionEnabled`、`EmailDomainWhitelist`
- 计费展示：`QuotaPerUnit`、`TopUpLink`

这正是 Phase 4 的第一阶段成果。

---

## 7. 23 项改造任务矩阵（重建版）

| ID | 任务 | 所属阶段 | 当前状态 |
|----|------|----------|----------|
| T01 | 租户实体与默认租户常量 | Phase 1 | 已完成 |
| T02 | header/subdomain/default tenant 解析 | Phase 1 | 已完成 |
| T03 | `tenant_id` 注入 request context | Phase 1 | 已完成 |
| T04 | session 与请求租户对齐 | Phase 1 | 已完成 |
| T05 | 核心表 `users/tokens/channels/abilities/logs` tenant 化 | Phase 1 | 已完成 |
| T06 | 渠道缓存 tenant 复合键 | Phase 1 | 已完成 |
| T07 | 默认租户 bootstrap + 历史数据回填 | Phase 1 | 已完成 |
| T08 | Create guardrail fail-closed | Phase 1.5 | 已完成 |
| T09 | Query/Update/Delete guardrail 收口 | Phase 1.5 | 已完成 |
| T10 | 金融表 tenant 化 | Phase 2 | 已完成 |
| T11 | 发票表 tenant 化 | Phase 2 | 已完成 |
| T12 | 工单表 tenant 化 | Phase 2 | 已完成 |
| T13 | 返佣/消息/分析表 tenant 化 | Phase 2 | 已完成 |
| T14 | Raw SQL / `DB.Table()` 高风险路径清理 | 债务清理 | 已完成主体 |
| T15 | 用户管理接口 membership 门禁 | 安全修复 | 已完成 |
| T16 | 成员体系与角色中间件 | Phase 3 | 已完成 |
| T17 | 租户 CRUD / 邀请 / 接受邀请 | Phase 3 | 已完成后端 |
| T18 | 租户配置三层读取 | Phase 4 | 已完成基础 |
| T19 | 租户指标汇总与 trend API | Phase 7 | 已完成基础 |
| T20 | 租户计划 / 配额 / RPM / model access 执行 | Phase 5 | 已完成基础 |
| T21 | 租户告警与 API 级 rate limit | Phase 7 | 已完成基础 |
| T22 | SaaS Console 前端 | Phase 6 | 未开始 |
| T23 | 账单、续费、停服、审计导出闭环 | Phase 5/7 | 未完成 |

---

## 8. 审计结论

Phase 0 当时最重要的结论，放到今天依然成立：

- 多租户不是“加个 `tenant_id` 字段”就结束，而是要同时处理上下文、缓存、认证、聚合统计、后台管理和配置分层。
- 最高风险不是普通 CRUD，而是 `Raw/Table` 聚合查询、缓存、后台副作用更新。
- `OptionMap` 不拆层，就不可能做真正的租户品牌化和租户自助配置。
- 先做后端隔离骨架，再做成员/配置/计划，再做前端 Console，是正确顺序。

从今天的结果看，这条判断是对的：后端骨架已经落地，真正还缺的是前端与商业化闭环，而不是底层隔离能力。

---

## 9. 关键代码落点

- 租户解析：[middleware/tenant.go](../../../middleware/tenant.go)
- guardrail：[model/tenant_scope.go](../../../model/tenant_scope.go)
- 租户回填与迁移：[model/main.go](../../../model/main.go)
- 租户缓存隔离：[model/channel_cache.go](../../../model/channel_cache.go)
- 配置面现状：[model/option.go](../../../model/option.go)
- 租户配置三层读取：[service/tenant_config.go](../../../service/tenant_config.go)
- 热路径单测：[unit_test/tenant_test.go](../../../unit_test/tenant_test.go)
