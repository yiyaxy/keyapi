# WeChat Pay v3 多租户集成 — 设计文档

> 日期：2026-04-17（第 2 轮 review 后修订）
> 基于分支：`dev`（commit `78c5f2c`）
> 关联背景：`docs/superpowers/plans/2026-04-16-completion-status.md` Phase 5 的支付能力补齐
>
> **v1 Scope 明确**：仅覆盖**充值**（topup，加到 `users.quota`）和**当前 plan 同档续期**（延长 `TenantPlan.ExpiresAt`）。
> **v1 不覆盖**：升级（换更高 plan）、降级（换更低 plan）、按剩余天数折算差价（proration）、`PlanTemplate` / SKU 商品模型——这些要求先补价格字段与套餐目录，不在本 spec 范围，见 §14。

---

## 1. 背景与目标

### 1.1 现有支付能力

项目已有支付集成：
- Stripe：`controller/topup_stripe.go` + `controller/subscription_payment_stripe.go` + `setting/payment_stripe.go`
- Creem：同上一套
- Waffo（票通/支付宝乐企联用）：同上一套
- Epay：仅订阅（`controller/subscription_payment_epay.go`）

**缺口**：没有微信支付。

### 1.2 本次目标（v1）

给多租户 SaaS 补齐微信支付能力，覆盖：
- 终端用户在租户下充值（`/console/topup`）— 加到 `users.quota`（项目原生的**全局用户额度**语义，见 §11 风险说明）
- 租户管理员对**当前 plan** 发起**续期**（`/console/tenant-plan`）— 延长 `TenantPlan.ExpiresAt`
- 小程序内充值 + 订阅续期（LO 已有小程序，仅提供 API，不做小程序侧 UI）

**v1 明确不做**：升级（换到更高 plan）、降级（换到更低 plan）、按比例折算（proration）。见 §13。

### 1.3 多租户语境

项目是多租户 SaaS（见 `docs/superpowers/plans/2026-04-16-completion-status.md`），支付架构需要匹配：
- 租户隔离 guardrail 已 fail-closed
- `TenantPlan` 已支持 quota/rpm/tpm/max_members/max_tokens/max_channels + GracePeriod
- `tenant_audit_logs` 已落地
- 已有 `StartTenantAlertSweepLoop` 5 分钟定时巡检

---

## 2. 关键决策记录

| 决策项 | 选择 | 理由 |
|--------|------|------|
| **业务范围 (v1)** | 充值 + 订阅**续期**（同 plan 延长 ExpiresAt） | v1 不做升级/降级/proration，见 §13 不做项 |
| **商户号策略** | 每租户独立商户号（白标） | 租户自己对账、自己开发票、自己收款；平台不碰资金 |
| **API 版本** | 仅 v3，不兼容 v2 | 微信官方主推，新能力（分账、营销券）v3 独占；v2 无新接入价值 |
| **SDK** | 官方 `github.com/wechatpay-apiv3/wechatpay-go` | 官方维护；平台证书自动轮换；多商户天然适配；回调验签黑盒化降 CVE 风险 |
| **Sandbox** | 不做 | v3 已无独立沙箱，用真实商户号 0.01 元测试 |
| **产品形态** | Native + H5 + 小程序 JSAPI | 覆盖桌面/手机浏览器/小程序；公众号 JSAPI 跳过（需公众号备案） |
| **小程序架构** | 每租户独立小程序（appid + mchid 一一对应） | 白标最干净，无需跨 appid 绑定审批 |
| **凭据存储** | 新表 `tenant_payment_configs`，敏感字段 AES-256-GCM 加密 | 结构化、可审计、未来支持支付宝/PayPal 复用 |
| **加密主密钥** | HKDF(`CryptoSecret`, `"wechat-pay-keys-v1"`)，可选 env `PAYMENT_MASTER_KEY` 覆盖 | 零配置默认可跑，合规需要时可升级到独立密钥 |
| **回调路由** | 租户专属路径 `/api/payment/wechat/notify/:tenant_id/:order_type` + 订单号前缀二次校验 | 验签第一步就确定租户；伪造订单进不了错租户 |
| **订阅续期** | 手动下单 + 到期前告警（复用现有告警巡检） | v3 无原生 recurring；代扣/支付分/小程序自动续费在 B 方案下资质门槛不可行 |
| **缺单补偿** | 新 goroutine `StartWechatPaymentReconcileLoop`，master 节点 3 分钟一次 | 回调可能丢失，必须有兜底 |
| **退款** | 后台管理员触发（tenant admin 或 platform admin），支持**多次部分退款**（累计上限 = 订单金额） | 通过 `payment_orders.refunded_amount` 累计字段保证幂等 + 防超额，见 §4.2 |
| **支付账目与使用量账目隔离** | `payment_orders` / `payment_refunds` 为独立财务账目，**不写** `tenant_bills` / `tenant_ledgers` | 后者是按周期生成的"使用量快照"（`tenant_bills.QuotaUsed`）和"quota 账本"（`tenant_ledgers.amount` = quota 数量，非人民币），语义与货币金额互斥，混用会污染现有账单闭环 |
| **退款与业务状态** | v1 退款仅做微信原路退回 + 订单状态更新 + 审计，**不回滚** quota 与 ExpiresAt | 当前 quota 是可消费的（已消费无法追回）；TenantPlan 无按支付单保存的有效期快照，硬缩会中断业务。人工补偿由 admin 在审计基础上操作 |
| **每日对账单** | v1 不做，延后到 v2 | 需求度低，人工对账足够早期阶段 |
| **订阅消息** | Phase 2 | 先邮件 + 站内信触达到位再补 |
| **配置 UI** | 独立页 `/console/tenant-payment`，3 tab（配置/订单/退款） | 证书 PEM 多行 TextArea 不适合塞 TenantConfigEditor 的 KV 编辑器 |
| **启用流程** | 租户自助配置 + 测试连接 + 平台 admin 可强制禁用 | SaaS 应有之义，合规时平台仍能兜底 |

---

## 3. 架构分层

```
┌─────────────────────────────────────────────────────────┐
│  Controller 层                                          │
│  ├─ controller/payment_wechat.go  (下单：native/h5/jsapi)│
│  ├─ controller/payment_notify.go  (支付回调 + 退款回调)  │
│  ├─ controller/payment_refund.go  (管理员发起退款)       │
│  └─ controller/tenant_payment.go  (租户凭据配置 CRUD)    │
├─────────────────────────────────────────────────────────┤
│  Service 层  service/payment/                           │
│  ├─ provider.go       PaymentProvider 抽象接口          │
│  ├─ order.go          订单创建/完成/幂等/状态机          │
│  ├─ reconcile.go      缺单补偿循环                      │
│  └─ wechat/                                             │
│      ├─ client.go     per-tenant wechatpay-go Client 缓存│
│      ├─ native.go     Native 下单                       │
│      ├─ h5.go         H5 下单                           │
│      ├─ jsapi.go      JSAPI 下单（小程序）              │
│      ├─ notify.go     回调验签 + 解密 + 幂等应用         │
│      └─ refund.go     退款下单 + 退款回调                │
├─────────────────────────────────────────────────────────┤
│  Model 层                                               │
│  ├─ tenant_payment_config.go   凭据（含加密列）         │
│  ├─ payment_order.go           统一订单                 │
│  └─ payment_refund.go          退款记录                 │
├─────────────────────────────────────────────────────────┤
│  Common 层                                              │
│  └─ crypto.go  新增 HKDF + AES-256-GCM 工具函数         │
└─────────────────────────────────────────────────────────┘
```

---

## 4. 数据模型

### 关于账目隔离（读前必看）

本设计新增的 3 张表 `tenant_payment_configs` / `payment_orders` / `payment_refunds` 构成**一条独立的支付账目**，金额单位**全部为分（CNY）**。

项目既有的 `tenant_bills` / `tenant_ledgers` 是**另一条独立账目**，语义与支付无关：
- `tenant_bills`（`model/tenant_bill.go`）— 按周期（月度）生成的使用量快照，字段如 `QuotaUsed` / `RequestCount`，由 `GenerateTenantBill` / `CloseTenantBill` 维护
- `tenant_ledgers`（`model/tenant_ledger.go`）— quota 账本，`amount` 字段单位是 **quota 数量**（不是人民币）

**两条账目之间不交叉写表**。支付成功时写 `payment_orders` + `top_ups`（老项目现有充值流水表），**不动** `tenant_bills` / `tenant_ledgers`。

### 三张表的 tenant guardrail 约束（共性规则）

本设计新增的 `tenant_payment_configs` / `payment_orders` / `payment_refunds` **全部**必须在 `model/tenant_scope.go` 的 `RegisterTenantScopedTable(...)` 清单里注册（`model/tenant_scope.go:17` / `:161`），触发 Phase 1.5 升级后的 fail-closed guardrail（`model/tenant_scope.go:230`）：

```go
// model/tenant_scope.go 的 Register 清单里补这 3 行：
RegisterTenantScopedTable("tenant_payment_configs")
RegisterTenantScopedTable("payment_orders")
RegisterTenantScopedTable("payment_refunds")
```

不注册 = guardrail 不生效 = 多租户隔离缺口。

**访问规则（三表通用）**：
- **请求上下文**（有 `middleware.GetTenantId(c)`）：查询和更新都要显式 `.Where("tenant_id = ?", tid)` 或传带 tenant 的 `ctx`
- **非请求上下文**（回调、缺单补偿、clientCache 懒加载、启动期 migrate）：用 `model.WithTenantBypass(model.DB)` + 手动 `.Where("tenant_id = ?", tid)`
- 典型坑位与约定：
  - `clientCache.Get(tenantId)` 读 `tenant_payment_configs`：非 request ctx，走 `WithTenantBypass(DB).Where("tenant_id = ? AND provider = ?", tid, "wechat").First(&cfg)`
  - 支付回调 / 退款回调读 `payment_orders`：route 解析出 `:tenant_id` 后，用 `WithTenantBypass(DB).Where("tenant_id = ? AND out_trade_no = ?", urlTid, outTradeNo)`
  - 缺单补偿 `reconcilePendingOrders` 扫 `payment_orders`：全表扫是合法跨租户操作，整个扫描语句外层 `WithTenantBypass`，对每条命中再按该订单 tenant_id 调 `clientCache.Get(...)`
  - 管理 CRUD（`/api/tenant/payment/*`）走 request ctx，tenant 自动注入
- 违反约束的查询会被 `tenantGuardScope` 拒绝并输出 `[tenant-guardrail] UNSCOPED QUERY REJECTED: table=<name>` 日志

### 4.1 `tenant_payment_configs`

```go
type TenantPaymentConfig struct {
    Id             int    `gorm:"primaryKey"`
    TenantId       int    `gorm:"uniqueIndex:idx_tenant_provider;not null"`
    Provider       string `gorm:"uniqueIndex:idx_tenant_provider;type:varchar(32)"` // "wechat"

    Enabled        bool   `gorm:"default:false"` // 租户自己的启用状态
    PlatformLocked bool   `gorm:"default:false"` // 平台 admin 强制禁用（优先级高于 Enabled）

    // 非敏感
    AppId          string `gorm:"type:varchar(64)"`
    Mchid          string `gorm:"type:varchar(32)"`
    SerialNo       string `gorm:"type:varchar(64)"`

    // 敏感（AES-256-GCM 后 base64：nonce(12)||ct||tag(16)）
    AppSecretEnc   string `gorm:"type:text"` // 小程序 appsecret
    Apiv3KeyEnc    string `gorm:"type:text"` // APIv3 对称密钥
    PrivateKeyEnc  string `gorm:"type:text"` // 商户 API 证书私钥 PEM

    // 凭据测试状态
    LastTestAt     int64
    LastTestOk     bool
    LastTestError  string `gorm:"type:varchar(500)"`

    CreatedAt, UpdatedAt int64
}
```

**guardrail**：本表必须注册到 `model/tenant_scope.go`，遵守 §4 开头定义的**三表通用访问规则**（clientCache 懒加载等非请求路径必须 `WithTenantBypass` + 显式 `.Where("tenant_id = ?", tid)`）。

### 4.2 `payment_orders`

```go
type PaymentOrder struct {
    Id            int    `gorm:"primaryKey"`
    TenantId      int    `gorm:"index;not null"`
    UserId        int    `gorm:"index"`               // topup: 充值用户；sub: 租户 admin

    Provider      string `gorm:"type:varchar(32);index"` // "wechat"
    OrderType     string `gorm:"type:varchar(16);index"` // "topup" / "sub"
    ProductForm   string `gorm:"type:varchar(16)"`       // "native" / "h5" / "jsapi"

    OutTradeNo    string `gorm:"type:varchar(64);uniqueIndex"`
    TransactionId string `gorm:"type:varchar(64);index"` // 微信返回

    Amount        int64  // 订单总金额，单位：分（CNY）
    Currency      string `gorm:"type:varchar(8);default:'CNY'"`

    // 累计已退款金额，单位：分。
    // 多次部分退款时累加；Status 根据 RefundedAmount 与 Amount 关系推导：
    //   RefundedAmount = 0           → status = paid（支付成功尚未退款）
    //   0 < RefundedAmount < Amount  → status = partial_refunded
    //   RefundedAmount = Amount      → status = fully_refunded
    // 发起退款前必须校验：RefundedAmount + request.amount <= Amount，否则拒绝。
    // 幂等：payment_refunds.out_refund_no 唯一索引防止同一 refund 重复生效；
    //       ApplyRefundSuccess 事务内 UPDATE ... WHERE status='pending' 确保累加只发生一次。
    RefundedAmount int64 `gorm:"bigint;default:0"`

    Status        string `gorm:"type:varchar(24);index"`
    // 状态机（全部可能值）：
    //   pending            — 下单完成，等待用户支付
    //   paid               — 支付成功（通过回调或查单确认），尚无退款（RefundedAmount == 0）
    //   partial_refunded   — 支付成功，且已累计退回部分金额（0 < RefundedAmount < Amount）
    //   fully_refunded     — 支付成功，且已全额退回（RefundedAmount == Amount）
    //   closed             — 用户主动取消，或管理员关闭
    //   expired            — 下单后 2h 未支付，超时关闭
    //
    // 合法迁移（单向，状态一旦推进不回退）：
    //   pending → paid
    //   pending → closed
    //   pending → expired
    //   paid → partial_refunded         （第一次部分退款）
    //   paid → fully_refunded           （一次性全额退款）
    //   partial_refunded → partial_refunded  （多次部分退款，RefundedAmount 累加但状态仍 partial）
    //   partial_refunded → fully_refunded    （累计退够）
    //
    // 任何 fully_refunded / closed / expired 都是终态，不再迁移。

    Openid        string `gorm:"type:varchar(128)"` // JSAPI 场景
    Metadata      string `gorm:"type:text"`          // JSON
    // Metadata 字段：
    //   topup:  { "quota_delta": int64 }       — 本次充值要增加的 users.quota 数量
    //   sub:    { "renew_period_days": int }   — 本次续期延长的天数（默认读 TenantPlan.RenewPeriodDays）
    //
    // 注意：tenant_id 字段语义 = "收款归属 / 对账锚点"，不是 "消费域"。
    // topup 充值进入 users.quota 是全局额度（§11 风险说明）。

    PaidAt        int64
    ExpiresAt     int64 // 订单过期时间（下单时 = now + 2h）

    CreatedAt, UpdatedAt int64
}
```

**订单号格式**：`wx_t{tenant_id}_{kind}_{unix_sec}_{rand6}`
- `kind`: `T`（topup）/ `S`（subscription）— 单字符压缩，URL path 里仍用 `topup`/`sub` 全称（空间充足）
- `unix_sec`：10 位秒级时间戳
- `rand6`：6 位随机（a-z0-9）
- 最大长度（tid=9999999）：3+9+2+11+6 = **31 字符**，满足微信 32 字符上限
- 回调路由一致性校验逻辑：
  ```go
  // URL: /api/payment/wechat/notify/:tenant_id/:order_type
  // out_trade_no 必须以 "wx_t{url_tenant_id}_" 开头
  // 且 kind 字符与 :order_type 对齐：T↔topup，S↔sub
  ```

**状态机示意**（完整迁移表见上方字段注释；这里仅图示常用路径）：
```
              ┌─────────┐  支付成功（回调 or 查单）  ┌──────┐
              │ pending │────────────────────────────▶│ paid │
              └─────────┘                             └──────┘
                 │   │                                   │
                 │   └──── 2h 未支付 ──▶ expired         │
                 │                                       │ 部分退款
                 └──── 用户取消 ──▶ closed               │
                                                        ▼
                                              ┌──────────────────┐
                                              │ partial_refunded │◀── 多次部分退款累加
                                              └──────────────────┘
                                                        │
                                                        │ 累计退够 Amount
                                                        ▼
                                              ┌─────────────────┐
                                              │ fully_refunded  │  （终态）
                                              └─────────────────┘

     一次性全额退款：paid ──▶ fully_refunded
```

**guardrail**：本表必须注册到 `model/tenant_scope.go`，遵守 §4 开头定义的**三表通用访问规则**。回调/缺单补偿路径读写订单时全部走 `WithTenantBypass + .Where("tenant_id = ?", tid)`。

### 4.3 `payment_refunds`

```go
type PaymentRefund struct {
    Id             int    `gorm:"primaryKey"`
    TenantId       int    `gorm:"index"`
    OrderId        int    `gorm:"index;not null"`  // 关联 PaymentOrder.Id

    OutRefundNo    string `gorm:"type:varchar(64);uniqueIndex"` // 幂等键
    RefundId       string `gorm:"type:varchar(64);index"`       // 微信返回的 refund_id

    Amount         int64  // 本次退款金额，单位：分（不是累计，累计在 PaymentOrder.RefundedAmount）
    Reason         string `gorm:"type:varchar(200)"`

    OperatorUserId int    // 发起退款的管理员 user_id（审计用）
    Status         string `gorm:"type:varchar(16);index"`
    // 状态机：pending（微信受理，等退款通知）→ success | fail
    //         success 才会把 PaymentOrder.RefundedAmount += Amount

    FailReason     string `gorm:"type:varchar(500)"`
    RefundedAt     int64  // 微信退款完成时间

    CreatedAt, UpdatedAt int64
}
```

**一个 PaymentOrder 可对应多个 PaymentRefund（多次部分退款）**。每条 PaymentRefund 记录一次退款请求，仅在 Status=success 时把 Amount 累加到 `PaymentOrder.RefundedAmount`。

**guardrail**：本表必须注册到 `model/tenant_scope.go`，遵守 §4 开头定义的**三表通用访问规则**。退款回调路径由 URL 已解析出 `:tenant_id`，后续所有读写用 `WithTenantBypass + .Where("tenant_id = ?", tid)`。

---

## 5. 加密基础（common/crypto.go 扩展）

### 5.1 新增函数

```go
// DeriveKey 基于 HKDF-SHA256 派生 32 字节子密钥
// master 通常是 []byte(CryptoSecret)
// info 为业务标识，用于不同用途的密钥物理隔离
func DeriveKey(master []byte, info string) []byte

// EncryptAESGCM 用 32 字节 key 加密明文
// 输出格式：base64(nonce(12) || ciphertext || tag(16))
func EncryptAESGCM(key, plaintext []byte) (string, error)

// DecryptAESGCM 解密 EncryptAESGCM 的输出
func DecryptAESGCM(key []byte, b64cipher string) ([]byte, error)
```

### 5.2 支付密钥获取策略

```go
// service/payment/crypto.go
func paymentMasterKey() []byte {
    if v := os.Getenv("PAYMENT_MASTER_KEY"); v != "" {
        decoded, err := base64.StdEncoding.DecodeString(v)
        if err == nil && len(decoded) == 32 {
            return decoded
        }
        // 长度不对或 base64 失败 → 启动报错
        log.Fatal("PAYMENT_MASTER_KEY must be 32-byte base64")
    }
    return common.DeriveKey([]byte(common.CryptoSecret), "wechat-pay-keys-v1")
}
```

**安全要点**：
- 解密失败 → 视为凭据损坏，该租户 `Enabled` 自动置 false，写告警 `payment.credential.corrupted`
- 密钥派生 info 字符串带 `-v1` 后缀，未来密钥格式升级用 `-v2` 不破坏老数据

---

## 6. 服务层关键接口

### 6.1 PaymentProvider 抽象

```go
// service/payment/provider.go
type PaymentProvider interface {
    Name() string // "wechat" / "alipay" / ...

    // CreateOrder 下单，返回前端需要的拉起参数
    //   native -> code_url
    //   h5     -> h5_url
    //   jsapi  -> prepay_id (前端自己组装 wx.requestPayment 参数)
    CreateOrder(ctx context.Context, req CreateOrderRequest) (CreateOrderResponse, error)

    // VerifyAndParseNotify 验签 + 解密回调，返回订单号 + 支付结果
    VerifyAndParseNotify(ctx context.Context, tenantId int, body []byte, headers http.Header) (*NotifyResult, error)

    // QueryOrder 主动查单（用于缺单补偿）
    QueryOrder(ctx context.Context, tenantId int, outTradeNo string) (*OrderStatus, error)

    // Refund 发起退款
    Refund(ctx context.Context, req RefundRequest) (*RefundResponse, error)

    // TestCredentials 测试凭据有效性（调 /v3/certificates）
    TestCredentials(ctx context.Context, tenantId int) error
}
```

### 6.2 per-tenant Client 缓存

```go
// service/payment/wechat/client.go
type clientCache struct {
    mu      sync.RWMutex
    clients map[int]*core.Client // key: tenantId
    configs map[int]*model.TenantPaymentConfig // cache 的配置快照
}

// Get 拿到某租户的 wechatpay-go Client
// 内部逻辑：
//   1. 查 cache，若 config.UpdatedAt 未变则直接返回
//   2. 否则从 DB 读 config，解密私钥，构建 Client
//   3. Client 内置 wechatpay-go 的 Downloader（平台证书自动轮换 12h）
func (c *clientCache) Get(tenantId int) (*core.Client, error)

// Invalidate 配置更新后调用，下次 Get 重建
func (c *clientCache) Invalidate(tenantId int)
```

### 6.3 订单状态机 + 幂等

```go
// service/payment/order.go

// CreateOrder 写入 payment_orders，status=pending
// 幂等：同一 user + order_type + 5 秒内的重复请求直接返回已有订单
func CreateOrder(ctx context.Context, req ...) (*model.PaymentOrder, error)

// ApplyPaymentSuccess 订单支付成功（回调 + 查单两条路径都走这里）
// 幂等：如果订单已经是 paid 或任何已支付后状态，直接 return nil
// 事务内完成：订单 status pending→paid + 业务应用（quota 增加 / plan 续期）
func ApplyPaymentSuccess(ctx context.Context, outTradeNo string, transactionId string, paidAt int64) error

// CreateRefund 发起退款：管理员调用路径
// 在事务内对 PaymentOrder 加行锁后校验：
//   1. order.Status ∈ {paid, partial_refunded}（fully_refunded / pending / closed / expired 拒绝）
//   2. order.RefundedAmount + req.Amount <= order.Amount（超额拒绝）
//   3. req.Amount > 0
// 通过则插入 PaymentRefund 行（Status=pending），调微信退款 API
func CreateRefund(ctx context.Context, req CreateRefundRequest) (*model.PaymentRefund, error)

// ApplyRefundSuccess 退款回调处理（微信退款通知触发）
// 幂等：如果该 refund 已是 success 或 fail 状态，直接 return nil
// 事务内完成：
//   UPDATE payment_refunds SET status='success', refunded_at=? WHERE out_refund_no=? AND status='pending'
//   UPDATE payment_orders SET refunded_amount = refunded_amount + ?,
//     status = CASE WHEN refunded_amount + ? >= amount THEN 'fully_refunded' ELSE 'partial_refunded' END
//     WHERE id=? AND refunded_amount + ? <= amount
//   如果任一 UPDATE RowsAffected=0 → 回滚 + 告警（并发冲突或超额）
// 语义：仅做财务归账。**不自动回滚 users.quota 或 TenantPlan.ExpiresAt**（见 §11 风险说明）。
func ApplyRefundSuccess(ctx context.Context, outRefundNo string, refundedAt int64) error
```

**业务应用分发（支付成功）**：

- `order_type = topup`：
  - **tenantId 参数必须传 `model.GetUserTenantId(order.UserId)`**（user 的 home tenant），**不是** `order.TenantId`（收款归属）。
    - 原因：`model.IncreaseUserQuota(id, quota, true, tenantId)` 在 `model/user.go:1062` 下沉到 `increaseUserQuota` 后会把 tenantId 拼进 `WHERE tenant_id = ?`。
    - `users.tenant_id` 是用户的 **home tenant**，**会话切租户（`controller/user_tenant_switch.go:30`）不改写这一列**。
    - 如果传会话 tenantId（即 `order.TenantId`），当充值用户当前会话在非 home tenant 下操作时，UPDATE RowsAffected=0，订单支付成功但 quota 没加上。
    - 参照现有 topup 实现（`controller/topup.go:374`）：`model.IncreaseUserQuota(topUp.UserId, quotaToAdd, true, model.GetUserTenantId(topUp.UserId))`。
  - 调用形如：`model.IncreaseUserQuota(order.UserId, quotaDelta, true, model.GetUserTenantId(order.UserId))` → 加到 `users.quota`（**全局用户额度**，见 §11.1）
  - 写 `top_ups` 镜像记录（复用现有充值流水表，不碰 tenant_bills）
  - **`TopUp.TenantId = order.TenantId`**（**不是** `GetUserTenantId(order.UserId)`）
    - 原因：`top_ups` 是**按会话租户可见**的流水表。现有 topup 创建时也写会话租户（`controller/topup.go:232`：`TenantId: middleware.GetTenantId(c)`）。发票可开票筛选和充值历史都按 `top_ups.tenant_id` 过滤（`service/invoice_service.go:248`、`model/topup.go:152`）
    - 如果误写成 `GetUserTenantId`（home tenant），微信充值单在用户当前租户的发票申请页和充值历史里会**消失**
  - **双 tenant 值不是 bug，是有意区分**：
    - `users.quota` 的 UPDATE WHERE 要匹配 `users.tenant_id`（home tenant，见 §6.3 第 1 点）
    - `top_ups.tenant_id` 写会话租户（保持发票/历史可见性）
    - 两层目的不同：前者是"数据行定位"，后者是"业务可见性归属"
  - **`TopUp.PaymentMethod` 必须写 `"wxpay"`**（**不是** spec 内部 Provider 常量 `"wechat"`）。原因：项目既有约定（`setting/operation_setting/payment_setting_old.go:31` 注册的 type 是 "wxpay"），发票申请链路按 `payment_method IN ('alipay', 'wxpay')` 筛选可开票订单（`service/invoice_service.go:245/265/449/508`）。写 `"wechat"` 会让微信充值单从"可开票"筛选里静默消失。
  - 区分原则：
    - `payment_orders.provider = "wechat"` — 新 spec 内部 Provider 抽象标识，用于选 `PaymentProvider` 实现、构造 client 等
    - `top_ups.payment_method = "wxpay"` — 项目既有上下文词汇，用于兼容发票、充值流水、显示等老链路
    - 两者是不同层语义，不混用
- `order_type = sub`（续期）：
  - `TenantPlan.ExpiresAt += renewPeriodDays * 86400`（调用新增 helper `ExtendTenantPlanExpiry`）
  - **不**主动改 `Status` 字段。`Status` 的 disabled 状态由到期状态机（`StartTenantBillingAndPlanLoop`）根据 `ExpiresAt+GracePeriodSeconds` 自行维护；续期把 `ExpiresAt` 推到未来后，下一轮巡检会把 `Status` 从 disabled 自动恢复为 active
  - **不**调用 `tenant_bills` / `tenant_ledgers` 相关函数。那套是"使用量账单快照"语义（`GenerateTenantBill` / `CloseTenantBill`），和支付订单是两条独立账目
- 审计：两类都写 `tenant_audit_logs`，actions：`payment.topup.success` / `payment.sub.renewed`

**退款（仅财务归账，不自动回滚业务）**：

### 发起（`CreateRefund`，管理员触发）
- 事务内对 `PaymentOrder` 加 `SELECT ... FOR UPDATE` 行锁
- 三项校验必须全过：
  1. `order.Status ∈ {paid, partial_refunded}`（已全额退 / 未支付 / 已关闭不允许再退）
  2. `order.RefundedAmount + req.Amount <= order.Amount`（累计不超过订单金额）
  3. `req.Amount > 0`
- 写入 `payment_refunds` 行（Status=pending），调微信退款 API
- 审计：`payment.refund.initiate`（含 order_id / amount / reason / operator）

### 退款回调（`ApplyRefundSuccess`，微信 notify 触发）
- 两条 UPDATE 必须在同事务原子完成，语句本身自带幂等保护：
  ```sql
  UPDATE payment_refunds
     SET status='success', refunded_at=?
   WHERE out_refund_no=? AND status='pending';   -- RowsAffected=0 表示已处理过，幂等 return nil

  UPDATE payment_orders
     SET refunded_amount = refunded_amount + ?,
         status = CASE
           WHEN refunded_amount + ? >= amount THEN 'fully_refunded'
           ELSE 'partial_refunded'
         END
   WHERE id = ?
     AND refunded_amount + ? <= amount;            -- 防越界：RowsAffected=0 → 异常回滚 + 告警
  ```
- 审计：`payment.refund.success`（含 refund_id / new refunded_amount / new order status）

### 明确不做（see §11.3）
- **不**自动减 `users.quota`（可能已被消费，强扣会出负余额）
- **不**自动缩短 `TenantPlan.ExpiresAt`（没有按订单保存的有效期快照，且可能已跨越 grace period，硬缩会中断业务）
- 业务差额补偿由平台 admin 根据审计日志 + 用量数据人工操作，通过既有 admin API 改 quota 或 plan

### 6.4 缺单补偿

```go
// service/payment/reconcile.go

func StartWechatPaymentReconcileLoop() {
    if !common.IsMasterNode { return }
    go func() {
        ticker := time.NewTicker(3 * time.Minute)
        defer ticker.Stop()
        for range ticker.C {
            reconcilePendingOrders()
        }
    }()
}

func reconcilePendingOrders() {
    // SELECT * FROM payment_orders
    //   WHERE provider='wechat' AND status='pending'
    //   AND created_at < NOW()-2min AND created_at > NOW()-2h
    //   LIMIT 100
    // 对每条：
    //   wxClient.Get(tenantId).QueryOrder(outTradeNo) → 
    //     SUCCESS → ApplyPaymentSuccess
    //     NOTPAY  → skip（下次再查）
    //     CLOSED/REVOKED → 标记 closed
    //     USERPAYING → skip
    //   超 2h 仍 NOTPAY → 标记 expired
}
```

---

## 7. API 清单

### 7.1 租户配置（需要 `RequireTenantAdmin` 中间件）

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/tenant/payment/configs` | 查当前租户所有 provider 配置（敏感字段不返回明文） |
| PUT | `/api/tenant/payment/configs/wechat` | 更新配置（敏感字段服务端加密） |
| POST | `/api/tenant/payment/configs/wechat/test` | 测试凭据有效性 |
| DELETE | `/api/tenant/payment/configs/wechat` | 清除配置（Enabled→false，加密字段清空） |

### 7.2 平台管理（需要 `RequirePlatformAdmin`）

| Method | Path | 说明 |
|--------|------|------|
| PUT | `/api/platform/tenants/:id/payment/lock` | 强制禁用（PlatformLocked=true） |
| PUT | `/api/platform/tenants/:id/payment/unlock` | 解除强制禁用 |
| PUT | `/api/platform/tenants/:id/plan` | **扩展现有接口**：`UpdateTenantPlanRequest`（`controller/tenant_plan.go:31`）新增 3 个字段 `renew_period_days` / `renew_price_amount` / `renew_currency`，与其他可选字段一致用指针或零值判断。此接口是续期定价的**唯一配置入口** |

### 7.3 下单（需要登录，`UserAuth` 或 `TenantAdminAuth`）

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/payment/wechat/topup/native` | 桌面扫码充值 |
| POST | `/api/payment/wechat/topup/h5` | 手机浏览器充值 |
| POST | `/api/payment/wechat/topup/jsapi` | 小程序充值（需 body 传 openid） |
| POST | `/api/payment/wechat/sub/native` | 桌面续期 |
| POST | `/api/payment/wechat/sub/jsapi` | 小程序续期 |

### 7.4 回调（微信服务器调用，**不走业务鉴权**）

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/payment/wechat/notify/:tenant_id/:order_type` | 支付结果通知 |
| POST | `/api/payment/wechat/refund-notify/:tenant_id` | 退款结果通知 |

**安全层**：
- HTTPS only（Nginx 前置）
- 签名校验必过（用该租户的平台证书）
- 订单号前缀和 `:tenant_id` 一致性校验，不一致 → 400 + `tenant_audit_logs` 记 `payment.notify.mismatch`

### 7.5 订单 & 退款

| Method | Path | 鉴权 | 说明 |
|--------|------|------|------|
| GET | `/api/payment/orders/:out_trade_no` | **`UserAuth`** + 归属校验 | 订单详情（前端轮询支付状态用） |
| GET | `/api/tenant/payment/orders` | `RequireTenantAdmin` | 订单列表（分页、筛选 provider/order_type/status） |
| POST | `/api/tenant/payment/refunds` | `RequireTenantAdmin` or `RequirePlatformAdmin` | 发起退款 |
| GET | `/api/tenant/payment/refunds` | `RequireTenantAdmin` | 退款列表 |

**`GET /api/payment/orders/:out_trade_no` 归属校验**（必须写在 handler，和现有 `router/api-router.go:128` 的 UserAuth 路由分组一致）：

```go
// 查出订单后，严格校验下列之一成立，否则返 404（不用 403，避免攻击者通过响应码差异探测订单是否存在）：
//   a. session.user_id == order.user_id（下单用户本人）
//   b. session.tenant_id == order.tenant_id 且 session 是 tenant admin / platform admin
// 其他任何情况都返 404。
// 返回 payload 不包含敏感字段（openid、metadata 的私有 key），只回 status / amount / refunded_amount / paid_at。
```

这样防止任何登录用户通过 `out_trade_no`（订单号结构已公开在本文档）探测他人订单状态。

---

## 8. 续期流程（v1 不含升降级）

### 8.1 TenantPlan 字段扩展

```go
// 现有 TenantPlan 外新增 3 个字段：
RenewPeriodDays  int    `json:"renew_period_days" gorm:"default:30"`  // 续期周期（天）
RenewPriceAmount int64  `json:"renew_price_amount" gorm:"bigint;default:0"` // 续期单价，单位：分（CNY）；0 表示未定价，不允许续期
RenewCurrency    string `json:"renew_currency" gorm:"type:varchar(8);default:'CNY'"`
```

**定价策略（v1 最小可行）**：
- `RenewPriceAmount` 由 **platform admin** 在 `/console/platform-tenants` 设置 TenantPlan 时填写，单位分（CNY）
- 与 Stripe/Creem 走的 `SubscriptionPlan.PriceAmount`（`model/subscription.go:166`，单位美元 float）**不同体系**，不互相引用
- `TenantPlan` 是平台 → 租户维度的套餐（每租户一行），不是可售商品目录；因此**没有 SKU 概念**，每个租户的 RenewPriceAmount 可以不同（谈判空间）
- 创建 sub 订单时后端直接读 `plan.RenewPriceAmount`：
  - `RenewPriceAmount <= 0` → 拒绝下单，返回"计划未配置续期价格，请联系管理员"
  - 客户端**不能**传 Amount；后端忽略传入的 amount，以 DB 为准
- v2 如果要做多 SKU / proration / 升降级，再引入独立的 `PlanTemplate` 表和目录 UI

### 8.2 告警扩展

在 `service/tenant_alerts.go` 新增 3 类告警（接入现有 `StartTenantAlertSweepLoop`）：
- `plan_renew_available`：`expires_at - 7*86400 < now < expires_at - 6*86400`
- `plan_renew_urgent`：`expires_at - 3*86400 < now < expires_at - 2*86400`
- `plan_renew_final`：`expires_at - 1*86400 < now < expires_at`

告警推送走现有三通道（SMTP / Webhook / in-app message）。

### 8.3 续期支付成功

```go
// service/payment/order.go: ApplyPaymentSuccess — sub 分支
if order.OrderType == "sub" {
    meta := parseMetadata(order.Metadata)
    renewDays := meta.RenewPeriodDays
    plan, err := model.GetTenantPlan(order.TenantId)
    if err != nil { return err }
    if renewDays <= 0 { renewDays = plan.RenewPeriodDays }
    if renewDays <= 0 { renewDays = 30 } // 最后兜底

    // 1. 延长 ExpiresAt
    if err := model.ExtendTenantPlanExpiry(order.TenantId, int64(renewDays)*86400); err != nil {
        return err
    }

    // 2. 显式恢复 Status=Active（如当前是 Disabled）
    //
    // 现有状态机 RunTenantPlanStateMachine（service/tenant_billing.go:132）
    // 只有单向迁移：active → grace → disabled；没有任何 disabled → active 的
    // 反向迁移。请求侧 CheckTenantQuota（service/tenant_quota.go:69）对 Status
    // != Active 直接返回"租户计划已禁用"。因此续期支付成功必须由这里显式把
    // Status 改回 Active，否则已停服租户付了钱仍无法用服务。
    statusRecovered := false
    if plan.Status != model.TenantPlanStatusActive {
        if err := model.WithTenantBypass(model.DB).
            Model(&model.TenantPlan{}).
            Where("id = ? AND tenant_id = ?", plan.Id, plan.TenantId).
            Updates(map[string]any{
                "status":     model.TenantPlanStatusActive,
                "updated_at": time.Now().Unix(),
            }).Error; err != nil {
            return err
        }
        model.InvalidateTenantPlanCache(plan.TenantId)
        statusRecovered = true
    }

    // 3. 审计
    _ = model.CreateTenantAuditLog(&model.TenantAuditLog{
        TenantId:    order.TenantId,
        ActorUserId: order.UserId,
        Action:      "payment.sub.renewed",
        Target:      "tenant_plans",
        TargetId:    plan.Id,
        Detail:      mustJSON(map[string]any{
            "order_id":         order.Id,
            "amount":           order.Amount,
            "renew_days":       renewDays,
            "old_expires_at":   plan.ExpiresAt,
            "new_expires_at":   plan.ExpiresAt + int64(renewDays)*86400,
            "status_recovered": statusRecovered,
        }),
    })
}
```

**不做**：
- 不写 `tenant_bills` / `tenant_ledgers`（那套是使用量账单周期快照，不是支付订单）
- 不处理升降级（v1 scope 外）

---

## 9. 前端改动

### 9.1 新页面：`/console/tenant-payment`

**路由**：`TenantAdminRoute` 守卫。

**Tab 1: 配置**
- Provider 分 tab：WeChat（本次）/ Alipay / PayPal（预留 disabled）
- WeChat 字段：AppID / AppSecret（密码输入）/ Mchid / APIv3 Key（密码输入）/ Serial No / Private Key PEM（TextArea）
- 只读展示：Notify URL、Refund Notify URL（带复制按钮）
- 按钮：[保存] [测试连接]
- Status Banner：● 已启用 / ○ 已禁用 / ⚠ 凭据测试失败（显示 LastTestError）
- 如果 `PlatformLocked=true`，全页只读 + 顶部红色 Banner "已被平台管理员禁用"

**Tab 2: 订单**
- 分页列表：out_trade_no / order_type / amount / status / paid_at
- 筛选：order_type / status / 日期范围
- 点订单号展开详情（transaction_id、openid、metadata）

**Tab 3: 退款**
- 退款列表 + "发起退款"按钮（弹窗选订单 + 填退款金额 + reason）

### 9.2 `/console/topup` 扩展

在现有支付方式选择（Stripe/Creem/Waffo）旁加 **微信支付** 选项：
- 桌面端：点"微信支付" → 后端 `/api/payment/wechat/topup/native` → 弹 modal 显示二维码 + 前端轮询 `/api/payment/orders/:out_trade_no` 3 秒一次直到 success 或 modal 关闭
- 移动端（UA 判断）：点"微信支付" → 后端 `/api/payment/wechat/topup/h5` → `window.location = h5_url` 拉起微信

### 9.3 `/console/tenant-plan` 扩展

- 新增 Banner 展示剩余天数 / 续期按钮
- 点"立即续期"→ 同 9.2 桌面端逻辑，但走 `/api/payment/wechat/sub/native`

### 9.4 平台管理页 `/console/platform-tenants` 扩展

租户详情弹窗（现有编辑 plan 的表单）新增两块：

**A. 支付能力开关**
- "禁用该租户支付能力" 开关（绑定 `PlatformLocked`，走 `/api/platform/tenants/:id/payment/lock|unlock`）

**B. 续期定价（必填，否则该租户无法续期）**
- `RenewPeriodDays` 数字输入（默认 30）
- `RenewPriceAmount` 数字输入（单位：分；前端展示元，提交时 ×100 转分）
- `RenewCurrency` Select（默认 CNY，v1 仅 CNY）
- 挂在 PUT `/api/platform/tenants/:id/plan`（已有入口，后端 `UpdateTenantPlanRequest` 扩展 3 个字段）
- 保存后前端展示状态 Banner："续期单价 ¥X / Y 天"
- 若 `RenewPriceAmount <= 0`，该租户的 `/console/tenant-plan` 页续期按钮 disabled + 提示"请联系平台管理员配置续期价格"

**C. 审计**
- 价格变更进 `tenant_audit_logs`，action=`plan.renew_price.updated`，detail 含 old_amount / new_amount / operator

### 9.5 i18n

中英文 key 约 20 条，加到 `web/src/i18n/locales/zh-CN.json` + `en.json`。

---

## 10. 执行节奏（拆 3 Slice）

| Slice | 交付范围 | 关键产出 |
|-------|----------|---------|
| **S1: 凭据基础** | common/crypto.go 扩展 / tenant_payment_configs 模型 / 配置页（仅 Tab 1）/ 测试连接 API | 可以配置 + 凭据测试通过 |
| **S2: 下单 + 回调 + 续期定价配置** | payment_orders 模型 / Native/H5/JSAPI 三种下单 / 回调处理 / 订单状态机 / 订单查询 API（含归属校验）/ topup 业务联动（IncreaseUserQuota 用 GetUserTenantId）/ **TenantPlan 新增 RenewPeriodDays/RenewPriceAmount/RenewCurrency 字段 + UpdateTenantPlanRequest 扩展 + `/console/platform-tenants` 价格编辑 UI** / sub 下单前价格校验（`<=0` 拒绝）/ sub 续期成功显式恢复 Status / `/console/topup` 和 `/console/tenant-plan` 支付入口 / 订单 Tab | 端到端可完成一笔充值和一笔续期；续期前平台已能配置价格 |
| **S3: 退款 + 补偿 + 续期告警** | payment_refunds 模型 / 退款 API（仅财务退回，不回滚业务）/ 退款回调 / 缺单补偿循环 / 续期告警 3 类 / RenewPeriodDays 字段 / 退款 Tab / 平台锁定开关 | 可以退款 + 丢回调能补偿 + 到期前自动告警 |

依赖关系：S1 → S2 → S3，严格串行，每个 Slice 交付后 go build + 手工跑通关键路径 + commit。

---

## 11. 已知模型局限与风险说明

这部分不是微信支付引入的新问题，而是**项目原有模型在多租户 + 支付场景下的既有限制**，spec 要显式声明以避免未来被误解。

### 11.1 `users.quota` 是全局额度，不是租户域额度

- 项目既有行为：`users.quota` 是用户身上的整数字段（`model/user.go`），所有租户共享同一块余额。
- 用户如果通过 `/api/user/tenant/switch` 在多个 tenant 之间切换，**quota 是跟人走的**。
- 在 A 租户充值 → 切到 B 租户 → 在 B 消费，是可能发生的。
- 本次 spec 不修改这个模型。`payment_orders.tenant_id` 的语义是 **"收款归属 / 对账锚点"**，用于：
  - 走哪个租户的商户号下单和收款
  - 退款和审计的租户隔离
  - **不代表** quota 只能在该 tenant 消费

### 11.2 v2 切到租户域 quota 的路径（未来）

如果后续产品侧要求严格的租户隔离额度（A 充值不能在 B 消费），需要：
- 新建 `user_tenant_quotas` 表（`user_id + tenant_id → quota`）
- 改 relay 扣费路径，从 `users.quota` 切到 `user_tenant_quotas[user_id, current_tenant_id].quota`
- payment_orders 的 topup 成功，加到 `user_tenant_quotas[order.user_id, order.tenant_id]`
- 是**项目级重构**，超出本 spec 范围

### 11.3 退款不自动回滚业务状态 + 累计退款边界

**财务侧（支持部分退款，幂等安全）**：
- `PaymentOrder.RefundedAmount` 累计已退款金额，单位分
- 发起退款前事务内锁行校验 `RefundedAmount + req.Amount <= Amount` 和 `Status ∈ {paid, partial_refunded}`
- Order.Status 由累计金额推导：`partial_refunded`（部分）/ `fully_refunded`（全额）
- `out_refund_no` unique + UPDATE...WHERE status='pending' 双重幂等
- 见 §4.2、§6.3 具体 SQL

**业务侧（v1 不自动回滚，原因见下）**：
- **不扣 `users.quota`**：项目没有按支付单保存"本单授予的额度"快照，且充值的 quota 可能已部分或全部被消费，硬扣会造成负余额
- **不缩短 `TenantPlan.ExpiresAt`**：TenantPlan 只有一份实时生效的 ExpiresAt，没有按支付单保存"本单延长的有效期段"，且可能已跨越 grace period，硬缩会中断跑起来的业务
- 业务差额补偿：平台 admin 在看过审计日志和用量之后**人工**决定，用 admin API 调 quota 或 plan
- 这是一个有意的保守设计，优先业务连续性 over 严格的账目自动化对齐
- 如果未来要做自动回滚，需要先补两个模型：
  1. `PaymentOrder.GrantSnapshot`（topup 授予 quota 的快照）+ `users.quota` 的"可退款余额"概念
  2. `TenantPlan` 的按订单有效期段模型（每个续期订单延长了哪段 ExpiresAt）

### 11.4 TenantPlan.Status 状态机（注意：单向迁移 + 显式恢复）

- Status 是 `int`：`TenantPlanStatusActive = 1` / `TenantPlanStatusDisabled = 0`（`model/tenant_plan.go:31-33`）
- 宽限期不是独立状态值，而是由 `now() > ExpiresAt && now() <= ExpiresAt + GracePeriodSeconds` 推导
- `RunTenantPlanStateMachine`（`service/tenant_billing.go:132`）只做 **active → disabled** 单向迁移，**没有 disabled → active 的反向迁移**
- 请求侧 `CheckTenantQuota`（`service/tenant_quota.go:69`）对 `Status != Active` 直接拒服务
- **续期支付成功必须显式写 `Status=Active`**（见 §8.3 分支 2），否则已停服租户付了钱仍无法用服务
- 在 `UPDATE` 里用 `WithTenantBypass` + `WHERE id=? AND tenant_id=?` 明确锁定行，避免竞态
- 这不违反"状态机自洽"原则：状态机负责到期自动停服，外部支付事件触发显式恢复，二者职责不重叠

### 11.5 升级/降级/proration 未做

- v1 只支持对当前 plan 发起续期（延长 ExpiresAt）
- 不支持换 plan（更高 quota / 更多 members 的 plan 切换）
- 不支持按剩余天数折算差价
- v2 要做这些需要先补 `PlanTemplate` / SKU 模型和价格字段，见 §13

---

## 12. 安全与合规要点

1. **证书/密钥管理**：
   - 敏感字段 AES-256-GCM 加密存库
   - 私钥 PEM 在内存 Client 的生命周期尽量短（per-request 构建 vs 缓存 24h 间权衡）→ 本设计走缓存（per-tenant `core.Client` 常驻内存）
   - 租户删除 / `Enabled=false` 时 `clientCache.Invalidate()` 触发 GC
2. **回调防伪**：
   - 强制 HTTPS + 微信 RSA-SHA256 验签 + AES-GCM 解密
   - 订单号前缀二次校验（tenant_id 匹配）
3. **幂等保证**：
   - `out_trade_no` unique index
   - `ApplyPaymentSuccess` / `ApplyRefundSuccess` 读取当前状态，已完成直接返回
   - 回调和缺单补偿共用同一个 `ApplyPaymentSuccess`
4. **审计**：
   - 配置变更（update / test / delete）全进 `tenant_audit_logs`
   - 退款发起 / 完成进审计
   - 回调失败（签名不过 / tenant 不匹配）进审计
5. **平台兜底**：
   - PlatformLocked 优先级高于 Enabled
   - 平台 admin 可在任何时刻切断租户支付能力
6. **错误暴露**：
   - 用户前端错误只给类别（"下单失败，请稍后重试"）
   - 具体错误（签名错误、证书过期、商户号未绑定 appid）只在 `tenant_audit_logs` 和 server log 里

---

## 13. 测试策略

- **单元测试**：
  - crypto.go：HKDF 派生确定性 + EncryptAESGCM roundtrip + 错误密文解密失败
  - order.go：幂等 / 状态机转换
  - wechat/notify.go：mock 回调数据的验签（用 wechatpay-go 的 Verifier mock）
- **集成测试**：
  - 配置测试连接：mock `/v3/certificates` endpoint 验证通过 + 失败两种场景
  - 下单后查单：mock `/v3/pay/transactions/out-trade-no/` 返回 SUCCESS，触发 ApplyPaymentSuccess
- **手工验证**：
  - 真实商户号 0.01 元 Native 扫码全流程（S2 交付后必跑）
  - 退款全流程（S3 交付后必跑）

---

## 14. 不做项（Out of Scope）

### 业务 scope 外（明确不在 v1）
- **套餐升级 / 降级 / proration**（按剩余天数折算差价）— 需先补 `PlanTemplate` / SKU 模型与价格字段
- **退款自动回滚业务状态**（减 quota / 缩短 plan）— v1 退款只做财务退回 + 审计，业务差额 admin 人工处理
- **租户域 quota**（`user_tenant_quotas` 表）— 当前沿用项目既有的 `users.quota` 全局额度，见 §11.1

### 技术 scope 外
- 小程序 Pages / Components / 登录链路（LO 已有现成）
- 每日对账单自动下载（延后到 v2）
- 订阅消息模板推送（Phase 2）
- 支付宝 / PayPal 实现（架构预留，本次不落地）
- 代扣 / 微信支付分 / 小程序自动续费（资质门槛下不可行）
- 分账（服务商模式功能，未来如切换到 D 方案再做）

---

## 15. 关联文件参考

- 现有支付适配器：`controller/topup_stripe.go` / `controller/topup_creem.go` / `controller/topup_waffo.go`
- 订阅支付适配器：`controller/subscription_payment_stripe.go` / `controller/subscription_payment_creem.go`
- 设置文件：`setting/payment_stripe.go` / `setting/payment_creem.go` / `setting/payment_waffo.go`
- 加密基础：`common/crypto.go` / `common/init.go` / `common/constants.go`
- 租户体系：`model/tenant_plan.go` / `model/tenant_scope.go` / `service/tenant_alerts.go` / `service/tenant_audit.go`
- 完成状态：`docs/superpowers/plans/2026-04-16-completion-status.md`
