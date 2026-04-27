package payment

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormLogger "gorm.io/gorm/logger"
)

func setupWechatTenantOptionTestDB(t *testing.T) func() {
	t.Helper()

	prevDB := model.DB
	prevUsingSQLite := common.UsingSQLite
	prevUsingPostgreSQL := common.UsingPostgreSQL
	prevUsingMySQL := common.UsingMySQL

	model.InitColForTest()
	common.UsingSQLite = true
	common.UsingPostgreSQL = false
	common.UsingMySQL = false

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormLogger.Default.LogMode(gormLogger.Silent),
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.TenantOption{}); err != nil {
		t.Fatalf("migrate tenant_options: %v", err)
	}
	model.DB = db

	return func() {
		model.DB = prevDB
		common.UsingSQLite = prevUsingSQLite
		common.UsingPostgreSQL = prevUsingPostgreSQL
		common.UsingMySQL = prevUsingMySQL
	}
}

func TestIsMiniProgramPayEnabledUsesTenantOverride(t *testing.T) {
	restoreDB := setupWechatTenantOptionTestDB(t)
	defer restoreDB()

	prevWxPayEnabled := common.WxPayEnabled
	defer func() {
		common.WxPayEnabled = prevWxPayEnabled
	}()
	common.WxPayEnabled = true

	tenantId := 88
	if err := model.SetTenantOption(tenantId, "WxPayEnabled", "false"); err != nil {
		t.Fatalf("set tenant option: %v", err)
	}
	service.InvalidateTenantOptionCache(tenantId)

	if isMiniProgramPayEnabled(tenantId, model.PaymentProductFormJsapi) {
		t.Fatalf("jsapi pay enabled, want disabled by tenant override")
	}
	if !isMiniProgramPayEnabled(tenantId, model.PaymentProductFormNative) {
		t.Fatalf("native pay disabled, want mini-program switch not to affect it")
	}
}
