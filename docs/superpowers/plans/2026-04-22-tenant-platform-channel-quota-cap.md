# Tenant Platform-Channel Quota Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap each tenant's spend on platform channels with a configurable quota ceiling (e.g. 80,000 quota units), with optional periodic reset (none / daily / monthly). Pre-consume hard-rejects when the cap would be exceeded; usage is incremented after settlement; period resets are lazy on read.

**Architecture:** Storage lives on the existing `TenantPlan` row (4 new columns) — no new tables, no Redis dependency. The check helper (`CheckTenantPlatformChannelQuota`) and increment helper (`IncrementTenantPlatformChannelUsed`) live in `service/tenant_quota.go` next to existing `CheckTenantQuota` / `IncrementTenantTPM` so the call patterns stay symmetric. The pre-consume gate is exposed as `helper.EnforcePlatformChannelQuota(c, info)` and called explicitly by each handler at the point where its `info.PriceData` is filled — after `ApplyChannelBillingOverrides` for the main relay handlers (`compatible/claude/audio/embedding/gemini/image/rerank/responses/websocket`) and after `ModelPriceHelperPerCall` for the task/MJ handlers (the two families fill PriceData in different orders, so a single hook point does not work for both). Each `controller/relay.go` retry loop re-enters the handler on a new channel, so the gate fires per attempt. The increment fires from inside `service.SettleBilling` (the single funnel through which all three settle paths — text, audio, task — flow). Period rollover and increment are atomic via optimistic concurrency: a conditional UPDATE keyed on `platform_quota_period_start` (with bounded retry on lost races) — works on SQLite, MySQL, and Postgres without any `FOR UPDATE` row-lock dependency. The reset detector is a pure function (`ComputePlatformQuotaPeriodReset`) that returns the new period_start without ever mutating a cached `*TenantPlan`, so a failed persist cannot poison the in-memory cache. No background job.

**Tech Stack:** Go (Gin + GORM), React + TanStack Query (web-next), shadcn-ui dialogs, Tailwind. Database: same as existing tenant_plan table (MySQL/Postgres/SQLite via GORM).

**Out of scope (don't add):**
- Changing the base pricing source (already uses platform-wide `modelRatioMap`, which IS the platform-tenant pricing — A scheme is current behavior).
- Per-model caps (single per-tenant cap covers the ask).
- Notification emails / webhook on cap-near (can add later).
- Soft-cap / overage billing (hard reject only).

---

## File Structure

**Backend (new code or edits):**
- `model/tenant_plan.go` — add 4 columns + period constants + pure helper `ComputePlatformQuotaPeriodReset(period, periodStart, now) (needReset bool, newPeriodStart int64)`. Does NOT mutate plan.
- `service/tenant_quota.go` — add `CheckTenantPlatformChannelQuota` + `IncrementTenantPlatformChannelUsed`. `CheckTenantPlatformChannelQuota` stays read-only; `IncrementTenantPlatformChannelUsed` uses optimistic concurrency keyed on `platform_quota_period_start` with bounded retry (no `FOR UPDATE`, no row-lock dependency).
- `service/tenant_quota_test.go` — extend with unit tests for the pure-data path; integration test (covered manually in Task 10) exercises the optimistic rollover path.
- `relay/helper/price.go` — add exported `EnforcePlatformChannelQuota(c, info) *types.NewAPIError`. The function reuses `applyPlatformMarkup`'s channel-resolution logic (CacheGetChannel + Scope check). `ApplyChannelBillingOverrides` is **not** modified — handlers call enforce explicitly.
- Main relay handlers (`audio_handler.go`, `claude_handler.go`, `compatible_handler.go`, `embedding_handler.go`, `gemini_handler.go`, `image_handler.go`, `rerank_handler.go`, `responses_handler.go`, `websocket.go`) — call `helper.EnforcePlatformChannelQuota(c, info)` immediately after `helper.ApplyChannelBillingOverrides(info)`.
- Task/MJ handlers (`relay/relay_task.go`, `relay/mjproxy_handler.go`) — call `helper.EnforcePlatformChannelQuota(c, info)` immediately after `helper.ModelPriceHelperPerCall(c, info)` (NOT after `ApplyChannelBillingOverrides`, because PriceData isn't filled yet at that point in this family).
- `service/billing.go` — at the tail of `SettleBilling`, after a successful settle, call a new `incrementPlatformChannelUsedIfApplicable(relayInfo, actualQuota)` helper. This single insertion point covers all three SettleBilling call sites (text_quota, quota.go, controller/relay.go).
- `controller/tenant/plan.go` — extend `UpdateTenantPlanRequest` with the 2 admin-editable fields (`platform_quota_cap`, `platform_quota_period`); `platform_quota_used` and `platform_quota_period_start` are read-only from API.
- `controller/tenant/platform_channel_usage.go` — **new file**. Two endpoints: list per-tenant usage (for "platform channels page → tenants tab") and reset-counter (admin override).
- `router/api-router.go` — wire the new endpoints.

**No edits to `controller/relay.go`** — channel selection still happens in the retry loop and feeds context, but the gate now lives in handlers, not in the controller and not inside `ModelPriceHelper`. That keeps `tenant_quota_exceeded` as a typed `*types.NewAPIError`, avoids the controller's generic `model_price_error` wrapping path, and lets each handler call enforce only after its own `PriceData` is actually ready.

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

## Task 1: Schema fields + pure period-reset detector on TenantPlan

**Files:**
- Modify: `model/tenant_plan.go`
- Test: `model/tenant_plan_test.go` (create if missing)

**Critical design constraint:** `ComputePlatformQuotaPeriodReset` is a **pure function** — it takes `(period, periodStart, now)` and returns `(needReset, newPeriodStart)`. It does NOT take `*TenantPlan` and does NOT mutate anything. This ensures that when callers go through `GetTenantPlan` (which returns the cached pointer), a failed downstream persist cannot leave the in-memory cache in a fake "already reset" state. (Addresses review item P2.)

- [ ] **Step 1: Write failing test for the pure detector**

```go
// model/tenant_plan_test.go
package model

import (
	"testing"
	"time"
)

func TestComputePlatformQuotaPeriodReset_None_NeverResets(t *testing.T) {
	yearAgo := time.Now().Add(-365 * 24 * time.Hour).Unix()
	need, _ := ComputePlatformQuotaPeriodReset(PlatformQuotaPeriodNone, yearAgo, time.Now())
	if need {
		t.Fatal("period=none must never reset")
	}
}

func TestComputePlatformQuotaPeriodReset_Daily_AcrossBoundary(t *testing.T) {
	now := time.Now()
	yesterday := now.Add(-25 * time.Hour).Unix()
	need, newStart := ComputePlatformQuotaPeriodReset(PlatformQuotaPeriodDaily, yesterday, now)
	if !need {
		t.Fatal("daily period crossing midnight must reset")
	}
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	if newStart != startOfToday {
		t.Fatalf("expected newStart=%d (today 00:00), got %d", startOfToday, newStart)
	}
}

func TestComputePlatformQuotaPeriodReset_Daily_SameDay(t *testing.T) {
	now := time.Now()
	noon := time.Date(now.Year(), now.Month(), now.Day(), 12, 0, 0, 0, now.Location())
	need, _ := ComputePlatformQuotaPeriodReset(PlatformQuotaPeriodDaily, noon.Unix(), noon.Add(2*time.Hour))
	if need {
		t.Fatal("same day must not reset")
	}
}

func TestComputePlatformQuotaPeriodReset_Monthly_AcrossBoundary(t *testing.T) {
	now := time.Now()
	lastMonth := time.Date(now.Year(), now.Month()-1, 15, 12, 0, 0, 0, now.Location()).Unix()
	need, newStart := ComputePlatformQuotaPeriodReset(PlatformQuotaPeriodMonthly, lastMonth, now)
	if !need {
		t.Fatal("monthly period crossing must reset")
	}
	startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).Unix()
	if newStart != startOfMonth {
		t.Fatalf("expected newStart=%d (month-start), got %d", startOfMonth, newStart)
	}
}

func TestComputePlatformQuotaPeriodReset_ZeroStart_TriggersResetForActivePeriod(t *testing.T) {
	// Tenant just got a cap configured; period_start is 0 (never used).
	// First request under daily/monthly should set the period_start to the
	// current period anchor without touching used (this is a "first ever"
	// initialization, not a real reset of accumulated usage).
	now := time.Now()
	need, newStart := ComputePlatformQuotaPeriodReset(PlatformQuotaPeriodDaily, 0, now)
	if !need {
		t.Fatal("zero period_start must trigger initialization for daily")
	}
	if newStart == 0 {
		t.Fatal("newStart must be set to today 00:00")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./model/ -run TestComputePlatformQuota -v`
Expected: FAIL — `undefined: PlatformQuotaPeriodNone` and `ComputePlatformQuotaPeriodReset`.

- [ ] **Step 3: Add columns + constants + pure helper**

Insert constants under the existing `TenantPlanStatusActive` block (around line 47):

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

Add the pure helper at the bottom of the file:

```go
// ComputePlatformQuotaPeriodReset is a PURE function (no side effects, no
// mutation, no DB) that decides whether the period boundary has been
// crossed. Returns (needReset, newPeriodStart). If needReset is false,
// newPeriodStart is meaningless and should be ignored.
//
// Callers must use the returned newPeriodStart with a CONDITIONAL UPDATE
// (WHERE platform_quota_period_start = oldStart) to avoid double-resets
// in concurrent paths. Do NOT mutate a cached *TenantPlan with this
// result — invalidate the cache after a successful UPDATE instead.
func ComputePlatformQuotaPeriodReset(period string, periodStart int64, now time.Time) (bool, int64) {
	switch period {
	case PlatformQuotaPeriodDaily:
		startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
		if periodStart < startOfToday {
			return true, startOfToday
		}
	case PlatformQuotaPeriodMonthly:
		startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).Unix()
		if periodStart < startOfMonth {
			return true, startOfMonth
		}
	}
	return false, 0
}
```

Extend the default-plan block in `GetTenantPlan` (around line 90):

```go
		PlatformQuotaCap:         -1,
		PlatformQuotaPeriod:      PlatformQuotaPeriodNone,
		PlatformQuotaUsed:        0,
		PlatformQuotaPeriodStart: 0,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./model/ -run TestComputePlatformQuota -v`
Expected: 5 PASS.

- [ ] **Step 5: Verify AutoMigrate covers TenantPlan**

Read `model/main.go:524` — confirm `{&TenantPlan{}, "TenantPlan"}` is present. No code change needed.

- [ ] **Step 6: Commit**

```bash
git add model/tenant_plan.go model/tenant_plan_test.go
git commit -m "feat(tenant-plan): add platform-channel quota cap fields + pure reset detector"
```

---

## Task 2: Service-layer cap-check helper

**Files:**
- Modify: `service/tenant_quota.go`
- Test: `service/tenant_quota_test.go`

**Behavior:**
- `CheckTenantPlatformChannelQuota(tenantId int, projectedQuota int) error` returns `nil` when the request fits, error otherwise.
- `tenantId <= 0` → nil (matches existing helpers' guard pattern).
- `PlatformQuotaCap < 0` → nil (unlimited).
- For period rollover, this helper does NOT do the actual reset write — the reset is folded into the next `IncrementTenantPlatformChannelUsed` transaction (see Task 3). Here we only **read** the plan and, if `ComputePlatformQuotaPeriodReset` says we've crossed a boundary, treat `PlatformQuotaUsed` as 0 for the purpose of THIS request's check. This avoids the cache-poisoning hazard (P2) and keeps the "definitely correct" reset write inside one transaction with the increment.
- The pure-data inner function `evaluateProjectedQuota(cap, effectiveUsed, projected) error` is exposed for unit tests (no DB).

- [ ] **Step 1: Write failing tests**

Append to `service/tenant_quota_test.go`:

```go
func TestEvaluateProjectedQuota_Unlimited(t *testing.T) {
	if err := evaluateProjectedQuota(-1, 99999, 99999); err != nil {
		t.Fatalf("expected nil for unlimited cap, got %v", err)
	}
}

func TestEvaluateProjectedQuota_FitsUnderCap(t *testing.T) {
	if err := evaluateProjectedQuota(10000, 5000, 1000); err != nil {
		t.Fatalf("expected nil when used+projected < cap, got %v", err)
	}
}

func TestEvaluateProjectedQuota_ExceedsCap(t *testing.T) {
	err := evaluateProjectedQuota(10000, 9500, 1000)
	if err == nil {
		t.Fatal("expected error when used+projected > cap")
	}
	if !strings.Contains(err.Error(), "10000") {
		t.Fatalf("error should mention cap value, got: %s", err.Error())
	}
}

func TestEvaluateProjectedQuota_AtCapBoundary(t *testing.T) {
	if err := evaluateProjectedQuota(10000, 10000, 1); err == nil {
		t.Fatal("expected error when already at cap")
	}
}

func TestEvaluateProjectedQuota_ZeroProjected(t *testing.T) {
	// Free models / 0-quota requests must always pass (don't block on cap math when nothing's being charged).
	if err := evaluateProjectedQuota(10000, 10000, 0); err != nil {
		t.Fatalf("expected nil for zero projected, got %v", err)
	}
}
```

Add the import `"github.com/QuantumNous/new-api/model"` to the test file if not already there. (`evaluateProjectedQuota` itself doesn't need it, but later tests might.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./service/ -run TestEvaluateProjectedQuota -v`
Expected: FAIL — `undefined: evaluateProjectedQuota`.

- [ ] **Step 3: Implement helpers in `service/tenant_quota.go`**

Append:

```go
// CheckTenantPlatformChannelQuota verifies that the tenant has enough
// remaining platform-channel quota to cover `projectedQuota` for ONE
// upcoming request.
//
// Returns nil if:
//   - tenantId <= 0 (enforcement disabled for non-tenant contexts), or
//   - PlatformQuotaCap < 0 (unlimited), or
//   - effective_used + projected <= cap
//
// "effective_used" = plan.PlatformQuotaUsed, OR 0 when ComputePlatformQuotaPeriodReset
// indicates the period has rolled over (the actual zeroing of the row is deferred
// to the increment transaction in Task 3 to keep "reset + accumulate" atomic).
//
// This function NEVER mutates the cached plan and NEVER writes to the DB.
func CheckTenantPlatformChannelQuota(tenantId int, projectedQuota int) error {
	if tenantId <= 0 {
		return nil
	}
	plan, err := model.GetTenantPlan(tenantId)
	if err != nil {
		return fmt.Errorf("获取租户计划失败: %w", err)
	}
	if plan.PlatformQuotaCap < 0 {
		return nil
	}
	effectiveUsed := plan.PlatformQuotaUsed
	if needReset, _ := model.ComputePlatformQuotaPeriodReset(plan.PlatformQuotaPeriod, plan.PlatformQuotaPeriodStart, time.Now()); needReset {
		effectiveUsed = 0
	}
	return evaluateProjectedQuota(plan.PlatformQuotaCap, effectiveUsed, projectedQuota)
}

// evaluateProjectedQuota is the pure-data inner check (DB-free, mutation-free).
// cap < 0 means unlimited. projected <= 0 always passes.
func evaluateProjectedQuota(cap int64, effectiveUsed int64, projected int) error {
	if cap < 0 || projected <= 0 {
		return nil
	}
	if effectiveUsed+int64(projected) > cap {
		return fmt.Errorf("租户平台渠道额度不足 (上限 %d，已用 %d，本次需要 %d)",
			cap, effectiveUsed, projected)
	}
	return nil
}
```

Make sure `time` is in the imports (already there).

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./service/ -run TestEvaluateProjectedQuota -v`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add service/tenant_quota.go service/tenant_quota_test.go
git commit -m "feat(tenant-quota): add CheckTenantPlatformChannelQuota (read-only pre-consume gate)"
```

---

## Task 3: Service-layer increment helper (optimistic-concurrency reset + accumulate)

**Files:**
- Modify: `service/tenant_quota.go`
- Test: `service/tenant_quota_test.go`

**Why optimistic concurrency, not `FOR UPDATE`:** SQLite is a first-class supported backend in this repo (used by tests and small deployments), and SQLite does not have row-level locks — `FOR UPDATE` either errors or is silently dropped depending on driver/version. Pessimistic locking would also require dialect-specific GORM constructs. Optimistic concurrency works on every supported backend with one consistent code path.

**Algorithm:**

```
for attempt in 0..maxRetries:
    SELECT platform_quota_cap, platform_quota_period,
           platform_quota_period_start
      FROM tenant_plans WHERE tenant_id = ?

    if cap < 0:
        return                     // unlimited — nothing to track

    (needReset, newStart) = ComputePlatformQuotaPeriodReset(...)

    if needReset:
        UPDATE tenant_plans
           SET platform_quota_used = ?delta,
               platform_quota_period_start = ?newStart
         WHERE tenant_id = ?
           AND platform_quota_period_start = ?old_period_start
    else:
        UPDATE tenant_plans
           SET platform_quota_used = platform_quota_used + ?delta
         WHERE tenant_id = ?
           AND platform_quota_period_start = ?old_period_start

    if RowsAffected > 0:
        InvalidateTenantPlanCache(tenantId)
        return                     // success
    // Lost the race — another writer changed period_start between
    // our SELECT and UPDATE. Re-read and retry.

log "gave up after maxRetries"      // best-effort, swallow
```

The `WHERE platform_quota_period_start = ?old_period_start` predicate is the optimistic guard. In a daily-rollover race, two concurrent settlements both see the old period_start; whichever UPDATE lands first wins (RowsAffected=1) and the other sees its UPDATE match 0 rows, re-reads (now sees the new period_start), and accumulates correctly under the new period. No lost writes.

**Behavior summary:**
- `tenantId <= 0`, `quotaDelta <= 0`, or `model.DB == nil` → no-op, no DB call.
- Cap unlimited (read inside loop) → return without writing. Avoids growing `used` for tenants that won't be enforced.
- All errors logged via `common.SysError` and SWALLOWED — usage tracking is best-effort and must NEVER fail SettleBilling.

- [ ] **Step 1: Write failing test for input guards**

Append to `service/tenant_quota_test.go`:

```go
func TestIncrementTenantPlatformChannelUsed_GuardsAreNoOps(t *testing.T) {
	// Each guard must return BEFORE any DB access. The test pkg leaves
	// model.DB unset, so a missed guard would nil-deref and panic.
	IncrementTenantPlatformChannelUsed(0, 100)
	IncrementTenantPlatformChannelUsed(-1, 100)
	IncrementTenantPlatformChannelUsed(42, 0)
	IncrementTenantPlatformChannelUsed(42, -5)
}
```

A real DB-touching test is covered manually in Task 10 (smoke test, including a forced-rollover step). Adding sqlite test wiring for one helper is YAGNI given the existing pattern in `tenant_quota_test.go`.

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./service/ -run TestIncrementTenantPlatformChannelUsed -v`
Expected: FAIL — `undefined: IncrementTenantPlatformChannelUsed`.

- [ ] **Step 3: Implement optimistic-concurrency helper in `service/tenant_quota.go`**

Append:

```go
// platformQuotaIncrementMaxRetries bounds the optimistic-concurrency loop
// for IncrementTenantPlatformChannelUsed. 3 attempts comfortably absorbs
// realistic contention (a tenant rollover at midnight with simultaneous
// in-flight settles); higher numbers don't add safety, only latency.
const platformQuotaIncrementMaxRetries = 3

// IncrementTenantPlatformChannelUsed accumulates `quotaDelta` into the
// tenant's platform-channel period counter, lazily rolling the period
// over when the boundary has been crossed. Uses optimistic concurrency
// keyed on platform_quota_period_start so concurrent writers at the
// boundary cannot lose each other's contributions, without depending on
// row locks (works on SQLite, MySQL, and Postgres equally).
//
// Errors are logged and swallowed: usage tracking is best-effort and must
// never bubble out and fail the billing path.
func IncrementTenantPlatformChannelUsed(tenantId int, quotaDelta int) {
	if tenantId <= 0 || quotaDelta <= 0 {
		return
	}
	if model.DB == nil {
		return // test environments without DB init
	}

	now := time.Now()
	for attempt := 0; attempt < platformQuotaIncrementMaxRetries; attempt++ {
		var row struct {
			PlatformQuotaCap         int64
			PlatformQuotaPeriod      string
			PlatformQuotaPeriodStart int64
		}
		err := model.WithTenantBypass(model.DB).Table("tenant_plans").
			Select("platform_quota_cap, platform_quota_period, platform_quota_period_start").
			Where("tenant_id = ?", tenantId).
			Take(&row).Error
		if err != nil {
			common.SysError(fmt.Sprintf("IncrementTenantPlatformChannelUsed SELECT failed tenant=%d: %s", tenantId, err.Error()))
			return
		}
		if row.PlatformQuotaCap < 0 {
			return // unlimited — nothing to track
		}

		needReset, newStart := model.ComputePlatformQuotaPeriodReset(
			row.PlatformQuotaPeriod, row.PlatformQuotaPeriodStart, now)

		var updates map[string]interface{}
		if needReset {
			updates = map[string]interface{}{
				"platform_quota_used":         int64(quotaDelta),
				"platform_quota_period_start": newStart,
			}
		} else {
			updates = map[string]interface{}{
				"platform_quota_used": gorm.Expr("platform_quota_used + ?", quotaDelta),
			}
		}

		// Optimistic guard: only succeed if period_start hasn't shifted
		// between our SELECT and this UPDATE. Lost-race ⇒ RowsAffected=0.
		res := model.WithTenantBypass(model.DB).Table("tenant_plans").
			Where("tenant_id = ? AND platform_quota_period_start = ?",
				tenantId, row.PlatformQuotaPeriodStart).
			Updates(updates)
		if res.Error != nil {
			common.SysError(fmt.Sprintf("IncrementTenantPlatformChannelUsed UPDATE failed tenant=%d delta=%d: %s", tenantId, quotaDelta, res.Error.Error()))
			return
		}
		if res.RowsAffected > 0 {
			model.InvalidateTenantPlanCache(tenantId)
			return
		}
		// Lost the race; loop, re-read, retry.
	}
	common.SysError(fmt.Sprintf("IncrementTenantPlatformChannelUsed: exhausted %d retries tenant=%d delta=%d", platformQuotaIncrementMaxRetries, tenantId, quotaDelta))
}
```

Add `"gorm.io/gorm"` to imports if not already present.

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./service/ -run TestIncrementTenantPlatformChannelUsed -v`
Expected: PASS — no panic on guarded inputs.

- [ ] **Step 5: Commit**

```bash
git add service/tenant_quota.go service/tenant_quota_test.go
git commit -m "feat(tenant-quota): optimistic-concurrency increment with boundary-safe rollover"
```

---

## Task 4: Wire pre-consume cap-check at every channel-bind, AFTER PriceData is filled

**Files:**
- Modify: `relay/helper/price.go` — add exported `EnforcePlatformChannelQuota`. **Do NOT change `ApplyChannelBillingOverrides`'s signature** (the previous draft did, but it was wrong — see below).
- Modify: each main relay handler (`audio_handler.go`, `claude_handler.go`, `compatible_handler.go`, `embedding_handler.go`, `gemini_handler.go`, `image_handler.go`, `rerank_handler.go`, `responses_handler.go`, `websocket.go`) — call `EnforcePlatformChannelQuota` immediately after `ApplyChannelBillingOverrides`.
- Modify: each task/MJ handler (`relay_task.go`, `mjproxy_handler.go`) — call `EnforcePlatformChannelQuota` immediately after `ModelPriceHelperPerCall` (NOT after `ApplyChannelBillingOverrides`, see below).

**Why two different insertion points (this is the heart of the fix):**

The two relay families fill `info.PriceData` in different orders:

| Family | Order |
|---|---|
| **Main relay handlers** (compatible/claude/audio/embedding/gemini/image/rerank/responses/websocket) | `controller/relay.go:337` calls `ModelPriceHelper` BEFORE the retry loop → PriceData is filled. Inside the loop each handler runs `InitChannelMeta + ApplyChannelBillingOverrides`. PriceData stays valid across retries (`ApplyChannelBillingOverrides` resets `ModelRatio` to `OriginalModelRatio` but does NOT recompute `QuotaToPreConsume`). |
| **Task / MJ** (relay_task / mjproxy) | Handler runs `InitChannelMeta + ApplyChannelBillingOverrides` FIRST, then `ModelPriceHelperPerCall` builds `PriceData.Quota`. At the `ApplyChannelBillingOverrides` line, `info.PriceData.Quota == 0`. |

If we put enforce inside `ApplyChannelBillingOverrides` (as the previous draft did), task/MJ paths read `projected == 0`, the early-return triggers, and the cap silently does nothing. (Review item.)

The handler is the only place that knows when its own `PriceData` is ready, so it has to be the one calling enforce. We expose enforce as a public helper and keep `ApplyChannelBillingOverrides` untouched.

**Why typed `*types.NewAPIError`, not a bare `error`:** Same as the previous draft — `controller/relay.go:340` collapses bare errors into `ErrorCodeModelPriceError`/500, losing `tenant_quota_exceeded`/429/skipRetry. Keep typed.

**Why every channel bind, not just the first:** Retry loops in `controller/relay.go:387` (main chat) and `controller/relay.go:935` (task) re-enter the handler, which re-runs `InitChannelMeta` + the enforce site. So the cap check fires per attempt, on every channel switched in.

- [ ] **Step 1: Read `applyPlatformMarkup` (`relay/helper/price.go:241-288`) to confirm channel-resolution pattern**

Pattern: pull `channelID` from `info.ChannelId` (when `ChannelMeta != nil`), else fall back to `common.GetContextKeyInt(c, constant.ContextKeyChannelId)`. Then `model.CacheGetChannel(channelID)`, check `ch.Scope == model.ChannelScopePlatform`.

- [ ] **Step 2: Add exported `EnforcePlatformChannelQuota` to `relay/helper/price.go`**

Append after `applyPlatformMarkup`:

```go
// EnforcePlatformChannelQuota rejects the request if the tenant has hit
// their platform-channel cap for the current period. Mirrors
// applyPlatformMarkup's channel resolution so the gate fires for the
// same set of requests the markup applies to.
//
// Call this from each handler at the point where:
//   1. The channel is bound (post InitChannelMeta), AND
//   2. info.PriceData.QuotaToPreConsume / .Quota is filled.
//
// Two call patterns exist depending on the handler family:
//   - Main relay handlers (compatible/claude/audio/embedding/gemini/image/
//     rerank/responses/websocket):
//     PriceData is filled by controller/relay.go before the retry loop;
//     call this immediately after ApplyChannelBillingOverrides.
//   - Task / MJ (relay_task, mjproxy_handler): PriceData is filled by
//     ModelPriceHelperPerCall AFTER ApplyChannelBillingOverrides; call
//     this immediately after ModelPriceHelperPerCall.
//
// Returns:
//   - nil when no enforcement applies (tenant <=0, projected <=0, channel
//     unknown, channel not platform-scoped, or cap unlimited).
//   - *types.NewAPIError with HTTP 429 + skipRetry when the cap would be
//     exceeded. Caller MUST return this verbatim — do not wrap.
func EnforcePlatformChannelQuota(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	if info == nil || info.TenantId <= 0 {
		return nil
	}
	projected := info.PriceData.QuotaToPreConsume
	if projected <= 0 {
		projected = info.PriceData.Quota
	}
	if projected <= 0 {
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
	if err := service.CheckTenantPlatformChannelQuota(info.TenantId, projected); err != nil {
		return types.NewErrorWithStatusCode(err, types.ErrorCodeTenantQuotaExceeded,
			http.StatusTooManyRequests, types.ErrOptionWithSkipRetry())
	}
	return nil
}
```

Required imports if not present: `"net/http"`, `"github.com/QuantumNous/new-api/types"`, `"github.com/QuantumNous/new-api/service"`.

**Important:** Do NOT modify `ApplyChannelBillingOverrides`. Its signature stays `func ApplyChannelBillingOverrides(info *relaycommon.RelayInfo)` and its body is untouched.

- [ ] **Step 3: Wire enforce into each main relay handler (after ApplyChannelBillingOverrides)**

Find call sites:

```bash
grep -rn "helper.ApplyChannelBillingOverrides" relay/
```

Expected list (verify): `audio_handler.go`, `claude_handler.go`, `compatible_handler.go`, `embedding_handler.go`, `gemini_handler.go` (2 call sites), `image_handler.go`, `rerank_handler.go`, `responses_handler.go`, `websocket.go`.

For each main relay handler that returns `*types.NewAPIError`, insert immediately after the existing `helper.ApplyChannelBillingOverrides(info)` line:

```go
	helper.ApplyChannelBillingOverrides(info)
	if apiErr := helper.EnforcePlatformChannelQuota(c, info); apiErr != nil {
		return apiErr
	}
```

(`c` is already in scope in every handler's signature — verify per file.)

- [ ] **Step 4: Wire enforce into task/MJ handlers (after ModelPriceHelperPerCall)**

For `relay/relay_task.go::RelayTaskSubmit`, after the existing `info.PriceData = priceData` (around line 191), insert:

```go
	info.PriceData = priceData
	if apiErr := helper.EnforcePlatformChannelQuota(c, info); apiErr != nil {
		// Task handlers wrap *NewAPIError into TaskError. Use the same wrapper
		// as the surrounding errors in this file (search for TaskErrorWrapper).
		return nil, service.TaskErrorWrapper(apiErr.Err, string(apiErr.GetErrorCode()), apiErr.StatusCode)
	}
```

For `relay/mjproxy_handler.go::RelaySwapFace`, after the existing `priceData, err := helper.ModelPriceHelperPerCall(c, info)` block (around line 197-203) where `priceData` is assigned, insert:

```go
	info.PriceData = priceData
	if apiErr := helper.EnforcePlatformChannelQuota(c, info); apiErr != nil {
		return &dto.MidjourneyResponse{
			Code:        4,
			Description: apiErr.Error(),
		}
	}
```

Also locate the second `ModelPriceHelperPerCall` call in `mjproxy_handler.go` (around line 505 per earlier grep) and apply the same pattern.

For any other task-family handler that calls `ModelPriceHelperPerCall`, follow the existing error-wrapping convention in that file.

**Note:** Verify each file's existing pattern by reading it before editing. The wrappers (`TaskErrorWrapper`, `MidjourneyErrorWrapper`, `dto.MidjourneyResponse{Code:4,...}`) are domain-specific; copy the surrounding style instead of inventing new envelopes.

- [ ] **Step 5: Build to verify all call sites compiled**

Run: `go build ./...`
Expected: success. Compiler errors will pinpoint any handler with a missing or mistyped enforce call.

- [ ] **Step 6: Run tests to confirm no regression**

Run: `go test ./relay/... ./service/... ./controller/... -v`
Expected: same pass count as before. `ApplyChannelBillingOverrides`'s signature is unchanged so existing call sites/tests still compile without edits.

- [ ] **Step 7: Manually trace the four cap-trigger paths**

For each of these four cases, trace the call flow on paper and confirm enforce fires:

1. **Main relay handler, first attempt, platform channel** — `controller/relay.go:337` ModelPriceHelper fills PriceData → enter retry loop → handler runs ApplyChannelBillingOverrides → enforce reads PriceData.QuotaToPreConsume (>0) → channel is platform → check fires.
2. **Main relay handler, retry switching channels** — handler returns error → retry loop calls handler again on new channel → handler re-runs ApplyChannelBillingOverrides → enforce re-fires against the NEW channel. (PriceData.QuotaToPreConsume is still the same value from step 1 — that's fine, projected isn't channel-specific.)
   This same trace covers text, audio, image, rerank, responses, and realtime websocket handlers because they all enter through the same controller path and all bind the channel before their handler-specific upstream call.
3. **Task/MJ, first attempt, platform channel** — RelayTaskSubmit runs ApplyChannelBillingOverrides (PriceData.Quota is 0 here, but we no longer enforce here) → ModelPriceHelperPerCall fills PriceData.Quota → enforce reads PriceData.Quota (>0) → check fires.
4. **Task/MJ, retry switching channels** — RelayTaskSubmit re-runs both ApplyChannelBillingOverrides AND ModelPriceHelperPerCall on the new channel → enforce re-fires.

If any case doesn't fire, the call-site insertion is wrong — fix before Step 8.

- [ ] **Step 8: Commit**

```bash
git add relay/helper/price.go relay/audio_handler.go relay/claude_handler.go \
        relay/compatible_handler.go relay/embedding_handler.go \
        relay/gemini_handler.go relay/image_handler.go \
        relay/rerank_handler.go relay/responses_handler.go \
        relay/websocket.go relay/relay_task.go relay/mjproxy_handler.go
git commit -m "feat(relay): enforce platform-channel cap after PriceData fill on every attempt"
```

(Adjust the staged file list to match what `git status` shows — only files actually modified.)

---

## Task 5: Wire post-settle increment into SettleBilling

**Files:**
- Modify: `service/billing.go`

**Why here, not the call sites:**
- `SettleBilling` is invoked from THREE places: `service/text_quota.go:330` (main text/chat path), `service/quota.go:338` (audio/wss), and `controller/relay.go:960` (task: MJ/Suno). The earlier draft only mentioned the controller path — main chat traffic would never accumulate. (Review item P1-2.)
- Putting the increment at the tail of `SettleBilling` itself covers all three with one insertion.
- The tracking is post-settle, fail-quiet; we use the same `actualQuota` that just decremented the wallet.

- [ ] **Step 1: Add the channel-scope check helper to `service/billing.go`**

Append (after `SettleBilling` definition):

```go
// incrementPlatformChannelUsedIfApplicable runs after SettleBilling has
// successfully charged the wallet. It checks whether the channel that
// served this request was platform-scope; if so, accumulates the actual
// settled quota into the tenant's per-period counter for cap enforcement.
//
// Best-effort: any error is swallowed by IncrementTenantPlatformChannelUsed.
// Channel resolution mirrors enforcePlatformChannelQuota in relay/helper/price.go
// (CacheGetChannel + Scope check) so the gate-on / track-on conditions match exactly.
func incrementPlatformChannelUsedIfApplicable(relayInfo *relaycommon.RelayInfo, actualQuota int) {
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
	IncrementTenantPlatformChannelUsed(relayInfo.TenantId, actualQuota)
}
```

Add `"github.com/QuantumNous/new-api/model"` to imports if not present.

- [ ] **Step 2: Hook it into `SettleBilling`**

Modify `SettleBilling` so the increment runs on the success path of BOTH branches (the BillingSession branch and the legacy fallback). The cleanest insertion is right before each `return nil`:

In the BillingSession branch, after `return nil` is reached (just before it):

```go
		if err := relayInfo.Billing.Settle(actualQuota); err != nil {
			return err
		}

		// Send notifications, then track platform-channel usage.
		if actualQuota != 0 {
			// ... existing notification code unchanged ...
		}
		incrementPlatformChannelUsedIfApplicable(relayInfo, actualQuota)
		return nil
```

In the legacy fallback branch:

```go
	// 回退：无 BillingSession 时使用旧路径
	quotaDelta := actualQuota - relayInfo.FinalPreConsumedQuota
	if quotaDelta != 0 {
		if err := PostConsumeQuota(relayInfo, quotaDelta, relayInfo.FinalPreConsumedQuota, true); err != nil {
			return err
		}
	}
	incrementPlatformChannelUsedIfApplicable(relayInfo, actualQuota)
	return nil
```

The increment uses `actualQuota` (the settled total), not the delta — the cap counter tracks total consumption per request, not the post-consume adjustment.

- [ ] **Step 3: Build and run all tests**

Run: `go build ./... && go test ./service/... ./controller/... -v`
Expected: green. If any existing `SettleBilling` test mocks the function signature, our addition is backward-compatible (no signature change).

- [ ] **Step 4: Commit**

```bash
git add service/billing.go
git commit -m "feat(billing): track platform-channel usage after every successful settle"
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

Expected: the next request goes through `ComputePlatformQuotaPeriodReset` + the optimistic conditional-UPDATE path, `used` resets to 0, and `platform_quota_period_start` updates to today 00:00. Verify by reloading the usage tab.

- [ ] **Step 6: Commit (docs only — confirm the smoke test pass in the plan log)**

No commit needed unless you discovered a bug — in which case open a follow-up issue or fix in a new commit.

---

## Self-Review Checklist (run before handing off)

- [ ] Every task has actual code, no `// TODO` placeholders.
- [ ] Type names line up across tasks: `TenantPlan` field names match between Go struct (Task 1), API JSON (Task 6), and TypeScript type (Task 7) — all snake_case in JSON.
- [ ] Pre-consume gate (Task 4) is exposed as `helper.EnforcePlatformChannelQuota` and called explicitly by each handler at the point its `info.PriceData` is filled — after `ApplyChannelBillingOverrides` for the main relay handlers (`compatible/claude/audio/embedding/gemini/image/rerank/responses/websocket`), after `ModelPriceHelperPerCall` for task/MJ. Each retry re-runs the handler, so the gate re-fires on every switched channel (not just the first attempt). Returns typed `*types.NewAPIError` (HTTP 429 + skipRetry) so it survives intact through `controller/relay.go` without being re-wrapped as `ErrorCodeModelPriceError`. Post-settle increment (Task 5) lives in `service/billing.go::SettleBilling` covering all three settle paths.
- [ ] `ComputePlatformQuotaPeriodReset` is a pure function — no `*TenantPlan` argument, no mutation. Failed persists therefore cannot poison the in-memory plan cache. (Resolves P2-1 from first review.)
- [ ] `IncrementTenantPlatformChannelUsed` uses optimistic concurrency (conditional UPDATE on `period_start`) with bounded retries — works on SQLite, MySQL, and Postgres without `FOR UPDATE`. No two-statement non-atomic window at the day/month boundary. (Resolves P1-3 from first review and P2-1 from second review.)
- [ ] `enforcePlatformChannelQuota` and `incrementPlatformChannelUsedIfApplicable` use the SAME channel-resolution dance (CacheGetChannel + Scope check) so the gate condition and the tracking condition match exactly — no asymmetric tracking.
- [ ] Cap value `-1` short-circuits the gate (returns nil before any work) AND short-circuits the increment loop (returns before any UPDATE) — no useless DB writes for unenforced tenants.
- [ ] All errors out of the increment path are swallowed (logged via `common.SysError`) — usage tracking is best-effort and must never break the billing flow.
- [ ] Frontend handles the "feature inactive" state (cap=-1, period='none') as a valid render, not an error.
- [ ] No new permission middleware needed — the new endpoints reuse the same `PlatformAdminAuth` group as `tenants/plans`.
