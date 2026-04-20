# Topup Quota Delta Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复充值回调在 CNY / CUSTOM 展示模式下 quota 计算错误的 bug（当前：用户付 1 元实得 ¥7.30 价值额度），并补齐 CUSTOM 模式后台收费路径与前端预估一致的汇率归一化契约。

**Architecture:** 引入一个权威的 `quota_delta` 字段（`payment_orders.Metadata.quota_delta` + 新增列 `top_ups.raw_quota`），在下单/充值请求入口用 `decimal` 精确计算，回调 / 补单路径优先读这个字段，读不到再退回 legacy `amount × QuotaPerUnit`。一个共享 helper `operation_setting.ComputeTopupQuotaDelta` 封装 4 种展示模式（USD / CNY / TOKENS / CUSTOM）的 quota 归一化逻辑；同时补一处 backend pricing parity：`controller/payment/topup.go:getPayMoney` 在 CUSTOM 模式下也按 `amount / CustomCurrencyExchangeRate` 转回 USD 后再乘 `Price`，确保“收费金额”和“到账额度”来自同一份汇率语义，而不是收费走旧契约、到账走新契约。

**Tech Stack:** Go 1.25、GORM（AutoMigrate）、`github.com/shopspring/decimal`、Gin、已有 `service/payment` + `controller/payment` 分层。

**关联文档:**
- 根因分析：会话中 `controller/payment/wechat.go:47 resolveTopupPrice` 与 `service/payment/order.go:267 applyTopupSuccess` 的契约不一致
- Schema version：`model/setup.go` 当前 `2026-04-20.01`，本 plan 会 bump 到 `2026-04-20.02`

---

## 背景：Bug 本质

`amountUnits` 的隐式契约是"USD 等价展示单位"，但 `resolveTopupPrice`（wechat）/ `RequestEpay`（epay）只在 TOKENS 模式做了归一化（`amount / QuotaPerUnit`），**CNY / CUSTOM 模式下把原始 amount 直接透传**，下游 `quota = amount × QuotaPerUnit` 放大到了 `USDExchangeRate` 倍。

具体复现：
- Display type = CNY，Price = 1，用户点 "¥10" 预设
- `amountUnits = 10`（CNY 模式未归一）
- `quotaToAdd = 10 × 500000 = 5,000,000`（= 10 USD worth）
- 实际应 credit：`10 / 7.3 × 500000 ≈ 684,931`（= 10 CNY worth ≈ 1.37 USD）
- **用户付 ¥10 得 ¥73 价值额度，多得 ~7.3 倍**

CUSTOM 模式同理。并且 CUSTOM 还有一个额外问题：`web-next/src/components/topup/RechargeCard.tsx:68-79 estimateCny` 已经按 `custom_currency_exchange_rate` 预估扫码金额，但后端 `controller/payment/topup.go:155-182 getPayMoney` 目前仍把 CUSTOM 的 `amount` 直接当作 USD/CNY-style amount。**如果只修 quota、不修收费路径，就会变成“到账按新契约、收费按旧契约”的新偏差。**

USD / TOKENS 模式当前是对的。

## 不变量（重构后）

对任何模式、任何金额：
```
quota_delta = usd_equivalent × QuotaPerUnit
            = (raw_display_amount / unit_to_usd_divisor) × QuotaPerUnit
```

`unit_to_usd_divisor` 表：

| 展示模式 | divisor | 依据 |
|---|---|---|
| USD    | `1`                           | amount 本身是 USD |
| CNY    | `USDExchangeRate`             | amount 是 CNY，除以汇率 |
| TOKENS | `QuotaPerUnit`                | amount 是 token 数，除以 quota/USD |
| CUSTOM | `CustomCurrencyExchangeRate`  | amount 是自定义币，除以自定义币/USD |

**`groupRatio` / `discount` 不进 quota**：它们只影响 payMoney（促销价），不改变应得额度。现有行为保留。

**CUSTOM 的额外不变量：charge path 与 quota path 必须同源。**

对 CUSTOM 模式：
```text
usd_equivalent = raw_custom_amount / CustomCurrencyExchangeRate
quota_delta    = usd_equivalent × QuotaPerUnit
payMoney(CNY)  = usd_equivalent × Price × groupRatio × discount
```

也就是说，CUSTOM 只有在 `quota_delta` 和 backend `getPayMoney` 都基于同一份 `usd_equivalent` 时才算真正修好。

## 设计决策

**Y. 显式 `quota_delta` + 新增列 + 回退兜底**（见会话中方案对比）：
- 新列 `top_ups.raw_quota BIGINT NOT NULL DEFAULT 0` —— 权威值
- `payment_orders.Metadata` 新增 JSON key `quota_delta` —— 权威值
- 回调 / 补单路径：**优先读权威值**，`raw_quota == 0` 或 metadata 无 `quota_delta` 时退回 `amount × QuotaPerUnit`（保护 in-flight 老订单 + 历史数据不破）
- 全程用 `decimal.Decimal` 算，只在落库时 `IntPart()`，避免 int64 精度丢失
- CUSTOM 额外补齐一处 backend pricing parity：`getPayMoney` 必须和 web-next 的 `estimateCny` 一样，先把自定义币金额除以 `CustomCurrencyExchangeRate` 再乘 `Price`；否则 Task 9 的 CUSTOM 验证不会成立

**修复范围**：
- ✅ wechat 充值回调 `applyTopupSuccess`（service/payment/order.go）
- ✅ epay 充值回调 `EpayNotify`（controller/payment/topup.go）
- ✅ 管理员手动补单 `ManualCompleteTopUp`（model/topup.go，epay/wechat 分支）
- ✅ CUSTOM backend charge path `getPayMoney`（controller/payment/topup.go）与前端预估对齐

**不在本 plan 范围**（语义不同或低优先级，单独立 issue）：
- Stripe 路径（`model/topup.go:Recharge` 用 `Money × QuotaPerUnit`，有另外的 discount 问题）
- Creem 路径（`Amount` 就是 raw quota，语义已经不同）
- Waffo 路径（`RechargeWaffo` 用同样的旧公式，低频渠道）
- 前端已在上轮修好，本 plan 不动前端

## 文件结构

**Create:**
- `controller/payment/topup_paymoney_test.go` — 锁定 CUSTOM 模式 payMoney 归一化契约
- `setting/operation_setting/topup_quota.go` — 共享 helper `ComputeTopupQuotaDelta`
- `setting/operation_setting/topup_quota_test.go` — 表驱动单测

**Modify:**
- `model/topup.go` — `TopUp` 结构体 + `Amount`-based 的 credit 公式
- `model/setup.go` — schema version bump
- `service/payment/order.go` — `CreateTopupOrderInput` / metadata / `applyTopupSuccess`
- `controller/payment/wechat.go` — `resolveTopupPrice` 多返回 `quotaDelta`
- `controller/payment/topup.go` — `getPayMoney`（CUSTOM 归一化）+ `RequestEpay`（写 raw_quota）+ `EpayNotify`（读 raw_quota）

**Test:**
- `controller/payment/topup_paymoney_test.go`（上面）
- `setting/operation_setting/topup_quota_test.go`（上面）
- `service/payment/order_quota_test.go` —— 新增，覆盖 `applyTopupSuccess` metadata 分支

---

## Task 0：先锁定 CUSTOM 收费路径契约

**Files:**
- Create: `controller/payment/topup_paymoney_test.go`
- Modify: `controller/payment/topup.go:155-182`（`getPayMoney`）

- [ ] **Step 1: 先写失败测试**

创建 `controller/payment/topup_paymoney_test.go`：

```go
package payment

import (
	"math"
	"testing"

	"github.com/QuantumNous/new-api/setting/operation_setting"
)

func TestGetPayMoney_CustomDisplayUsesExchangeRate(t *testing.T) {
	gs := operation_setting.GetGeneralSetting()
	ps := operation_setting.GetPaymentSetting()
	origDisplay := gs.QuotaDisplayType
	origRate := gs.CustomCurrencyExchangeRate
	origPrice := operation_setting.Price
	origDiscount := ps.AmountDiscount
	defer func() {
		gs.QuotaDisplayType = origDisplay
		gs.CustomCurrencyExchangeRate = origRate
		operation_setting.Price = origPrice
		ps.AmountDiscount = origDiscount
	}()

	gs.QuotaDisplayType = operation_setting.QuotaDisplayTypeCustom
	gs.CustomCurrencyExchangeRate = 0.9 // 1 USD = 0.9 EUR
	operation_setting.Price = 7.3       // 1 USD = 7.3 CNY
	ps.AmountDiscount = map[int]float64{}

	got := getPayMoney(5, "")
	want := 5.0 / 0.9 * 7.3
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("CUSTOM amount=5: got %.12f, want %.12f", got, want)
	}
}

func TestGetPayMoney_CustomDisplayZeroRateReturnsZero(t *testing.T) {
	gs := operation_setting.GetGeneralSetting()
	origDisplay := gs.QuotaDisplayType
	origRate := gs.CustomCurrencyExchangeRate
	origPrice := operation_setting.Price
	defer func() {
		gs.QuotaDisplayType = origDisplay
		gs.CustomCurrencyExchangeRate = origRate
		operation_setting.Price = origPrice
	}()

	gs.QuotaDisplayType = operation_setting.QuotaDisplayTypeCustom
	gs.CustomCurrencyExchangeRate = 0
	operation_setting.Price = 7.3

	if got := getPayMoney(5, ""); got != 0 {
		t.Fatalf("CUSTOM/rate=0: got %.12f, want 0", got)
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
go test ./controller/payment -run TestGetPayMoney_CustomDisplay -v
```

Expected: FAIL，当前实现会把 `5` 直接按 `5 × Price = 36.5` 算，而不是 `5 / 0.9 × 7.3 ≈ 40.56`

- [ ] **Step 3: 修改 `getPayMoney`，让 backend 与前端 CUSTOM 预估对齐**

修改 `controller/payment/topup.go:155-182` 的 `getPayMoney`：

```go
func getPayMoney(amount int64, group string) float64 {
	dAmount := decimal.NewFromInt(amount)
	// 充值金额以“展示类型”为准：
	// - USD/CNY: 前端传 amount 为金额单位
	// - TOKENS: 前端传 tokens，需要换成 USD 金额
	// - CUSTOM: 前端传自定义币，需要先按 custom rate 换成 USD，再乘 Price 得到 CNY
	switch operation_setting.GetQuotaDisplayType() {
	case operation_setting.QuotaDisplayTypeTokens:
		dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
		dAmount = dAmount.Div(dQuotaPerUnit)
	case operation_setting.QuotaDisplayTypeCustom:
		rate := operation_setting.GetGeneralSetting().CustomCurrencyExchangeRate
		if rate <= 0 {
			return 0
		}
		dAmount = dAmount.Div(decimal.NewFromFloat(rate))
	}

	topupGroupRatio := common.GetTopupGroupRatio(group)
	if topupGroupRatio == 0 {
		topupGroupRatio = 1
	}

	dTopupGroupRatio := decimal.NewFromFloat(topupGroupRatio)
	dPrice := decimal.NewFromFloat(operation_setting.Price)
	discount := 1.0
	if ds, ok := operation_setting.GetPaymentSetting().AmountDiscount[int(amount)]; ok {
		if ds > 0 {
			discount = ds
		}
	}
	dDiscount := decimal.NewFromFloat(discount)

	payMoney := dAmount.Mul(dPrice).Mul(dTopupGroupRatio).Mul(dDiscount)
	return payMoney.InexactFloat64()
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
go test ./controller/payment -run TestGetPayMoney_CustomDisplay -v
```

Expected: PASS。CUSTOM 的扫码金额现在和 web-next `estimateCny` 一致

- [ ] **Step 5: Commit**

```bash
git add controller/payment/topup.go controller/payment/topup_paymoney_test.go
cat <<'EOF' | git commit -F -
Align CUSTOM topup pricing with the frontend exchange-rate contract

The frontend already previews CUSTOM topups as custom_amount divided by
CustomCurrencyExchangeRate and then multiplied by Price. The backend
must charge from the same USD-equivalent base before quota_delta can be
trusted as the authoritative credited amount.

Constraint: Existing USD/CNY/TOKENS pricing behavior must remain unchanged
Rejected: Fix quota only and keep CUSTOM charging on the old path | would create a new charge/credit mismatch
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep CUSTOM charge-path and quota-path normalization rules in lockstep
Tested: go test ./controller/payment -run TestGetPayMoney_CustomDisplay -v
Not-tested: Full provider callback integration
EOF
```

---

## Task 1：引入共享 helper `ComputeTopupQuotaDelta`

**Files:**
- Create: `setting/operation_setting/topup_quota.go`
- Create: `setting/operation_setting/topup_quota_test.go`

- [ ] **Step 1: 先写失败测试**

写到 `setting/operation_setting/topup_quota_test.go`：

```go
package operation_setting

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
)

// Test covers the unit_to_usd_divisor table in the plan. The function
// must preserve precision via decimal arithmetic; any int64 intermediate
// would lose >30% on CNY mode and break this table.
func TestComputeTopupQuotaDelta(t *testing.T) {
	// Snapshot + restore globals touched by the function.
	origDisplay := generalSetting.QuotaDisplayType
	origCustomRate := generalSetting.CustomCurrencyExchangeRate
	origUsdRate := USDExchangeRate
	origQPU := common.QuotaPerUnit
	defer func() {
		generalSetting.QuotaDisplayType = origDisplay
		generalSetting.CustomCurrencyExchangeRate = origCustomRate
		USDExchangeRate = origUsdRate
		common.QuotaPerUnit = origQPU
	}()

	common.QuotaPerUnit = 500_000
	USDExchangeRate = 7.3
	generalSetting.CustomCurrencyExchangeRate = 0.9 // 1 USD = 0.9 EUR (example)

	cases := []struct {
		name     string
		mode     string
		amount   int64
		expected int64
	}{
		{"USD / $1 -> 500k quota", QuotaDisplayTypeUSD, 1, 500_000},
		{"USD / $10 -> 5M quota", QuotaDisplayTypeUSD, 10, 5_000_000},

		// 10 CNY / 7.3 = 1.3698630... USD -> 684,931 raw quota (truncated)
		{"CNY / ¥10 -> 684,931 quota", QuotaDisplayTypeCNY, 10, 684_931},
		{"CNY / ¥1 -> 68,493 quota", QuotaDisplayTypeCNY, 1, 68_493},
		{"CNY / ¥73 -> ~5M quota", QuotaDisplayTypeCNY, 73, 5_000_000},

		// TOKENS: amount is raw tokens; divide by QuotaPerUnit to get USD
		// equivalent, then multiply back. Round-trip = amount itself.
		{"TOKENS / 500k -> 500k quota", QuotaDisplayTypeTokens, 500_000, 500_000},
		{"TOKENS / 1M -> 1M quota", QuotaDisplayTypeTokens, 1_000_000, 1_000_000},

		// CUSTOM: amount is custom unit; divisor = CustomCurrencyExchangeRate.
		// 10 / 0.9 = 11.111 USD -> 5,555,555 raw quota.
		{"CUSTOM / 10 @ 0.9 -> 5,555,555", QuotaDisplayTypeCustom, 10, 5_555_555},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			generalSetting.QuotaDisplayType = tc.mode
			got := ComputeTopupQuotaDelta(tc.amount)
			if got != tc.expected {
				t.Fatalf("mode=%s amount=%d: got %d, want %d", tc.mode, tc.amount, got, tc.expected)
			}
		})
	}
}

// Edge: zero / negative amount must return 0 so callers fail fast rather
// than silently writing a negative delta.
func TestComputeTopupQuotaDelta_NonPositive(t *testing.T) {
	generalSetting.QuotaDisplayType = QuotaDisplayTypeUSD
	if got := ComputeTopupQuotaDelta(0); got != 0 {
		t.Fatalf("amount=0: got %d, want 0", got)
	}
	if got := ComputeTopupQuotaDelta(-5); got != 0 {
		t.Fatalf("amount=-5: got %d, want 0", got)
	}
}

// Edge: zero or invalid rate must not panic (div-by-zero); return 0.
func TestComputeTopupQuotaDelta_ZeroRate(t *testing.T) {
	origUsdRate := USDExchangeRate
	origCustomRate := generalSetting.CustomCurrencyExchangeRate
	defer func() {
		USDExchangeRate = origUsdRate
		generalSetting.CustomCurrencyExchangeRate = origCustomRate
	}()

	generalSetting.QuotaDisplayType = QuotaDisplayTypeCNY
	USDExchangeRate = 0
	if got := ComputeTopupQuotaDelta(10); got != 0 {
		t.Fatalf("CNY/rate=0: got %d, want 0", got)
	}

	generalSetting.QuotaDisplayType = QuotaDisplayTypeCustom
	generalSetting.CustomCurrencyExchangeRate = 0
	if got := ComputeTopupQuotaDelta(10); got != 0 {
		t.Fatalf("CUSTOM/rate=0: got %d, want 0", got)
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /d/top/keyapi
go test ./setting/operation_setting/... -run TestComputeTopupQuotaDelta -v
```

Expected: FAIL with `undefined: ComputeTopupQuotaDelta`

- [ ] **Step 3: 写实现**

创建 `setting/operation_setting/topup_quota.go`：

```go
package operation_setting

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
)

// ComputeTopupQuotaDelta converts the raw display-units amount a user
// requested at topup time into the authoritative raw quota integer that
// applyTopupSuccess / EpayNotify / ManualCompleteTopUp must credit.
//
// Invariant: quota_delta = (amount / unit_to_usd_divisor) × QuotaPerUnit,
// where the divisor depends on QuotaDisplayType:
//   USD    → 1                              (amount is already USD)
//   CNY    → USDExchangeRate                (CNY → USD)
//   TOKENS → QuotaPerUnit                   (tokens → USD)
//   CUSTOM → CustomCurrencyExchangeRate     (custom → USD)
//
// groupRatio and discount do NOT enter this computation — they only
// affect payMoney (promo price), never the quota a user is entitled to
// for that price.
//
// Returns 0 on non-positive amount or unreachable divisor (rate=0), so
// callers can fail fast without a div-by-zero panic.
func ComputeTopupQuotaDelta(amount int64) int64 {
	if amount <= 0 {
		return 0
	}
	divisor := decimal.NewFromInt(1)
	switch GetQuotaDisplayType() {
	case QuotaDisplayTypeUSD:
		// divisor = 1
	case QuotaDisplayTypeCNY:
		if USDExchangeRate <= 0 {
			return 0
		}
		divisor = decimal.NewFromFloat(USDExchangeRate)
	case QuotaDisplayTypeTokens:
		if common.QuotaPerUnit <= 0 {
			return 0
		}
		divisor = decimal.NewFromFloat(common.QuotaPerUnit)
	case QuotaDisplayTypeCustom:
		r := generalSetting.CustomCurrencyExchangeRate
		if r <= 0 {
			return 0
		}
		divisor = decimal.NewFromFloat(r)
	default:
		return 0
	}
	qpu := decimal.NewFromFloat(common.QuotaPerUnit)
	return decimal.NewFromInt(amount).Div(divisor).Mul(qpu).IntPart()
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
go test ./setting/operation_setting/... -run TestComputeTopupQuotaDelta -v
```

Expected: PASS 所有 case

- [ ] **Step 5: Commit**

```bash
git add setting/operation_setting/topup_quota.go setting/operation_setting/topup_quota_test.go
cat <<'EOF' | git commit -F -
Centralize authoritative topup quota normalization

ComputeTopupQuotaDelta becomes the single place that converts display-
unit topup amounts into raw quota. That removes the duplicated
amount × QuotaPerUnit assumption from downstream callback paths and
gives CNY/CUSTOM a shared, test-locked conversion contract.

Constraint: Legacy in-flight orders still need a fallback path after this helper lands
Rejected: Keep per-channel quota formulas inline | repeats the bug-prone conversion logic
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Any new topup entrypoint must derive credited quota from this helper or an explicitly equivalent contract
Tested: go test ./setting/operation_setting/... -run TestComputeTopupQuotaDelta -v
Not-tested: Provider callback integration
EOF
```

---

## Task 2：`top_ups` 新增 `raw_quota` 列 + schema bump

**Files:**
- Modify: `model/topup.go:15-36`（`TopUp` 结构体）
- Modify: `model/setup.go:7`（schema version）

- [ ] **Step 1: 给 TopUp 结构加字段**

在 `model/topup.go` 的 `TopUp struct` 末尾（line 35 `EpayNotifyPayload` 之后，line 36 `}` 之前）加一行：

```go
	// RawQuota is the authoritative raw quota to credit on success.
	// Written by topup request handlers using ComputeTopupQuotaDelta so
	// the value is correct across USD/CNY/TOKENS/CUSTOM modes. Readers
	// (EpayNotify, ManualCompleteTopUp, Recharge stripe path) MUST prefer
	// this over the legacy `Amount × QuotaPerUnit` formula when > 0;
	// fall back to legacy only when 0 (pre-migration rows / in-flight
	// orders saved before this column existed).
	RawQuota int64 `json:"raw_quota" gorm:"not null;default:0"`
```

- [ ] **Step 2: Bump schema 版本**

修改 `model/setup.go:7`：

```go
const CurrentSchemaVersion = "2026-04-20.02"
```

- [ ] **Step 3: 本地跑 go build 确认编译**

```bash
cd /d/top/keyapi
go build ./...
```

Expected: 无报错。

- [ ] **Step 4: 启动一次后端让 AutoMigrate 跑**

> 这一步只是本地验证。部署侧 AutoMigrate 由 `CurrentSchemaVersion` 门控，首次启动自动跑。

```bash
go run . 2>&1 | head -30
```

确认日志里有 `database migrated`。之后 Ctrl+C 停掉。

- [ ] **Step 5: Commit**

```bash
git add model/topup.go model/setup.go
cat <<'EOF' | git commit -F -
Persist authoritative raw quota on top-up rows

TopUp.RawQuota gives callback and manual-complete paths a durable source
of truth for credited quota instead of reconstructing it later from
display-unit amounts. The schema bump ensures AutoMigrate adds the
column before post-migration orders start writing it.

Constraint: Pre-migration rows must continue to load with RawQuota=0 and use legacy fallback
Rejected: Store authoritative quota only in payment_orders metadata | epay/admin flows also need a durable DB column
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Prefer RawQuota when present; only use Amount-based fallback for legacy rows
Tested: go build ./...
Not-tested: Live migration on a production-sized database
EOF
```

---

## Task 3：`service/payment.CreateTopupOrderInput` 扩展 + metadata

**Files:**
- Modify: `service/payment/order.go:27-37`（`CreateTopupOrderInput` struct）
- Modify: `service/payment/order.go:63-81`（`CreateTopupOrder` 函数）

- [ ] **Step 1: 给输入 struct 加 `QuotaDelta`**

修改 `service/payment/order.go:27-37`：

```go
type CreateTopupOrderInput struct {
	TenantId    int   // order.TenantId = session tenant (收款归属)
	UserId      int   // order.UserId = payer
	AmountCents int64 // CNY cents (what WeChat charges)
	AmountUnits int64 // top_ups.Amount value; see doc above
	// QuotaDelta is the authoritative raw quota to credit on success.
	// Computed by the controller via operation_setting.ComputeTopupQuotaDelta.
	// applyTopupSuccess prefers this over AmountUnits × QuotaPerUnit.
	QuotaDelta  int64
	ProductForm string
	Openid      string // jsapi only
	ClientIp    string // h5 only
	Description string // shown on WeChat UI
	NotifyUrl   string // absolute URL the provider calls on callback
}
```

- [ ] **Step 2: CreateTopupOrder 把 QuotaDelta 写进 metadata**

修改 `service/payment/order.go:63-81` 的 `CreateTopupOrder`：

```go
func CreateTopupOrder(ctx context.Context, in CreateTopupOrderInput) (*CreateOrderResponse, *model.PaymentOrder, error) {
	if in.TenantId <= 0 || in.UserId <= 0 || in.AmountCents <= 0 || in.AmountUnits <= 0 {
		return nil, nil, errors.New("invalid topup input")
	}
	if in.QuotaDelta <= 0 {
		return nil, nil, errors.New("invalid topup input: quota_delta required")
	}
	// Metadata key names match the applyTopupSuccess reader exactly.
	// amount_units kept for backward compat (legacy audit trail).
	meta, _ := json.Marshal(map[string]any{
		"amount_units": in.AmountUnits,
		"quota_delta":  in.QuotaDelta,
	})
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
```

- [ ] **Step 3: 跑编译确认**

```bash
go build ./...
```

Expected：会报 `controller/payment/wechat.go` 调用 `CreateTopupOrderInput{...}` 缺 `QuotaDelta`——下一个 Task 修。先暂不 commit，等 Task 4/5 一起。

---

## Task 4：`applyTopupSuccess` 优先读 `quota_delta`，写 `RawQuota`

**Files:**
- Modify: `service/payment/order.go:271-290`（metadata 解析）
- Modify: `service/payment/order.go:322-336`（TopUp 插入）
- Create: `service/payment/order_quota_test.go`

- [ ] **Step 1: 写失败的单测**

创建 `service/payment/order_quota_test.go`：

```go
package payment

import (
	"encoding/json"
	"testing"
)

// resolveQuotaDelta encapsulates the authoritative-first read contract
// applyTopupSuccess uses. Pulled out for testability so callers don't
// need a live DB / tx to verify the fallback logic.
func resolveQuotaDelta(rawMetadata string, quotaPerUnit float64) (int64, error) {
	return readQuotaDeltaFromMetadata(rawMetadata, quotaPerUnit)
}

func TestResolveQuotaDelta_PrefersNewKey(t *testing.T) {
	meta, _ := json.Marshal(map[string]any{
		"amount_units": int64(1),       // legacy says 500,000
		"quota_delta":  int64(684_931), // authoritative (CNY ¥10)
	})
	got, err := resolveQuotaDelta(string(meta), 500_000)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != 684_931 {
		t.Fatalf("got %d, want 684,931 (authoritative key)", got)
	}
}

func TestResolveQuotaDelta_LegacyFallback(t *testing.T) {
	// Old order written before this migration — only amount_units present.
	meta, _ := json.Marshal(map[string]any{"amount_units": int64(2)})
	got, err := resolveQuotaDelta(string(meta), 500_000)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != 1_000_000 {
		t.Fatalf("got %d, want 1,000,000 (fallback amount_units × qpu)", got)
	}
}

func TestResolveQuotaDelta_InvalidMetadata(t *testing.T) {
	if _, err := resolveQuotaDelta("not-json", 500_000); err == nil {
		t.Fatal("expected error on invalid JSON")
	}
	if _, err := resolveQuotaDelta(`{"amount_units":0}`, 500_000); err == nil {
		t.Fatal("expected error when neither key yields a positive value")
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
go test ./service/payment/... -run TestResolveQuotaDelta -v
```

Expected: FAIL `undefined: readQuotaDeltaFromMetadata`

- [ ] **Step 3: 抽取 helper + 改 applyTopupSuccess**

修改 `service/payment/order.go`。先在文件内（推荐放 `applyTopupSuccess` 上方）加 helper：

```go
// readQuotaDeltaFromMetadata enforces the authoritative-first contract:
//   - If metadata has quota_delta > 0, use it as-is (post-migration orders).
//   - Else fall back to amount_units × QuotaPerUnit (pre-migration / in-flight).
// Returns an error only if BOTH paths yield non-positive values or JSON is
// malformed — caller should refuse to credit on error, never default to 0.
func readQuotaDeltaFromMetadata(rawMetadata string, quotaPerUnit float64) (int64, error) {
	var meta struct {
		AmountUnits int64 `json:"amount_units"`
		QuotaDelta  int64 `json:"quota_delta"`
	}
	if rawMetadata == "" {
		return 0, fmt.Errorf("empty metadata")
	}
	if err := json.Unmarshal([]byte(rawMetadata), &meta); err != nil {
		return 0, fmt.Errorf("parse topup metadata: %w", err)
	}
	if meta.QuotaDelta > 0 {
		return meta.QuotaDelta, nil
	}
	if meta.AmountUnits <= 0 {
		return 0, fmt.Errorf("neither quota_delta nor amount_units set")
	}
	qpu := decimal.NewFromFloat(quotaPerUnit)
	delta := decimal.NewFromInt(meta.AmountUnits).Mul(qpu).IntPart()
	if delta <= 0 {
		return 0, fmt.Errorf("legacy fallback computed non-positive delta")
	}
	return delta, nil
}
```

替换 `applyTopupSuccess` 里的 metadata 解析与 quotaToAdd 计算（line 271-290）：

```go
	// Resolve raw quota to credit. Authoritative source is metadata.quota_delta
	// (written by CreateTopupOrder). Falls back to amount_units × QuotaPerUnit
	// for orders created before the quota_delta column shipped.
	quotaToAdd, err := readQuotaDeltaFromMetadata(order.Metadata, common.QuotaPerUnit)
	if err != nil {
		return fmt.Errorf("resolve quota delta for order %d: %w", order.Id, err)
	}
```

TopUp 行插入也要带 `RawQuota`。替换 line 322-336（`topup := &model.TopUp{...}` 块）：

```go
	// Also read amount_units from metadata for top_ups.Amount (legacy
	// display-units semantics; invoice UI still uses this column).
	var meta struct {
		AmountUnits int64 `json:"amount_units"`
	}
	_ = json.Unmarshal([]byte(order.Metadata), &meta)

	topup := &model.TopUp{
		TenantId:      order.TenantId,
		UserId:        order.UserId,
		Amount:        meta.AmountUnits,
		RawQuota:      quotaToAdd, // authoritative; preferred over Amount × QuotaPerUnit
		Money:         float64(order.Amount) / 100.0, // CNY yuan
		TradeNo:       order.OutTradeNo,
		PaymentMethod: "wxpay",
		Status:        "success",
		CreateTime:    order.CreatedAt,
		CompleteTime:  order.PaidAt,
	}
```

- [ ] **Step 4: 跑新旧测试全部通过**

```bash
go test ./service/payment/... -v
```

Expected: TestResolveQuotaDelta_* 全 PASS，其它原有测试不退化。

- [ ] **Step 5: Commit**

```bash
git add service/payment/order.go service/payment/order_quota_test.go
cat <<'EOF' | git commit -F -
Credit completed topups from authoritative quota metadata

applyTopupSuccess now prefers metadata.quota_delta and only falls back
to amount_units × QuotaPerUnit for pre-migration or in-flight orders.
The resolved value is also persisted to top_ups.raw_quota so later
readers do not need to re-derive it.

Constraint: Old pending orders created before metadata.quota_delta exists must still succeed
Rejected: Default missing metadata to zero and continue | would silently drop quota on malformed orders
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep metadata reader strict; malformed topup metadata should fail loudly rather than minting quota
Tested: go test ./service/payment/... -v
Not-tested: Cross-version replay of old provider callbacks
EOF
```

---

## Task 5：`resolveTopupPrice` 返回 `quotaDelta`

**Files:**
- Modify: `controller/payment/wechat.go:47-76`（`resolveTopupPrice` 签名 + 返回）
- Modify: `controller/payment/wechat.go:102-166`（`createTopupHandler` 使用返回值）

- [ ] **Step 1: 改签名**

修改 `controller/payment/wechat.go:47`：

```go
func resolveTopupPrice(c *gin.Context, amount int64) (amountCents int64, amountUnits int64, quotaDelta int64, err error) {
```

在 `resolveTopupPrice` 末尾（line 74 `return` 之前）加入 quotaDelta 计算：

```go
	quotaDelta = operation_setting.ComputeTopupQuotaDelta(amount)
	if quotaDelta <= 0 {
		return 0, 0, 0, errors.New("无法计算充值额度（检查 QuotaDisplayType / USDExchangeRate / CustomCurrencyExchangeRate 配置）")
	}
	return
```

更新函数顶部的注释块（line 33-46），把 "Returns (amountCents, amountUnits, err)" 改成 "(amountCents, amountUnits, quotaDelta, err)"，并说明 quotaDelta 是 authoritative。

- [ ] **Step 2: 更新 `createTopupHandler` 调用**

修改 `controller/payment/wechat.go:120`：

```go
		amountCents, amountUnits, quotaDelta, err := resolveTopupPrice(c, req.Amount)
		if err != nil {
			common.ApiError(c, err)
			return
		}
```

修改 `controller/payment/wechat.go:146-156` 的 `CreateTopupOrder` 调用，加 `QuotaDelta: quotaDelta`：

```go
		resp, order, err := paymentsvc.CreateTopupOrder(c.Request.Context(), paymentsvc.CreateTopupOrderInput{
			TenantId:    tid,
			UserId:      userId,
			AmountCents: amountCents,
			AmountUnits: amountUnits,
			QuotaDelta:  quotaDelta,
			ProductForm: productForm,
			Openid:      openid,
			ClientIp:    c.ClientIP(),
			Description: "充值",
			NotifyUrl:   notifyUrl,
		})
```

- [ ] **Step 3: 跑编译**

```bash
go build ./...
```

Expected：无报错（Task 3 的 struct 字段现在被填充）。

- [ ] **Step 4: 整体跑测试**

```bash
go test ./service/payment/... ./setting/operation_setting/... -v
```

Expected：全 PASS。

- [ ] **Step 5: Commit**

```bash
git add controller/payment/wechat.go
cat <<'EOF' | git commit -F -
Thread authoritative quota through WeChat topup ordering

resolveTopupPrice now returns the raw quota delta alongside the charged
amount and stored display units, so CreateTopupOrder can stamp the
callback metadata with the authoritative credited amount before the
provider round-trip begins.

Constraint: WeChat ordering must continue to reuse the shared pricing helpers instead of forking logic
Rejected: Recompute quota only inside applyTopupSuccess | loses the authoritative value for cross-path parity
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep order-time metadata and callback-time crediting on the same quota contract
Tested: go build ./...; go test ./service/payment/... ./setting/operation_setting/... -v
Not-tested: Live WeChat Native / JSAPI payment flow
EOF
```

---

## Task 6：Epay `RequestEpay` 写 `raw_quota` 到 TopUp 行

**Files:**
- Modify: `controller/payment/topup.go:195-275`（`RequestEpay`）

- [ ] **Step 1: 定位 topUp 插入位置**

`controller/payment/topup.go:252-268` 是原来的插入逻辑：

```go
	amount := req.Amount
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		dAmount := decimal.NewFromInt(int64(amount))
		dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
		amount = dAmount.Div(dQuotaPerUnit).IntPart()
	}
	topUp := &model.TopUp{
		TenantId:      middleware.GetTenantId(c),
		UserId:        id,
		Amount:        amount,
		Money:         payMoney,
		TradeNo:       tradeNo,
		PaymentMethod: req.PaymentMethod,
		CreateTime:    time.Now().Unix(),
		Status:        "pending",
		ClientIP:      c.ClientIP(),
	}
```

替换为：

```go
	// Display-units amount for top_ups.Amount (legacy invoice UI).
	amount := req.Amount
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		dAmount := decimal.NewFromInt(int64(amount))
		dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
		amount = dAmount.Div(dQuotaPerUnit).IntPart()
	}
	// Authoritative raw quota. Computed once here using the full raw
	// request amount (not the USD-normalized `amount` above) so all
	// four display modes resolve correctly.
	quotaDelta := operation_setting.ComputeTopupQuotaDelta(req.Amount)
	if quotaDelta <= 0 {
		c.JSON(200, gin.H{"message": "error", "data": "无法计算充值额度（检查 QuotaDisplayType 配置）"})
		return
	}
	topUp := &model.TopUp{
		TenantId:      middleware.GetTenantId(c),
		UserId:        id,
		Amount:        amount,
		RawQuota:      quotaDelta,
		Money:         payMoney,
		TradeNo:       tradeNo,
		PaymentMethod: req.PaymentMethod,
		CreateTime:    time.Now().Unix(),
		Status:        "pending",
		ClientIP:      c.ClientIP(),
	}
```

- [ ] **Step 2: 跑编译**

```bash
go build ./...
```

Expected：无报错。

- [ ] **Step 3: Commit**

```bash
git add controller/payment/topup.go
cat <<'EOF' | git commit -F -
Write authoritative raw quota when creating epay topups

RequestEpay now stores the computed raw quota at order-creation time so
the callback does not need to reconstruct credits from display-unit
amounts. This keeps epay aligned with the new authoritative-first
contract before the notify path flips to prefer RawQuota.

Constraint: top_ups.Amount must stay in legacy display-unit semantics for invoice/history UI
Rejected: Leave RawQuota empty until callback time | keeps the bug-prone reconstruction alive
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: For new epay rows, RawQuota should be non-zero unless configuration is invalid
Tested: go build ./...
Not-tested: Real epay provider round-trip
EOF
```

---

## Task 7：`EpayNotify` 读 `raw_quota` with 回退

**Files:**
- Modify: `controller/payment/topup.go:396-409`（EpayNotify 里 quotaToAdd 计算 + 日志）

- [ ] **Step 1: 替换 quotaToAdd 计算块**

`controller/payment/topup.go:396-409` 的老代码：

```go
			//user, _ := model.GetUserById(topUp.UserId, false)
			//user.Quota += topUp.Amount * 500000
			dAmount := decimal.NewFromInt(int64(topUp.Amount))
			dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
			quotaToAdd := int(dAmount.Mul(dQuotaPerUnit).IntPart())
			err = model.IncreaseUserQuota(topUp.UserId, quotaToAdd, true, model.GetUserTenantId(topUp.UserId))
			if err != nil {
				log.Printf("易支付回调更新用户失败: %v", topUp)
				return
			}
			log.Printf("易支付回调更新用户成功 %v", topUp)
			model.RecordLogCtx(c, topUp.UserId, model.LogTypeTopup, fmt.Sprintf("使用在线充值成功，充值金额: %v，支付金额：%f", logger.LogQuota(quotaToAdd), topUp.Money))
			// 处理充值返利
			model.ProcessTopUpRebate(topUp.UserId, quotaToAdd)
```

替换为：

```go
			// Authoritative: top_ups.RawQuota (set by RequestEpay). Fall
			// back to legacy Amount × QuotaPerUnit only for orders created
			// before the raw_quota column shipped.
			var quotaToAdd int
			if topUp.RawQuota > 0 {
				quotaToAdd = int(topUp.RawQuota)
			} else {
				dAmount := decimal.NewFromInt(topUp.Amount)
				dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
				quotaToAdd = int(dAmount.Mul(dQuotaPerUnit).IntPart())
			}
			if quotaToAdd <= 0 {
				log.Printf("易支付回调 quota 计算异常: %v", topUp)
				return
			}
			err = model.IncreaseUserQuota(topUp.UserId, quotaToAdd, true, model.GetUserTenantId(topUp.UserId))
			if err != nil {
				log.Printf("易支付回调更新用户失败: %v", topUp)
				return
			}
			log.Printf("易支付回调更新用户成功 %v", topUp)
			model.RecordLogCtx(c, topUp.UserId, model.LogTypeTopup, fmt.Sprintf("使用在线充值成功，充值金额: %v，支付金额：%f", logger.LogQuota(quotaToAdd), topUp.Money))
			// 处理充值返利
			model.ProcessTopUpRebate(topUp.UserId, quotaToAdd)
```

- [ ] **Step 2: 跑编译**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add controller/payment/topup.go
cat <<'EOF' | git commit -F -
Prefer persisted raw quota during epay callback crediting

EpayNotify now uses top_ups.RawQuota when available and only falls back
to the legacy Amount × QuotaPerUnit formula for rows that predate the
new column. That closes the over-credit bug on the epay callback path
without breaking in-flight legacy orders.

Constraint: Pre-migration orders may still arrive after deployment and cannot be discarded
Rejected: Remove the legacy fallback immediately | would strand old pending epay orders
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Once legacy pending orders are drained, revisit whether the fallback can be retired
Tested: go build ./...
Not-tested: Replay of historical epay notifications
EOF
```

---

## Task 8：`ManualCompleteTopUp` 也走新路径

**Files:**
- Modify: `model/topup.go:326-340`（ManualCompleteTopUp 里 `else` 分支）

- [ ] **Step 1: 替换 epay/wechat 分支**

`model/topup.go:326-337` 老代码：

```go
		if topUp.PaymentMethod == "stripe" {
			dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
			quotaToAdd = int(decimal.NewFromFloat(topUp.Money).Mul(dQuotaPerUnit).IntPart())
		} else {
			dAmount := decimal.NewFromInt(topUp.Amount)
			dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
			quotaToAdd = int(dAmount.Mul(dQuotaPerUnit).IntPart())
		}
```

替换为：

```go
		if topUp.PaymentMethod == "stripe" {
			// Stripe stores the discounted USD amount in Money; this branch
			// is unchanged (separate issue tracks its discount-on-quota bug).
			dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
			quotaToAdd = int(decimal.NewFromFloat(topUp.Money).Mul(dQuotaPerUnit).IntPart())
		} else if topUp.RawQuota > 0 {
			// Post-migration epay / wechat rows: RawQuota is authoritative.
			quotaToAdd = int(topUp.RawQuota)
		} else {
			// Pre-migration fallback (buggy for CNY/CUSTOM but preserves
			// historical behavior on in-flight orders without data).
			dAmount := decimal.NewFromInt(topUp.Amount)
			dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
			quotaToAdd = int(dAmount.Mul(dQuotaPerUnit).IntPart())
		}
```

- [ ] **Step 2: 跑编译**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add model/topup.go
cat <<'EOF' | git commit -F -
Reuse RawQuota during admin topup completion

ManualCompleteTopUp now follows the same authoritative-first rule as
the payment callbacks for epay and WeChat rows, while leaving Stripe on
its existing Money-based contract. That keeps manual recovery behavior
consistent with the online paths.

Constraint: Stripe semantics differ and remain tracked separately
Rejected: Force all payment methods onto RawQuota immediately | Stripe rows do not yet store the same meaning
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Do not merge Stripe into this branch without first defining its authoritative quota source
Tested: go build ./...
Not-tested: Manual-complete flow exercised through the admin UI
EOF
```

---

## Task 9：端到端手工验证

**Files:** none — 人工测试

- [ ] **Step 1: 启动后端 + 前端**

```bash
cd /d/top/keyapi && go run . &
cd /d/top/keyapi/web-next && bun run dev &
```

- [ ] **Step 2: 确认 4 模式 × 2 通道（wechat native + epay）**

使用 admin 账号打开 `/admin/settings?tab=quota`：

**2.a USD 模式**（回归）：
- 额度展示类型 = USD
- Price = 7.3
- `/topup` 点 `$1` → 扫码金额应为 **¥7.30**
- 付款后用户余额 +$1.00（余额页显示）
- `/admin/logs` 最新一行额度列 = `$1.00`，支付金额 = `7.30 元`

**2.b CNY 模式**（bug fix 主验证）：
- 额度展示类型 = CNY
- Price = 1
- `/topup` 点 `¥10` → 扫码金额应为 **¥10.00**
- 付款后用户余额 +¥10（= 68,493 raw quota，不是 500,000！）
- `/admin/logs` 额度列 = `¥10.00`，支付金额 = `10 元`

**2.c TOKENS 模式**（回归）：
- 额度展示类型 = TOKENS
- `/topup` 应显示数值（如 `500,000`）→ 扫码 ¥7.30
- 付款后余额 +500,000 tokens

**2.d CUSTOM 模式**（示例：EUR，rate = 0.9）：
- `CustomCurrencyExchangeRate = 0.9`
- `Price = 7.3`
- `/topup` 点 `€5` → 扫码金额应为 `5 / 0.9 × 7.3 ≈ ¥40.56`
- 付款后余额 +€5.00（对应 5.56 USD worth of quota）
- 校验点：扫码金额与 web-next 预估一致，且 `top_ups.money` / `raw_quota` 都来自同一份 `5 / 0.9` 的 USD 等价值

- [ ] **Step 3: 抓取 `/api/status` 与 DB 比对**

```bash
curl http://localhost:3000/api/status | jq '.data | {quota_display_type, price, usd_exchange_rate, custom_currency_exchange_rate}'
```

```sql
SELECT id, amount, raw_quota, money, trade_no, status, payment_method
  FROM top_ups ORDER BY id DESC LIMIT 5;
```

对每笔新订单验证 `raw_quota > 0` 且与 `users.quota` 增量一致。

- [ ] **Step 4: 手工停服务并 commit 没动的代码即可（本 Task 不写代码）**

（跳过 commit 步。）

---

## Task 10：Regression — 修 log 消息重复计算单位

**Files:**
- Modify: `controller/payment/topup.go:407`（`"充值金额: %v"` 的实参）

> 背景：当前 log 里 `logger.LogQuota(quotaToAdd)` 渲染的是按展示模式格式化的字符串（CNY 模式下会显示 `¥xxx`）；而 `topUp.Money` 是实付 CNY。CNY 模式下这两个值在 bug 修复后就不再相等（付 ¥10 得 ¥10 额度时巧合相等；付 ¥1 得 ¥1 额度也一致——但 USD 模式下付 ¥7.30 得 $1 = ¥7.30 额度也巧合一致）。**修完后不再需要调整这条 log**，保留原样即可。

- [ ] **Step 1: 人工确认当前 log 字符串在 4 模式下都合理**

走 Task 9 场景再跑一遍，确认 `/admin/logs` 详情弹窗里的"充值金额 / 支付金额"两个字段在视觉上没矛盾。如果有歧义再回来调 log 模板。

（本 Task 不写代码；它是验证 gate。）

---

## Task 11：文档

**Files:**
- Modify: `docs/superpowers/specs/` 下补一条备注（或新建 addendum）

- [ ] **Step 1: 写一条简短 addendum**

在 `docs/superpowers/specs/2026-04-17-wechat-pay-multi-tenant-design.md` 末尾或 `docs/superpowers/plans/` 下新建 `2026-04-20-topup-quota-delta-fix-addendum.md`：

```markdown
# Topup Quota Delta — 契约变更说明

## Why

`amountUnits` 契约是"USD 等价展示单位"，但 `resolveTopupPrice` 原实现只在 TOKENS 模式归一化。CNY / CUSTOM 模式下 `amountUnits = rawAmount`，下游 `amount × QuotaPerUnit` 放大 `USDExchangeRate` 倍。

CUSTOM 还多一层：web-next 已按 `custom_currency_exchange_rate` 预估扫码金额，但后端 `getPayMoney` 原实现没有做同样的归一化。这个 addendum 记录的不是“只修到账”，而是“到账和收费都回到同一个 CUSTOM 汇率契约”。

## What changed

- `controller/payment/topup.go:getPayMoney` 在 CUSTOM 模式下也按 `amount / CustomCurrencyExchangeRate` 归一化，和 web-next `estimateCny` 保持一致
- `payment_orders.Metadata` 新 key `quota_delta`（authoritative raw quota）
- `top_ups.raw_quota` 新列（authoritative）
- `operation_setting.ComputeTopupQuotaDelta(amount int64) int64` 共享 helper
- 所有读路径优先用 authoritative 字段，legacy 字段仅作回退

## Backward compat

- 老订单（in-flight）metadata 无 `quota_delta` → readQuotaDeltaFromMetadata 退回 `amount_units × QuotaPerUnit`
- 老 `top_ups` 行 `raw_quota = 0` → EpayNotify / ManualCompleteTopUp 退回 `Amount × QuotaPerUnit`
- 回退逻辑在 CNY / CUSTOM 模式下会保留 bug —— 但只影响在 schema 版本 `2026-04-20.02` 之前下单、之后回调的订单（数量极少，可接受）

## Out of scope

- Stripe `Recharge`（用 `Money × QuotaPerUnit` + 有 discount-on-quota 问题）
- Creem `RechargeCreem`（`Amount` 就是 raw quota，语义不同）
- Waffo `RechargeWaffo`（同老公式，低频）

这三处后续 issue 单独立。
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-04-20-topup-quota-delta-fix-addendum.md
cat <<'EOF' | git commit -F -
Record the topup quota delta contract change

The addendum captures both halves of the fix: authoritative credited
quota for callbacks/manual recovery and CUSTOM charge-path parity with
the frontend exchange-rate contract. That gives future modifiers one
place to understand the new topup invariants and legacy fallback rules.

Constraint: Historical in-flight orders still rely on documented fallback behavior
Rejected: Leave the rationale only in the implementation commits | future readers also need a stable docs entrypoint
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Update this addendum before changing RawQuota or CUSTOM pricing semantics again
Tested: Documentation review
Not-tested: N/A
EOF
```

---

## Self-Review Checklist

- [x] **Spec 覆盖**：Bug 根因（wechat + epay）、CUSTOM 模式收费/到账一致性、管理员补单、老数据兼容、regression 测试——每一项都有对应 Task。
- [x] **无占位符**：每一步都含完整代码块，没 TODO / TBD / `adapt the same pattern`。
- [x] **类型一致**：`QuotaDelta int64` 贯穿 struct / metadata / DB 列；`ComputeTopupQuotaDelta(amount int64) int64` 签名在所有调用点一致。
- [x] **频繁 commit**：每个 Task 一个 Lore-format commit，独立语义。
- [x] **DRY**：quota 读取统一走 `ComputeTopupQuotaDelta` + `readQuotaDeltaFromMetadata`；CUSTOM 收费路径单独有测试锁定，与前端预估保持同一汇率契约。
- [x] **TDD**：Task 1 / 4 先写测试；其它 Task 主要是粘合，靠 Task 9 手工回归兜底。

## Execution Handoff

Plan 已保存到 `docs/superpowers/plans/2026-04-20-topup-quota-delta-fix.md`。两种执行方式：

1. **Subagent-Driven（推荐）** — 每个 Task 派一个 fresh subagent 做，我在中间 review，迭代快、上下文不污染。
2. **Inline** — 在当前会话直接按 Task 顺序执行，批量做、中间 checkpoint。

你要哪种？
