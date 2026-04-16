package model

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"gorm.io/gorm"
)

// tenantScopedTables tracks which table names require tenant isolation.
var tenantScopedTables sync.Map

// RegisterTenantScopedTable marks a table name as tenant-scoped.
func RegisterTenantScopedTable(tableName string) {
	tenantScopedTables.Store(tableName, true)
}

// IsTenantScoped returns true if the table requires tenant isolation.
func IsTenantScoped(tableName string) bool {
	_, ok := tenantScopedTables.Load(tableName)
	return ok
}

// TenantIDFromContext extracts tenant_id from context.
// Returns DefaultTenantId if not set.
//
// Checks in order:
//  1. gin.Context.Get (when ctx is a *gin.Context passed as interface)
//  2. context.Value with typed key (constant.ContextKeyTenantId)
//     — this is the path that c.Request.Context() takes after TenantResolve injects it
//  3. context.Value with string key (fallback)
func TenantIDFromContext(ctx context.Context) int {
	if ctx == nil {
		return DefaultTenantId
	}
	// Path 1: gin.Context (when passed directly)
	if ginCtx, ok := ctx.(interface {
		Get(string) (interface{}, bool)
	}); ok {
		if tid, exists := ginCtx.Get(string(constant.ContextKeyTenantId)); exists {
			if id, ok := tid.(int); ok && id > 0 {
				return id
			}
		}
	}
	// Path 2: standard context with typed key (from context.WithValue in TenantResolve)
	if tid := ctx.Value(constant.ContextKeyTenantId); tid != nil {
		if id, ok := tid.(int); ok && id > 0 {
			return id
		}
	}
	// Path 3: standard context with string key (fallback)
	if tid := ctx.Value(string(constant.ContextKeyTenantId)); tid != nil {
		if id, ok := tid.(int); ok && id > 0 {
			return id
		}
	}
	return DefaultTenantId
}

// TenantDB returns a *gorm.DB scoped to the given tenant from context.
// Usage: TenantDB(c).Find(&users)
func TenantDB(ctx context.Context) *gorm.DB {
	tenantId := TenantIDFromContext(ctx)
	return DB.Where("tenant_id = ?", tenantId)
}

// TenantLOGDB returns a *gorm.DB for the log database scoped to the given tenant.
func TenantLOGDB(ctx context.Context) *gorm.DB {
	tenantId := TenantIDFromContext(ctx)
	return LOG_DB.Where("tenant_id = ?", tenantId)
}

// ApplyTenantScope adds tenant_id = ? to an existing query.
func ApplyTenantScope(db *gorm.DB, tenantId int) *gorm.DB {
	if tenantId <= 0 {
		return db // bypass
	}
	return db.Where("tenant_id = ?", tenantId)
}

// BypassTenant returns a plain *gorm.DB without tenant filtering.
// Use ONLY for super-admin cross-tenant queries, migrations, and bootstrap.
func BypassTenant(db *gorm.DB) *gorm.DB {
	return db
}

// GetUserTenantId looks up the tenant_id for a given userId.
// Used when logging from model-layer code that lacks gin.Context.
// Falls back to DefaultTenantId on error.
func GetUserTenantId(userId int) int {
	if userId <= 0 {
		return DefaultTenantId
	}
	var tenantId int
	err := WithTenantBypass(DB).Model(&User{}).Where("id = ?", userId).Select("tenant_id").Scan(&tenantId).Error
	if err != nil || tenantId <= 0 {
		return DefaultTenantId
	}
	return tenantId
}

// explicitTenantIDFromContext extracts tenant_id from context WITHOUT default fallback.
// Returns 0 if the context does not explicitly carry a tenant_id.
// This is used by guardrail callbacks where DefaultTenantId fallback would be dangerous
// (e.g., silently rewriting queries for tenant 2+ into tenant 1).
func ExplicitTenantIDFromContext(ctx context.Context) int {
	if ctx == nil {
		return 0
	}
	// Path 1: gin.Context (when passed directly)
	if ginCtx, ok := ctx.(interface {
		Get(string) (interface{}, bool)
	}); ok {
		if tid, exists := ginCtx.Get(string(constant.ContextKeyTenantId)); exists {
			if id, ok := tid.(int); ok && id > 0 {
				return id
			}
		}
	}
	// Path 2: standard context with typed key (from context.WithValue in TenantResolve)
	if tid := ctx.Value(constant.ContextKeyTenantId); tid != nil {
		if id, ok := tid.(int); ok && id > 0 {
			return id
		}
	}
	// Path 3: standard context with string key (fallback)
	if tid := ctx.Value(string(constant.ContextKeyTenantId)); tid != nil {
		if id, ok := tid.(int); ok && id > 0 {
			return id
		}
	}
	// No tenant found — return 0, NOT DefaultTenantId
	return 0
}

// ---------- GORM guardrail callbacks ----------

// tenantBypassKey is set on GORM statement settings to explicitly skip tenant guardrails.
const tenantBypassKey = "tenant:bypass"

// WithTenantBypass marks a GORM session as explicitly bypassing tenant guardrails.
// Use ONLY for migrations, bootstrap, and super-admin cross-tenant operations.
func WithTenantBypass(db *gorm.DB) *gorm.DB {
	return db.Set(tenantBypassKey, true)
}

func isTenantBypassed(db *gorm.DB) bool {
	if val, ok := db.Statement.Settings.Load(tenantBypassKey); ok {
		if b, ok := val.(bool); ok && b {
			return true
		}
	}
	return false
}

// RegisterTenantCallbacks registers GORM callbacks for tenant-scoped models.
// Behavior:
//   - Create: auto-fill tenant_id from context, then fail-closed if still 0
//   - Query/Update/Delete: fail-closed — reject if tenant_id missing in WHERE clause
//   - Does not cover Raw/Exec or DB.Table() paths — those must use explicit tenant helpers
func RegisterTenantCallbacks(db *gorm.DB) {
	// Phase 1 tables
	RegisterTenantScopedTable("users")
	RegisterTenantScopedTable("channels")
	RegisterTenantScopedTable("tokens")
	RegisterTenantScopedTable("logs")
	RegisterTenantScopedTable("abilities")

	// Phase 2 tables — financial
	RegisterTenantScopedTable("top_ups")
	RegisterTenantScopedTable("redemptions")
	RegisterTenantScopedTable("subscription_plans")
	RegisterTenantScopedTable("subscription_orders")
	RegisterTenantScopedTable("user_subscriptions")
	RegisterTenantScopedTable("subscription_pre_consume_records")

	// Phase 2 tables — invoicing
	RegisterTenantScopedTable("invoice_applications")
	RegisterTenantScopedTable("invoice_items")
	RegisterTenantScopedTable("invoice_uploads")
	RegisterTenantScopedTable("invoice_files")

	// Phase 2 tables — tickets
	RegisterTenantScopedTable("tickets")
	RegisterTenantScopedTable("ticket_replies")
	RegisterTenantScopedTable("ticket_attachments")
	RegisterTenantScopedTable("ticket_uploads")

	// Phase 2 tables — affiliate
	RegisterTenantScopedTable("aff_rebate_logs")
	RegisterTenantScopedTable("aff_transfer_requests")

	// Phase 2 tables — messaging
	RegisterTenantScopedTable("messages")
	RegisterTenantScopedTable("message_read_statuses")

	// Phase 2 tables — analytics & audit
	RegisterTenantScopedTable("user_ip_records")
	RegisterTenantScopedTable("quota_data")
	RegisterTenantScopedTable("agent_logs")
	RegisterTenantScopedTable("agent_reports")

	// Phase 3 tables — membership
	RegisterTenantScopedTable("tenant_memberships")

	// Phase 7 tables — alert persistence
	RegisterTenantScopedTable("tenant_alert_records")

	// Phase 5 tables — billing persistence
	RegisterTenantScopedTable("tenant_bills")
	RegisterTenantScopedTable("tenant_ledgers")

	// Create: fail-closed (reject if tenant_id missing)
	db.Callback().Create().Before("gorm:create").Register("tenant:guard_create", tenantGuardCreate)
	// Query/Update/Delete: fail-closed (reject if tenant_id not in WHERE clause)
	// Phase 1.5 upgrade: from warn-only to blocking for tenant-scoped tables.
	db.Callback().Query().Before("gorm:query").Register("tenant:guard_query", tenantGuardScope)
	db.Callback().Update().Before("gorm:update").Register("tenant:guard_update", tenantGuardScope)
	db.Callback().Delete().Before("gorm:delete").Register("tenant:guard_delete", tenantGuardScope)
}

// tenantGuardScope enforces tenant_id scope on query/update/delete for tenant-scoped tables.
//
// Phase 2 behavior（已从 warn-only 升级为 fail-closed）:
//   - If WHERE clause already contains tenant_id → allow
//   - If context *explicitly* carries tenant_id (not default fallback) → auto-inject and allow
//   - Otherwise → **reject the operation** (db.AddError) and log ERROR
//
// Key design choice: uses explicitTenantIDFromContext (returns 0 when no tenant set)
// instead of TenantIDFromContext (returns DefaultTenantId). This prevents silently
// rewriting queries to tenant_id=1 when Statement.Context is context.Background().
//
// Bypass: use WithTenantBypass(db) for admin cross-tenant operations.
func tenantGuardScope(db *gorm.DB) {
	if db.Statement.Schema == nil {
		return
	}
	if !IsTenantScoped(db.Statement.Schema.Table) {
		return
	}
	if isTenantBypassed(db) {
		return
	}

	// Check 1: tenant_id already in built SQL (in a WHERE position, not SELECT)
	// The SQL string at this point contains only WHERE/JOIN conditions, not SELECT columns,
	// because GORM builds SELECT separately. But to be safe, we also check the WHERE clause
	// object directly below.
	sql := db.Statement.SQL.String()
	if sql != "" && strings.Contains(sql, "tenant_id") {
		return
	}

	// Check 2: inspect only the WHERE clause for tenant_id reference.
	// This avoids false positives from Select("tenant_id") or other non-WHERE clauses.
	if whereClause, ok := db.Statement.Clauses["WHERE"]; ok {
		expr := fmt.Sprintf("%v", whereClause.Expression)
		if strings.Contains(expr, "tenant_id") {
			return
		}
	}

	// Check 3: try auto-inject from context — but ONLY if context explicitly has tenant_id.
	// explicitTenantIDFromContext returns 0 (not DefaultTenantId) when no tenant key is set.
	// This prevents context.Background() from being misinterpreted as "tenant 1".
	if ctx := db.Statement.Context; ctx != nil {
		if tenantId := ExplicitTenantIDFromContext(ctx); tenantId > 0 {
			db.Where("tenant_id = ?", tenantId)
			return
		}
	}

	// Phase 2 fail-closed：记录 ERROR + 拒绝操作。
	// 调用方需要：走 TenantDB(ctx) / 显式 .Where("tenant_id = ?", id) /
	// 或用 WithTenantBypass() 为管理员跨租户操作明确开闸。
	op := "QUERY"
	switch db.Statement.BuildClauses[0] {
	case "UPDATE":
		op = "UPDATE"
	case "DELETE":
		op = "DELETE"
	}
	msg := fmt.Sprintf("[tenant-guardrail] UNSCOPED %s REJECTED: table=%s accessed without tenant_id in WHERE. "+
		"Fix: use TenantDB(ctx), add .Where(\"tenant_id = ?\", id), or WithTenantBypass() for admin ops.",
		op, db.Statement.Schema.Table)
	common.SysError(msg)
	_ = db.AddError(fmt.Errorf("tenant guardrail: refusing unscoped %s on %s (use WithTenantBypass to override)",
		op, db.Statement.Schema.Table))
}

// tenantGuardCreate auto-fills tenant_id from context, then rejects the insert
// if tenant_id is still 0 (fail-closed) unless explicitly bypassed.
func tenantGuardCreate(db *gorm.DB) {
	if db.Statement.Schema == nil {
		return
	}
	if !IsTenantScoped(db.Statement.Schema.Table) {
		return
	}
	if isTenantBypassed(db) {
		return
	}
	field := db.Statement.Schema.LookUpField("tenant_id")
	if field == nil {
		return
	}

	// Phase 1: auto-fill from context if current value is 0
	val, isZero := field.ValueOf(db.Statement.Context, db.Statement.ReflectValue)
	currentTenantId := 0
	switch v := val.(type) {
	case int:
		currentTenantId = v
	case int64:
		currentTenantId = int(v)
	}

	if isZero || currentTenantId == 0 {
		// Use ExplicitTenantIDFromContext (returns 0 for context.Background())
		// instead of TenantIDFromContext (returns DefaultTenantId).
		// This prevents DB.Create() without request context from silently
		// writing records into tenant 1.
		tenantId := ExplicitTenantIDFromContext(db.Statement.Context)
		if tenantId > 0 {
			_ = field.Set(db.Statement.Context, db.Statement.ReflectValue, tenantId)
			currentTenantId = tenantId
		}
	}

	// Phase 2: fail-closed — reject if tenant_id is still 0
	// Re-read after potential autofill
	if currentTenantId == 0 {
		val2, _ := field.ValueOf(db.Statement.Context, db.Statement.ReflectValue)
		switch v := val2.(type) {
		case int:
			currentTenantId = v
		case int64:
			currentTenantId = int(v)
		}
	}
	if currentTenantId == 0 {
		_ = db.AddError(fmt.Errorf("tenant guardrail: refusing to create %s row without tenant_id (use WithTenantBypass to override)", db.Statement.Schema.Table))
	}
}
