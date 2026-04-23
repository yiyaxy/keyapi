package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormLogger "gorm.io/gorm/logger"
)

func setupSensitiveTestDB(t *testing.T) func() {
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

func TestGetTenantSensitiveWords_Union(t *testing.T) {
	restore := setupSensitiveTestDB(t)
	defer restore()

	prevWords := setting.SensitiveWords
	setting.SensitiveWords = []string{"platform_word", "shared_word"}
	t.Cleanup(func() {
		setting.SensitiveWords = prevWords
	})

	if err := model.SetTenantOption(7, "SensitiveWords", "tenant_word\nshared_word\n"); err != nil {
		t.Fatalf("set tenant option: %v", err)
	}

	words := GetTenantSensitiveWords(7)
	got := make(map[string]struct{}, len(words))
	for _, word := range words {
		got[word] = struct{}{}
	}
	for _, expected := range []string{"platform_word", "shared_word", "tenant_word"} {
		if _, ok := got[expected]; !ok {
			t.Fatalf("expected merged sensitive words to contain %q, got %v", expected, words)
		}
	}
	if len(got) != 3 {
		t.Fatalf("expected deduplicated union, got %v", words)
	}
}

func TestSensitiveWordContainsForTenant_UsesTenantUnion(t *testing.T) {
	restore := setupSensitiveTestDB(t)
	defer restore()

	prevWords := setting.SensitiveWords
	setting.SensitiveWords = []string{"platform_only"}
	t.Cleanup(func() {
		setting.SensitiveWords = prevWords
	})

	if err := model.SetTenantOption(9, "SensitiveWords", "tenant_only"); err != nil {
		t.Fatalf("set tenant option: %v", err)
	}

	if ok, _ := SensitiveWordContainsForTenant(9, "contains tenant_only"); !ok {
		t.Fatalf("expected tenant-specific sensitive word to be detected")
	}
	if ok, _ := SensitiveWordContainsForTenant(9, "contains platform_only"); !ok {
		t.Fatalf("expected platform sensitive word to be detected")
	}
	if ok, _ := SensitiveWordContainsForTenant(10, "contains tenant_only"); ok {
		t.Fatalf("tenant-specific word should not leak across tenants")
	}
}

func TestShouldCheckPromptSensitiveForTenant_UsesTenantSwitches(t *testing.T) {
	restore := setupSensitiveTestDB(t)
	defer restore()

	prevEnabled := setting.CheckSensitiveEnabled
	prevPrompt := setting.CheckSensitiveOnPromptEnabled
	setting.CheckSensitiveEnabled = true
	setting.CheckSensitiveOnPromptEnabled = true
	t.Cleanup(func() {
		setting.CheckSensitiveEnabled = prevEnabled
		setting.CheckSensitiveOnPromptEnabled = prevPrompt
	})

	if err := model.SetTenantOption(11, "CheckSensitiveEnabled", "false"); err != nil {
		t.Fatalf("set CheckSensitiveEnabled: %v", err)
	}
	if ShouldCheckPromptSensitiveForTenant(11) {
		t.Fatalf("tenant should be able to disable sensitive checking")
	}
}
