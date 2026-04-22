# Tenant Platform-Channel Quota Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap each tenant's spend on platform channels with a configurable quota ceiling (e.g. 80,000 quota units), with optional periodic reset (none / daily / monthly). Pre-consume hard-rejects when the cap would be exceeded; usage is incremented after settlement; period resets are lazy on read.

**Architecture:** Storage lives on the existing `TenantPlan` row (4 new columns) — no new tables, no Redis dependency. The check helper (`CheckTenantPlatformChannelQuota`) and increment helper (`IncrementTenantPlatformChannelUsed`) live in `service/tenant_quota.go` next to existing `CheckTenantQuota` / `IncrementTenantTPM` so the call patterns stay symmetric. The check fires only when the chosen channel is `scope='platform'`. The increment fires after `SettleBilling` succeeds, sized by the actual settled quota (not the pre-consumed estimate). Period rollover is detected by comparing `time.Now()` against `platform_quota_period_start` whenever the helpers run, and an atomic `UPDATE ... SET used=0, period_start=...` resets it. No background job.

**Tech Stack:** Go (Gin + GORM), React + TanStack Query (web-next), shadcn-ui dialogs, Tailwind. Database: same as existing tenant_plan table (MySQL/Postgres/SQLite via GORM).

**Out of scope (don't add):**
- Changing the base pricing source (already uses platform-wide `modelRatioMap`, which IS the platform-tenant pricing — A scheme is current behavior).
- Per-model caps (single per-tenant cap covers the ask).
- Notification emails / webhook on cap-near (can add later).
- Soft-cap / overage billing (hard reject only).

---

## File Structure

**Backend (new code or edits):**
- `model/tenant_plan.go` — add 4 columns, helper consts, `MaybeResetPlatformQuotaPeriod` method, cache invalidation untouched (existing `InvalidateTenantPlanCache` already used).
- `service/tenant_quota.go` — add `CheckTenantPlatformChannelQuota` + `IncrementTenantPlatformChannelUsed`, both honor lazy reset.
- `service/tenant_quota_test.go` — extend with table-driven tests for the new helpers.
- `controller/relay.go` — call check after channel selection (see Task 6 for exact position); call increment after `SettleBilling` succeeds.
- `controller/tenant/plan.go` — extend `UpdateTenantPlanRequest` with the 3 admin-editable fields; `platform_quota_used` is read-only from API.
- `controller/tenant/platform_channel_usage.go` — **new file**. Two endpoints: list per-tenant usage (for "platform channels page → tenants tab") and reset-counter (admin override).
- `router/api-router.go` — wire the new endpoints.

**Frontend (new code or edits):**
- `web-next/src/hooks/usePlatformTenants.ts` — extend `TenantPlan` type + `UpdateTenantPlanPayload`.
- `web-next/src/hooks/usePlatformChannelUsage.ts` — **new file**. `useTenantPlatformChannelUsage()` query hook.
- `web-next/src/components/platform/TenantPlanEditorDialog.tsx` — add a new `Section('plan.section.platform_quota')` with cap + period select.
- `web-next/src/pages/PlatformChannelsAdmin.tsx` — add a "租户用量" tab/panel showing per-tenant table (used/cap/period/progress).
- `web-next/src/i18n/locales/{zh,en}/platform.json` — i18n keys for the new fields & tab.

---

## Schema Conventions

**New columns on `tenant_plans` table** (all on existing `TenantPlan` struct):

| Column                          | Type         | Default | Meaning                                                        |
|---------------------------------|--------------|---------|----------------------------------------------------------------|
| `platform_quota_cap`            | bigint       | -1      | Max platform-channel spend per period; `-1` = unlimited        |
| `platform_quota_period`         | varchar(16)  | 'none'  | One of `none`, `daily`, `monthly`                              |
| `platform_quota_used`           | bigint       | 0       | Quota consumed in current period (atomic increments)           |
| `platform_quota_period_start`   | bigint       | 0       | Unix seconds; start of the current period (set on first use / on reset) |

**Period semantics:**
- `none` — `platform_quota_used` accumulates forever; reset only via admin "reset usage" action.
- `daily` — period boundary is local server time `00:00:00`; on first call after the boundary, `used=0` and `period_start = today 00:00:00 unix`.
- `monthly` — period boundary is the 1st of the month at `00:00:00` local time.

All comparisons use `time.Now()` server-local — explicit UTC handling is out of scope (the platform deploys to a single region).

---

## Task 1: Schema fields + lazy-reset helper on TenantPlan

**Files:**
- Modify: `model/tenant_plan.go`
- Test: `model/tenant_plan_test.go` (create if missing)

- [ ] **Step 1: Write failing test for default values + reset logic**

```go
// model/tenant_plan_test.go
package model

import (
	"testing"
	"time"
)

func TestPlatformQuotaPeriodNone_NeverResets(t *testing.T) {
	p := &TenantPlan{
		PlatformQuotaPeriod: PlatformQuotaPeriodNone,
		PlatformQuotaUsed:   12345,
		PlatformQuotaPeriodStart: time.Now().Add(-365 * 24 * time.Hour).Unix(),
	}
	reset := MaybeResetPlatformQuotaPeriod(p, time.Now())
	if reset {
		t.Fatal("period=none must never reset")
	}
	if p.PlatformQuotaUsed != 12345 {
		t.Fatalf("used should be untouched, got %d", p.PlatformQuotaUsed)
	}
}

func TestPlatformQuotaPeriodDaily_ResetsAcrossDayBoundary(t *testing.T) {
	yesterday := time.Now().Add(-25 * time.Hour)
	p := &TenantPlan{
		PlatformQuotaPeriod:      PlatformQuotaPeriodDaily,
		PlatformQuotaUsed:        500,
		PlatformQuotaPeriodStart: yesterday.Unix(),
	}
	reset := MaybeResetPlatformQuotaPeriod(p, time.Now())
	if !reset {
		t.Fatal("daily period crossing midnight must reset")
	}
	if p.PlatformQuotaUsed != 0 {
		t.Fatalf("used should be zeroed, got %d", p.PlatformQuotaUsed)
	}
	startOfToday := time.Date(time.Now().Year(), time.Now().Month(), time.Now().Day(), 0, 0, 0, 0, time.Local).Unix()
	if p.PlatformQuotaPeriodStart != startOfToday {
		t.Fatalf("period_start should be today 00:00, got %d (want %d)", p.PlatformQuotaPeriodStart, startOfToday)
	}
}

func TestPlatformQuotaPeriodDaily_NoResetWithinSameDay(t *testing.T) {
	noon := time.Date(time.Now().Year(), time.Now().Month(), time.Now().Day(), 12, 0, 0, 0, time.Local)
	p := &TenantPlan{
		PlatformQuotaPeriod:      PlatformQuotaPeriodDaily,
		PlatformQuotaUsed:        500,
		PlatformQuotaPeriodStart: noon.Unix(),
	}
	reset := MaybeResetPlatformQuotaPeriod(p, noon.Add(2*time.Hour))
	if reset {
		t.Fatal("same day must not reset")
	}
}

func TestPlatformQuotaPeriodMonthly_ResetsAcrossMonthBoundary(t *testing.T) {
	now := time.Now()
	lastMonth := time.Date(now.Year(), now.Month()-1, 15, 12, 0, 0, 0, time.Local)
	p := &TenantPlan{
		PlatformQuotaPeriod:      PlatformQuotaPeriodMonthly,
		PlatformQuotaUsed:        9000,
		PlatformQuotaPeriodStart: lastMonth.Unix(),
	}
	reset := MaybeResetPlatformQuotaPeriod(p, now)
	if !reset {
		t.Fatal("monthly period crossing month must reset")
	}
	startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local).Unix()
	if p.PlatformQuotaPeriodStart != startOfMonth {
		t.Fatalf("period_start should be month-start, got %d (want %d)", p.PlatformQuotaPeriodStart, startOfMonth)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./model/ -run TestPlatformQuota -v`
Expected: FAIL — `undefined: PlatformQuotaPeriodNone` and `MaybeResetPlatformQuotaPeriod`.

- [ ] **Step 3: Add the columns + constants + helper to `model/tenant_plan.go`**

Insert these constants under the existing `TenantPlanStatusActive` block (around line 47):

```go
const (
	PlatformQuotaPeriodNone    = "none"
	PlatformQuotaPeriodDaily   = "daily"
	PlatformQuotaPeriodMonthly = "monthly"
)
```

Add 4 fields to the `TenantPlan` struct (after `PlatformMarkup`, before `CreatedAt`):

```go
	// PlatformQuotaCap is the per-period spend ceiling (in quota units) when
	// the tenant uses platform-scope channels. -1 = unlimited.
	PlatformQuotaCap         int64  `json:"platform_quota_cap" gorm:"bigint;default:-1"`
	// PlatformQuotaPeriod controls when PlatformQuotaUsed resets to 0.
	// One of: "none" (never), "daily", "monthly".
	PlatformQuotaPeriod      string `json:"platform_quota_period" gorm:"type:varchar(16);default:'none'"`
	// PlatformQuotaUsed is consumption since PlatformQuotaPeriodStart.
	PlatformQuotaUsed        int64  `json:"platform_quota_used" gorm:"bigint;default:0"`
	// PlatformQuotaPeriodStart is the unix timestamp of the current period's start.
	PlatformQuotaPeriodStart int64  `json:"platform_quota_period_start" gorm:"bigint;default:0"`
```

Add the helper at the bottom of the file:

```go
// MaybeResetPlatformQuotaPeriod inspects the plan's period and, if the
// current time falls outside the active period, mutates the plan in place:
//   - Sets PlatformQuotaUsed = 0
//   - Updates PlatformQuotaPeriodStart to the new period's start (local TZ)
// Returns true when a reset was applied. Caller is responsible for
// persisting the change (typically via an atomic UPDATE).
func MaybeResetPlatformQuotaPeriod(p *TenantPlan, now time.Time) bool {
	if p == nil {
		return false
	}
	switch p.PlatformQuotaPeriod {
	case PlatformQuotaPeriodDaily:
		startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
		if p.PlatformQuotaPeriodStart < startOfToday {
			p.PlatformQuotaUsed = 0
			p.PlatformQuotaPeriodStart = startOfToday
			return true
		}
	case PlatformQuotaPeriodMonthly:
		startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).Unix()
		if p.PlatformQuotaPeriodStart < startOfMonth {
			p.PlatformQuotaUsed = 0
			p.PlatformQuotaPeriodStart = startOfMonth
			return true
		}
	}
	return false
}
```

Also extend the default-plan creation block in `GetTenantPlan` (around line 90) to set the defaults explicitly:

```go
		PlatformQuotaCap:         -1,
		PlatformQuotaPeriod:      PlatformQuotaPeriodNone,
		PlatformQuotaUsed:        0,
		PlatformQuotaPeriodStart: 0,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./model/ -run TestPlatformQuota -v`
Expected: 4 PASS.

- [ ] **Step 5: Verify AutoMigrate already covers TenantPlan**

Read `model/main.go` line 524 — confirm `{&TenantPlan{}, "TenantPlan"}` is in the migration list. (No code change needed.) GORM AutoMigrate adds new columns automatically.

- [ ] **Step 6: Commit**

```bash
git add model/tenant_plan.go model/tenant_plan_test.go
git commit -m "feat(tenant-plan): add platform-channel quota cap fields + lazy period reset"
```

---

## Task 2: Service-layer cap-check helper

**Files:**
- Modify: `service/tenant_quota.go`
- Test: `service/tenant_quota_test.go`

**Behavior:**
- `CheckTenantPlatformChannelQuota(tenantId int, projectedQuota int) error` returns `nil` when the request fits, or an error message naming the cap when it would exceed.
- Reads `TenantPlan` via `GetTenantPlan` (cached). Calls `MaybeResetPlatformQuotaPeriod` and persists if reset (atomic UPDATE on the row, then invalidates the plan cache).
- `tenantId <= 0` → returns nil (skip enforcement; matches existing helpers).
- `PlatformQuotaCap < 0` → returns nil (unlimited).

- [ ] **Step 1: Write failing test**

Append to `service/tenant_quota_test.go`:

```go
func TestCheckTenantPlatformChannelQuota_Unlimited(t *testing.T) {
	plan := &model.TenantPlan{TenantId: 100, PlatformQuotaCap: -1}
	err := checkPlatformChannelQuotaForPlan(plan, 99999)
	if err != nil {
		t.Fatalf("expected nil for unlimited cap, got %v", err)
	}
}

func TestCheckTenantPlatformChannelQuota_FitsUnderCap(t *testing.T) {
	plan := &model.TenantPlan{
		TenantId:          100,
		PlatformQuotaCap:  10000,
		PlatformQuotaUsed: 5000,
	}
	if err := checkPlatformChannelQuotaForPlan(plan, 1000); err != nil {
		t.Fatalf("expected nil when used+projected < cap, got %v", err)
	}
}

func TestCheckTenantPlatformChannelQuota_ExceedsCap(t *testing.T) {
	plan := &model.TenantPlan{
		TenantId:          100,
		PlatformQuotaCap:  10000,
		PlatformQuotaUsed: 9500,
	}
	err := checkPlatformChannelQuotaForPlan(plan, 1000)
	if err == nil {
		t.Fatal("expected error when used+projected > cap")
	}
	if !strings.Contains(err.Error(), "10000") {
		t.Fatalf("error should mention cap value, got: %s", err.Error())
	}
}

func TestCheckTenantPlatformChannelQuota_AtCapBoundary(t *testing.T) {
	plan := &model.TenantPlan{
		TenantId:          100,
		PlatformQuotaCap:  10000,
		PlatformQuotaUsed: 10000,
	}
	if err := checkPlatformChannelQuotaForPlan(plan, 1); err == nil {
		t.Fatal("expected error when already at cap")
	}
}
```

Add the import `"github.com/QuantumNous/new-api/model"` to the test file if not present.

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./service/ -run TestCheckTenantPlatformChannelQuota -v`
Expected: FAIL — `undefined: checkPlatformChannelQuotaForPlan`.

- [ ] **Step 3: Implement the helper pair in `service/tenant_quota.go`**

Append at the bottom of the file:

```go
// CheckTenantPlatformChannelQuota verifies that the tenant has enough
// remaining platform-channel quota to cover `projectedQuota` for a single
// request. Lazily resets the period counter when crossing a boundary.
//
// Returns nil if:
//   - tenantId <= 0 (enforcement disabled for non-tenant contexts), or
//   - PlatformQuotaCap < 0 (unlimited).
//
// Otherwise returns a descriptive error when used + projected > cap.
func CheckTenantPlatformChannelQuota(tenantId int, projectedQuota int) error {
	if tenantId <= 0 {
		return nil
	}
	plan, err := model.GetTenantPlan(tenantId)
	if err != nil {
		return fmt.Errorf("获取租户计划失败: %w", err)
	}
	// Lazy period reset; persist if it changed.
	if model.MaybeResetPlatformQuotaPeriod(plan, time.Now()) {
		if err := persistPlatformQuotaReset(plan); err != nil {
			common.SysError(fmt.Sprintf("persistPlatformQuotaReset failed tenant=%d: %s", tenantId, err.Error()))
			// fail-open on persist failure — better to charge twice than to block traffic
		}
	}
	return checkPlatformChannelQuotaForPlan(plan, projectedQuota)
}

// checkPlatformChannelQuotaForPlan is the pure-data inner check, exposed
// for tests so they don't need a DB.
func checkPlatformChannelQuotaForPlan(plan *model.TenantPlan, projectedQuota int) error {
	if plan == nil || plan.PlatformQuotaCap < 0 {
		return nil
	}
	if plan.PlatformQuotaUsed+int64(projectedQuota) > plan.PlatformQuotaCap {
		return fmt.Errorf("租户平台渠道额度不足 (上限 %d，已用 %d，本次需要 %d)",
			plan.PlatformQuotaCap, plan.PlatformQuotaUsed, projectedQuota)
	}
	return nil
}

// persistPlatformQuotaReset writes the zeroed counter + new period_start
// back to the DB and invalidates the plan cache. Atomic single-row UPDATE.
func persistPlatformQuotaReset(plan *model.TenantPlan) error {
	res := model.WithTenantBypass(model.DB).Model(&model.TenantPlan{}).
		Where("tenant_id = ?", plan.TenantId).
		Updates(map[string]interface{}{
			"platform_quota_used":         plan.PlatformQuotaUsed,
			"platform_quota_period_start": plan.PlatformQuotaPeriodStart,
		})
	if res.Error != nil {
		return res.Error
	}
	model.InvalidateTenantPlanCache(plan.TenantId)
	return nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./service/ -run TestCheckTenantPlatformChannelQuota -v`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add service/tenant_quota.go service/tenant_quota_test.go
git commit -m "feat(tenant-quota): add CheckTenantPlatformChannelQuota with lazy period reset"
```

---

## Task 3: Service-layer increment helper

**Files:**
- Modify: `service/tenant_quota.go`
- Test: `service/tenant_quota_test.go`

**Behavior:**
- `IncrementTenantPlatformChannelUsed(tenantId int, quotaDelta int)` atomically `UPDATE tenant_plans SET platform_quota_used = platform_quota_used + ? WHERE tenant_id = ?` and invalidates the plan cache.
- Skips when `tenantId <= 0`, `quotaDelta <= 0`, or the plan's cap is unlimited (no point tracking what we won't enforce).
- Lazy-resets the period before incrementing (to avoid leaking yesterday's tail into today's bucket).

- [ ] **Step 1: Write failing test (DB-required, use the existing test sqlite setup)**

Locate how other tests bootstrap `model.DB` (look in `service/quota_test.go` or `model/main_test.go`). If a test fixture exists, follow it. Otherwise, add a thin in-memory check that exercises `IncrementTenantPlatformChannelUsed(0, 100)` is a no-op:

```go
func TestIncrementTenantPlatformChannelUsed_ZeroIgnored(t *testing.T) {
	// Negative tenant id and zero delta should be no-ops (no DB call attempted).
	IncrementTenantPlatformChannelUsed(0, 100)
	IncrementTenantPlatformChannelUsed(-1, 100)
	IncrementTenantPlatformChannelUsed(42, 0)
	IncrementTenantPlatformChannelUsed(42, -5)
	// If we got here without panicking, the guards work.
}
```

For the DB-touching path, defer to the integration test in Task 6. (It's not worth wiring a sqlite harness for this one helper.)

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./service/ -run TestIncrementTenantPlatformChannelUsed -v`
Expected: FAIL — function not defined.

- [ ] **Step 3: Implement in `service/tenant_quota.go`**

Append:

```go
// IncrementTenantPlatformChannelUsed atomically adds `quotaDelta` to the
// tenant's platform-channel period counter. Called after SettleBilling
// completes successfully for a request that ran on a platform-scope channel.
// No-op when tenantId <= 0, delta <= 0, or the tenant has no cap configured.
func IncrementTenantPlatformChannelUsed(tenantId int, quotaDelta int) {
	if tenantId <= 0 || quotaDelta <= 0 {
		return
	}
	plan, err := model.GetTenantPlan(tenantId)
	if err != nil {
		common.SysError(fmt.Sprintf("IncrementTenantPlatformChannelUsed: GetTenantPlan failed tenant=%d: %s", tenantId, err.Error()))
		return
	}
	if plan.PlatformQuotaCap < 0 {
		return // unlimited — don't bother tracking
	}
	// Lazy reset before increment.
	if model.MaybeResetPlatformQuotaPeriod(plan, time.Now()) {
		if err := persistPlatformQuotaReset(plan); err != nil {
			common.SysError(fmt.Sprintf("persistPlatformQuotaReset (pre-increment) tenant=%d: %s", tenantId, err.Error()))
		}
	}
	res := model.WithTenantBypass(model.DB).Model(&model.TenantPlan{}).
		Where("tenant_id = ?", tenantId).
		UpdateColumn("platform_quota_used", gorm.Expr("platform_quota_used + ?", quotaDelta))
	if res.Error != nil {
		common.SysError(fmt.Sprintf("IncrementTenantPlatformChannelUsed UPDATE failed tenant=%d delta=%d: %s", tenantId, quotaDelta, res.Error.Error()))
		return
	}
	model.InvalidateTenantPlanCache(tenantId)
}
```

Add `"gorm.io/gorm"` to the imports if not already present.

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./service/ -run TestIncrementTenantPlatformChannelUsed -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add service/tenant_quota.go service/tenant_quota_test.go
git commit -m "feat(tenant-quota): add IncrementTenantPlatformChannelUsed helper"
```

---

## Task 4: Wire pre-consume cap-check into the relay flow

**Files:**
- Modify: `controller/relay.go`

**Where:** The check must run after the channel has been chosen (so we know `Scope == "platform"`) but before `PreConsumeBilling` actually decrements wallet quota — i.e. at the point we already have `priceData.QuotaToPreConsume` and `info.ChannelMeta` populated.

**How to find the exact spot:** Search `controller/relay.go` for `PreConsumeBilling(`. The check goes immediately before that call. The channel is on `relayInfo.ChannelMeta.Channel` (or `model.CacheGetChannel(relayInfo.ChannelId)`); the projected quota is `relayInfo.PriceData.QuotaToPreConsume` (or `relayInfo.PriceData.Quota` for per-call billing).

- [ ] **Step 1: Read the relay flow to confirm insertion point**

```bash
grep -n "PreConsumeBilling\|ChannelMeta\|PriceData" controller/relay.go | head -30
```

Identify the line number where `PreConsumeBilling(c, ...` is invoked. Insert the new check immediately above it. If there are multiple call sites (e.g. for streaming vs non-streaming), insert at each. The intent is "guard before any wallet decrement on a platform channel."

- [ ] **Step 2: Write the check block**

Insert directly above each `service.PreConsumeBilling(...)` call:

```go
// Platform-channel cap enforcement: only when the chosen channel is platform-scope.
if relayInfo.TenantId > 0 && relayInfo.ChannelMeta != nil && relayInfo.ChannelMeta.Channel != nil &&
	relayInfo.ChannelMeta.Channel.Scope == model.ChannelScopePlatform {
	projected := relayInfo.PriceData.QuotaToPreConsume
	if projected == 0 {
		projected = relayInfo.PriceData.Quota
	}
	if err := service.CheckTenantPlatformChannelQuota(relayInfo.TenantId, projected); err != nil {
		addTraceEvent(c, "tenant_check", fmt.Sprintf("租户平台渠道额度检查失败: %s", err.Error()), nil)
		newAPIError = types.NewErrorWithStatusCode(err, types.ErrorCodeTenantQuotaExceeded, http.StatusTooManyRequests, types.ErrOptionWithSkipRetry())
		return
	}
}
```

If `relayInfo.ChannelMeta.Channel` is not directly accessible, fall back to:

```go
if ch, _ := model.CacheGetChannel(relayInfo.ChannelId); ch != nil && ch.Scope == model.ChannelScopePlatform {
```

- [ ] **Step 3: Build and run existing relay tests to confirm no regression**

Run: `go build ./...`
Expected: success.

Run: `go test ./controller/... -run TestRelay -v`
Expected: same pass count as before this task (no new failures). If there are no relay unit tests, that's fine — Task 9 covers integration manually.

- [ ] **Step 4: Commit**

```bash
git add controller/relay.go
git commit -m "feat(relay): enforce platform-channel quota cap at pre-consume"
```

---

## Task 5: Wire post-settle increment into the relay flow

**Files:**
- Modify: `controller/relay.go` (or wherever `SettleBilling` is called from — likely the same file)

**Where:** Immediately after `service.SettleBilling(...)` returns nil. Use the actual settled quota (the value passed to SettleBilling), not the pre-consumed estimate.

- [ ] **Step 1: Find every SettleBilling call site**

```bash
grep -n "SettleBilling" controller/ -r
```

For each call site, the actual quota is the second argument. Capture it in a local `actualQuota` if it's not already named.

- [ ] **Step 2: Insert the increment after each call**

Pattern:

```go
if err := service.SettleBilling(c, relayInfo, actualQuota); err != nil {
	// existing error handling
}
// Track platform-channel usage for cap accounting (no-op if no cap configured).
if relayInfo.TenantId > 0 && relayInfo.ChannelMeta != nil && relayInfo.ChannelMeta.Channel != nil &&
	relayInfo.ChannelMeta.Channel.Scope == model.ChannelScopePlatform {
	service.IncrementTenantPlatformChannelUsed(relayInfo.TenantId, actualQuota)
}
```

If the same condition is being tested in Task 4 and Task 5 in the same function, hoist the channel pointer into a variable at the top so both checks reuse it.

- [ ] **Step 3: Build and confirm no regression**

Run: `go build ./... && go test ./controller/... -v`
Expected: success, no new failures.

- [ ] **Step 4: Commit**

```bash
git add controller/relay.go
git commit -m "feat(relay): increment tenant platform-channel quota usage after settle"
```

---

## Task 6: Backend API — extend plan update + read-only usage endpoint

**Files:**
- Modify: `controller/tenant/plan.go` — extend `UpdateTenantPlanRequest` & handler.
- Create: `controller/tenant/platform_channel_usage.go` — list endpoint.
- Modify: `router/api-router.go` — wire the new route.

- [ ] **Step 1: Extend `UpdateTenantPlanRequest` in `controller/tenant/plan.go`**

Add fields after `RenewCurrency`:

```go
	PlatformQuotaCap    *int64  `json:"platform_quota_cap"`
	PlatformQuotaPeriod *string `json:"platform_quota_period"` // none / daily / monthly
```

In `UpdateTenantPlanHandler` (after the renewal block, before `UpsertTenantPlan`):

```go
	if req.PlatformQuotaCap != nil {
		v := *req.PlatformQuotaCap
		if v < -1 {
			v = -1
		}
		plan.PlatformQuotaCap = v
	}
	if req.PlatformQuotaPeriod != nil {
		switch *req.PlatformQuotaPeriod {
		case model.PlatformQuotaPeriodNone, model.PlatformQuotaPeriodDaily, model.PlatformQuotaPeriodMonthly:
			plan.PlatformQuotaPeriod = *req.PlatformQuotaPeriod
		default:
			common.ApiErrorMsg(c, "无效的周期类型，必须是 none/daily/monthly")
			return
		}
	}
```

**Important:** Do NOT expose `platform_quota_used` or `platform_quota_period_start` on this update path — those are server-managed. Reads return them on the GET endpoint already.

- [ ] **Step 2: Create the usage list endpoint `controller/tenant/platform_channel_usage.go`**

```go
package tenant

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// PlatformChannelUsageRow is one row in the per-tenant platform-channel cap table.
type PlatformChannelUsageRow struct {
	TenantId            int    `json:"tenant_id"`
	TenantName          string `json:"tenant_name"`
	PlanName            string `json:"plan_name"`
	PlatformQuotaCap    int64  `json:"platform_quota_cap"`
	PlatformQuotaUsed   int64  `json:"platform_quota_used"`
	PlatformQuotaPeriod string `json:"platform_quota_period"`
	PeriodStart         int64  `json:"period_start"`
}

// ListPlatformChannelUsage returns one row per tenant with their current
// cap configuration and consumption. Platform-admin only.
// GET /api/platform/tenants/platform-channel-usage
func ListPlatformChannelUsage(c *gin.Context) {
	plans, err := model.GetAllTenantPlans()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	rows := make([]PlatformChannelUsageRow, 0, len(plans))
	for _, p := range plans {
		// Skip the platform tenant itself — it owns the channels, doesn't consume them.
		if p.TenantId <= 0 {
			continue
		}
		t := model.GetTenantById(p.TenantId)
		name := ""
		if t != nil {
			name = t.Name
		}
		rows = append(rows, PlatformChannelUsageRow{
			TenantId:            p.TenantId,
			TenantName:          name,
			PlanName:            p.PlanName,
			PlatformQuotaCap:    p.PlatformQuotaCap,
			PlatformQuotaUsed:   p.PlatformQuotaUsed,
			PlatformQuotaPeriod: p.PlatformQuotaPeriod,
			PeriodStart:         p.PlatformQuotaPeriodStart,
		})
	}
	common.ApiSuccess(c, rows)
}

// ResetPlatformChannelUsage manually zeros out a tenant's used counter.
// Platform-admin only. POST /api/platform/tenants/:id/platform-channel-usage/reset
func ResetPlatformChannelUsage(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的租户 ID")
		return
	}
	if err := model.WithTenantBypass(model.DB).Model(&model.TenantPlan{}).
		Where("tenant_id = ?", id).
		Updates(map[string]interface{}{
			"platform_quota_used":         0,
			"platform_quota_period_start": 0,
		}).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	model.InvalidateTenantPlanCache(id)
	common.ApiSuccessOK(c)
}
```

If `common.ApiSuccessOK` doesn't exist, use `common.ApiSuccess(c, gin.H{"ok": true})`.

- [ ] **Step 3: Wire routes in `router/api-router.go`**

Find the existing `/api/platform/tenants/...` group (search `platform/tenants/plans`). Add next to it:

```go
	platformGroup.GET("/tenants/platform-channel-usage", tenant.ListPlatformChannelUsage)
	platformGroup.POST("/tenants/:id/platform-channel-usage/reset", tenant.ResetPlatformChannelUsage)
```

Match the exact group variable name and middleware chain used by the surrounding routes — copy the style of the existing `tenants/plans` line.

- [ ] **Step 4: Build to verify**

Run: `go build ./...`
Expected: success.

- [ ] **Step 5: Smoke-test with curl (server must be running)**

```bash
# Replace TOKEN with a platform-admin session cookie or token header.
curl -s http://localhost:4928/api/platform/tenants/platform-channel-usage \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Expected: `{"success":true,"data":[{"tenant_id":2,"tenant_name":"...","platform_quota_cap":-1,...}]}`

- [ ] **Step 6: Commit**

```bash
git add controller/tenant/plan.go controller/tenant/platform_channel_usage.go router/api-router.go
git commit -m "feat(api): expose tenant platform-channel quota cap admin endpoints"
```

---

## Task 7: Frontend types + hooks

**Files:**
- Modify: `web-next/src/hooks/usePlatformTenants.ts` — extend `TenantPlan` & payload types.
- Create: `web-next/src/hooks/usePlatformChannelUsage.ts` — query + reset mutation.

- [ ] **Step 1: Extend `TenantPlan` and `UpdateTenantPlanPayload` in `usePlatformTenants.ts`**

Add to `TenantPlan` type (after `renew_currency`):

```ts
  platform_quota_cap: number;
  platform_quota_period: 'none' | 'daily' | 'monthly';
  platform_quota_used: number;
  platform_quota_period_start: number;
```

Add to `UpdateTenantPlanPayload`:

```ts
  platform_quota_cap?: number;
  platform_quota_period?: 'none' | 'daily' | 'monthly';
```

- [ ] **Step 2: Create `web-next/src/hooks/usePlatformChannelUsage.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

const keys = {
  usage: ['platform', 'channel-usage'] as const,
};

export type PlatformChannelUsageRow = {
  tenant_id: number;
  tenant_name: string;
  plan_name: string;
  platform_quota_cap: number;
  platform_quota_used: number;
  platform_quota_period: 'none' | 'daily' | 'monthly';
  period_start: number;
};

export function usePlatformChannelUsage() {
  return useQuery<PlatformChannelUsageRow[]>({
    queryKey: keys.usage,
    queryFn: async () => {
      const res = await api.get<PlatformChannelUsageRow[]>(
        '/api/platform/tenants/platform-channel-usage',
      );
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 10_000,
  });
}

export function useResetPlatformChannelUsage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tenantId: number) => {
      await api.post(`/api/platform/tenants/${tenantId}/platform-channel-usage/reset`);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.usage }),
  });
}
```

- [ ] **Step 3: Type-check**

Run: `cd web-next && pnpm typecheck` (or `npm run typecheck`)
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web-next/src/hooks/usePlatformTenants.ts web-next/src/hooks/usePlatformChannelUsage.ts
git commit -m "feat(web-next): add platform-channel quota types + usage hook"
```

---

## Task 8: Plan editor dialog — add the "platform quota" section

**Files:**
- Modify: `web-next/src/components/platform/TenantPlanEditorDialog.tsx`
- Modify: `web-next/src/i18n/locales/zh/platform.json`
- Modify: `web-next/src/i18n/locales/en/platform.json`

- [ ] **Step 1: Add i18n keys**

In `platform.json` (zh), under the existing `plan` block, add:

```json
"section": {
  ...existing keys...,
  "platform_quota": "平台渠道额度上限"
},
"field": {
  ...existing keys...,
  "platform_quota_cap": "额度上限",
  "platform_quota_period": "重置周期"
},
"hint": {
  ...existing keys...,
  "platform_quota_cap": "该租户使用平台渠道时单周期最多消耗的 quota；-1 表示不限",
  "platform_quota_period": "选择 daily 或 monthly 后会在边界自动归零；none 不重置",
  "platform_quota_used": "当前周期已用 {{used}} / {{cap}}"
},
"option": {
  "period_none": "不重置",
  "period_daily": "每日",
  "period_monthly": "每月"
}
```

Same structure in `en/platform.json` with English translations:
- `platform_quota`: "Platform Channel Quota Cap"
- `platform_quota_cap`: "Cap"
- `platform_quota_period`: "Reset Period"
- (hints translated accordingly)

- [ ] **Step 2: Extend `FormState` in TenantPlanEditorDialog.tsx**

Add to `FormState` type:

```ts
  platform_quota_cap: string;
  platform_quota_period: 'none' | 'daily' | 'monthly';
```

Extend `fromPlan`:

```ts
    platform_quota_cap: String(plan.platform_quota_cap),
    platform_quota_period: plan.platform_quota_period,
```

Extend `onSave`'s `body`:

```ts
      platform_quota_cap: Number(form.platform_quota_cap),
      platform_quota_period: form.platform_quota_period,
```

- [ ] **Step 3: Add the new `Section` block in the dialog body**

Insert before the existing `<Section title={t('plan.section.renewal')}>`:

```tsx
          <Section title={t('plan.section.platform_quota')}>
            <p className='text-12 text-fg-2'>
              {t('plan.hint.platform_quota_used', {
                used: plan.platform_quota_used,
                cap: plan.platform_quota_cap < 0 ? '∞' : plan.platform_quota_cap,
              })}
            </p>
            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-2'>
                <Label>{t('plan.field.platform_quota_cap')}</Label>
                <Input
                  type='number'
                  value={form.platform_quota_cap}
                  onChange={(e) => patch('platform_quota_cap', e.target.value)}
                  className='tabular-nums'
                />
                <p className='text-12 text-fg-2'>{t('plan.hint.platform_quota_cap')}</p>
              </div>
              <div className='space-y-2'>
                <Label>{t('plan.field.platform_quota_period')}</Label>
                <select
                  value={form.platform_quota_period}
                  onChange={(e) =>
                    patch('platform_quota_period', e.target.value as FormState['platform_quota_period'])
                  }
                  className='h-9 w-full rounded-md border border-line bg-bg-1 px-2 text-13'
                >
                  <option value='none'>{t('plan.option.period_none')}</option>
                  <option value='daily'>{t('plan.option.period_daily')}</option>
                  <option value='monthly'>{t('plan.option.period_monthly')}</option>
                </select>
                <p className='text-12 text-fg-2'>{t('plan.hint.platform_quota_period')}</p>
              </div>
            </div>
          </Section>
```

If the project uses a `<Select>` component from shadcn instead of native `<select>`, follow the existing convention — search the dialog for any existing select patterns.

- [ ] **Step 4: Type-check + manual visual check**

Run: `cd web-next && pnpm typecheck`
Expected: no errors.

Start the dev server (`pnpm dev`), open `/admin/platform/tenants` in browser, click "edit plan" on any tenant. Verify:
- New "平台渠道额度上限" section appears.
- Cap input shows current value (`-1` by default).
- Period select shows "不重置" by default.
- Editing values, clicking save, and reopening the dialog round-trips the new values.

- [ ] **Step 5: Commit**

```bash
git add web-next/src/components/platform/TenantPlanEditorDialog.tsx \
        web-next/src/i18n/locales/zh/platform.json \
        web-next/src/i18n/locales/en/platform.json
git commit -m "feat(web-next): plan editor exposes platform-channel quota cap"
```

---

## Task 9: Platform channels page — add "Tenant Usage" tab

**Files:**
- Modify: `web-next/src/pages/PlatformChannelsAdmin.tsx`
- Modify: `web-next/src/i18n/locales/{zh,en}/platform.json` (one new key)

- [ ] **Step 1: Add i18n key**

In both locale files, under `platform_channels` (or appropriate top-level), add:

```json
"tab": {
  "channels": "渠道",
  "tenant_usage": "租户用量"
}
```

(English: `"channels": "Channels"`, `"tenant_usage": "Tenant Usage"`)

- [ ] **Step 2: Read the current PlatformChannelsAdmin.tsx structure**

```bash
cat web-next/src/pages/PlatformChannelsAdmin.tsx | head -60
```

Identify how the page is laid out today — usually a single channel list. We'll wrap it in a Tabs component.

- [ ] **Step 3: Add a Tabs wrapper**

Refactor the page so the existing channel list lives in `<TabsContent value="channels">` and a new `<TabsContent value="tenant_usage">` renders the usage table. Use the project's existing Tabs component (likely `@/components/ui/tabs` from shadcn). Pattern:

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePlatformChannelUsage, useResetPlatformChannelUsage } from '@/hooks/usePlatformChannelUsage';

// ... inside the component return:
<Tabs defaultValue='channels'>
  <TabsList>
    <TabsTrigger value='channels'>{t('tab.channels')}</TabsTrigger>
    <TabsTrigger value='tenant_usage'>{t('tab.tenant_usage')}</TabsTrigger>
  </TabsList>
  <TabsContent value='channels'>
    {/* existing channel list JSX */}
  </TabsContent>
  <TabsContent value='tenant_usage'>
    <TenantUsagePanel />
  </TabsContent>
</Tabs>
```

Define `TenantUsagePanel` in the same file (or extract to `web-next/src/components/platform/TenantPlatformUsageTable.tsx` if it grows past ~80 lines):

```tsx
function TenantUsagePanel() {
  const { t } = useTranslation('platform');
  const { data = [], isLoading } = usePlatformChannelUsage();
  const reset = useResetPlatformChannelUsage();

  if (isLoading) return <div className='p-4 text-13 text-fg-2'>Loading…</div>;

  return (
    <table className='w-full text-13'>
      <thead className='text-fg-2'>
        <tr>
          <th className='py-2 text-left'>租户</th>
          <th className='py-2 text-left'>计划</th>
          <th className='py-2 text-right'>已用</th>
          <th className='py-2 text-right'>上限</th>
          <th className='py-2 text-left'>周期</th>
          <th className='py-2 text-right'>占比</th>
          <th className='py-2 text-right'>操作</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => {
          const pct =
            row.platform_quota_cap > 0
              ? Math.min(100, Math.round((row.platform_quota_used / row.platform_quota_cap) * 100))
              : 0;
          return (
            <tr key={row.tenant_id} className='border-t border-line'>
              <td className='py-2'>{row.tenant_name || `#${row.tenant_id}`}</td>
              <td className='py-2'>{row.plan_name}</td>
              <td className='py-2 text-right tabular-nums'>{row.platform_quota_used}</td>
              <td className='py-2 text-right tabular-nums'>
                {row.platform_quota_cap < 0 ? '∞' : row.platform_quota_cap}
              </td>
              <td className='py-2'>{row.platform_quota_period}</td>
              <td className='py-2 text-right tabular-nums'>
                {row.platform_quota_cap < 0 ? '—' : `${pct}%`}
              </td>
              <td className='py-2 text-right'>
                <button
                  className='text-12 text-fg-2 hover:text-fg-0'
                  onClick={() => reset.mutate(row.tenant_id)}
                  disabled={reset.isPending}
                >
                  归零
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Type-check + visual verify**

Run: `cd web-next && pnpm typecheck`

In browser (`/admin/platform/channels`), verify the two tabs render, the usage table loads from the new API, and clicking "归零" zeroes the row.

- [ ] **Step 5: Commit**

```bash
git add web-next/src/pages/PlatformChannelsAdmin.tsx \
        web-next/src/i18n/locales/zh/platform.json \
        web-next/src/i18n/locales/en/platform.json
git commit -m "feat(web-next): platform channels page exposes per-tenant usage tab"
```

---

## Task 10: End-to-end smoke test (manual)

**No code change. Verify the full loop works.**

- [ ] **Step 1: Set a low cap on a test tenant**

Via the plan editor dialog (Task 8), set tenant #2 (or any non-platform tenant) `platform_quota_cap = 100`, `platform_quota_period = none`, save.

- [ ] **Step 2: Issue a request that uses a platform channel**

From a tenant-#2 user's API token, hit `/v1/chat/completions` with a tiny prompt against a platform-channel-served model.

Expected: request succeeds, `platform_quota_used` increases by the actual quota cost (visible in the "Tenant Usage" tab after refresh).

- [ ] **Step 3: Issue requests until the cap is hit**

Continue until `used >= cap`. Next request should return HTTP 429 with body containing "租户平台渠道额度不足 (上限 100, 已用 X, 本次需要 Y)".

- [ ] **Step 4: Click "归零" in the usage tab; issue another request**

Expected: request succeeds again, `used` starts climbing from 0.

- [ ] **Step 5: Set period to `daily`, manually set `platform_quota_period_start` to yesterday via DB UPDATE, then issue a request**

```sql
UPDATE tenant_plans SET platform_quota_period_start = UNIX_TIMESTAMP(CURDATE() - INTERVAL 1 DAY) WHERE tenant_id = 2;
```

Expected: the next request triggers `MaybeResetPlatformQuotaPeriod`, `used` resets to 0, and the period_start updates to today 00:00. Verify by reloading the usage tab.

- [ ] **Step 6: Commit (docs only — confirm the smoke test pass in the plan log)**

No commit needed unless you discovered a bug — in which case open a follow-up issue or fix in a new commit.

---

## Self-Review Checklist (run before handing off)

- [ ] Every task has actual code, no `// TODO` placeholders.
- [ ] Type names line up across tasks: `TenantPlan` field names match between Go struct (Task 1), API JSON (Task 6), and TypeScript type (Task 7) — all snake_case in JSON, camelCase in TS only where TS conventions demand.
- [ ] Pre-consume check (Task 4) and post-settle increment (Task 5) both gate on `Channel.Scope == ChannelScopePlatform` so tenant-owned channels are unaffected.
- [ ] Lazy reset is called in BOTH the check helper AND the increment helper, so a tenant whose only traffic is bursts still resets correctly.
- [ ] Cap value `-1` short-circuits both check (skip) and increment (skip persistence) — no useless DB writes.
- [ ] Frontend hides the Section gracefully when the backend returns the field defaults (cap=-1, period='none' is a valid "feature inactive" state — don't error on it).
- [ ] No new permission middleware needed — the new endpoints reuse the same `PlatformAdminAuth` group as `tenants/plans`.
