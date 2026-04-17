# WeChat Pay S2：下单 + 回调 + 业务联动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 端到端打通微信支付的 topup（充值）和 sub（续期）：用户/租户 admin 从 Web 或小程序下单 → 拉起微信支付 → 支付成功回调 → 幂等应用业务（加 `users.quota` / 延长 `TenantPlan.ExpiresAt` + 恢复 Status）。

**Architecture:** `payment_orders` 表承载订单生命周期；`service/payment/wechat/{native,h5,jsapi}.go` 三种下单形态；`notify.go` 集中处理回调验签；`service/payment/order.go` 的 `CreateOrder`/`ApplyPaymentSuccess` 是幂等的事务性业务入口，回调与查单（S3）共用它；前端 `/console/topup` 和 `/console/tenant-plan` 分别挂微信支付按钮，复用 `WechatPayModal` 组件（Native QR + 3s 轮询）。

**Tech Stack:** Go 1.25、GORM、gin、`github.com/wechatpay-apiv3/wechatpay-go v0.2.21`、React 18、Semi UI、`qrcode.react` (已在 package.json)。

**关联文档:**
- Spec: `docs/superpowers/specs/2026-04-17-wechat-pay-multi-tenant-design.md`
- S1 Plan（已完成）: `docs/superpowers/plans/2026-04-17-wechat-pay-s1-credentials-foundation.md`

**S1 已交付（S2 依赖）:**
- `common/crypto.go` HKDF + AES-GCM
- `tenant_payment_configs` 模型 + 加密 CRUD + guardrail
- `service/payment.Provider` 接口（只有 Name + TestCredentials，S2 会扩展）
- `service/payment/wechat/client.go` per-tenant `core.Client` 缓存
- `controller/tenant_payment.go` 配置 CRUD + test endpoint
- `/console/tenant-payment` 配置页 Tab 1

---

## 修订记录（2026-04-17，pre-execution review）

执行前的代码 review 抓出 5 个一致性/可用性问题。下文对应 Task 已就地修订；
该记录保留是为了让实施 subagent 在读到各 Task 的"新写法"时知道为什么要这么写，
以及哪些坑"看起来没必要的复杂性"其实是必要的。

1. **[HIGH] Task 3 + Task 5：不删本地 pending 订单。**
   支付网关不是事务资源，`provider.CreateOrder` HTTP 失败 ≠ 微信未落单。
   原计划的 `rollbackOrder` 硬删会让晚到的回调或 S3 `QueryOrder` 失去 anchor。
   改为 `PaymentOrder.LastError` 字段 + `markOrderCreationError` 更新（status 仍
   为 pending），由 `expires_at`（下单 + 2h）和 S3 reconcile 推进终态。

2. **[HIGH] Task 5 + Task 11：quota 加账必须在 tx 内。**
   `model.IncreaseUserQuota` 走全局 `DB` + `gopool.Go` 异步刷 cache，不接
   受外部 tx（`model/user.go:1068`）。原计划在 `applyTopupSuccess` tx 闭包
   里调它，`top_ups` 或审计失败时 quota 已经加了——账实分叉。改为
   `tx.Exec("UPDATE users SET quota = quota + ? ...")` 做 tx-local UPDATE
   + `RowsAffected == 1` 校验；cache 同步挪到 `postCommit` 钩子，只有 tx
   commit 后才执行。

3. **[HIGH] Task 12：续期并发丢单。**
   原计划 read-modify-write `ExpiresAt` 没有行锁，两笔续期并发回调会基
   于同一个 old value 各自计算 new value，后提交覆盖先提交——只延一次。
   改为 tx 内 `SELECT ... FOR UPDATE` + `UPDATE ... SET expires_at = CASE
   WHEN expires_at > now THEN expires_at + secs ELSE now + secs END`
   原子表达式。审计 diff 由事务内的 readback 提供。

4. **[MEDIUM] Task 5：`ApplyPaymentSuccess` tx 内 reload 无效。**
   `model.GetPaymentOrderByOutTradeNo` 用的是全局 DB，tx 未提交前拿不到
   `transaction_id` / `paid_at`。且后续 `CreateTime = order.PaidAt` 会
   落成 0。改为不 reload，直接把 `MarkOrderPaid` 写入的值回填到内存
   `order` 结构；`CreateTime` 用 `order.CreatedAt`，`CompleteTime` 用
   `order.PaidAt`。

5. **[MEDIUM] Task 13：回调 URL 用 `system_setting.ServerAddress`。**
   原计划从 `c.Request.Host` + `X-Forwarded-*` 拼接，在 dev proxy / K8s
   ingress / 反代头不全 / 伪造 XFF 场景都会给微信一个不可达或错误的 URL。
   本仓库 Stripe 等回跳 URL 已走 `system_setting.ServerAddress`
   (`controller/subscription_payment_stripe.go:121`)。`buildNotifyUrl`
   改用同一来源，且 `ServerAddress` 为空 / 是 localhost / 127.0.0.1 /
   缺 scheme 时直接拒绝下单——宁可显式失败也不要把死信 URL 交给微信。

### 第二轮 review（同日）

6. **[HIGH] Task 13：`resolveTopupPrice` 必须复用现有定价。**
   占位实现（1 quota = 1 cent）会直接收错钱。改为调用
   `controller/topup.go:128 getPayMoney` + `getMinTopup` +
   `common.QuotaPerUnit`，与 epay / stripe 充值路径共用同一套
   `QuotaDisplayType` / `Price` / group ratio / `AmountDiscount`
   计算。handler 先 `model.GetUserGroup` 拿 group，再进入该 helper。

7. **[HIGH] Task 11：topup 成功要补齐现有业务副作用。**
   epay 路径成功后除了加 quota + 写 top_ups，还会：
   - `model.RecordLogCtx` / `model.RecordTopUpLogWithTenant` 写充值日志
   - `model.ProcessTopUpRebate` 触发返利
   （见 `controller/topup.go:380-382`、`model/topup.go:130,133`）。
   微信作为新的充值渠道不能有不同的副作用集。两个 helper 都走全局 DB，
   放进 postCommit（tx 提交后再跑），与 epay 行为一致。

8. **[MEDIUM] Task 3 + Task 11/12：审计要用 tx 版本。**
   `model.CreateTenantAuditLog` 内部是 `DB.Create`
   （`model/tenant_audit_log.go:41`），tx 外写入。放进 tx 闭包时，
   如果后续业务步骤失败导致 tx 回滚，审计仍会落库——产生"业务其实
   没成功"的假成功记录。Task 3 新增 `CreateTenantAuditLogTx(tx, log)`，
   Task 11 / 12 的审计调用全部改走这个 tx 版本，与业务状态一同回滚。

### 第三轮 review（同日）

9. **[HIGH] Task 13 + Task 5 + Task 11：tokens 展示模式下会多发 QuotaPerUnit 倍的额度。**
   epay 流程在 `controller/topup.go:225-230` 把请求量归一化（tokens 模式
   下除以 `QuotaPerUnit`）再存 `top_ups.Amount`；回调在 line 371-373
   重新乘 `QuotaPerUnit` 推出应加的 quota。两种模式共用不变量：
   `quota = top_ups.Amount * QuotaPerUnit`。
   原计划 `resolveTopupPrice` 直接算 `quotaDelta = req.Amount *
   QuotaPerUnit` 跳过归一化，tokens 模式下会把 500k tokens 的请求
   发成 500k² tokens（多发两个数量级）。改为：
   - `resolveTopupPrice` 返回 `(amountCents, amountUnits)`，其中
     `amountUnits` 按 `QuotaDisplayType` 做同样的归一化；
   - metadata 存 `amount_units`（不再存 `quota_delta`）；
   - `applyTopupSuccess` 用 `amount_units * QuotaPerUnit` 计算 quota，
     `top_ups.Amount` 写回 `amount_units`，与 epay 语义严格一致。

---

## Task 1：TenantPlan 加续期定价字段

**Files:**
- Modify: `model/tenant_plan.go`

- [ ] **Step 1: 读现有 TenantPlan 结构**

```bash
cd D:/top/keyapi
grep -n "type TenantPlan" model/tenant_plan.go
```

- [ ] **Step 2: 在 `ExpiresAt`/`GracePeriodSeconds` 后面追加 3 个字段**

在 `type TenantPlan struct { ... }` 的 `GracePeriodSeconds` 和 `CreatedAt` 之间插入：

```go
	// Renewal pricing (S2). Platform admin configures via UpdateTenantPlanRequest.
	// - RenewPeriodDays: how many days each renewal order extends ExpiresAt.
	// - RenewPriceAmount: unit price in CNY cents. <=0 disables renewal ordering.
	// - RenewCurrency: v1 only "CNY".
	RenewPeriodDays  int    `json:"renew_period_days" gorm:"default:30"`
	RenewPriceAmount int64  `json:"renew_price_amount" gorm:"bigint;default:0"`
	RenewCurrency    string `json:"renew_currency" gorm:"type:varchar(8);default:'CNY'"`
```

- [ ] **Step 3: 编译**

```bash
go build ./...
```

Expected: 无错误（AutoMigrate 会在下次启动时补列）

- [ ] **Step 4: Commit**

```bash
git add model/tenant_plan.go
git commit -m "$(cat <<'EOF'
feat(model): add TenantPlan renewal pricing fields

- RenewPeriodDays (default 30): days to extend ExpiresAt per renewal order
- RenewPriceAmount (CNY cents, default 0 = renewal disabled)
- RenewCurrency (default 'CNY', v1 locks to CNY)

Consumed in S2 by service/payment/order.go when creating a sub order
and by controller.UpdateTenantPlanHandler for platform admin config.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2：UpdateTenantPlanRequest + handler + 审计

**Files:**
- Modify: `controller/tenant_plan.go`

- [ ] **Step 1: 读现有 `UpdateTenantPlanRequest`**

```bash
grep -n "UpdateTenantPlanRequest\|UpdateTenantPlanHandler" controller/tenant_plan.go
```

- [ ] **Step 2: 给 `UpdateTenantPlanRequest` 加 3 字段**

在现有 struct 的 `GracePeriodSeconds *int64 \`json:"grace_period_seconds"\`` 后追加：

```go
	RenewPeriodDays  *int    `json:"renew_period_days"`
	RenewPriceAmount *int64  `json:"renew_price_amount"`
	RenewCurrency    *string `json:"renew_currency"`
```

- [ ] **Step 3: 在 handler 里应用 3 字段**

在 `UpdateTenantPlanHandler` 函数内已有的 `if req.GracePeriodSeconds != nil { ... }` 之后追加：

```go
	if req.RenewPeriodDays != nil {
		if *req.RenewPeriodDays < 0 {
			common.ApiErrorMsg(c, "renew_period_days 必须 >= 0")
			return
		}
		plan.RenewPeriodDays = *req.RenewPeriodDays
	}
	if req.RenewPriceAmount != nil {
		if *req.RenewPriceAmount < 0 {
			common.ApiErrorMsg(c, "renew_price_amount 必须 >= 0（单位：分）")
			return
		}
		plan.RenewPriceAmount = *req.RenewPriceAmount
	}
	if req.RenewCurrency != nil {
		cur := strings.ToUpper(strings.TrimSpace(*req.RenewCurrency))
		if cur == "" {
			cur = "CNY"
		}
		// v1 仅支持 CNY
		if cur != "CNY" {
			common.ApiErrorMsg(c, "renew_currency 当前仅支持 CNY")
			return
		}
		plan.RenewCurrency = cur
	}
```

如果 `strings` 包没在 import，加上。

- [ ] **Step 4: 确保审计日志带新字段**

找到 `tenant_audit_logs` 相关的 `CreateTenantAuditLog` 调用，确认 Detail 里会 JSON marshal 整个 `plan`（它已经包含所有字段）。如果审计 Detail 只列少数字段，手动补 `renew_period_days / renew_price_amount / renew_currency` 的旧→新 diff：不需要额外改，后续由 Phase 7 的通用审计负责。

- [ ] **Step 5: 编译**

```bash
go build ./...
```

- [ ] **Step 6: Commit**

```bash
git add controller/tenant_plan.go
git commit -m "$(cat <<'EOF'
feat(controller): UpdateTenantPlanRequest supports renewal pricing

Platform admin can now set renew_period_days, renew_price_amount (分),
renew_currency via PUT /api/platform/tenants/:id/plan. v1 enforces
CNY only and non-negative amounts. Pointer fields mean unset keeps
existing value (consistent with sibling pointer fields).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3：PaymentOrder 模型 + CRUD + 订单号生成

**Files:**
- Create: `model/payment_order.go`
- Create: `model/payment_order_test.go`
- Modify: `model/main.go`（AutoMigrate 加 PaymentOrder）
- Modify: `model/tenant_scope.go`（注册 payment_orders）
- Modify: `model/tenant_audit_log.go`（加 `CreateTenantAuditLogTx`）

- [ ] **Step 1: 写失败的测试**

Create `model/payment_order_test.go`:

```go
package model

import (
	"strings"
	"testing"
)

func TestBuildOutTradeNo_PrefixAndLength(t *testing.T) {
	// tid=1, kind='T' (topup)
	no, err := BuildOutTradeNo(1, "topup")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(no, "wx_t1_T_") {
		t.Fatalf("bad prefix: %s", no)
	}
	if len(no) > 32 {
		t.Fatalf("out_trade_no too long (%d > 32): %s", len(no), no)
	}
}

func TestBuildOutTradeNo_SubKind(t *testing.T) {
	no, err := BuildOutTradeNo(42, "sub")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(no, "wx_t42_S_") {
		t.Fatalf("bad prefix: %s", no)
	}
}

func TestBuildOutTradeNo_InvalidType(t *testing.T) {
	if _, err := BuildOutTradeNo(1, "bogus"); err == nil {
		t.Fatal("expected error for unknown order type")
	}
}

func TestBuildOutTradeNo_InvalidTenant(t *testing.T) {
	if _, err := BuildOutTradeNo(0, "topup"); err == nil {
		t.Fatal("expected error for tenant_id <= 0")
	}
}

func TestBuildOutTradeNo_MaxTenantLen(t *testing.T) {
	// tid with 7 digits should still fit 32 chars
	no, err := BuildOutTradeNo(9999999, "sub")
	if err != nil {
		t.Fatal(err)
	}
	if len(no) > 32 {
		t.Fatalf("overflow at 7-digit tid: %d chars: %s", len(no), no)
	}
}

func TestValidateOutTradeNo_MatchesRoute(t *testing.T) {
	no, _ := BuildOutTradeNo(123, "topup")
	if err := ValidateOutTradeNoRoute(no, 123, "topup"); err != nil {
		t.Fatalf("expected match, got %v", err)
	}
	// wrong tenant
	if err := ValidateOutTradeNoRoute(no, 124, "topup"); err == nil {
		t.Fatal("wrong tenant should fail")
	}
	// wrong order type
	if err := ValidateOutTradeNoRoute(no, 123, "sub"); err == nil {
		t.Fatal("wrong order type should fail")
	}
	// malformed
	if err := ValidateOutTradeNoRoute("garbage", 123, "topup"); err == nil {
		t.Fatal("garbage should fail")
	}
}
```

- [ ] **Step 2: 验证失败**

```bash
go test ./model/ -run "TestBuildOutTradeNo|TestValidateOutTradeNo" -v
```

Expected: FAIL（未定义）

- [ ] **Step 3: 创建 `model/payment_order.go`**

```go
package model

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

// Order type constants ({topup | sub}) — used by both router paths and
// order_type column. BuildOutTradeNo maps them to a 1-char kind (T/S)
// packed into out_trade_no to stay within the 32-char WeChat limit.
const (
	PaymentOrderTypeTopup = "topup"
	PaymentOrderTypeSub   = "sub"
)

// Order status constants. See spec §4.2 state machine.
const (
	PaymentOrderStatusPending         = "pending"
	PaymentOrderStatusPaid            = "paid"
	PaymentOrderStatusPartialRefunded = "partial_refunded"
	PaymentOrderStatusFullyRefunded   = "fully_refunded"
	PaymentOrderStatusClosed          = "closed"
	PaymentOrderStatusExpired         = "expired"
)

// Product form constants. Picks which WeChat ordering API is used.
const (
	PaymentProductFormNative = "native"
	PaymentProductFormH5     = "h5"
	PaymentProductFormJsapi  = "jsapi"
)

// PaymentOrder models one external payment order across all providers.
// S1 invariant: registered tenant-scoped; all queries must use
// WithTenantBypass + explicit WHERE tenant_id=? OR request ctx with
// middleware.GetTenantId (spec §4).
type PaymentOrder struct {
	Id       int `json:"id" gorm:"primaryKey"`
	TenantId int `json:"tenant_id" gorm:"index;not null"` // 收款归属锚点，见 §11.1
	UserId   int `json:"user_id" gorm:"index"`            // topup=充值用户; sub=租户 admin

	Provider    string `json:"provider" gorm:"type:varchar(32);index"` // "wechat"
	OrderType   string `json:"order_type" gorm:"type:varchar(16);index"` // "topup" | "sub"
	ProductForm string `json:"product_form" gorm:"type:varchar(16)"`     // "native" | "h5" | "jsapi"

	OutTradeNo    string `json:"out_trade_no" gorm:"type:varchar(64);uniqueIndex"`
	TransactionId string `json:"transaction_id" gorm:"type:varchar(64);index"` // 微信返回

	Amount   int64  `json:"amount" gorm:"bigint;not null"`                    // 单位：分
	Currency string `json:"currency" gorm:"type:varchar(8);default:'CNY'"`

	// RefundedAmount: 累计已退款，S3 才会被写入。
	// Status 由 Amount/RefundedAmount 的关系 + 生命周期事件共同决定 — 见 §4.2。
	RefundedAmount int64  `json:"refunded_amount" gorm:"bigint;default:0"`
	Status         string `json:"status" gorm:"type:varchar(24);index"`

	Openid   string `json:"openid,omitempty" gorm:"type:varchar(128)"` // JSAPI 场景
	Metadata string `json:"metadata" gorm:"type:text"`                  // JSON
	// LastError: 最近一次下单失败 / 回调异常的原因。下单 RPC 失败时我们
	// **不删** 本地 pending 行（微信可能已经受理），而是留痕在这里，
	// 由 S3 reconcile 的 QueryOrder 推进终态，或 expires_at 到期后标 expired。
	LastError string `json:"last_error,omitempty" gorm:"type:varchar(512);default:''"`

	PaidAt    int64 `json:"paid_at"`
	ExpiresAt int64 `json:"expires_at"` // 下单 + 2h，超时标 expired
	CreatedAt int64 `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt int64 `json:"updated_at" gorm:"autoUpdateTime"`
}

// BuildOutTradeNo packs tenantId + kind(T/S) + unix_seconds + 6-char rand
// into a ≤31-char string (tenantId up to 7 digits).
//
// Format: wx_t{tid}_{K}_{unix_sec}_{rand6}
//   K = 'T' for topup, 'S' for sub
//
// The rand6 comes from crypto/rand hex (3 bytes → 6 hex chars).
func BuildOutTradeNo(tenantId int, orderType string) (string, error) {
	if tenantId <= 0 {
		return "", errors.New("tenantId must be > 0")
	}
	var kind string
	switch orderType {
	case PaymentOrderTypeTopup:
		kind = "T"
	case PaymentOrderTypeSub:
		kind = "S"
	default:
		return "", fmt.Errorf("unknown order type: %s", orderType)
	}
	b := make([]byte, 3)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := fmt.Sprintf("wx_t%d_%s_%d_%s", tenantId, kind, time.Now().Unix(), hex.EncodeToString(b))
	if len(out) > 32 {
		return "", fmt.Errorf("out_trade_no exceeds 32 chars: %d", len(out))
	}
	return out, nil
}

// ValidateOutTradeNoRoute checks the out_trade_no prefix matches the
// URL-derived tenantId and order_type. Used in the notify handler
// (spec §7.4) as a defense-in-depth check beyond the signature.
func ValidateOutTradeNoRoute(outTradeNo string, tenantId int, orderType string) error {
	var kind string
	switch orderType {
	case PaymentOrderTypeTopup:
		kind = "T"
	case PaymentOrderTypeSub:
		kind = "S"
	default:
		return fmt.Errorf("unknown order type: %s", orderType)
	}
	prefix := fmt.Sprintf("wx_t%d_%s_", tenantId, kind)
	if !strings.HasPrefix(outTradeNo, prefix) {
		return fmt.Errorf("out_trade_no %s does not match route tenant=%d type=%s",
			outTradeNo, tenantId, orderType)
	}
	return nil
}

// CreatePaymentOrder inserts a pending order. Uses WithTenantBypass since
// most call sites are non-request-ctx (reconcile, worker). Caller owns the
// struct — OutTradeNo must be set via BuildOutTradeNo first.
func CreatePaymentOrder(order *PaymentOrder) error {
	if order == nil || order.TenantId <= 0 || order.OutTradeNo == "" {
		return errors.New("invalid order")
	}
	if order.Provider == "" {
		order.Provider = "wechat"
	}
	if order.Currency == "" {
		order.Currency = "CNY"
	}
	if order.Status == "" {
		order.Status = PaymentOrderStatusPending
	}
	now := time.Now().Unix()
	if order.ExpiresAt == 0 {
		order.ExpiresAt = now + 2*3600 // 2h order TTL
	}
	return WithTenantBypass(DB).Create(order).Error
}

// GetPaymentOrderByOutTradeNo looks up an order by its unique out_trade_no.
// Used by callbacks, query API, reconcile loop, and UI detail.
// Callers MUST check order.TenantId matches whatever scope they are in.
func GetPaymentOrderByOutTradeNo(outTradeNo string) (*PaymentOrder, error) {
	if outTradeNo == "" {
		return nil, errors.New("empty out_trade_no")
	}
	var o PaymentOrder
	err := WithTenantBypass(DB).
		Where("out_trade_no = ?", outTradeNo).
		First(&o).Error
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// MarkOrderPaid transitions pending → paid atomically. Returns:
//   - (true, nil)  if this call flipped the status (i.e., business effects
//                  should run)
//   - (false, nil) if already in a post-pending state (idempotent no-op)
//   - (false, err) on db failure
//
// ApplyPaymentSuccess is the only caller; it runs this inside a tx.
func MarkOrderPaid(tx *gorm.DB, outTradeNo string, transactionId string, paidAt int64) (bool, error) {
	if tx == nil {
		tx = WithTenantBypass(DB)
	}
	res := tx.Model(&PaymentOrder{}).
		Where("out_trade_no = ? AND status = ?", outTradeNo, PaymentOrderStatusPending).
		Updates(map[string]interface{}{
			"status":         PaymentOrderStatusPaid,
			"transaction_id": transactionId,
			"paid_at":        paidAt,
			"updated_at":     time.Now().Unix(),
		})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected == 1, nil
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
go test ./model/ -run "TestBuildOutTradeNo|TestValidateOutTradeNo" -v
```

Expected: 全部 PASS

- [ ] **Step 5: AutoMigrate 注册**

Edit `model/main.go`: 找到 `migrateDBFast` 里添加 `TenantPaymentConfig` 的位置（S1 加的），紧跟其后添加：

```go
		{&PaymentOrder{}, "PaymentOrder"},
```

格式和邻居一致。

- [ ] **Step 6: tenant-scoped 注册**

Edit `model/tenant_scope.go`: 在 `RegisterTenantScopedTable("tenant_payment_configs")` 下面添加：

```go
	RegisterTenantScopedTable("payment_orders")
```

- [ ] **Step 6.5: 给审计加 tx-aware 变体（`model/tenant_audit_log.go`）**

现有 `CreateTenantAuditLog` 用全局 `DB.Create`（`model/tenant_audit_log.go:41`）。
支付成功走的是事务（`ApplyPaymentSuccess`），如果在 tx 闭包内调它，tx 回滚时
审计仍会落库 → 留下"业务其实没成功"的假记录。加 tx 版本：

```go
// CreateTenantAuditLogTx writes an audit record on the caller-supplied
// transaction. Required for any audit write that must be atomic with a
// business state change — e.g. payment success in
// service/payment/order.go. Plain CreateTenantAuditLog uses the global
// DB and would persist even if the outer tx rolls back.
func CreateTenantAuditLogTx(tx *gorm.DB, log *TenantAuditLog) error {
	if log == nil {
		return errors.New("nil audit log")
	}
	if log.TenantId <= 0 {
		return errors.New("invalid tenantId")
	}
	if log.Action == "" {
		return errors.New("action required")
	}
	if tx == nil {
		return errors.New("nil tx; use CreateTenantAuditLog for non-tx writes")
	}
	return tx.Create(log).Error
}
```

- [ ] **Step 7: 全局编译 + 测试**

```bash
go build ./... && go test ./model/ -v
```

- [ ] **Step 8: Commit**

```bash
git add model/payment_order.go model/payment_order_test.go model/main.go model/tenant_scope.go model/tenant_audit_log.go
git commit -m "$(cat <<'EOF'
feat(model): add PaymentOrder with out_trade_no builder/validator

- PaymentOrder struct: status machine pending/paid/partial_refunded/
  fully_refunded/closed/expired; Amount + RefundedAmount in CNY cents;
  Metadata TEXT for per-type JSON payload; LastError VARCHAR(512) for
  create-order/reconcile failure notes (keep pending, never delete —
  payment gateway is not a transactional resource).
- BuildOutTradeNo packs tid + kind (T/S) + unix_sec + rand6 into ≤31
  chars, within WeChat's 32-char limit even for 7-digit tenant_ids.
- ValidateOutTradeNoRoute used by notify handler as defense-in-depth
  check that URL :tenant_id and :order_type match the order number
  prefix (spec §7.4).
- CreatePaymentOrder / GetPaymentOrderByOutTradeNo / MarkOrderPaid are
  the CRUD primitives; MarkOrderPaid returns whether this call was the
  one to flip pending→paid (enables idempotent callback handling).
- CreateTenantAuditLogTx: tx-aware variant of CreateTenantAuditLog.
  Required for audit writes that must be atomic with the business
  state change (payment success); otherwise the global-DB audit would
  persist even when the outer tx rolls back.
- Registered tenant-scoped in tenant_scope.go; migrate in main.go.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4：扩展 Provider 接口 — CreateOrder / VerifyAndParseNotify / QueryOrder

**Files:**
- Modify: `service/payment/provider.go`

- [ ] **Step 1: 追加接口方法 + 相关 request/response 类型**

Edit `service/payment/provider.go`. 完整替换文件内容为（保留原 Name/TestCredentials，加 3 个新方法）：

```go
package payment

import (
	"context"

	"github.com/QuantumNous/new-api/model"
)

// CreateOrderRequest is the input to Provider.CreateOrder.
// Amount is in CNY cents. Description is the "商品描述" (appears on user's
// WeChat payment sheet). NotifyUrl is the tenant-scoped callback URL.
type CreateOrderRequest struct {
	Order       *model.PaymentOrder // carries TenantId/UserId/OutTradeNo/Amount/ProductForm/OrderType
	Description string              // shown on payer's WeChat UI
	NotifyUrl   string              // /api/payment/wechat/notify/:tid/:order_type
	Openid      string              // required when ProductForm = "jsapi"
	ClientIp    string              // required for h5; use c.ClientIP() upstream
}

// CreateOrderResponse wraps the provider-specific "how to launch payment"
// parameters. Only one of CodeUrl / H5Url / PrepayId will be non-empty.
type CreateOrderResponse struct {
	// Native: code_url to render as QR code
	CodeUrl string `json:"code_url,omitempty"`
	// H5: redirect URL to open on mobile browser
	H5Url string `json:"h5_url,omitempty"`
	// JSAPI: prepay_id that the mini-program wraps into wx.requestPayment
	// params. Signature params are returned separately for small-program
	// convenience.
	PrepayId     string `json:"prepay_id,omitempty"`
	JsapiPackage string `json:"package,omitempty"`    // "prepay_id=..."
	NonceStr     string `json:"nonce_str,omitempty"`
	Timestamp    string `json:"timestamp,omitempty"`
	SignType     string `json:"sign_type,omitempty"`  // "RSA"
	PaySign      string `json:"pay_sign,omitempty"`
}

// NotifyResult is what a provider reports after verifying and decrypting a
// callback. The generic fields are what downstream state transitions need;
// provider-specific fields stay inside the provider layer.
type NotifyResult struct {
	OutTradeNo    string
	TransactionId string
	PaidAt        int64 // unix seconds
	Success       bool  // true if TradeState indicates success
	RawState      string
}

// QueryOrderResult is what a provider reports when asked to refresh an
// order's state (S3 reconcile path). S2 defines the shape so S3 can drop
// in directly without churning the interface.
type QueryOrderResult struct {
	TradeState    string // wechat: SUCCESS/NOTPAY/CLOSED/USERPAYING/...
	TransactionId string
	PaidAt        int64
}

// Provider abstracts a payment gateway adapter (wechat, alipay, etc).
//
// S1 only required Name + TestCredentials. S2 adds CreateOrder /
// VerifyAndParseNotify / QueryOrder. S3 will add Refund.
type Provider interface {
	Name() string
	TestCredentials(ctx context.Context, cfg *model.TenantPaymentConfig) error

	// CreateOrder calls the provider's place-order endpoint. Implementation
	// is responsible for choosing the right API per req.Order.ProductForm.
	CreateOrder(ctx context.Context, req CreateOrderRequest) (*CreateOrderResponse, error)

	// VerifyAndParseNotify verifies the callback signature using the tenant's
	// platform cert (managed by wechatpay-go's downloader), decrypts the
	// encrypted resource body, and returns the generic notify result.
	// Caller (controller/payment_notify.go) is responsible for routing by
	// tenantId, enforcing ValidateOutTradeNoRoute, and running business
	// effects via service/payment.ApplyPaymentSuccess.
	VerifyAndParseNotify(ctx context.Context, tenantId int, body []byte, headers map[string]string) (*NotifyResult, error)

	// QueryOrder refreshes an order's state from the provider (for reconcile).
	// S2 defines the method so S3's reconcile loop can use it without a
	// breaking interface change.
	QueryOrder(ctx context.Context, tenantId int, outTradeNo string) (*QueryOrderResult, error)
}

// --- Registry (unchanged from S1) ---

var registry = map[string]Provider{}

// Register installs a provider. Must only be called from package-level
// init() functions so that all registrations complete before any handler
// runs. The registry map is not concurrency-safe for runtime writes.
//
// Panics on a nil provider — this is an init-time programming error.
func Register(p Provider) {
	if p == nil {
		panic("payment.Register called with nil provider")
	}
	registry[p.Name()] = p
}

// Get looks up a provider by name.
func Get(name string) (Provider, bool) {
	p, ok := registry[name]
	return p, ok
}
```

- [ ] **Step 2: 编译会临时失败**

```bash
go build ./...
```

Expected: FAIL — `service/payment/wechat/provider.go` 的 `providerImpl` 未实现新方法。接下来 Task 5-10 补上。

暂不修。先 commit 接口变更本身作为 Task 4 独立 commit：

- [ ] **Step 3: 先提交接口变更，允许后续 task 逐个补实现**

但如果直接 commit 会 `go build` 失败，不行。两个选择：
- A. 在 providerImpl 临时加 stub 实现（`return nil, errors.New("not implemented yet")`），Task 10 再补真实现
- B. 把 Task 4-10 合成一个大 commit

选 A（保持每 task 独立可 commit）：

Edit `service/payment/wechat/provider.go`：在 `TestCredentials` 之后追加三个临时 stub：

```go
import (
	// ... existing imports
	"errors"
	"github.com/QuantumNous/new-api/service/payment"
)

// --- stubs for S2 Tasks 5-10; real implementations land progressively ---

func (providerImpl) CreateOrder(ctx context.Context, req payment.CreateOrderRequest) (*payment.CreateOrderResponse, error) {
	return nil, errors.New("wechat CreateOrder: not implemented yet")
}

func (providerImpl) VerifyAndParseNotify(ctx context.Context, tenantId int, body []byte, headers map[string]string) (*payment.NotifyResult, error) {
	return nil, errors.New("wechat VerifyAndParseNotify: not implemented yet")
}

func (providerImpl) QueryOrder(ctx context.Context, tenantId int, outTradeNo string) (*payment.QueryOrderResult, error) {
	return nil, errors.New("wechat QueryOrder: not implemented yet")
}
```

- [ ] **Step 4: 编译确认**

```bash
go build ./...
```

Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add service/payment/provider.go service/payment/wechat/provider.go
git commit -m "$(cat <<'EOF'
feat(payment): extend Provider interface with CreateOrder/Notify/QueryOrder

S2 adds the three methods needed for ordering + callback + reconcile.
Types defined alongside:
- CreateOrderRequest / CreateOrderResponse for the three product forms
  (native/h5/jsapi); only one of code_url/h5_url/prepay_id is populated.
- NotifyResult is the generic shape ApplyPaymentSuccess needs.
- QueryOrderResult shape defined now so S3 reconcile uses a stable API.

wechat.providerImpl carries temporary stubs for the three new methods;
Tasks 6-10 fill them in progressively.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5：service/payment/order.go — CreateOrder + ApplyPaymentSuccess 骨架

**Files:**
- Create: `service/payment/order.go`

- [ ] **Step 1: 创建文件**

```go
package payment

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// CreateTopupOrderInput is what the topup controller hands in.
// AmountUnits is the "display units" value that would be stored in
// top_ups.Amount under the epay/stripe flow — i.e. already normalized
// for tokens mode (req.Amount / QuotaPerUnit). The success handler
// reconstructs internal quota via AmountUnits * QuotaPerUnit, so both
// display modes round-trip the user's original request exactly. Do NOT
// pass raw req.Amount here without normalizing — in tokens mode that
// would over-issue quota by a factor of QuotaPerUnit (e.g. 500k tokens
// requested → 250 billion tokens credited).
type CreateTopupOrderInput struct {
	TenantId    int   // order.TenantId = session tenant (收款归属)
	UserId      int   // order.UserId = payer
	AmountCents int64 // CNY cents (what WeChat charges)
	AmountUnits int64 // top_ups.Amount value; see doc above
	ProductForm string
	Openid      string // jsapi only
	ClientIp    string // h5 only
	Description string // shown on WeChat UI
	NotifyUrl   string // absolute URL the provider calls on callback
}

// CreateSubOrderInput is what the renewal controller hands in.
// AmountCents and RenewPeriodDays are both server-authoritative (read from
// TenantPlan by the caller), never from client.
type CreateSubOrderInput struct {
	TenantId        int
	UserId          int // tenant admin who initiated
	AmountCents     int64
	RenewPeriodDays int
	ProductForm     string
	Openid          string
	ClientIp        string
	Description     string
	NotifyUrl       string
}

// CreateTopupOrder inserts a pending order, calls the provider's CreateOrder,
// and returns the provider response for front-end consumption.
//
// On provider failure the pending row is KEPT (not deleted) and
// markOrderCreationError stamps LastError. Rationale: the payment
// gateway is not a transactional resource, so an HTTP-level failure
// here does not prove the remote side refused the order. A late
// callback or S3 QueryOrder must still be able to find the anchor row.
// S3 reconcile / expires_at (2h) cleans up genuinely stale pendings.
func CreateTopupOrder(ctx context.Context, in CreateTopupOrderInput) (*CreateOrderResponse, *model.PaymentOrder, error) {
	if in.TenantId <= 0 || in.UserId <= 0 || in.AmountCents <= 0 || in.AmountUnits <= 0 {
		return nil, nil, errors.New("invalid topup input")
	}
	// Metadata key name matches the applyTopupSuccess reader exactly.
	meta, _ := json.Marshal(map[string]any{"amount_units": in.AmountUnits})
	return createOrder(ctx, createOrderArgs{
		TenantId:    in.TenantId,
		UserId:      in.UserId,
		AmountCents: in.AmountCents,
		OrderType:   model.PaymentOrderTypeTopup,
		ProductForm: in.ProductForm,
		Openid:      in.Openid,
		ClientIp:    in.ClientIp,
		Description: in.Description,
		NotifyUrl:   in.NotifyUrl,
		Metadata:    string(meta),
	})
}

// CreateSubOrder inserts a pending renewal order; metadata carries the
// server-chosen renew_period_days that the callback will apply.
func CreateSubOrder(ctx context.Context, in CreateSubOrderInput) (*CreateOrderResponse, *model.PaymentOrder, error) {
	if in.TenantId <= 0 || in.UserId <= 0 || in.AmountCents <= 0 || in.RenewPeriodDays <= 0 {
		return nil, nil, errors.New("invalid sub input")
	}
	meta, _ := json.Marshal(map[string]any{"renew_period_days": in.RenewPeriodDays})
	return createOrder(ctx, createOrderArgs{
		TenantId:    in.TenantId,
		UserId:      in.UserId,
		AmountCents: in.AmountCents,
		OrderType:   model.PaymentOrderTypeSub,
		ProductForm: in.ProductForm,
		Openid:      in.Openid,
		ClientIp:    in.ClientIp,
		Description: in.Description,
		NotifyUrl:   in.NotifyUrl,
		Metadata:    string(meta),
	})
}

type createOrderArgs struct {
	TenantId    int
	UserId      int
	AmountCents int64
	OrderType   string
	ProductForm string
	Openid      string
	ClientIp    string
	Description string
	NotifyUrl   string
	Metadata    string
}

func createOrder(ctx context.Context, a createOrderArgs) (*CreateOrderResponse, *model.PaymentOrder, error) {
	switch a.ProductForm {
	case model.PaymentProductFormNative,
		model.PaymentProductFormH5,
		model.PaymentProductFormJsapi:
	default:
		return nil, nil, fmt.Errorf("unknown product form: %s", a.ProductForm)
	}
	if a.ProductForm == model.PaymentProductFormJsapi && a.Openid == "" {
		return nil, nil, errors.New("jsapi order requires openid")
	}
	if a.ProductForm == model.PaymentProductFormH5 && a.ClientIp == "" {
		return nil, nil, errors.New("h5 order requires client ip")
	}

	outTradeNo, err := model.BuildOutTradeNo(a.TenantId, a.OrderType)
	if err != nil {
		return nil, nil, err
	}

	order := &model.PaymentOrder{
		TenantId:    a.TenantId,
		UserId:      a.UserId,
		Provider:    "wechat",
		OrderType:   a.OrderType,
		ProductForm: a.ProductForm,
		OutTradeNo:  outTradeNo,
		Amount:      a.AmountCents,
		Currency:    "CNY",
		Openid:      a.Openid,
		Metadata:    a.Metadata,
	}
	if err := model.CreatePaymentOrder(order); err != nil {
		return nil, nil, fmt.Errorf("persist order: %w", err)
	}

	provider, ok := Get("wechat")
	if !ok {
		markOrderCreationError(order.OutTradeNo, "wechat provider not registered")
		return nil, nil, errors.New("wechat provider not registered")
	}
	resp, err := provider.CreateOrder(ctx, CreateOrderRequest{
		Order:       order,
		Description: a.Description,
		NotifyUrl:   a.NotifyUrl,
		Openid:      a.Openid,
		ClientIp:    a.ClientIp,
	})
	if err != nil {
		// 关键：不删本地 pending 行。HTTP timeout / 读响应失败 / TLS reset
		// 都可能是"微信已受理但本端没拿到响应"的场景；删除订单会让后续
		// 回调或 S3 QueryOrder 失去 anchor，账就对不上了。留 pending +
		// 错误留痕，由 S3 reconcile 或 expires_at(2h) 推进终态。
		markOrderCreationError(order.OutTradeNo, err.Error())
		return nil, nil, err
	}
	return resp, order, nil
}

// markOrderCreationError stamps the most recent provider-call error into
// the pending order row without deleting it. The payment gateway is NOT
// a transactional resource — an HTTP error here does not imply the
// provider failed to create the order on their side. A late callback or
// S3 QueryOrder will find this row and complete it. S3 closes genuinely
// stale rows by expires_at.
func markOrderCreationError(outTradeNo string, cause string) {
	if len(cause) > 512 {
		cause = cause[:512]
	}
	if err := model.WithTenantBypass(model.DB).
		Model(&model.PaymentOrder{}).
		Where("out_trade_no = ? AND status = ?", outTradeNo, model.PaymentOrderStatusPending).
		Updates(map[string]interface{}{
			"last_error": cause,
			"updated_at": time.Now().Unix(),
		}).Error; err != nil {
		common.SysError(fmt.Sprintf("failed to record creation error for %s: %v", outTradeNo, err))
	}
}

// ApplyPaymentSuccess is the single entry-point both the callback handler
// (controller/payment_notify.go) and the S3 reconcile loop call when an
// order transitions to paid. Idempotent: calling twice for the same
// out_trade_no is a no-op on the second call.
//
// Runs inside a DB transaction:
//   1. MarkOrderPaid pending→paid (idempotent: returns false if not flipped)
//   2. If flipped, dispatch business effect by order.OrderType:
//      - topup: Task 11
//      - sub:   Task 12
//   3. Audit log.
//
// S2 Task 5 provides the skeleton; Tasks 11-12 fill in the branches.
func ApplyPaymentSuccess(ctx context.Context, outTradeNo string, transactionId string, paidAt int64) error {
	if outTradeNo == "" {
		return errors.New("empty out_trade_no")
	}
	order, err := model.GetPaymentOrderByOutTradeNo(outTradeNo)
	if err != nil {
		return fmt.Errorf("load order: %w", err)
	}

	// postCommit collects side-effects that MUST run only after the tx
	// commits — cache / redis sync, async notifications, etc. Keeping
	// them out of the tx closure avoids the classic "DB rolled back but
	// cache/quota already moved" inconsistency (see review point 2).
	var postCommit []func()

	txErr := model.WithTenantBypass(model.DB).Transaction(func(tx *gorm.DB) error {
		flipped, err := model.MarkOrderPaid(tx, outTradeNo, transactionId, paidAt)
		if err != nil {
			return err
		}
		if !flipped {
			// Already processed — nothing to do.
			return nil
		}
		// NOTE: do NOT reload via GetPaymentOrderByOutTradeNo here — that
		// helper uses the global DB, not our tx, so under RC/RR isolation
		// it would return the pre-update row (no transaction_id/paid_at).
		// Patch the in-memory struct to the exact values MarkOrderPaid
		// just wrote, so applyTopupSuccess / applySubSuccess see them.
		order.TransactionId = transactionId
		order.PaidAt = paidAt
		order.Status = model.PaymentOrderStatusPaid

		switch order.OrderType {
		case model.PaymentOrderTypeTopup:
			return applyTopupSuccess(tx, order, &postCommit)
		case model.PaymentOrderTypeSub:
			return applySubSuccess(tx, order, &postCommit)
		default:
			return fmt.Errorf("unknown order type: %s", order.OrderType)
		}
	})
	if txErr != nil {
		return txErr
	}
	for _, f := range postCommit {
		f()
	}
	return nil
}

// applyTopupSuccess and applySubSuccess are filled in by Tasks 11 and 12.
// Declared here so the transaction skeleton compiles.
// The postCommit slice lets the handler schedule cache / redis writes
// that must run *after* the tx commits (see ApplyPaymentSuccess doc).
func applyTopupSuccess(tx *gorm.DB, order *model.PaymentOrder, postCommit *[]func()) error {
	return errors.New("applyTopupSuccess: not implemented (Task 11)")
}
func applySubSuccess(tx *gorm.DB, order *model.PaymentOrder, postCommit *[]func()) error {
	return errors.New("applySubSuccess: not implemented (Task 12)")
}
```

- [ ] **Step 2: 编译**

```bash
go build ./...
```

Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add service/payment/order.go
git commit -m "$(cat <<'EOF'
feat(payment): add CreateOrder/ApplyPaymentSuccess skeleton

service/payment/order.go hosts the two transactional primitives that
topup, sub, callback, and (S3) reconcile all funnel through:

- CreateTopupOrder / CreateSubOrder: public inputs; internal
  createOrder builds out_trade_no, persists pending row, calls
  provider.CreateOrder. On provider failure it stamps LastError on
  the pending row (markOrderCreationError) — NOT a delete — because
  an HTTP error does not prove the remote gateway didn't accept the
  order. S3 reconcile (QueryOrder) or expires_at closes truly stale
  rows.
- ApplyPaymentSuccess: tx-wrapped, idempotent via MarkOrderPaid's
  UPDATE...WHERE status='pending'; dispatches to applyTopupSuccess /
  applySubSuccess by order_type. Cache/side-effect writes collected
  in a postCommit []func() slice and fired only after the tx commits,
  so a rolled-back tx can never leave the cache ahead of the DB.
  Stubs for the two dispatch branches (Tasks 11-12 fill them in).

Providers return CreateOrderResponse with exactly one of
code_url/h5_url/prepay_id set; jsapi variant also carries the
wx.requestPayment signature fields.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6：wechat/native.go — Native 下单

**Files:**
- Create: `service/payment/wechat/native.go`

- [ ] **Step 1: 创建文件**

```go
package wechat

import (
	"context"
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/service/payment"
	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments/native"
)

// createNativeOrder calls /v3/pay/transactions/native. Returns code_url to
// be rendered as a QR code by the desktop frontend.
func createNativeOrder(ctx context.Context, cli *core.Client, cc *cachedClient, req payment.CreateOrderRequest) (*payment.CreateOrderResponse, error) {
	svc := native.NativeApiService{Client: cli}
	callCtx, cancel := callWithTimeout(ctx)
	defer cancel()

	resp, _, err := svc.Prepay(callCtx, native.PrepayRequest{
		Appid:       stringPtr(cc.appid),
		Mchid:       stringPtr(cc.mchid),
		Description: stringPtr(req.Description),
		OutTradeNo:  stringPtr(req.Order.OutTradeNo),
		NotifyUrl:   stringPtr(req.NotifyUrl),
		Amount: &native.Amount{
			Total:    int64Ptr(req.Order.Amount),
			Currency: stringPtr("CNY"),
		},
	})
	if err != nil {
		return nil, fmt.Errorf("wechat native prepay: %w", err)
	}
	if resp == nil || resp.CodeUrl == nil || *resp.CodeUrl == "" {
		return nil, errors.New("wechat native prepay returned empty code_url")
	}
	return &payment.CreateOrderResponse{CodeUrl: *resp.CodeUrl}, nil
}

func stringPtr(s string) *string { return &s }
func int64Ptr(i int64) *int64     { return &i }
```

- [ ] **Step 2: 编译**

```bash
go build ./...
```

注意：如果 wechatpay-go 的 native API 字段名或类型不同（例如 `Prepay` vs `PrepayOrder`），修正后再 commit。常用命令：

```bash
go doc github.com/wechatpay-apiv3/wechatpay-go/services/payments/native
```

- [ ] **Step 3: Commit**

```bash
git add service/payment/wechat/native.go
git commit -m "feat(payment/wechat): implement Native (desktop QR) ordering"
```

---

## Task 7：wechat/h5.go — H5 下单

**Files:**
- Create: `service/payment/wechat/h5.go`

- [ ] **Step 1: 创建文件**

```go
package wechat

import (
	"context"
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/service/payment"
	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments/h5"
)

// createH5Order calls /v3/pay/transactions/h5. Returns h5_url for the
// mobile browser to redirect to.
//
// Requires the caller's real client IP (req.ClientIp) — WeChat uses it to
// prevent cross-IP brush orders.
func createH5Order(ctx context.Context, cli *core.Client, cc *cachedClient, req payment.CreateOrderRequest) (*payment.CreateOrderResponse, error) {
	if req.ClientIp == "" {
		return nil, errors.New("h5 order requires client ip")
	}
	svc := h5.H5ApiService{Client: cli}
	callCtx, cancel := callWithTimeout(ctx)
	defer cancel()

	resp, _, err := svc.Prepay(callCtx, h5.PrepayRequest{
		Appid:       stringPtr(cc.appid),
		Mchid:       stringPtr(cc.mchid),
		Description: stringPtr(req.Description),
		OutTradeNo:  stringPtr(req.Order.OutTradeNo),
		NotifyUrl:   stringPtr(req.NotifyUrl),
		Amount: &h5.Amount{
			Total:    int64Ptr(req.Order.Amount),
			Currency: stringPtr("CNY"),
		},
		SceneInfo: &h5.SceneInfo{
			PayerClientIp: stringPtr(req.ClientIp),
			H5Info: &h5.H5Info{
				Type: stringPtr("Wap"),
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("wechat h5 prepay: %w", err)
	}
	if resp == nil || resp.H5Url == nil || *resp.H5Url == "" {
		return nil, errors.New("wechat h5 prepay returned empty h5_url")
	}
	return &payment.CreateOrderResponse{H5Url: *resp.H5Url}, nil
}
```

- [ ] **Step 2: 编译**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add service/payment/wechat/h5.go
git commit -m "feat(payment/wechat): implement H5 (mobile browser) ordering"
```

---

## Task 8：wechat/jsapi.go — JSAPI (小程序) 下单

**Files:**
- Create: `service/payment/wechat/jsapi.go`

- [ ] **Step 1: 创建文件**

```go
package wechat

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/payment"
	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments/jsapi"
	"github.com/wechatpay-apiv3/wechatpay-go/utils"
)

// createJsapiOrder calls /v3/pay/transactions/jsapi and builds the
// wx.requestPayment signature object the mini-program needs.
//
// Requires req.Openid (obtained client-side via wx.login → server-side
// code2session). The signature is computed against prepay_id using the
// tenant's merchant API private key.
func createJsapiOrder(ctx context.Context, cli *core.Client, cc *cachedClient, cfg *model.TenantPaymentConfig, req payment.CreateOrderRequest) (*payment.CreateOrderResponse, error) {
	if req.Openid == "" {
		return nil, errors.New("jsapi order requires openid")
	}
	svc := jsapi.JsapiApiService{Client: cli}
	callCtx, cancel := callWithTimeout(ctx)
	defer cancel()

	resp, _, err := svc.Prepay(callCtx, jsapi.PrepayRequest{
		Appid:       stringPtr(cc.appid),
		Mchid:       stringPtr(cc.mchid),
		Description: stringPtr(req.Description),
		OutTradeNo:  stringPtr(req.Order.OutTradeNo),
		NotifyUrl:   stringPtr(req.NotifyUrl),
		Amount: &jsapi.Amount{
			Total:    int64Ptr(req.Order.Amount),
			Currency: stringPtr("CNY"),
		},
		Payer: &jsapi.Payer{
			Openid: stringPtr(req.Openid),
		},
	})
	if err != nil {
		return nil, fmt.Errorf("wechat jsapi prepay: %w", err)
	}
	if resp == nil || resp.PrepayId == nil || *resp.PrepayId == "" {
		return nil, errors.New("wechat jsapi prepay returned empty prepay_id")
	}

	// Build the wx.requestPayment signature payload.
	prepayId := *resp.PrepayId
	pkg := "prepay_id=" + prepayId
	nonceBytes := make([]byte, 8)
	if _, err := rand.Read(nonceBytes); err != nil {
		return nil, err
	}
	nonceStr := hex.EncodeToString(nonceBytes)
	ts := strconv.FormatInt(time.Now().Unix(), 10)

	// signMessage format per WeChat docs: appId\ntimeStamp\nnonceStr\npackage\n
	signMessage := fmt.Sprintf("%s\n%s\n%s\n%s\n", cc.appid, ts, nonceStr, pkg)

	// Need the raw private key to build the signature. DecryptSensitive to
	// avoid holding plaintext longer than necessary.
	plain, err := cfg.DecryptSensitive()
	if err != nil {
		return nil, fmt.Errorf("decrypt private key for jsapi sign: %w", err)
	}
	privKey, err := utils.LoadPrivateKey(plain.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("parse private key: %w", err)
	}
	paySign, err := utils.SignSHA256WithRSA(signMessage, privKey)
	if err != nil {
		return nil, fmt.Errorf("sign jsapi payload: %w", err)
	}

	return &payment.CreateOrderResponse{
		PrepayId:     prepayId,
		JsapiPackage: pkg,
		NonceStr:     nonceStr,
		Timestamp:    ts,
		SignType:     "RSA",
		PaySign:      paySign,
	}, nil
}
```

- [ ] **Step 2: 编译**

```bash
go build ./...
```

如果 `utils.SignSHA256WithRSA` 在 v0.2.21 API 名字不同，调整（可能是 `utils.SignSHA256WithRSA(msg string, privKey *rsa.PrivateKey) (string, error)` — 用 `go doc`确认）。

- [ ] **Step 3: Commit**

```bash
git add service/payment/wechat/jsapi.go
git commit -m "feat(payment/wechat): implement JSAPI (mini-program) ordering"
```

---

## Task 9：wechat/notify.go — 回调验签 + 解密

**Files:**
- Create: `service/payment/wechat/notify.go`

- [ ] **Step 1: 创建文件**

```go
package wechat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/service/payment"
	"github.com/wechatpay-apiv3/wechatpay-go/core/notify"
	"github.com/wechatpay-apiv3/wechatpay-go/core/auth/verifiers"
	"github.com/wechatpay-apiv3/wechatpay-go/core/downloader"
)

// verifyAndParseNotify runs wechatpay-go's Notify handler which:
//   1. Verifies the SHA256-with-RSA signature using the platform cert
//      (downloaded and cached by the tenant's core.Client Downloader).
//   2. AES-256-GCM decrypts the encrypted resource body using apiv3_key.
//   3. Unmarshals the plaintext into transaction info.
//
// The input `headers` must be the raw HTTP headers from the Gin request
// (pass c.Request.Header). The `body` must be the raw request body bytes
// (controller layer should read it with io.ReadAll).
func verifyAndParseNotify(ctx context.Context, tenantId int, body []byte, headers map[string]string) (*payment.NotifyResult, error) {
	// Load cached client (which already contains the Downloader).
	cc, err := getClient(ctx, tenantId)
	if err != nil {
		return nil, fmt.Errorf("load client for notify: %w", err)
	}

	// wechatpay-go's Handler uses the downloader for platform certs and the
	// apiv3_key for decryption. Both come from cc.client's configuration
	// (installed in buildClient via WithWechatPayAutoAuthCipher).
	certVisitor := downloader.MgrInstance().GetCertificateVisitor(cc.mchid)
	if certVisitor == nil {
		return nil, errors.New("platform cert visitor missing for tenant")
	}
	apiv3Key, err := getApiv3Key(tenantId)
	if err != nil {
		return nil, err
	}
	h := notify.NewNotifyHandler(apiv3Key, verifiers.NewSHA256WithRSAVerifier(certVisitor))

	var txn transactionPayload
	// Wrap headers/body in the shape wechatpay-go's handler expects.
	// The public ParseNotifyRequest takes an *http.Request so we rebuild a
	// minimal one locally.
	req := buildHttpRequest(headers, body)
	_, err = h.ParseNotifyRequest(ctx, req, &txn)
	if err != nil {
		return nil, fmt.Errorf("parse notify: %w", err)
	}
	paidUnix := int64(0)
	if txn.SuccessTime != "" {
		paidUnix = parseRFC3339Unix(txn.SuccessTime)
	}
	return &payment.NotifyResult{
		OutTradeNo:    txn.OutTradeNo,
		TransactionId: txn.TransactionId,
		PaidAt:        paidUnix,
		Success:       txn.TradeState == "SUCCESS",
		RawState:      txn.TradeState,
	}, nil
}

// transactionPayload mirrors the fields we actually need from the notify
// resource body (subset of WeChat's Transaction struct).
type transactionPayload struct {
	OutTradeNo    string `json:"out_trade_no"`
	TransactionId string `json:"transaction_id"`
	TradeState    string `json:"trade_state"`
	SuccessTime   string `json:"success_time"` // RFC3339
}

// getApiv3Key reads the tenant config (bypass) and decrypts the apiv3_key.
// Isolated so the notify path can run without re-decrypting the full
// sensitive bundle.
func getApiv3Key(tenantId int) (string, error) {
	// Lightweight read to avoid pulling the cached client's secrets path.
	// The cached client's apiv3_key is the same; we re-read here to keep
	// this function independent of cache state (notify should always work
	// even if the cache was just invalidated).
	cfg, err := loadConfigForNotify(tenantId)
	if err != nil {
		return "", err
	}
	plain, err := cfg.DecryptSensitive()
	if err != nil {
		return "", err
	}
	if plain.Apiv3Key == "" {
		return "", errors.New("apiv3_key empty")
	}
	return plain.Apiv3Key, nil
}

// buildHttpRequest is a tiny adapter: wechatpay-go's handler takes a
// *http.Request to read headers; here we construct a stand-in with the
// minimum fields it inspects (headers + body).
//
// Implemented below the notify helpers to keep the main flow readable.

// parseRFC3339Unix converts wechat's ISO 8601 SuccessTime to unix seconds.
// On parse failure returns now (safe: paid_at is informational only).
```

Add a second file to hold the adapters (keeps `notify.go` focused):

**Files:**
- Create: `service/payment/wechat/notify_adapters.go`

```go
package wechat

import (
	"bytes"
	"io"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/model"
)

func buildHttpRequest(headers map[string]string, body []byte) *http.Request {
	r, _ := http.NewRequest(http.MethodPost, "/notify", io.NopCloser(bytes.NewReader(body)))
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	// Rebuild body again because wechatpay-go reads r.Body.
	r.Body = io.NopCloser(bytes.NewReader(body))
	return r
}

func parseRFC3339Unix(s string) int64 {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Now().Unix()
	}
	return t.Unix()
}

// loadConfigForNotify is a thin wrapper around model.GetTenantPaymentConfig
// isolated so notify.go has a single call site.
func loadConfigForNotify(tenantId int) (*model.TenantPaymentConfig, error) {
	return model.GetTenantPaymentConfig(tenantId, "wechat")
}
```

- [ ] **Step 2: 编译**

```bash
go build ./...
```

wechatpay-go v0.2.x 的 `downloader.MgrInstance().GetCertificateVisitor(mchid)` 路径可能需要微调。跑一次 go doc 确认：

```bash
go doc github.com/wechatpay-apiv3/wechatpay-go/core/downloader MgrInstance
go doc github.com/wechatpay-apiv3/wechatpay-go/core/notify NewNotifyHandler
```

修正后再提交。

- [ ] **Step 3: Commit**

```bash
git add service/payment/wechat/notify.go service/payment/wechat/notify_adapters.go
git commit -m "feat(payment/wechat): implement callback verify+decrypt"
```

---

## Task 10：wechat/provider.go — 串起所有接口实现

**Files:**
- Modify: `service/payment/wechat/provider.go`

- [ ] **Step 1: 替换 stub 为实际实现**

Edit `service/payment/wechat/provider.go`：删掉 Task 4 加的 3 个 "not implemented yet" stub，换成真实现：

```go
func (providerImpl) CreateOrder(ctx context.Context, req payment.CreateOrderRequest) (*payment.CreateOrderResponse, error) {
	if req.Order == nil {
		return nil, errors.New("req.Order nil")
	}
	cc, err := getClient(ctx, req.Order.TenantId)
	if err != nil {
		return nil, err
	}
	// Load full config for JSAPI signing (only product form that needs it).
	cfg, err := model.GetTenantPaymentConfig(req.Order.TenantId, "wechat")
	if err != nil {
		return nil, err
	}
	switch req.Order.ProductForm {
	case model.PaymentProductFormNative:
		return createNativeOrder(ctx, cc.client, cc, req)
	case model.PaymentProductFormH5:
		return createH5Order(ctx, cc.client, cc, req)
	case model.PaymentProductFormJsapi:
		return createJsapiOrder(ctx, cc.client, cc, cfg, req)
	default:
		return nil, fmt.Errorf("unsupported product form: %s", req.Order.ProductForm)
	}
}

func (providerImpl) VerifyAndParseNotify(ctx context.Context, tenantId int, body []byte, headers map[string]string) (*payment.NotifyResult, error) {
	return verifyAndParseNotify(ctx, tenantId, body, headers)
}

func (providerImpl) QueryOrder(ctx context.Context, tenantId int, outTradeNo string) (*payment.QueryOrderResult, error) {
	// S3 will use this in the reconcile loop. S2 ships a working impl so
	// callers can manually refresh stuck orders if needed.
	cc, err := getClient(ctx, tenantId)
	if err != nil {
		return nil, err
	}
	svc := transactions.TransactionsApiService{Client: cc.client}
	callCtx, cancel := callWithTimeout(ctx)
	defer cancel()
	resp, _, err := svc.QueryOrderByOutTradeNo(callCtx, transactions.QueryOrderByOutTradeNoRequest{
		OutTradeNo: stringPtr(outTradeNo),
		Mchid:      stringPtr(cc.mchid),
	})
	if err != nil {
		return nil, fmt.Errorf("wechat query order: %w", err)
	}
	var state, txnId string
	var paid int64
	if resp != nil {
		if resp.TradeState != nil {
			state = *resp.TradeState
		}
		if resp.TransactionId != nil {
			txnId = *resp.TransactionId
		}
		if resp.SuccessTime != nil && *resp.SuccessTime != "" {
			paid = parseRFC3339Unix(*resp.SuccessTime)
		}
	}
	return &payment.QueryOrderResult{
		TradeState:    state,
		TransactionId: txnId,
		PaidAt:        paid,
	}, nil
}
```

Ensure these imports are present in `provider.go`:

```go
import (
	"context"
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/payment"
	"github.com/wechatpay-apiv3/wechatpay-go/services/certificates"
	// transactions API package for QueryOrder:
	// Likely: github.com/wechatpay-apiv3/wechatpay-go/services/payments/transactions
)
```

Run `go doc github.com/wechatpay-apiv3/wechatpay-go/services/payments/transactions TransactionsApiService` if the package path differs.

- [ ] **Step 2: 编译**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add service/payment/wechat/provider.go
git commit -m "feat(payment/wechat): wire CreateOrder/Notify/QueryOrder providers"
```

---

## Task 11：applyTopupSuccess — quota 加账

**Files:**
- Modify: `service/payment/order.go`

- [ ] **Step 1: 替换 `applyTopupSuccess` stub**

Edit `service/payment/order.go`: 找到 `func applyTopupSuccess(...)`，替换为：

```go
func applyTopupSuccess(tx *gorm.DB, order *model.PaymentOrder, postCommit *[]func()) error {
	if order.UserId <= 0 {
		return errors.New("topup order missing UserId")
	}
	// Metadata carries amount_units (already-normalized display units;
	// see CreateTopupOrderInput doc). Quota is derived here using the
	// same formula epay uses at callback time (controller/topup.go:371-
	// 373), so both display modes round-trip the user's original request.
	var meta struct {
		AmountUnits int64 `json:"amount_units"`
	}
	if order.Metadata != "" {
		if err := json.Unmarshal([]byte(order.Metadata), &meta); err != nil {
			return fmt.Errorf("parse topup metadata: %w", err)
		}
	}
	if meta.AmountUnits <= 0 {
		return fmt.Errorf("invalid amount_units for topup order %d", order.Id)
	}
	quotaToAdd := decimal.NewFromInt(meta.AmountUnits).
		Mul(decimal.NewFromFloat(common.QuotaPerUnit)).IntPart()
	if quotaToAdd <= 0 {
		return fmt.Errorf("computed non-positive quota for order %d", order.Id)
	}

	// Add quota to the user's HOME tenant row (users.tenant_id), NOT
	// order.TenantId (which is the session/collection tenant). See spec §6.3
	// and controller/topup.go:374 for the precedent.
	homeTenant := model.GetUserTenantId(order.UserId)
	if homeTenant <= 0 {
		return fmt.Errorf("cannot resolve home tenant for user %d", order.UserId)
	}
	// Tx-local quota credit. Do NOT call model.IncreaseUserQuota here —
	// that helper writes via the global DB (model/user.go:1072) and
	// kicks off an async gopool.Go cache write, both of which commit
	// independently of this tx. If the top_ups insert or audit write
	// below fails, we need users.quota to roll back with them.
	// Cache sync is deferred to postCommit (ran only after tx success).
	res := tx.Exec(
		"UPDATE users SET quota = quota + ? WHERE id = ? AND tenant_id = ?",
		quotaToAdd, order.UserId, homeTenant,
	)
	if res.Error != nil {
		return fmt.Errorf("increase quota: %w", res.Error)
	}
	if res.RowsAffected != 1 {
		return fmt.Errorf("quota update affected %d rows (user=%d, home=%d)",
			res.RowsAffected, order.UserId, homeTenant)
	}

	// Record a top_ups row visible in the SESSION tenant so the user sees
	// this order in their payment history / invoice flows. payment_method
	// = "wxpay" keeps it compatible with invoice_service.go filters.
	// Amount = AmountUnits (the "display units" value, matching epay
	// line 234 semantics); NOT the quota delta. CreateTime = order's
	// creation stamp; CompleteTime = paid moment.
	topup := &model.TopUp{
		TenantId:      order.TenantId,
		UserId:        order.UserId,
		Amount:        meta.AmountUnits,
		Money:         float64(order.Amount) / 100.0, // CNY yuan
		TradeNo:       order.OutTradeNo,
		PaymentMethod: "wxpay",
		Status:        "success",
		CreateTime:    order.CreatedAt,
		CompleteTime:  order.PaidAt,
	}
	if err := tx.Create(topup).Error; err != nil {
		return fmt.Errorf("record top_ups: %w", err)
	}

	// Audit — MUST use the tx variant; the plain CreateTenantAuditLog
	// writes via global DB and would persist even on tx rollback.
	if err := model.CreateTenantAuditLogTx(tx, &model.TenantAuditLog{
		TenantId:    order.TenantId,
		ActorUserId: order.UserId,
		Action:      "payment.topup.success",
		Target:      "payment_orders",
		TargetId:    order.Id,
		Detail: mustJSON(map[string]any{
			"out_trade_no":   order.OutTradeNo,
			"amount_cents":   order.Amount,
			"amount_units":   meta.AmountUnits,
			"quota_delta":    quotaToAdd,
			"home_tenant":    homeTenant,
			"session_tenant": order.TenantId,
		}),
	}); err != nil {
		// Don't fail the payment for an audit write hiccup, but log it.
		common.SysLog(fmt.Sprintf("topup audit tx-write failed: %v", err))
	}

	// Post-commit side-effects. Parity with the existing epay success
	// path (controller/topup.go:380-382) + the Stripe path
	// (model/topup.go:130-133). WeChat must NOT behave differently per
	// channel. Both helpers use global DB internally, so running them
	// inside the tx would either (a) write to a different connection
	// and not be atomic with the tx, or (b) block the tx on another
	// connection's locks — neither is what we want. postCommit is
	// correct.
	userId := order.UserId
	delta := quotaToAdd
	tenantForLog := homeTenant
	money := float64(order.Amount) / 100.0
	logContent := fmt.Sprintf("使用微信支付充值成功，充值金额: %v，支付金额：%.2f 元",
		logger.FormatQuota(int(delta)), money)
	*postCommit = append(*postCommit, func() {
		// 1. Topup log entry — visible in user log UI.
		model.RecordTopUpLogWithTenant(tenantForLog, userId, int(delta), logContent)
		// 2. Rebate processing — matches controller/topup.go:382 behavior.
		model.ProcessTopUpRebate(userId, int(delta))
		// 3. User quota cache sync.
		if err := model.CacheIncrUserQuota(userId, delta); err != nil {
			common.SysLog(fmt.Sprintf("topup cache sync failed user=%d: %v", userId, err))
		}
	})
	return nil
}

// mustJSON is a helper to marshal a map to a JSON string; returns "{}" on
// error (audit detail is best-effort, we don't want to fail the tx for it).
func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(b)
}
```

Add `"time"` to imports if missing.

- [ ] **Step 1.5: 暴露缓存增量 helper（`model/user.go`）**

`applyTopupSuccess` 的 postCommit 调用 `model.CacheIncrUserQuota(userId, delta)`，而现仓库
只有私有的 `cacheIncrUserQuota`（小写）。在 `model/user.go` 里加 export 封装：

```go
// CacheIncrUserQuota is the exported form of cacheIncrUserQuota. Payment
// success handlers (service/payment/order.go) call it from *postCommit*
// after the DB tx commits — never from inside a tx, because the cache
// and DB writes must not diverge on tx rollback (see
// ApplyPaymentSuccess in service/payment/order.go).
func CacheIncrUserQuota(id int, quota int64) error {
	return cacheIncrUserQuota(id, quota)
}
```

签名对齐现有 `cacheIncrUserQuota(id int, quota int64) error`。如果实际签名不同，
把 applyTopupSuccess 里的调用签名一并调整。

- [ ] **Step 2: 验证 `model.TopUp` struct 字段名**

```bash
grep -n "type TopUp struct" model/topup.go
```

Confirm field names match (`TenantId`, `UserId`, `Amount`, `Money`, `TradeNo`, `PaymentMethod`, `Status`, `CreateTime`, `CompleteTime`). Adjust if they differ.

- [ ] **Step 3: 编译 + 测试**

```bash
go build ./...
```

- [ ] **Step 4: Commit**

```bash
git add service/payment/order.go
git commit -m "$(cat <<'EOF'
feat(payment): applyTopupSuccess credits users.quota + writes top_ups

Success handler for topup orders:
- GetUserTenantId(order.UserId) → home tenant (quota column lives on
  users.tenant_id, which never changes on session switch).
- Credits users.quota via tx.Exec("UPDATE users SET quota=quota+?..."),
  NOT model.IncreaseUserQuota — that helper uses the global DB and
  fires an async cache write, which would commit ahead of the tx. We
  must keep quota movement and top_ups insert atomic in one tx.
- Requires RowsAffected == 1 to catch bad tenant_id routing.
- top_ups row written with TenantId = order.TenantId (session tenant)
  so invoice/history filters (invoice_service.go:248) see it.
  CreateTime = order.CreatedAt (row stamp), CompleteTime = order.PaidAt.
- payment_method = "wxpay" preserves compatibility with
  invoice_service.go:245 payment_method IN ('alipay','wxpay') filter.
- Audit uses CreateTenantAuditLogTx so it rolls back with the tx —
  the plain helper writes via global DB and would leave a false
  "success" audit on tx rollback.
- postCommit fires AFTER the tx commits: (a) RecordTopUpLogWithTenant
  writes the user-visible topup log entry, (b) ProcessTopUpRebate
  runs the rebate pipeline, (c) CacheIncrUserQuota syncs quota cache.
  All three are parity with the epay / stripe success path
  (controller/topup.go:380-382 + model/topup.go:130-133) — WeChat
  must NOT behave differently per channel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12：applySubSuccess — 延长 ExpiresAt + 显式恢复 Status

**Files:**
- Modify: `service/payment/order.go`

- [ ] **Step 1: 替换 `applySubSuccess` stub**

Edit `service/payment/order.go`: find `func applySubSuccess(...)` replace with:

```go
func applySubSuccess(tx *gorm.DB, order *model.PaymentOrder, postCommit *[]func()) error {
	var meta struct {
		RenewPeriodDays int `json:"renew_period_days"`
	}
	if order.Metadata != "" {
		if err := json.Unmarshal([]byte(order.Metadata), &meta); err != nil {
			return fmt.Errorf("parse sub metadata: %w", err)
		}
	}
	if meta.RenewPeriodDays <= 0 {
		return fmt.Errorf("invalid renew_period_days for sub order %d", order.Id)
	}

	// Read plan inside the tx with a row lock to serialize concurrent
	// renewals. Without this lock two callbacks landing at the same time
	// would both read the same old ExpiresAt and the second UPDATE would
	// overwrite the first — effectively losing one renewal (review #3).
	//
	// NOTE: do NOT use model.GetTenantPlan — it uses the global DB.
	var plan model.TenantPlan
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("tenant_id = ?", order.TenantId).
		First(&plan).Error; err != nil {
		return fmt.Errorf("lock plan: %w", err)
	}
	oldExpires := plan.ExpiresAt
	oldStatus := plan.Status
	statusRecovered := oldStatus != model.TenantPlanStatusActive

	// Atomic-expression UPDATE. Belt-and-braces with FOR UPDATE above:
	//   new_expires = GREATEST(expires_at, now) + days*86400
	// Expressed as CASE so we don't depend on MySQL-only GREATEST.
	now := time.Now().Unix()
	secs := int64(meta.RenewPeriodDays) * 86400
	updates := map[string]interface{}{
		"expires_at": gorm.Expr(
			"CASE WHEN expires_at > ? THEN expires_at + ? ELSE ? + ? END",
			now, secs, now, secs),
		"updated_at": now,
	}
	if statusRecovered {
		updates["status"] = model.TenantPlanStatusActive
	}
	if err := tx.Model(&model.TenantPlan{}).
		Where("id = ? AND tenant_id = ?", plan.Id, plan.TenantId).
		Updates(updates).Error; err != nil {
		return fmt.Errorf("extend plan expiry: %w", err)
	}

	// Read back the post-UPDATE ExpiresAt for the audit diff. Same tx, so
	// the UPDATE is visible even before commit.
	var reloaded model.TenantPlan
	if err := tx.Select("expires_at").Where("id = ?", plan.Id).First(&reloaded).Error; err != nil {
		return fmt.Errorf("reload plan after update: %w", err)
	}
	newExpires := reloaded.ExpiresAt

	// Audit — tx variant so the audit rolls back with the plan UPDATE
	// on any later failure in this closure. See rationale on
	// applyTopupSuccess / CreateTenantAuditLogTx.
	if err := model.CreateTenantAuditLogTx(tx, &model.TenantAuditLog{
		TenantId:    order.TenantId,
		ActorUserId: order.UserId,
		Action:      "payment.sub.renewed",
		Target:      "tenant_plans",
		TargetId:    plan.Id,
		Detail: mustJSON(map[string]any{
			"out_trade_no":     order.OutTradeNo,
			"amount":           order.Amount,
			"renew_days":       meta.RenewPeriodDays,
			"old_expires_at":   oldExpires,
			"new_expires_at":   newExpires,
			"old_status":       oldStatus,
			"status_recovered": statusRecovered,
		}),
	}); err != nil {
		common.SysLog(fmt.Sprintf("sub audit tx-write failed: %v", err))
	}

	// Post-commit: invalidate cached plan so the relay layer picks up
	// the new ExpiresAt/Status immediately. Must run AFTER commit —
	// invalidating mid-tx would race with an in-flight relay reading
	// stale DB and then re-populating the cache with the old values.
	tid := order.TenantId
	*postCommit = append(*postCommit, func() {
		model.InvalidateTenantPlanCache(tid)
	})
	return nil
}
```

Add `"gorm.io/gorm/clause"` to imports if missing.

- [ ] **Step 2: 编译**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add service/payment/order.go
git commit -m "$(cat <<'EOF'
feat(payment): applySubSuccess extends ExpiresAt + explicit Status recovery

Success handler for renewal orders:
- Parse renew_period_days from order metadata (set server-side at
  CreateSubOrder time from TenantPlan, never from client).
- SELECT ... FOR UPDATE on tenant_plans to serialize concurrent
  renewals. Without the row lock two callbacks arriving at the same
  time would both compute newExpires from the same old value and the
  second UPDATE would overwrite the first — one paid renewal lost.
- UPDATE uses an atomic CASE expression instead of an absolute value,
  so even if the lock were somehow bypassed the extension still
  accumulates: expires_at = CASE WHEN expires_at>now THEN expires_at+
  secs ELSE now+secs END.
- If Status != Active, set it to Active. Current state machine in
  service/tenant_billing.go only goes active→disabled; there is no
  auto-recovery, so the callback path must explicitly flip it back
  (spec §11.4).
- Read the row back inside the tx for the audit diff.
- InvalidateTenantPlanCache deferred to postCommit so it only fires
  after the tx commits (stops an in-flight relay from repopulating
  the cache with pre-UPDATE values).
- Audit entry with old/new ExpiresAt + old_status + status_recovered.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13：controller/payment_wechat.go — 下单 5 个 endpoint

**Files:**
- Create: `controller/payment_wechat.go`

- [ ] **Step 1: 创建 controller**

```go
package controller

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/payment"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

// ---------- Topup ----------

type wechatTopupRequest struct {
	Amount      int64  `json:"amount"`       // quota units user wants
	ProductForm string `json:"product_form"` // optional; defaults to "native" on topup/native etc
	Openid      string `json:"openid"`       // jsapi only
}

// resolveTopupPrice calls the SAME pricing helpers epay/stripe topup use
// (controller/topup.go:128 getPayMoney, line 158 getMinTopup, line 225-
// 230 display-units normalization, line 371-373 quota conversion).
// Accepting an independent "WeChat pricing" path would split behavior
// by channel — we refuse that.
//
// Returns (amountCents, amountUnits, err) where:
//   - amountCents = CNY price to charge (WeChat API wants integer cents)
//   - amountUnits = what gets stored in top_ups.Amount; identical to the
//     epay/stripe value. In CNY/USD display mode this equals the raw
//     request amount; in Tokens display mode this equals
//     req.Amount / QuotaPerUnit (see epay line 225-230). The success
//     handler reconstructs quota via `amountUnits * QuotaPerUnit`, so
//     both modes round-trip the user's original request.
func resolveTopupPrice(c *gin.Context, amount int64) (amountCents int64, amountUnits int64, err error) {
	// 1. Min amount gate — identical to controller/topup.go:175.
	if amount < getMinTopup() {
		return 0, 0, fmt.Errorf("充值数量不能小于 %d", getMinTopup())
	}
	userId := c.GetInt("id")
	if userId <= 0 {
		return 0, 0, errors.New("未登录")
	}
	// 2. Group ratio — epay's line 181 does the same fetch.
	group, gerr := model.GetUserGroup(userId, true)
	if gerr != nil {
		return 0, 0, fmt.Errorf("获取用户分组失败: %w", gerr)
	}
	// 3. Pricing — mirrors controller/topup.go:186. payMoney is in CNY
	//    yuan (float64). WeChat requires cents (integer), so convert via
	//    decimal rounding.
	payMoney := getPayMoney(amount, group)
	if payMoney < 0.01 {
		return 0, 0, errors.New("充值金额过低")
	}
	amountCents = decimal.NewFromFloat(payMoney).
		Mul(decimal.NewFromInt(100)).Round(0).IntPart()

	// 4. Normalize amount into the display-units used by epay/stripe
	//    (controller/topup.go:225-230). In tokens mode req.Amount is
	//    tokens; we must divide by QuotaPerUnit so that the success
	//    handler's `amountUnits * QuotaPerUnit` round-trips back to the
	//    original token count. In CNY/USD mode this is a no-op.
	amountUnits = amount
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		amountUnits = decimal.NewFromInt(amount).
			Div(decimal.NewFromFloat(common.QuotaPerUnit)).IntPart()
		if amountUnits <= 0 {
			return 0, 0, errors.New("充值数量过小")
		}
	}
	return
}

// buildNotifyUrl returns the absolute WeChat callback URL using the
// operator-configured ServerAddress — NEVER the request's Host header
// or X-Forwarded-* values.
//
// Why: behind a dev proxy, Kubernetes Ingress without X-Forwarded-Host,
// or a reverse proxy that doesn't set X-Forwarded-Proto, those headers
// can yield localhost, an internal svc name, or http:// when WeChat
// requires https://. Other payment paths in this repo already funnel
// through system_setting.ServerAddress (see controller/subscription_
// payment_stripe.go:121). We do the same and refuse to create orders
// when ServerAddress is unusable — better to fail loudly than to hand
// WeChat a notify URL they can never reach.
func buildNotifyUrl(c *gin.Context, orderType string) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(system_setting.ServerAddress), "/")
	if base == "" {
		return "", errors.New("system ServerAddress is empty; cannot build notify URL")
	}
	if !strings.HasPrefix(base, "https://") && !strings.HasPrefix(base, "http://") {
		return "", errors.New("ServerAddress must include scheme (http:// or https://)")
	}
	if strings.Contains(base, "localhost") || strings.Contains(base, "127.0.0.1") {
		return "", errors.New("ServerAddress points to localhost/127.0.0.1; WeChat cannot reach it")
	}
	return fmt.Sprintf("%s/api/payment/wechat/notify/%d/%s",
		base, middleware.GetTenantId(c), orderType), nil
}

func createTopupHandler(productForm string) gin.HandlerFunc {
	return func(c *gin.Context) {
		tid := middleware.GetTenantId(c)
		if tid <= 0 {
			common.ApiErrorMsg(c, "无法解析当前租户")
			return
		}
		userId := c.GetInt("id")
		if userId <= 0 {
			common.ApiErrorMsg(c, "未登录")
			return
		}

		var req wechatTopupRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			common.ApiErrorMsg(c, "参数错误")
			return
		}
		amountCents, amountUnits, err := resolveTopupPrice(c, req.Amount)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		notifyUrl, err := buildNotifyUrl(c, "topup")
		if err != nil {
			common.ApiError(c, err)
			return
		}

		resp, order, err := payment.CreateTopupOrder(c.Request.Context(), payment.CreateTopupOrderInput{
			TenantId:    tid,
			UserId:      userId,
			AmountCents: amountCents,
			AmountUnits: amountUnits,
			ProductForm: productForm,
			Openid:      req.Openid,
			ClientIp:    c.ClientIP(),
			Description: "充值",
			NotifyUrl:   notifyUrl,
		})
		if err != nil {
			common.ApiError(c, err)
			return
		}
		common.ApiSuccess(c, gin.H{
			"order":    gin.H{"out_trade_no": order.OutTradeNo, "amount": order.Amount},
			"response": resp,
		})
	}
}

// Exported handlers — one per endpoint; router wires them.

func CreateWechatTopupNative(c *gin.Context) {
	createTopupHandler(model.PaymentProductFormNative)(c)
}
func CreateWechatTopupH5(c *gin.Context) {
	createTopupHandler(model.PaymentProductFormH5)(c)
}
func CreateWechatTopupJsapi(c *gin.Context) {
	createTopupHandler(model.PaymentProductFormJsapi)(c)
}

// ---------- Sub (renewal) ----------

type wechatSubRequest struct {
	Openid string `json:"openid"` // jsapi only
}

func createSubHandler(productForm string) gin.HandlerFunc {
	return func(c *gin.Context) {
		tid := middleware.GetTenantId(c)
		if tid <= 0 {
			common.ApiErrorMsg(c, "无法解析当前租户")
			return
		}
		userId := c.GetInt("id")
		if userId <= 0 {
			common.ApiErrorMsg(c, "未登录")
			return
		}

		plan, err := model.GetTenantPlan(tid)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if plan.RenewPriceAmount <= 0 {
			common.ApiErrorMsg(c, "计划未配置续期价格，请联系管理员")
			return
		}
		days := plan.RenewPeriodDays
		if days <= 0 {
			days = 30
		}

		var req wechatSubRequest
		_ = c.ShouldBindJSON(&req) // body optional for native

		notifyUrl, err := buildNotifyUrl(c, "sub")
		if err != nil {
			common.ApiError(c, err)
			return
		}

		resp, order, err := payment.CreateSubOrder(c.Request.Context(), payment.CreateSubOrderInput{
			TenantId:        tid,
			UserId:          userId,
			AmountCents:     plan.RenewPriceAmount,
			RenewPeriodDays: days,
			ProductForm:     productForm,
			Openid:          req.Openid,
			ClientIp:        c.ClientIP(),
			Description:     "套餐续期",
			NotifyUrl:       notifyUrl,
		})
		if err != nil {
			common.ApiError(c, err)
			return
		}
		common.ApiSuccess(c, gin.H{
			"order":    gin.H{"out_trade_no": order.OutTradeNo, "amount": order.Amount},
			"response": resp,
		})
	}
}

func CreateWechatSubNative(c *gin.Context) {
	createSubHandler(model.PaymentProductFormNative)(c)
}
func CreateWechatSubJsapi(c *gin.Context) {
	createSubHandler(model.PaymentProductFormJsapi)(c)
}
```

- [ ] **Step 2: 冒烟 — 验证定价和 tokens-mode 归一化与现有 topup 渠道一致**

```bash
# 确认调用点匹配：getPayMoney + getMinTopup + QuotaDisplayType 归一化 + QuotaPerUnit。
grep -n "getPayMoney\|getMinTopup\|QuotaPerUnit\|QuotaDisplayType" controller/topup.go | head -10
```

Two round-trips must hold — same invariant as epay (controller/topup.go 行 225-230 + 371-373)：
- CNY/USD mode: `req.Amount → amountUnits = req.Amount → quota = amountUnits * QuotaPerUnit`
- Tokens mode:  `req.Amount → amountUnits = req.Amount / QuotaPerUnit → quota = amountUnits * QuotaPerUnit = req.Amount`

`resolveTopupPrice` 和 `applyTopupSuccess` 已经按这两个恒等式实现（见本文件"修订记录 §9"）。
本 Step 只是验证现场代码常量 / helper 名对得上，不是遗留 TODO。

- [ ] **Step 3: 编译**

```bash
go build ./...
```

- [ ] **Step 4: Commit**

```bash
git add controller/payment_wechat.go
git commit -m "$(cat <<'EOF'
feat(controller): WeChat order creation endpoints (topup + sub)

5 handlers under /api/payment/wechat/{topup|sub}/{native|h5|jsapi}:
- Topup: takes amount + optional openid, resolves price via shared
  logic with controller/topup_stripe.go, calls CreateTopupOrder.
- Sub: reads TenantPlan.RenewPriceAmount + RenewPeriodDays
  server-side (client cannot override), rejects when
  RenewPriceAmount <= 0.
- buildNotifyUrl constructs /api/payment/wechat/notify/:tid/:ot
  using X-Forwarded-{Proto,Host} when behind a reverse proxy.
- Sub currently only native + jsapi (no H5 renewal use case).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14：controller/payment_notify.go — 回调

**Files:**
- Create: `controller/payment_notify.go`

- [ ] **Step 1: 创建 controller**

```go
package controller

import (
	"io"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/payment"

	"github.com/gin-gonic/gin"
)

// HandleWechatNotify handles POST /api/payment/wechat/notify/:tenant_id/:order_type
//
// Flow:
//   1. Parse :tenant_id and :order_type from URL (route guarantee, but validate).
//   2. Read raw body (needed twice: for signature verify and decryption).
//   3. Extract relevant headers into a plain map for provider layer.
//   4. provider.VerifyAndParseNotify returns NotifyResult.
//   5. Defense-in-depth: out_trade_no prefix must match :tenant_id and :order_type.
//   6. If Success, call service/payment.ApplyPaymentSuccess (idempotent).
//   7. Respond with HTTP 200 + the WeChat-required {"code":"SUCCESS","message":"OK"}.
//      On any error, respond 200 + {"code":"FAIL","message":...} so WeChat retries.
func HandleWechatNotify(c *gin.Context) {
	tenantId, err := strconv.Atoi(c.Param("tenant_id"))
	if err != nil || tenantId <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"code": "FAIL", "message": "invalid tenant_id"})
		return
	}
	orderType := c.Param("order_type")
	if orderType != "topup" && orderType != "sub" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "FAIL", "message": "invalid order_type"})
		return
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		respondNotifyFail(c, "read body: "+err.Error())
		return
	}

	// Flatten headers (keep only first value per key; wechatpay-go's handler
	// reads headers via Get(), which returns first).
	headers := make(map[string]string, len(c.Request.Header))
	for k, vs := range c.Request.Header {
		if len(vs) > 0 {
			headers[k] = vs[0]
		}
	}

	provider, ok := payment.Get("wechat")
	if !ok {
		respondNotifyFail(c, "wechat provider missing")
		return
	}
	result, err := provider.VerifyAndParseNotify(c.Request.Context(), tenantId, body, headers)
	if err != nil {
		common.SysError("wechat notify verify failed tenant=" + strconv.Itoa(tenantId) + ": " + err.Error())
		respondNotifyFail(c, "verify failed")
		return
	}

	// Defense-in-depth: out_trade_no must match route.
	if err := model.ValidateOutTradeNoRoute(result.OutTradeNo, tenantId, orderType); err != nil {
		common.SysError("wechat notify route mismatch: " + err.Error())
		_ = model.CreateTenantAuditLog(&model.TenantAuditLog{
			TenantId: tenantId, Action: "payment.notify.mismatch",
			Detail: `{"out_trade_no":"` + result.OutTradeNo + `","order_type":"` + orderType + `"}`,
		})
		respondNotifyFail(c, "route mismatch")
		return
	}

	if !result.Success {
		// Not a success transition (e.g., USERPAYING) — ack and wait.
		respondNotifyOk(c)
		return
	}
	if err := payment.ApplyPaymentSuccess(c.Request.Context(), result.OutTradeNo, result.TransactionId, result.PaidAt); err != nil {
		common.SysError("ApplyPaymentSuccess failed: " + err.Error())
		respondNotifyFail(c, "apply failed")
		return
	}
	respondNotifyOk(c)
}

func respondNotifyOk(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"code": "SUCCESS", "message": "OK"})
}
func respondNotifyFail(c *gin.Context, msg string) {
	c.JSON(http.StatusOK, gin.H{"code": "FAIL", "message": msg})
}
```

- [ ] **Step 2: 编译**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add controller/payment_notify.go
git commit -m "$(cat <<'EOF'
feat(controller): WeChat notify handler with defense-in-depth

POST /api/payment/wechat/notify/:tenant_id/:order_type
- provider.VerifyAndParseNotify verifies signature + decrypts body.
- ValidateOutTradeNoRoute enforces that out_trade_no prefix matches
  URL :tenant_id and :order_type (spec §7.4).
- Mismatch triggers payment.notify.mismatch audit + FAIL response.
- On TradeState=SUCCESS, runs service/payment.ApplyPaymentSuccess
  which is idempotent (MarkOrderPaid returns false on repeat).
- Responds 200 + {"code":"SUCCESS"|"FAIL","message":...} per WeChat
  contract so failed payloads are retried upstream.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15：controller/payment_order.go — 订单查询 + 列表

**Files:**
- Create: `controller/payment_order.go`

- [ ] **Step 1: 创建 controller**

```go
package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// paymentOrderView is the safe projection for API responses. Does NOT
// include openid (PII) or raw metadata (may contain server-only JSON).
type paymentOrderView struct {
	Id             int    `json:"id"`
	OutTradeNo     string `json:"out_trade_no"`
	TransactionId  string `json:"transaction_id,omitempty"`
	Provider       string `json:"provider"`
	OrderType      string `json:"order_type"`
	ProductForm    string `json:"product_form"`
	Amount         int64  `json:"amount"`
	RefundedAmount int64  `json:"refunded_amount"`
	Currency       string `json:"currency"`
	Status         string `json:"status"`
	PaidAt         int64  `json:"paid_at"`
	ExpiresAt      int64  `json:"expires_at"`
	CreatedAt      int64  `json:"created_at"`
	UpdatedAt      int64  `json:"updated_at"`
}

func toOrderView(o *model.PaymentOrder) paymentOrderView {
	return paymentOrderView{
		Id: o.Id, OutTradeNo: o.OutTradeNo, TransactionId: o.TransactionId,
		Provider: o.Provider, OrderType: o.OrderType, ProductForm: o.ProductForm,
		Amount: o.Amount, RefundedAmount: o.RefundedAmount, Currency: o.Currency,
		Status: o.Status, PaidAt: o.PaidAt, ExpiresAt: o.ExpiresAt,
		CreatedAt: o.CreatedAt, UpdatedAt: o.UpdatedAt,
	}
}

// GetPaymentOrderByOutTradeNo returns a single order. Authz:
//   - session.user_id == order.user_id  (the payer themselves), OR
//   - session.tenant_role is tenant admin AND session.tenant_id == order.tenant_id
//
// Any other case returns 404 (not 403) to avoid leaking order existence.
func GetPaymentOrderByOutTradeNoHandler(c *gin.Context) {
	outTradeNo := c.Param("out_trade_no")
	if outTradeNo == "" {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "not found"})
		return
	}
	order, err := model.GetPaymentOrderByOutTradeNo(outTradeNo)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "not found"})
			return
		}
		common.ApiError(c, err)
		return
	}

	sessionUserId := c.GetInt("id")
	sessionTenantId := middleware.GetTenantId(c)
	tenantRole := c.GetInt("tenant_role")

	isPayer := sessionUserId > 0 && sessionUserId == order.UserId
	isTenantAdmin := sessionTenantId > 0 && sessionTenantId == order.TenantId && tenantRole >= 10
	if !isPayer && !isTenantAdmin {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "not found"})
		return
	}
	common.ApiSuccess(c, toOrderView(order))
}

// ListTenantPaymentOrders returns a paginated list for the current tenant.
// Tenant admin only (route layer).
func ListTenantPaymentOrders(c *gin.Context) {
	tid := middleware.GetTenantId(c)
	if tid <= 0 {
		common.ApiErrorMsg(c, "无法解析当前租户")
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	orderType := c.Query("order_type")
	status := c.Query("status")

	q := model.WithTenantBypass(model.DB).Model(&model.PaymentOrder{}).
		Where("tenant_id = ?", tid)
	if orderType != "" {
		q = q.Where("order_type = ?", orderType)
	}
	if status != "" {
		q = q.Where("status = ?", status)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	var rows []model.PaymentOrder
	if err := q.Order("id DESC").
		Offset((page - 1) * pageSize).Limit(pageSize).
		Find(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	views := make([]paymentOrderView, len(rows))
	for i := range rows {
		views[i] = toOrderView(&rows[i])
	}
	common.ApiSuccess(c, gin.H{
		"items":     views,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}
```

- [ ] **Step 2: 编译**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add controller/payment_order.go
git commit -m "$(cat <<'EOF'
feat(controller): payment order query + list APIs

- GET /api/payment/orders/:out_trade_no: user-scope. Returns 404 (not
  403) if the requester is neither the payer nor a tenant admin of the
  order's tenant, to avoid leaking order existence to probers.
- GET /api/tenant/payment/orders: tenant-admin scope. Paginated list
  with optional order_type / status filters.
- paymentOrderView omits openid + raw metadata (PII / server-only).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16：router — 注册 7 条新路由

**Files:**
- Modify: `router/api-router.go`

- [ ] **Step 1: 定位 3 个 group**

```bash
grep -n "userRoute\|tenantRoute\|UserAuth\|TenantAdminAuth" router/api-router.go | head -10
```

Payment endpoints split across 3 scopes:
- Under **userRoute** (UserAuth, any logged-in user): topup ordering + single order query
- Under **tenantRoute** (TenantAdminAuth): sub ordering + order list
- Under **NO AUTH** (notify is called by WeChat, not a user): `/api/payment/wechat/notify/...`

- [ ] **Step 2: 添加路由（示意位置；用 grep 确认实际组名）**

In the user-authenticated group, add:

```go
		// Payment ordering (user-initiated)
		userRoute.POST("/payment/wechat/topup/native", controller.CreateWechatTopupNative)
		userRoute.POST("/payment/wechat/topup/h5", controller.CreateWechatTopupH5)
		userRoute.POST("/payment/wechat/topup/jsapi", controller.CreateWechatTopupJsapi)
		userRoute.GET("/payment/orders/:out_trade_no", controller.GetPaymentOrderByOutTradeNoHandler)
```

In the tenant-admin group:

```go
		// Tenant-admin payment management (renewal + order list)
		tenantRoute.POST("/payment/wechat/sub/native", controller.CreateWechatSubNative)
		tenantRoute.POST("/payment/wechat/sub/jsapi", controller.CreateWechatSubJsapi)
		tenantRoute.GET("/payment/orders", controller.ListTenantPaymentOrders)
```

Outside any auth (add under the top-level `apiRouter` or wherever the existing `HealthCheck` / public routes live):

```go
		// WeChat notify (called by WeChat servers, signature-auth only)
		apiRouter.POST("/payment/wechat/notify/:tenant_id/:order_type", controller.HandleWechatNotify)
```

Adjust the variable names to match the actual file.

- [ ] **Step 3: 编译**

```bash
go build ./...
```

- [ ] **Step 4: 快速 smoke test**（可选，需要本地 server 已启）

```bash
# Expect 401 (UserAuth blocks):
curl -i -X POST http://localhost:3000/api/payment/wechat/topup/native
# Expect 200 {code:FAIL, message:read body:...} (notify is public, validates tenant_id):
curl -i -X POST http://localhost:3000/api/payment/wechat/notify/1/topup
```

- [ ] **Step 5: Commit**

```bash
git add router/api-router.go
git commit -m "$(cat <<'EOF'
feat(router): register WeChat payment routes

- /api/payment/wechat/topup/{native,h5,jsapi}  (UserAuth)
- /api/payment/wechat/sub/{native,jsapi}       (TenantAdminAuth)
- /api/payment/orders/:out_trade_no            (UserAuth; handler
  does owner/tenant-admin authz)
- /api/tenant/payment/orders                   (TenantAdminAuth)
- /api/payment/wechat/notify/:tenant_id/:order_type  (no auth;
  signature verified inside handler)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17：前端类型 + API helper 扩展

**Files:**
- Modify: `web/src/types/tenant.ts`
- Modify: `web/src/helpers/payment.js`

- [ ] **Step 1: Types**

Append to `web/src/types/tenant.ts`:

```ts
// ---------- Payment Orders (S2) ----------

export type PaymentOrderStatus =
  | 'pending'
  | 'paid'
  | 'partial_refunded'
  | 'fully_refunded'
  | 'closed'
  | 'expired';

export type PaymentOrderType = 'topup' | 'sub';
export type PaymentProductForm = 'native' | 'h5' | 'jsapi';

export interface PaymentOrderView {
  id: number;
  out_trade_no: string;
  transaction_id?: string;
  provider: 'wechat';
  order_type: PaymentOrderType;
  product_form: PaymentProductForm;
  amount: number;            // 单位: 分
  refunded_amount: number;
  currency: string;
  status: PaymentOrderStatus;
  paid_at: number;
  expires_at: number;
  created_at: number;
  updated_at: number;
}

export interface CreateOrderResponse {
  code_url?: string;
  h5_url?: string;
  prepay_id?: string;
  package?: string;
  nonce_str?: string;
  timestamp?: string;
  sign_type?: string;
  pay_sign?: string;
}

export interface CreateOrderEnvelope {
  order: { out_trade_no: string; amount: number };
  response: CreateOrderResponse;
}
```

- [ ] **Step 2: API helpers**

Append to `web/src/helpers/payment.js`:

```js
// ---------- S2 Ordering & Query ----------

export async function createWechatTopup(productForm, payload) {
  // productForm: 'native' | 'h5' | 'jsapi'
  const res = await API.post(`/api/payment/wechat/topup/${productForm}`, payload);
  return res.data;
}

export async function createWechatSub(productForm, payload) {
  const res = await API.post(`/api/payment/wechat/sub/${productForm}`, payload);
  return res.data;
}

export async function getPaymentOrder(outTradeNo) {
  const res = await API.get(`/api/payment/orders/${encodeURIComponent(outTradeNo)}`);
  return res.data;
}

export async function listTenantPaymentOrders(params = {}) {
  const res = await API.get('/api/tenant/payment/orders', { params });
  return res.data;
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/types/tenant.ts web/src/helpers/payment.js
git commit -m "feat(web): add payment order types and ordering API helpers"
```

---

## Task 18：/console/platform-tenants 定价编辑 UI

**Files:**
- Modify: `web/src/components/platform/PlatformTenantsPanel.jsx` (or whatever file owns the plan edit form — grep first)

- [ ] **Step 1: 定位现有表单**

```bash
grep -n "quota_limit\|rpm_limit\|grace_period" web/src/components/platform/*.jsx | head -5
```

- [ ] **Step 2: 在表单里加 3 个字段**

Near the existing `GracePeriodSeconds` input, insert:

```jsx
<Row label={t('续期周期（天）')}>
  <InputNumber
    min={0}
    value={form.renew_period_days}
    onChange={(v) => setForm({ ...form, renew_period_days: v })}
    disabled={saving}
  />
</Row>
<Row label={t('续期单价（元）')}>
  <InputNumber
    min={0}
    precision={2}
    value={form.renew_price_yuan}
    onChange={(v) => setForm({ ...form, renew_price_yuan: v })}
    disabled={saving}
    suffix="元"
  />
  <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginTop: 4 }}>
    {t('0 表示禁用续期；后端存 renew_price_amount（分）= 元 × 100')}
  </div>
</Row>
```

Exact Row/InputNumber markup: follow whatever pattern the existing plan-edit panel uses. If that file uses `<Form.InputNumber field="..." />`, use the same (remember S1 Task 12 learning: Semi Form components can be tricky; if the existing form works, follow its style).

- [ ] **Step 3: On submit, convert yuan → cents**

In the submit handler, add:

```js
const payload = {
  // ... existing fields
  renew_period_days: form.renew_period_days,
  renew_price_amount: Math.round((form.renew_price_yuan || 0) * 100),
  renew_currency: 'CNY',
};
```

And on load, yuan = amount / 100.

- [ ] **Step 4: build 验证**

```bash
cd web && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add web/src/components/platform/PlatformTenantsPanel.jsx
git commit -m "feat(web): add renewal pricing fields to platform tenants plan edit"
```

---

## Task 19：/console/tenant-payment OrderList Tab

**Files:**
- Create: `web/src/pages/TenantPayment/OrderList.jsx`
- Modify: `web/src/pages/TenantPayment/index.jsx` (enable the "订单" tab)

- [ ] **Step 1: 创建 OrderList 组件**

```jsx
import React, { useEffect, useState } from 'react';
import { Card, Table, Tag, Select, Space, Typography } from '@douyinfe/semi-ui';
import { listTenantPaymentOrders } from '../../helpers/payment';

const { Title } = Typography;

const statusColor = {
  pending: 'grey',
  paid: 'green',
  partial_refunded: 'orange',
  fully_refunded: 'red',
  closed: 'grey',
  expired: 'grey',
};

export default function OrderList() {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [orderType, setOrderType] = useState('');
  const [status, setStatus] = useState('');
  const pageSize = 20;

  const load = async () => {
    setLoading(true);
    try {
      const params = { page, page_size: pageSize };
      if (orderType) params.order_type = orderType;
      if (status) params.status = status;
      const res = await listTenantPaymentOrders(params);
      const d = res?.data || {};
      setRows(d.items || []);
      setTotal(d.total || 0);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [page, orderType, status]);

  const columns = [
    { title: '订单号', dataIndex: 'out_trade_no', width: 260, render: (v) => <code>{v}</code> },
    { title: '类型', dataIndex: 'order_type', width: 80,
      render: (v) => <Tag color={v === 'topup' ? 'blue' : 'purple'}>{v}</Tag> },
    { title: '金额（分）', dataIndex: 'amount', width: 100, render: (v) => v.toLocaleString() },
    { title: '已退', dataIndex: 'refunded_amount', width: 100, render: (v) => v || '-' },
    { title: '状态', dataIndex: 'status', width: 140,
      render: (v) => <Tag color={statusColor[v] || 'grey'}>{v}</Tag> },
    { title: '支付时间', dataIndex: 'paid_at', width: 160,
      render: (v) => v ? new Date(v * 1000).toLocaleString() : '-' },
    { title: '创建时间', dataIndex: 'created_at', width: 160,
      render: (v) => new Date(v * 1000).toLocaleString() },
  ];

  return (
    <Card>
      <Title heading={5} style={{ marginBottom: 16 }}>支付订单</Title>
      <Space style={{ marginBottom: 16 }}>
        <Select value={orderType} onChange={setOrderType} placeholder="类型筛选" style={{ width: 160 }}>
          <Select.Option value="">全部</Select.Option>
          <Select.Option value="topup">充值</Select.Option>
          <Select.Option value="sub">续期</Select.Option>
        </Select>
        <Select value={status} onChange={setStatus} placeholder="状态筛选" style={{ width: 180 }}>
          <Select.Option value="">全部</Select.Option>
          <Select.Option value="pending">待支付</Select.Option>
          <Select.Option value="paid">已支付</Select.Option>
          <Select.Option value="partial_refunded">部分退款</Select.Option>
          <Select.Option value="fully_refunded">全额退款</Select.Option>
          <Select.Option value="closed">已关闭</Select.Option>
          <Select.Option value="expired">已过期</Select.Option>
        </Select>
      </Space>
      <Table
        columns={columns}
        dataSource={rows}
        loading={loading}
        rowKey="id"
        pagination={{
          currentPage: page,
          pageSize,
          total,
          onPageChange: setPage,
        }}
      />
    </Card>
  );
}
```

- [ ] **Step 2: 启用 Orders tab**

Edit `web/src/pages/TenantPayment/index.jsx`: the "订单（S2 提供）" TabPane currently has `disabled`. Replace:

```jsx
<TabPane tab="订单" itemKey="orders">
  <OrderList />
</TabPane>
```

And add the import:

```jsx
import OrderList from './OrderList';
```

- [ ] **Step 3: build 验证**

```bash
cd web && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/TenantPayment/OrderList.jsx web/src/pages/TenantPayment/index.jsx
git commit -m "feat(web): tenant payment orders tab with filters + pagination"
```

---

## Task 20：WechatPayModal — 通用扫码弹窗组件

**Files:**
- Create: `web/src/components/payment/WechatPayModal.jsx`

- [ ] **Step 1: 创建组件**

```jsx
import React, { useEffect, useState, useRef } from 'react';
import { Modal, Typography, Toast, Spin } from '@douyinfe/semi-ui';
import { QRCodeCanvas } from 'qrcode.react';
import { getPaymentOrder } from '../../helpers/payment';

const { Text, Title } = Typography;

// WechatPayModal opens a modal with the WeChat Pay Native QR and polls
// /api/payment/orders/:out_trade_no every 3 seconds until status !=
// 'pending' or the modal is closed.
//
// Props:
//   visible, onClose, codeUrl, outTradeNo, amountCents, onSuccess (optional),
//   title (optional)
export default function WechatPayModal({
  visible, onClose, codeUrl, outTradeNo, amountCents, title = '微信支付', onSuccess,
}) {
  const [status, setStatus] = useState('pending');
  const pollRef = useRef(null);

  useEffect(() => {
    if (!visible || !outTradeNo) return undefined;
    setStatus('pending');
    pollRef.current = setInterval(async () => {
      try {
        const res = await getPaymentOrder(outTradeNo);
        const s = res?.data?.status;
        if (!s) return;
        setStatus(s);
        if (s !== 'pending') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          if (s === 'paid' || s === 'partial_refunded' || s === 'fully_refunded') {
            Toast.success('支付成功');
            if (onSuccess) onSuccess();
            onClose?.();
          } else if (s === 'closed' || s === 'expired') {
            Toast.info(`订单已${s === 'expired' ? '过期' : '关闭'}`);
            onClose?.();
          }
        }
      } catch (_) { /* transient — next tick retries */ }
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [visible, outTradeNo, onClose, onSuccess]);

  return (
    <Modal
      title={title}
      visible={visible}
      onCancel={onClose}
      footer={null}
      width={360}
    >
      <div style={{ textAlign: 'center', padding: '16px 0' }}>
        {codeUrl ? (
          <QRCodeCanvas value={codeUrl} size={240} />
        ) : (
          <Spin />
        )}
        <div style={{ marginTop: 16 }}>
          <Text>{`订单号: ${outTradeNo || '-'}`}</Text>
        </div>
        <div>
          <Text>{`金额: ¥${((amountCents || 0) / 100).toFixed(2)}`}</Text>
        </div>
        <div style={{ marginTop: 12 }}>
          <Text type="tertiary">
            {status === 'pending' ? '请使用微信扫码支付...' : `状态: ${status}`}
          </Text>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: 确认 qrcode.react 已在依赖**

```bash
grep "qrcode.react" web/package.json
```

Should show `"qrcode.react": "^4.2.0"`. Good.

- [ ] **Step 3: Commit**

```bash
mkdir -p web/src/components/payment
git add web/src/components/payment/WechatPayModal.jsx
git commit -m "$(cat <<'EOF'
feat(web): WechatPayModal (Native QR + 3s status polling)

Reusable modal consumed by both /console/topup (topup) and
/console/tenant-plan (renewal). Props: codeUrl, outTradeNo,
amountCents, onSuccess. Polls /api/payment/orders/:out_trade_no
every 3s; terminal statuses close the modal with a Toast.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 21：/console/topup 加微信支付入口

**Files:**
- Modify: `web/src/pages/TopUp/index.js` (or whatever the topup page component is — grep first)

- [ ] **Step 1: 定位**

```bash
grep -rn "payment_method\|stripe\|creem\|waffo" web/src/pages/TopUp/ | head -10
```

Find the `case 'stripe':` / `case 'creem':` / `case 'waffo':` branches in the submit handler or the button group.

- [ ] **Step 2: 加一个 'wechat' 分支**

In the place-order handler:

```js
case 'wechat': {
  const { createWechatTopup } = await import('../../helpers/payment');
  const res = await createWechatTopup('native', { amount: amountToBuy });
  if (!res?.success) {
    Toast.error(res?.message || '下单失败');
    return;
  }
  const env = res.data;
  setWechatModal({
    visible: true,
    codeUrl: env.response.code_url,
    outTradeNo: env.order.out_trade_no,
    amountCents: env.order.amount,
  });
  break;
}
```

Add a button in the payment method selector that matches the existing stripe/creem/waffo button pattern, with `value: 'wechat'`, label `微信支付`, an icon (lucide-react `Wallet` or existing wechat icon).

Mount `<WechatPayModal {...wechatModal} onClose={() => setWechatModal({visible:false})} onSuccess={refreshBalance} />` at the component root.

- [ ] **Step 3: build**

```bash
cd web && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/TopUp/
git commit -m "feat(web): add WeChat payment option to /console/topup"
```

---

## Task 22：/console/tenant-plan 加续期按钮

**Files:**
- Modify: `web/src/components/tenant/plan/TenantPlanCard.jsx` (or similar — grep)

- [ ] **Step 1: 定位**

```bash
grep -n "expires_at\|GracePeriod\|plan" web/src/components/tenant/plan/*.jsx | head
```

- [ ] **Step 2: 加"续期"按钮**

Import `createWechatSub` + `WechatPayModal`. Add a button that calls:

```jsx
const handleRenew = async () => {
  const res = await createWechatSub('native', {});
  if (!res?.success) {
    Toast.error(res?.message || '续期下单失败');
    return;
  }
  const env = res.data;
  setWechatModal({
    visible: true,
    codeUrl: env.response.code_url,
    outTradeNo: env.order.out_trade_no,
    amountCents: env.order.amount,
  });
};
```

Button disabled condition: `plan.renew_price_amount <= 0` (show tooltip "请联系平台管理员配置续期价格").

Modal onSuccess reload plan info.

- [ ] **Step 3: build**

```bash
cd web && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add web/src/components/tenant/plan/
git commit -m "feat(web): add renewal button to tenant plan card"
```

---

## Task 23：端到端手工验证 — topup

**Files:** 无代码改动

- [ ] **Step 1: 前置**

Platform admin 确保以下配置:
1. 当前租户在 `/console/tenant-payment` 已配好真实商户号，`last_test_ok=true`
2. 当前登录用户有足够的充值额度（小额 1 quota = 0.01 元测试即可）

- [ ] **Step 2: 启动**

```bash
cd D:/top/keyapi && go run . &
cd D:/top/keyapi/web && npm run dev
```

- [ ] **Step 3: 跑流程**

1. 访问 `/console/topup`
2. 选择 1 quota（最小金额）
3. 点"微信支付"
4. 弹出 QR → 用微信扫码支付 0.01 元
5. 3 秒内 UI 自动切换到"支付成功"
6. 查 `/console/tenant-payment` → 订单 tab：看到 status=paid 的订单
7. 查 `top_ups` 表：对应 trade_no 和 payment_method=wxpay
8. 查 `users.quota`：余额 +1

SQL 验证：
```sql
SELECT * FROM payment_orders ORDER BY id DESC LIMIT 3;
SELECT * FROM top_ups ORDER BY id DESC LIMIT 3;
SELECT id, username, tenant_id, quota FROM users WHERE id = <test_user_id>;
```

- [ ] **Step 4: 验证回调幂等**

用同一个 out_trade_no 手工再触发一次 ApplyPaymentSuccess（通过 `QueryOrder` 或 curl 模拟回调），确认 quota 没有重复加。

- [ ] **Step 5: 记录结果，不 commit**

---

## Task 24：端到端手工验证 — 续期

**Files:** 无代码改动

- [ ] **Step 1: Platform admin 设置价格**

```sql
-- 或通过 /console/platform-tenants UI
UPDATE tenant_plans SET renew_price_amount = 1 WHERE tenant_id = <test_tid>; -- 0.01 元
```

- [ ] **Step 2: 手动把 plan 设到即将过期 + disabled 状态**

```sql
UPDATE tenant_plans
   SET expires_at = EXTRACT(EPOCH FROM NOW())::bigint - 86400, -- 昨天过期
       status = 0  -- disabled
 WHERE tenant_id = <test_tid>;
```

然后确认 `/api/relay/*` 被拒服务（说明 CheckTenantQuota 正确拒绝）。

- [ ] **Step 3: 续期**

访问 `/console/tenant-plan` → 点"续期" → 扫码 0.01 元支付

- [ ] **Step 4: 验证**

```sql
SELECT status, expires_at,
       TO_TIMESTAMP(expires_at) AS expires_readable
  FROM tenant_plans WHERE tenant_id = <test_tid>;
```

期望：
- `status = 1` (Active，已恢复)
- `expires_at` 比当前时间晚约 30 天

回到业务 API 调用，恢复服务。

- [ ] **Step 5: 记录结果，不 commit**

---

## Task 25：更新 completion-status 文档

**Files:**
- Modify: `docs/superpowers/plans/2026-04-16-completion-status.md`

- [ ] **Step 1: 在 Phase 5 章节 S1 段落之后追加 S2 交付记录**

```markdown
### 已完成（续 — WeChat Pay S2: 下单+回调+业务联动，commits `<S2 first sha>` → `<S2 last sha>`，YYYY-MM-DD）
- `payment_orders` 模型（含 RefundedAmount 累计字段 + 状态机 pending/paid/partial_refunded/fully_refunded/closed/expired）+ `BuildOutTradeNo` / `ValidateOutTradeNoRoute` / `MarkOrderPaid`（tx + idempotent）
- Provider 接口扩展：`CreateOrder` / `VerifyAndParseNotify` / `QueryOrder`
- wechat/native.go + h5.go + jsapi.go（含 JSAPI 签名）+ notify.go（signature verify + AES-GCM decrypt）
- `service/payment/order.go` `CreateTopupOrder` / `CreateSubOrder` / `ApplyPaymentSuccess`（事务 + 幂等 + 业务分发）
- topup 业务：`IncreaseUserQuota` 用 home tenant（`GetUserTenantId`）+ `top_ups` 写会话 tenant + `PaymentMethod="wxpay"` 兼容发票
- sub 业务：延长 `ExpiresAt`（若 plan 已过期则从 now 开始延）+ 显式 `Status=Active` 恢复（spec §11.4）
- 5 下单 endpoint + 1 回调 endpoint + 2 查询 endpoint
- `TenantPlan` 加 `RenewPeriodDays` / `RenewPriceAmount` / `RenewCurrency`；`UpdateTenantPlanRequest` 扩展；`/console/platform-tenants` 定价 UI
- 前端：`WechatPayModal`（QR + 3s 轮询）+ `/console/topup` 微信支付入口 + `/console/tenant-plan` 续期按钮 + `/console/tenant-payment` 订单 Tab
- 端到端验证：真实商户号 0.01 元 topup 全通；续期流程从 disabled 恢复 active
```

- [ ] **Step 2: 把"未完成"部分标记 S2 已 resolve**

Change `- 套餐续费/升级/降级的支付闭环（依赖外部支付集成）` to:

```markdown
- 套餐**升降级** + proration（`PlanTemplate` / SKU — v2 scope，非 S3）
- S3（退款 + 缺单补偿 + 续期告警）
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-04-16-completion-status.md
git commit -m "docs: mark WeChat Pay S2 (ordering + callback) complete"
```

---

## S2 完成后

S2 完成后，基于实施反馈出 **S3 plan**（退款 + 缺单补偿 + 续期告警）。典型规模 15-20 task。
