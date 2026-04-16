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
	if ginCtx, ok := ctx.(interface{ Get(string) (interface{}, bool) }); ok {
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
//   - Does not cover Raw/Exec or DB.Table() paths
func RegisterTenantCallbacks(db *gorm.DB) {
	RegisterTenantScopedTable("users")
	RegisterTenantScopedTable("channels")
	RegisterTenantScopedTable("tokens")
	RegisterTenantScopedTable("logs")
	RegisterTenantScopedTable("abilities")

	// Create: fail-closed (reject if tenant_id missing)
	db.Callback().Create().Before("gorm:create").Register("tenant:guard_create", tenantGuardCreate)
	// Query/Update/Delete: warn if tenant-scoped table accessed without tenant_id in WHERE
	// These are detect-and-warn in Phase 1 (not blocking), to avoid breaking existing code paths.
	db.Callback().Query().Before("gorm:query").Register("tenant:warn_query", tenantWarnMissingScope)
	db.Callback().Update().Before("gorm:update").Register("tenant:warn_update", tenantWarnMissingScope)
	db.Callback().Delete().Before("gorm:delete").Register("tenant:warn_delete", tenantWarnMissingScope)
}

// tenantWarnMissingScope logs a warning when a tenant-scoped table is queried/updated/deleted
// without an explicit tenant_id condition. Phase 1: warn only, not blocking.
func tenantWarnMissingScope(db *gorm.DB) {
	if db.Statement.Schema == nil {
		return
	}
	if !IsTenantScoped(db.Statement.Schema.Table) {
		return
	}
	if isTenantBypassed(db) {
		return
	}
	// Check if tenant_id is present in the SQL being built.
	// Heuristic: check if "tenant_id" appears in any existing WHERE clause.
	// This is a best-effort detection, not a guarantee.
	sql := db.Statement.SQL.String()
	if sql != "" && !strings.Contains(sql, "tenant_id") {
		common.SysLog(fmt.Sprintf("[tenant-guardrail] WARNING: %s accessed without tenant_id scope (table=%s)", db.Statement.Schema.Table, db.Statement.Schema.Table))
	}
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
		tenantId := TenantIDFromContext(db.Statement.Context)
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
