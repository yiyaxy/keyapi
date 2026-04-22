package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormLogger "gorm.io/gorm/logger"
)

func setupTenantMailTestDB(t *testing.T) func() {
	t.Helper()

	prevDB := model.DB
	prevUsingSQLite := common.UsingSQLite
	prevUsingPostgreSQL := common.UsingPostgreSQL
	prevUsingMySQL := common.UsingMySQL
	prevOptionMap := common.OptionMap

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

	common.OptionMapRWMutex.Lock()
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()

	return func() {
		model.DB = prevDB
		common.UsingSQLite = prevUsingSQLite
		common.UsingPostgreSQL = prevUsingPostgreSQL
		common.UsingMySQL = prevUsingMySQL
		common.OptionMapRWMutex.Lock()
		common.OptionMap = prevOptionMap
		common.OptionMapRWMutex.Unlock()
	}
}

func TestGetTenantSMTPConfig_UsesTenantOverrides(t *testing.T) {
	restore := setupTenantMailTestDB(t)
	defer restore()

	common.SMTPServer = "platform.smtp.example"
	common.SMTPPort = 587
	common.SMTPSSLEnabled = false
	common.SMTPAccount = "platform@example.com"
	common.SMTPFrom = "platform-from@example.com"
	common.SMTPToken = "platform-token"
	common.SystemName = "Platform Name"

	if err := model.SetTenantOption(42, "SMTPServer", "tenant.smtp.example"); err != nil {
		t.Fatalf("set SMTPServer: %v", err)
	}
	if err := model.SetTenantOption(42, "SMTPPort", "465"); err != nil {
		t.Fatalf("set SMTPPort: %v", err)
	}
	if err := model.SetTenantOption(42, "SMTPSSLEnabled", "true"); err != nil {
		t.Fatalf("set SMTPSSLEnabled: %v", err)
	}
	if err := model.SetTenantOption(42, "SMTPAccount", "tenant@example.com"); err != nil {
		t.Fatalf("set SMTPAccount: %v", err)
	}
	if err := model.SetTenantOption(42, "SMTPFrom", "tenant-from@example.com"); err != nil {
		t.Fatalf("set SMTPFrom: %v", err)
	}
	if err := model.SetTenantOption(42, "SMTPToken", "tenant-token"); err != nil {
		t.Fatalf("set SMTPToken: %v", err)
	}
	if err := model.SetTenantOption(42, "SystemName", "Tenant Name"); err != nil {
		t.Fatalf("set SystemName: %v", err)
	}

	cfg := GetTenantSMTPConfig(42)
	if cfg.Server != "tenant.smtp.example" {
		t.Fatalf("Server = %q", cfg.Server)
	}
	if cfg.Port != 465 {
		t.Fatalf("Port = %d", cfg.Port)
	}
	if !cfg.SSLEnabled {
		t.Fatalf("SSLEnabled = false, want true")
	}
	if cfg.Account != "tenant@example.com" {
		t.Fatalf("Account = %q", cfg.Account)
	}
	if cfg.From != "tenant-from@example.com" {
		t.Fatalf("From = %q", cfg.From)
	}
	if cfg.Token != "tenant-token" {
		t.Fatalf("Token = %q", cfg.Token)
	}
	if cfg.SystemName != "Tenant Name" {
		t.Fatalf("SystemName = %q", cfg.SystemName)
	}
}

func TestCanSendTenantEmail_UsesFallbacks(t *testing.T) {
	restore := setupTenantMailTestDB(t)
	defer restore()

	common.SMTPServer = "platform.smtp.example"
	common.SMTPAccount = ""
	if !CanSendTenantEmail(0) {
		t.Fatalf("expected platform SMTP fallback to be considered configured")
	}
}
