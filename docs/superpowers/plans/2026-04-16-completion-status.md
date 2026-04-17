# SaaS 改造完成状态追踪

> 最后更新：2026-04-17
> 基于分支：`dev`（已核对至 commit `78c5f2c`）
> 补充来源：`docs/multi-tenant-completion-status.md`、`VERSIONS.md`、`ToDos.md`、后续多租户提交

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
| Phase 3 | 权限与成员体系 | **后端完成 + 前端接入成员管理** | 95% |
| Phase 4 | 配置系统重构 | **按需迁移完成，租户覆盖所需 key 全部三层化** | 95% |
| Phase 5 | 计费与商业化 | **7/7 限制执行 + 账单/账本 + 到期状态机 + 宽限期** | 98% |
| Phase 6 | 前端 SaaS 后台 | **7 管理页 + 切换器 + 审计页 + 配置编辑器重构** | 90% |
| Phase 7 | 运维、监控与审计 | **告警三通道 + 定时巡检 + 审计日志** | 95% |

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
**Commits**: `b1813af`、`94fc6b7`（Phase 2 fail-closed 升级）

### 已完成
- `ExplicitTenantIDFromContext()` — background context 返回 0
- Create callback: **fail-closed**（TenantId=0 拒绝写入）✅
- Query/Update/Delete callback: **fail-closed** — 未带 tenant_id 且 context 无显式 tenant 时 AddError 拒绝 + ERROR 日志（升级自 warn-only）
- `WithTenantBypass(DB)` 用于迁移/bootstrap/超管操作（42 处使用，均为合理跨租户场景）
- `GetUserTenantId(userId)` model 层辅助函数
- Log 读写路径全面租户隔离
- 30 张表已注册 guardrail
- Raw SQL（7 处 `DB.Raw()`、19 处 `DB.Table()`）均已手动加 tenant_id 过滤
- 6 个单元测试
- **FillUserById 裸调用彻底清零**（2026-04-17）：passkey/user/secure_verification/wechat/oauth/telegram 共 7 处改为 `GetUserByIdWithContext(c, id, true)`；passkey 登录凭证反查用 `WithTenantBypass`（触发场景：管理员打开渠道管理页，前端并发调 `/api/user/passkey` 被 guardrail fail-closed 拦下 401）

### 未完成
- 无（FixAbility 的 TRUNCATE 已由路由层 `RootAuth()` 保护，等级比 PlatformAdmin 更严格）

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
| FillUserById 裸调用清理 | 7 处 controller 漏改：passkey(3)/user(EmailBind)/secure_verification/wechat/oauth/telegram 全改为 `GetUserByIdWithContext(c, id, true)`；passkey 登录凭证反查用 `WithTenantBypass`。修复渠道管理页加载时 `/api/user/passkey` 被 guardrail 拦下 401 的问题 |

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

## Phase 4：配置系统重构 ✅ 95%
**Commits**: `4fbe038`、`78c5f2c`（按需迁移收尾 + 配置 UI 重构）

### 设计原则：按需迁移
三层读取（租户 → 全局 → 默认）是**给需要租户级覆盖的 key 准备的通道**，不是要替换所有 `OptionMap` 直读。只有语义上适合租户覆盖的 key（品牌展示、认证开关、功能开关、计费展示、Webhook 等）才走 `GetConfig*()`；底层性能热路径、平台级配置（系统 token 计费、全局限流、渠道负载均衡等）继续走 `OptionMap` 是正确的。

### 已完成
- `tenant_options` 模型已落地，支持租户级覆盖和缓存失效
- `/api/tenant/config` GET / PUT / DELETE 已提供
- 三层读取优先级函数：`GetConfig()` / `GetConfigBool()` / `GetConfigInt()` / `GetConfigFloat64()`
- 已明确并迁移 19+ 可租户覆盖 key，覆盖：
  - **品牌展示**：SystemName / Logo / Footer / HomePageContent 等
  - **认证与注册**：RegisterEnabled / PasswordLoginEnabled / EmailVerificationEnabled / EmailDomainWhitelist 等
  - **功能开关**：CheckinEnabled / DemoSiteEnabled / SelfUseModeEnabled 等
  - **计费展示**：RMB 汇率展示、充值最低金额等
  - **Webhook**：WebhookURL / WebhookSecret
- 前端 `TenantConfigEditor` 重构为 5 卡片分组（品牌 / 认证 / 功能开关 / 计费 / Webhook）+ 类型化控件 + 31 条 i18n

### 未完成（非阻塞）
- `OptionMap` typed schema / 配置项元数据与分组（可读性优化，非功能项）
- 若后续出现新的租户覆盖需求，按同样的三层读模式继续加即可

---

## Phase 5：计费与商业化 ✅ 95%
**Commits**: `0a44d2f`、`ab2029f`…`685987c`（Plan 1）、`4d7a63e`（review 修复）、`fae665c`（账单/状态机）

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

### 已完成（续）
- 租户级账单 / 账本（`tenant_bills` / `tenant_ledgers` 表）+ 月度周期 upsert + 账单结转生成 consume 账本流水
- 到期停服状态机（plan expires_at 到达自动设 status=disabled + 告警）
- `StartTenantBillingAndPlanLoop` 定时巡检（master 节点 1 小时一次）
- 前端：`/console/tenant-bills`（账单 + 账本流水双 Tab）+ `/console/tenant-plan`（计划详情）

### 已完成（续 — commit `78c5f2c`）
- **宽限期**：`TenantPlan.GracePeriodSeconds` 字段 + 状态机两段化（`expires_at → warn → expires_at+grace → disable`）
- 新增 `TenantAlertTypePlanInGracePeriod` 告警类型
- 前端 `TenantPlanCard` 加宽限期 Banner + 平台 admin 表单可设置
- 3 个单元测试（grace window / exhausted / no-grace）全 PASS

### 已完成（续 — WeChat Pay S1: 凭据基础，commits `c5f7436` → `8764f9d`，2026-04-17）
- **加密工具**：`common/crypto.go` 新增 `DeriveKey`（HKDF-SHA256 → 32 字节）+ `EncryptAESGCM` / `DecryptAESGCM`；6 个单测（确定性 / info 隔离 / roundtrip / 错 key / 篡改检测 / key 长度校验）
- **支付密钥**：`service/payment/crypto.go` `paymentMasterKey()` 默认 HKDF(CryptoSecret, "wechat-pay-keys-v1")，可选 env `PAYMENT_MASTER_KEY`（32 字节 base64）覆盖
- **TenantPaymentConfig 模型**：`model/tenant_payment_config.go` + AES-256-GCM 加密 3 敏感字段（app_secret / apiv3_key / private_key PEM）+ CRUD 全部走 `WithTenantBypass + WHERE tenant_id=?` + `paymentKeyResolver` 走 `atomic.Value` 避免 race + 硬删除（Unscoped，删除后不留 ciphertext）
- **Guardrail 注册**：`tenant_payment_configs` 加入 `RegisterTenantScopedTable` 清单，fail-closed 跨租户访问检查
- **启动 wire-up**：`main.go` 在 `InitDB` 后 `CheckSetup` 前 `model.InitPaymentCrypto(payment.PaymentMasterKey)` 注入 env-aware resolver + eager validate（PAYMENT_MASTER_KEY 无效立即 fatal，不等到首次请求）+ 启动 log 指明走 env 还是 HKDF
- **Provider 抽象**：`service/payment/provider.go` `Provider` 接口（`Name` + `TestCredentials`）+ 注册表（init-time only）；`Register` nil-guard panic
- **per-tenant WeChat Client 缓存**：`service/payment/wechat/client.go` `cachedClient` + `clientCache`（sync.RWMutex）+ DB-backed staleness check by `cfg.UpdatedAt` + `InvalidateCache(tenantId)` 导出 + 10s `callWithTimeout`
- **TestCredentials 实现**：`service/payment/wechat/provider.go` 调微信 `/v3/certificates`（v0.2.21 SDK，`DownloadCertificates(ctx)`），成功则代表 mchid / serial / private key / apiv3_key 四件套凭据互洽；`init.go` 注册到 registry
- **Controller CRUD + test endpoint**：`controller/tenant_payment.go` 4 handler — `GetTenantPaymentConfigs` / `UpdateTenantWechatConfig`（merge-on-update：空字段保留 existing ciphertext）/ `TestTenantWechatConfig`（sanitize 错误到 300 字符存 `LastTestError` + HTTP 响应，完整错误走 `common.SysError`）/ `DeleteTenantWechatConfig`（含 `PlatformLocked` 守护 + idempotent on NotFound）
- **Router**：`router/api-router.go` 4 条路由挂在 `tenantRoute` 分组下（自带 `TenantAdminAuth()` 中间件）
- **前端**：`/console/tenant-payment` 独立页 + Tab 1 配置表单（原生 Semi `Switch`/`Input`/`TextArea` 受控）+ `_set` 布尔只读暴露（ciphertext 不过线）+ PlatformLocked danger Banner + 上次测试失败 warning Banner + 保存/测试连接/清除三按钮 + zh-CN/en i18n + Sidebar 菜单白名单 `tenantPayment`（顺手补了漏的 `tenantAudit`）
- **端到端**：真实阿里云 RDS Postgres + 真实微信商户号，填凭据 → 保存 → 测试连接 → 返回 `连接成功`，`tenant_payment_configs` 行写入并可跨租户隔离

### 已完成（续 — WeChat Pay S2: 下单 + 回调 + 业务联动, commits `b7310f6` → `e32ef11`, 2026-04-17）
- **模型**：`model/payment_order.go` PaymentOrder 模型（状态机 `pending/paid/partial_refunded/fully_refunded/closed/expired` + `LastError` 字段用于留痕远端失败 *不删 pending*） + `BuildOutTradeNo`（`wx_t{tid}_{K}_{unix}_{rand6}` ≤31 字符） + `ValidateOutTradeNoRoute`（回调 URL 防篡改） + `MarkOrderPaid`（`UPDATE...WHERE status='pending'` 幂等原语） + `CreatePaymentOrder` / `GetPaymentOrderByOutTradeNo` CRUD；`TenantPlan` 加 `RenewPeriodDays` / `RenewPriceAmount` / `RenewCurrency`；tenant-scoped 注册 + AutoMigrate + schema version bump `2026-04-18`
- **Provider 接口扩展**：`service/payment/provider.go` 加 `CreateOrder` / `VerifyAndParseNotify` / `QueryOrder` 方法 + `CreateOrderRequest/Response` / `NotifyResult` / `QueryOrderResult` 类型
- **wechat 下单实现**：`service/payment/wechat/native.go` / `h5.go` / `jsapi.go` 三种 ProductForm（Native QR / H5 redirect / JSAPI prepay_id + wx.requestPayment 签名）；`notify.go` 走 `wechatpay-go` `NotifyHandler` 做 SHA256-with-RSA 验签 + AES-256-GCM 解密；`provider.go` `CreateOrder` switch-case 路由 + `QueryOrder` 用 `native.NativeApiService.QueryOrderByOutTradeNo`
- **Service 层事务骨架**：`service/payment/order.go` `CreateTopupOrder` / `CreateSubOrder`（公共入口分别走 createOrder + metadata 写 `amount_units` / `renew_period_days`）；`markOrderCreationError`（**保留 pending + 写 LastError**，不删行——微信可能已受理本端没拿到响应）；`ApplyPaymentSuccess` tx 包 `MarkOrderPaid` 幂等 + 分派 topup/sub 业务 + `postCommit []func()` 钩子保证 cache/审计/日志写入在 tx commit 后才跑
- **topup 成功路径**：`applyTopupSuccess` 在 tx 内 `UPDATE users SET quota = quota + ? WHERE id=? AND tenant_id=?`（走 home tenant）+ 写 `top_ups` 行（`PaymentMethod="wxpay"` 兼容发票过滤）+ `CreateTenantAuditLogTx` tx 审计；postCommit 里跑 `RecordTopUpLogWithTenant` + `ProcessTopUpRebate` + `CacheIncrUserQuota`（export 加在 `model/user_cache.go`），与 epay/stripe 路径严格行为一致
- **sub 成功路径**：`applySubSuccess` 在 tx 内 `SELECT ... FOR UPDATE` 锁 `tenant_plans` 行 + 原子 `UPDATE expires_at = CASE WHEN expires_at > now THEN expires_at + secs ELSE now + secs END`（解决并发丢单）+ 显式恢复 `Status=Active`（当前状态机只 active→disabled，不会自动恢复）+ `CreateTenantAuditLogTx` 审计；postCommit 里 `InvalidateTenantPlanCache` 保证不与未提交 tx 争 cache
- **Controller**：`controller/payment_wechat.go` 5 下单 handler + `resolveTopupPrice`（复用 `getPayMoney` + `getMinTopup` + tokens-mode 归一化，定价与 epay 一致）+ `buildNotifyUrl`（走 `system_setting.ServerAddress`，localhost / 空 / 缺 scheme 一律拒单）；`controller/payment_notify.go` 回调含 `ValidateOutTradeNoRoute` 纵深防御 + 路由不匹配触发 `payment.notify.mismatch` 审计；`controller/payment_order.go` 订单查询/列表 API（payer 或 tenant admin 可见否则 404，剔除 openid/metadata）
- **Router**：8 条路由挂对应鉴权组 — `paymentRoute`（UserAuth）放 topup 3 + 单订单；`tenantRoute`（TenantAdminAuth）放 sub 2 + 订单列表；`apiRouter`（公开）放 notify（签名验证即 auth）
- **Model 扩展 tx-aware 审计**：`model/tenant_audit_log.go` `CreateTenantAuditLogTx(tx, log)` 用调用方传入的 tx 写入，业务回滚时审计一并回滚（不再用全局 DB 的 `CreateTenantAuditLog` 逃逸事务）
- **前端**：`web/src/types/tenant.ts` 5 种 order-related 类型；`web/src/helpers/payment.js` 4 个 API helper；`WechatPayModal`（QR + 3s `/api/payment/orders/:out_trade_no` 轮询 + 终态 Toast + 自动关闭）；`/console/topup` 加 wechat 按钮（后端通过 `GetTopUpInfo` 注入 `enable_wechat_topup` flag 按租户 wechat config 启用/禁用）；`/console/tenant-plan` 加续期按钮（`renew_price_amount<=0` 禁用 + tooltip）；`/console/tenant-payment` 订单 Tab（类型/状态筛选 + 分页）；`/console/platform-tenants` plan 编辑加续期周期/单价（yuan-cents 换算 + `renew_currency='CNY'` 硬编码 v1）
- **3 轮 pre-execution review + 9 个 HIGH/MEDIUM 修订**：rollback 改 markOrderCreationError / quota 用 tx.Exec 不用 IncreaseUserQuota / SELECT FOR UPDATE + CASE atomic / tx 外不 reload / buildNotifyUrl 走 ServerAddress / resolveTopupPrice 复用 epay 定价 / postCommit 做 log+rebate+cache parity / CreateTenantAuditLogTx / tokens-mode 归一化防止多发 500k² 倍额度 — 完整明细见 plan 文件 `docs/superpowers/plans/2026-04-17-wechat-pay-s2-ordering-and-callback.md` 顶部"修订记录"节
- **已提交 21 个 commit，分支 `feat/wechat-pay-s2` 已 push 到 origin**；真实商户号端到端手工验证（topup + sub 续期）待 LO 执行

#### 未完成（S3 计划中）
- **S3**（退款 + 补偿 + 续期告警）：`payment_refunds` 模型 + 退款 API（仅财务退回不回滚业务）+ 退款回调 + 缺单补偿循环（3 分钟 master 定时）+ 续期告警 3 类（7/3/1 天）+ 退款 Tab + 平台锁定开关

#### 未完成（本次 spec 范围外，推迟至未来迭代）
- 套餐升级 / 降级 / proration（需先补 `PlanTemplate` / SKU）
- 每日对账单自动下载
- 订阅消息模板推送
- 支付宝 / PayPal 落地（架构已预留）

### 未完成
- 套餐**升级 / 降级** + proration（需先补 `PlanTemplate` / SKU — v2 scope）
- WeChat Pay **S3**（退款 + 缺单补偿 + 续期告警 — 见 S3 plan）

---

## Phase 6：前端 SaaS 后台 ✅ 90%

### 已完成（Part A — 2026-04-17）
- 前端 TS 类型：`web/src/types/tenant.ts`（Tenant / TenantMembership / TenantMemberListItem / 常量）
- `X-Tenant-Id` 请求头注入：`web/src/helpers/api.js` 加请求拦截器，登录/登出 header 自动同步
- 租户信息页：`/console/tenant-info`（view/edit name，GET /api/tenant/info + PUT /api/tenant/）
- 成员管理页：`/console/tenant-members`（list + invite + 角色/状态编辑 + 移除）

### 已完成（Part B/C/D — 2026-04-17）
- 租户计划详情页：`/console/tenant-plan`（只读计划展示）
- 租户配置编辑器：`/console/tenant-config`（key-value 编辑）
- 租户仪表盘：`/console/tenant-dashboard`（summary 卡 + VChart 趋势 + 模型使用排行）
- 租户告警管理：`/console/tenant-alerts`（活跃 + 历史双 Tab + ack/resolve）
- 租户账单/账本：`/console/tenant-bills`（账单 + 账本流水双 Tab）
- 平台级租户管理：`/console/platform-tenants`（CRUD + 编辑计划 + 宽限期表单）
- 租户切换器：Header 右上角 Dropdown（仅多租户用户显示），走 `/api/user/tenants` + `/api/user/tenant/switch`
- 前端路由守卫：`TenantAdminRoute`（允许 tenant_role=10 或平台 admin）

### 已完成（Part E — 2026-04-17，commit `78c5f2c`）
- **租户审计日志页**：`/console/tenant-audit` 整页 + sidebar 入口（action 过滤 + 时间过滤 + 分页）
- **TenantConfigEditor 重构**：5 卡片分组（品牌 / 认证 / 功能开关 / 计费 / Webhook）+ 类型化控件（Switch / Input / TextArea / Logo 预览）+ 31 条 i18n
- **TenantPlanCard**：新增宽限期 Banner 展示

### 未完成
- 现有 `/console/topup`、`/console/site-rpm`、`InvoiceAdmin`、`RebateSettings` 未 Console 化（不影响功能）
- 自定义域名页面（单独需求，超出当前租户覆盖范围）

---

## Phase 7：运维、监控与审计 ✅ 95%
**Commits**: `4fbe038`, `0a44d2f`, `7749030`（持久化 + 巡检 + 邮件推送）, `3b41fca`（前端）, `78c5f2c`（审计日志 + 告警多通道）

### 已完成
- 租户 dashboard 汇总已落地：成员、令牌、渠道、累计/当日 quota 与 request
- 租户 usage trend 已支持 7-90 天
- 租户 model usage 聚合已落地
- 9 种告警类型已接通 Plan：`plan_disabled`、`plan_expired`、`plan_expiring`、`quota_80`、`quota_100`、`rpm_high`、`member_limit`、`token_limit`、`channel_limit`
- `TenantAPIRateLimit()` 已挂到 `apiRouter`（600/60s，Redis 后端）
- 4 个 API 端点已注册：`GET /api/tenant/dashboard`、`/usage/trend`、`/usage/models`、`/alerts`

### 已完成（续）
- 告警持久化：`tenant_alert_records` 表 + active/acknowledged/resolved 状态机 + upsert 去重
- 告警运维 API：`GET /api/tenant/alerts/history`、`POST /api/tenant/alerts/:id/ack`、`POST /api/tenant/alerts/:id/resolve`
- 定时巡检：`StartTenantAlertSweepLoop`（master 节点 5 分钟一次）
- 前端：`/console/tenant-alerts`（活跃 + 历史双 Tab + ack/resolve 操作）、`/console/tenant-dashboard`（summary + 趋势 + 模型排行）

### 已完成（续 — commit `78c5f2c`）
- **审计日志**：`tenant_audit_logs` 表（from scratch）+ 敏感字段脱敏 service + `GET /api/tenant/audit` API
- 9 个集成点：membership invite/accept/remove/update + config set/delete + alert ack
- 前端 `/console/tenant-audit` 整页 + sidebar 入口
- **告警三通道分发**：`tenant_alert_notifier` 三段化（SMTP → Webhook → in-app message）
- Webhook：复用 `service/webhook.go` 的 HMAC 签名 + SSRF 防护
- in-app message：`ListTenantAdminUserIds()` helper，投递到租户全部管理员
- 顺手修复：SMTP 未配置时 early-return 导致 webhook + inapp 一锅端的 bug

### 未完成
- 异常检测与长期时序存储（可复用 site_rpm_snapshots 架构）

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
78c5f2c feat(saas): Phase 4-7 收尾 — 配置三层 / 宽限期 / 审计日志 / 告警多通道 / 配置 UI
7cc52d1 feat(tenant-ui): 租户页面改用 TenantAdminRoute + 更新完成状态文档
3b41fca feat(tenant-ui): Phase 6 Part B/C/D — 计划/配置/仪表盘/告警/账单/平台管理 + 租户切换器
fae665c feat(multi-tenant): Phase 5 租户账单/账本 + 计划状态机
7749030 feat(multi-tenant): Phase 7 告警持久化 + 定时巡检 + 邮件推送
94fc6b7 feat(multi-tenant): Phase 2 Guardrail 升级 — Query/Update/Delete fail-closed
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
