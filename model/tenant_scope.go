package model

import (
	"context"
	"fmt"
	"reflect"
	"regexp"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

// tenantScopedTables 记录需要租户隔离的表名集合。
var tenantScopedTables sync.Map

// RegisterTenantScopedTable 把一张表标记为"租户隔离"，之后 guardrail 会对它生效。
func RegisterTenantScopedTable(tableName string) {
	tenantScopedTables.Store(tableName, true)
}

// IsTenantScoped 判断一张表是否已注册为租户隔离表。
func IsTenantScoped(tableName string) bool {
	_, ok := tenantScopedTables.Load(tableName)
	return ok
}

// TenantIDFromContext 从 context 中读取 tenant_id。
// 读不到时返回 DefaultTenantId（默认租户兜底，给"非 guardrail"路径用的宽松版）。
//
// 查找顺序：
//  1. gin.Context.Get（当 ctx 作为 interface 传入、底层是 *gin.Context 时）
//  2. context.Value 使用 typed key（constant.ContextKeyTenantId）
//     —— TenantResolve 中间件把 tenant_id 写到 c.Request.Context() 后走这条路
//  3. context.Value 使用 string key（兜底）
func TenantIDFromContext(ctx context.Context) int {
	if ctx == nil {
		return DefaultTenantId
	}
	// Path 1：直接传进来的 gin.Context
	if ginCtx, ok := ctx.(interface {
		Get(string) (interface{}, bool)
	}); ok {
		if tid, exists := ginCtx.Get(string(constant.ContextKeyTenantId)); exists {
			if id, ok := tid.(int); ok && id > 0 {
				return id
			}
		}
	}
	// Path 2：标准 context + typed key（TenantResolve 里 context.WithValue 写入）
	if tid := ctx.Value(constant.ContextKeyTenantId); tid != nil {
		if id, ok := tid.(int); ok && id > 0 {
			return id
		}
	}
	// Path 3：标准 context + string key（兜底）
	if tid := ctx.Value(string(constant.ContextKeyTenantId)); tid != nil {
		if id, ok := tid.(int); ok && id > 0 {
			return id
		}
	}
	return DefaultTenantId
}

// TenantDB 根据 context 里的租户返回一个已作用域化的 *gorm.DB。
// 用法：TenantDB(c).Find(&users)
func TenantDB(ctx context.Context) *gorm.DB {
	tenantId := TenantIDFromContext(ctx)
	return DB.Where("tenant_id = ?", tenantId)
}

// TenantLOGDB 针对日志库（LOG_DB）返回一个已按租户作用域化的 *gorm.DB。
func TenantLOGDB(ctx context.Context) *gorm.DB {
	tenantId := TenantIDFromContext(ctx)
	return LOG_DB.Where("tenant_id = ?", tenantId)
}

// ApplyTenantScope 给已有的查询链追加 tenant_id = ? 条件。
func ApplyTenantScope(db *gorm.DB, tenantId int) *gorm.DB {
	if tenantId <= 0 {
		return db // tenantId 非法，不加条件
	}
	return db.Where("tenant_id = ?", tenantId)
}

// BypassTenant 返回一个"不做租户过滤"的 *gorm.DB。
// 仅用于超级管理员跨租户查询、数据迁移、系统 bootstrap 场景。
func BypassTenant(db *gorm.DB) *gorm.DB {
	return db
}

// GetUserTenantId 根据 userId 反查其归属的 tenant_id。
// 主要给 model 层代码使用（那里通常拿不到 gin.Context），出错时兜底到 DefaultTenantId。
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

// ExplicitTenantIDFromContext 严格版：只从 context 里读"显式"写入的 tenant_id，
// 读不到时返回 0（而不是 DefaultTenantId）。
// guardrail callback 必须使用这个版本 —— 否则 context.Background() 的查询会被
// 悄悄改写成 tenant_id=1，跨租户泄漏就发生了。
func ExplicitTenantIDFromContext(ctx context.Context) int {
	if ctx == nil {
		return 0
	}
	// Path 1：直接传进来的 gin.Context
	if ginCtx, ok := ctx.(interface {
		Get(string) (interface{}, bool)
	}); ok {
		if tid, exists := ginCtx.Get(string(constant.ContextKeyTenantId)); exists {
			if id, ok := tid.(int); ok && id > 0 {
				return id
			}
		}
	}
	// Path 2：标准 context + typed key（TenantResolve 里 context.WithValue 写入）
	if tid := ctx.Value(constant.ContextKeyTenantId); tid != nil {
		if id, ok := tid.(int); ok && id > 0 {
			return id
		}
	}
	// Path 3：标准 context + string key（兜底）
	if tid := ctx.Value(string(constant.ContextKeyTenantId)); tid != nil {
		if id, ok := tid.(int); ok && id > 0 {
			return id
		}
	}
	// 没有任何地方设置过租户 —— 返回 0，绝对不能返回 DefaultTenantId
	return 0
}

// ---------- GORM guardrail callback 实现 ----------

// tenantBypassKey 是挂在 gorm Statement.Settings 上的标记位，
// 用它来"显式"告诉 guardrail：这条语句允许跳过租户检查。
const tenantBypassKey = "tenant:bypass"

// WithTenantBypass 给一次 gorm 会话打上"允许跨租户"的标记。
// 仅限：数据迁移、系统 bootstrap、超级管理员跨租户操作。
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

// RegisterTenantCallbacks 在给定的 *gorm.DB 上挂载租户隔离 callback。
// 行为总览：
//   - Create：按 context 自动回填 tenant_id，仍为 0 时 fail-closed
//   - Query/Update/Delete：若 WHERE 没有 tenant_id，fail-closed
//   - 不覆盖 Raw/Exec 或 DB.Table() 路径 —— 这些必须自己写明显的租户条件
func RegisterTenantCallbacks(db *gorm.DB) {
	// Phase 1 表 —— 核心 5 张
	RegisterTenantScopedTable("users")
	RegisterTenantScopedTable("channels")
	RegisterTenantScopedTable("tokens")
	RegisterTenantScopedTable("logs")
	RegisterTenantScopedTable("abilities")

	// Phase 2 表 —— 金融
	RegisterTenantScopedTable("top_ups")
	RegisterTenantScopedTable("redemptions")
	RegisterTenantScopedTable("subscription_plans")
	RegisterTenantScopedTable("subscription_orders")
	RegisterTenantScopedTable("user_subscriptions")
	RegisterTenantScopedTable("subscription_pre_consume_records")

	// Phase 2 表 —— 发票
	RegisterTenantScopedTable("invoice_applications")
	RegisterTenantScopedTable("invoice_items")
	RegisterTenantScopedTable("invoice_uploads")
	RegisterTenantScopedTable("invoice_files")

	// Phase 2 表 —— 工单
	RegisterTenantScopedTable("tickets")
	RegisterTenantScopedTable("ticket_replies")
	RegisterTenantScopedTable("ticket_attachments")
	RegisterTenantScopedTable("ticket_uploads")

	// Phase 2 表 —— 佣金
	RegisterTenantScopedTable("aff_rebate_logs")
	RegisterTenantScopedTable("aff_transfer_requests")

	// Phase 2 表 —— 站内消息
	RegisterTenantScopedTable("messages")
	RegisterTenantScopedTable("message_read_statuses")

	// Phase 2 表 —— 分析与审计
	RegisterTenantScopedTable("user_ip_records")
	RegisterTenantScopedTable("quota_data")
	RegisterTenantScopedTable("agent_logs")
	RegisterTenantScopedTable("agent_reports")

	// Phase 3 表 —— 成员关系
	RegisterTenantScopedTable("tenant_memberships")

	// Phase 7 表 —— 告警持久化
	RegisterTenantScopedTable("tenant_alert_records")

	// Phase 5 表 —— 账单持久化
	RegisterTenantScopedTable("tenant_bills")
	RegisterTenantScopedTable("tenant_ledgers")

	// Phase 7 表 —— 审计日志
	RegisterTenantScopedTable("tenant_audit_logs")

	// Phase S1 表 —— 支付配置
	RegisterTenantScopedTable("tenant_payment_configs")
	RegisterTenantScopedTable("payment_orders")
	// Phase S3 表 —— 退款
	RegisterTenantScopedTable("payment_refunds")

	// Create：fail-closed（没有 tenant_id 就拒绝入库）
	db.Callback().Create().Before("gorm:create").Register("tenant:guard_create", tenantGuardCreate)
	// Query/Update/Delete：fail-closed（WHERE 里没 tenant_id 就拒绝）
	// Phase 1.5 升级：从只打 warning 改为直接 blocking。
	db.Callback().Query().Before("gorm:query").Register("tenant:guard_query", tenantGuardScope)
	db.Callback().Update().Before("gorm:update").Register("tenant:guard_update", tenantGuardScope)
	db.Callback().Delete().Before("gorm:delete").Register("tenant:guard_delete", tenantGuardScope)
}

// tenantGuardScope 是 Query/Update/Delete 的租户隔离守门员。
//
// Phase 2 生效行为（已从 warn-only 升级为 fail-closed）：
//   - WHERE 已经含 tenant_id           → 放行
//   - context 里"显式"携带了 tenant_id   → 自动注入 WHERE 并放行
//   - 其它                             → 拒绝操作（db.AddError）+ 打 ERROR 日志
//
// 关键设计取舍：使用 ExplicitTenantIDFromContext（找不到返 0），
// 而不是 TenantIDFromContext（找不到返 DefaultTenantId）。
// 这是为了防止 context.Background() 的查询被误识别为"租户 1"，从而发生
// 跨租户数据被改写/读取的严重事故。
//
// 需要跨租户操作时，调用方用 WithTenantBypass(db) 显式开闸。
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

	// Check 1：看生成的 SQL 里是否已出现 tenant_id（WHERE/JOIN 位置）。
	// 此时 Statement.SQL 只包含 WHERE/JOIN 之类条件，不会包含 SELECT 列，
	// 所以这里匹配 tenant_id 是安全的；保险起见下面还会再查一次 WHERE 子句对象。
	sql := db.Statement.SQL.String()
	if sql != "" && strings.Contains(sql, "tenant_id") {
		return
	}

	// Check 2：单独检查 WHERE 子句对象是否引用了 tenant_id。
	// 只看 WHERE，避免被 Select("tenant_id") 这类非 WHERE 位置误判为合法。
	var whereExpr string
	if whereClause, ok := db.Statement.Clauses["WHERE"]; ok {
		whereExpr = fmt.Sprintf("%v", whereClause.Expression)
		if strings.Contains(whereExpr, "tenant_id") {
			return
		}
	}

	// Check 3：唯一索引查询自动放行。
	// 如果 WHERE 里对 PK 或单列唯一索引做等值/IN 查询，结果行本身就是跨租户唯一的，
	// 再加 tenant_id 条件只是冗余；不加也不会发生跨租户数据混淆。
	// 这里吃掉了大量"按 id 反查"的裸调用（session user、passkey、OAuth 绑定、
	// 订单 trade_no 查询等），让它们无需调用方改代码即可通过 guardrail。
	if whereExpr != "" && hasUniqueKeyEquality(db.Statement.Schema, whereExpr) {
		return
	}

	// Check 4：尝试从 context 里自动注入 —— 但必须是"显式"写入的 tenant_id 才行。
	// ExplicitTenantIDFromContext 在没 set 时返 0（不是 DefaultTenantId），
	// 这样 context.Background() 的查询不会被当成"租户 1"处理。
	if ctx := db.Statement.Context; ctx != nil {
		if tenantId := ExplicitTenantIDFromContext(ctx); tenantId > 0 {
			db.Where("tenant_id = ?", tenantId)
			return
		}
	}

	// 以上都不满足 —— Phase 2 fail-closed：写 ERROR 日志 + 拒绝执行。
	// 调用方修法：走 TenantDB(ctx) / 显式 .Where("tenant_id = ?", id) /
	// 或用 WithTenantBypass() 为超管跨租户操作明确开闸。
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

// tenantGuardCreate 是 Insert 的租户隔离守门员：
// 先尝试按 context 自动回填 tenant_id，仍为 0 时 fail-closed（除非显式 bypass）。
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

	// ReflectValue can be either a single struct (DB.Create(&row)) or a
	// slice/array (DB.Create(&rows) — batch insert). schema.Field.ValueOf
	// panics on a slice Value, so we have to dispatch per-element here.
	rv := reflect.Indirect(db.Statement.ReflectValue)
	switch rv.Kind() {
	case reflect.Slice, reflect.Array:
		for i := 0; i < rv.Len(); i++ {
			if err := checkOrFillTenantId(db, field, rv.Index(i)); err != nil {
				_ = db.AddError(err)
				return
			}
		}
	case reflect.Struct:
		if err := checkOrFillTenantId(db, field, rv); err != nil {
			_ = db.AddError(err)
			return
		}
	}
}

// checkOrFillTenantId reads tenant_id from a single row, back-fills from
// request context when missing, and fails closed if it still ends up as 0.
func checkOrFillTenantId(db *gorm.DB, field *schema.Field, rowValue reflect.Value) error {
	// Phase 1：如果当前 tenant_id 为 0，就尝试从 context 里自动回填
	val, isZero := field.ValueOf(db.Statement.Context, rowValue)
	currentTenantId := 0
	switch v := val.(type) {
	case int:
		currentTenantId = v
	case int64:
		currentTenantId = int(v)
	}

	if isZero || currentTenantId == 0 {
		// 用 ExplicitTenantIDFromContext（context.Background() 时返 0），
		// 而不是 TenantIDFromContext（会返回 DefaultTenantId）。
		// 这样可以防止 DB.Create() 在没挂请求 context 时，把数据悄悄写到租户 1。
		tenantId := ExplicitTenantIDFromContext(db.Statement.Context)
		if tenantId > 0 {
			_ = field.Set(db.Statement.Context, rowValue, tenantId)
			currentTenantId = tenantId
		}
	}

	// Phase 2：fail-closed —— 如果 tenant_id 仍为 0，拒绝写入。
	// 回填之后再读一次，避免前面 Set 没生效。
	if currentTenantId == 0 {
		val2, _ := field.ValueOf(db.Statement.Context, rowValue)
		switch v := val2.(type) {
		case int:
			currentTenantId = v
		case int64:
			currentTenantId = int(v)
		}
	}
	if currentTenantId == 0 {
		return fmt.Errorf("tenant guardrail: refusing to create %s row without tenant_id (use WithTenantBypass to override)", db.Statement.Schema.Table)
	}
	return nil
}

// ---------- 唯一索引自动放行工具函数 ----------

// uniqueColRegexCache 缓存每个列名对应的"等值/IN 判定"正则，避免每次重编译。
var uniqueColRegexCache sync.Map // map[string]*regexp.Regexp

// buildUniqueColRegex 构造一个匹配 `colname =` / `colname IN (...)` 的正则。
//
// 识别场景：
//   - `id = ?`、`"id" = ?`、`` `id` = ? ``、`users.id = ?`、`(id = ?)`
//   - `id IN (?, ?, ?)`
// 带词界约束，防止 `user_id = ?` / `channel_id = ?` 误命中 `id`。
func buildUniqueColRegex(col string) *regexp.Regexp {
	// 前界：开头、空白、逗号、左括号、点、反引号、双引号、单引号
	// 后界：同上去掉点，并可以直接跟 `=` 或 `IN`
	prefix := `(?:^|[\s,(.` + "`" + `"'])`
	suffix := `(?:[\s` + "`" + `"']|$)\s*(?:=|IN\b)`
	pattern := `(?i)` + prefix + regexp.QuoteMeta(col) + suffix
	return regexp.MustCompile(pattern)
}

func uniqueColRegex(col string) *regexp.Regexp {
	if cached, ok := uniqueColRegexCache.Load(col); ok {
		return cached.(*regexp.Regexp)
	}
	r := buildUniqueColRegex(col)
	uniqueColRegexCache.Store(col, r)
	return r
}

// hasUniqueKeyEquality 判断 WHERE 表达式是否对"单列唯一键"做了等值/IN 查询。
//
// 扫描的列：
//   - 表的主键字段（Schema.PrimaryFields）
//   - 带单列 `gorm:"uniqueIndex"` 或 `gorm:"unique"` 的字段（Schema.Field.Unique=true）
//
// 不扫描组合唯一索引的列（例如 `uniqueIndex:uk_name,priority:1`）——单列不足以
// 保证跨租户唯一性，放行会有数据混淆风险。
func hasUniqueKeyEquality(sch *schema.Schema, whereExpr string) bool {
	if sch == nil || whereExpr == "" {
		return false
	}
	// 先扫主键
	for _, f := range sch.PrimaryFields {
		if f == nil || f.DBName == "" {
			continue
		}
		if uniqueColRegex(f.DBName).MatchString(whereExpr) {
			return true
		}
	}
	// 再扫单列 Unique 字段（GORM 对组合唯一索引不会把 Unique 置 true）
	for _, f := range sch.Fields {
		if f == nil || !f.Unique || f.DBName == "" || f.PrimaryKey {
			continue
		}
		if uniqueColRegex(f.DBName).MatchString(whereExpr) {
			return true
		}
	}
	return false
}
