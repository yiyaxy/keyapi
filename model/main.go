package model

import (
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relaymetrics"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// newGormLogger 返回项目定制的 GORM 日志器（实现见 gorm_logger.go）。
// 特点：单行一条 / 颜色分级（错误红、慢黄、普通灰）/ 调用位置压成短路径 /
// 默认 Warn 级别不刷屏，DEBUG=true 时 Info 级别完整回显。
func newGormLogger() logger.Interface {
	return newPrettyGormLogger()
}

var commonGroupCol string
var commonKeyCol string
var commonTrueVal string
var commonFalseVal string

var logKeyCol string
var logGroupCol string

func initCol() {
	// init common column names
	if common.UsingPostgreSQL {
		commonGroupCol = `"group"`
		commonKeyCol = `"key"`
		commonTrueVal = "true"
		commonFalseVal = "false"
	} else {
		commonGroupCol = "`group`"
		commonKeyCol = "`key`"
		commonTrueVal = "1"
		commonFalseVal = "0"
	}
	if os.Getenv("LOG_SQL_DSN") != "" {
		switch common.LogSqlType {
		case common.DatabaseTypePostgreSQL:
			logGroupCol = `"group"`
			logKeyCol = `"key"`
		default:
			logGroupCol = commonGroupCol
			logKeyCol = commonKeyCol
		}
	} else {
		// LOG_SQL_DSN 为空时，日志数据库与主数据库相同
		if common.UsingPostgreSQL {
			logGroupCol = `"group"`
			logKeyCol = `"key"`
		} else {
			logGroupCol = commonGroupCol
			logKeyCol = commonKeyCol
		}
	}
	// log sql type and database type
	//common.SysLog("Using Log SQL Type: " + common.LogSqlType)
}

// InitColForTest exposes the private initCol() for unit tests that need
// commonKeyCol/commonGroupCol set without running the full InitDB() path.
// Production code must not call this directly — InitDB() calls initCol().
func InitColForTest() { initCol() }

var DB *gorm.DB

var LOG_DB *gorm.DB

func createRootAccountIfNeed() error {
	var user User
	//if user.Status != common.UserStatusEnabled {
	if err := DB.First(&user).Error; err != nil {
		common.SysLog("no user exists, create a root user for you: username is root, password is 123456")
		hashedPassword, err := common.Password2Hash("123456")
		if err != nil {
			return err
		}
		rootUser := User{
			TenantId:    DefaultTenantId,
			Username:    "root",
			Password:    hashedPassword,
			Role:        common.RoleRootUser,
			Status:      common.UserStatusEnabled,
			DisplayName: "Root User",
			AccessToken: nil,
			Quota:       100000000,
		}
		WithTenantBypass(DB).Create(&rootUser)
	}
	return nil
}

func CheckSetup() {
	setup := GetSetup()
	// "已初始化" 的判据是 InitializedAt > 0（而不是行是否存在）。
	// 因为 migrateDB 在写入 schema_version 时会创建占位 Setup 行，
	// 那时 Version/InitializedAt 仍为空——不能算"已初始化"。
	if setup == nil || setup.InitializedAt == 0 {
		// 未完成安装，看是否已有 root 用户（老库直接启动的场景）
		if RootUserExists() {
			common.SysLog("system is not initialized, but root user exists")
			if setup == nil {
				err := DB.Create(&Setup{
					Version:       common.Version,
					SchemaVersion: CurrentSchemaVersion,
					InitializedAt: time.Now().Unix(),
				}).Error
				if err != nil {
					common.SysLog("failed to create setup record: " + err.Error())
				}
			} else {
				err := DB.Model(setup).Updates(map[string]interface{}{
					"version":        common.Version,
					"initialized_at": time.Now().Unix(),
				}).Error
				if err != nil {
					common.SysLog("failed to update setup record: " + err.Error())
				}
			}
			constant.Setup = true
		} else {
			common.SysLog("system is not initialized and no root user exists")
			constant.Setup = false
		}
	} else {
		// Setup record exists, system is initialized
		common.SysLog("system is already initialized at: " + time.Unix(setup.InitializedAt, 0).String())
		constant.Setup = true
	}
}

func chooseDB(envName string, isLog bool) (*gorm.DB, error) {
	defer func() {
		initCol()
	}()
	dsn := os.Getenv(envName)
	if dsn != "" {
		if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
			// Use PostgreSQL
			common.SysLog("using PostgreSQL as database")
			if !isLog {
				common.UsingPostgreSQL = true
			} else {
				common.LogSqlType = common.DatabaseTypePostgreSQL
			}
			return gorm.Open(postgres.New(postgres.Config{
				DSN:                  dsn,
				PreferSimpleProtocol: true, // disables implicit prepared statement usage
			}), &gorm.Config{
				PrepareStmt: true, // precompile SQL
				Logger:      newGormLogger(),
			})
		}
		if strings.HasPrefix(dsn, "local") {
			common.SysLog("SQL_DSN not set, using SQLite as database")
			if !isLog {
				common.UsingSQLite = true
			} else {
				common.LogSqlType = common.DatabaseTypeSQLite
			}
			return gorm.Open(sqlite.Open(common.SQLitePath), &gorm.Config{
				PrepareStmt: true, // precompile SQL
				Logger:      newGormLogger(),
			})
		}
		// Use MySQL
		common.SysLog("using MySQL as database")
		// check parseTime
		if !strings.Contains(dsn, "parseTime") {
			if strings.Contains(dsn, "?") {
				dsn += "&parseTime=true"
			} else {
				dsn += "?parseTime=true"
			}
		}
		if !isLog {
			common.UsingMySQL = true
		} else {
			common.LogSqlType = common.DatabaseTypeMySQL
		}
		return gorm.Open(mysql.Open(dsn), &gorm.Config{
			PrepareStmt: true, // precompile SQL
			Logger:      newGormLogger(),
		})
	}
	// Use SQLite
	common.SysLog("SQL_DSN not set, using SQLite as database")
	common.UsingSQLite = true
	return gorm.Open(sqlite.Open(common.SQLitePath), &gorm.Config{
		PrepareStmt: true, // precompile SQL
		Logger:      newGormLogger(),
	})
}

func InitDB() (err error) {
	db, err := chooseDB("SQL_DSN", false)
	if err == nil {
		if common.DebugEnabled {
			db = db.Debug()
		}
		DB = db
		relaymetrics.RegisterGormCallbacks(DB)
		RegisterTenantCallbacks(DB)
		// MySQL charset/collation startup check: ensure Chinese-capable charset
		if common.UsingMySQL {
			if err := checkMySQLChineseSupport(DB); err != nil {
				panic(err)
			}
		}
		sqlDB, err := DB.DB()
		if err != nil {
			return err
		}
		sqlDB.SetMaxIdleConns(common.GetEnvOrDefault("SQL_MAX_IDLE_CONNS", 100))
		sqlDB.SetMaxOpenConns(common.GetEnvOrDefault("SQL_MAX_OPEN_CONNS", 1000))
		sqlDB.SetConnMaxLifetime(time.Second * time.Duration(common.GetEnvOrDefault("SQL_MAX_LIFETIME", 60)))

		if !common.IsMasterNode {
			return nil
		}
		if common.UsingMySQL {
			//_, _ = sqlDB.Exec("ALTER TABLE channels MODIFY model_mapping TEXT;") // TODO: delete this line when most users have upgraded
		}
		common.SysLog("database migration started")
		err = migrateDB()
		return err
	} else {
		common.FatalLog(err)
	}
	return err
}

func InitLogDB() (err error) {
	if os.Getenv("LOG_SQL_DSN") == "" {
		LOG_DB = DB
		return
	}
	db, err := chooseDB("LOG_SQL_DSN", true)
	if err == nil {
		if common.DebugEnabled {
			db = db.Debug()
		}
		LOG_DB = db
		RegisterTenantCallbacks(LOG_DB)
		// If log DB is MySQL, also ensure Chinese-capable charset
		if common.LogSqlType == common.DatabaseTypeMySQL {
			if err := checkMySQLChineseSupport(LOG_DB); err != nil {
				panic(err)
			}
		}
		sqlDB, err := LOG_DB.DB()
		if err != nil {
			return err
		}
		sqlDB.SetMaxIdleConns(common.GetEnvOrDefault("SQL_MAX_IDLE_CONNS", 100))
		sqlDB.SetMaxOpenConns(common.GetEnvOrDefault("SQL_MAX_OPEN_CONNS", 1000))
		sqlDB.SetConnMaxLifetime(time.Second * time.Duration(common.GetEnvOrDefault("SQL_MAX_LIFETIME", 60)))

		if !common.IsMasterNode {
			return nil
		}
		common.SysLog("database migration started")
		err = migrateLOGDB()
		return err
	} else {
		common.FatalLog(err)
	}
	return err
}

func migrateDB() error {
	// 先把 Setup 表本身建好，才能读写 schema 版本号
	if err := DB.AutoMigrate(&Setup{}); err != nil {
		return err
	}

	currentVersion := GetSchemaVersion()
	if err := migrateTenantPaymentConfigProvider(); err != nil {
		return err
	}
	if currentVersion == CurrentSchemaVersion {
		common.SysLog(fmt.Sprintf("schema version matches (%s), skipping AutoMigrate", currentVersion))
		// 版本匹配仍需执行的启动动作：缓存预热 + 默认租户幂等兜底
		LoadIpBanCache()
		LoadPromptRuleCache()
		if err := EnsureDefaultTenant(); err != nil {
			log.Printf("Warning: failed to bootstrap default tenant: %v", err)
		}
		return nil
	}

	common.SysLog(fmt.Sprintf("schema version %q → %q, running full migration", currentVersion, CurrentSchemaVersion))

	// Migrate price_amount column from float/double to decimal for existing tables
	migrateSubscriptionPlanPriceAmount()
	// Migrate model_limits column from varchar to text for existing tables
	if err := migrateTokenModelLimitsToText(); err != nil {
		return err
	}
	// Drop legacy single-column UNIQUE on users.username before AutoMigrate
	// installs the new composite UNIQUE (tenant_id, username). 对齐「一个租户
	// 一个独立平台」模型：用户名只在租户内唯一，不同租户允许重名。
	if err := migrateUsersUsernameUnique(); err != nil {
		return err
	}

	// 并行 AutoMigrate 所有表（表清单维护在 migrateDBFast 内部）
	if err := migrateDBFast(); err != nil {
		return err
	}

	// AutoMigrate 跑完后再补第三方登录 ID 的租户内 unique —— 单独拎出来是
	// 因为我们用的是 partial unique（WHERE col <> ''），GORM 的 uniqueIndex
	// tag 不支持 WHERE 子句，只能绕过 AutoMigrate 直接写原生 DDL。
	if err := migrateUsersExternalIdUnique(); err != nil {
		return err
	}

	LoadIpBanCache()
	LoadPromptRuleCache()

	// Bootstrap default tenant and backfill existing data
	if err := EnsureDefaultTenant(); err != nil {
		log.Printf("Warning: failed to bootstrap default tenant: %v", err)
	}
	backfillTenantId()
	backfillTenantMemberships()
	normalizePlatformScopeTenantId()

	// 记录新版本，下次启动即可快进
	if err := SaveSchemaVersion(CurrentSchemaVersion); err != nil {
		log.Printf("Warning: failed to save schema version: %v", err)
	}

	return nil
}

// normalizePlatformScopeTenantId 清洗历史脏数据：早期 backfillTenantId 的无差别
// UPDATE，以及创建平台渠道时遗漏 TenantId 归零的代码路径，都可能留下
// scope='platform' 但 tenant_id != 0 的行。缓存按 tenant_id 列分桶，这种行
// 其他租户看不见。此处一次性归零，让平台共享语义真正生效。
func normalizePlatformScopeTenantId() {
	if DB == nil {
		return
	}
	tables := []string{"channels", "abilities"}
	for _, table := range tables {
		result := DB.Exec(fmt.Sprintf("UPDATE %s SET tenant_id = 0 WHERE scope = 'platform' AND tenant_id != 0", table))
		if result.Error != nil {
			log.Printf("Warning: normalize %s platform rows: %v", table, result.Error)
		} else if result.RowsAffected > 0 {
			log.Printf("Normalized %d platform rows (tenant_id→0) in %s", result.RowsAffected, table)
		}
	}
}

// backfillTenantId sets tenant_id = DefaultTenantId for any existing rows that have tenant_id = 0.
// Idempotent: only updates rows where tenant_id = 0.
func backfillTenantId() {
	tables := []string{
		"tenant_memberships",
		// Phase 1
		"users", "channels", "tokens", "abilities", "logs",
		// Phase 2 — financial
		"top_ups", "redemptions", "subscription_plans", "subscription_orders",
		"user_subscriptions", "subscription_pre_consume_records",
		// Phase 2 — invoicing
		"invoice_applications", "invoice_items", "invoice_uploads", "invoice_files",
		// Phase 2 — tickets
		"tickets", "ticket_replies", "ticket_attachments", "ticket_uploads",
		// Phase 2 — affiliate
		"aff_rebate_logs", "aff_transfer_requests",
		// Phase 2 — messaging
		"messages", "message_read_statuses",
		// Phase 2 — analytics & audit
		"user_ip_records", "quota_data", "agent_logs", "agent_reports",
		// Phase 5 — billing
		"tenant_plans",
	}
	// channels / abilities 里 tenant_id=0 是"平台级共享"的正常语义，不是漏写，
	// backfill 若一刀切会把平台行炸成 DefaultTenantId，导致平台渠道彻底失效。
	platformAware := map[string]bool{"channels": true, "abilities": true}
	for _, table := range tables {
		var sql string
		if platformAware[table] {
			sql = fmt.Sprintf("UPDATE %s SET tenant_id = ? WHERE tenant_id = 0 AND (scope IS NULL OR scope != 'platform')", table)
		} else {
			sql = fmt.Sprintf("UPDATE %s SET tenant_id = ? WHERE tenant_id = 0", table)
		}
		result := DB.Exec(sql, DefaultTenantId)
		if result.Error != nil {
			log.Printf("Warning: tenant_id backfill for %s: %v", table, result.Error)
		} else if result.RowsAffected > 0 {
			log.Printf("Backfilled tenant_id=%d for %d rows in %s", DefaultTenantId, result.RowsAffected, table)
		}
	}
	// Handle LOG_DB if separate.
	// backfillTenantId runs inside InitDB()→migrateDB(), before InitLogDB() has assigned LOG_DB,
	// so LOG_DB may still be nil here. Skip when nil or when pointing to the same handle as DB.
	if LOG_DB != nil && LOG_DB != DB {
		result := LOG_DB.Exec("UPDATE logs SET tenant_id = ? WHERE tenant_id = 0", DefaultTenantId)
		if result.Error != nil {
			log.Printf("Warning: tenant_id backfill for LOG_DB logs: %v", result.Error)
		} else if result.RowsAffected > 0 {
			log.Printf("Backfilled tenant_id=%d for %d rows in LOG_DB logs", DefaultTenantId, result.RowsAffected)
		}
	}
}

func backfillTenantMemberships() {
	if DB == nil {
		return
	}
	type userSeed struct {
		Id       int
		TenantId int
		Role     int
		Status   int
	}
	var users []userSeed
	err := WithTenantBypass(DB).Model(&User{}).
		Select("id", "tenant_id", "role", "status").
		Find(&users).Error
	if err != nil {
		log.Printf("Warning: tenant membership backfill query failed: %v", err)
		return
	}
	for _, user := range users {
		if user.Id <= 0 {
			continue
		}
		tenantId := user.TenantId
		if tenantId <= 0 {
			tenantId = DefaultTenantId
		}
		role := TenantRoleMember
		if user.Role >= common.RoleAdminUser {
			role = TenantRoleAdmin
		}
		status := TenantMembershipStatusActive
		if user.Status != common.UserStatusEnabled {
			status = TenantMembershipStatusDisabled
		}
		result := WithTenantBypass(DB).Where("tenant_id = ? AND user_id = ?", tenantId, user.Id).
			Assign(map[string]interface{}{
				"role":   role,
				"status": status,
			}).
			FirstOrCreate(&TenantMembership{TenantId: tenantId, UserId: user.Id})
		if result.Error != nil {
			log.Printf("Warning: tenant membership backfill for user %d failed: %v", user.Id, result.Error)
		}
	}
}

// migrateDBFast 串行跑 AutoMigrate。
// 历史注释："并行" 只是一种设想——GORM 的 PreparedStmtDB 不是并发安全的，
// 并行 AutoMigrate 会触发 nil panic（prepare_stmt.go PreparedStmtDB.Reset）。
// 日常启动已由 schema 版本门控整块跳过，首次/升级那一次用串行也是秒级。
func migrateDBFast() error {
	migrations := []struct {
		model interface{}
		name  string
	}{
		{&Tenant{}, "Tenant"},
		{&TenantMembership{}, "TenantMembership"},
		{&TenantInvite{}, "TenantInvite"},
		{&TenantOption{}, "TenantOption"},
		{&Channel{}, "Channel"},
		{&Token{}, "Token"},
		{&User{}, "User"},
		{&PasskeyCredential{}, "PasskeyCredential"},
		{&Option{}, "Option"},
		{&Redemption{}, "Redemption"},
		{&Ability{}, "Ability"},
		{&Log{}, "Log"},
		{&Midjourney{}, "Midjourney"},
		{&TopUp{}, "TopUp"},
		{&QuotaData{}, "QuotaData"},
		{&Task{}, "Task"},
		{&Model{}, "Model"},
		{&Vendor{}, "Vendor"},
		{&PrefillGroup{}, "PrefillGroup"},
		{&Setup{}, "Setup"},
		{&TwoFA{}, "TwoFA"},
		{&TwoFABackupCode{}, "TwoFABackupCode"},
		{&Checkin{}, "Checkin"},
		{&SubscriptionOrder{}, "SubscriptionOrder"},
		{&UserSubscription{}, "UserSubscription"},
		{&SubscriptionPreConsumeRecord{}, "SubscriptionPreConsumeRecord"},
		{&CustomOAuthProvider{}, "CustomOAuthProvider"},
		{&UserOAuthBinding{}, "UserOAuthBinding"},
		{&Message{}, "Message"},
		{&MessageReadStatus{}, "MessageReadStatus"},
		{&UserIpRecord{}, "UserIpRecord"},
		{&IpBan{}, "IpBan"},
		{&MessageTranslation{}, "MessageTranslation"},
		{&ContentTranslation{}, "ContentTranslation"},
		{&PromptRule{}, "PromptRule"},
		{&AffTransferRequest{}, "AffTransferRequest"},
		{&AffRebateLog{}, "AffRebateLog"},
		{&UserRebateSetting{}, "UserRebateSetting"},
		{&Ticket{}, "Ticket"},
		{&TicketReply{}, "TicketReply"},
		{&TicketAttachment{}, "TicketAttachment"},
		{&TicketUpload{}, "TicketUpload"},
		{&InvoiceApplication{}, "InvoiceApplication"},
		{&InvoiceItem{}, "InvoiceItem"},
		{&InvoiceUpload{}, "InvoiceUpload"},
		{&InvoiceFile{}, "InvoiceFile"},
		{&SiteRPMSnapshot{}, "SiteRPMSnapshot"},
		{&AgentLog{}, "AgentLog"},
		{&AgentReport{}, "AgentReport"},
		{&TenantPlan{}, "TenantPlan"},
		{&TenantAlertRecord{}, "TenantAlertRecord"},
		{&TenantBill{}, "TenantBill"},
		{&TenantLedger{}, "TenantLedger"},
		{&TenantAuditLog{}, "TenantAuditLog"},
		{&TenantPaymentConfig{}, "TenantPaymentConfig"},
		{&PaymentOrder{}, "PaymentOrder"},
		{&PaymentRefund{}, "PaymentRefund"},
		{&TenantChannelOverride{}, "TenantChannelOverride"},
		{&UserMergeLog{}, "UserMergeLog"},
	}

	for _, m := range migrations {
		if err := DB.AutoMigrate(m.model); err != nil {
			return fmt.Errorf("failed to migrate %s: %v", m.name, err)
		}
	}

	if common.UsingSQLite {
		if err := ensureSubscriptionPlanTableSQLite(); err != nil {
			return err
		}
	} else {
		if err := DB.AutoMigrate(&SubscriptionPlan{}); err != nil {
			return err
		}
	}
	common.SysLog("database migrated")
	return nil
}

func migrateLOGDB() error {
	var err error
	if err = LOG_DB.AutoMigrate(&Log{}); err != nil {
		return err
	}
	return nil
}

func migrateTenantPaymentConfigProvider() error {
	const tableName = "tenant_payment_configs"
	if DB == nil || !DB.Migrator().HasTable(tableName) {
		return nil
	}

	if !DB.Migrator().HasColumn(&TenantPaymentConfig{}, "Provider") {
		var addSQL string
		switch {
		case common.UsingPostgreSQL:
			addSQL = "ALTER TABLE tenant_payment_configs ADD COLUMN provider varchar(32)"
		case common.UsingMySQL:
			addSQL = "ALTER TABLE tenant_payment_configs ADD COLUMN provider varchar(32) NULL"
		case common.UsingSQLite:
			addSQL = "ALTER TABLE tenant_payment_configs ADD COLUMN provider varchar(32) NOT NULL DEFAULT 'wechat'"
		default:
			addSQL = "ALTER TABLE tenant_payment_configs ADD COLUMN provider varchar(32)"
		}
		if err := DB.Exec(addSQL).Error; err != nil {
			return fmt.Errorf("add %s.provider: %w", tableName, err)
		}
	}

	if err := DB.Exec("UPDATE tenant_payment_configs SET provider = ? WHERE provider IS NULL OR provider = ''", "wechat").Error; err != nil {
		return fmt.Errorf("backfill %s.provider: %w", tableName, err)
	}

	switch {
	case common.UsingPostgreSQL:
		if err := DB.Exec("ALTER TABLE tenant_payment_configs ALTER COLUMN provider SET NOT NULL").Error; err != nil {
			return fmt.Errorf("enforce %s.provider not null: %w", tableName, err)
		}
	case common.UsingMySQL:
		if err := DB.Exec("ALTER TABLE tenant_payment_configs MODIFY COLUMN provider varchar(32) NOT NULL").Error; err != nil {
			return fmt.Errorf("enforce %s.provider not null: %w", tableName, err)
		}
	}

	return nil
}

type sqliteColumnDef struct {
	Name string
	DDL  string
}

func ensureSubscriptionPlanTableSQLite() error {
	if !common.UsingSQLite {
		return nil
	}
	tableName := "subscription_plans"
	if !DB.Migrator().HasTable(tableName) {
		createSQL := `CREATE TABLE ` + "`" + tableName + "`" + ` (
` + "`id`" + ` integer,
` + "`title`" + ` varchar(128) NOT NULL,
` + "`subtitle`" + ` varchar(255) DEFAULT '',
` + "`price_amount`" + ` decimal(10,6) NOT NULL,
` + "`currency`" + ` varchar(8) NOT NULL DEFAULT 'USD',
` + "`duration_unit`" + ` varchar(16) NOT NULL DEFAULT 'month',
` + "`duration_value`" + ` integer NOT NULL DEFAULT 1,
` + "`custom_seconds`" + ` bigint NOT NULL DEFAULT 0,
` + "`enabled`" + ` numeric DEFAULT 1,
` + "`sort_order`" + ` integer DEFAULT 0,
` + "`stripe_price_id`" + ` varchar(128) DEFAULT '',
` + "`creem_product_id`" + ` varchar(128) DEFAULT '',
` + "`max_purchase_per_user`" + ` integer DEFAULT 0,
` + "`upgrade_group`" + ` varchar(64) DEFAULT '',
` + "`total_amount`" + ` bigint NOT NULL DEFAULT 0,
` + "`quota_reset_period`" + ` varchar(16) DEFAULT 'never',
` + "`quota_reset_custom_seconds`" + ` bigint DEFAULT 0,
` + "`created_at`" + ` bigint,
` + "`updated_at`" + ` bigint,
PRIMARY KEY (` + "`id`" + `)
)`
		return DB.Exec(createSQL).Error
	}
	var cols []struct {
		Name string `gorm:"column:name"`
	}
	if err := DB.Raw("PRAGMA table_info(`" + tableName + "`)").Scan(&cols).Error; err != nil {
		return err
	}
	existing := make(map[string]struct{}, len(cols))
	for _, c := range cols {
		existing[c.Name] = struct{}{}
	}
	required := []sqliteColumnDef{
		{Name: "title", DDL: "`title` varchar(128) NOT NULL"},
		{Name: "subtitle", DDL: "`subtitle` varchar(255) DEFAULT ''"},
		{Name: "price_amount", DDL: "`price_amount` decimal(10,6) NOT NULL"},
		{Name: "currency", DDL: "`currency` varchar(8) NOT NULL DEFAULT 'USD'"},
		{Name: "duration_unit", DDL: "`duration_unit` varchar(16) NOT NULL DEFAULT 'month'"},
		{Name: "duration_value", DDL: "`duration_value` integer NOT NULL DEFAULT 1"},
		{Name: "custom_seconds", DDL: "`custom_seconds` bigint NOT NULL DEFAULT 0"},
		{Name: "enabled", DDL: "`enabled` numeric DEFAULT 1"},
		{Name: "sort_order", DDL: "`sort_order` integer DEFAULT 0"},
		{Name: "stripe_price_id", DDL: "`stripe_price_id` varchar(128) DEFAULT ''"},
		{Name: "creem_product_id", DDL: "`creem_product_id` varchar(128) DEFAULT ''"},
		{Name: "max_purchase_per_user", DDL: "`max_purchase_per_user` integer DEFAULT 0"},
		{Name: "upgrade_group", DDL: "`upgrade_group` varchar(64) DEFAULT ''"},
		{Name: "total_amount", DDL: "`total_amount` bigint NOT NULL DEFAULT 0"},
		{Name: "quota_reset_period", DDL: "`quota_reset_period` varchar(16) DEFAULT 'never'"},
		{Name: "quota_reset_custom_seconds", DDL: "`quota_reset_custom_seconds` bigint DEFAULT 0"},
		{Name: "created_at", DDL: "`created_at` bigint"},
		{Name: "updated_at", DDL: "`updated_at` bigint"},
	}
	for _, col := range required {
		if _, ok := existing[col.Name]; ok {
			continue
		}
		if err := DB.Exec("ALTER TABLE `" + tableName + "` ADD COLUMN " + col.DDL).Error; err != nil {
			return err
		}
	}
	return nil
}

// migrateTokenModelLimitsToText migrates model_limits column from varchar(1024) to text
// This is safe to run multiple times - it checks the column type first
func migrateTokenModelLimitsToText() error {
	// SQLite uses type affinity, so TEXT and VARCHAR are effectively the same — no migration needed
	if common.UsingSQLite {
		return nil
	}

	tableName := "tokens"
	columnName := "model_limits"

	if !DB.Migrator().HasTable(tableName) {
		return nil
	}

	if !DB.Migrator().HasColumn(&Token{}, columnName) {
		return nil
	}

	var alterSQL string
	if common.UsingPostgreSQL {
		var dataType string
		if err := DB.Raw(`SELECT data_type FROM information_schema.columns
			WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`,
			tableName, columnName).Scan(&dataType).Error; err != nil {
			common.SysLog(fmt.Sprintf("Warning: failed to query metadata for %s.%s: %v", tableName, columnName, err))
		} else if dataType == "text" {
			return nil
		}
		alterSQL = fmt.Sprintf(`ALTER TABLE %s ALTER COLUMN %s TYPE text`, tableName, columnName)
	} else if common.UsingMySQL {
		var columnType string
		if err := DB.Raw(`SELECT COLUMN_TYPE FROM information_schema.columns
				WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
			tableName, columnName).Scan(&columnType).Error; err != nil {
			common.SysLog(fmt.Sprintf("Warning: failed to query metadata for %s.%s: %v", tableName, columnName, err))
		} else if strings.ToLower(columnType) == "text" {
			return nil
		}
		alterSQL = fmt.Sprintf("ALTER TABLE %s MODIFY COLUMN %s text", tableName, columnName)
	} else {
		return nil
	}

	if alterSQL != "" {
		if err := DB.Exec(alterSQL).Error; err != nil {
			return fmt.Errorf("failed to migrate %s.%s to text: %w", tableName, columnName, err)
		}
		common.SysLog(fmt.Sprintf("Successfully migrated %s.%s to text", tableName, columnName))
	}
	return nil
}

// migrateUsersUsernameUnique drops the legacy single-column UNIQUE on
// users(username) so AutoMigrate can install the new composite UNIQUE
// (tenant_id, username). 对齐「1 user : 1 tenant」模型：同名用户允许分散
// 在不同租户里，同一租户内仍然唯一。
//
// 幂等：DROP IF EXISTS / 先查 information_schema 再 DROP。
func migrateUsersUsernameUnique() error {
	if DB == nil || !DB.Migrator().HasTable("users") {
		return nil
	}

	// Candidate names we may have produced historically:
	//   - "uni_users_username"  ← GORM v2 auto-name for `gorm:"unique"`
	//   - "users_username_key"  ← PostgreSQL's default for inline UNIQUE
	candidates := []string{"uni_users_username", "users_username_key"}

	if common.UsingPostgreSQL {
		for _, name := range candidates {
			if err := DB.Exec(fmt.Sprintf(`ALTER TABLE users DROP CONSTRAINT IF EXISTS "%s"`, name)).Error; err != nil {
				common.SysLog(fmt.Sprintf("Warning: drop legacy users unique %q: %v", name, err))
			}
			if err := DB.Exec(fmt.Sprintf(`DROP INDEX IF EXISTS "%s"`, name)).Error; err != nil {
				common.SysLog(fmt.Sprintf("Warning: drop legacy users index %q: %v", name, err))
			}
		}
		return nil
	}

	if common.UsingMySQL {
		for _, name := range candidates {
			var count int64
			if err := DB.Raw(`SELECT COUNT(1) FROM information_schema.statistics
				WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = ?`, name).Scan(&count).Error; err != nil {
				common.SysLog(fmt.Sprintf("Warning: check legacy users index %q: %v", name, err))
				continue
			}
			if count == 0 {
				continue
			}
			if err := DB.Exec(fmt.Sprintf("ALTER TABLE users DROP INDEX `%s`", name)).Error; err != nil {
				common.SysLog(fmt.Sprintf("Warning: drop legacy users index %q: %v", name, err))
			}
		}
		return nil
	}

	// SQLite: 无法原位 DROP UNIQUE 约束（需要 table rebuild）。dev 场景，
	// 撞到 cross-tenant 同名冲突时重建 DB 即可——这里只留日志不抛错。
	if common.UsingSQLite {
		common.SysLog("NOTE: SQLite cannot drop legacy UNIQUE(username); re-create the DB if cross-tenant username collisions arise.")
	}
	return nil
}

// migrateUsersExternalIdUnique installs tenant-scoped UNIQUE indexes on the
// third-party login ID columns — github_id / discord_id / oidc_id /
// wechat_id / telegram_id / linux_do_id —— so concurrent OAuth
// registrations within one tenant can't produce duplicate rows.
//
// Partial `WHERE col <> ”` keeps empty strings out of the index (most
// users never bind any given provider), so the composite still permits
// many rows with empty github_id in the same tenant.
//
// 幂等：CREATE UNIQUE INDEX IF NOT EXISTS 多次 apply 安全。
func migrateUsersExternalIdUnique() error {
	if DB == nil || !DB.Migrator().HasTable("users") {
		return nil
	}
	columns := []string{
		"github_id", "discord_id", "oidc_id",
		"wechat_id", "telegram_id", "linux_do_id",
	}

	if common.UsingPostgreSQL || common.UsingSQLite {
		// Both PG 9.5+ and SQLite 3.8+ support partial unique indexes.
		for _, col := range columns {
			indexName := fmt.Sprintf("uk_user_tenant_%s", col)
			sql := fmt.Sprintf(
				`CREATE UNIQUE INDEX IF NOT EXISTS %s ON users (tenant_id, %s) WHERE %s <> ''`,
				indexName, col, col,
			)
			if err := DB.Exec(sql).Error; err != nil {
				common.SysLog(fmt.Sprintf("Warning: create %s: %v", indexName, err))
			}
		}
		return nil
	}

	if common.UsingMySQL {
		// MySQL (incl. 8.x) doesn't support partial indexes. A plain
		// UNIQUE(tenant_id, col) would reject a second user with empty
		// col, which is wrong for the "user has no github" case. Until
		// a NULL-column migration lands, lean on app-level dedup and
		// log a loud notice so operators know the gap exists.
		common.SysLog("NOTE: MySQL has no partial unique index; third-party ID dedup stays app-level. " +
			"Run a NULL-column migration later to enable (tenant_id, <provider>_id) UNIQUE.")
		return nil
	}
	return nil
}

// migrateSubscriptionPlanPriceAmount migrates price_amount column from float/double to decimal(10,6)
// This is safe to run multiple times - it checks the column type first
func migrateSubscriptionPlanPriceAmount() {
	// SQLite doesn't support ALTER COLUMN, and its type affinity handles this automatically
	// Skip early to avoid GORM parsing the existing table DDL which may cause issues
	if common.UsingSQLite {
		return
	}

	tableName := "subscription_plans"
	columnName := "price_amount"

	// Check if table exists first
	if !DB.Migrator().HasTable(tableName) {
		return
	}

	// Check if column exists
	if !DB.Migrator().HasColumn(&SubscriptionPlan{}, columnName) {
		return
	}

	var alterSQL string
	if common.UsingPostgreSQL {
		// PostgreSQL: Check if already decimal/numeric
		var dataType string
		if err := DB.Raw(`SELECT data_type FROM information_schema.columns
			WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`,
			tableName, columnName).Scan(&dataType).Error; err != nil {
			common.SysLog(fmt.Sprintf("Warning: failed to query metadata for %s.%s: %v", tableName, columnName, err))
		} else if dataType == "numeric" {
			return // Already decimal/numeric
		}
		alterSQL = fmt.Sprintf(`ALTER TABLE %s ALTER COLUMN %s TYPE decimal(10,6) USING %s::decimal(10,6)`,
			tableName, columnName, columnName)
	} else if common.UsingMySQL {
		// MySQL: Check if already decimal
		var columnType string
		if err := DB.Raw(`SELECT COLUMN_TYPE FROM information_schema.columns
				WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
			tableName, columnName).Scan(&columnType).Error; err != nil {
			common.SysLog(fmt.Sprintf("Warning: failed to query metadata for %s.%s: %v", tableName, columnName, err))
		} else if strings.HasPrefix(strings.ToLower(columnType), "decimal") {
			return // Already decimal
		}
		alterSQL = fmt.Sprintf("ALTER TABLE %s MODIFY COLUMN %s decimal(10,6) NOT NULL DEFAULT 0",
			tableName, columnName)
	} else {
		return
	}

	if alterSQL != "" {
		if err := DB.Exec(alterSQL).Error; err != nil {
			common.SysLog(fmt.Sprintf("Warning: failed to migrate %s.%s to decimal: %v", tableName, columnName, err))
		} else {
			common.SysLog(fmt.Sprintf("Successfully migrated %s.%s to decimal(10,6)", tableName, columnName))
		}
	}
}

func closeDB(db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	err = sqlDB.Close()
	return err
}

func CloseDB() error {
	if LOG_DB != DB {
		err := closeDB(LOG_DB)
		if err != nil {
			return err
		}
	}
	return closeDB(DB)
}

// checkMySQLChineseSupport ensures the MySQL connection and current schema
// default charset/collation can store Chinese characters. It allows common
// Chinese-capable charsets (utf8mb4, utf8, gbk, big5, gb18030) and panics otherwise.
func checkMySQLChineseSupport(db *gorm.DB) error {
	// 仅检测：当前库默认字符集/排序规则 + 各表的排序规则（隐含字符集）

	// Read current schema defaults
	var schemaCharset, schemaCollation string
	err := db.Raw("SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()").Row().Scan(&schemaCharset, &schemaCollation)
	if err != nil {
		return fmt.Errorf("读取当前库默认字符集/排序规则失败 / Failed to read schema default charset/collation: %v", err)
	}

	toLower := func(s string) string { return strings.ToLower(s) }
	// Allowed charsets that can store Chinese text
	allowedCharsets := map[string]string{
		"utf8mb4": "utf8mb4_",
		"utf8":    "utf8_",
		"gbk":     "gbk_",
		"big5":    "big5_",
		"gb18030": "gb18030_",
	}
	isChineseCapable := func(cs, cl string) bool {
		csLower := toLower(cs)
		clLower := toLower(cl)
		if prefix, ok := allowedCharsets[csLower]; ok {
			if clLower == "" {
				return true
			}
			return strings.HasPrefix(clLower, prefix)
		}
		// 如果仅提供了排序规则，尝试按排序规则前缀判断
		for _, prefix := range allowedCharsets {
			if strings.HasPrefix(clLower, prefix) {
				return true
			}
		}
		return false
	}

	// 1) 当前库默认值必须支持中文
	if !isChineseCapable(schemaCharset, schemaCollation) {
		return fmt.Errorf("当前库默认字符集/排序规则不支持中文：schema(%s/%s)。请将库设置为 utf8mb4/utf8/gbk/big5/gb18030 / Schema default charset/collation is not Chinese-capable: schema(%s/%s). Please set to utf8mb4/utf8/gbk/big5/gb18030",
			schemaCharset, schemaCollation, schemaCharset, schemaCollation)
	}

	// 2) 所有物理表的排序规则（隐含字符集）必须支持中文
	type tableInfo struct {
		Name      string
		Collation *string
	}
	var tables []tableInfo
	if err := db.Raw("SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'").Scan(&tables).Error; err != nil {
		return fmt.Errorf("读取表排序规则失败 / Failed to read table collations: %v", err)
	}

	var badTables []string
	for _, t := range tables {
		// NULL 或空表示继承库默认设置，已在上面校验库默认，视为通过
		if t.Collation == nil || *t.Collation == "" {
			continue
		}
		cl := *t.Collation
		// 仅凭排序规则判断是否中文可用
		ok := false
		lower := strings.ToLower(cl)
		for _, prefix := range allowedCharsets {
			if strings.HasPrefix(lower, prefix) {
				ok = true
				break
			}
		}
		if !ok {
			badTables = append(badTables, fmt.Sprintf("%s(%s)", t.Name, cl))
		}
	}

	if len(badTables) > 0 {
		// 限制输出数量以避免日志过长
		maxShow := 20
		shown := badTables
		if len(shown) > maxShow {
			shown = shown[:maxShow]
		}
		return fmt.Errorf(
			"存在不支持中文的表，请修复其排序规则/字符集。示例（最多展示 %d 项）：%v / Found tables not Chinese-capable. Please fix their collation/charset. Examples (showing up to %d): %v",
			maxShow, shown, maxShow, shown,
		)
	}
	return nil
}

var (
	lastPingTime time.Time
	pingMutex    sync.Mutex
)

func PingDB() error {
	pingMutex.Lock()
	defer pingMutex.Unlock()

	if time.Since(lastPingTime) < time.Second*10 {
		return nil
	}

	sqlDB, err := DB.DB()
	if err != nil {
		log.Printf("Error getting sql.DB from GORM: %v", err)
		return err
	}

	err = sqlDB.Ping()
	if err != nil {
		log.Printf("Error pinging DB: %v", err)
		return err
	}

	lastPingTime = time.Now()
	common.SysLog("Database pinged successfully")
	return nil
}
