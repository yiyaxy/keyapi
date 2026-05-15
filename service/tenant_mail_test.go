package service

import (
	"sync"
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
	prevSMTPServer := common.SMTPServer
	prevSMTPPort := common.SMTPPort
	prevSMTPSSLEnabled := common.SMTPSSLEnabled
	prevSMTPAccount := common.SMTPAccount
	prevSMTPFrom := common.SMTPFrom
	prevSMTPToken := common.SMTPToken
	prevSystemName := common.SystemName

	model.InitColForTest()
	tenantOptionCache = sync.Map{}
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
		common.SMTPServer = prevSMTPServer
		common.SMTPPort = prevSMTPPort
		common.SMTPSSLEnabled = prevSMTPSSLEnabled
		common.SMTPAccount = prevSMTPAccount
		common.SMTPFrom = prevSMTPFrom
		common.SMTPToken = prevSMTPToken
		common.SystemName = prevSystemName
		common.OptionMapRWMutex.Lock()
		common.OptionMap = prevOptionMap
		common.OptionMapRWMutex.Unlock()
		tenantOptionCache = sync.Map{}
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

func TestGetTenantSMTPConfig_DoesNotUsePlatformFallbackForTenant(t *testing.T) {
	restore := setupTenantMailTestDB(t)
	defer restore()

	common.SMTPServer = "platform.smtp.example"
	common.SMTPPort = 465
	common.SMTPSSLEnabled = true
	common.SMTPAccount = "platform@example.com"
	common.SMTPFrom = "platform-from@example.com"
	common.SMTPToken = "platform-token"

	cfg := GetTenantSMTPConfig(42)
	if cfg.Server != "" {
		t.Fatalf("tenant SMTP Server should not fallback to platform, got %q", cfg.Server)
	}
	if cfg.Account != "" {
		t.Fatalf("tenant SMTP Account should not fallback to platform, got %q", cfg.Account)
	}
	if cfg.From != "" {
		t.Fatalf("tenant SMTP From should not fallback to platform, got %q", cfg.From)
	}
	if cfg.Token != "" {
		t.Fatalf("tenant SMTP Token should not fallback to platform, got %q", cfg.Token)
	}
	if CanSendTenantEmail(42) {
		t.Fatalf("tenant without its own complete SMTP config should not be considered configured")
	}
}

func TestCanSendTenantEmail_PlatformContextUsesPlatformConfig(t *testing.T) {
	restore := setupTenantMailTestDB(t)
	defer restore()

	common.OptionMapRWMutex.Lock()
	common.OptionMap["SMTPServer"] = "platform.smtp.example"
	common.OptionMap["SMTPAccount"] = "platform@example.com"
	common.OptionMap["SMTPToken"] = "platform-token"
	common.OptionMapRWMutex.Unlock()

	if !CanSendTenantEmail(0) {
		t.Fatalf("expected platform SMTP config to be considered configured without tenant context")
	}
}
