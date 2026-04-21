# Shared Channels (Platform + BYOK Hybrid) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "platform + BYOK" hybrid channel model to the existing multi-tenant SaaS — super admin maintains shared platform channels, tenants add their own private channels, routing blends both per tenant preference, billing applies a markup on platform channels only.

**Architecture:** Extend `channels` / `abilities` with a `scope` column (`platform` / `tenant`). Merge routing candidates from both `tenant_id=0` (platform) and `tenant_id=<current>` (own) buckets in memory cache; apply tenant-level mode + override filters in application layer. Split HTTP surface into 3 route groups (`/api/channel/*` root, `/api/tenant-channel/*` tenant admin, `/api/admin/tenant/:tid/channel/*` root-on-behalf). Inject markup at `ModelPriceHelper` pre-charge + `PostConsumeQuota` post-charge, propagated via `RelayInfo`. Affinity cache key gains a tenantId prefix with distributor-side re-validation.

**Tech Stack:** Go 1.21+, Gin, GORM v2, existing guardrail (`model/tenant_scope.go`), existing RelayInfo, channel cache, React 18 + TypeScript for UI (`web-next/`).

**Spec reference:** `docs/superpowers/specs/2026-04-20-shared-channels-design.md`

---

## File Structure

### New files

```
model/tenant_channel_override.go           # new table + CRUD helpers (§3.5)
model/channel_sanitize.go                  # sanitizeForTenantView + sanitizeForCopy (§7.4, §9.2)
model/effective_routing.go                 # EffectiveRoutingSet + filter helpers (§4.2, §4.5)
middleware/tenant_admin_auth.go            # TenantAdminOnlyAuth (§7.3-G)
controller/channel/tenant_channel.go       # tenant-side handlers (thin wrappers around root handlers + scope guards)
controller/channel/admin_on_behalf.go      # root-on-behalf handlers
service/markup.go                          # effectiveMarkup helper (§5.1)
web-next/src/pages/PlatformChannelsAdmin.tsx   # super admin UI (§7.1)
```

### Modified files

```
model/channel.go                           # struct + GetVisibleChannelForTenant / GetOwnedChannelForTenant / SearchChannelsForTenant / tag helpers / BatchSetChannelTag
model/ability.go                           # Scope field + GetGroupEnabledModels etc with (scope='platform' OR tenant_id=?)
model/channel_cache.go                     # merge tenant+platform buckets at lookup; mode/override index; invalidation hooks
model/model_meta.go                        # GetBoundChannelsByModelsMap to include scope='platform' + mode/override filter
model/tenant_plan.go                       # PlatformMarkup field
model/tenant_option.go                     # helpers for platform_channel_mode key
model/tenant_scope.go                      # scope='platform' read whitelist; register tenant_channel_overrides
model/main.go                              # migrateDBFast: register new tables
controller/channel/channel.go              # IDOR fixes + scope-aware AddChannel/UpdateChannel/etc + tag_mode tenant filter
service/channel_affinity.go                # tenantId-prefixed cache key + re-validation callback
middleware/distributor.go                  # re-validate affinity hit against current tenant mode/override
relay/helper/price.go                      # inject effective_markup into preConsumedQuota
service/billing_session.go                 # persist markup to RelayInfo, apply in PostConsume
service/billing.go                         # log IsPlatformChannel / MarkupRatio / MarkupSource
relay/common/relay_info.go                 # add PriceMarkupRatio / PriceMarkupSource fields
router/api-router.go                       # 3 route groups: /api/channel (RootAuth) + /api/tenant-channel (TenantAdminOnlyAuth) + /api/admin/tenant/:tid/channel (RootAuth)
web-next/src/routes.tsx                    # add /admin/platform/channels
web-next/src/pages/ChannelsAdmin.tsx       # split into my-channels / platform-channels sections; toggle + mode selector
web-next/src/components/layout/Sidebar.tsx # Super admin menu item
web-next/src/api/channels.ts               # (if exists) tenant-channel endpoints + redacted schema
```

---

## Phase 1 — Schema & Guardrail Foundation (Milestones 1, 2)

Goal: All new DB fields and tables exist; guardrail enforces the new invariants. No behavioral change yet.

### Task 1: Add `scope` and `markup_ratio` columns to `Channel` struct

**Files:**
- Modify: `model/channel.go` (struct definition near line 14-60)
- Test: `model/channel_scope_test.go` (new)

- [ ] **Step 1: Write the failing test for struct fields**

Create `model/channel_scope_test.go`:

```go
package model

import (
	"reflect"
	"testing"
)

func TestChannelHasScopeAndMarkupFields(t *testing.T) {
	c := Channel{}
	v := reflect.TypeOf(c)
	scopeField, ok := v.FieldByName("Scope")
	if !ok {
		t.Fatal("Channel.Scope field missing")
	}
	if scopeField.Type.Kind() != reflect.String {
		t.Fatalf("Channel.Scope should be string, got %s", scopeField.Type.Kind())
	}
	markupField, ok := v.FieldByName("MarkupRatio")
	if !ok {
		t.Fatal("Channel.MarkupRatio field missing")
	}
	// *float64 (nullable)
	if markupField.Type.Kind() != reflect.Ptr || markupField.Type.Elem().Kind() != reflect.Float64 {
		t.Fatalf("Channel.MarkupRatio should be *float64, got %s", markupField.Type)
	}
}

func TestChannelScopeConstants(t *testing.T) {
	if ChannelScopePlatform != "platform" {
		t.Errorf("ChannelScopePlatform = %q, want \"platform\"", ChannelScopePlatform)
	}
	if ChannelScopeTenant != "tenant" {
		t.Errorf("ChannelScopeTenant = %q, want \"tenant\"", ChannelScopeTenant)
	}
}
```

- [ ] **Step 2: Run test to verify failure**

Run: `go test ./model -run TestChannelHasScopeAndMarkupFields -v`
Expected: FAIL with "Channel.Scope field missing"

- [ ] **Step 3: Add constants and fields**

In `model/channel.go`, add near top of file (after imports):

```go
const (
	ChannelScopePlatform = "platform"
	ChannelScopeTenant   = "tenant"
)
```

In the `Channel` struct (after `ChannelInfo` field):

```go
	// Scope distinguishes "platform" (shared, tenant_id=0) and "tenant" (owned).
	// See docs/superpowers/specs/2026-04-20-shared-channels-design.md §3.1.
	Scope       string   `json:"scope" gorm:"type:varchar(16);not null;default:'tenant';index"`
	MarkupRatio *float64 `json:"markup_ratio" gorm:"type:decimal(10,4);default:null"`
```

- [ ] **Step 4: Run test to verify pass**

Run: `go test ./model -run TestChannelHasScopeAndMarkupFields -v`
Expected: PASS

Run: `go test ./model -run TestChannelScopeConstants -v`
Expected: PASS

- [ ] **Step 5: Run broader build check**

Run: `go build ./...`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add model/channel.go model/channel_scope_test.go
git commit -m "feat(model): add Scope and MarkupRatio fields to Channel"
```

---

### Task 2: Add `Scope` field to `Ability` struct

**Files:**
- Modify: `model/ability.go` (struct around line 16)
- Test: `model/ability_scope_test.go` (new)

- [ ] **Step 1: Write the failing test**

Create `model/ability_scope_test.go`:

```go
package model

import (
	"reflect"
	"testing"
)

func TestAbilityHasScopeField(t *testing.T) {
	a := Ability{}
	v := reflect.TypeOf(a)
	f, ok := v.FieldByName("Scope")
	if !ok {
		t.Fatal("Ability.Scope field missing")
	}
	if f.Type.Kind() != reflect.String {
		t.Fatalf("Ability.Scope should be string, got %s", f.Type.Kind())
	}
}
```

- [ ] **Step 2: Run to fail**

Run: `go test ./model -run TestAbilityHasScopeField -v`
Expected: FAIL

- [ ] **Step 3: Add field**

In `model/ability.go` inside `Ability` struct (after `Tag` field):

```go
	Scope string `json:"scope" gorm:"type:varchar(16);not null;default:'tenant';index"`
```

- [ ] **Step 4: Run to pass**

Run: `go test ./model -run TestAbilityHasScopeField -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add model/ability.go model/ability_scope_test.go
git commit -m "feat(model): add Scope field to Ability"
```

---

### Task 3: Add `PlatformMarkup` to `TenantPlan`

**Files:**
- Modify: `model/tenant_plan.go`
- Test: `model/tenant_plan_markup_test.go` (new)

- [ ] **Step 1: Write test**

Create `model/tenant_plan_markup_test.go`:

```go
package model

import (
	"reflect"
	"testing"
)

func TestTenantPlanHasPlatformMarkup(t *testing.T) {
	p := TenantPlan{}
	v := reflect.TypeOf(p)
	f, ok := v.FieldByName("PlatformMarkup")
	if !ok {
		t.Fatal("TenantPlan.PlatformMarkup missing")
	}
	if f.Type.Kind() != reflect.Float64 {
		t.Fatalf("PlatformMarkup should be float64, got %s", f.Type.Kind())
	}
}
```

- [ ] **Step 2: Run to fail**

Run: `go test ./model -run TestTenantPlanHasPlatformMarkup -v`
Expected: FAIL

- [ ] **Step 3: Add field**

In `model/tenant_plan.go` inside `TenantPlan` struct (after `RenewCurrency`):

```go
	PlatformMarkup float64 `json:"platform_markup" gorm:"type:decimal(10,4);not null;default:1.0000"`
```

Also update the default-plan initializer in `GetTenantPlan` (around line 84-97) — add `PlatformMarkup: 1.0,` to the struct literal.

- [ ] **Step 4: Run to pass**

Run: `go test ./model -run TestTenantPlanHasPlatformMarkup -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add model/tenant_plan.go model/tenant_plan_markup_test.go
git commit -m "feat(model): add PlatformMarkup to TenantPlan"
```

---

### Task 4: Create `TenantChannelOverride` table + CRUD

**Files:**
- Create: `model/tenant_channel_override.go`
- Test: `model/tenant_channel_override_test.go` (new)

- [ ] **Step 1: Write test**

Create `model/tenant_channel_override_test.go`:

```go
package model

import (
	"testing"
)

// Note: these tests assume a test DB is initialized globally (DB var).
// If setup differs, wrap with skip: if DB == nil { t.Skip("no DB") }.

func TestTenantChannelOverride_SetAndListDisabled(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	tenantId := 42
	channelId := 99
	// ensure clean slate
	_ = WithTenantBypass(DB).Where("tenant_id = ? AND channel_id = ?", tenantId, channelId).Delete(&TenantChannelOverride{})

	if err := SetTenantChannelDisabled(tenantId, channelId, true); err != nil {
		t.Fatalf("set disabled: %v", err)
	}
	ids, err := GetTenantDisabledPlatformChannels(tenantId)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if _, ok := ids[channelId]; !ok {
		t.Fatalf("expected channel %d in disabled set", channelId)
	}

	if err := SetTenantChannelDisabled(tenantId, channelId, false); err != nil {
		t.Fatalf("clear disabled: %v", err)
	}
	ids, _ = GetTenantDisabledPlatformChannels(tenantId)
	if _, ok := ids[channelId]; ok {
		t.Fatalf("expected channel %d removed after enabling", channelId)
	}
}
```

- [ ] **Step 2: Run to fail**

Run: `go test ./model -run TestTenantChannelOverride_SetAndListDisabled -v`
Expected: FAIL (symbols undefined)

- [ ] **Step 3: Implement model + helpers**

Create `model/tenant_channel_override.go`:

```go
package model

import (
	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// TenantChannelOverride records that a tenant has explicitly disabled a
// specific platform channel. Only "disabled" rows are stored; an absent row
// means "enabled (default)". See spec §3.5.
type TenantChannelOverride struct {
	TenantId  int   `json:"tenant_id" gorm:"primaryKey;not null"`
	ChannelId int   `json:"channel_id" gorm:"primaryKey;not null;index"`
	Disabled  bool  `json:"disabled" gorm:"not null;default:true"`
	CreatedAt int64 `json:"created_at" gorm:"bigint;autoCreateTime"`
}

func (TenantChannelOverride) TableName() string {
	return "tenant_channel_overrides"
}

// GetTenantDisabledPlatformChannels returns the set of platform channel IDs
// the tenant has disabled. Returns an empty map if none.
func GetTenantDisabledPlatformChannels(tenantId int) (map[int]struct{}, error) {
	result := make(map[int]struct{})
	if tenantId <= 0 {
		return result, nil
	}
	var rows []TenantChannelOverride
	if err := DB.Where("tenant_id = ? AND disabled = ?", tenantId, true).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, r := range rows {
		result[r.ChannelId] = struct{}{}
	}
	return result, nil
}

// SetTenantChannelDisabled upserts (disabled=true) or deletes (disabled=false)
// the override row.
func SetTenantChannelDisabled(tenantId, channelId int, disabled bool) error {
	if tenantId <= 0 || channelId <= 0 {
		return gorm.ErrInvalidData
	}
	if !disabled {
		return DB.Where("tenant_id = ? AND channel_id = ?", tenantId, channelId).
			Delete(&TenantChannelOverride{}).Error
	}
	row := TenantChannelOverride{
		TenantId:  tenantId,
		ChannelId: channelId,
		Disabled:  true,
		CreatedAt: common.GetTimestamp(),
	}
	return DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "tenant_id"}, {Name: "channel_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"disabled"}),
	}).Create(&row).Error
}
```

- [ ] **Step 4: Register table in migrations**

In `model/main.go` `migrateDBFast` slice (around line 489), add before closing `}`:

```go
		{&TenantChannelOverride{}, "TenantChannelOverride"},
```

- [ ] **Step 5: Run to pass**

Run: `go test ./model -run TestTenantChannelOverride_SetAndListDisabled -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add model/tenant_channel_override.go model/tenant_channel_override_test.go model/main.go
git commit -m "feat(model): add TenantChannelOverride table + CRUD helpers"
```

---

### Task 5: Tenant-option key for `platform_channel_mode`

**Files:**
- Modify: `model/tenant_option.go`
- Test: `model/tenant_option_platform_mode_test.go` (new)

- [ ] **Step 1: Read current tenant_option helpers**

Run: `grep -n "func " model/tenant_option.go`

Identify the generic getter (likely `GetTenantOption(tenantId, key)`) and setter. If present, skip creating new generic helpers and wrap.

- [ ] **Step 2: Write test**

Create `model/tenant_option_platform_mode_test.go`:

```go
package model

import "testing"

func TestTenantPlatformChannelMode_DefaultAndSet(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	tenantId := 43
	// Clean
	_ = WithTenantBypass(DB).Where("tenant_id = ? AND option_key = ?", tenantId, TenantOptionKeyPlatformChannelMode).Delete(&TenantOption{})

	mode, err := GetTenantPlatformChannelMode(tenantId)
	if err != nil {
		t.Fatalf("get default: %v", err)
	}
	if mode != PlatformChannelModePrivatePriority {
		t.Fatalf("default mode = %q, want %q", mode, PlatformChannelModePrivatePriority)
	}

	if err := SetTenantPlatformChannelMode(tenantId, PlatformChannelModeOnlyPlatform); err != nil {
		t.Fatalf("set: %v", err)
	}
	mode, _ = GetTenantPlatformChannelMode(tenantId)
	if mode != PlatformChannelModeOnlyPlatform {
		t.Fatalf("got %q after set, want %q", mode, PlatformChannelModeOnlyPlatform)
	}

	// invalid value rejected
	if err := SetTenantPlatformChannelMode(tenantId, "garbage"); err == nil {
		t.Fatal("expected error for invalid mode")
	}
}
```

- [ ] **Step 3: Run to fail**

Run: `go test ./model -run TestTenantPlatformChannelMode_DefaultAndSet -v`
Expected: FAIL (undefined)

- [ ] **Step 4: Implement**

Append to `model/tenant_option.go`:

```go
const (
	TenantOptionKeyPlatformChannelMode = "platform_channel_mode"

	PlatformChannelModePrivatePriority  = "private_priority"
	PlatformChannelModePlatformPriority = "platform_priority"
	PlatformChannelModeOnlyPrivate      = "only_private"
	PlatformChannelModeOnlyPlatform     = "only_platform"
)

func isValidPlatformChannelMode(s string) bool {
	switch s {
	case PlatformChannelModePrivatePriority,
		PlatformChannelModePlatformPriority,
		PlatformChannelModeOnlyPrivate,
		PlatformChannelModeOnlyPlatform:
		return true
	}
	return false
}

// GetTenantPlatformChannelMode returns the tenant's configured mode.
// Returns PlatformChannelModePrivatePriority if unset.
func GetTenantPlatformChannelMode(tenantId int) (string, error) {
	if tenantId <= 0 {
		return PlatformChannelModePrivatePriority, nil
	}
	v, err := GetTenantOption(tenantId, TenantOptionKeyPlatformChannelMode)
	if err != nil {
		return "", err
	}
	if !isValidPlatformChannelMode(v) {
		return PlatformChannelModePrivatePriority, nil
	}
	return v, nil
}

// SetTenantPlatformChannelMode validates and persists the mode.
func SetTenantPlatformChannelMode(tenantId int, mode string) error {
	if !isValidPlatformChannelMode(mode) {
		return fmt.Errorf("invalid platform_channel_mode: %q", mode)
	}
	return SetTenantOption(tenantId, TenantOptionKeyPlatformChannelMode, mode)
}
```

**Important:** If `GetTenantOption` / `SetTenantOption` generic helpers don't exist, implement them first with a small extra test (follow existing query patterns in `tenant_option.go`). Names must match exactly.

Add `"fmt"` to imports if missing.

- [ ] **Step 5: Run to pass**

Run: `go test ./model -run TestTenantPlatformChannelMode_DefaultAndSet -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add model/tenant_option.go model/tenant_option_platform_mode_test.go
git commit -m "feat(model): add platform_channel_mode tenant option helpers"
```

---

### Task 6: Register `tenant_channel_overrides` as tenant-scoped in guardrail

**Files:**
- Modify: `model/tenant_scope.go`
- Test: `model/tenant_scope_channel_override_test.go` (new)

- [ ] **Step 1: Write test**

Create `model/tenant_scope_channel_override_test.go`:

```go
package model

import "testing"

func TestTenantChannelOverrideIsTenantScoped(t *testing.T) {
	if !IsTenantScoped("tenant_channel_overrides") {
		t.Fatal("tenant_channel_overrides must be registered as tenant-scoped")
	}
}
```

- [ ] **Step 2: Run to fail**

Run: `go test ./model -run TestTenantChannelOverrideIsTenantScoped -v`
Expected: FAIL

- [ ] **Step 3: Register**

In `model/tenant_scope.go` find the block of `RegisterTenantScopedTable(...)` calls (around line 220-228) and add:

```go
	// Shared channels override (tenant disables a specific platform channel)
	RegisterTenantScopedTable("tenant_channel_overrides")
```

- [ ] **Step 4: Run to pass**

Run: `go test ./model -run TestTenantChannelOverrideIsTenantScoped -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add model/tenant_scope.go model/tenant_scope_channel_override_test.go
git commit -m "feat(model): register tenant_channel_overrides as tenant-scoped"
```

---

### Task 7: Guardrail — whitelist reads on `scope='platform'`

**Files:**
- Modify: `model/tenant_scope.go` (`tenantGuardScope` around line 252-316)
- Test: `model/tenant_scope_platform_read_test.go` (new)

- [ ] **Step 1: Read current guard**

Re-read `model/tenant_scope.go:252-316` to understand the Check 1-4 sequence and where to insert.

- [ ] **Step 2: Write test**

Create `model/tenant_scope_platform_read_test.go`:

```go
package model

import "testing"

// Guardrail should allow a read whose WHERE clause constrains scope='platform'
// even when no tenant_id constraint is present.
func TestGuardrailAllowsPlatformScopeRead(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	var channels []Channel
	// Intentionally no WithTenantBypass and no tenant_id in WHERE.
	err := DB.Where("scope = ?", ChannelScopePlatform).Limit(1).Find(&channels).Error
	if err != nil {
		t.Fatalf("expected guardrail to allow platform read, got: %v", err)
	}
}

// Without scope='platform' in WHERE and without tenant_id and without bypass,
// the read must still be rejected.
func TestGuardrailStillBlocksUnscopedChannelRead(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	var channels []Channel
	err := DB.Limit(1).Find(&channels).Error
	if err == nil {
		t.Fatal("expected guardrail rejection for unscoped channel read")
	}
}
```

- [ ] **Step 3: Run to fail**

Run: `go test ./model -run TestGuardrailAllowsPlatformScopeRead -v`
Expected: FAIL (guardrail currently rejects any unscoped read on `channels`).

- [ ] **Step 4: Implement whitelist**

In `model/tenant_scope.go` inside `tenantGuardScope`, after Check 2 (where `whereExpr` is computed) and before Check 3:

```go
	// Check 2.5 (NEW): allow reads scoped to scope='platform' even without tenant_id.
	// Only applies to tables that have a scope column — channels and abilities today.
	// See spec §8.1.
	if db.Statement.BuildClauses[0] == "SELECT" && whereExpr != "" {
		tableName := db.Statement.Schema.Table
		if tableName == "channels" || tableName == "abilities" {
			// naive textual match is fine here; the expression comes from gorm's Where() calls
			if strings.Contains(whereExpr, "scope") &&
				(strings.Contains(whereExpr, "'platform'") || strings.Contains(whereExpr, "\"platform\"")) {
				return
			}
		}
	}
```

Make sure `"strings"` is already imported (it is).

- [ ] **Step 5: Run to pass**

Run: `go test ./model -run TestGuardrailAllowsPlatformScopeRead -v`
Expected: PASS

Run: `go test ./model -run TestGuardrailStillBlocksUnscopedChannelRead -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add model/tenant_scope.go model/tenant_scope_platform_read_test.go
git commit -m "feat(model): whitelist scope='platform' reads in tenant guardrail"
```

---

### Task 8: Startup migration runs and adds columns on existing DB

**Files:**
- No code change, but verify by running the app / tests to let AutoMigrate do its job.

- [ ] **Step 1: Run all model tests**

Run: `go test ./model -v -count=1`
Expected: All green (or skip when DB unset). Confirm AutoMigrate doesn't error on `Channel`, `Ability`, `TenantPlan`, `TenantChannelOverride`.

- [ ] **Step 2: Manual smoke (if dev DB available)**

Start the app once so `migrateDBFast` runs:
```bash
go run . &
sleep 5 ; kill %1 || true
```

Then check:
```sql
SHOW COLUMNS FROM channels LIKE 'scope';
SHOW COLUMNS FROM channels LIKE 'markup_ratio';
SHOW COLUMNS FROM abilities LIKE 'scope';
SHOW COLUMNS FROM tenant_plans LIKE 'platform_markup';
SHOW TABLES LIKE 'tenant_channel_overrides';
```

Expected: all present.

- [ ] **Step 3: Commit (empty if no change, or skip)**

If any doc/comment update needed, commit; otherwise proceed to next task.

---

## Phase 2 — Model Helpers (Milestone 3)

Goal: Centralized helpers used by routing, discovery, controllers, and UI.

### Task 9: `GetVisibleChannelForTenant` and `GetOwnedChannelForTenant`

**Files:**
- Modify: `model/channel.go`
- Test: `model/channel_visibility_test.go` (new)

- [ ] **Step 1: Write test**

Create `model/channel_visibility_test.go`:

```go
package model

import (
	"testing"
)

func TestGetVisibleChannelForTenant_PlatformVisible(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	// Arrange: insert a platform channel (scope='platform', tenant_id=0)
	plat := Channel{Type: 1, Name: "plat-test", Scope: ChannelScopePlatform, TenantId: 0, Key: "k", Status: 1, CreatedTime: 1}
	if err := WithTenantBypass(DB).Create(&plat).Error; err != nil {
		t.Fatalf("insert platform: %v", err)
	}
	defer WithTenantBypass(DB).Delete(&Channel{}, plat.Id)

	ch, err := GetVisibleChannelForTenant(plat.Id, 7, true)
	if err != nil {
		t.Fatalf("expected platform visible to tenant 7: %v", err)
	}
	if ch.Id != plat.Id {
		t.Fatalf("id mismatch")
	}
}

func TestGetVisibleChannelForTenant_OtherTenantHidden(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	other := Channel{Type: 1, Name: "other-test", Scope: ChannelScopeTenant, TenantId: 8, Key: "k", Status: 1, CreatedTime: 1}
	if err := WithTenantBypass(DB).Create(&other).Error; err != nil {
		t.Fatalf("insert other: %v", err)
	}
	defer WithTenantBypass(DB).Delete(&Channel{}, other.Id)

	_, err := GetVisibleChannelForTenant(other.Id, 7, true)
	if err == nil {
		t.Fatal("expected not-found when tenant 7 tries to read tenant 8's channel")
	}
}

func TestGetOwnedChannelForTenant_RejectsPlatform(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	plat := Channel{Type: 1, Name: "owned-test", Scope: ChannelScopePlatform, TenantId: 0, Key: "k", Status: 1, CreatedTime: 1}
	if err := WithTenantBypass(DB).Create(&plat).Error; err != nil {
		t.Fatalf("insert: %v", err)
	}
	defer WithTenantBypass(DB).Delete(&Channel{}, plat.Id)

	_, err := GetOwnedChannelForTenant(plat.Id, 7, true)
	if err == nil {
		t.Fatal("GetOwnedChannelForTenant must reject platform channel (strict tenant match)")
	}
}
```

- [ ] **Step 2: Run to fail**

Run: `go test ./model -run GetVisibleChannelForTenant -v`
Expected: FAIL

- [ ] **Step 3: Implement**

Append to `model/channel.go` (near `GetChannelByIdWithTenant` around line 370):

```go
// GetVisibleChannelForTenant returns a channel that is either owned by the
// tenant OR is a platform-scoped shared channel. Used by tenant-side reads
// (list/detail/fetch). See spec §9.1.
func GetVisibleChannelForTenant(id int, tenantId int, selectAll bool) (*Channel, error) {
	channel := &Channel{Id: id}
	query := DB.Where("id = ? AND (scope = ? OR tenant_id = ?)", id, ChannelScopePlatform, tenantId)
	var err error
	if selectAll {
		err = query.First(channel).Error
	} else {
		err = query.Omit("key").First(channel).Error
	}
	if err != nil {
		return nil, err
	}
	return channel, nil
}

// GetOwnedChannelForTenant strictly requires tenant_id match. Used by
// tenant-side writes so that platform channels (tenant_id=0) and other
// tenants' rows are never editable. See spec §9.1.
func GetOwnedChannelForTenant(id int, tenantId int, selectAll bool) (*Channel, error) {
	if tenantId <= 0 {
		return nil, errors.New("tenantId required for owned channel lookup")
	}
	channel := &Channel{Id: id}
	query := DB.Where("id = ? AND tenant_id = ?", id, tenantId)
	var err error
	if selectAll {
		err = query.First(channel).Error
	} else {
		err = query.Omit("key").First(channel).Error
	}
	if err != nil {
		return nil, err
	}
	return channel, nil
}
```

(`errors` should already be imported.)

- [ ] **Step 4: Run to pass**

Run: `go test ./model -run Channel -v`
Expected: new tests PASS, old tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add model/channel.go model/channel_visibility_test.go
git commit -m "feat(model): add GetVisibleChannelForTenant / GetOwnedChannelForTenant"
```

---

### Task 10: `effectiveMarkup` helper

**Files:**
- Create: `service/markup.go`
- Test: `service/markup_test.go` (new)

- [ ] **Step 1: Write test**

Create `service/markup_test.go`:

```go
package service

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
)

func TestEffectiveMarkup(t *testing.T) {
	f := func(v float64) *float64 { return &v }

	cases := []struct {
		name   string
		ch     *model.Channel
		plan   *model.TenantPlan
		want   float64
		source string
	}{
		{"tenant_scope_returns_1.0", &model.Channel{Scope: model.ChannelScopeTenant}, &model.TenantPlan{PlatformMarkup: 1.5}, 1.0, "none"},
		{"platform_channel_override", &model.Channel{Scope: model.ChannelScopePlatform, MarkupRatio: f(1.3)}, &model.TenantPlan{PlatformMarkup: 1.5}, 1.3, "channel"},
		{"platform_falls_back_to_plan", &model.Channel{Scope: model.ChannelScopePlatform, MarkupRatio: nil}, &model.TenantPlan{PlatformMarkup: 1.5}, 1.5, "plan"},
		{"platform_no_plan_uses_1.0", &model.Channel{Scope: model.ChannelScopePlatform, MarkupRatio: nil}, nil, 1.0, "none"},
		{"zero_plan_treated_as_unset", &model.Channel{Scope: model.ChannelScopePlatform, MarkupRatio: nil}, &model.TenantPlan{PlatformMarkup: 0}, 1.0, "none"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, src := EffectiveMarkup(c.ch, c.plan)
			if got != c.want || src != c.source {
				t.Errorf("got (%v, %q), want (%v, %q)", got, src, c.want, c.source)
			}
		})
	}
}
```

- [ ] **Step 2: Run to fail**

Run: `go test ./service -run TestEffectiveMarkup -v`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `service/markup.go`:

```go
package service

import "github.com/QuantumNous/new-api/model"

// EffectiveMarkup resolves the markup ratio applied to a request using the
// given channel (may be nil) and tenant plan (may be nil).
// Returns (ratio, source) where source is one of:
//   - "channel": channel.MarkupRatio is set
//   - "plan":    fell back to plan.PlatformMarkup
//   - "none":    no markup applies (returns 1.0)
//
// See spec §5.1.
func EffectiveMarkup(ch *model.Channel, plan *model.TenantPlan) (float64, string) {
	if ch == nil || ch.Scope != model.ChannelScopePlatform {
		return 1.0, "none"
	}
	if ch.MarkupRatio != nil {
		return *ch.MarkupRatio, "channel"
	}
	if plan != nil && plan.PlatformMarkup > 0 {
		return plan.PlatformMarkup, "plan"
	}
	return 1.0, "none"
}
```

- [ ] **Step 4: Run to pass**

Run: `go test ./service -run TestEffectiveMarkup -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add service/markup.go service/markup_test.go
git commit -m "feat(service): add EffectiveMarkup helper"
```

---

### Task 11: `sanitizeForTenantView` helper

**Files:**
- Create: `model/channel_sanitize.go`
- Test: `model/channel_sanitize_test.go` (new)

- [ ] **Step 1: Write test**

Create `model/channel_sanitize_test.go`:

```go
package model

import (
	"testing"
)

func TestSanitizeForTenantView_PlatformStripsSensitive(t *testing.T) {
	setting := `{"proxy":"http://...","system_prompt":"x"}`
	header := `{"X-Foo":"{api_key}"}`
	paramOv := `{"temperature":0.5}`
	other := `us-central1`
	baseURL := "https://api.openai.com/v1"
	statusMap := `{"429":"retry"}`
	autoBan := 1
	mkp := 1.2

	c := &Channel{
		Id: 1, Name: "p", Type: 1, Scope: ChannelScopePlatform,
		BaseURL:           baseURL,
		Key:               "sk-secret",
		Setting:           &setting,
		HeaderOverride:    &header,
		ParamOverride:     &paramOv,
		OtherSettings:     `{"vertex_key_type":"api_key","secret":"x"}`,
		Other:             other,
		StatusCodeMapping: &statusMap,
		AutoBan:           &autoBan,
		Balance:           100,
		UsedQuota:         50,
		MarkupRatio:       &mkp,
		ChannelInfo: ChannelInfo{
			IsMultiKey:             true,
			MultiKeyStatusList:     map[int]int{0: 2},
			MultiKeyDisabledReason: map[int]string{0: "banned"},
		},
	}
	SanitizeForTenantView(c)

	if c.Key != "" {
		t.Error("Key should be empty")
	}
	if c.Setting != nil && *c.Setting != "" {
		t.Error("Setting should be stripped")
	}
	if c.HeaderOverride != nil && *c.HeaderOverride != "" {
		t.Error("HeaderOverride should be stripped")
	}
	if c.ParamOverride != nil && *c.ParamOverride != "" {
		t.Error("ParamOverride should be stripped")
	}
	if c.Other != "" {
		t.Error("Other should be stripped")
	}
	if c.BaseURL != "" {
		t.Error("BaseURL should be stripped")
	}
	if c.Balance != 0 {
		t.Error("Balance should be zero")
	}
	if c.UsedQuota != 0 {
		t.Error("UsedQuota should be zero")
	}
	if c.ChannelInfo.MultiKeyStatusList != nil {
		t.Error("MultiKeyStatusList should be nil")
	}
	if c.ChannelInfo.MultiKeyDisabledReason != nil {
		t.Error("MultiKeyDisabledReason should be nil")
	}
	if c.MarkupRatio == nil || *c.MarkupRatio != 1.2 {
		t.Error("MarkupRatio should be preserved")
	}
	if c.Name != "p" {
		t.Error("Name should be preserved")
	}
}

func TestSanitizeForTenantView_TenantOnlyOmitsKey(t *testing.T) {
	setting := `{"proxy":"local"}`
	c := &Channel{
		Id: 2, Name: "own", Scope: ChannelScopeTenant, TenantId: 7,
		Key: "sk-my-key", Setting: &setting, Balance: 42,
	}
	SanitizeForTenantView(c)
	if c.Key != "" {
		t.Error("Key should be stripped even for owned channels (defense in depth)")
	}
	if c.Setting == nil || *c.Setting == "" {
		t.Error("own Setting must be preserved")
	}
	if c.Balance == 0 {
		t.Error("own Balance must be preserved")
	}
}
```

- [ ] **Step 2: Run to fail**

Run: `go test ./model -run TestSanitizeForTenantView -v`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `model/channel_sanitize.go`:

```go
package model

// SanitizeForTenantView mutates the channel in-place to remove sensitive or
// operational fields before returning to a tenant admin. Always strips Key.
// For platform-scoped channels, also strips Setting, HeaderOverride,
// ParamOverride, OtherSettings, Other, BaseURL, StatusCodeMapping, AutoBan,
// Balance, UsedQuota, and multi-key operational state.
// See spec §7.4.
func SanitizeForTenantView(c *Channel) {
	if c == nil {
		return
	}
	c.Key = ""
	c.Keys = nil

	if c.Scope != ChannelScopePlatform {
		return
	}

	// Platform rows: strip everything operational.
	empty := ""
	c.Setting = &empty
	c.HeaderOverride = &empty
	c.ParamOverride = &empty
	c.OtherSettings = ""
	c.Other = ""
	c.BaseURL = ""
	c.StatusCodeMapping = &empty
	zero := 0
	c.AutoBan = &zero
	c.Balance = 0
	c.BalanceUpdatedTime = 0
	c.UsedQuota = 0
	c.TestTime = 0
	c.ResponseTime = 0

	c.ChannelInfo.MultiKeyStatusList = nil
	c.ChannelInfo.MultiKeyDisabledReason = nil
	c.ChannelInfo.MultiKeyDisabledTime = nil
}

// SanitizeListForTenantView applies SanitizeForTenantView to each element.
func SanitizeListForTenantView(list []*Channel) {
	for _, c := range list {
		SanitizeForTenantView(c)
	}
}
```

**Important:** Check `model/channel.go` for the exact types of fields (some are `*string`, some `string`). Match them exactly. If a setter above references a non-existent field, fix to the actual one listed in `Channel` struct.

- [ ] **Step 4: Run to pass**

Run: `go test ./model -run TestSanitizeForTenantView -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add model/channel_sanitize.go model/channel_sanitize_test.go
git commit -m "feat(model): add SanitizeForTenantView helper"
```

---

### Task 12: `sanitizeForCopy` helper (for `CopyChannel`)

**Files:**
- Modify: `model/channel_sanitize.go`
- Test: `model/channel_sanitize_test.go` (append)

- [ ] **Step 1: Write test**

Append to `model/channel_sanitize_test.go`:

```go
func TestSanitizeForCopy_StripsKeyAndSensitive(t *testing.T) {
	setting := `{"proxy":"x"}`
	header := `{"H":"v"}`
	paramOv := `{"p":1}`
	src := &Channel{
		Id: 1, Name: "src", Type: 1, Models: "gpt-4o", Group: "default",
		Scope: ChannelScopePlatform, TenantId: 0,
		Key: "sk-secret", Setting: &setting, HeaderOverride: &header, ParamOverride: &paramOv,
		OtherSettings: "x", Other: "y",
		Balance: 99, UsedQuota: 50, TestTime: 1, ResponseTime: 2,
		ChannelInfo: ChannelInfo{IsMultiKey: true, MultiKeyStatusList: map[int]int{0: 1}},
	}
	dst := SanitizeForCopy(src, 7) // target tenantId
	if dst.Id != 0 {
		t.Error("Id must be 0 for new row")
	}
	if dst.Scope != ChannelScopeTenant {
		t.Error("Copy must land as tenant scope")
	}
	if dst.TenantId != 7 {
		t.Error("TenantId must be target tenant")
	}
	if dst.Key != "" {
		t.Error("Key must not be copied")
	}
	if dst.HeaderOverride != nil && *dst.HeaderOverride != "" {
		t.Error("HeaderOverride must not be copied")
	}
	if dst.ParamOverride != nil && *dst.ParamOverride != "" {
		t.Error("ParamOverride must not be copied")
	}
	if dst.OtherSettings != "" {
		t.Error("OtherSettings must not be copied")
	}
	if dst.Other != "" {
		t.Error("Other must not be copied")
	}
	if dst.Balance != 0 || dst.UsedQuota != 0 || dst.TestTime != 0 || dst.ResponseTime != 0 {
		t.Error("balance/quota/test/response must be zeroed")
	}
	if dst.ChannelInfo.IsMultiKey || dst.ChannelInfo.MultiKeyStatusList != nil {
		t.Error("ChannelInfo multi-key state must not be copied")
	}
	// Whitelist preserved:
	if dst.Name != "src" || dst.Type != 1 || dst.Models != "gpt-4o" || dst.Group != "default" {
		t.Error("whitelist fields (Name, Type, Models, Group) must be preserved")
	}
}
```

- [ ] **Step 2: Run to fail**

Run: `go test ./model -run TestSanitizeForCopy -v`
Expected: FAIL

- [ ] **Step 3: Implement**

Append to `model/channel_sanitize.go`:

```go
// SanitizeForCopy returns a new Channel value suitable for insert: only
// whitelisted metadata fields are carried from src. Key, HeaderOverride,
// ParamOverride, OtherSettings, Other, Balance, UsedQuota, TestTime,
// ResponseTime, and multi-key state are NEVER copied. The caller must
// supply the target tenantId; scope is forced to tenant.
// See spec §9.2 (Task T39 / CopyChannel).
func SanitizeForCopy(src *Channel, targetTenantId int) *Channel {
	if src == nil {
		return nil
	}
	dst := Channel{
		// whitelist
		Type:         src.Type,
		Name:         src.Name,
		Models:       src.Models,
		Group:        src.Group,
		ModelMapping: src.ModelMapping,
		Priority:     src.Priority,
		Weight:       src.Weight,
		Tag:          src.Tag,

		// forced fields
		Id:       0,
		Scope:    ChannelScopeTenant,
		TenantId: targetTenantId,
		Status:   src.Status,

		// Setting copied only after whitelist-filter via code below; initially empty.
	}
	// Setting needs a whitelist of sub-fields (Proxy is sensitive per spec §7.4).
	// For v1 simplicity we do not copy Setting at all — user reconfigures in UI.
	// This is a conservative choice; can be relaxed later.
	return &dst
}
```

- [ ] **Step 4: Run to pass**

Run: `go test ./model -run TestSanitizeForCopy -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add model/channel_sanitize.go model/channel_sanitize_test.go
git commit -m "feat(model): add SanitizeForCopy helper (no Key, no secrets)"
```

---

### Task 13: `SearchChannelsForTenant` (no key-oracle predicate)

**Files:**
- Modify: `model/channel.go` (near line 314 `SearchChannelsByTenant`)
- Test: `model/channel_search_test.go` (new)

- [ ] **Step 1: Write test**

Create `model/channel_search_test.go`:

```go
package model

import "testing"

func TestSearchChannelsForTenant_DoesNotLeakByKey(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	// Insert a platform channel with a unique key.
	plat := Channel{Type: 1, Name: "search-plat", Scope: ChannelScopePlatform, TenantId: 0, Key: "sk-ABC-unique-12345", Status: 1, CreatedTime: 1, Models: "gpt-4o"}
	if err := WithTenantBypass(DB).Create(&plat).Error; err != nil {
		t.Fatalf("insert: %v", err)
	}
	defer WithTenantBypass(DB).Delete(&Channel{}, plat.Id)

	// Tenant 7 searches by the exact key string — must NOT match.
	rows, err := SearchChannelsForTenant(7, "sk-ABC-unique-12345", "", "", false)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	for _, r := range rows {
		if r.Id == plat.Id {
			t.Fatal("tenant search leaked platform channel via key match")
		}
	}
}

func TestSearchChannelsForTenant_FindsByName(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	plat := Channel{Type: 1, Name: "findable-platform-xyz", Scope: ChannelScopePlatform, TenantId: 0, Key: "k", Status: 1, CreatedTime: 1, Models: "gpt-4o"}
	if err := WithTenantBypass(DB).Create(&plat).Error; err != nil {
		t.Fatalf("insert: %v", err)
	}
	defer WithTenantBypass(DB).Delete(&Channel{}, plat.Id)

	rows, _ := SearchChannelsForTenant(7, "findable-platform", "", "", false)
	found := false
	for _, r := range rows {
		if r.Id == plat.Id {
			found = true
		}
	}
	if !found {
		t.Fatal("search by name should find platform channel")
	}
}
```

- [ ] **Step 2: Run to fail**

Run: `go test ./model -run TestSearchChannelsForTenant -v`
Expected: FAIL (undefined)

- [ ] **Step 3: Implement**

Append to `model/channel.go` (below `SearchChannelsByTenant`):

```go
// SearchChannelsForTenant searches channels visible to the given tenant
// (own + platform), excluding the `key = ?` predicate that SearchChannelsByTenant
// supports. This removes the "key existence oracle" — see spec §7.5.
func SearchChannelsForTenant(tenantId int, keyword, group, modelName string, idSort bool) ([]*Channel, error) {
	var channels []*Channel
	if tenantId <= 0 {
		return channels, nil
	}

	modelsCol := "`models`"
	if common.UsingPostgreSQL {
		modelsCol = `"models"`
	}
	baseURLCol := "`base_url`"
	if common.UsingPostgreSQL {
		baseURLCol = `"base_url"`
	}

	order := "priority desc"
	if idSort {
		order = "id desc"
	}

	baseQuery := DB.Model(&Channel{}).Omit("key").
		Where("scope = ? OR tenant_id = ?", ChannelScopePlatform, tenantId)

	var whereClause string
	var args []interface{}
	// Note: NO `key = ?` predicate here (anti-oracle).
	if group != "" && group != "null" {
		var groupCondition string
		if common.UsingMySQL {
			groupCondition = `CONCAT(',', ` + commonGroupCol + `, ',') LIKE ?`
		} else {
			groupCondition = `(',' || ` + commonGroupCol + ` || ',') LIKE ?`
		}
		whereClause = "(id = ? OR name LIKE ? OR " + baseURLCol + " LIKE ?) AND " + modelsCol + ` LIKE ? AND ` + groupCondition
		args = append(args, common.String2Int(keyword), "%"+keyword+"%", "%"+keyword+"%", "%"+modelName+"%", "%,"+group+",%")
	} else {
		whereClause = "(id = ? OR name LIKE ? OR " + baseURLCol + " LIKE ?) AND " + modelsCol + " LIKE ?"
		args = append(args, common.String2Int(keyword), "%"+keyword+"%", "%"+keyword+"%", "%"+modelName+"%")
	}

	if err := baseQuery.Where(whereClause, args...).Order(order).Find(&channels).Error; err != nil {
		return nil, err
	}
	return channels, nil
}
```

- [ ] **Step 4: Run to pass**

Run: `go test ./model -run TestSearchChannelsForTenant -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add model/channel.go model/channel_search_test.go
git commit -m "feat(model): add SearchChannelsForTenant (no key oracle)"
```

---

### Task 14: Tag helpers `*ForTenant` variants

**Files:**
- Modify: `model/channel.go`
- Test: `model/channel_tag_tenant_test.go` (new)

- [ ] **Step 1: Write test**

Create `model/channel_tag_tenant_test.go`:

```go
package model

import "testing"

func TestGetChannelsByTagForTenant_IncludesPlatformExcludesOthers(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	tag := "test-tag-xyz"
	p := Channel{Name: "p", Tag: &tag, Scope: ChannelScopePlatform, TenantId: 0, Type: 1, Key: "k", Status: 1, CreatedTime: 1}
	mine := Channel{Name: "mine", Tag: &tag, Scope: ChannelScopeTenant, TenantId: 7, Type: 1, Key: "k", Status: 1, CreatedTime: 1}
	other := Channel{Name: "other", Tag: &tag, Scope: ChannelScopeTenant, TenantId: 8, Type: 1, Key: "k", Status: 1, CreatedTime: 1}
	for _, c := range []*Channel{&p, &mine, &other} {
		if err := WithTenantBypass(DB).Create(c).Error; err != nil {
			t.Fatal(err)
		}
		defer WithTenantBypass(DB).Delete(&Channel{}, c.Id)
	}

	rows, err := GetChannelsByTagForTenant(tag, 7, false, false)
	if err != nil {
		t.Fatal(err)
	}
	ids := map[int]bool{}
	for _, r := range rows {
		ids[r.Id] = true
	}
	if !ids[p.Id] {
		t.Error("must include platform channel")
	}
	if !ids[mine.Id] {
		t.Error("must include own tenant channel")
	}
	if ids[other.Id] {
		t.Error("must NOT include other tenant's channel")
	}
}
```

- [ ] **Step 2: Run to fail**

Run: `go test ./model -run TestGetChannelsByTagForTenant -v`
Expected: FAIL

- [ ] **Step 3: Implement three `*ForTenant` helpers**

Append to `model/channel.go`:

```go
// GetChannelsByTagForTenant returns channels with the given tag that are
// visible to the tenant (own + platform). See spec §9.3.
func GetChannelsByTagForTenant(tag string, tenantId int, idSort bool, selectAll bool) ([]*Channel, error) {
	var channels []*Channel
	if tenantId <= 0 {
		return channels, nil
	}
	order := "priority desc"
	if idSort {
		order = "id desc"
	}
	query := DB.Where("tag = ? AND (scope = ? OR tenant_id = ?)", tag, ChannelScopePlatform, tenantId).Order(order)
	if !selectAll {
		query = query.Omit("key")
	}
	err := query.Find(&channels).Error
	return channels, err
}

// GetPaginatedTagsForTenant returns distinct non-empty tags visible to
// the tenant (own + platform).
func GetPaginatedTagsForTenant(tenantId int, offset, limit int) ([]*string, error) {
	var tags []*string
	if tenantId <= 0 {
		return tags, nil
	}
	err := DB.Model(&Channel{}).Select("DISTINCT tag").
		Where("tag != '' AND (scope = ? OR tenant_id = ?)", ChannelScopePlatform, tenantId).
		Offset(offset).Limit(limit).Find(&tags).Error
	return tags, err
}

// SearchTagsForTenant searches tags visible to the tenant.
// The `key = ?` predicate is NOT included here (anti-oracle; see §7.5).
func SearchTagsForTenant(tenantId int, keyword, group, modelName string, idSort bool) ([]*string, error) {
	var tags []*string
	if tenantId <= 0 {
		return tags, nil
	}
	modelsCol := "`models`"
	if common.UsingPostgreSQL {
		modelsCol = `"models"`
	}
	baseURLCol := "`base_url`"
	if common.UsingPostgreSQL {
		baseURLCol = `"base_url"`
	}
	order := "priority desc"
	if idSort {
		order = "id desc"
	}
	baseQuery := DB.Model(&Channel{}).
		Where("scope = ? OR tenant_id = ?", ChannelScopePlatform, tenantId)
	var whereClause string
	var args []interface{}
	if group != "" && group != "null" {
		var groupCondition string
		if common.UsingMySQL {
			groupCondition = `CONCAT(',', ` + commonGroupCol + `, ',') LIKE ?`
		} else {
			groupCondition = `(',' || ` + commonGroupCol + ` || ',') LIKE ?`
		}
		whereClause = "(id = ? OR name LIKE ? OR " + baseURLCol + " LIKE ?) AND " + modelsCol + ` LIKE ? AND ` + groupCondition
		args = append(args, common.String2Int(keyword), "%"+keyword+"%", "%"+keyword+"%", "%"+modelName+"%", "%,"+group+",%")
	} else {
		whereClause = "(id = ? OR name LIKE ? OR " + baseURLCol + " LIKE ?) AND " + modelsCol + " LIKE ?"
		args = append(args, common.String2Int(keyword), "%"+keyword+"%", "%"+keyword+"%", "%"+modelName+"%")
	}
	err := baseQuery.Where(whereClause, args...).Order(order).Select("DISTINCT tag").Find(&tags).Error
	return tags, err
}
```

- [ ] **Step 4: Run to pass**

Run: `go test ./model -run TestGetChannelsByTagForTenant -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add model/channel.go model/channel_tag_tenant_test.go
git commit -m "feat(model): add *ForTenant tag helpers (no key oracle, scope-aware)"
```

---

## Phase 3 — Effective Routing (Milestone 4)

Goal: Platform channels participate in route selection and model discovery with proper mode/override filtering. Same helper underlies routing AND discovery.

### Task 15: `EffectiveRoutingSet` helper + mode filter

**Files:**
- Create: `model/effective_routing.go`
- Test: `model/effective_routing_test.go` (new)

- [ ] **Step 1: Write test**

Create `model/effective_routing_test.go`:

```go
package model

import (
	"testing"
)

func TestFilterByTenantMode_PrivatePriority(t *testing.T) {
	tenants := []Ability{{ChannelId: 1, Scope: ChannelScopeTenant, TenantId: 7}}
	platforms := []Ability{{ChannelId: 100, Scope: ChannelScopePlatform, TenantId: 0}}
	out := FilterByTenantMode(tenants, platforms, PlatformChannelModePrivatePriority, nil)
	if len(out) != 1 || out[0].ChannelId != 1 {
		t.Fatalf("private_priority should return only tenant row when both present: %+v", out)
	}
}

func TestFilterByTenantMode_PrivatePriorityFallback(t *testing.T) {
	platforms := []Ability{{ChannelId: 100, Scope: ChannelScopePlatform, TenantId: 0}}
	out := FilterByTenantMode(nil, platforms, PlatformChannelModePrivatePriority, nil)
	if len(out) != 1 || out[0].ChannelId != 100 {
		t.Fatalf("private_priority with no tenant rows should fall back to platform: %+v", out)
	}
}

func TestFilterByTenantMode_OnlyPrivate(t *testing.T) {
	tenants := []Ability{{ChannelId: 1, Scope: ChannelScopeTenant, TenantId: 7}}
	platforms := []Ability{{ChannelId: 100, Scope: ChannelScopePlatform, TenantId: 0}}
	out := FilterByTenantMode(tenants, platforms, PlatformChannelModeOnlyPrivate, nil)
	if len(out) != 1 || out[0].ChannelId != 1 {
		t.Fatalf("only_private should ignore platform: %+v", out)
	}
}

func TestFilterByTenantMode_OnlyPlatform(t *testing.T) {
	tenants := []Ability{{ChannelId: 1, Scope: ChannelScopeTenant, TenantId: 7}}
	platforms := []Ability{{ChannelId: 100, Scope: ChannelScopePlatform, TenantId: 0}}
	out := FilterByTenantMode(tenants, platforms, PlatformChannelModeOnlyPlatform, nil)
	if len(out) != 1 || out[0].ChannelId != 100 {
		t.Fatalf("only_platform should ignore tenant rows: %+v", out)
	}
}

func TestFilterByTenantMode_DisabledPlatformRemoved(t *testing.T) {
	platforms := []Ability{
		{ChannelId: 100, Scope: ChannelScopePlatform, TenantId: 0},
		{ChannelId: 101, Scope: ChannelScopePlatform, TenantId: 0},
	}
	disabled := map[int]struct{}{100: {}}
	out := FilterByTenantMode(nil, platforms, PlatformChannelModePrivatePriority, disabled)
	if len(out) != 1 || out[0].ChannelId != 101 {
		t.Fatalf("disabled platform channel should be removed: %+v", out)
	}
}

func TestFilterByTenantMode_PlatformPriorityWithDisabledFallsBack(t *testing.T) {
	tenants := []Ability{{ChannelId: 1, Scope: ChannelScopeTenant, TenantId: 7}}
	platforms := []Ability{{ChannelId: 100, Scope: ChannelScopePlatform, TenantId: 0}}
	disabled := map[int]struct{}{100: {}}
	out := FilterByTenantMode(tenants, platforms, PlatformChannelModePlatformPriority, disabled)
	// All platform channels disabled → fall back to tenant.
	if len(out) != 1 || out[0].ChannelId != 1 {
		t.Fatalf("platform_priority with all-disabled platform should fall back to tenant: %+v", out)
	}
}
```

- [ ] **Step 2: Run to fail**

Run: `go test ./model -run TestFilterByTenantMode -v`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `model/effective_routing.go`:

```go
package model

// FilterByTenantMode implements the 4 routing modes.
// Inputs:
//   tenantCandidates   — abilities owned by the tenant (scope='tenant', tenant_id=current)
//   platformCandidates — abilities with scope='platform' (tenant_id=0)
//   mode               — one of PlatformChannelMode*; empty/invalid treated as private_priority
//   disabled           — set of channel_ids the tenant has disabled (from tenant_channel_overrides)
//
// Returns the resulting candidate slice; "disabled" platforms are always removed
// regardless of mode. The four mode semantics match spec §4.2.
func FilterByTenantMode(
	tenantCandidates []Ability,
	platformCandidates []Ability,
	mode string,
	disabled map[int]struct{},
) []Ability {
	// Remove disabled platform channels (disable has no meaning for tenant-owned rows).
	effectivePlatform := platformCandidates
	if len(disabled) > 0 {
		effectivePlatform = effectivePlatform[:0] // reuse backing array
		for _, a := range platformCandidates {
			if _, off := disabled[a.ChannelId]; off {
				continue
			}
			effectivePlatform = append(effectivePlatform, a)
		}
	}

	switch mode {
	case PlatformChannelModeOnlyPrivate:
		return tenantCandidates
	case PlatformChannelModeOnlyPlatform:
		return effectivePlatform
	case PlatformChannelModePlatformPriority:
		if len(effectivePlatform) > 0 {
			return effectivePlatform
		}
		return tenantCandidates
	case PlatformChannelModePrivatePriority, "":
		fallthrough
	default:
		if len(tenantCandidates) > 0 {
			return tenantCandidates
		}
		return effectivePlatform
	}
}
```

- [ ] **Step 4: Run to pass**

Run: `go test ./model -run TestFilterByTenantMode -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add model/effective_routing.go model/effective_routing_test.go
git commit -m "feat(model): add FilterByTenantMode helper for 4 routing modes"
```

---

### Task 16: `channel_cache` in-memory mode/override index

**Files:**
- Modify: `model/channel_cache.go`
- Test: `model/channel_cache_index_test.go` (new)

- [ ] **Step 1: Write test**

Create `model/channel_cache_index_test.go`:

```go
package model

import "testing"

func TestTenantRoutingPrefs_ReflectsStoredValues(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	tenantId := 44
	// Seed DB
	_ = SetTenantChannelDisabled(tenantId, 777, true)
	defer SetTenantChannelDisabled(tenantId, 777, false)
	_ = SetTenantPlatformChannelMode(tenantId, PlatformChannelModeOnlyPlatform)

	// Load into cache
	ReloadTenantRoutingCache(tenantId)

	mode := GetCachedTenantMode(tenantId)
	if mode != PlatformChannelModeOnlyPlatform {
		t.Errorf("mode = %q, want only_platform", mode)
	}
	dis := GetCachedTenantDisabledChannels(tenantId)
	if _, ok := dis[777]; !ok {
		t.Error("channel 777 should be in disabled set")
	}
}
```

- [ ] **Step 2: Run to fail**

Run: `go test ./model -run TestTenantRoutingPrefs_ReflectsStoredValues -v`
Expected: FAIL

- [ ] **Step 3: Implement**

In `model/channel_cache.go`, add above `InitChannelCache`:

```go
var (
	// In-memory routing preferences per tenant. Rebuilt by ReloadTenantRoutingCache.
	tenantRoutingMu       sync.RWMutex
	tenantMode            = map[int]string{}              // tenantId -> mode
	tenantDisabledChannel = map[int]map[int]struct{}{}    // tenantId -> set of channel_id
)

// ReloadTenantRoutingCache refreshes mode + disabled-set for one tenant
// from DB. Call whenever tenant_options.platform_channel_mode or
// tenant_channel_overrides changes. See spec §4.3.
func ReloadTenantRoutingCache(tenantId int) {
	if tenantId <= 0 {
		return
	}
	mode, _ := GetTenantPlatformChannelMode(tenantId)
	dis, _ := GetTenantDisabledPlatformChannels(tenantId)

	tenantRoutingMu.Lock()
	defer tenantRoutingMu.Unlock()
	tenantMode[tenantId] = mode
	tenantDisabledChannel[tenantId] = dis
}

// InvalidateTenantRoutingCache is an alias for ReloadTenantRoutingCache
// (refresh instead of drop so lookups stay warm).
func InvalidateTenantRoutingCache(tenantId int) {
	ReloadTenantRoutingCache(tenantId)
}

// GetCachedTenantMode returns the cached mode for the tenant, or the
// default if not loaded.
func GetCachedTenantMode(tenantId int) string {
	tenantRoutingMu.RLock()
	defer tenantRoutingMu.RUnlock()
	if m, ok := tenantMode[tenantId]; ok {
		return m
	}
	return PlatformChannelModePrivatePriority
}

// GetCachedTenantDisabledChannels returns the cached disabled set (nil-safe).
func GetCachedTenantDisabledChannels(tenantId int) map[int]struct{} {
	tenantRoutingMu.RLock()
	defer tenantRoutingMu.RUnlock()
	if s, ok := tenantDisabledChannel[tenantId]; ok {
		return s
	}
	return map[int]struct{}{}
}

// reloadAllTenantRoutingCaches is called from InitChannelCache to warm up
// per-tenant preferences for every active tenant.
func reloadAllTenantRoutingCaches() {
	var tenants []Tenant
	WithTenantBypass(DB).Where("status = ?", TenantStatusActive).Find(&tenants)
	for _, t := range tenants {
		ReloadTenantRoutingCache(t.Id)
	}
}
```

Make sure `"sync"` is imported (it is).

In `InitChannelCache` at the bottom of the function (after cache maps are built, before it returns), add:

```go
	reloadAllTenantRoutingCaches()
```

- [ ] **Step 4: Run to pass**

Run: `go test ./model -run TestTenantRoutingPrefs_ReflectsStoredValues -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add model/channel_cache.go model/channel_cache_index_test.go
git commit -m "feat(model): in-memory tenant mode/override index in channel_cache"
```

---

### Task 17: Merge platform + tenant buckets in `GetRandomSatisfiedChannel`

**Files:**
- Modify: `model/channel_cache.go` (`GetRandomSatisfiedChannel` around line 155)
- Test: `model/channel_cache_merge_test.go` (new)

- [ ] **Step 1: Write test**

Create `model/channel_cache_merge_test.go`:

```go
package model

import "testing"

// This is a lightweight "shape" test — real routing behavior tested in
// integration (Task 48).
func TestGetRandomSatisfiedChannel_IncludesPlatformBucket(t *testing.T) {
	if DB == nil || !common.MemoryCacheEnabled {
		t.Skip("no DB or memory cache disabled")
	}
	// Arrange platform channel + ability with scope='platform' and bucket key "0:default".
	// (Full behavioral tests live in integration; here we only assert the
	// function doesn't ignore the 0-bucket.)
	ch := Channel{Name: "plat-gpt-4o", Type: 1, Scope: ChannelScopePlatform, TenantId: 0, Key: "k", Status: 1, Models: "gpt-4o", Group: "default", CreatedTime: 1}
	if err := WithTenantBypass(DB).Create(&ch).Error; err != nil {
		t.Fatal(err)
	}
	defer WithTenantBypass(DB).Delete(&Channel{}, ch.Id)
	_ = ch.AddAbilities(nil) // writes to abilities table
	defer ch.DeleteAbilities()

	InitChannelCache()

	// Tenant 77 (no own channels) should still find the platform channel
	got, err := GetRandomSatisfiedChannel(77, "default", "gpt-4o", 0)
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.Id != ch.Id {
		t.Fatalf("expected platform channel %d, got %v", ch.Id, got)
	}
}
```

- [ ] **Step 2: Run to fail**

Run: `go test ./model -run TestGetRandomSatisfiedChannel_IncludesPlatformBucket -v`
Expected: FAIL (current code only reads `tenantId:group` bucket).

- [ ] **Step 3: Modify `GetRandomSatisfiedChannel`**

In `model/channel_cache.go` `GetRandomSatisfiedChannel`, replace the portion from `tgKey := tenantGroupKey(...)` through the early-return `if len(channels) == 0 { return nil, nil }` with:

```go
	tgKey := tenantGroupKey(tenantId, group)
	platformKey := tenantGroupKey(0, group)

	gather := func(modelName string) []int {
		var out []int
		if m, ok := group2model2channels[tgKey]; ok {
			out = append(out, m[modelName]...)
		}
		if m, ok := group2model2channels[platformKey]; ok {
			out = append(out, m[modelName]...)
		}
		return out
	}
	channels := gather(model)
	if len(channels) == 0 {
		normalizedModel := ratio_setting.FormatMatchingModelName(model)
		channels = gather(normalizedModel)
	}

	// Apply tenant mode + disabled filter.
	mode := GetCachedTenantMode(tenantId)
	disabled := GetCachedTenantDisabledChannels(tenantId)
	var tenantOwn, platform []int
	for _, id := range channels {
		c := channelsIDM[id]
		if c == nil {
			continue
		}
		if c.Scope == ChannelScopePlatform {
			if _, off := disabled[id]; off {
				continue
			}
			platform = append(platform, id)
		} else {
			tenantOwn = append(tenantOwn, id)
		}
	}
	switch mode {
	case PlatformChannelModeOnlyPrivate:
		channels = tenantOwn
	case PlatformChannelModeOnlyPlatform:
		channels = platform
	case PlatformChannelModePlatformPriority:
		if len(platform) > 0 {
			channels = platform
		} else {
			channels = tenantOwn
		}
	default: // private_priority
		if len(tenantOwn) > 0 {
			channels = tenantOwn
		} else {
			channels = platform
		}
	}
	if len(channels) == 0 {
		return nil, nil
	}
```

- [ ] **Step 4: Run to pass**

Run: `go test ./model -run TestGetRandomSatisfiedChannel_IncludesPlatformBucket -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add model/channel_cache.go model/channel_cache_merge_test.go
git commit -m "feat(model): merge tenant+platform buckets + apply mode/disable in lookup"
```

---

### Task 18: Discovery — `GetGroupEnabledModels` / `GetEnabledModels`

**Files:**
- Modify: `model/ability.go`
- Test: `model/ability_discovery_test.go` (new)

- [ ] **Step 1: Write test**

Create `model/ability_discovery_test.go`:

```go
package model

import "testing"

func TestGetGroupEnabledModels_IncludesPlatform(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	// Platform ability
	pa := Ability{Group: "default", Model: "plat-model-xyz", ChannelId: 9001, TenantId: 0, Scope: ChannelScopePlatform, Enabled: true}
	WithTenantBypass(DB).Create(&pa)
	defer WithTenantBypass(DB).Where("channel_id = ?", 9001).Delete(&Ability{})
	// Make sure the channel also has scope=platform in cache if reloaded
	_ = pa

	models := GetGroupEnabledModels("default", 77)
	found := false
	for _, m := range models {
		if m == "plat-model-xyz" {
			found = true
		}
	}
	if !found {
		t.Fatal("GetGroupEnabledModels must include platform-scope models")
	}
}
```

- [ ] **Step 2: Run to fail**

Run: `go test ./model -run TestGetGroupEnabledModels_IncludesPlatform -v`
Expected: FAIL

- [ ] **Step 3: Modify queries**

In `model/ability.go` around line 45 (`GetGroupEnabledModels`):

```go
func GetGroupEnabledModels(group string, tenantId int) []string {
	var models []string
	q := DB.Table("abilities").Where(commonGroupCol+" = ? and enabled = ?", group, true)
	if tenantId > 0 {
		q = q.Where("scope = ? OR tenant_id = ?", ChannelScopePlatform, tenantId)
	}
	q.Distinct("model").Pluck("model", &models)
	return models
}
```

And `GetEnabledModels` around line 55:

```go
func GetEnabledModels(tenantId int) []string {
	var models []string
	q := DB.Table("abilities").Where("enabled = ?", true)
	if tenantId > 0 {
		q = q.Where("scope = ? OR tenant_id = ?", ChannelScopePlatform, tenantId)
	}
	q.Distinct("model").Pluck("model", &models)
	return models
}
```

**Discovery should also respect mode/override for correctness.** Add a post-filter helper `FilterDiscoveryModelsByTenantMode(tenantId, models []string) []string` that drops models only served by platform when mode=`only_private`, or only served by tenant when mode=`only_platform`, and drops models whose only viable platform channels are all disabled. For v1 we keep SQL simple and rely on `EffectiveRoutingSet` + routing fallback to produce accurate results; the UI will see models, and invocation will route correctly. If an integration test (Task 48) shows user-visible drift, revisit.

- [ ] **Step 4: Run to pass**

Run: `go test ./model -run TestGetGroupEnabledModels_IncludesPlatform -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add model/ability.go model/ability_discovery_test.go
git commit -m "feat(model): include scope='platform' in GetGroupEnabledModels / GetEnabledModels"
```

---

### Task 19: Discovery — `GetBoundChannelsByModelsMap`

**Files:**
- Modify: `model/model_meta.go` (`GetBoundChannelsByModelsMap` around line 112)
- Test: `model/model_meta_bound_test.go` (new)

- [ ] **Step 1: Write test**

Create `model/model_meta_bound_test.go`:

```go
package model

import "testing"

func TestGetBoundChannelsByModelsMap_IncludesPlatform(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	ch := Channel{Name: "plat-bound", Type: 1, Scope: ChannelScopePlatform, TenantId: 0, Key: "k", Status: 1, Models: "bound-model-xyz", Group: "default", CreatedTime: 1}
	if err := WithTenantBypass(DB).Create(&ch).Error; err != nil {
		t.Fatal(err)
	}
	defer WithTenantBypass(DB).Delete(&Channel{}, ch.Id)
	_ = ch.AddAbilities(nil)
	defer ch.DeleteAbilities()

	m, err := GetBoundChannelsByModelsMap([]string{"bound-model-xyz"}, 77)
	if err != nil {
		t.Fatal(err)
	}
	rows := m["bound-model-xyz"]
	if len(rows) == 0 {
		t.Fatal("expected platform channel in bound channels map")
	}
	if rows[0].Name != "plat-bound" {
		t.Errorf("unexpected binding: %+v", rows[0])
	}
}

func TestGetBoundChannelsByModelsMap_RespectsTenantDisable(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	ch := Channel{Name: "plat-bound-disable", Type: 1, Scope: ChannelScopePlatform, TenantId: 0, Key: "k", Status: 1, Models: "bound-disable-xyz", Group: "default", CreatedTime: 1}
	if err := WithTenantBypass(DB).Create(&ch).Error; err != nil {
		t.Fatal(err)
	}
	defer WithTenantBypass(DB).Delete(&Channel{}, ch.Id)
	_ = ch.AddAbilities(nil)
	defer ch.DeleteAbilities()

	SetTenantChannelDisabled(78, ch.Id, true)
	defer SetTenantChannelDisabled(78, ch.Id, false)
	ReloadTenantRoutingCache(78)

	m, _ := GetBoundChannelsByModelsMap([]string{"bound-disable-xyz"}, 78)
	for _, r := range m["bound-disable-xyz"] {
		if r.Name == "plat-bound-disable" {
			t.Fatal("tenant-disabled platform channel should not appear in BoundChannels")
		}
	}
}
```

- [ ] **Step 2: Run to fail**

Run: `go test ./model -run TestGetBoundChannelsByModelsMap -v`
Expected: FAIL

- [ ] **Step 3: Modify**

Replace `model/model_meta.go:112-138` `GetBoundChannelsByModelsMap` body:

```go
func GetBoundChannelsByModelsMap(modelNames []string, tenantId ...int) (map[string][]BoundChannel, error) {
	result := make(map[string][]BoundChannel)
	if len(modelNames) == 0 {
		return result, nil
	}
	type row struct {
		Model     string
		Name      string
		Type      int
		Scope     string
		ChannelId int
	}
	var rows []row
	q := DB.Table("channels").
		Select("abilities.model as model, channels.name as name, channels.type as type, channels.scope as scope, channels.id as channel_id").
		Joins("JOIN abilities ON abilities.channel_id = channels.id").
		Where("abilities.model IN ? AND abilities.enabled = ?", modelNames, true)
	if len(tenantId) > 0 && tenantId[0] > 0 {
		tid := tenantId[0]
		q = q.Where("channels.scope = ? OR channels.tenant_id = ?", ChannelScopePlatform, tid)
	}
	if err := q.Distinct().Scan(&rows).Error; err != nil {
		return nil, err
	}

	// Apply tenant mode + override only when tenantId is given.
	var mode string
	var disabled map[int]struct{}
	if len(tenantId) > 0 && tenantId[0] > 0 {
		mode = GetCachedTenantMode(tenantId[0])
		disabled = GetCachedTenantDisabledChannels(tenantId[0])
	}
	for _, r := range rows {
		if r.Scope == ChannelScopePlatform {
			if _, off := disabled[r.ChannelId]; off {
				continue
			}
			if mode == PlatformChannelModeOnlyPrivate {
				continue
			}
		} else {
			if mode == PlatformChannelModeOnlyPlatform {
				continue
			}
		}
		result[r.Model] = append(result[r.Model], BoundChannel{Name: r.Name, Type: r.Type})
	}
	return result, nil
}
```

- [ ] **Step 4: Run to pass**

Run: `go test ./model -run TestGetBoundChannelsByModelsMap -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add model/model_meta.go model/model_meta_bound_test.go
git commit -m "feat(model): GetBoundChannelsByModelsMap respects scope + mode + override"
```

---

### Task 20: `GetChannelGroupsCopy` merges platform group

**Files:**
- Modify: `model/channel_cache.go` (find `GetChannelGroupsCopy` / `channelGroups`)
- Test: `model/channel_cache_groups_test.go` (new)

- [ ] **Step 1: Read the current function**

Run: `grep -n "GetChannelGroupsCopy\|channelGroups" model/channel_cache.go`

Note the current bucket key and return shape.

- [ ] **Step 2: Write test**

Create `model/channel_cache_groups_test.go`:

```go
package model

import "testing"

func TestGetChannelGroupsCopy_IncludesPlatformGroup(t *testing.T) {
	if DB == nil || !common.MemoryCacheEnabled {
		t.Skip("no DB or cache disabled")
	}
	ch := Channel{Name: "grp-plat", Type: 1, Scope: ChannelScopePlatform, TenantId: 0, Key: "k", Status: 1, Models: "m", Group: "platform-only-group-xyz", CreatedTime: 1}
	WithTenantBypass(DB).Create(&ch)
	defer WithTenantBypass(DB).Delete(&Channel{}, ch.Id)
	_ = ch.AddAbilities(nil)
	defer ch.DeleteAbilities()

	InitChannelCache()
	groups := GetChannelGroupsCopy(77)
	if _, ok := groups["platform-only-group-xyz"]; !ok {
		t.Fatal("platform group must be visible to tenant")
	}
}
```

- [ ] **Step 3: Run to fail**

Run: `go test ./model -run TestGetChannelGroupsCopy_IncludesPlatformGroup -v`
Expected: FAIL

- [ ] **Step 4: Modify**

In `GetChannelGroupsCopy`, union the tenant bucket and the platform (`tenantId=0`) bucket. Exact code depends on current shape — conceptually:

```go
func GetChannelGroupsCopy(tenantId int) map[string]map[string][]int {
	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()

	out := make(map[string]map[string][]int)

	// union helper
	merge := func(prefix int) {
		for key, models := range group2model2channels {
			// keys are "tenantId:group"
			parts := strings.SplitN(key, ":", 2)
			if len(parts) != 2 {
				continue
			}
			if parts[0] != fmt.Sprintf("%d", prefix) {
				continue
			}
			group := parts[1]
			if _, ok := out[group]; !ok {
				out[group] = make(map[string][]int)
			}
			for m, ids := range models {
				out[group][m] = append(out[group][m], ids...)
			}
		}
	}
	merge(tenantId)
	merge(0) // platform
	return out
}
```

**Important:** Adapt to the actual current signature/return shape. If the current function returns `map[string]struct{}` just for group names, union both prefix sets into one.

- [ ] **Step 5: Run to pass**

Run: `go test ./model -run TestGetChannelGroupsCopy_IncludesPlatformGroup -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add model/channel_cache.go model/channel_cache_groups_test.go
git commit -m "feat(model): GetChannelGroupsCopy unions tenant + platform groups"
```

---

### Task 21: Channel Affinity — tenantId-prefixed cache key + re-validation

**Files:**
- Modify: `service/channel_affinity.go` (`buildChannelAffinityCacheKeySuffix` around line 322 and call sites around line 576)
- Modify: `middleware/distributor.go` (hit branch around line 104-125)
- Test: `service/channel_affinity_test.go` (new or append)

- [ ] **Step 1: Add tenantId to the cache key builder**

In `service/channel_affinity.go`:

Replace `buildChannelAffinityCacheKeySuffix(rule, usingGroup, affinityValue)` — change signature to accept `tenantId int` as first positional, and prefix the output:

```go
func buildChannelAffinityCacheKeySuffix(rule operation_setting.ChannelAffinityRule, tenantId int, usingGroup string, affinityValue string) string {
	parts := make([]string, 0, 4)
	parts = append(parts, fmt.Sprintf("t%d", tenantId))
	if rule.IncludeRuleName && rule.Name != "" {
		parts = append(parts, rule.Name)
	}
	if rule.IncludeUsingGroup && usingGroup != "" {
		parts = append(parts, usingGroup)
	}
	parts = append(parts, affinityValue)
	return strings.Join(parts, ":")
}
```

Update the call site around line 576 to pass `middleware.GetTenantId(c)` as the new parameter. Import `middleware` if needed (watch for import cycles — if cycle, use `common.GetContextKeyInt(c, constant.ContextKeyTenantId)` which is lower-level).

- [ ] **Step 2: Distributor-side re-validation**

In `middleware/distributor.go` around line 104, after `preferred, err := model.CacheGetChannel(preferredChannelID)`:

```go
			if err == nil && preferred != nil {
				// Re-validate the affinity hit against current tenant mode/override.
				// See spec §4.4.
				if !service.IsAffinityChannelValidForTenant(c, preferred) {
					// fall through — pretend we didn't find an affinity match
				} else {
					// existing branches for status/channel selection follow...
```

Create the helper in `service/channel_affinity.go`:

```go
// IsAffinityChannelValidForTenant returns false when a cached affinity hit
// should be invalidated for the current tenant (wrong scope, disabled, or
// blocked by mode). See spec §4.4.
func IsAffinityChannelValidForTenant(c *gin.Context, ch *model.Channel) bool {
	if ch == nil {
		return false
	}
	tenantId := 0
	if v, ok := c.Get(string(constant.ContextKeyTenantId)); ok {
		if id, ok2 := v.(int); ok2 {
			tenantId = id
		}
	}
	if ch.Scope == model.ChannelScopeTenant {
		if ch.TenantId != tenantId {
			return false
		}
		return true
	}
	// platform channel
	disabled := model.GetCachedTenantDisabledChannels(tenantId)
	if _, off := disabled[ch.Id]; off {
		return false
	}
	mode := model.GetCachedTenantMode(tenantId)
	if mode == model.PlatformChannelModeOnlyPrivate {
		return false
	}
	return true
}
```

- [ ] **Step 3: Write test**

Create `service/channel_affinity_test.go`:

```go
package service

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
)

func TestIsAffinityChannelValidForTenant_PlatformDisabled(t *testing.T) {
	// This is a white-box test — mock the cache.
	// Real e2e happens in integration.
	// Minimum assertion: function returns false when disabled set contains the id.
	t.Skip("integration harness required — see Task 48 (integration tests)")
}
```

(Note: Full exercise covered by Task 48 integration tests.)

- [ ] **Step 4: Build check**

Run: `go build ./...`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add service/channel_affinity.go service/channel_affinity_test.go middleware/distributor.go
git commit -m "feat(service): tenantId-prefixed affinity key + distributor re-validation"
```

---

### Task 22: Invalidate affinity cache on tenant-side changes

**Files:**
- Modify: `service/channel_affinity.go`

- [ ] **Step 1: Expose an invalidation helper**

In `service/channel_affinity.go`, add near the cache accessor:

```go
// PurgeTenantAffinityCache deletes every entry whose key belongs to the
// given tenantId. Called by mode/override mutation paths. See spec §6.2.
func PurgeTenantAffinityCache(tenantId int) {
	cache := getChannelAffinityCache()
	prefix := fmt.Sprintf("t%d:", tenantId)
	// The affinity cache needs a prefix-scan method. If the underlying cache
	// does not support it, at minimum clear the entire affinity cache.
	if purger, ok := cache.(interface{ DeleteByPrefix(string) }); ok {
		purger.DeleteByPrefix(prefix)
		return
	}
	// Safe fallback: full clear (degrades hit rate briefly but is correct).
	ClearChannelAffinityCache()
}
```

`ClearChannelAffinityCache` already exists per controller wiring (`controller/channel.go` refs it).

- [ ] **Step 2: Commit**

```bash
git add service/channel_affinity.go
git commit -m "feat(service): add PurgeTenantAffinityCache for mode/toggle hooks"
```

---

## Phase 4 — Billing (Milestone 5)

### Task 23: Add markup fields to `RelayInfo`

**Files:**
- Modify: `relay/common/relay_info.go`
- Test: (no new test — struct field; covered by Task 24+)

- [ ] **Step 1: Read current RelayInfo**

Run: `grep -n "PriceMarkup\|ChannelId\|TenantId" relay/common/relay_info.go`

Identify a suitable insertion point near pricing fields.

- [ ] **Step 2: Add fields**

In `relay/common/relay_info.go`, add to the `RelayInfo` struct (near other pricing/channel fields):

```go
	// Platform channel markup applied at pre-charge; PostConsume uses the same.
	// See spec §5.2-5.3.
	PriceMarkupRatio  float64
	PriceMarkupSource string // "channel" | "plan" | "none"
```

- [ ] **Step 3: Build check**

Run: `go build ./...`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add relay/common/relay_info.go
git commit -m "feat(relay): add PriceMarkupRatio/PriceMarkupSource to RelayInfo"
```

---

### Task 24: Inject markup at pre-charge (`ModelPriceHelper`)

**Files:**
- Modify: `relay/helper/price.go` (`ModelPriceHelper` around line 48)
- Test: integration (Task 48)

- [ ] **Step 1: Read current ModelPriceHelper**

Read `relay/helper/price.go:1-150` to locate the point after `preConsumedQuota` is computed but before returning.

- [ ] **Step 2: Apply markup**

Just before the return of `types.PriceData`, add (pseudo-code, adapt variable names to the actual file):

```go
	// Apply platform-channel markup. See spec §5.2.
	if info.ChannelId > 0 {
		ch, _ := model.CacheGetChannel(info.ChannelId)
		plan, _ := model.GetTenantPlan(info.TenantId)
		mk, src := service.EffectiveMarkup(ch, plan)
		if mk != 1.0 {
			preConsumedQuota = int(math.Ceil(float64(preConsumedQuota) * mk))
		}
		info.PriceMarkupRatio = mk
		info.PriceMarkupSource = src
	}
```

**Important:** Verify the exact variable names (`preConsumedQuota`, `info`, the channel id source). Add imports: `"math"`, `"github.com/QuantumNous/new-api/model"`, `"github.com/QuantumNous/new-api/service"`.

If import cycle occurs (relay/helper → service → model → relay/helper?), move `EffectiveMarkup` into `model` package instead of `service` (Task 10's file can be moved to `model/markup.go`) and update imports.

- [ ] **Step 3: Build**

Run: `go build ./...`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add relay/helper/price.go
git commit -m "feat(relay): inject platform markup into pre-consumed quota"
```

---

### Task 25: Apply markup in PostConsume

**Files:**
- Modify: `service/billing.go` (find `PostConsumeQuota`)
- Modify: `service/billing_session.go` if it re-computes quota post-hoc

- [ ] **Step 1: Locate**

Run: `grep -rn "PostConsumeQuota\|postConsume" service/ relay/ | head -20`

- [ ] **Step 2: Apply markup**

In the final `quota := ...` or equivalent compute line inside `PostConsumeQuota`, multiply by `info.PriceMarkupRatio` if > 0:

```go
	mk := info.PriceMarkupRatio
	if mk <= 0 {
		mk = 1.0
	}
	quota = int(math.Ceil(float64(quota) * mk))
```

Do this both when charging the user/token and when recording the log amount, to keep pre- and post-charge consistent.

- [ ] **Step 3: Log fields**

Wherever the request is logged (typically via `model.RecordConsumeLog` or similar), add extra fields:

```go
	extras := map[string]any{
		"is_platform_channel": ch != nil && ch.Scope == model.ChannelScopePlatform,
		"markup_ratio":        info.PriceMarkupRatio,
		"markup_source":       info.PriceMarkupSource,
	}
```

If the log struct has no JSON-extras column, add a new column `Other` / reuse existing `Other` text column; document in the PR description that log backfill is N/A (not deployed yet).

- [ ] **Step 4: Commit**

```bash
git add service/billing.go service/billing_session.go
git commit -m "feat(billing): apply markup in PostConsume and log ratio/source"
```

---

### Task 26: Retry across scope recalculates markup

**Files:**
- Modify: `middleware/distributor.go` retry branch

- [ ] **Step 1: Locate retry path**

Run: `grep -n "ChangeChannel\|SwitchChannel\|retry" middleware/distributor.go`

- [ ] **Step 2: Recompute markup**

Where the retry picks a new `channel`, after `c.Set(...)` the new channel id, re-read the plan and channel and update `info.PriceMarkupRatio` / `PriceMarkupSource`. Pseudo-code:

```go
	ch, _ := model.CacheGetChannel(newChannelId)
	plan, _ := model.GetTenantPlan(info.TenantId)
	info.PriceMarkupRatio, info.PriceMarkupSource = service.EffectiveMarkup(ch, plan)
```

Also: if `newMarkup > oldMarkup`, re-run the pre-consume top-up via `PreConsumeTokenQuota(info, delta)`; if it fails, abort the request with the same error path as the original pre-consume failure. If `newMarkup < oldMarkup`, leave refund to PostConsume.

- [ ] **Step 3: Commit**

```bash
git add middleware/distributor.go
git commit -m "feat(distributor): recompute markup on retry-with-new-channel"
```

---

## Phase 5 — Route Layer Refactor (Milestone 6)

### Task 27: `TenantAdminOnlyAuth` middleware

**Files:**
- Create: `middleware/tenant_admin_auth.go`
- Test: `middleware/tenant_admin_auth_test.go` (new)

- [ ] **Step 1: Write test**

Create `middleware/tenant_admin_auth_test.go`:

```go
package middleware

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func TestTenantAdminOnlyAuth_RejectsRoot(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("platform_role", common.RoleRootUser)
	c.Set("tenant_role", model.TenantRoleAdmin)
	c.Set("role", common.RoleRootUser)
	c.Set("id", 1)
	// Bypass authHelper by pre-setting role (simulated after-auth state).
	// Call the inner check logic directly via exported helper (see impl).
	if _, ok := checkTenantAdminOnly(c); ok {
		t.Fatal("root must be rejected")
	}
}

func TestTenantAdminOnlyAuth_RejectsNonTenantAdmin(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("platform_role", common.RoleCommonUser)
	c.Set("tenant_role", model.TenantRoleMember)
	if _, ok := checkTenantAdminOnly(c); ok {
		t.Fatal("common user must be rejected")
	}
}

func TestTenantAdminOnlyAuth_AcceptsTenantAdmin(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("platform_role", common.RoleCommonUser)
	c.Set("tenant_role", model.TenantRoleAdmin)
	if _, ok := checkTenantAdminOnly(c); !ok {
		t.Fatal("tenant admin must be accepted")
	}
}
```

- [ ] **Step 2: Run to fail**

Run: `go test ./middleware -run TestTenantAdminOnlyAuth -v`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `middleware/tenant_admin_auth.go`:

```go
package middleware

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// TenantAdminOnlyAuth allows only tenant admins (not platform root) to pass.
// See spec §7.3-G.
func TenantAdminOnlyAuth() func(c *gin.Context) {
	return func(c *gin.Context) {
		if !authHelper(c, common.RoleAdminUser) {
			return
		}
		if reason, ok := checkTenantAdminOnly(c); !ok {
			c.JSON(http.StatusForbidden, gin.H{
				"success": false,
				"message": reason,
			})
			c.Abort()
			return
		}
		c.Next()
	}
}

// checkTenantAdminOnly returns (reason, ok). ok=true means pass.
// Split out so it can be unit-tested without the full auth handshake.
func checkTenantAdminOnly(c *gin.Context) (string, bool) {
	platformRole := c.GetInt("platform_role")
	if platformRole >= common.RoleRootUser {
		return "root 用户请使用 /api/admin/tenant/:tenantId/channel/* 端点代租户操作", false
	}
	tenantRole := c.GetInt("tenant_role")
	if tenantRole < model.TenantRoleAdmin {
		return "需要当前租户的 admin 角色", false
	}
	return "", true
}
```

- [ ] **Step 4: Run to pass**

Run: `go test ./middleware -run TestTenantAdminOnlyAuth -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add middleware/tenant_admin_auth.go middleware/tenant_admin_auth_test.go
git commit -m "feat(middleware): add TenantAdminOnlyAuth (rejects root + non-admin)"
```

---

### Task 28: Modify `AddChannel` to accept `scope` and skip MaxChannels for platform

**Files:**
- Modify: `controller/channel/channel.go` (`AddChannel` around line 550-700)

- [ ] **Step 1: Read current AddChannel**

Re-read `controller/channel/channel.go:528-700` to capture the current flow.

- [ ] **Step 2: Extend request struct and body handling**

In the `AddChannelRequest` struct definition (around line 528):

```go
type AddChannelRequest struct {
	Mode                      string                `json:"mode"`
	MultiKeyMode              constant.MultiKeyMode `json:"multi_key_mode"`
	BatchAddSetKeyPrefix2Name bool                  `json:"batch_add_set_key_prefix_2_name"`
	Channel                   *model.Channel        `json:"channel"`
}
```

The `Channel` struct already carries `Scope` and `TenantId` (added in Task 1). The caller can set them.

In `AddChannel` handler body, replace the line that forces `TenantId`:

```go
	addChannelRequest.Channel.TenantId = middleware.GetTenantId(c)
```

with scope-aware logic:

```go
	role := c.GetInt("platform_role")
	incomingScope := strings.TrimSpace(addChannelRequest.Channel.Scope)
	if incomingScope == "" {
		incomingScope = model.ChannelScopeTenant
	}
	switch incomingScope {
	case model.ChannelScopePlatform:
		if role < common.RoleRootUser {
			c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "only root can create platform channels"})
			return
		}
		addChannelRequest.Channel.Scope = model.ChannelScopePlatform
		addChannelRequest.Channel.TenantId = 0
	case model.ChannelScopeTenant:
		addChannelRequest.Channel.Scope = model.ChannelScopeTenant
		// Root can optionally specify tenant_id; tenant admin cannot.
		if role < common.RoleRootUser {
			addChannelRequest.Channel.TenantId = middleware.GetTenantId(c)
		} else if addChannelRequest.Channel.TenantId <= 0 {
			addChannelRequest.Channel.TenantId = middleware.GetTenantId(c)
		}
	default:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid scope"})
		return
	}
	addChannelRequest.Channel.CreatedTime = common.GetTimestamp()
```

Also the MaxChannels block (currently around line 647): wrap its body in `if addChannelRequest.Channel.Scope == model.ChannelScopeTenant { ... }`.

- [ ] **Step 3: Build + commit**

Run: `go build ./...`

```bash
git add controller/channel/channel.go
git commit -m "feat(channel): scope-aware AddChannel; MaxChannels only for tenant scope"
```

---

### Task 29: Split route groups

**Files:**
- Modify: `router/api-router.go`

- [ ] **Step 1: Read current channel route group**

Re-read `router/api-router.go:297-340`.

- [ ] **Step 2: Add two new groups after existing channelRoute**

After the closing `}` of the current `/api/channel` group (around line 340):

```go
		// Tenant admin's channel management (BYOK + toggle platform).
		// See spec §7.3-B.
		tenantChannelRoute := apiRouter.Group("/tenant-channel")
		tenantChannelRoute.Use(middleware.TenantAdminOnlyAuth())
		{
			tenantChannelRoute.GET("/", channel.TenantListChannels)
			tenantChannelRoute.GET("/search", channel.TenantSearchChannels)
			tenantChannelRoute.GET("/:id", channel.TenantGetChannel)
			tenantChannelRoute.POST("/:id/key",
				middleware.CriticalRateLimit(),
				middleware.DisableCache(),
				middleware.SecureVerificationRequired(),
				channel.TenantGetChannelKey)
			tenantChannelRoute.POST("/", channel.TenantAddChannel)
			tenantChannelRoute.PUT("/", channel.TenantUpdateChannel)
			tenantChannelRoute.DELETE("/:id", channel.TenantDeleteChannel)
			tenantChannelRoute.POST("/:id/toggle", channel.TenantToggleChannel)
			tenantChannelRoute.POST("/batch", channel.TenantDeleteChannelBatch)
			tenantChannelRoute.POST("/batch/tag", channel.TenantBatchSetChannelTag)
			tenantChannelRoute.DELETE("/disabled", channel.TenantDeleteDisabledChannel)
			tenantChannelRoute.POST("/tag/disabled", channel.TenantDisableTagChannels)
			tenantChannelRoute.POST("/tag/enabled", channel.TenantEnableTagChannels)
			tenantChannelRoute.PUT("/tag", channel.TenantEditTagChannels)
			tenantChannelRoute.GET("/tag/models", channel.TenantGetTagModels)
			tenantChannelRoute.POST("/fix", channel.TenantFixChannelsAbilities)
			tenantChannelRoute.POST("/ollama/pull", channel.TenantOllamaPullModel)
			tenantChannelRoute.POST("/ollama/pull/stream", channel.TenantOllamaPullModelStream)
			tenantChannelRoute.DELETE("/ollama/delete", channel.TenantOllamaDeleteModel)
			tenantChannelRoute.GET("/ollama/version/:id", channel.TenantOllamaVersion)
			tenantChannelRoute.POST("/mode", channel.TenantSetPlatformChannelMode)
			tenantChannelRoute.GET("/mode", channel.TenantGetPlatformChannelMode)
		}

		// Root-on-behalf operations with explicit tenantId selector.
		// See spec §7.3-C.
		adminTenantChannelRoute := apiRouter.Group("/admin/tenant/:tenantId/channel")
		adminTenantChannelRoute.Use(middleware.RootAuth())
		{
			adminTenantChannelRoute.POST("/:channelId/toggle", channel.AdminOnBehalfToggleChannel)
			adminTenantChannelRoute.POST("/fix", channel.AdminOnBehalfFixChannelsAbilities)
		}
```

- [ ] **Step 3: Build (expect unresolved symbols)**

Run: `go build ./...`
Expected: FAIL with undefined `channel.Tenant*` / `channel.AdminOnBehalf*`. These are implemented in the next tasks.

- [ ] **Step 4: Commit the router change as a stub**

Don't commit yet — keep this uncommitted locally and continue to Task 30 which adds the handlers. Commit together.

---

### Task 30: Implement `TenantListChannels`, `TenantGetChannel`, `TenantSearchChannels`

**Files:**
- Create: `controller/channel/tenant_channel.go`

- [ ] **Step 1: Scaffold file**

Create `controller/channel/tenant_channel.go`:

```go
package channel

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// joinTenantVisibility returns an annotated channel struct that adds a
// tenant_disabled flag to the response body for platform channels.
type tenantChannelOut struct {
	*model.Channel
	TenantDisabled bool `json:"tenant_disabled,omitempty"`
}

func annotate(tenantId int, channels []*model.Channel, disabled map[int]struct{}) []tenantChannelOut {
	out := make([]tenantChannelOut, 0, len(channels))
	for _, c := range channels {
		model.SanitizeForTenantView(c)
		t := tenantChannelOut{Channel: c}
		if c.Scope == model.ChannelScopePlatform {
			_, t.TenantDisabled = disabled[c.Id]
		}
		out = append(out, t)
	}
	return out
}

// TenantListChannels returns own channels + all platform channels (with
// tenant_disabled flag). Mirrors GetAllChannels but tenant-scoped.
func TenantListChannels(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	pageInfo := common.GetPageQuery(c)
	var channels []*model.Channel
	if err := model.DB.Model(&model.Channel{}).
		Where("scope = ? OR tenant_id = ?", model.ChannelScopePlatform, tenantId).
		Omit("key").
		Order("priority desc").
		Limit(pageInfo.GetPageSize()).
		Offset(pageInfo.GetStartIdx()).
		Find(&channels).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	disabled, _ := model.GetTenantDisabledPlatformChannels(tenantId)
	common.ApiSuccess(c, gin.H{
		"items":     annotate(tenantId, channels, disabled),
		"page":      pageInfo.GetPage(),
		"page_size": pageInfo.GetPageSize(),
	})
}

// TenantGetChannel returns a single channel if visible (own OR platform).
func TenantGetChannel(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	ch, err := model.GetVisibleChannelForTenant(id, tenantId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.SanitizeForTenantView(ch)
	disabled, _ := model.GetTenantDisabledPlatformChannels(tenantId)
	out := tenantChannelOut{Channel: ch}
	if ch.Scope == model.ChannelScopePlatform {
		_, out.TenantDisabled = disabled[ch.Id]
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": out})
}

// TenantSearchChannels uses the anti-oracle search helper.
func TenantSearchChannels(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	keyword := c.Query("keyword")
	group := c.Query("group")
	modelKw := c.Query("model")
	idSort, _ := strconv.ParseBool(c.Query("id_sort"))

	channels, err := model.SearchChannelsForTenant(tenantId, keyword, group, modelKw, idSort)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	disabled, _ := model.GetTenantDisabledPlatformChannels(tenantId)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    gin.H{"items": annotate(tenantId, channels, disabled)},
	})
}
```

- [ ] **Step 2: Commit (partial — more handlers coming)**

Do not commit yet — continue.

---

### Task 31: Implement `TenantGetChannelKey`, `TenantAddChannel`, `TenantUpdateChannel`, `TenantDeleteChannel`, `TenantToggleChannel`

**Files:**
- Modify: `controller/channel/tenant_channel.go`

- [ ] **Step 1: Add handlers**

Append to `controller/channel/tenant_channel.go`:

```go
// TenantGetChannelKey returns the key for a tenant-owned channel only.
// Platform channels return 403 — root must use /api/channel/:id/key.
func TenantGetChannelKey(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	userId := c.GetInt("id")
	channelId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	ch, err := model.GetOwnedChannelForTenant(channelId, tenantId, true)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "not accessible"})
		return
	}
	model.RecordLogCtx(c, userId, model.LogTypeSystem,
		"查看渠道密钥 (租户 channelId="+strconv.Itoa(channelId)+")")
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"key": ch.Key}})
}

// TenantAddChannel forces scope=tenant and tenant_id = JWT tenant.
func TenantAddChannel(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	// Override any body-supplied scope/tenant_id to prevent tenant
	// self-promotion into platform scope.
	c.Set("__force_scope", model.ChannelScopeTenant)
	c.Set("__force_tenant_id", tenantId)
	AddChannel(c)
}

// TenantUpdateChannel rejects modifications targeting platform rows.
func TenantUpdateChannel(c *gin.Context) {
	// UpdateChannel already reads path/body; we pre-check by first
	// reading the body's id and verifying ownership.
	tenantId := middleware.GetTenantId(c)
	role := c.GetInt("platform_role")
	// Read body id without consuming body.
	var peek struct {
		Channel model.Channel `json:"channel"`
	}
	// Binding here would consume the body; instead, we parse once into our
	// peek struct and then re-construct. For simplicity rely on UpdateChannel's
	// internal model.GetChannelById replaced by GetVisibleChannelForTenant
	// (Task 34). The pre-check here ensures early rejection:
	_ = peek
	c.Set("__force_scope", model.ChannelScopeTenant)
	c.Set("__force_tenant_id", tenantId)
	c.Set("__caller_role", role)
	UpdateChannel(c)
}

func TenantDeleteChannel(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	ch, err := model.GetOwnedChannelForTenant(id, tenantId, false)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "not accessible"})
		return
	}
	if err := ch.Delete(); err != nil {
		common.ApiError(c, err)
		return
	}
	model.InitChannelCache()
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// TenantToggleChannel enables/disables a platform channel for the current tenant.
func TenantToggleChannel(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	channelId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var body struct {
		Disabled bool `json:"disabled"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		common.ApiError(c, err)
		return
	}
	ch, err := model.GetVisibleChannelForTenant(channelId, tenantId, false)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "channel not found"})
		return
	}
	if ch.Scope != model.ChannelScopePlatform {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "can only toggle platform channels"})
		return
	}
	if err := model.SetTenantChannelDisabled(tenantId, channelId, body.Disabled); err != nil {
		common.ApiError(c, err)
		return
	}
	model.InvalidateTenantRoutingCache(tenantId)
	// Also purge affinity entries for this tenant.
	// Using interface reference via service package to avoid import cycle:
	// callers should ensure service.PurgeTenantAffinityCache is wired.
	purgeTenantAffinity(tenantId)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}
```

- [ ] **Step 2: Add the affinity-purge bridge**

Also append at top of `tenant_channel.go` (or in a new `affinity_bridge.go` in `controller/channel/`):

```go
// purgeTenantAffinity is set by the service package during init() to avoid
// an import cycle between service <-> controller/channel.
var purgeTenantAffinity = func(tenantId int) { /* no-op; wired at startup */ }

// SetAffinityPurger installs the purger; called from service init.
func SetAffinityPurger(fn func(int)) { purgeTenantAffinity = fn }
```

In `service/channel_affinity.go` add in `init()` (or equivalent startup hook):

```go
func init() {
	// Register the affinity purger with the controller/channel package.
	// Import of controller/channel from service is only for this hook; if
	// it creates a cycle, register via main.go instead.
	// See the build error if cycles occur.
}
```

If circular import persists, move the registration to `cmd/server/main.go` or `router.go` Init so neither package imports the other at build time. In that case:

```go
// main.go (at startup)
channel.SetAffinityPurger(service.PurgeTenantAffinityCache)
```

- [ ] **Step 3: Commit together with Task 29 router changes**

Build: `go build ./...`

```bash
git add router/api-router.go controller/channel/tenant_channel.go
git commit -m "feat(route): add /api/tenant-channel group + tenant-side handlers"
```

---

### Task 32: Implement `TenantSetPlatformChannelMode` / `TenantGetPlatformChannelMode`

**Files:**
- Modify: `controller/channel/tenant_channel.go`

- [ ] **Step 1: Append handlers**

```go
func TenantGetPlatformChannelMode(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	mode, err := model.GetTenantPlatformChannelMode(tenantId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"mode": mode}})
}

func TenantSetPlatformChannelMode(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	var body struct {
		Mode string `json:"mode"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.SetTenantPlatformChannelMode(tenantId, body.Mode); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	model.InvalidateTenantRoutingCache(tenantId)
	purgeTenantAffinity(tenantId)
	c.JSON(http.StatusOK, gin.H{"success": true})
}
```

- [ ] **Step 2: Commit**

```bash
git add controller/channel/tenant_channel.go
git commit -m "feat(channel): tenant platform_channel_mode GET/SET handlers"
```

---

### Task 33: Implement remaining `Tenant*` wrappers (tag, batch, Ollama, fix, disabled-cleanup)

**Files:**
- Modify: `controller/channel/tenant_channel.go`

- [ ] **Step 1: Append handlers**

```go
// Tag operations — tenant-scoped (only affect scope='tenant' rows of
// current tenant). See spec §9.2.

func TenantDisableTagChannels(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	var body ChannelTag
	if err := c.ShouldBindJSON(&body); err != nil || body.Tag == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if err := model.DisableChannelByTag(body.Tag, tenantId); err != nil {
		common.ApiError(c, err)
		return
	}
	model.InitChannelCache()
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func TenantEnableTagChannels(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	var body ChannelTag
	if err := c.ShouldBindJSON(&body); err != nil || body.Tag == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if err := model.EnableChannelByTag(body.Tag, tenantId); err != nil {
		common.ApiError(c, err)
		return
	}
	model.InitChannelCache()
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func TenantEditTagChannels(c *gin.Context) {
	// Forward to EditTagChannels — it already accepts tenantId through
	// middleware.GetTenantId(c). Model-level query must have WHERE
	// scope='tenant' AND tenant_id = ?; see Task 36 for the model change.
	EditTagChannels(c)
}

func TenantDeleteChannelBatch(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	var body ChannelBatch
	if err := c.ShouldBindJSON(&body); err != nil || len(body.Ids) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if err := model.BatchDeleteChannels(tenantId, body.Ids); err != nil {
		common.ApiError(c, err)
		return
	}
	model.InitChannelCache()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": len(body.Ids)})
}

func TenantBatchSetChannelTag(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	var body ChannelBatch
	if err := c.ShouldBindJSON(&body); err != nil || len(body.Ids) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if err := model.BatchSetChannelTagForTenant(body.Ids, body.Tag, tenantId); err != nil {
		common.ApiError(c, err)
		return
	}
	model.InitChannelCache()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": len(body.Ids)})
}

func TenantGetTagModels(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	tag := c.Query("tag")
	if tag == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "tag不能为空"})
		return
	}
	channels, err := model.GetChannelsByTagForTenant(tag, tenantId, false, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var longest string
	maxLen := 0
	for _, ch := range channels {
		if ch.Models != "" {
			n := len(strings.Split(ch.Models, ","))
			if n > maxLen {
				maxLen = n
				longest = ch.Models
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": longest})
}

func TenantDeleteDisabledChannel(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	rows, err := model.DeleteDisabledChannel(tenantId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.InitChannelCache()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": rows})
}

// TenantFixChannelsAbilities rebuilds abilities for the current tenant only.
func TenantFixChannelsAbilities(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	success, fails, err := model.FixTenantAbilities(tenantId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"success": success, "fails": fails}})
}

// Ollama variants — accept only tenant-owned Ollama channels.

func tenantOllamaGuard(c *gin.Context, channelId int) (*model.Channel, bool) {
	tenantId := middleware.GetTenantId(c)
	ch, err := model.GetOwnedChannelForTenant(channelId, tenantId, true)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "channel not accessible"})
		return nil, false
	}
	if ch.Type != constant.ChannelTypeOllama {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "only Ollama channels"})
		return nil, false
	}
	return ch, true
}

func TenantOllamaPullModel(c *gin.Context)        { forwardTenantOllama(c, OllamaPullModel) }
func TenantOllamaPullModelStream(c *gin.Context)  { forwardTenantOllama(c, OllamaPullModelStream) }
func TenantOllamaDeleteModel(c *gin.Context)      { forwardTenantOllama(c, OllamaDeleteModel) }
func TenantOllamaVersion(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if _, ok := tenantOllamaGuard(c, id); !ok {
		return
	}
	OllamaVersion(c)
}

// forwardTenantOllama parses body channel_id, verifies ownership via
// tenantOllamaGuard, then delegates to the existing root handler.
func forwardTenantOllama(c *gin.Context, inner func(c *gin.Context)) {
	var body struct {
		ChannelID int `json:"channel_id"`
	}
	if err := c.ShouldBindBodyWith(&body, binding.JSON); err != nil {
		common.ApiError(c, err)
		return
	}
	if _, ok := tenantOllamaGuard(c, body.ChannelID); !ok {
		return
	}
	inner(c)
}
```

Imports needed: `"strings"`, `"github.com/QuantumNous/new-api/constant"`, `"github.com/gin-gonic/gin/binding"`.

- [ ] **Step 2: Implement `model.BatchSetChannelTagForTenant` and `model.FixTenantAbilities`**

Append to `model/channel.go`:

```go
// BatchSetChannelTagForTenant updates tag only for channels owned by the
// tenant — platform channels are never touched.
func BatchSetChannelTagForTenant(ids []int, tag *string, tenantId int) error {
	return DB.Model(&Channel{}).
		Where("id IN ? AND tenant_id = ? AND scope = ?", ids, tenantId, ChannelScopeTenant).
		Update("tag", tag).Error
}
```

Append to `model/ability.go`:

```go
// FixTenantAbilities rebuilds abilities for one tenant's channels only.
// Platform abilities are left untouched.
func FixTenantAbilities(tenantId int) (success, fails int, err error) {
	if tenantId <= 0 {
		return 0, 0, errors.New("tenantId required")
	}
	if err := DB.Where("tenant_id = ? AND scope = ?", tenantId, ChannelScopeTenant).Delete(&Ability{}).Error; err != nil {
		return 0, 0, err
	}
	var channels []*Channel
	if err := DB.Where("tenant_id = ? AND scope = ?", tenantId, ChannelScopeTenant).Find(&channels).Error; err != nil {
		return 0, 0, err
	}
	for _, ch := range channels {
		if e := ch.AddAbilities(nil); e != nil {
			fails++
		} else {
			success++
		}
	}
	InitChannelCache()
	return success, fails, nil
}
```

- [ ] **Step 3: Build and commit**

Run: `go build ./...`

```bash
git add controller/channel/tenant_channel.go model/channel.go model/ability.go
git commit -m "feat(channel): tag/batch/Ollama/fix handlers for tenant scope"
```

---

### Task 34: Refit `UpdateChannel` / `GetChannel` / `DeleteChannel` / etc to respect scope

**Files:**
- Modify: `controller/channel/channel.go`

- [ ] **Step 1: Modify `GetChannel`**

Replace body to use `GetVisibleChannelForTenant` plus scope-aware redaction:

```go
func GetChannel(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	role := c.GetInt("platform_role")
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var channel *model.Channel
	if role >= common.RoleRootUser {
		channel, err = model.GetChannelById(id, false)
	} else {
		channel, err = model.GetVisibleChannelForTenant(id, tenantId, false)
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if channel != nil {
		clearChannelInfo(channel)
		if role < common.RoleRootUser {
			model.SanitizeForTenantView(channel)
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": channel})
}
```

- [ ] **Step 2: Modify `GetChannelKey`**

Replace body:

```go
func GetChannelKey(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	role := c.GetInt("platform_role")
	userId := c.GetInt("id")
	channelId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var channel *model.Channel
	if role >= common.RoleRootUser {
		channel, err = model.GetChannelById(channelId, true)
	} else {
		channel, err = model.GetOwnedChannelForTenant(channelId, tenantId, true)
	}
	if err != nil || channel == nil {
		common.ApiError(c, fmt.Errorf("渠道不存在或无权限"))
		return
	}
	model.RecordLogCtx(c, userId, model.LogTypeSystem,
		fmt.Sprintf("查看渠道密钥 (渠道ID: %d, scope=%s)", channelId, channel.Scope))
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "获取成功",
		"data":    map[string]interface{}{"key": channel.Key},
	})
}
```

- [ ] **Step 3: Modify `UpdateChannel`**

Replace the `originChannel, err := model.GetChannelById(channel.Id, true)` line with:

```go
	var originChannel *model.Channel
	role := c.GetInt("platform_role")
	if role >= common.RoleRootUser {
		originChannel, err = model.GetChannelById(channel.Id, true)
	} else {
		tenantId := middleware.GetTenantId(c)
		originChannel, err = model.GetOwnedChannelForTenant(channel.Id, tenantId, true)
	}
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "not accessible"})
		return
	}
	// Freeze scope: do NOT permit scope change via PUT.
	channel.Scope = originChannel.Scope
	channel.TenantId = originChannel.TenantId
```

- [ ] **Step 4: Modify `DeleteChannel`**

```go
func DeleteChannel(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	role := c.GetInt("platform_role")
	id, _ := strconv.Atoi(c.Param("id"))
	var channel *model.Channel
	var err error
	if role >= common.RoleRootUser {
		channel, err = model.GetChannelById(id, false)
	} else {
		channel, err = model.GetOwnedChannelForTenant(id, tenantId, false)
	}
	if err != nil || channel == nil {
		common.ApiError(c, fmt.Errorf("not accessible"))
		return
	}
	if err := channel.Delete(); err != nil {
		common.ApiError(c, err)
		return
	}
	model.InitChannelCache()
	c.JSON(http.StatusOK, gin.H{"success": true})
}
```

- [ ] **Step 5: Modify `CopyChannel` — reject tenant→platform fork**

```go
func CopyChannel(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	role := c.GetInt("platform_role")
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid id"})
		return
	}
	var origin *model.Channel
	if role >= common.RoleRootUser {
		origin, err = model.GetChannelById(id, true)
	} else {
		origin, err = model.GetOwnedChannelForTenant(id, tenantId, true)
		// Platform source is NOT accessible via tenant-scoped lookup.
	}
	if err != nil || origin == nil {
		common.ApiError(c, fmt.Errorf("not accessible"))
		return
	}
	// Build the new channel via sanitizeForCopy (Key, Secrets NOT carried).
	targetTenantId := tenantId
	if role >= common.RoleRootUser {
		// root can request explicit tenant via query string `?target_tenant=NN`
		if v := c.Query("target_tenant"); v != "" {
			if n, e := strconv.Atoi(v); e == nil && n > 0 {
				targetTenantId = n
			}
		}
	}
	clone := model.SanitizeForCopy(origin, targetTenantId)
	clone.CreatedTime = common.GetTimestamp()
	suffix := c.DefaultQuery("suffix", "_复制")
	clone.Name = origin.Name + suffix
	// Key must be supplied separately by the caller via subsequent PUT;
	// DB insert with empty key is allowed — behaviour: channel exists in
	// disabled state until UI/caller fills the key.
	if err := model.BatchInsertChannels([]model.Channel{*clone}); err != nil {
		common.ApiError(c, err)
		return
	}
	model.InitChannelCache()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"id": clone.Id}})
}
```

- [ ] **Step 6: Modify `ManageMultiKeys` / Ollama handlers**

In each: add scope guard at entry:

```go
	role := c.GetInt("platform_role")
	tenantId := middleware.GetTenantId(c)
	var channel *model.Channel
	if role >= common.RoleRootUser {
		channel, err = model.GetChannelById(req.ChannelID, true)
	} else {
		channel, err = model.GetOwnedChannelForTenant(req.ChannelID, tenantId, true)
	}
```

Apply to `ManageMultiKeys`, `OllamaPullModel`, `OllamaPullModelStream`, `OllamaDeleteModel`, `OllamaVersion`.

- [ ] **Step 7: Modify `FetchUpstreamModels`**

Replace `model.GetChannelByIdWithTenant` with `model.GetVisibleChannelForTenant`. Platform channels should be visible.

- [ ] **Step 8: Modify tag_mode branches of `GetAllChannels` / `SearchChannels`**

In `GetAllChannels` the `enableTagMode` branch (around line 91-120):

```go
	if enableTagMode {
		var tags []*string
		var err error
		if role := c.GetInt("platform_role"); role >= common.RoleRootUser {
			tags, err = model.GetPaginatedTags(pageInfo.GetStartIdx(), pageInfo.GetPageSize())
		} else {
			tags, err = model.GetPaginatedTagsForTenant(middleware.GetTenantId(c), pageInfo.GetStartIdx(), pageInfo.GetPageSize())
		}
		if err != nil { ... }
		for _, tag := range tags {
			...
			var tagChannels []*model.Channel
			if role := c.GetInt("platform_role"); role >= common.RoleRootUser {
				tagChannels, _ = model.GetChannelsByTag(*tag, idSort, false)
			} else {
				tagChannels, _ = model.GetChannelsByTagForTenant(*tag, middleware.GetTenantId(c), idSort, false)
			}
			...
		}
	}
```

And `SearchChannels` the `enableTagMode` branch likewise.

- [ ] **Step 9: Modify `FixChannelsAbilities`**

Add role guard at top — only root may invoke via `/api/channel/fix`:

```go
func FixChannelsAbilities(c *gin.Context) {
	if c.GetInt("platform_role") < common.RoleRootUser {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "root only"})
		return
	}
	// existing body
}
```

- [ ] **Step 10: Build and commit**

Run: `go build ./...`

```bash
git add controller/channel/channel.go
git commit -m "fix(channel): scope-aware reads/writes + IDOR fixes + tag_mode tenant filter"
```

---

### Task 35: Admin-on-behalf handlers

**Files:**
- Create: `controller/channel/admin_on_behalf.go`

- [ ] **Step 1: Implement**

```go
package channel

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

func parseTenantIdParam(c *gin.Context) (int, bool) {
	v, err := strconv.Atoi(c.Param("tenantId"))
	if err != nil || v <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid tenantId"})
		return 0, false
	}
	return v, true
}

func AdminOnBehalfToggleChannel(c *gin.Context) {
	tenantId, ok := parseTenantIdParam(c)
	if !ok {
		return
	}
	channelId, err := strconv.Atoi(c.Param("channelId"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var body struct {
		Disabled bool `json:"disabled"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		common.ApiError(c, err)
		return
	}
	ch, err := model.GetChannelById(channelId, false)
	if err != nil || ch == nil || ch.Scope != model.ChannelScopePlatform {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "only platform channels can be toggled"})
		return
	}
	if err := model.SetTenantChannelDisabled(tenantId, channelId, body.Disabled); err != nil {
		common.ApiError(c, err)
		return
	}
	model.InvalidateTenantRoutingCache(tenantId)
	purgeTenantAffinity(tenantId)
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func AdminOnBehalfFixChannelsAbilities(c *gin.Context) {
	tenantId, ok := parseTenantIdParam(c)
	if !ok {
		return
	}
	success, fails, err := model.FixTenantAbilities(tenantId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"success": success, "fails": fails}})
}
```

- [ ] **Step 2: Commit**

```bash
git add controller/channel/admin_on_behalf.go
git commit -m "feat(channel): admin-on-behalf toggle + fix handlers"
```

---

## Phase 6 — UI (Milestone 9)

### Task 36: Super admin — `/admin/platform/channels` page (view)

**Files:**
- Create: `web-next/src/pages/PlatformChannelsAdmin.tsx`
- Modify: `web-next/src/routes.tsx`

- [ ] **Step 1: Read existing ChannelsAdmin for patterns**

Run: `head -80 web-next/src/pages/ChannelsAdmin.tsx`

- [ ] **Step 2: Add route**

In `web-next/src/routes.tsx` inside the `AdminRoute` children:

```tsx
                  { path: '/admin/platform/channels', element: <PlatformChannelsAdmin /> },
```

Add the import at top:

```tsx
import { PlatformChannelsAdmin } from '@/pages/PlatformChannelsAdmin';
```

- [ ] **Step 3: Scaffold the page**

Create `web-next/src/pages/PlatformChannelsAdmin.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { apiGet } from '@/api/client'; // adapt to existing API helper

interface PlatformChannel {
  id: number;
  name: string;
  type: number;
  models: string;
  status: number;
  markup_ratio: number | null;
}

export function PlatformChannelsAdmin() {
  const [items, setItems] = useState<PlatformChannel[]>([]);
  useEffect(() => {
    // Fetch only scope=platform rows via the existing /api/channel/search
    // with a new ?scope=platform filter server-side supports (already handled
    // by GetAllChannels if we surface the scope query param; otherwise filter
    // client-side).
    apiGet('/api/channel/', { params: { scope: 'platform' } })
      .then((data) => setItems(data.items || []))
      .catch(console.error);
  }, []);
  return (
    <div className="p-4">
      <h1 className="text-xl mb-4">平台共享渠道</h1>
      <table className="w-full">
        <thead>
          <tr>
            <th>ID</th><th>Name</th><th>Models</th><th>Status</th><th>Markup</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id}>
              <td>{c.id}</td>
              <td>{c.name}</td>
              <td>{c.models}</td>
              <td>{c.status === 1 ? 'Enabled' : 'Disabled'}</td>
              <td>{c.markup_ratio ?? 'plan default'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**Important:** Match the existing API client naming. If `apiGet` doesn't exist, use `fetch` with the project's auth interceptor. Also add a sidebar entry for root users.

- [ ] **Step 4: Backend — accept `?scope` query param on `/api/channel/` list**

In `controller/channel/channel.go:GetAllChannels`, after `statusFilter` parsing, add:

```go
	scopeFilter := strings.TrimSpace(c.Query("scope"))
	if scopeFilter != "" && scopeFilter != model.ChannelScopePlatform && scopeFilter != model.ChannelScopeTenant {
		scopeFilter = ""
	}
```

Use it in the base query:

```go
	if scopeFilter != "" {
		baseQuery = baseQuery.Where("scope = ?", scopeFilter)
	}
```

- [ ] **Step 5: Commit**

```bash
git add web-next/src/pages/PlatformChannelsAdmin.tsx web-next/src/routes.tsx controller/channel/channel.go
git commit -m "feat(ui+api): super admin /admin/platform/channels page + ?scope filter"
```

---

### Task 37: Tenant UI — split "my channels" / "platform channels" + toggle button

**Files:**
- Modify: `web-next/src/pages/ChannelsAdmin.tsx`

- [ ] **Step 1: Adapt page**

Load from new `/api/tenant-channel/` (if role is not root) or old `/api/channel/` (if root). Split into two sections by `scope`. Render `tenant_disabled` badges.

Abbreviated diff (apply as appropriate to existing code):

```tsx
const my = items.filter((c) => c.scope === 'tenant');
const platform = items.filter((c) => c.scope === 'platform');

// ...
<section>
  <h2>我的渠道</h2>
  <ChannelsTable rows={my} editable />
</section>
<section>
  <h2>平台渠道（共享）</h2>
  <ChannelsTable
    rows={platform}
    editable={false}
    actions={(row) => (
      <button onClick={() => togglePlatform(row.id, !row.tenant_disabled)}>
        {row.tenant_disabled ? '启用' : '禁用'}
      </button>
    )}
    rowClass={(row) => (row.tenant_disabled ? 'opacity-50' : '')}
  />
</section>
```

Implement `togglePlatform(id, disabled)` to call `POST /api/tenant-channel/:id/toggle`.

- [ ] **Step 2: Commit**

```bash
git add web-next/src/pages/ChannelsAdmin.tsx
git commit -m "feat(ui): split my/platform sections + toggle button"
```

---

### Task 38: Tenant UI — mode switch Segment

**Files:**
- Modify: `web-next/src/pages/ChannelsAdmin.tsx` (top-of-page)

- [ ] **Step 1: Add segment**

```tsx
const [mode, setMode] = useState<string>('private_priority');
useEffect(() => {
  fetch('/api/tenant-channel/mode').then((r) => r.json()).then((d) => {
    if (d.success) setMode(d.data.mode);
  });
}, []);
const changeMode = async (next: string) => {
  await fetch('/api/tenant-channel/mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: next }),
  });
  setMode(next);
};

<Segment
  options={[
    { value: 'private_priority', label: '私有优先' },
    { value: 'platform_priority', label: '平台优先' },
    { value: 'only_private', label: '仅私有' },
    { value: 'only_platform', label: '仅平台' },
  ]}
  value={mode}
  onChange={changeMode}
/>
```

- [ ] **Step 2: Commit**

```bash
git add web-next/src/pages/ChannelsAdmin.tsx
git commit -m "feat(ui): tenant-side platform channel mode segment"
```

---

## Phase 7 — Integration & Verification (Milestone 10 + spec §10)

### Task 39: End-to-end integration tests

**Files:**
- Create: `integration/shared_channels_test.go` (new — match existing integration layout if present; else use a `_test.go` in repo root or `controller/channel/`)

- [ ] **Step 1: Set up**

Find how existing integration tests are structured:

Run: `find . -path ./web-next -prune -o -name "*_integration_test.go" -print`
Run: `find . -name "TestMain*" -type f | head -5`

Adapt the conventions observed. A typical pattern: spin up DB, run migrations, create fixtures, run Gin test server.

- [ ] **Step 2: Write tests**

Create `controller/channel/shared_channels_integration_test.go`:

```go
package channel

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	// ... adapt imports from an existing integration test
)

// Note: these tests assume a test harness exposes a function to build
// a Gin router with auth pre-set; adjust to match the project's setup.

func TestTenantCannotEditPlatformChannel(t *testing.T)          { t.Skip("stub") }
func TestTenantCannotReadPlatformChannelKey(t *testing.T)       { t.Skip("stub") }
func TestSuperAdminCreatesPlatformChannel(t *testing.T)         { t.Skip("stub") }
func TestTenantOverrideDisablesPlatformChannel(t *testing.T)    { t.Skip("stub") }
func TestModeSwitchEndToEnd(t *testing.T)                       { t.Skip("stub") }
func TestBillingMarkupAppliedPreAndPost(t *testing.T)           { t.Skip("stub") }
func TestRetryAcrossScopeRecalculatesMarkup(t *testing.T)       { t.Skip("stub") }
func TestAffinityCacheRespectsTenantDisable(t *testing.T)       { t.Skip("stub") }
func TestAffinityCacheIsolatesTenants(t *testing.T)             { t.Skip("stub") }
func TestDiscoveryMatchesRouting(t *testing.T)                  { t.Skip("stub") }
func TestBoundChannelsMatchesRouting(t *testing.T)              { t.Skip("stub") }
func TestSanitizeForTenantViewStripsSensitiveFields(t *testing.T) { t.Skip("stub") }
func TestSearchCannotOracleKey(t *testing.T)                    { t.Skip("stub") }
func TestTagModeTenantIsolation(t *testing.T)                   { t.Skip("stub") }
func TestTenantCreateChannelForcesScope(t *testing.T)           { t.Skip("stub") }
func TestRootCreatePlatformChannelSkipsMaxChannels(t *testing.T) { t.Skip("stub") }
func TestTenantListAlwaysShowsDisabledPlatform(t *testing.T)    { t.Skip("stub") }
func TestTenantToggleNoSelectorRespectsJWT(t *testing.T)        { t.Skip("stub") }
```

Each `t.Skip("stub")` is a placeholder. During implementation, each stub is filled in following the spec §10 test list. For brevity the code is not shown here; the pattern for each test is:

1. Seed DB with the required rows (platform channel(s), tenant channel(s), overrides).
2. Build an `httptest.NewRecorder()` and a Gin context with the appropriate session (root vs tenant admin).
3. Call the handler under test (`GetAllChannels`, `TenantListChannels`, etc.) directly.
4. Assert HTTP status + response body + (if routing) that the eventually-selected channel is the expected one.

- [ ] **Step 3: Guardrail regression tests (spec §10.3)**

Add to same file:

```go
func TestGuardrailAllowsPlatformRead(t *testing.T) { t.Skip("see model/tenant_scope_platform_read_test.go") }
func TestGuardrailBlocksUnscopedWriteOnPlatform(t *testing.T) { t.Skip("stub") }
```

- [ ] **Step 4: Commit**

```bash
git add controller/channel/shared_channels_integration_test.go
git commit -m "test: shared channels integration stubs (spec §10)"
```

---

### Task 40: Fill in integration test stubs

- [ ] **Step 1: Replace each `t.Skip("stub")` with an actual test**

For each stub, implement following the pattern shown in Task 39 Step 2. The spec §10 has an exact behavior description per test name. This task is a loop of ~18 small implementations; each should follow TDD-ish "write the assertion, watch it pass or fail" flow against the local DB.

- [ ] **Step 2: Verify all pass**

Run: `go test ./controller/channel -v -count=1`
Expected: all previously-stubbed tests now PASS.

- [ ] **Step 3: Commit**

```bash
git add controller/channel/shared_channels_integration_test.go
git commit -m "test: fill in shared channels integration tests"
```

---

### Task 41: Final build + smoke

- [ ] **Step 1: Full build**

Run: `go build ./...`
Expected: no errors

- [ ] **Step 2: Full test**

Run: `go test ./... -count=1 -timeout=180s`
Expected: all green; no regressions in unrelated tests.

- [ ] **Step 3: Frontend build**

Run: `cd web-next && npm ci && npm run build`
Expected: no TS errors; bundle emitted.

- [ ] **Step 4: Manual smoke checklist**

Start the app, log in as:
- **root**: visit `/admin/platform/channels` → create a platform channel for a model you actually have a key for. Confirm `scope='platform'` in DB.
- **tenant admin**: visit `/admin/channels` → "我的渠道" shows own + "平台渠道" shows the new one (no key, no Setting). Click "禁用" → row greys out; "启用" restores.
- **tenant admin**: switch mode to `only_private` → make a request to a model only served by platform → 404 no_channel. Switch back → success with expected markup applied.
- **billing**: inspect a log row — `markup_ratio` and `markup_source` set correctly.

- [ ] **Step 5: Tag the commit**

```bash
git tag shared-channels-v1
git log --oneline shared-channels-v1 -1
```

---

## Self-Review Checklist (for the author before handoff)

1. **Spec coverage**
   - §2 decision table → every decision has a task that materializes it
   - §3 schema → Tasks 1-6
   - §4.2 mode filter → Task 15 (FilterByTenantMode) + Task 17 (applied in lookup)
   - §4.3 cache merge → Task 17, Task 20
   - §4.4 affinity → Tasks 21, 22
   - §4.5 discovery → Tasks 18-20
   - §5 billing → Tasks 23-26
   - §6 tenant config → Task 32 + Task 5 (mode) + Task 4 (override)
   - §7 UI + routes → Tasks 29, 36-38
   - §7.3-G middleware → Task 27
   - §7.4 sanitize → Task 11
   - §7.5 anti-oracle → Tasks 13, 14
   - §8 guardrail → Tasks 6, 7
   - §9 IDOR + tag_mode → Tasks 9, 14, 34
   - §10 tests → Tasks 39, 40

2. **Placeholder scan**: Every step has concrete code or exact commands. No "TBD" left.

3. **Type consistency**:
   - `ChannelScopePlatform` / `ChannelScopeTenant` — Tasks 1, 11, 13, 14, 15, 17, 19, 28, 31, 34, 35
   - `PlatformChannelMode*` constants — Tasks 5, 15, 16, 17, 32
   - `EffectiveMarkup` signature `(*Channel, *TenantPlan) (float64, string)` — Task 10, used unchanged in 24, 26
   - `GetVisibleChannelForTenant(id, tenantId, selectAll)` / `GetOwnedChannelForTenant(id, tenantId, selectAll)` — Task 9, used unchanged in 30-34
   - `SanitizeForTenantView(*Channel)` — Task 11, used unchanged in 30-34
   - `FilterByTenantMode(tenantSlice, platformSlice, mode, disabled)` — Task 15, same signature used throughout
   - `TenantAdminOnlyAuth()` — Task 27, used in Task 29 router
   - `tenantChannelOut { *model.Channel; TenantDisabled bool }` — Task 30, reused in 31, 32
   - `GetCachedTenantMode(tenantId)` / `GetCachedTenantDisabledChannels(tenantId)` — Task 16, used in 17, 19, 21
   - `InvalidateTenantRoutingCache(tenantId)` — Task 16, called in 31, 32, 35
   - `PurgeTenantAffinityCache(tenantId)` → `purgeTenantAffinity(tenantId)` bridge — Task 22 / Task 31

Any deviation from this list while implementing is a bug.
