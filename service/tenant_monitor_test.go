package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormLogger "gorm.io/gorm/logger"
)

func setupTenantMonitorTestDB(t *testing.T) func() {
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

func TestGetTenantRetryTimes_ClampsToPlatform(t *testing.T) {
	restore := setupTenantMonitorTestDB(t)
	defer restore()

	prev := common.RetryTimes
	common.RetryTimes = 2
	t.Cleanup(func() { common.RetryTimes = prev })

	if err := model.SetTenantOption(7, "RetryTimes", "5"); err != nil {
		t.Fatalf("set tenant option: %v", err)
	}
	if got := GetTenantRetryTimes(7); got != 2 {
		t.Fatalf("GetTenantRetryTimes = %d, want 2", got)
	}
}

func TestGetTenantAutomaticRetryStatusCodeRanges_IntersectsTenantAndPlatform(t *testing.T) {
	restore := setupTenantMonitorTestDB(t)
	defer restore()

	prev := operation_setting.AutomaticRetryStatusCodeRanges
	operation_setting.AutomaticRetryStatusCodeRanges = []operation_setting.StatusCodeRange{
		{Start: 500, End: 503},
	}
	t.Cleanup(func() { operation_setting.AutomaticRetryStatusCodeRanges = prev })

	if err := model.SetTenantOption(9, "AutomaticRetryStatusCodes", "500-599"); err != nil {
		t.Fatalf("set tenant option: %v", err)
	}
	if !ShouldTenantRetryByStatusCode(9, 503) {
		t.Fatalf("expected 503 to be retryable after intersection")
	}
	if ShouldTenantRetryByStatusCode(9, 504) {
		t.Fatalf("expected 504 to be excluded by platform retry ceiling")
	}
}

func TestGetTenantModelRequestRateLimitConfig_ClampsCountsToPlatform(t *testing.T) {
	restore := setupTenantMonitorTestDB(t)
	defer restore()

	prevEnabled := setting.ModelRequestRateLimitEnabled
	prevDuration := setting.ModelRequestRateLimitDurationMinutes
	prevCount := setting.ModelRequestRateLimitCount
	prevSuccess := setting.ModelRequestRateLimitSuccessCount
	prevGroup := setting.ModelRequestRateLimitGroup
	setting.ModelRequestRateLimitEnabled = true
	setting.ModelRequestRateLimitDurationMinutes = 2
	setting.ModelRequestRateLimitCount = 10
	setting.ModelRequestRateLimitSuccessCount = 6
	setting.ModelRequestRateLimitGroup = map[string][2]int{
		"default": {8, 5},
	}
	t.Cleanup(func() {
		setting.ModelRequestRateLimitEnabled = prevEnabled
		setting.ModelRequestRateLimitDurationMinutes = prevDuration
		setting.ModelRequestRateLimitCount = prevCount
		setting.ModelRequestRateLimitSuccessCount = prevSuccess
		setting.ModelRequestRateLimitGroup = prevGroup
	})

	if err := model.SetTenantOption(11, "ModelRequestRateLimitCount", "20"); err != nil {
		t.Fatalf("set count: %v", err)
	}
	if err := model.SetTenantOption(11, "ModelRequestRateLimitSuccessCount", "9"); err != nil {
		t.Fatalf("set success count: %v", err)
	}
	if err := model.SetTenantOption(11, "ModelRequestRateLimitDurationMinutes", "5"); err != nil {
		t.Fatalf("set duration: %v", err)
	}
	if err := model.SetTenantOption(11, "ModelRequestRateLimitGroup", `{"default":[20,10]}`); err != nil {
		t.Fatalf("set group limits: %v", err)
	}

	cfg := GetTenantModelRequestRateLimitConfig(11)
	if cfg.TotalCount != 10 {
		t.Fatalf("TotalCount = %d, want 10", cfg.TotalCount)
	}
	if cfg.SuccessCount != 6 {
		t.Fatalf("SuccessCount = %d, want 6", cfg.SuccessCount)
	}
	if cfg.DurationMinutes != 2 {
		t.Fatalf("DurationMinutes = %d, want 2", cfg.DurationMinutes)
	}
	if cfg.GroupLimits["default"] != [2]int{8, 5} {
		t.Fatalf("GroupLimits[default] = %v, want [8 5]", cfg.GroupLimits["default"])
	}
}
