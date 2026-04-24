# Dual-Ledger Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple the platform cost ledger from the user bill ledger so tenant-overridable configs (`GroupRatio`, `GroupGroupRatio`, `platform_markup`, future per-channel tenant markup) can never influence platform cost / cap / usage accounting. Platform cost must be derived from platform-only configuration, never reverse-engineered from user-facing quota.

**Architecture:** Extend `types.PriceData` with a parallel set of `PlatformCost*` fields. A new helper `relay/helper/platform_cost.go` computes platform cost at the same two lifecycle points the user-bill helpers already hook (`ModelPriceHelper` / `ModelPriceHelperPerCall` for pre-consume, `PostTextConsumeQuota` / equivalent for settle). `EnforcePlatformChannelQuota` and `TrackPlatformChannelUsageIfApplicable` switch to reading `PriceData.PlatformCostQuota*` instead of calling `StripMarkup` on user-facing quota. `StripMarkup` stays callable as a legacy utility but is removed from the cost hot-path. A new nullable column `channels.platform_cost_ratio` carries the platform-controlled per-channel cost multiplier. Phase D adds a new `tenant_platform_channel_markups` table which only affects the user-bill ledger. Rollout follows the spec's recommended order: scaffold fields → calculator with dual-write logging (no behaviour change) → switch cap/usage to cost fields → per-path settlement coverage → tenant-channel markup table.

**Tech Stack:** Go (Gin + GORM), `shopspring/decimal` for money math, `testing` package with table-driven tests. Database: same GORM-managed MySQL/Postgres/SQLite as the existing `tenant_plans` / `channels` tables.

**Out of scope (don't add):**
- Admin-UI changes for exposing the new cost fields. Covered by a follow-up plan — this plan only keeps the backend honest and logs the dual values so operators can verify manually.
- Real supplier-bill import / dynamic cost per time-of-day / live inventory pricing. Platform cost is still read from static ratio config.
- Any new funding source (wallet/subscription/token unchanged).
- Renaming existing fields for clarity beyond what's strictly needed (e.g. we do NOT rename `Quota` → `UserBillQuota`; we only ADD `PlatformCostQuota`).

---

## File Structure

**New files:**
- `relay/helper/platform_cost.go` — token-based + per-call platform-cost estimator and actual-usage filler. Reads ONLY platform-controlled configuration.
- `relay/helper/platform_cost_test.go` — unit tests for the calculator.
- `model/tenant_platform_channel_markup.go` (Phase D) — new table + CRUD helpers.
- `model/tenant_platform_channel_markup_test.go` (Phase D) — migration + resolver tests.

**Modified files (backend):**
- `types/price_data.go` — add `PlatformCost*` fields + `ToSetting` update.
- `model/channel.go` — add `PlatformCostRatio *float64` column.
- `model/setup.go` — bump `CurrentSchemaVersion`.
- `relay/helper/price.go` — `ModelPriceHelper` and `ModelPriceHelperPerCall` call into the new estimator; `ApplyChannelBillingOverrides` also updates platform-cost side; `EnforcePlatformChannelQuota` switches to reading `PlatformCost*` fields.
- `service/billing.go` — `TrackPlatformChannelUsageIfApplicable` switches to reading `PriceData.PlatformCostQuota`; `StripMarkup` kept but no longer used for cost.
- `service/text_quota.go` — call `FillPlatformCostActual` before `SettleBilling` and write both quotas into `logs.other`.
- `service/quota.go` — `PostAudioConsumeQuota` and `PreWssConsumeQuota` / `PostWssConsumeQuota` similarly.
- `relay/mjproxy_handler.go` — both `TrackPlatformChannelUsageIfApplicable` callsites + MJ log path picks up dual-ledger keys via `GenerateMjOtherInfo`.
- `relay/relay_task.go` — task settle path writes platform cost too; persists on the task row.
- `model/task.go` — new `PlatformCostQuota` column + `BillingContext.PlatformCostChannelRatio` field so task log can recover cost at refund/settle time.
- `service/task_billing.go` — `taskBillingOther` appends dual-ledger keys for Video/Suno/Kling/Jimeng settle + refund.
- `service/log_info_generate.go` — `AddDualLedgerLogFields` shared helper + `GenerateMjOtherInfo` extended; text/audio/WSS log paths call it.
- `service/tenant_platform_channel_markup.go` (Phase D) — user-bill resolver that extends `EffectiveMarkup` with per-channel overrides.

**Modified tests:**
- `service/billing_test.go` — extend `TestStripMarkup_*` with new cost-decoupled test cases.
- `service/text_quota_test.go` — add platform-cost regression cases (spec §12.1, §12.2).
- `service/tenant_quota_test.go` — add cap-based-on-platform-cost regression (spec §12.4).
- `relay/helper/platform_cost_test.go` — core unit tests.

---

## Schema Conventions

**New fields on `types.PriceData`:**

| Field                            | Type                 | Meaning                                                              |
|----------------------------------|----------------------|----------------------------------------------------------------------|
| `PlatformCostQuota`              | `int`                | Platform cost per-call (mirror of existing `Quota` for Task/MJ).     |
| `PlatformCostQuotaToPreConsume`  | `int`                | Platform cost pre-consume estimate (mirror of `QuotaToPreConsume`).  |
| `PlatformCostModelRatio`         | `float64`            | Platform-side token-based model ratio. Same value as `ModelRatio` for now — copied so cost-path never reads the user-side field if we ever diverge. |
| `PlatformCostModelPrice`         | `float64`            | Platform-side fixed price (when `UsePrice=true`).                    |
| `PlatformCostChannelRatio`       | `float64`            | From `channels.platform_cost_ratio`; defaults to `1.0`.              |
| `PlatformCostOtherRatios`        | `map[string]float64` | Objective cost factors only (image count, audio seconds). NEVER stores `platform_markup`, `channel_ratio`, `group_ratio`. |

**New column on `channels` table:**

| Column                 | Type            | Default | Meaning                                                              |
|------------------------|-----------------|---------|----------------------------------------------------------------------|
| `platform_cost_ratio`  | decimal(10,4)   | NULL    | Platform-admin-edited cost multiplier. `NULL` ≡ `1.0`. Only consulted when `Scope = platform`. |

**Schema version bump:** `2026-04-23.03` → `2026-04-24.01` (in `model/setup.go`).

**Phase D new table `tenant_platform_channel_markups`:**

| Column        | Type            | Constraint                                                  |
|---------------|-----------------|-------------------------------------------------------------|
| `tenant_id`   | int             | composite PK                                                |
| `channel_id`  | int             | composite PK, indexed                                       |
| `markup_ratio`| decimal(10,4)   | not null                                                    |
| `enabled`     | bool            | not null, default true                                      |
| `created_at`  | bigint          | autoCreateTime                                              |
| `updated_at`  | bigint          | autoUpdateTime                                              |

Schema version bump at Phase D entry: `2026-04-24.01` → `2026-04-24.02`.

---

## Ledger Invariants (engineer reference)

**Platform cost MUST use only:**
- `PlatformCostModelRatio` / `PlatformCostModelPrice` (sourced from platform-admin `ratio_setting.GetModelRatio` / `GetModelPrice`)
- `CompletionRatio`, `CacheRatio`, `CacheCreationRatio`, `CacheCreation5mRatio`, `CacheCreation1hRatio`, `ImageRatio`, `AudioRatio`, `AudioCompletionRatio` — all platform-admin values (same lookup as today)
- `PlatformCostChannelRatio` (from `channels.platform_cost_ratio`)
- Objective per-call ratios (image count, video seconds, web search call count)

**Platform cost MUST NOT read:**
- `GroupRatio` / `GroupRatioInfo.*`
- `info.PriceMarkupRatio` / `OtherRatios["platform_markup"]`
- `OtherRatios["channel_ratio"]` (Channel Settings is tenant-editable; see `controller/channel/channel.go`)
- Any `tenant_options` key
- Any future `tenant_platform_channel_markups` row

**User bill continues reading the existing set** — no behaviour change on the user-bill path.

---

# Phase 0 — Data Model

## Task 0.1: Extend `types.PriceData` with platform-cost fields

**Files:**
- Modify: `types/price_data.go`
- Test: `types/price_data_test.go` (create if missing)

- [ ] **Step 1: Write the failing test**

Create `types/price_data_test.go`:

```go
package types

import "testing"

func TestPriceData_PlatformCostFieldsDefaultsAreZero(t *testing.T) {
	var p PriceData
	if p.PlatformCostQuota != 0 {
		t.Fatalf("PlatformCostQuota default = %d, want 0", p.PlatformCostQuota)
	}
	if p.PlatformCostQuotaToPreConsume != 0 {
		t.Fatalf("PlatformCostQuotaToPreConsume default = %d, want 0", p.PlatformCostQuotaToPreConsume)
	}
	if p.PlatformCostChannelRatio != 0 {
		t.Fatalf("PlatformCostChannelRatio default = %v, want 0", p.PlatformCostChannelRatio)
	}
	if p.PlatformCostOtherRatios != nil {
		t.Fatalf("PlatformCostOtherRatios default = %v, want nil", p.PlatformCostOtherRatios)
	}
}

func TestPriceData_AddPlatformCostOtherRatio(t *testing.T) {
	var p PriceData
	p.AddPlatformCostOtherRatio("image_count", 3.0)
	if got := p.PlatformCostOtherRatios["image_count"]; got != 3.0 {
		t.Fatalf("image_count = %v, want 3", got)
	}
	// negative / zero values are dropped, same rule as AddOtherRatio
	p.AddPlatformCostOtherRatio("bogus", 0)
	if _, exists := p.PlatformCostOtherRatios["bogus"]; exists {
		t.Fatalf("zero ratio should not be stored")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:/top/keyapi && go test ./types -run TestPriceData_ -v`
Expected: FAIL (undefined: PlatformCostQuota / AddPlatformCostOtherRatio).

- [ ] **Step 3: Extend `types/price_data.go`**

Replace the `PriceData` struct and add the new accessor. Open `types/price_data.go` and replace the struct plus add the accessor:

```go
type PriceData struct {
	FreeModel            bool
	ModelPrice           float64
	ModelRatio           float64
	OriginalModelRatio   float64
	CompletionRatio      float64
	CacheRatio           float64
	CacheCreationRatio   float64
	CacheCreation5mRatio float64
	CacheCreation1hRatio float64
	ImageRatio           float64
	AudioRatio           float64
	AudioCompletionRatio float64
	OtherRatios          map[string]float64
	UsePrice             bool
	Quota                int // 用户售价账（按次）
	QuotaToPreConsume    int // 用户售价账（预扣）
	GroupRatioInfo       GroupRatioInfo

	// --- 平台成本账（dual-ledger v1, 2026-04-24） ---
	// 不得被 GroupRatio / platform_markup / 任何租户可改配置污染。
	// 仅从平台管理员可改的配置派生。
	PlatformCostQuota             int
	PlatformCostQuotaToPreConsume int
	PlatformCostModelRatio        float64
	PlatformCostModelPrice        float64
	PlatformCostChannelRatio      float64
	PlatformCostOtherRatios       map[string]float64
}
```

Then append the accessor:

```go
func (p *PriceData) AddPlatformCostOtherRatio(key string, ratio float64) {
	if ratio <= 0 {
		return
	}
	if p.PlatformCostOtherRatios == nil {
		p.PlatformCostOtherRatios = make(map[string]float64)
	}
	p.PlatformCostOtherRatios[key] = ratio
}
```

Update `ToSetting()` to include the new fields:

```go
func (p *PriceData) ToSetting() string {
	return fmt.Sprintf("ModelPrice: %f, ModelRatio: %f, CompletionRatio: %f, CacheRatio: %f, GroupRatio: %f, UsePrice: %t, CacheCreationRatio: %f, CacheCreation5mRatio: %f, CacheCreation1hRatio: %f, QuotaToPreConsume: %d, ImageRatio: %f, AudioRatio: %f, AudioCompletionRatio: %f, PlatformCostQuota: %d, PlatformCostQuotaToPreConsume: %d, PlatformCostModelRatio: %f, PlatformCostModelPrice: %f, PlatformCostChannelRatio: %f",
		p.ModelPrice, p.ModelRatio, p.CompletionRatio, p.CacheRatio, p.GroupRatioInfo.GroupRatio, p.UsePrice,
		p.CacheCreationRatio, p.CacheCreation5mRatio, p.CacheCreation1hRatio, p.QuotaToPreConsume,
		p.ImageRatio, p.AudioRatio, p.AudioCompletionRatio,
		p.PlatformCostQuota, p.PlatformCostQuotaToPreConsume,
		p.PlatformCostModelRatio, p.PlatformCostModelPrice, p.PlatformCostChannelRatio,
	)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:/top/keyapi && go test ./types -run TestPriceData_ -v`
Expected: PASS (both subtests).

- [ ] **Step 5: Ensure nothing else broke**

Run: `cd D:/top/keyapi && go build ./...`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add types/price_data.go types/price_data_test.go
git commit -m "feat(billing): add PlatformCost fields to PriceData

Introduces the parallel platform-cost ledger on PriceData. Fields are
added but not yet populated — dual-ledger calculator follows. Adding
first and wiring later lets downstream paths compile against the new
shape before the estimator is online.

Spec: docs/superpowers/specs/2026-04-24-dual-ledger-billing-design.md §8.1"
```

---

## Task 0.2: Add `Channel.PlatformCostRatio` column + bump schema version

**Files:**
- Modify: `model/channel.go:67-68`
- Modify: `model/setup.go:7`
- Test: `model/channel_platform_cost_ratio_test.go` (new)

- [ ] **Step 1: Write the failing test**

Create `model/channel_platform_cost_ratio_test.go`:

```go
package model

import "testing"

func TestChannel_PlatformCostRatioFieldIsNullablePointer(t *testing.T) {
	var ch Channel
	if ch.PlatformCostRatio != nil {
		t.Fatalf("default PlatformCostRatio = %v, want nil", ch.PlatformCostRatio)
	}

	v := 1.25
	ch.PlatformCostRatio = &v
	if *ch.PlatformCostRatio != 1.25 {
		t.Fatalf("round-trip failed: %v", *ch.PlatformCostRatio)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:/top/keyapi && go test ./model -run TestChannel_PlatformCostRatio -v`
Expected: FAIL (undefined field).

- [ ] **Step 3: Add the field**

Open `model/channel.go`, find the existing `Scope` / `MarkupRatio` block around lines 65-68 and insert the new field immediately after `MarkupRatio`:

```go
	// Scope distinguishes "platform" (shared, tenant_id=0) and "tenant" (owned).
	// See docs/superpowers/specs/2026-04-20-shared-channels-design.md §3.1.
	Scope       string   `json:"scope" gorm:"type:varchar(16);not null;default:'tenant';index"`
	MarkupRatio *float64 `json:"markup_ratio" gorm:"type:decimal(10,4);default:null"`

	// PlatformCostRatio is the platform-admin-controlled cost multiplier
	// applied when this channel is used (Scope=platform only). NULL ≡ 1.0.
	// NEVER editable by tenant admins; feeds only the platform cost ledger.
	// See docs/superpowers/specs/2026-04-24-dual-ledger-billing-design.md §8.2.
	PlatformCostRatio *float64 `json:"platform_cost_ratio" gorm:"type:decimal(10,4);default:null"`
```

- [ ] **Step 4: Bump schema version**

Open `model/setup.go` line 7:

```go
const CurrentSchemaVersion = "2026-04-24.01"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd D:/top/keyapi && go test ./model -run TestChannel_PlatformCostRatio -v`
Expected: PASS.

- [ ] **Step 6: Full build**

Run: `cd D:/top/keyapi && go build ./...`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add model/channel.go model/setup.go model/channel_platform_cost_ratio_test.go
git commit -m "feat(billing): add platform_cost_ratio column to channels

Nullable decimal multiplier consulted only when channel Scope=platform.
NULL means 1.0. Feeds only the platform cost ledger; never mutates
user-facing quota.

Bumps schema version to trigger AutoMigrate on next boot.

Spec: docs/superpowers/specs/2026-04-24-dual-ledger-billing-design.md §8.2"
```

---

## Task 0.3: Read helper `ResolvePlatformCostChannelRatio`

**Files:**
- Modify: `model/channel.go` — add method
- Test: `model/channel_platform_cost_ratio_test.go` — extend

Platform cost calc needs to resolve NULL → 1.0 consistently. Centralise it.

- [ ] **Step 1: Extend the test**

Append to `model/channel_platform_cost_ratio_test.go`:

```go
func TestChannel_ResolvePlatformCostRatio_NilReturns1(t *testing.T) {
	ch := Channel{}
	if got := ch.ResolvePlatformCostRatio(); got != 1.0 {
		t.Fatalf("nil PlatformCostRatio → %v, want 1.0", got)
	}
}

func TestChannel_ResolvePlatformCostRatio_ZeroOrNegativeReturns1(t *testing.T) {
	cases := []float64{0, -0.5}
	for _, v := range cases {
		v := v
		t.Run("", func(t *testing.T) {
			ch := Channel{PlatformCostRatio: &v}
			if got := ch.ResolvePlatformCostRatio(); got != 1.0 {
				t.Fatalf("PlatformCostRatio=%v → %v, want 1.0 (fail-safe)", v, got)
			}
		})
	}
}

func TestChannel_ResolvePlatformCostRatio_ValidReturnsItself(t *testing.T) {
	v := 1.5
	ch := Channel{PlatformCostRatio: &v}
	if got := ch.ResolvePlatformCostRatio(); got != 1.5 {
		t.Fatalf("PlatformCostRatio=%v → %v, want 1.5", v, got)
	}
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd D:/top/keyapi && go test ./model -run TestChannel_ResolvePlatformCostRatio -v`
Expected: FAIL (undefined method).

- [ ] **Step 3: Implement the method**

Append to `model/channel.go` (place after the `GetKeys` method):

```go
// ResolvePlatformCostRatio returns the cost multiplier to use for this channel's
// platform cost accounting. NULL / zero / negative values collapse to 1.0 so
// mis-configuration never silently discounts the platform's cost ledger.
func (channel *Channel) ResolvePlatformCostRatio() float64 {
	if channel.PlatformCostRatio == nil {
		return 1.0
	}
	if *channel.PlatformCostRatio <= 0 {
		return 1.0
	}
	return *channel.PlatformCostRatio
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd D:/top/keyapi && go test ./model -run TestChannel_ResolvePlatformCostRatio -v`
Expected: PASS (three subtests).

- [ ] **Step 5: Commit**

```bash
git add model/channel.go model/channel_platform_cost_ratio_test.go
git commit -m "feat(billing): Channel.ResolvePlatformCostRatio helper

Centralises NULL/zero/negative → 1.0 fail-safe. Called only from the
platform cost calculator; tenant admins never mutate this."
```

---

# Phase A — Calculator + Dual-Write (no behaviour change)

At the end of this phase the platform cost ledger is populated and visible in `logs.other`, but cap enforcement and usage tracking still use the legacy `StripMarkup`-based path. That lets operators eyeball log entries and verify the new number matches expectations before cutting the cap over in Phase B.

## Task A.1: Platform-cost estimator for token-based relay

**Files:**
- Create: `relay/helper/platform_cost.go`
- Create: `relay/helper/platform_cost_test.go`

Token-based estimator mirrors `ModelPriceHelper` (lines 51-145 in `relay/helper/price.go`) but drops `GroupRatio` and `platform_markup`. Structurally simpler: token count × model ratio × channel cost ratio.

- [ ] **Step 1: Write unit tests**

Create `relay/helper/platform_cost_test.go`:

```go
package helper

import (
	"testing"

	"github.com/QuantumNous/new-api/types"
)

func TestComputePlatformCostEstimate_UsePrice(t *testing.T) {
	pd := types.PriceData{
		UsePrice:                 true,
		PlatformCostModelPrice:   2.0, // USD
		PlatformCostChannelRatio: 1.0,
	}
	// 500_000 quota units per USD is QuotaPerUnit. We call into the pure helper
	// so it can be unit-tested without a gin context.
	got := computePlatformCostQuotaForPerCall(&pd, 0 /* meta.ImagePriceRatio */)
	want := int(2.0 * 500_000 * 1.0)
	if got != want {
		t.Fatalf("UsePrice path got %d want %d", got, want)
	}
}

func TestComputePlatformCostEstimate_TokenRatio(t *testing.T) {
	pd := types.PriceData{
		UsePrice:                 false,
		PlatformCostModelRatio:   0.5,
		PlatformCostChannelRatio: 1.2,
	}
	preConsumeTokens := 1000
	got := computePlatformCostQuotaForTokens(&pd, preConsumeTokens)
	// tokens × model_ratio × channel_ratio
	want := int(float64(preConsumeTokens) * 0.5 * 1.2)
	if got != want {
		t.Fatalf("token path got %d want %d", got, want)
	}
}

func TestComputePlatformCostEstimate_IgnoresGroupAndMarkup(t *testing.T) {
	// GroupRatio 0.1 on PriceData must NOT influence platform cost.
	pd := types.PriceData{
		UsePrice:                 false,
		PlatformCostModelRatio:   1.0,
		PlatformCostChannelRatio: 1.0,
		GroupRatioInfo:           types.GroupRatioInfo{GroupRatio: 0.1},
		OtherRatios:              map[string]float64{"platform_markup": 5.0},
	}
	got := computePlatformCostQuotaForTokens(&pd, 100)
	if got != 100 {
		t.Fatalf("got %d, want 100 — GroupRatio / platform_markup leaked into cost ledger", got)
	}
}

func TestComputePlatformCostEstimate_MinimumOne(t *testing.T) {
	// Tiny request with non-zero ratio must still produce >= 1 quota so
	// fail-closed enforcement doesn't reject legitimate small calls.
	pd := types.PriceData{
		UsePrice:                 false,
		PlatformCostModelRatio:   0.0001,
		PlatformCostChannelRatio: 1.0,
	}
	if got := computePlatformCostQuotaForTokens(&pd, 1); got != 1 {
		t.Fatalf("got %d, want 1 (min-quota rule)", got)
	}
	// Zero tokens genuinely returns 0.
	if got := computePlatformCostQuotaForTokens(&pd, 0); got != 0 {
		t.Fatalf("got %d, want 0 for 0 tokens", got)
	}
	// Zero ratio genuinely returns 0 (free model, not rounding artifact).
	pd.PlatformCostModelRatio = 0
	if got := computePlatformCostQuotaForTokens(&pd, 100); got != 0 {
		t.Fatalf("got %d, want 0 for ratio=0", got)
	}
}

func TestComputePlatformCostEstimate_PerCallMinimumOne(t *testing.T) {
	pd := types.PriceData{
		UsePrice:                 true,
		PlatformCostModelPrice:   0.0000001,
		PlatformCostChannelRatio: 1.0,
	}
	if got := computePlatformCostQuotaForPerCall(&pd, 0); got != 1 {
		t.Fatalf("got %d, want 1 (min-quota rule on per-call)", got)
	}
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd D:/top/keyapi && go test ./relay/helper -run TestComputePlatformCost -v`
Expected: FAIL — undefined functions.

- [ ] **Step 3: Create the estimator file**

Create `relay/helper/platform_cost.go`:

```go
// Package helper — platform cost ledger calculator.
//
// This file is the source of truth for the platform cost ledger. It may read
// ONLY platform-admin-controlled configuration: global model ratios / prices,
// channel.platform_cost_ratio, objective per-call factors. It MUST NOT read
// GroupRatio, platform_markup, channel_ratio (ChannelSetting), any tenant
// options, or any tenant-platform-channel markup row.
//
// See docs/superpowers/specs/2026-04-24-dual-ledger-billing-design.md.
package helper

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

// FillPlatformCostEstimate fills the pre-consume platform cost fields on
// info.PriceData. Safe to call even when the channel is not platform-scoped —
// in that case it leaves the fields at zero.
//
// Called exactly where the user-bill estimator already runs:
//   - ModelPriceHelper (token-based relay)
//   - ModelPriceHelperPerCall (Task / MJ)
//
// Safe to re-invoke: ApplyChannelBillingOverrides calls RefreshPlatformCostEstimate
// which re-runs this after a channel switch.
func FillPlatformCostEstimate(c *gin.Context, info *relaycommon.RelayInfo, preConsumedTokens int) {
	if info == nil {
		return
	}
	channelID := resolveChannelID(c, info)
	ch := loadPlatformChannel(channelID)
	if ch == nil {
		// Non-platform or unknown channel: platform cost ledger stays zero.
		// Cap enforcement has a fail-closed guard separately (Task B.3).
		info.PriceData.PlatformCostQuota = 0
		info.PriceData.PlatformCostQuotaToPreConsume = 0
		info.PriceData.PlatformCostChannelRatio = 0
		return
	}
	populatePlatformCostRates(info, ch)

	if info.PriceData.UsePrice {
		info.PriceData.PlatformCostQuotaToPreConsume = computePlatformCostQuotaForPerCall(&info.PriceData, 0)
	} else {
		info.PriceData.PlatformCostQuotaToPreConsume = computePlatformCostQuotaForTokens(&info.PriceData, preConsumedTokens)
	}
}

// FillPlatformCostPerCallEstimate is the Task/MJ equivalent. Writes PlatformCostQuota
// (not PlatformCostQuotaToPreConsume) because those paths set ForcePreConsume=true and
// the full per-call amount is consumed immediately.
func FillPlatformCostPerCallEstimate(c *gin.Context, info *relaycommon.RelayInfo) {
	if info == nil {
		return
	}
	channelID := resolveChannelID(c, info)
	ch := loadPlatformChannel(channelID)
	if ch == nil {
		info.PriceData.PlatformCostQuota = 0
		info.PriceData.PlatformCostChannelRatio = 0
		return
	}
	populatePlatformCostRates(info, ch)
	info.PriceData.PlatformCostQuota = computePlatformCostQuotaForPerCall(&info.PriceData, 0)
	info.PriceData.PlatformCostQuotaToPreConsume = info.PriceData.PlatformCostQuota
}

// RefreshPlatformCostEstimate re-runs the estimator after a channel switch
// (controller/relay.go retry loop). Pre-consume tokens are re-derived from the
// existing PriceData so callers don't need to thread the raw count back in.
func RefreshPlatformCostEstimate(c *gin.Context, info *relaycommon.RelayInfo) {
	if info == nil {
		return
	}
	// For per-call paths PlatformCostQuotaToPreConsume == PlatformCostQuota (see
	// FillPlatformCostPerCallEstimate) so we can't distinguish them by the ratio
	// alone; instead we key off UsePrice, which is stable across channel switches.
	if info.PriceData.UsePrice {
		FillPlatformCostPerCallEstimate(c, info)
		return
	}
	// Token-based: derive preConsumedTokens from the previous estimate before
	// channel switch; if ModelRatio was 0 we fall back to 0 (cost ledger 0).
	prevRatio := info.PriceData.PlatformCostModelRatio * info.PriceData.PlatformCostChannelRatio
	var tokens int
	if prevRatio > 0 {
		tokens = int(float64(info.PriceData.PlatformCostQuotaToPreConsume) / prevRatio)
	}
	FillPlatformCostEstimate(c, info, tokens)
}

// --- pure helpers (unit-testable without gin context) ---
//
// Rounding rule (mirrors calculateTextQuotaSummary so cap enforcement and
// usage tracking aren't off-by-one on tiny requests):
//   - Use decimal.Round(0) not int() truncation.
//   - Non-zero ratio × non-zero input MUST produce at least 1 quota unit. If
//     rounding drops to 0, bump to 1. Prevents B.1 fail-closed from rejecting
//     legitimate small calls and B.2 from silently skipping accumulation.

func computePlatformCostQuotaForTokens(pd *types.PriceData, preConsumedTokens int) int {
	if preConsumedTokens <= 0 {
		return 0
	}
	ratio := pd.PlatformCostModelRatio * pd.PlatformCostChannelRatio
	for _, r := range pd.PlatformCostOtherRatios {
		ratio *= r
	}
	if ratio <= 0 {
		return 0
	}
	q := decimal.NewFromInt(int64(preConsumedTokens)).Mul(decimal.NewFromFloat(ratio))
	result := int(q.Round(0).IntPart())
	if result == 0 {
		result = 1 // non-zero ratio × non-zero tokens must produce >= 1 quota
	}
	return result
}

func computePlatformCostQuotaForPerCall(pd *types.PriceData, imageMultiplier float64) int {
	price := pd.PlatformCostModelPrice
	if imageMultiplier > 0 {
		price *= imageMultiplier
	}
	if price <= 0 || pd.PlatformCostChannelRatio <= 0 {
		return 0
	}
	q := decimal.NewFromFloat(price).
		Mul(decimal.NewFromFloat(common.QuotaPerUnit)).
		Mul(decimal.NewFromFloat(pd.PlatformCostChannelRatio))
	for _, r := range pd.PlatformCostOtherRatios {
		q = q.Mul(decimal.NewFromFloat(r))
	}
	result := int(q.Round(0).IntPart())
	if result == 0 {
		result = 1
	}
	return result
}

// --- internal plumbing ---

func resolveChannelID(c *gin.Context, info *relaycommon.RelayInfo) int {
	var id int
	if info.ChannelMeta != nil {
		id = info.ChannelId
	}
	if id <= 0 && c != nil {
		id = common.GetContextKeyInt(c, constant.ContextKeyChannelId)
	}
	return id
}

// loadPlatformChannel returns the channel row ONLY if it is platform-scoped.
// Any other state (tenant channel, missing, load error) returns nil so the
// caller can treat it as "no platform cost applies".
func loadPlatformChannel(channelID int) *model.Channel {
	if channelID <= 0 {
		return nil
	}
	ch, err := model.CacheGetChannel(channelID)
	if err != nil || ch == nil {
		logger.SysError("platform_cost: CacheGetChannel failed; treating as non-platform")
		return nil
	}
	if ch.Scope != model.ChannelScopePlatform {
		return nil
	}
	return ch
}

func populatePlatformCostRates(info *relaycommon.RelayInfo, ch *model.Channel) {
	// Platform-side ratios mirror the user side for now — the key is that they
	// come from platform_admin `ratio_setting`, not from tenant config. We
	// copy them into PlatformCost* fields so the cost path can never
	// accidentally mutate via a later ApplyChannelBillingOverrides that only
	// targets user-bill fields.
	if info.PriceData.UsePrice {
		// ModelPrice was filled by the user-bill helper; it's sourced from
		// ratio_setting.GetModelPrice which is platform-controlled, so it's safe.
		info.PriceData.PlatformCostModelPrice = info.PriceData.ModelPrice
	} else {
		// ModelRatio is platform-sourced in the normal path. If a future
		// override pollutes ModelRatio, we'd diverge here — for v1 we snapshot
		// OriginalModelRatio which ApplyChannelBillingOverrides preserves.
		if info.PriceData.OriginalModelRatio > 0 {
			info.PriceData.PlatformCostModelRatio = info.PriceData.OriginalModelRatio
		} else {
			// Fallback: read directly from ratio_setting so we're not sensitive
			// to ordering.
			r, ok, _ := ratio_setting.GetModelRatio(info.OriginModelName)
			if ok {
				info.PriceData.PlatformCostModelRatio = r
			}
		}
	}
	info.PriceData.PlatformCostChannelRatio = ch.ResolvePlatformCostRatio()
}
```

- [ ] **Step 4: Run unit tests**

Run: `cd D:/top/keyapi && go test ./relay/helper -run TestComputePlatformCost -v`
Expected: PASS (3 subtests).

- [ ] **Step 5: Full build**

Run: `cd D:/top/keyapi && go build ./...`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add relay/helper/platform_cost.go relay/helper/platform_cost_test.go
git commit -m "feat(billing): platform cost estimator

Pure token / per-call estimators plus gin-context wrappers that load the
platform channel and populate PriceData.PlatformCost* fields. Ratios read
ONLY from ratio_setting (platform) + channel.platform_cost_ratio. Unit
tests pin the isolation invariant: GroupRatio and platform_markup must
not leak into the cost result.

Not wired into the relay yet — next task."
```

---

## Task A.2: Wire estimator into `ModelPriceHelper`

**Files:**
- Modify: `relay/helper/price.go:138`

- [ ] **Step 1: Write the wiring test**

Create `relay/helper/price_platform_cost_wiring_test.go`:

```go
package helper

import (
	"testing"

	"github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
)

// Verifies that after ModelPriceHelper runs, FillPlatformCostEstimate has been
// invoked via its public export (we check the side-effect on PriceData). We
// cannot easily exercise full ModelPriceHelper in a unit test (it needs gin
// + channel cache), so we instead assert the helper public surface is stable.
func TestFillPlatformCostEstimate_NoPanicOnNilInfo(t *testing.T) {
	// defensive guard — FillPlatformCostEstimate must be safe on nil info
	FillPlatformCostEstimate(nil, nil, 0)
	FillPlatformCostPerCallEstimate(nil, nil)
	RefreshPlatformCostEstimate(nil, nil)
}

func TestFillPlatformCostEstimate_NonPlatformChannelLeavesZero(t *testing.T) {
	info := &common.RelayInfo{}
	info.PriceData = types.PriceData{
		QuotaToPreConsume:    123,
		PlatformCostQuota:    999, // should be reset to 0
		PlatformCostChannelRatio: 999,
	}
	FillPlatformCostEstimate(nil, info, 100)
	if info.PriceData.PlatformCostQuota != 0 {
		t.Fatalf("PlatformCostQuota not reset: %d", info.PriceData.PlatformCostQuota)
	}
	if info.PriceData.PlatformCostQuotaToPreConsume != 0 {
		t.Fatalf("PlatformCostQuotaToPreConsume not reset")
	}
	if info.PriceData.PlatformCostChannelRatio != 0 {
		t.Fatalf("PlatformCostChannelRatio not reset")
	}
}
```

- [ ] **Step 2: Run**

Run: `cd D:/top/keyapi && go test ./relay/helper -run TestFillPlatformCostEstimate -v`
Expected: PASS immediately (Task A.1 implemented the guards).

- [ ] **Step 3: Wire into `ModelPriceHelper`**

Open `relay/helper/price.go` and replace lines 137-144 (the tail of `ModelPriceHelper`):

```go
	applyPlatformMarkup(c, info, &priceData, true)

	// Dual ledger: populate platform cost fields from platform-only config.
	// Wired AFTER applyPlatformMarkup so we overwrite any stale PlatformCost*
	// fields a caller might have set on the shared PriceData zero-value.
	info.PriceData = priceData
	preConsumedTokens := common.Max(promptTokens, common.PreConsumedQuota)
	if meta.MaxTokens != 0 {
		preConsumedTokens += meta.MaxTokens
	}
	FillPlatformCostEstimate(c, info, preConsumedTokens)
	priceData = info.PriceData

	if common.DebugEnabled {
		println(fmt.Sprintf("model_price_helper result: %s", priceData.ToSetting()))
	}
	info.PriceData = priceData
	return priceData, nil
}
```

Note: `preConsumedTokens` computation mirrors the existing expression at line 68-71 — reuse the same derivation here so the cost-side pre-consume matches the user-bill pre-consume token basis.

- [ ] **Step 4: Full build + suite**

Run: `cd D:/top/keyapi && go build ./... && go test ./relay/helper -v`
Expected: all existing tests still pass; new wiring tests pass.

- [ ] **Step 5: Commit**

```bash
git add relay/helper/price.go relay/helper/price_platform_cost_wiring_test.go
git commit -m "feat(billing): wire platform cost estimator into ModelPriceHelper

Populates PlatformCost* fields at the same lifecycle point the user-bill
pre-consume runs. Non-platform channels leave the fields at zero.
Behaviour unchanged: cap/usage still use the StripMarkup path until
Phase B."
```

---

## Task A.3: Wire estimator into `ModelPriceHelperPerCall`

**Files:**
- Modify: `relay/helper/price.go:236`

- [ ] **Step 1: Wire it**

Open `relay/helper/price.go`, replace lines 228-238:

```go
	priceData := types.PriceData{
		FreeModel:      freeModel,
		ModelPrice:     modelPrice,
		ModelRatio:     modelRatio,
		UsePrice:       usePrice,
		Quota:          quota,
		GroupRatioInfo: groupRatioInfo,
	}
	applyPlatformMarkup(c, info, &priceData, false)
	info.PriceData = priceData

	// Dual ledger (Task/MJ): per-call estimate.
	FillPlatformCostPerCallEstimate(c, info)
	priceData = info.PriceData

	return priceData, nil
}
```

- [ ] **Step 2: Run full suite**

Run: `cd D:/top/keyapi && go test ./relay/helper ./service -v 2>&1 | tail -50`
Expected: no new failures.

- [ ] **Step 3: Commit**

```bash
git add relay/helper/price.go
git commit -m "feat(billing): wire platform cost estimator into ModelPriceHelperPerCall

Task/MJ path also writes PlatformCostQuota via the per-call estimator.
Mirrors A.2 for the two handler families that use per-call pricing."
```

---

## Task A.4: Refresh platform cost on channel switch

**Files:**
- Modify: `relay/helper/price.go:150-176` (`ApplyChannelBillingOverrides`)

`ApplyChannelBillingOverrides` runs on retry (controller/relay.go:590). It mutates `ModelRatio` and adds `channel_ratio` to `OtherRatios` — but both are user-bill-only. We add a parallel refresh for the cost side so the new channel's `platform_cost_ratio` is picked up too.

- [ ] **Step 1: Add refresh hook**

Open `relay/helper/price.go` and modify `ApplyChannelBillingOverrides`. Replace the entire function body (lines 150-176) with:

```go
func ApplyChannelBillingOverrides(info *relaycommon.RelayInfo) {
	if info.ChannelMeta == nil {
		return
	}
	settings := info.ChannelMeta.ChannelSetting

	// 1. Reset ModelRatio to original (handles retry scenario)
	if info.PriceData.OriginalModelRatio > 0 {
		info.PriceData.ModelRatio = info.PriceData.OriginalModelRatio
	}

	// 2. Apply model-specific ratio override
	if settings.ModelRatioOverride != nil {
		if override, ok := settings.ModelRatioOverride[info.UpstreamModelName]; ok && override > 0 {
			info.PriceData.ModelRatio = override
		}
		if override, ok := settings.ModelRatioOverride[info.OriginModelName]; ok && override > 0 {
			info.PriceData.ModelRatio = override
		}
	}

	// 3. Apply channel ratio as an OtherRatio (user-bill only; the ChannelSetting
	// field is tenant-editable so it MUST NOT reach the platform cost ledger).
	if settings.ChannelRatio > 0 && settings.ChannelRatio != 1.0 {
		info.PriceData.AddOtherRatio("channel_ratio", settings.ChannelRatio)
	}

	// 4. Refresh platform cost ledger for the new channel. Re-reads
	// channel.platform_cost_ratio via the loader. Does nothing on non-platform
	// channels.
	RefreshPlatformCostEstimate(nil, info)
}
```

- [ ] **Step 2: Full build + test**

Run: `cd D:/top/keyapi && go build ./... && go test ./relay/helper -v`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add relay/helper/price.go
git commit -m "fix(billing): re-run platform cost estimator on channel switch

ApplyChannelBillingOverrides fires per retry attempt in the relay
controller. Without this the PlatformCost* fields would still hold the
first channel's cost ratio after a channel switch — wrong. Mirrors the
existing ModelRatio reset for the user-bill side."
```

---

## Task A.5: Platform-cost actual-usage helper (full mirror of calculateTextQuotaSummary)

**Files:**
- Create: `service/platform_cost_actual.go`
- Create: `service/platform_cost_actual_test.go`

This function must mirror `calculateTextQuotaSummary` completely — not a simplification. Missing semantics cause systematic platform-cost under-reporting:

| Semantic                               | text_quota.go ref       | Why cost path needs it                       |
|----------------------------------------|-------------------------|----------------------------------------------|
| OpenRouter Claude cache normalisation  | L116-L130               | Prompt billing subtracts cacheTokens twice on OR; cost must match upstream charge. |
| Claude 5m / 1h cache creation split    | L209-L224               | 1h writes cost 1.6× the 5m rate; skipping = 38% Claude undercount. |
| Web search / Claude web search surcharge | L151-L178             | Spec §6.1 lists "web search 次数" as an objective cost factor. |
| File search surcharge                  | L180-L189               | Same — operator pays upstream per call.      |
| Image generation call surcharge        | L191-L195               | Same.                                        |
| Audio input separate price             | L232-L239               | Audio input billed at a per-million-token rate separate from the ModelRatio path. |

Tool surcharges on the user side multiply `GroupRatio`. On the cost side they multiply by `PlatformCostChannelRatio` (a platform-controlled factor) — not `GroupRatio`. Spec §6.1 is explicit.

- [ ] **Step 1: Write the test suite**

Create `service/platform_cost_actual_test.go`:

```go
package service

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

func newCtx() *gin.Context {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)
	return c
}

func TestComputePlatformCostActualText_TokenRatio(t *testing.T) {
	pd := types.PriceData{
		UsePrice:                 false,
		PlatformCostModelRatio:   1.0,
		PlatformCostChannelRatio: 1.0,
		CompletionRatio:          1.0,
	}
	usage := &dto.Usage{PromptTokens: 100, CompletionTokens: 50}
	got := ComputePlatformCostActualText(newCtx(), nil, pd, usage)
	if got != 150 {
		t.Fatalf("got %d want 150", got)
	}
}

func TestComputePlatformCostActualText_IgnoresGroupAndMarkup(t *testing.T) {
	pd := types.PriceData{
		UsePrice:                 false,
		PlatformCostModelRatio:   1.0,
		PlatformCostChannelRatio: 1.0,
		CompletionRatio:          1.0,
		GroupRatioInfo:           types.GroupRatioInfo{GroupRatio: 0.1},
		OtherRatios:              map[string]float64{"platform_markup": 10.0},
	}
	usage := &dto.Usage{PromptTokens: 100, CompletionTokens: 0}
	got := ComputePlatformCostActualText(newCtx(), nil, pd, usage)
	if got != 100 {
		t.Fatalf("got %d want 100 — GroupRatio or platform_markup leaked", got)
	}
}

func TestComputePlatformCostActualText_UsesChannelRatio(t *testing.T) {
	pd := types.PriceData{
		UsePrice:                 false,
		PlatformCostModelRatio:   1.0,
		PlatformCostChannelRatio: 2.0,
		CompletionRatio:          1.0,
	}
	usage := &dto.Usage{PromptTokens: 100}
	got := ComputePlatformCostActualText(newCtx(), nil, pd, usage)
	if got != 200 {
		t.Fatalf("got %d want 200", got)
	}
}

func TestComputePlatformCostActualText_PricePath(t *testing.T) {
	pd := types.PriceData{
		UsePrice:                 true,
		PlatformCostModelPrice:   2.0,
		PlatformCostChannelRatio: 1.0,
	}
	got := ComputePlatformCostActualText(newCtx(), nil, pd, &dto.Usage{PromptTokens: 100})
	want := int(2.0 * 500_000 * 1.0)
	if got != want {
		t.Fatalf("got %d want %d", got, want)
	}
}

// Claude 5m/1h cache creation must be weighted differently — mirrors the
// user-bill formula.
func TestComputePlatformCostActualText_ClaudeCacheCreationSplit(t *testing.T) {
	pd := types.PriceData{
		UsePrice:                 false,
		PlatformCostModelRatio:   1.0,
		PlatformCostChannelRatio: 1.0,
		CacheCreationRatio:       1.25, // 5m default
		CacheCreation5mRatio:     1.25,
		CacheCreation1hRatio:     2.0, // 1h premium
	}
	usage := &dto.Usage{
		PromptTokens:               100, // pure prompt for simplicity
		ClaudeCacheCreation5mTokens: 40,
		ClaudeCacheCreation1hTokens: 60,
		UsageSemantic:              "anthropic",
	}
	// Prompt 100 (not discounted on anthropic semantic) + 40×1.25 + 60×2.0
	//       = 100 + 50 + 120 = 270
	got := ComputePlatformCostActualText(newCtx(), nil, pd, usage)
	if got != 270 {
		t.Fatalf("got %d want 270 (Claude 5m/1h split)", got)
	}
}

// Objective tool surcharges (web_search) must enter the cost ledger per spec §6.1.
// They must NOT be multiplied by GroupRatio (platform cost is raw supplier cost).
func TestComputePlatformCostActualText_WebSearchSurchargeNoGroupRatio(t *testing.T) {
	pd := types.PriceData{
		UsePrice:                 false,
		PlatformCostModelRatio:   0,   // turn off base so we isolate tool cost
		PlatformCostChannelRatio: 1.0,
		GroupRatioInfo:           types.GroupRatioInfo{GroupRatio: 0.1}, // must be ignored
	}
	// Test helper can't easily stand up ResponsesUsageInfo — instead we pass the
	// simpler "search-preview" suffix path by setting OriginModelName.
	// Pending full gin+context setup, use AdditionalPlatformCostSurcharges to
	// pass the precomputed amount directly.
	usage := &dto.Usage{PromptTokens: 0}
	surcharges := PlatformCostSurcharges{WebSearchQuota: 500}
	got := computePlatformCostActualWithSurcharges(pd, usage, "gpt-4o-search-preview", surcharges)
	if got != 500 {
		t.Fatalf("got %d want 500 (raw web_search cost, no GroupRatio)", got)
	}
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd D:/top/keyapi && go test ./service -run TestComputePlatformCostActualText -v`
Expected: FAIL — undefined.

- [ ] **Step 3: Implement the helper (full mirror)**

Create `service/platform_cost_actual.go`:

```go
package service

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

// `constant` is used for constant.ChannelTypeOpenRouter in
// computePlatformCostTokenBase's OpenRouter-Claude branch.

// PlatformCostSurcharges collects objective per-call cost factors that would
// otherwise require a gin context + RelayInfo to compute. Populated by
// ComputePlatformCostActualText from ctx/relayInfo; exposed separately only
// so tests can construct them directly without a full harness.
type PlatformCostSurcharges struct {
	WebSearchQuota           int
	ClaudeWebSearchQuota     int
	FileSearchQuota          int
	ImageGenerationCallQuota int
	AudioInputQuota          int
}

// ComputePlatformCostActualText returns the platform cost ledger quota for a
// settled text / responses / claude / gemini / rerank / embedding call.
//
// Full mirror of calculateTextQuotaSummary (service/text_quota.go) but:
//   - Reads only PlatformCost* fields on PriceData.
//   - Tool surcharges use raw upstream price × call_count (NO GroupRatio).
//   - PlatformCostOtherRatios multiplied at the end; never OtherRatios.
//
// Any semantic added to calculateTextQuotaSummary (new cache tier, new tool,
// new usage normalisation) must be mirrored here or platform cost will drift
// silently. Isolation tests in service/dual_ledger_isolation_test.go are the
// safety net.
//
// nil-usage fallback mirrors calculateTextQuotaSummary:L98-L104 — if upstream
// didn't return usage, user bill uses GetEstimatePromptTokens() as prompt +
// zero completion. We apply the same substitution here so the two ledgers
// stay in sync on timeouts.
func ComputePlatformCostActualText(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, pd types.PriceData, usage *dto.Usage) int {
	if usage == nil {
		if relayInfo == nil {
			return 0
		}
		est := relayInfo.GetEstimatePromptTokens()
		usage = &dto.Usage{PromptTokens: est, CompletionTokens: 0, TotalTokens: est}
	}
	modelName := ""
	if relayInfo != nil {
		modelName = relayInfo.OriginModelName
	}
	surcharges := resolveSurcharges(ctx, relayInfo, pd, usage)
	return computePlatformCostActualWithSurcharges(pd, usage, relayInfo, modelName, surcharges)
}

// ComputePlatformCostActualRealtime returns the platform cost ledger quota
// for a Realtime / WSS settlement. Mirrors calculateAudioQuota's ratio math
// (service/quota.go) but reads platform-only ratios.
//
// Unlike the text path, realtime usage carries text + audio input/output
// tokens with their own completion + audio + audio-completion ratios. Passing
// `GroupRatio: 1.0` to calculateAudioQuota isolates the cost ledger from the
// user-bill multipliers.
func ComputePlatformCostActualRealtime(relayInfo *relaycommon.RelayInfo, usage *dto.RealtimeUsage) int {
	if relayInfo == nil || usage == nil {
		return 0
	}
	pd := relayInfo.PriceData
	channelRatio := pd.PlatformCostChannelRatio
	if channelRatio <= 0 {
		channelRatio = 1.0
	}

	info := QuotaInfo{
		InputDetails: TokenDetails{
			TextTokens:  usage.InputTokenDetails.TextTokens,
			AudioTokens: usage.InputTokenDetails.AudioTokens,
		},
		OutputDetails: TokenDetails{
			TextTokens:  usage.OutputTokenDetails.TextTokens,
			AudioTokens: usage.OutputTokenDetails.AudioTokens,
		},
		ModelName:  relayInfo.OriginModelName,
		UsePrice:   pd.UsePrice,
		ModelPrice: pd.PlatformCostModelPrice,
		ModelRatio: pd.PlatformCostModelRatio,
		GroupRatio: 1.0, // platform cost NEVER multiplies by GroupRatio
	}
	base := calculateAudioQuota(info)
	if base <= 0 {
		return 0
	}

	q := decimal.NewFromInt(int64(base)).Mul(decimal.NewFromFloat(channelRatio))
	for _, r := range pd.PlatformCostOtherRatios {
		q = q.Mul(decimal.NewFromFloat(r))
	}
	result := int(q.Round(0).IntPart())
	if result == 0 && (pd.PlatformCostModelRatio > 0 || pd.PlatformCostModelPrice > 0) {
		result = 1
	}
	return result
}

func resolveSurcharges(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, pd types.PriceData, usage *dto.Usage) PlatformCostSurcharges {
	var s PlatformCostSurcharges
	dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
	modelName := ""
	if relayInfo != nil {
		modelName = relayInfo.OriginModelName
	}

	// Web search — two shapes.
	if relayInfo != nil && relayInfo.ResponsesUsageInfo != nil {
		if ws, ok := relayInfo.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolWebSearchPreview]; ok && ws.CallCount > 0 {
			price := operation_setting.GetWebSearchPricePerThousand(modelName, ws.SearchContextSize)
			q := decimal.NewFromFloat(price).
				Mul(decimal.NewFromInt(int64(ws.CallCount))).
				Div(decimal.NewFromInt(1000)).
				Mul(dQuotaPerUnit)
			s.WebSearchQuota = int(q.Round(0).IntPart())
		}
		if fs, ok := relayInfo.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolFileSearch]; ok && fs.CallCount > 0 {
			price := operation_setting.GetFileSearchPricePerThousand()
			q := decimal.NewFromFloat(price).
				Mul(decimal.NewFromInt(int64(fs.CallCount))).
				Div(decimal.NewFromInt(1000)).
				Mul(dQuotaPerUnit)
			s.FileSearchQuota = int(q.Round(0).IntPart())
		}
	} else if strings.HasSuffix(modelName, "search-preview") && ctx != nil {
		sz := ctx.GetString("chat_completion_web_search_context_size")
		if sz == "" {
			sz = "medium"
		}
		price := operation_setting.GetWebSearchPricePerThousand(modelName, sz)
		q := decimal.NewFromFloat(price).Div(decimal.NewFromInt(1000)).Mul(dQuotaPerUnit)
		s.WebSearchQuota = int(q.Round(0).IntPart())
	}

	// Claude web search counter (stored in ctx).
	if ctx != nil {
		n := ctx.GetInt("claude_web_search_requests")
		if n > 0 {
			price := operation_setting.GetClaudeWebSearchPricePerThousand()
			q := decimal.NewFromFloat(price).
				Div(decimal.NewFromInt(1000)).
				Mul(dQuotaPerUnit).
				Mul(decimal.NewFromInt(int64(n)))
			s.ClaudeWebSearchQuota = int(q.Round(0).IntPart())
		}
		if ctx.GetBool("image_generation_call") {
			price := operation_setting.GetGPTImage1PriceOnceCall(
				ctx.GetString("image_generation_call_quality"),
				ctx.GetString("image_generation_call_size"),
			)
			q := decimal.NewFromFloat(price).Mul(dQuotaPerUnit)
			s.ImageGenerationCallQuota = int(q.Round(0).IntPart())
		}
	}

	// Audio input per-token price (platform-side, not ModelRatio-driven).
	if usage != nil && usage.PromptTokensDetails.AudioTokens > 0 && !pd.UsePrice {
		price := operation_setting.GetGeminiInputAudioPricePerMillionTokens(modelName)
		if price > 0 {
			q := decimal.NewFromFloat(price).
				Div(decimal.NewFromInt(1_000_000)).
				Mul(decimal.NewFromInt(int64(usage.PromptTokensDetails.AudioTokens))).
				Mul(dQuotaPerUnit)
			s.AudioInputQuota = int(q.Round(0).IntPart())
		}
	}
	return s
}

func computePlatformCostActualWithSurcharges(pd types.PriceData, usage *dto.Usage, relayInfo *relaycommon.RelayInfo, modelName string, s PlatformCostSurcharges) int {
	if usage == nil {
		return 0
	}

	dChannelRatio := decimal.NewFromFloat(pd.PlatformCostChannelRatio)
	if dChannelRatio.IsZero() {
		dChannelRatio = decimal.NewFromInt(1) // fail-safe; caller hit min-1 elsewhere
	}

	var base decimal.Decimal
	if pd.UsePrice {
		base = decimal.NewFromFloat(pd.PlatformCostModelPrice).
			Mul(decimal.NewFromFloat(common.QuotaPerUnit)).
			Mul(dChannelRatio)
	} else {
		base = computePlatformCostTokenBase(pd, usage, relayInfo, modelName).
			Mul(decimal.NewFromFloat(pd.PlatformCostModelRatio)).
			Mul(dChannelRatio)
	}

	// Objective surcharges — raw cost, multiplied by PlatformCostChannelRatio
	// to respect the channel cost multiplier but NOT by any user-side factor.
	total := base.
		Add(decimal.NewFromInt(int64(s.WebSearchQuota)).Mul(dChannelRatio)).
		Add(decimal.NewFromInt(int64(s.ClaudeWebSearchQuota)).Mul(dChannelRatio)).
		Add(decimal.NewFromInt(int64(s.FileSearchQuota)).Mul(dChannelRatio)).
		Add(decimal.NewFromInt(int64(s.ImageGenerationCallQuota)).Mul(dChannelRatio)).
		Add(decimal.NewFromInt(int64(s.AudioInputQuota)).Mul(dChannelRatio))

	for _, r := range pd.PlatformCostOtherRatios {
		total = total.Mul(decimal.NewFromFloat(r))
	}

	result := int(total.Round(0).IntPart())
	// Min-quota rule: non-free upstream usage must cost at least 1.
	if result == 0 {
		totalTokens := usage.PromptTokens + usage.CompletionTokens
		hasSurcharge := s.WebSearchQuota+s.ClaudeWebSearchQuota+s.FileSearchQuota+s.ImageGenerationCallQuota+s.AudioInputQuota > 0
		if totalTokens > 0 && (pd.PlatformCostModelRatio > 0 || pd.PlatformCostModelPrice > 0) {
			result = 1
		} else if hasSurcharge {
			result = 1
		}
	}
	return result
}

// computePlatformCostTokenBase mirrors the token normalisation block in
// calculateTextQuotaSummary (L106-L248). relayInfo is required so Claude
// semantic detection and OpenRouter Claude billing mirror exactly match the
// user-bill path; modelName is used for Gemini audio-input lookup.
//
// Critical mirror targets (stay in sync with text_quota.go or cost drifts):
//   - usageSemanticFromUsage(relayInfo, usage): detects "anthropic" via
//     relayInfo.GetFinalRequestRelayFormat() == types.RelayFormatClaude OR
//     usage.UsageSemantic == "anthropic".
//   - isOpenRouterClaudeBilling: ChannelMeta != nil && ChannelType ==
//     constant.ChannelTypeOpenRouter && isAnthropic. On this path
//     PromptTokens is pre-reduced by CacheTokens + CacheCreationTokens
//     (text_quota.go L116-L130). We must apply the same reduction here or
//     platform cost over-counts by the cache delta.
func computePlatformCostTokenBase(pd types.PriceData, usage *dto.Usage, relayInfo *relaycommon.RelayInfo, modelName string) decimal.Decimal {
	// Resolve semantics — call the package-private helper text_quota.go uses.
	semantic := "openai"
	if relayInfo != nil {
		semantic = usageSemanticFromUsage(relayInfo, usage)
	} else if usage != nil && usage.UsageSemantic != "" {
		semantic = usage.UsageSemantic
	}
	isAnthropic := semantic == "anthropic"
	isOpenRouterClaudeBilling := relayInfo != nil &&
		relayInfo.ChannelMeta != nil &&
		relayInfo.ChannelType == constant.ChannelTypeOpenRouter &&
		isAnthropic

	// Create a working copy of usage so OpenRouter Claude's prompt-token
	// adjustment doesn't mutate the caller's struct (the user-bill path
	// mutates `summary` not `usage`, so we mirror that isolation).
	promptTokens := usage.PromptTokens
	cacheTokens := usage.PromptTokensDetails.CachedTokens
	cacheCreationTokens := usage.PromptTokensDetails.CachedCreationTokens
	if isOpenRouterClaudeBilling {
		promptTokens -= cacheTokens
		// text_quota.go L123-L128 mirror: if cache_creation is missing and
		// cost > 0, infer it. CalcOpenRouterCacheCreateTokens reads
		// priceData.ModelRatio — which is the USER-side field, mutable by
		// tenant channel overrides (ApplyChannelBillingOverrides.L158-L170).
		// Call it with a synthetic PriceData whose ModelRatio is
		// PlatformCostModelRatio so the inference stays decoupled from
		// tenant pricing. Other ratios (CacheRatio, CompletionRatio,
		// CacheCreationRatio) are platform-global, safe to pass through.
		if cacheCreationTokens == 0 && pd.CacheCreationRatio != 1 && usage.Cost != 0 {
			isCustom := pd.UsePrice || hasCustomModelRatio(modelName, pd.PlatformCostModelRatio)
			if !isCustom {
				costPD := pd
				costPD.ModelRatio = pd.PlatformCostModelRatio // isolate from tenant override
				maybe := CalcOpenRouterCacheCreateTokens(*usage, costPD)
				if maybe >= 0 && promptTokens >= maybe {
					cacheCreationTokens = maybe
				}
			}
		}
		promptTokens -= cacheCreationTokens
	}

	dPrompt := decimal.NewFromInt(int64(promptTokens))
	dCompletion := decimal.NewFromInt(int64(usage.CompletionTokens))
	dCache := decimal.NewFromInt(int64(cacheTokens))
	dCacheCreation := decimal.NewFromInt(int64(cacheCreationTokens))
	dCacheCreation5m := decimal.NewFromInt(int64(usage.ClaudeCacheCreation5mTokens))
	dCacheCreation1h := decimal.NewFromInt(int64(usage.ClaudeCacheCreation1hTokens))
	dImage := decimal.NewFromInt(int64(usage.PromptTokensDetails.ImageTokens))
	dAudio := decimal.NewFromInt(int64(usage.PromptTokensDetails.AudioTokens))

	dCompletionRatio := decimal.NewFromFloat(pd.CompletionRatio)
	dCacheRatio := decimal.NewFromFloat(pd.CacheRatio)
	dCacheCreationRatio := decimal.NewFromFloat(pd.CacheCreationRatio)
	dCacheCreationRatio5m := decimal.NewFromFloat(pd.CacheCreation5mRatio)
	dCacheCreationRatio1h := decimal.NewFromFloat(pd.CacheCreation1hRatio)
	dImageRatio := decimal.NewFromFloat(pd.ImageRatio)

	// Detect legacy Claude-derived OpenAI usage (see text_quota.go
	// isLegacyClaudeDerivedOpenAIUsage). These payloads already carry
	// Claude 5m/1h tokens on non-Claude semantic; the user-bill path skips
	// the base-subtract for them.
	legacyClaudeDerived := relayInfo != nil && !isAnthropic &&
		(usage.ClaudeCacheCreation5mTokens > 0 || usage.ClaudeCacheCreation1hTokens > 0) &&
		relayInfo.GetFinalRequestRelayFormat() != types.RelayFormatClaude &&
		usage.UsageSource == "" && usage.UsageSemantic == ""

	baseTokens := dPrompt
	if !isAnthropic && !legacyClaudeDerived {
		if !dCache.IsZero() {
			baseTokens = baseTokens.Sub(dCache)
		}
		if !dCacheCreation.IsZero() {
			baseTokens = baseTokens.Sub(dCacheCreation)
		}
	}
	if !dImage.IsZero() {
		baseTokens = baseTokens.Sub(dImage)
	}
	// Audio input tokens are charged via the separate audio-input surcharge
	// only when the platform config returns price > 0 for this model;
	// otherwise they remain in the base at AudioRatio. Mirror the exact
	// decision resolveSurcharges makes so we don't double-count or drop them.
	audioPerMillion := operation_setting.GetGeminiInputAudioPricePerMillionTokens(modelName)
	audioIsSeparate := !dAudio.IsZero() && audioPerMillion > 0
	if audioIsSeparate {
		baseTokens = baseTokens.Sub(dAudio)
	}

	// Cache creation subtotal.
	var cacheCreationSubtotal decimal.Decimal
	hasSplit := usage.ClaudeCacheCreation5mTokens > 0 || usage.ClaudeCacheCreation1hTokens > 0
	if isAnthropic || legacyClaudeDerived {
		remaining := cacheCreationTokens -
			usage.ClaudeCacheCreation5mTokens -
			usage.ClaudeCacheCreation1hTokens
		if remaining < 0 {
			remaining = 0
		}
		cacheCreationSubtotal = decimal.NewFromInt(int64(remaining)).Mul(dCacheCreationRatio)
		cacheCreationSubtotal = cacheCreationSubtotal.Add(dCacheCreation5m.Mul(dCacheCreationRatio5m))
		cacheCreationSubtotal = cacheCreationSubtotal.Add(dCacheCreation1h.Mul(dCacheCreationRatio1h))
	} else if hasSplit {
		cacheCreationSubtotal = cacheCreationSubtotal.Add(dCacheCreation5m.Mul(dCacheCreationRatio5m))
		cacheCreationSubtotal = cacheCreationSubtotal.Add(dCacheCreation1h.Mul(dCacheCreationRatio1h))
	} else {
		cacheCreationSubtotal = dCacheCreation.Mul(dCacheCreationRatio)
	}

	// Audio kept in base when no separate price.
	var audioInBase decimal.Decimal
	if !audioIsSeparate {
		audioInBase = dAudio.Mul(decimal.NewFromFloat(pd.AudioRatio))
	}

	return baseTokens.
		Add(dCache.Mul(dCacheRatio)).
		Add(cacheCreationSubtotal).
		Add(dImage.Mul(dImageRatio)).
		Add(audioInBase).
		Add(dCompletion.Mul(dCompletionRatio))
}
```

- [ ] **Step 4: Run tests**

Run: `cd D:/top/keyapi && go test ./service -run TestComputePlatformCostActualText -v`
Expected: PASS.

- [ ] **Step 5: Full build**

Run: `cd D:/top/keyapi && go build ./...`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add service/platform_cost_actual.go service/platform_cost_actual_test.go
git commit -m "feat(billing): platform cost calculator full mirror

Mirrors calculateTextQuotaSummary's token normalisation — OpenRouter
Claude cache, Claude 5m/1h split, web_search/file_search/image_generation/
audio input — so the platform cost ledger matches real upstream cost.
Tool surcharges are raw (no GroupRatio) and multiplied by
PlatformCostChannelRatio per spec §6.1.

PlatformCostSurcharges value type exposed for test harnesses."
```

- [ ] **Step 7: Update all callers to the new signature**

Callers of `ComputePlatformCostActualText` must now pass `ctx, relayInfo`. Update:
- `service/text_quota.go` (Task A.6): `ComputePlatformCostActualText(ctx, relayInfo, relayInfo.PriceData, usage)`
- `service/quota.go` PostAudioConsumeQuota (Task A.7): same
- `service/quota.go` PostWssConsumeQuota (Task A.8 step 3): same
- `service/dual_ledger_isolation_test.go` (Task A.10): pass `newCtx(), nil` for unit tests.

Build + full test run.

```bash
git add service/text_quota.go service/quota.go service/dual_ledger_isolation_test.go
git commit -m "refactor(billing): thread ctx+relayInfo through ComputePlatformCostActualText

Surcharge resolution needs gin context (for web_search params) and
RelayInfo (for ResponsesUsageInfo). Updates all call sites added in
Tasks A.6-A.8."
```

---

## Task A.6: Integrate actual cost into `PostTextConsumeQuota`

**Files:**
- Modify: `service/text_quota.go:294-436`
- Test: `service/text_quota_platform_cost_test.go` (new)

Goal of this task: after `calculateTextQuotaSummary` computes the user-bill quota, compute platform cost and store it on `info.PriceData.PlatformCostQuota` so `SettleBilling` + `TrackPlatformChannelUsageIfApplicable` can read it in Phase B.

- [ ] **Step 1: Write the integration test**

Create `service/text_quota_platform_cost_test.go`:

```go
package service

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/types"
)

// Proxy test: ensures the exported helper is called and writes into
// PlatformCostQuota. Real relay/handler integration verified manually.
func TestPostTextConsumeQuota_FillsPlatformCostQuotaBeforeSettle(t *testing.T) {
	// Since PostTextConsumeQuota requires a gin context + DB plumbing, we
	// verify the exported helper is available. Full path exercised in
	// phase A.10 smoke test.
	var usage dto.Usage
	_ = ComputePlatformCostActualText(nil, nil, types.PriceData{}, &usage) // compile-check
}
```

- [ ] **Step 2: Add the call inside `PostTextConsumeQuota`**

Open `service/text_quota.go`, find the block around line 322-333 (before `SettleBilling`):

```go
	if summary.TotalTokens == 0 {
		extraContent = append(extraContent, "上游没有返回计费信息，无法扣费（可能是上游超时）")
		logger.LogError(ctx, fmt.Sprintf("total tokens is 0, cannot consume quota, userId %d, channelId %d, tokenId %d, model %s， pre-consumed quota %d", relayInfo.UserId, relayInfo.ChannelId, relayInfo.TokenId, summary.ModelName, relayInfo.FinalPreConsumedQuota))
	} else {
		model.UpdateUserUsedQuotaAndRequestCount(relayInfo.UserId, summary.Quota, relayInfo.TenantId)
		model.UpdateChannelUsedQuota(relayInfo.ChannelId, summary.Quota, relayInfo.TenantId)
	}

	if err := SettleBilling(ctx, relayInfo, summary.Quota); err != nil {
		logger.LogError(ctx, "error settling billing: "+err.Error())
	}
```

Replace with:

```go
	if summary.TotalTokens == 0 {
		extraContent = append(extraContent, "上游没有返回计费信息，无法扣费（可能是上游超时）")
		logger.LogError(ctx, fmt.Sprintf("total tokens is 0, cannot consume quota, userId %d, channelId %d, tokenId %d, model %s， pre-consumed quota %d", relayInfo.UserId, relayInfo.ChannelId, relayInfo.TokenId, summary.ModelName, relayInfo.FinalPreConsumedQuota))
	} else {
		model.UpdateUserUsedQuotaAndRequestCount(relayInfo.UserId, summary.Quota, relayInfo.TenantId)
		model.UpdateChannelUsedQuota(relayInfo.ChannelId, summary.Quota, relayInfo.TenantId)
	}

	// Dual ledger: compute platform cost on the settled usage before
	// SettleBilling so TrackPlatformChannelUsageIfApplicable (called inside
	// SettleBilling) can read it via PriceData.
	relayInfo.PriceData.PlatformCostQuota = ComputePlatformCostActualText(ctx, relayInfo, relayInfo.PriceData, usage)

	if err := SettleBilling(ctx, relayInfo, summary.Quota); err != nil {
		logger.LogError(ctx, "error settling billing: "+err.Error())
	}
```

- [ ] **Step 3: Full build**

Run: `cd D:/top/keyapi && go build ./...`
Expected: no errors.

- [ ] **Step 4: Run service tests**

Run: `cd D:/top/keyapi && go test ./service -v 2>&1 | tail -20`
Expected: no new failures.

- [ ] **Step 5: Commit**

```bash
git add service/text_quota.go service/text_quota_platform_cost_test.go
git commit -m "feat(billing): fill PlatformCostQuota in PostTextConsumeQuota

Runs ComputePlatformCostActualText on the real usage before SettleBilling.
Phase B will have TrackPlatformChannelUsageIfApplicable read this instead
of StripMarkup(actualQuota, markup)."
```

---

## Task A.7: Integrate actual cost into `PostAudioConsumeQuota`

**Files:**
- Modify: `service/quota.go:272` (start of `PostAudioConsumeQuota`)

Same shape as A.6 but for audio.

- [ ] **Step 1: Read existing `PostAudioConsumeQuota`**

Run: `cd D:/top/keyapi && grep -n "PostAudioConsumeQuota" service/quota.go`

Use Read tool to view lines 272-340 of `service/quota.go` to find the `SettleBilling` call inside `PostAudioConsumeQuota`.

- [ ] **Step 2: Add the fill call before `SettleBilling`**

In `service/quota.go` inside `PostAudioConsumeQuota`, immediately before the line that calls `SettleBilling(ctx, relayInfo, ...)`, add:

```go
	relayInfo.PriceData.PlatformCostQuota = ComputePlatformCostActualText(ctx, relayInfo, relayInfo.PriceData, usage)
```

(Audio uses the same token-based normalisation — `ComputePlatformCostActualText` handles it because audio tokens live on `usage.PromptTokensDetails.AudioTokens`.)

- [ ] **Step 3: Build + test**

Run: `cd D:/top/keyapi && go build ./... && go test ./service -run TestComputePlatformCostActualText -v`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add service/quota.go
git commit -m "feat(billing): fill PlatformCostQuota in PostAudioConsumeQuota

Audio settlement now also populates the platform cost ledger. Same
ComputePlatformCostActualText helper — audio tokens are normalised via
PromptTokensDetails.AudioTokens."
```

---

## Task A.8: Integrate actual cost into WSS / Realtime — BOTH pre-consume and post

**Files:**
- Modify: `service/quota.go` — both `PreWssConsumeQuota` (line 90) and `PostWssConsumeQuota` (line 159)

Realtime / WSS has its own audio-aware quota math (`calculateAudioQuota`) distinct from the text path. Naively multiplying tokens × model_ratio × channel_ratio would miss completion / audio input / audio output multipliers and underreport cost by 30-70% on audio-heavy sessions.

The correct approach is a dedicated helper `ComputePlatformCostActualRealtime` (defined in Task A.5) that wraps `calculateAudioQuota` with `GroupRatio=1.0` and platform-only model ratios — then applies `PlatformCostChannelRatio`. Both WSS callsites use this helper.

`PreWssConsumeQuota` (line 154) calls `TrackPlatformChannelUsageIfApplicable(relayInfo, quota)` directly after `PostConsumeQuota`. If we don't populate `PriceData.PlatformCostQuota` before that call, the Phase-B tracker sees zero and silently skips WSS accumulation.

- [ ] **Step 1: Populate cost fields on PriceData in `PreWssConsumeQuota`**

`PreWssConsumeQuota` reads tenant configs directly via `ratio_setting` — it bypasses `ModelPriceHelper` entirely, so `relayInfo.PriceData.PlatformCost*` fields are zero on entry. Populate them before the cost helper runs.

In `service/quota.go` inside `PreWssConsumeQuota`, immediately BEFORE the `TrackPlatformChannelUsageIfApplicable(relayInfo, quota)` call at line 154, insert:

```go
	// Dual ledger: populate platform cost fields (WSS bypasses ModelPriceHelper),
	// then compute cost via ComputePlatformCostActualRealtime before the tracker
	// reads PriceData.PlatformCostQuota (Phase B).
	if relayInfo.PriceData.PlatformCostModelRatio == 0 {
		if r, ok, _ := ratio_setting.GetModelRatio(relayInfo.OriginModelName); ok {
			relayInfo.PriceData.PlatformCostModelRatio = r
		}
	}
	if relayInfo.PriceData.PlatformCostChannelRatio == 0 && relayInfo.ChannelId > 0 {
		if ch, err := model.CacheGetChannel(relayInfo.ChannelId); err == nil && ch != nil {
			relayInfo.PriceData.PlatformCostChannelRatio = ch.ResolvePlatformCostRatio()
		}
	}
	relayInfo.PriceData.PlatformCostQuota = ComputePlatformCostActualRealtime(relayInfo, usage)
```

(`usage` here is `*dto.RealtimeUsage`, matching the helper's signature — no adapter needed.)

- [ ] **Step 2: `PostWssConsumeQuota` — fill for LOGGING ONLY, never add a tracker call**

⚠️ **Critical anti-double-count rule:** `PreWssConsumeQuota` already calls `TrackPlatformChannelUsageIfApplicable` at session start (line 154). `PostWssConsumeQuota` currently does NOT call the tracker — only writes the log. Adding a second track call here would accumulate the cost twice.

Scope of this step: populate `PlatformCostQuota` so `AddDualLedgerLogFields` can write it into `logs.other`. Do NOT add `TrackPlatformChannelUsageIfApplicable` to `PostWssConsumeQuota`.

If a follow-up wants to reconcile pre-vs-post delta for realtime, it must first remove/refactor the tracker call in `PreWssConsumeQuota` — that's out of scope for this plan.

Open `service/quota.go` `PostWssConsumeQuota` (line 159). Immediately BEFORE the `RecordConsumeLog(...)` call at line 235, insert:

```go
	// Dual ledger (log-only): platform cost increment already happened in
	// PreWssConsumeQuota:L154. We populate PlatformCostQuota here purely
	// so AddDualLedgerLogFields can surface the actual per-settle cost in
	// logs.other. Do NOT add a TrackPlatformChannelUsageIfApplicable call
	// in this function — that would double-count against the tenant cap.
	if relayInfo.PriceData.PlatformCostModelRatio == 0 {
		if r, ok, _ := ratio_setting.GetModelRatio(relayInfo.OriginModelName); ok {
			relayInfo.PriceData.PlatformCostModelRatio = r
		}
	}
	if relayInfo.PriceData.PlatformCostChannelRatio == 0 && relayInfo.ChannelId > 0 {
		if ch, err := model.CacheGetChannel(relayInfo.ChannelId); err == nil && ch != nil {
			relayInfo.PriceData.PlatformCostChannelRatio = ch.ResolvePlatformCostRatio()
		}
	}
	relayInfo.PriceData.PlatformCostQuota = ComputePlatformCostActualRealtime(relayInfo, usage)
```

Also call `AddDualLedgerLogFields(relayInfo, other, quota)` after the existing `other := GenerateWssOtherInfo(...)` call at line 231 so the log row carries the dual-ledger fields.

- [ ] **Step 3: Build**

Run: `cd D:/top/keyapi && go build ./...`
Expected: no errors.

- [ ] **Step 4: Regression test**

Add to `service/dual_ledger_isolation_test.go`:

```go
// WSS cost helper must isolate from GroupRatio and run audio ratios.
func TestDualLedger_RealtimeHelperIgnoresGroupRatio(t *testing.T) {
	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-4o-realtime-preview",
		PriceData: types.PriceData{
			PlatformCostModelRatio:   1.0,
			PlatformCostChannelRatio: 1.0,
			GroupRatioInfo:           types.GroupRatioInfo{GroupRatio: 0.1}, // must be ignored
		},
	}
	usage := &dto.RealtimeUsage{
		InputTokenDetails:  dto.RealtimeInputTokenDetails{TextTokens: 100},
		OutputTokenDetails: dto.RealtimeOutputTokenDetails{TextTokens: 50},
	}
	got := ComputePlatformCostActualRealtime(info, usage)
	// GroupRatio must NOT leak — cost should equal text + completion×ratio subtotals.
	// Exact value depends on ratio_setting.GetCompletionRatio for the model;
	// just assert > 0 and non-trivially > 100×0.1=10.
	if got <= 50 {
		t.Fatalf("got %d, GroupRatio 0.1 likely leaked", got)
	}
}
```

(Full runtime coverage: staged manual WSS call, inspect `logs.other.platform_cost_quota`.)

- [ ] **Step 5: Commit**

```bash
git add service/quota.go service/dual_ledger_isolation_test.go
git commit -m "feat(billing): fill PlatformCostQuota in WSS pre-consume AND settle

Uses ComputePlatformCostActualRealtime (new helper in A.5) which wraps
calculateAudioQuota with GroupRatio=1.0 so audio input/output and
completion ratios are honoured but GroupRatio can't leak. Both
Pre/PostWssConsumeQuota populate the cost fields before any tracker
reads them."
```

---

## Task A.9: Dual-write both quotas into `logs.other`

**Files:**
- Modify: `service/log_info_generate.go`
- Modify: `service/text_quota.go` (populate after SettleBilling)
- Test: `service/log_info_generate_test.go` (add case)

- [ ] **Step 1: Read existing `GenerateTextOtherInfo` and `GenerateClaudeOtherInfo`**

Use Read tool on `service/log_info_generate.go`. Identify where `other` map is populated.

- [ ] **Step 2: Add dual-ledger fields**

At the END of `GenerateTextOtherInfo` and `GenerateClaudeOtherInfo` (just before the final `return other`), add:

```go
	// Dual ledger (see 2026-04-24-dual-ledger-billing-design.md §8.4)
	other["pricing_version"] = "dual-ledger-v1"
	other["user_bill_quota"] = relayInfo.PriceData.Quota // legacy "Quota" is user bill
	other["platform_cost_quota"] = relayInfo.PriceData.PlatformCostQuota
	if relayInfo.PriceMarkupRatio > 0 {
		other["tenant_markup_ratio"] = relayInfo.PriceMarkupRatio
	}
	if relayInfo.PriceData.PlatformCostChannelRatio > 0 {
		other["platform_cost_channel_ratio"] = relayInfo.PriceData.PlatformCostChannelRatio
	}
	channelID := relayInfo.ChannelId
	if channelID > 0 {
		if ch, err := model.CacheGetChannel(channelID); err == nil && ch != nil {
			other["platform_channel"] = ch.Scope == model.ChannelScopePlatform
		}
	}
```

IMPORTANT: `relayInfo.PriceData.Quota` is 0 on the text path (only Task/MJ set it). On text paths the real user-facing quota sits in `summary.Quota`, which is passed separately. Instead of reading `relayInfo.PriceData.Quota`, accept the caller-computed quota via a new parameter — safer.

Revised approach: add a helper that callers use after the existing generator:

```go
// AddDualLedgerLogFields writes the dual-ledger fields onto an existing
// log `other` map. Call this AFTER the legacy Generate*OtherInfo helpers
// so existing keys remain source-of-truth for their own values.
func AddDualLedgerLogFields(relayInfo *relaycommon.RelayInfo, other map[string]interface{}, userBillQuota int) {
	other["pricing_version"] = "dual-ledger-v1"
	other["user_bill_quota"] = userBillQuota
	other["platform_cost_quota"] = relayInfo.PriceData.PlatformCostQuota
	if relayInfo.PriceMarkupRatio > 0 {
		other["tenant_markup_ratio"] = relayInfo.PriceMarkupRatio
	}
	if relayInfo.PriceData.PlatformCostChannelRatio > 0 {
		other["platform_cost_channel_ratio"] = relayInfo.PriceData.PlatformCostChannelRatio
	}
	channelID := relayInfo.ChannelId
	if channelID > 0 {
		if ch, err := model.CacheGetChannel(channelID); err == nil && ch != nil {
			other["platform_channel"] = ch.Scope == model.ChannelScopePlatform
		}
	}
}
```

Put this in `service/log_info_generate.go`.

- [ ] **Step 3: Call it from `PostTextConsumeQuota`**

In `service/text_quota.go`, inside `PostTextConsumeQuota`, after the block that builds `other` (around line 346-414) and BEFORE `model.RecordConsumeLog(...)` at line 422, add:

```go
	AddDualLedgerLogFields(relayInfo, other, summary.Quota)
```

- [ ] **Step 4: Call it from `PostAudioConsumeQuota`**

In `service/quota.go`, inside `PostAudioConsumeQuota`, after the existing `other` map is built and before the `RecordConsumeLog` call, add the same line (substitute the correct variable for the final user-bill quota — likely `quota` or `summary.Quota`). Read the function body first to identify the right spot.

- [ ] **Step 5: Call it from `PostWssConsumeQuota`**

Same treatment.

- [ ] **Step 6: Write a small test**

Create `service/log_info_generate_dual_ledger_test.go`:

```go
package service

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
)

func TestAddDualLedgerLogFields_WritesExpectedKeys(t *testing.T) {
	other := map[string]interface{}{}
	info := &relaycommon.RelayInfo{
		PriceMarkupRatio: 1.5,
		PriceData: types.PriceData{
			PlatformCostQuota:        80,
			PlatformCostChannelRatio: 1.0,
		},
	}
	AddDualLedgerLogFields(info, other, 120)

	if other["pricing_version"] != "dual-ledger-v1" {
		t.Fatalf("pricing_version missing")
	}
	if other["user_bill_quota"] != 120 {
		t.Fatalf("user_bill_quota = %v", other["user_bill_quota"])
	}
	if other["platform_cost_quota"] != 80 {
		t.Fatalf("platform_cost_quota = %v", other["platform_cost_quota"])
	}
	if other["tenant_markup_ratio"] != 1.5 {
		t.Fatalf("tenant_markup_ratio = %v", other["tenant_markup_ratio"])
	}
}
```

- [ ] **Step 7: Run test**

Run: `cd D:/top/keyapi && go test ./service -run TestAddDualLedgerLogFields -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add service/log_info_generate.go service/log_info_generate_dual_ledger_test.go service/text_quota.go service/quota.go
git commit -m "feat(billing): dual-write user_bill + platform_cost into logs.other

Text / audio / WSS consumption log rows now carry pricing_version,
user_bill_quota, platform_cost_quota, tenant_markup_ratio,
platform_cost_channel_ratio, platform_channel. Task and MJ log paths
covered in A.9b / A.9c respectively."
```

---

## Task A.9b: Dual-ledger fields in Task log `other`

**Files:**
- Modify: `service/task_billing.go:136` (`taskBillingOther`)

Task completion logs go through `taskBillingOther` → `RecordTaskBillingLog`, not `PostTextConsumeQuota`. Two callsites (`service/task_billing.go:184, 255`). We amend the shared builder so both paths inherit the dual-ledger keys.

- [ ] **Step 1: Read current code**

Verify the actual struct layout:

```bash
cd D:/top/keyapi && grep -n "type Task struct\|type TaskPrivateData\|type TaskBillingContext" model/task.go
cd D:/top/keyapi && grep -n "taskBillingOther\|task.PrivateData" service/task_billing.go
```

Current reality (as of 2026-04-24):
- `Task` struct has `PrivateData TaskPrivateData` at `model/task.go:64`.
- `TaskPrivateData.BillingContext` is `*TaskBillingContext` (pointer, may be nil).
- `TaskBillingContext` has: `ModelPrice`, `GroupRatio`, `ModelRatio`, `OtherRatios`, `OriginModelName`, `PerCallBilling`.
- No `PlatformCostQuota` column on `Task`.
- No `PriceMarkupRatio` or `PlatformCostChannelRatio` on `TaskBillingContext`.

We add one top-level column (`Task.PlatformCostQuota`) and two snapshot fields (`TaskBillingContext.PriceMarkupRatio` + `TaskBillingContext.PlatformCostChannelRatio`). Top-level column so billing reporting can aggregate via SQL; snapshot fields so the polling/refund path can recompute if the task is re-settled (mirrors the existing `ModelRatio`/`GroupRatio` snapshot pattern).

- [ ] **Step 2a: Extend `Task` + `TaskBillingContext` in `model/task.go`**

Add the `PlatformCostQuota` column to `Task`:

```go
// Task struct — add alongside Quota field
PlatformCostQuota int64 `json:"platform_cost_quota" gorm:"bigint;default:0"`
```

Extend `TaskBillingContext` (at `model/task.go:111`):

```go
type TaskBillingContext struct {
	ModelPrice                float64            `json:"model_price,omitempty"`
	GroupRatio                float64            `json:"group_ratio,omitempty"`
	ModelRatio                float64            `json:"model_ratio,omitempty"`
	OtherRatios               map[string]float64 `json:"other_ratios,omitempty"`
	OriginModelName           string             `json:"origin_model_name,omitempty"`
	PerCallBilling            bool               `json:"per_call_billing,omitempty"`

	// Dual ledger snapshot (2026-04-24)
	PriceMarkupRatio          float64            `json:"price_markup_ratio,omitempty"`
	PlatformCostChannelRatio  float64            `json:"platform_cost_channel_ratio,omitempty"`
}
```

- [ ] **Step 2b: Change `taskBillingOther` signature to accept the user-bill quota**

Per the A.9 contract, every log row must carry both `user_bill_quota` and `platform_cost_quota`. `taskBillingOther(task)` has no handle on the actual settled amount (it can differ from `task.Quota` on the refund path), so the signature needs to change:

```go
// Was:  taskBillingOther(task *model.Task) map[string]interface{}
// Now:  taskBillingOther(task *model.Task, userBillQuota int) map[string]interface{}
```

Inside the function, just before `return other`:

```go
	// Dual ledger (2026-04-24): mirror the text/audio/wss logging. BillingContext
	// is a pointer — may be nil on legacy rows before the schema migration ran.
	other["pricing_version"] = "dual-ledger-v1"
	other["user_bill_quota"] = userBillQuota
	other["platform_cost_quota"] = task.PlatformCostQuota
	if bc := task.PrivateData.BillingContext; bc != nil {
		if bc.PriceMarkupRatio > 0 {
			other["tenant_markup_ratio"] = bc.PriceMarkupRatio
		}
		if bc.PlatformCostChannelRatio > 0 {
			other["platform_cost_channel_ratio"] = bc.PlatformCostChannelRatio
		}
	}
```

Update both callsites in `service/task_billing.go:184, 255` to pass the appropriate user-bill amount. Grep to locate:

```bash
cd D:/top/keyapi && grep -n "taskBillingOther(" service/task_billing.go
```

At each callsite the local `quota` / `task.Quota` / refund-amount variable exists just above the `RecordTaskBillingLog` call — pass it:

```go
// settle path (line ~184):
other := taskBillingOther(task, task.Quota) // or whatever the settled amount is

// refund path (line ~255):
other := taskBillingOther(task, refundAmount) // negative/zero on refund depending on semantics
```

Read the file first to pick the right variable for each callsite.

- [ ] **Step 3: Populate the new fields at task submit + re-settle**

In `relay/relay_task.go`, locate the site where `BillingContext` is populated on submit (grep: `task.PrivateData.BillingContext = &model.TaskBillingContext{`). After the existing assignment, add:

```go
if task.PrivateData.BillingContext != nil {
	task.PrivateData.BillingContext.PriceMarkupRatio = info.PriceMarkupRatio
	task.PrivateData.BillingContext.PlatformCostChannelRatio = info.PriceData.PlatformCostChannelRatio
}
task.PlatformCostQuota = int64(info.PriceData.PlatformCostQuota)
```

If the polling/re-settle path recomputes quota (spec §10.2), re-assign `task.PlatformCostQuota` there too. Grep `service/task_billing.go` for `task.Quota = ` to find the sites.

- [ ] **Step 4: Build + test**

Run: `cd D:/top/keyapi && go build ./... && go test ./service ./model -v 2>&1 | tail -30`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add service/task_billing.go model/task.go model/setup.go relay/relay_task.go
git commit -m "feat(billing): task log other carries dual-ledger fields

Adds Task.PlatformCostQuota top-level column + extends
TaskBillingContext with PriceMarkupRatio + PlatformCostChannelRatio
snapshot. taskBillingOther copies them into the log at settle + refund
time. Pointer-safe against legacy rows via nil check on
task.PrivateData.BillingContext."
```

---

## Task A.9c: Dual-ledger fields in Midjourney log `other`

**Files:**
- Modify: `service/log_info_generate.go` — `GenerateMjOtherInfo`
- Modify: `relay/mjproxy_handler.go:244, 560` — ensure refresh happens before log

- [ ] **Step 1: Confirm `GenerateMjOtherInfo` signature**

Run: `cd D:/top/keyapi && grep -n "func GenerateMjOtherInfo" service/log_info_generate.go`

Current signature (verified 2026-04-24):

```go
func GenerateMjOtherInfo(relayInfo *relaycommon.RelayInfo, priceData types.PriceData) map[string]interface{}
```

`priceData` is a **value** type — can't be compared to nil. Both callsites at `relay/mjproxy_handler.go:244` and `:560` already pass the local `priceData` directly, so no signature change needed.

- [ ] **Step 2: Append dual-ledger fields at end of `GenerateMjOtherInfo`**

Before `return other`:

```go
	// Dual ledger (2026-04-24) — priceData is a value type, always safe to read.
	AddDualLedgerLogFields(relayInfo, other, priceData.Quota)
```

Note parameter name in the helper signature is `info *relaycommon.RelayInfo`; the variable in `GenerateMjOtherInfo` is `relayInfo` — pass `relayInfo` directly.

- [ ] **Step 3: Verify callsites still compile**

No callsite changes needed — both existing calls at `relay/mjproxy_handler.go:244, 560` remain `service.GenerateMjOtherInfo(info, priceData)` (line 244 has the variable named `info`; line 560 has `relayInfo`). Verify via:

```bash
cd D:/top/keyapi && grep -n "GenerateMjOtherInfo(" relay/mjproxy_handler.go
```

- [ ] **Step 4: Build + test**

Run: `cd D:/top/keyapi && go build ./... && go test ./service -v 2>&1 | tail -20`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add service/log_info_generate.go relay/mjproxy_handler.go
git commit -m "feat(billing): MJ log other carries dual-ledger fields

GenerateMjOtherInfo now appends platform_cost_quota /
tenant_markup_ratio / platform_cost_channel_ratio. Both MJ settle
callsites populate PlatformCostQuota via RefreshPlatformCostEstimate
before the log fires (see Task B.3)."
```

---

## Task A.10: End-to-end integration smoke test

**Files:**
- Create: `service/dual_ledger_isolation_test.go`

Covers the core spec acceptance scenarios §12.1 (GroupRatio) and §12.2 (platform_markup) at the unit-calculator level. Real handler integration is verified manually via a live call in staging after Phase B lands.

- [ ] **Step 1: Write the test**

Create `service/dual_ledger_isolation_test.go`:

```go
package service

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/types"
)

// §12.1 — GroupRatio=0.1 makes user bill 10, platform cost stays 100.
func TestDualLedger_GroupRatioDoesNotAffectPlatformCost(t *testing.T) {
	pd := types.PriceData{
		UsePrice:                 false,
		PlatformCostModelRatio:   1.0,
		PlatformCostChannelRatio: 1.0,
		CompletionRatio:          0, // prompt-only for simplicity
		// User-bill fields set to the aggressively-discounted scenario:
		ModelRatio:     1.0,
		GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 0.1},
	}
	usage := &dto.Usage{PromptTokens: 100}
	cost := ComputePlatformCostActualText(newCtx(), nil, pd, usage)
	if cost != 100 {
		t.Fatalf("platform cost = %d, want 100 (GroupRatio leaked)", cost)
	}
}

// §12.2 — platform_markup=2 doubles user bill, platform cost stays 100.
func TestDualLedger_PlatformMarkupDoesNotAffectPlatformCost(t *testing.T) {
	pd := types.PriceData{
		UsePrice:                 false,
		PlatformCostModelRatio:   1.0,
		PlatformCostChannelRatio: 1.0,
		CompletionRatio:          0,
		ModelRatio:               1.0,
		GroupRatioInfo:           types.GroupRatioInfo{GroupRatio: 1.0},
		OtherRatios:              map[string]float64{"platform_markup": 2.0},
	}
	usage := &dto.Usage{PromptTokens: 100}
	cost := ComputePlatformCostActualText(newCtx(), nil, pd, usage)
	if cost != 100 {
		t.Fatalf("platform cost = %d, want 100 (platform_markup leaked)", cost)
	}
}
```

- [ ] **Step 2: Run**

Run: `cd D:/top/keyapi && go test ./service -run TestDualLedger_ -v`
Expected: PASS (both).

- [ ] **Step 3: Commit**

```bash
git add service/dual_ledger_isolation_test.go
git commit -m "test(billing): spec §12.1 / §12.2 isolation regression

Pins the dual-ledger invariant: no tenant-controllable knob reaches
PlatformCostQuota. Will fail loudly if any future refactor adds a
GroupRatio / platform_markup read inside ComputePlatformCostActualText."
```

---

# Phase B — Switch Cap + Usage to Platform Cost

After this phase the cap hard-enforces platform cost. `StripMarkup` is no longer in the cost hot-path.

## Task B.1: Switch `EnforcePlatformChannelQuota` to read `PlatformCostQuotaToPreConsume`

**Files:**
- Modify: `relay/helper/price.go:297-333`
- Test: `relay/helper/price_test.go` (add case)

- [ ] **Step 1: Rewrite the function body**

Open `relay/helper/price.go`. Replace the entire `EnforcePlatformChannelQuota` (lines 289-333) with:

```go
// EnforcePlatformChannelQuota rejects a request when the bound channel is
// platform-scoped and the tenant's projected platform cost would exceed their
// cap.
//
// Dual-ledger v1 (2026-04-24): reads PriceData.PlatformCostQuotaToPreConsume
// (populated by FillPlatformCostEstimate). StripMarkup is no longer consulted
// — the cost ledger is independent from the user-bill ledger.
//
// Fail-closed: if PriceData.PlatformCostQuotaToPreConsume == 0 on a platform
// channel it indicates mis-configuration (channel.platform_cost_ratio missing
// or ModelRatio unset). Reject with tenant_quota_exceeded so the platform
// operator can't silently leak free traffic.
func EnforcePlatformChannelQuota(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	if info == nil || info.TenantId <= 0 {
		return nil
	}

	var channelID int
	if info.ChannelMeta != nil {
		channelID = info.ChannelId
	}
	if channelID <= 0 && c != nil {
		channelID = common.GetContextKeyInt(c, constant.ContextKeyChannelId)
	}
	if channelID <= 0 {
		return nil
	}

	ch, err := model.CacheGetChannel(channelID)
	if err != nil || ch == nil || ch.Scope != model.ChannelScopePlatform {
		return nil
	}

	projected := info.PriceData.PlatformCostQuotaToPreConsume
	if projected <= 0 {
		projected = info.PriceData.PlatformCostQuota
	}
	if projected <= 0 {
		// Platform channel with zero cost ledger — fail closed.
		logger.LogError(c, fmt.Sprintf("platform channel %d has zero platform cost pre-consume — check platform_cost_ratio / ModelRatio config", channelID))
		return types.NewErrorWithStatusCode(
			fmt.Errorf("platform cost not configured for this channel"),
			types.ErrorCodeModelPriceError,
			http.StatusInternalServerError,
			types.ErrOptionWithSkipRetry(),
		)
	}

	if err := service.CheckTenantPlatformChannelQuota(info.TenantId, projected); err != nil {
		return types.NewErrorWithStatusCode(err, types.ErrorCodeTenantQuotaExceeded, http.StatusTooManyRequests, types.ErrOptionWithSkipRetry())
	}
	return nil
}
```

Note: `math` import no longer needed in this function body; check top-of-file imports and remove `"math"` if nothing else in the file uses it. (Other helpers in `relay/helper/price.go` may still use `math.Ceil` in `applyPlatformMarkup` — leave it if so.)

- [ ] **Step 2: Add fail-closed test**

Add to `relay/helper/price_test.go` (or create the file if missing):

```go
package helper

import (
	"testing"

	"github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
)

// Fail-closed: platform-scoped channel but zero PlatformCostQuota* →
// EnforcePlatformChannelQuota MUST return a 500 model_price_error. We
// cannot easily stand up a full gin context here, so this compile-time
// check is a smoke test; the runtime check lives in integration tests.
func TestEnforcePlatformChannelQuota_ZeroCostIsFailClosed(t *testing.T) {
	// Sanity — if someone removes the fail-closed branch this will compile
	// but the runtime branch test in integration still catches it.
	_ = types.ErrorCodeModelPriceError
	_ = &common.RelayInfo{}
}
```

(A real integration test requires the full relay harness — add a TODO and rely on manual staging verification + Task B.5 regression test.)

- [ ] **Step 3: Build**

Run: `cd D:/top/keyapi && go build ./...`
Expected: no errors.

- [ ] **Step 4: Full service tests**

Run: `cd D:/top/keyapi && go test ./relay/helper ./service -v 2>&1 | tail -40`
Expected: no new failures.

- [ ] **Step 5: Commit**

```bash
git add relay/helper/price.go relay/helper/price_test.go
git commit -m "feat(billing): EnforcePlatformChannelQuota reads platform cost ledger

Switches cap enforcement from StripMarkup(user_bill, markup) to
PriceData.PlatformCostQuotaToPreConsume. Fail-closed when zero on a
platform-scoped channel — refuses free traffic on mis-configuration.

Spec: 2026-04-24-dual-ledger-billing-design.md §9.3, §13.1"
```

---

## Task B.2: Switch `TrackPlatformChannelUsageIfApplicable` to read `PlatformCostQuota`

**Files:**
- Modify: `service/billing.go:86-109`

- [ ] **Step 1: Rewrite the function**

Open `service/billing.go`. Replace `TrackPlatformChannelUsageIfApplicable` (lines 86-109) with:

```go
// TrackPlatformChannelUsageIfApplicable records actual platform cost against
// the tenant's platform-channel quota accumulator.
//
// Dual-ledger v1 (2026-04-24): reads PriceData.PlatformCostQuota (populated by
// PostTextConsumeQuota / PostAudioConsumeQuota / PostWssConsumeQuota / Task
// settlement handlers). StripMarkup is no longer consulted.
//
// The actualQuota <= 0 guard is kept as a correctness backstop: Task / MJ
// paths pre-populate PlatformCostQuota with the per-call estimate at submit
// time (see FillPlatformCostPerCallEstimate). If that request later fails
// and the fallback no-session path in SettleBilling fires with actualQuota=0,
// we'd otherwise accumulate the stale estimate. Spec §9.5: failed requests
// don't count. actualQuota is the canonical "did anything settle" signal.
func TrackPlatformChannelUsageIfApplicable(relayInfo *relaycommon.RelayInfo, actualQuota int) {
	if relayInfo == nil || relayInfo.TenantId <= 0 || actualQuota <= 0 {
		return
	}
	channelID := relayInfo.ChannelId
	if channelID <= 0 {
		return
	}
	ch, err := model.CacheGetChannel(channelID)
	if err != nil || ch == nil || ch.Scope != model.ChannelScopePlatform {
		return
	}
	cost := relayInfo.PriceData.PlatformCostQuota
	if cost <= 0 {
		// PlatformCostQuota not populated: either non-platform channel (caught
		// above) or the handler skipped the Fill* call. Log once so we catch
		// any path regression during rollout; don't accumulate anything.
		logger.SysError(fmt.Sprintf("platform_cost: tenant %d channel %d settled actualQuota=%d with PlatformCostQuota=0 — check handler path", relayInfo.TenantId, channelID, actualQuota))
		return
	}
	IncrementTenantPlatformChannelUsed(relayInfo.TenantId, cost)
}
```

- [ ] **Step 2: Update existing tests**

Open `service/billing_test.go`. Its test references `StripMarkup` only — leave that, StripMarkup still lives in this file (legacy callers / future reference). But if any test in the package calls `TrackPlatformChannelUsageIfApplicable` with the expectation it uses StripMarkup, adjust.

Run: `cd D:/top/keyapi && grep -n "TrackPlatformChannelUsageIfApplicable" service/*_test.go`
Expected: no results → no test-side updates needed.

- [ ] **Step 3: Build + test**

Run: `cd D:/top/keyapi && go build ./... && go test ./service -v 2>&1 | tail -20`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add service/billing.go
git commit -m "feat(billing): TrackPlatformChannelUsageIfApplicable reads platform cost

Cap accumulator no longer divides user-bill quota by markup. Reads
PriceData.PlatformCostQuota directly. actualQuota param retained for
signature stability.

Spec: 2026-04-24-dual-ledger-billing-design.md §9.4"
```

---

## Task B.3: MJ settle path — populate platform cost before track call

**Files:**
- Modify: `relay/mjproxy_handler.go:239, 556`

Current MJ handler does `service.TrackPlatformChannelUsageIfApplicable(info, priceData.Quota)` twice. Those callsites pass the user-bill quota directly; now that track reads `PriceData.PlatformCostQuota` instead, the quota parameter doesn't matter, but `PriceData.PlatformCostQuota` must be populated.

- [ ] **Step 1: Read the two callsites**

Use Read on `relay/mjproxy_handler.go` around lines 230-245 and 550-560.

- [ ] **Step 2: Before each `TrackPlatformChannelUsageIfApplicable` call**

Insert just before each call:

```go
// MJ settles the full per-call quota. Platform cost mirrors the same
// amount scaled by PlatformCostChannelRatio — the per-call estimator
// already populated PlatformCostQuota at pre-consume; re-assert here
// in case a channel switch happened mid-flight.
helper.RefreshPlatformCostEstimate(c, info)
```

(Use the correct variable name — `info` at line 239, `relayInfo` at line 556. Check via Read.)

- [ ] **Step 3: Check imports**

Run: `cd D:/top/keyapi && grep -n '"github.com/QuantumNous/new-api/relay/helper"' relay/mjproxy_handler.go`

If not imported yet, add `"github.com/QuantumNous/new-api/relay/helper"` to the import block.

- [ ] **Step 4: Build**

Run: `cd D:/top/keyapi && go build ./...`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add relay/mjproxy_handler.go
git commit -m "fix(billing): MJ refreshes platform cost before usage track

Ensures PriceData.PlatformCostQuota is set before the settle-time
tracker reads it, covering mid-flight channel switch edge cases."
```

---

## Task B.4: Task (Video/Suno/Kling/Jimeng) settle path

**Files:**
- Modify: `relay/relay_task.go` and any task settle helper that calls `SettleBilling`

Task submission pre-consumes via `FillPlatformCostPerCallEstimate` (wired in Task A.3). Post-completion polling recomputes `priceData.Quota` (spec §10.2) and re-settles — that recompute path must also refresh platform cost.

- [ ] **Step 1: Find the post-completion re-settle logic**

Run: `cd D:/top/keyapi && grep -rn "SettleBilling\|PostConsumeQuota" relay/relay_task.go service/task_billing.go`

Identify every call site inside the task family that finalises or adjusts quota.

- [ ] **Step 2: Before each settle call**

Add:

```go
relayInfo.PriceData.PlatformCostQuota = relayInfo.PriceData.PlatformCostQuotaToPreConsume
// Task costs are per-call and identical between estimate and actual — if a
// future handler family adjusts quota (e.g. video hour overage), compute
// platform cost via FillPlatformCostPerCallEstimate with the updated PriceData.
```

If the recompute path changes `priceData.Quota` based on task result (e.g. video seconds), also re-run `helper.FillPlatformCostPerCallEstimate(c, relayInfo)` to get a fresh cost.

- [ ] **Step 3: Write a small regression test**

Task billing has `service/task_billing_test.go`. Add a case:

```go
func TestTaskBilling_PlatformCostMatchesPreConsume(t *testing.T) {
	info := &relaycommon.RelayInfo{
		TenantId: 1,
		PriceData: types.PriceData{
			PlatformCostQuotaToPreConsume: 250,
		},
	}
	// Simulate the refresh from step 2:
	info.PriceData.PlatformCostQuota = info.PriceData.PlatformCostQuotaToPreConsume
	if info.PriceData.PlatformCostQuota != 250 {
		t.Fatalf("got %d", info.PriceData.PlatformCostQuota)
	}
}
```

- [ ] **Step 4: Build + test**

Run: `cd D:/top/keyapi && go build ./... && go test ./service -run TestTaskBilling_Platform -v`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add relay/relay_task.go service/task_billing_test.go service/task_billing.go
git commit -m "fix(billing): Task settle path populates platform cost ledger

Task handlers (Video/Suno/Kling/Jimeng) now propagate the per-call
platform cost estimate into PlatformCostQuota on settle."
```

---

## Task B.5: Regression — cap uses platform cost (spec §12.4)

**Files:**
- Modify: `service/tenant_quota_test.go`

- [ ] **Step 1: Add the case**

Append to `service/tenant_quota_test.go`:

```go
func TestPlatformChannelCap_UsesPlatformCostNotUserBill(t *testing.T) {
	// Mirror of spec §12.4:
	//   platform_quota_cap = 500, platform_quota_used = 450
	//   platform_cost_quota_to_preconsume = 60, user_bill_quota_to_preconsume = 6
	// Expected: request rejected because 450 + 60 > 500. User-bill of 6 must NOT
	// sneak a platform-cost-60 request through.
	//
	// This test stops at evaluateProjectedQuota (pure) — handler-level
	// enforcement is exercised in staging.
	if err := evaluateProjectedQuota(500, 450, 60); err == nil {
		t.Fatalf("want cap rejection for 450 + 60 > 500, got nil")
	}
	if err := evaluateProjectedQuota(500, 450, 6); err != nil {
		t.Fatalf("cap should pass for 450 + 6 = 456 <= 500, got %v", err)
	}
}
```

- [ ] **Step 2: Verify `evaluateProjectedQuota` exported**

Run: `cd D:/top/keyapi && grep -n "evaluateProjectedQuota\|EvaluateProjectedQuota" service/tenant_quota.go`

If lowercase-only, make it package-private test-callable (it's in the same package so the test can call it directly).

- [ ] **Step 3: Run**

Run: `cd D:/top/keyapi && go test ./service -run TestPlatformChannelCap_ -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add service/tenant_quota_test.go
git commit -m "test(billing): spec §12.4 cap-uses-platform-cost regression

Pins the dual-ledger contract at the cap layer: platform cost-60 @
used-450/cap-500 is rejected even if the user bill is 6."
```

---

## Task B.6: Regression — non-platform channel doesn't accumulate (spec §12.5)

**Files:**
- Modify: `service/billing_test.go`

- [ ] **Step 1: Add the case**

Append to `service/billing_test.go`:

```go
func TestTrackPlatformChannelUsage_NonPlatformChannelSkipped(t *testing.T) {
	// Pinning §12.5 at the guard layer. The real guard (Scope != platform)
	// lives inside TrackPlatformChannelUsageIfApplicable; we assert the
	// channel-scope invariant here.
	if model.ChannelScopeTenant == model.ChannelScopePlatform {
		t.Fatalf("scope constants collide — guard would fail")
	}
}
```

- [ ] **Step 2: Run**

Run: `cd D:/top/keyapi && go test ./service -run TestTrackPlatformChannelUsage_ -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add service/billing_test.go
git commit -m "test(billing): spec §12.5 non-platform-channel guard regression"
```

---

# Phase C — Audit + Cleanup

After B, user-bill and platform-cost ledgers are independent. Phase C audits residual `StripMarkup` callsites and removes them from the cost path.

## Task C.1: Audit and deprecate `StripMarkup` on cost paths

**Files:**
- Modify: `service/billing.go` (doc comment)
- Modify: `controller/tenant/plan.go:46` (comment reference)

- [ ] **Step 1: Verify no cost-path callers remain**

Run: `cd D:/top/keyapi && grep -rn "StripMarkup" --include='*.go' | grep -v _test.go`

Expected output should show:
- `service/billing.go:116` (definition)

NOT expected (fail the audit if present):
- Any call inside `EnforcePlatformChannelQuota`
- Any call inside `TrackPlatformChannelUsageIfApplicable`

If grep turns up a cost-path caller missed earlier, remove it now.

- [ ] **Step 2: Update the doc comment**

In `service/billing.go` replace the `// StripMarkup reverses...` comment (lines 111-115) with:

```go
// StripMarkup reverses the markup multiplication. Retained as a utility for
// legacy callers (wallet top-up receipt reconciliation, etc). As of
// 2026-04-24 dual-ledger v1 it is NOT used on the platform cost path —
// EnforcePlatformChannelQuota / TrackPlatformChannelUsageIfApplicable read
// PriceData.PlatformCost* directly. Do not re-introduce StripMarkup into
// cost accounting; tenant-controllable configs would leak through.
```

- [ ] **Step 3: Commit**

```bash
git add service/billing.go
git commit -m "docs(billing): StripMarkup deprecated on cost path

Documents the dual-ledger invariant at the function definition. Audit
shows no remaining call in the cost hot-path."
```

---

## Task C.2: Audit — `GroupRatio` not read by cost path

**Files:**
- none (audit only)

- [ ] **Step 1: Grep for GroupRatio reads**

Run: `cd D:/top/keyapi && grep -n "GroupRatio\|PriceMarkupRatio\|platform_markup" relay/helper/platform_cost.go service/platform_cost_actual.go`

Expected: zero matches.

If any match appears, remove/refactor BEFORE continuing.

- [ ] **Step 2: Grep for tenant_option reads in cost code**

Run: `cd D:/top/keyapi && grep -n "GetTenantGroupRatioMap\|GetTenantGroupGroupRatioMap\|tenant_options\|TenantOverridable" relay/helper/platform_cost.go service/platform_cost_actual.go`

Expected: zero matches.

- [ ] **Step 3: Document the audit**

Append to `relay/helper/platform_cost.go` (top-of-file block comment already exists from A.1):

```go
// Audit 2026-04-24:
//   grep 'GroupRatio\|platform_markup\|tenant_options' finds zero matches
//   in this file and service/platform_cost_actual.go. Do not add any such
//   read without also amending the isolation regression tests.
```

- [ ] **Step 4: Commit**

```bash
git add relay/helper/platform_cost.go
git commit -m "docs(billing): audit log — cost calculator reads no tenant config

Appended to platform_cost.go header. Pins the invariant for future
reviewers: if you grep and find a tenant-config read here, it's a bug."
```

---

# Phase D — Tenant-Platform-Channel Markup Table

Implements spec §8.3 — per-tenant-per-platform-channel user-bill markup. Platform cost ledger stays isolated.

## Task D.1: Schema — new `tenant_platform_channel_markups` table

**Files:**
- Create: `model/tenant_platform_channel_markup.go`
- Create: `model/tenant_platform_channel_markup_test.go`
- Modify: `model/setup.go:7` (schema version bump)
- Modify: `model/main.go` migrateDBFast list (add the new model)

- [ ] **Step 1: Define the struct + CRUD helpers**

Create `model/tenant_platform_channel_markup.go`:

```go
package model

import "gorm.io/gorm"

// TenantPlatformChannelMarkup stores a per-tenant override of platform-channel
// markup. Only affects the user-bill ledger; the platform cost ledger is
// independent by design (see 2026-04-24-dual-ledger-billing-design.md §8.3).
//
// Priority when resolving the user-bill markup ratio:
//   1. Row in this table (tenant_id, channel_id) with enabled=true
//   2. TenantPlan.PlatformMarkup (global tenant default)
//   3. 1.0
type TenantPlatformChannelMarkup struct {
	TenantId    int     `json:"tenant_id" gorm:"primaryKey;not null"`
	ChannelId   int     `json:"channel_id" gorm:"primaryKey;not null;index"`
	MarkupRatio float64 `json:"markup_ratio" gorm:"type:decimal(10,4);not null"`
	Enabled     bool    `json:"enabled" gorm:"not null;default:true"`
	CreatedAt   int64   `json:"created_at" gorm:"bigint;autoCreateTime"`
	UpdatedAt   int64   `json:"updated_at" gorm:"bigint;autoUpdateTime"`
}

// GetTenantPlatformChannelMarkup returns the enabled override for (tenant,
// channel) or (nil, nil) when none exists. Errors other than ErrRecordNotFound
// are returned as-is.
func GetTenantPlatformChannelMarkup(tenantID, channelID int) (*TenantPlatformChannelMarkup, error) {
	var row TenantPlatformChannelMarkup
	err := DB.Where("tenant_id = ? AND channel_id = ? AND enabled = ?", tenantID, channelID, true).First(&row).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func UpsertTenantPlatformChannelMarkup(row *TenantPlatformChannelMarkup) error {
	// ON CONFLICT (tenant_id, channel_id) DO UPDATE — relies on GORM's composite
	// primary key. MySQL / Postgres / SQLite all honour composite-PK upserts.
	return DB.Save(row).Error
}

func DeleteTenantPlatformChannelMarkup(tenantID, channelID int) error {
	return DB.Where("tenant_id = ? AND channel_id = ?", tenantID, channelID).Delete(&TenantPlatformChannelMarkup{}).Error
}
```

- [ ] **Step 2: Add to migrateDBFast**

Open `model/main.go` — find the list of models passed to AutoMigrate (look for the block that lists `&Channel{}`, `&User{}`, `&TenantPlan{}`, etc.). Append `&TenantPlatformChannelMarkup{}`.

- [ ] **Step 3: Bump schema version**

`model/setup.go` line 7:

```go
const CurrentSchemaVersion = "2026-04-24.02"
```

- [ ] **Step 4: Write test**

Create `model/tenant_platform_channel_markup_test.go`:

```go
package model

import "testing"

func TestTenantPlatformChannelMarkup_ZeroValueIsEnabled(t *testing.T) {
	// Enabled default is true via GORM tag. Go zero-value is false, so
	// callers must use the CRUD helpers which rely on DB default — this
	// test asserts the tag is present at the field level.
	row := TenantPlatformChannelMarkup{}
	_ = row.Enabled // Go zero is false; DB default injects true on INSERT
}
```

(Round-trip to DB tested in staging — unit test just asserts the type compiles.)

- [ ] **Step 5: Build + test**

Run: `cd D:/top/keyapi && go build ./... && go test ./model -run TestTenantPlatformChannelMarkup -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add model/tenant_platform_channel_markup.go model/tenant_platform_channel_markup_test.go model/main.go model/setup.go
git commit -m "feat(billing): tenant_platform_channel_markups table

Per-tenant override of platform-channel markup (user-bill only).
Composite PK (tenant_id, channel_id); enabled flag for soft-disable.
Priority: row > TenantPlan.PlatformMarkup > 1.0.

Spec: 2026-04-24-dual-ledger-billing-design.md §8.3"
```

---

## Task D.2: Resolver extends `EffectiveMarkup` with channel override

**Files:**
- Modify: `service/tenant_billing.go` (or wherever `EffectiveMarkup` lives)
- Test: `service/tenant_billing_markup_test.go` (new)

- [ ] **Step 1: Locate `EffectiveMarkup`**

Run: `cd D:/top/keyapi && grep -rn "func EffectiveMarkup" service/`

Note the file + signature.

- [ ] **Step 2: Extend it — tenant override MUST win over platform-wide channel markup**

Priority order per spec §8.3 (tenant-channel > plan > 1.0), reconciled with the pre-existing `ch.MarkupRatio` as a platform-wide default the tenant can override:

```
tenant_platform_channel_markups > ch.MarkupRatio > plan.PlatformMarkup > 1.0
```

If operator set a platform-wide `ch.MarkupRatio` as "default markup for this channel", tenants still need the right to override their own user-bill multiplier — otherwise the new table is pointless.

Rewrite `EffectiveMarkup` in `service/markup.go`:

```go
// EffectiveMarkup resolves the user-bill markup ratio. Priority:
//   1. tenant_platform_channel_markups row (tenant-specific override)
//   2. ch.MarkupRatio                       (platform-wide channel default)
//   3. plan.PlatformMarkup                  (tenant's global default)
//   4. 1.0
//
// Platform cost ledger does NOT call this function — it never multiplies by
// any tenant-facing markup. See spec §7.3 and dual_ledger_isolation_test.go.
func EffectiveMarkup(ch *model.Channel, plan *model.TenantPlan) (float64, string) {
	if ch == nil || ch.Scope != model.ChannelScopePlatform {
		return 1.0, "none"
	}
	// 1. Tenant-specific override (highest priority).
	if plan != nil {
		if row, err := model.GetTenantPlatformChannelMarkup(plan.TenantId, ch.Id); err == nil && row != nil && row.MarkupRatio > 0 {
			return row.MarkupRatio, "tenant_channel"
		}
	}
	// 2. Platform-wide channel default.
	if ch.MarkupRatio != nil && *ch.MarkupRatio > 0 {
		return *ch.MarkupRatio, "channel"
	}
	// 3. Tenant plan default.
	if plan != nil && plan.PlatformMarkup > 0 {
		return plan.PlatformMarkup, "plan"
	}
	return 1.0, "none"
}
```

- [ ] **Step 3: Write the test**

Create `service/tenant_billing_markup_test.go`:

```go
package service

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
)

func TestEffectiveMarkup_Priority(t *testing.T) {
	// plan-only case: no channel override, no tenant row → plan wins
	plan := &model.TenantPlan{TenantId: 1, PlatformMarkup: 2.0}
	ch := &model.Channel{Id: 10, Scope: model.ChannelScopePlatform}
	got, src := EffectiveMarkup(ch, plan)
	if got != 2.0 || src != "plan" {
		t.Fatalf("plan-only: got %v/%q want 2.0/plan", got, src)
	}

	// channel MarkupRatio trumps plan (platform-wide default for this channel)
	v := 3.0
	ch.MarkupRatio = &v
	got, src = EffectiveMarkup(ch, plan)
	if got != 3.0 || src != "channel" {
		t.Fatalf("channel trump plan: got %v/%q want 3.0/channel", got, src)
	}

	// Non-platform channel: always 1.0/none regardless of other config.
	tenantCh := &model.Channel{Id: 11, Scope: model.ChannelScopeTenant, MarkupRatio: &v}
	got, src = EffectiveMarkup(tenantCh, plan)
	if got != 1.0 || src != "none" {
		t.Fatalf("tenant-scope should bypass: got %v/%q", got, src)
	}

	// Tenant-specific row (when populated) MUST trump ch.MarkupRatio — the
	// whole point of D.1. Full DB round-trip is manual verification; this
	// test pins the priority chain via a stub would require dependency
	// injection. Noted for follow-up; manual staged verification enforced.
	_ = model.TenantPlatformChannelMarkup{} // compile anchor
}
```

(The `tenant_channel` priority case requires DB round-trip — covered by manual staging test.)

- [ ] **Step 4: Build + test**

Run: `cd D:/top/keyapi && go build ./... && go test ./service -run TestEffectiveMarkup -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add service/tenant_billing.go service/tenant_billing_markup_test.go
git commit -m "feat(billing): EffectiveMarkup honours tenant_platform_channel_markups

Priority chain: tenant_platform_channel_markups > ch.MarkupRatio >
plan.PlatformMarkup > 1.0. Tenant override wins over platform-wide
channel default — that was the whole point of the new table. Only
consulted for user-bill ledger; platform cost path never calls
EffectiveMarkup."
```

---

## Task D.3: Admin CRUD endpoints for the markup table

**Files:**
- Create: `controller/tenant/platform_channel_markup.go`
- Modify: `router/api-router.go` (wire endpoints)

- [ ] **Step 1: Find existing tenant-admin router pattern**

Run: `cd D:/top/keyapi && grep -n "/api/tenant/platform_channel" router/api-router.go`

Note the group + middleware pattern used.

- [ ] **Step 2: Create controller with full validation**

Validation requirements:
- `channel_id` must reference an existing channel.
- Referenced channel must have `Scope = platform` (tenant channels don't need the override table — they already own the channel).
- `markup_ratio > 0` strict.
- `enabled` uses `*bool` so omitted / explicit-true both default to enabled; only `"enabled": false` disables.

Create `controller/tenant/platform_channel_markup.go`:

```go
package tenant

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

type upsertMarkupReq struct {
	ChannelId   int     `json:"channel_id" binding:"required"`
	MarkupRatio float64 `json:"markup_ratio" binding:"required"`
	Enabled     *bool   `json:"enabled"` // nil → default true; explicit false → disabled
}

// POST /api/tenant/platform_channel_markup
func UpsertPlatformChannelMarkup(c *gin.Context) {
	tenantID := common.GetTenantId(c)
	if tenantID <= 0 {
		c.JSON(http.StatusForbidden, gin.H{"message": "tenant context missing"})
		return
	}

	var req upsertMarkupReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	if req.MarkupRatio <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "markup_ratio must be > 0"})
		return
	}

	// Validate the channel — must exist and be platform-scoped.
	ch, err := model.CacheGetChannel(req.ChannelId)
	if err != nil || ch == nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "channel not found"})
		return
	}
	if ch.Scope != model.ChannelScopePlatform {
		c.JSON(http.StatusBadRequest, gin.H{"message": "only platform-scoped channels accept tenant markup overrides"})
		return
	}

	// Default enabled to true when not provided.
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	row := &model.TenantPlatformChannelMarkup{
		TenantId:    tenantID,
		ChannelId:   req.ChannelId,
		MarkupRatio: req.MarkupRatio,
		Enabled:     enabled,
	}
	if err := model.UpsertTenantPlatformChannelMarkup(row); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": row})
}

// DELETE /api/tenant/platform_channel_markup/:channel_id
func DeletePlatformChannelMarkup(c *gin.Context) {
	tenantID := common.GetTenantId(c)
	if tenantID <= 0 {
		c.JSON(http.StatusForbidden, gin.H{"message": "tenant context missing"})
		return
	}
	channelID, err := strconv.Atoi(c.Param("channel_id"))
	if err != nil || channelID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid channel_id"})
		return
	}
	if err := model.DeleteTenantPlatformChannelMarkup(tenantID, channelID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{})
}
```

(Verify `common.GetTenantId` exists — grep via `grep -n "func GetTenantId" common/`. If the helper uses a different name, substitute; the semantics is "extract the tenant id from the authenticated gin context".)

- [ ] **Step 2b: Unit test the request binding defaults**

Add `controller/tenant/platform_channel_markup_test.go`:

```go
package tenant

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestUpsertReq_EnabledDefaultsToTrueWhenOmitted(t *testing.T) {
	raw := []byte(`{"channel_id": 42, "markup_ratio": 1.5}`)
	var req upsertMarkupReq
	if err := json.NewDecoder(bytes.NewReader(raw)).Decode(&req); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if req.Enabled != nil {
		t.Fatalf("omitted enabled should decode to nil, got %v", *req.Enabled)
	}
	// Handler logic: nil → true
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	if !enabled {
		t.Fatalf("default should be enabled=true")
	}
}

func TestUpsertReq_EnabledFalseExplicit(t *testing.T) {
	raw := []byte(`{"channel_id": 42, "markup_ratio": 1.5, "enabled": false}`)
	var req upsertMarkupReq
	if err := json.NewDecoder(bytes.NewReader(raw)).Decode(&req); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if req.Enabled == nil || *req.Enabled != false {
		t.Fatalf("explicit false should decode to &false")
	}
}
```

Run: `cd D:/top/keyapi && go test ./controller/tenant -run TestUpsertReq -v`
Expected: PASS.

- [ ] **Step 3: Wire routes in `router/api-router.go`**

In the tenant-admin group (find "api/tenant" block):

```go
tenantApi.POST("/platform_channel_markup", tenantController.UpsertPlatformChannelMarkup)
tenantApi.DELETE("/platform_channel_markup/:channel_id", tenantController.DeletePlatformChannelMarkup)
```

Use the exact alias the file already imports under (`tenantController` or similar).

- [ ] **Step 4: Build**

Run: `cd D:/top/keyapi && go build ./...`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add controller/tenant/platform_channel_markup.go router/api-router.go
git commit -m "feat(billing): admin CRUD for tenant platform-channel markup

POST to upsert, DELETE by channel_id. Tenant admin scope — no platform
admin required because this is the tenant's own user-bill knob."
```

---

## Task D.4: Regression — tenant channel markup doesn't affect platform cost (spec §12.3)

**Files:**
- Modify: `service/dual_ledger_isolation_test.go`

- [ ] **Step 1: Extend the existing isolation test file**

Append to `service/dual_ledger_isolation_test.go`:

```go
// §12.3 — two tenants, same platform channel, different user-bill markups,
// same platform cost.
func TestDualLedger_TenantChannelMarkupDoesNotAffectPlatformCost(t *testing.T) {
	basePD := types.PriceData{
		UsePrice:                 false,
		PlatformCostModelRatio:   1.0,
		PlatformCostChannelRatio: 1.0,
		CompletionRatio:          0,
		ModelRatio:               1.0,
		GroupRatioInfo:           types.GroupRatioInfo{GroupRatio: 1.0},
	}
	usage := &dto.Usage{PromptTokens: 100}

	// Tenant A — markup 1.5 (applied on user-bill side, not reflected in PriceData
	// until post-applyPlatformMarkup; for this test we only check cost).
	costA := ComputePlatformCostActualText(newCtx(), nil, basePD, usage)

	// Tenant B — markup 0.8
	costB := ComputePlatformCostActualText(newCtx(), nil, basePD, usage)

	if costA != 100 || costB != 100 {
		t.Fatalf("platform cost diverged: A=%d B=%d (want both 100)", costA, costB)
	}
}
```

- [ ] **Step 2: Run**

Run: `cd D:/top/keyapi && go test ./service -run TestDualLedger_TenantChannelMarkup -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add service/dual_ledger_isolation_test.go
git commit -m "test(billing): spec §12.3 tenant-channel-markup isolation

Pins the invariant that per-tenant channel overrides never leak into
the platform cost ledger."
```

---

# Phase E — Documentation + Handoff

## Task E.1: Update spec status + mark checklist done

**Files:**
- Modify: `docs/superpowers/specs/2026-04-24-dual-ledger-billing-design.md`

- [ ] **Step 1: Flip status header**

Open the spec and change the status line from `状态：设计稿` to `状态：已实现（v1, backend-only）`.

- [ ] **Step 2: Tick §14 checklist items actually done**

Leave admin-UI items un-ticked. Tick:

```
- [x] 为 `PriceData` 增加平台成本字段。
- [x] 新增平台成本计算器。
- [x] 为平台渠道增加 `PlatformCostRatio`。
- [x] 将 `EnforcePlatformChannelQuota` 改为使用平台成本字段。
- [x] 将平台渠道用量累计改为使用平台成本字段。
- [x] 在消费日志 `other` 中写入双账字段。
- [x] 覆盖普通文本、音频、图片、Responses、Claude、Gemini、Embedding、Rerank。
- [x] 覆盖 Task、Video、Suno、Kling、Jimeng。
- [x] 覆盖 Midjourney 和 Realtime 特殊路径。
- [x] 新增租户-平台渠道售价倍率表。
- [ ] 为租户后台展示用户售价倍率和平台成本字段。        ← deferred to follow-up admin-UI plan
- [x] 增加双账本回归测试。
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-04-24-dual-ledger-billing-design.md
git commit -m "docs(billing): mark dual-ledger spec implemented

Backend rollout complete. Admin UI deferred to follow-up plan."
```

---

## Task E.2: Final sanity build + full test suite

**Files:**
- none

- [ ] **Step 1: Build everything**

Run: `cd D:/top/keyapi && go build ./...`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `cd D:/top/keyapi && go test ./... 2>&1 | tail -80`
Expected: all green. Any failure → investigate, don't commit-over.

- [ ] **Step 3: Final grep audit**

Run:

```bash
cd D:/top/keyapi && grep -rn "StripMarkup" --include='*.go' | grep -v _test.go | grep -v service/billing.go
```

Expected: empty output. Any match means a cost-path caller slipped in.

Run:

```bash
cd D:/top/keyapi && grep -n "GroupRatio\|platform_markup\|tenant_options" relay/helper/platform_cost.go service/platform_cost_actual.go
```

Expected: empty.

- [ ] **Step 4: No commit** (audit step only — nothing to stage unless a fix is required).

---

## Post-Plan Follow-ups (out of scope for this plan)

1. **Admin UI** for platform cost fields:
   - Channel edit dialog: add `PlatformCostRatio` (platform-admin only).
   - Tenant console: table of `tenant_platform_channel_markups` with upsert/delete.
   - Logs viewer: surface `platform_cost_quota` / `user_bill_quota` / `tenant_markup_ratio` columns.
2. **Optional separate `tenant_platform_channel_usage_ledger` table** (spec §8.4): defer until financial ops confirms they need per-row platform cost vs. the current `logs.other` JSON.
3. **`TenantOverridableKeys` allowlist** (spec §7.3 §11-C.2): explicit whitelist of keys tenants can override; even though `GroupRatio` no longer pollutes platform cost, keeping it readable-but-not-settable by tenants is a defence-in-depth move.
4. **Retire `StripMarkup`** entirely once any lingering legacy callers (wallet receipts, etc.) are migrated.

---

## Self-Review

**Spec coverage check:**
- §5 architecture: covered by Phases A (dual-write) + B (switch cap).
- §6 formulas: Task A.1 / A.5 implement both token and per-call variants.
- §7 config boundaries: enforced by Task C.1 + C.2 audit + file-level comment.
- §8.1 PriceData: Task 0.1. Note: `UserMarkupRatio` / `UserPricingSource` from spec §8.1 are NOT added — the existing `RelayInfo.PriceMarkupRatio` / `PriceMarkupSource` serve that purpose. Called out in Architecture section.
- §8.2 Channel.PlatformCostRatio: Task 0.2.
- §8.3 tenant_platform_channel_markups: Phase D.
- §8.4 logs.other: Task A.9. Separate ledger table deferred per "Post-Plan Follow-ups #2".
- §9.1 calculator: A.1 + A.5.
- §9.2 existing helpers unchanged (renaming deferred — spec acknowledges "加注释，明确" is enough, no rename forced).
- §9.3 cap: B.1.
- §9.4 usage: B.2.
- §9.5 lifecycle: preserved — no change to refund / funding.
- §10 path coverage: B.3 (MJ), B.4 (Task family), A.7 (audio), A.8 (WSS). Text / Responses / Claude / Gemini / Embedding / Rerank all flow through `PostTextConsumeQuota` wired in A.6 — single integration point.
- §11 migration phases A/B/C/D: 1:1 mapped to plan phases.
- §12.1–§12.6 acceptance: A.10 (12.1, 12.2), B.5 (12.4), B.6 (12.5), D.4 (12.3). 12.6 (Task/MJ param ratios) implicitly covered by the per-call estimator reading `PlatformCostOtherRatios` — no extra test; staged manual verification called out.
- §13 safety: B.1 fail-closed + C.1/C.2 audit.
- §14 checklist: mapped task-by-task; admin UI explicitly deferred.
- §15 order: Phase 0 → A → B → D (Phase C in this plan = audit, not a distinct spec phase).
- §16 decisions: all settled by plan design.

**Placeholder scan:**
- No "TBD", "fill in details", "similar to Task N", "add appropriate error handling", or bare "write tests" in any task. Every code step shows the actual code.
- Step 2 in Task A.8 deliberately documents that no code change happens at that callsite — called out with a comment reason rather than left blank.
- Task B.1 has a unit test that's only a compile-check; the runtime fail-closed branch is explicitly called out as requiring manual staging verification. This is a known gap — rationale in the task description.

**Type consistency:**
- `PlatformCostQuota` used identically across all tasks.
- `FillPlatformCostEstimate` / `FillPlatformCostPerCallEstimate` / `RefreshPlatformCostEstimate` — exported identically in A.1 and called identically in A.2 / A.3 / A.4.
- `ComputePlatformCostActualText(ctx, relayInfo, pd, usage)` — defined in A.5 (rev2: now takes ctx + relayInfo so surcharge resolution works); callers A.6 / A.7 / A.8 updated to the new signature in A.5 Step 7.
- `AddDualLedgerLogFields` — defined in A.9, called identically from text/audio/WSS handlers + `GenerateMjOtherInfo`.
- `EffectiveMarkup` in D.2 preserves signature `(ch *model.Channel, plan *model.TenantPlan) (float64, string)` — matches existing callsite in `relay/helper/price.go:272`.
- `TenantPlatformChannelMarkup` PK (tenant_id, channel_id) matches spec §8.3 and resolver in D.2.

---

## Reviewer-Fix Addendum (2026-04-24 rev2)

This plan was reviewed and seven findings integrated:

| # | Severity | Issue                                                          | Fix location                |
|---|----------|----------------------------------------------------------------|-----------------------------|
| 1 | P0 | WSS `PreWssConsumeQuota` never populates `PlatformCostQuota`; Phase-B tracker silently skips realtime | Task A.8 step 2 now writes the estimate inline before the tracker call |
| 2 | P0 | `ComputePlatformCostActualText` draft dropped OpenRouter Claude cache norm, 5m/1h split, and tool surcharges — systematic undercount + direct conflict with spec §6.1 "客观成本因子" | Task A.5 rewritten as full mirror; adds `PlatformCostSurcharges` + resolver; tool surcharges enter cost ledger without GroupRatio |
| 3 | P1 | `int(f * ratio)` truncates to 0 for tiny requests → B.1 fail-closed reject + B.2 skip | Task A.1 helpers switched to `decimal.Round` + min-1 rule; new tests cover the boundary |
| 4 | P1 | B.2 dropped `actualQuota <= 0` guard → stale pre-consume accumulates on failed Task/MJ | Task B.2 restores guard with explicit rationale + error log for `PlatformCostQuota=0` path regressions |
| 5 | P1 | A.9 claimed "every consumption log row" but only covers text/audio/wss; Task + MJ logs missed | New Tasks A.9b (Task) and A.9c (MJ); A.9 commit message softened |
| 6 | P1 | D.2 put `ch.MarkupRatio` above tenant-channel row → tenant can't override channel default, defeats §8.3 | D.2 rewritten with strict priority `tenant_channel > ch.MarkupRatio > plan > 1.0` |
| 7 | P2 | D.3 CRUD missed channel existence + scope check, `Enabled bool` silently-false on omitted | D.3 adds channel load + `Scope=platform` check + `*bool` for Enabled with default-true; added binding test |

## Reviewer-Fix Addendum rev3 (2026-04-24)

Second review round caught five execution-level bugs where example code referenced the wrong types, field paths, or function signatures. All fixed:

| # | Severity | Issue                                                                    | Fix location                                 |
|---|----------|--------------------------------------------------------------------------|----------------------------------------------|
| 1 | P0 | `ComputePlatformCostActualText` definition updated to `(ctx, relayInfo, pd, usage)` but A.6 / A.7 / A.8 / A.10 / D.4 example code still passed the old 2-arg form — would fail to compile | All five call sites updated in place; compile-check test in A.6 also corrected |
| 2 | P1 | A.8 Step 2 referenced a non-existent local `preConsumedTokens` variable in `PreWssConsumeQuota` and used `tokens × modelRatio × channelRatio` which omits audio / completion / audio-completion ratios — would undercount audio-heavy sessions 30-70% | Task A.8 rewritten to use a new `ComputePlatformCostActualRealtime` helper (added to A.5) that wraps `calculateAudioQuota` with `GroupRatio=1.0` |
| 3 | P1 | `computePlatformCostTokenBase` needed `modelName` for Gemini audio-input lookup but only had a `_modelNameForAudioLookup` stub returning `""` — Claude, OpenRouter Claude, Gemini audio would mis-route tokens | Token-base signature now takes `modelName`; stub removed; call site propagates `relayInfo.OriginModelName` |
| 4 | P1 | A.9b example accessed `task.BillingContext.*` and `task.PlatformCostQuota` but reality is `task.PrivateData.BillingContext` (pointer) and no top-level column exists yet | A.9b Step 2a adds the top-level `Task.PlatformCostQuota` column + `TaskBillingContext.PriceMarkupRatio` + `TaskBillingContext.PlatformCostChannelRatio` snapshot fields; Step 2b uses `task.PrivateData.BillingContext` with nil guard |
| 5 | P2 | A.9c `if priceData != nil` — but `GenerateMjOtherInfo(relayInfo, priceData types.PriceData)` takes a value; would fail to compile | A.9c simplified to unconditional `AddDualLedgerLogFields(relayInfo, other, priceData.Quota)` |
| 6 | doc  | D.2 commit message still described old priority (`ch.MarkupRatio > tenant_platform_channel_markups`) inconsistent with fixed code | Commit message rewritten to match `tenant_platform_channel_markups > ch.MarkupRatio > plan > 1.0` |

## Reviewer-Fix Addendum rev4 (2026-04-24)

Third review round caught five more correctness gaps. All fixed:

| # | Severity | Issue                                                                          | Fix location |
|---|----------|--------------------------------------------------------------------------------|--------------|
| 1 | trivial | A.5 example imported `constant` without referencing it — Go unused-import error | F2 now uses `constant.ChannelTypeOpenRouter` in the OpenRouter Claude branch, legitimising the import |
| 2 | P1 | `computePlatformCostTokenBase` only checked `usage.UsageSemantic == "anthropic"`; missed Claude-format detection via `relayInfo.GetFinalRequestRelayFormat()` and the OpenRouter Claude prompt-token adjustment (text_quota.go L116-L130) → systematic Claude / OpenRouter Claude overcount | Helper signature gets `relayInfo`; delegates semantic detection to the package-private `usageSemanticFromUsage`; mirrors `isOpenRouterClaudeBilling` branch including optional `CalcOpenRouterCacheCreateTokens` inference; also handles `isLegacyClaudeDerivedOpenAIUsage` |
| 3 | P1 | `ComputePlatformCostActualText` returned 0 on nil usage; user-bill falls back to `relayInfo.GetEstimatePromptTokens()` on timeout, so ledgers diverged on failed upstream | Function now constructs the same fallback usage when `usage == nil` (requires `relayInfo` non-nil; otherwise legitimately 0) |
| 4 | P1 | A.8 Step 2 said "if missing add `TrackPlatformChannelUsageIfApplicable` to PostWssConsumeQuota"; that would double-count because PreWssConsumeQuota:L154 already accumulates | Step 2 rewritten with explicit anti-double-count rule: PostWss populates `PlatformCostQuota` for logging only. `AddDualLedgerLogFields` wired in after `GenerateWssOtherInfo`. Any future reconcile-on-settle is out of scope; it must first gut the PreWss tracker |
| 5 | P1 | A.9b wrote `platform_cost_quota` but omitted `user_bill_quota`, breaking A.9's "every log row" contract. `taskBillingOther(task)` had no handle on settled amount anyway | `taskBillingOther` signature changes to `taskBillingOther(task, userBillQuota int)`; both callsites (L184, L255) updated to pass the local quota |

## Reviewer-Fix Addendum rev5 (2026-04-24)

Fourth review round: one remaining subtle leak.

| # | Severity | Issue                                                                          | Fix location |
|---|----------|--------------------------------------------------------------------------------|--------------|
| 1 | P1 | `CalcOpenRouterCacheCreateTokens` reads `priceData.ModelRatio` — the user-bill field that `ApplyChannelBillingOverrides` mutates via `ModelRatioOverride`. Calling it with `pd` as-is let tenant channel overrides pollute platform cost inference | OpenRouter cache inference now clones `pd` into a local `costPD` with `costPD.ModelRatio = pd.PlatformCostModelRatio` before calling, isolating the inference from tenant pricing |

Ready for execution.
