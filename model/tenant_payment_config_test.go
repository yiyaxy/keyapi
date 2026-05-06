package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormLogger "gorm.io/gorm/logger"
)

func TestTenantPaymentConfig_EncryptDecryptRoundtrip(t *testing.T) {
	cfg := &TenantPaymentConfig{
		TenantId: 1,
		Provider: "wechat",
		AppId:    "wx1234567890",
		Mchid:    "1700000000",
		SerialNo: "ABCDEF1234",
	}
	plaintext := TenantPaymentPlaintext{
		AppSecret:  "secret-app",
		Apiv3Key:   "secret-apiv3-32-bytes-long-padding",
		PrivateKey: "-----BEGIN PRIVATE KEY-----\nMIIB...\n-----END PRIVATE KEY-----\n",
		XpayAppKey: "secret-xpay",
	}
	if err := cfg.EncryptAndSetSensitive(plaintext); err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if cfg.AppSecretEnc == "" || cfg.Apiv3KeyEnc == "" || cfg.PrivateKeyEnc == "" || cfg.XpayAppKeyEnc == "" {
		t.Fatal("enc fields should be set")
	}
	if cfg.AppSecretEnc == plaintext.AppSecret {
		t.Fatal("AppSecretEnc must not be plaintext")
	}

	decoded, err := cfg.DecryptSensitive()
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if decoded.AppSecret != plaintext.AppSecret ||
		decoded.Apiv3Key != plaintext.Apiv3Key ||
		decoded.PrivateKey != plaintext.PrivateKey ||
		decoded.XpayAppKey != plaintext.XpayAppKey {
		t.Fatal("roundtrip mismatch")
	}
}

func setupTenantPaymentConfigMigrationTestDB(t *testing.T) func() {
	t.Helper()

	prevDB := DB
	prevUsingSQLite := common.UsingSQLite
	prevUsingPostgreSQL := common.UsingPostgreSQL
	prevUsingMySQL := common.UsingMySQL

	InitColForTest()
	common.UsingSQLite = true
	common.UsingPostgreSQL = false
	common.UsingMySQL = false

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormLogger.Default.LogMode(gormLogger.Silent),
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	DB = db

	return func() {
		DB = prevDB
		common.UsingSQLite = prevUsingSQLite
		common.UsingPostgreSQL = prevUsingPostgreSQL
		common.UsingMySQL = prevUsingMySQL
	}
}

func TestMigrateTenantPaymentConfigProvider_BackfillsLegacyRows(t *testing.T) {
	restore := setupTenantPaymentConfigMigrationTestDB(t)
	defer restore()

	if err := DB.Exec(`
		CREATE TABLE tenant_payment_configs (
			id integer PRIMARY KEY AUTOINCREMENT,
			tenant_id integer NOT NULL,
			enabled numeric DEFAULT 0,
			app_id varchar(64),
			app_secret_enc text,
			created_at integer,
			updated_at integer
		)
	`).Error; err != nil {
		t.Fatalf("create legacy table: %v", err)
	}
	if err := DB.Exec("INSERT INTO tenant_payment_configs (tenant_id, enabled, app_id) VALUES (?, ?, ?)", 7, true, "wx-legacy").Error; err != nil {
		t.Fatalf("insert legacy row: %v", err)
	}

	if err := migrateTenantPaymentConfigProvider(); err != nil {
		t.Fatalf("migrate provider column: %v", err)
	}
	if !DB.Migrator().HasColumn(&TenantPaymentConfig{}, "Provider") {
		t.Fatal("provider column should exist")
	}
	cfg, err := GetTenantPaymentConfig(7, "wechat")
	if err != nil {
		t.Fatalf("load backfilled config: %v", err)
	}
	if cfg.Provider != "wechat" || cfg.AppId != "wx-legacy" {
		t.Fatalf("backfilled config = provider %q app_id %q", cfg.Provider, cfg.AppId)
	}
}

func TestMoveOAuthBindingsUsesProviderIdColumn(t *testing.T) {
	restore := setupTenantPaymentConfigMigrationTestDB(t)
	defer restore()

	if err := DB.AutoMigrate(&UserOAuthBinding{}); err != nil {
		t.Fatalf("migrate oauth bindings: %v", err)
	}
	rows := []UserOAuthBinding{
		{UserId: 10, ProviderId: 1, ProviderUserId: "target-p1"},
		{UserId: 20, ProviderId: 1, ProviderUserId: "source-p1"},
		{UserId: 20, ProviderId: 2, ProviderUserId: "source-p2"},
	}
	for i := range rows {
		if err := DB.Create(&rows[i]).Error; err != nil {
			t.Fatalf("insert binding %d: %v", i, err)
		}
	}

	if err := moveOAuthBindings(DB, 20, 10); err != nil {
		t.Fatalf("move oauth bindings: %v", err)
	}

	var sourceCount int64
	if err := DB.Model(&UserOAuthBinding{}).Where("user_id = ?", 20).Count(&sourceCount).Error; err != nil {
		t.Fatalf("count source bindings: %v", err)
	}
	if sourceCount != 0 {
		t.Fatalf("source bindings = %d, want 0", sourceCount)
	}

	var targetBindings []UserOAuthBinding
	if err := DB.Where("user_id = ?", 10).Order("provider_id asc").Find(&targetBindings).Error; err != nil {
		t.Fatalf("load target bindings: %v", err)
	}
	if len(targetBindings) != 2 {
		t.Fatalf("target binding count = %d, want 2", len(targetBindings))
	}
	if targetBindings[0].ProviderId != 1 || targetBindings[0].ProviderUserId != "target-p1" {
		t.Fatalf("provider 1 binding was not preserved: %+v", targetBindings[0])
	}
	if targetBindings[1].ProviderId != 2 || targetBindings[1].ProviderUserId != "source-p2" {
		t.Fatalf("provider 2 binding was not moved: %+v", targetBindings[1])
	}
}
