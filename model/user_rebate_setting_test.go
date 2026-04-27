package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormLogger "gorm.io/gorm/logger"
)

func setupUserRebateSettingTestDB(t *testing.T) func() {
	t.Helper()

	prevDB := DB
	prevLOGDB := LOG_DB
	prevUsingSQLite := common.UsingSQLite
	prevUsingPostgreSQL := common.UsingPostgreSQL
	prevUsingMySQL := common.UsingMySQL
	prevOptionMap := common.OptionMap

	InitColForTest()
	common.UsingSQLite = true
	common.UsingPostgreSQL = false
	common.UsingMySQL = false
	common.OptionMapRWMutex.Lock()
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormLogger.Default.LogMode(gormLogger.Silent),
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&TenantOption{}, &User{}, &UserLevel{}, &UserRebateSetting{}); err != nil {
		t.Fatalf("migrate tables: %v", err)
	}
	DB = db
	LOG_DB = db

	return func() {
		DB = prevDB
		LOG_DB = prevLOGDB
		common.UsingSQLite = prevUsingSQLite
		common.UsingPostgreSQL = prevUsingPostgreSQL
		common.UsingMySQL = prevUsingMySQL
		common.OptionMapRWMutex.Lock()
		common.OptionMap = prevOptionMap
		common.OptionMapRWMutex.Unlock()
	}
}

func TestGetNewUserQuotaForTenant_UsesTenantOverride(t *testing.T) {
	restore := setupUserRebateSettingTestDB(t)
	defer restore()

	common.QuotaForNewUser = 11
	if err := SetTenantOption(7, "QuotaForNewUser", "123"); err != nil {
		t.Fatalf("set tenant option: %v", err)
	}

	if got := getNewUserQuotaForTenant(7); got != 123 {
		t.Fatalf("getNewUserQuotaForTenant = %d, want 123", got)
	}
}

func TestGetDefaultRebateSetting_UsesTenantOverrides(t *testing.T) {
	restore := setupUserRebateSettingTestDB(t)
	defer restore()

	common.QuotaForInviter = 1
	common.QuotaForInvitee = 2
	common.TopUpRebateCount = 3
	common.TopUpRebatePercent = 4
	common.SubscriptionRebateCount = 5

	testOptions := map[string]string{
		"QuotaForInviter":         "101",
		"QuotaForInvitee":         "202",
		"TopUpRebateCount":        "7",
		"TopUpRebatePercent":      "8",
		"SubscriptionRebateCount": "9",
	}
	for key, value := range testOptions {
		if err := SetTenantOption(9, key, value); err != nil {
			t.Fatalf("set tenant option %s: %v", key, err)
		}
	}

	setting := GetDefaultRebateSetting(42, 9)
	if setting.RegisterReward != 101 {
		t.Fatalf("RegisterReward = %d, want 101", setting.RegisterReward)
	}
	if setting.InviteeReward != 202 {
		t.Fatalf("InviteeReward = %d, want 202", setting.InviteeReward)
	}
	if setting.TopUpRebateCount != 7 {
		t.Fatalf("TopUpRebateCount = %d, want 7", setting.TopUpRebateCount)
	}
	if setting.TopUpRebatePercent != 8 {
		t.Fatalf("TopUpRebatePercent = %d, want 8", setting.TopUpRebatePercent)
	}
	if setting.SubscriptionRebateCount != 9 {
		t.Fatalf("SubscriptionRebateCount = %d, want 9", setting.SubscriptionRebateCount)
	}
}

func TestGetEffectiveRebateSetting_CustomSettingBeatsTenantDefault(t *testing.T) {
	restore := setupUserRebateSettingTestDB(t)
	defer restore()

	common.QuotaForInviter = 1
	common.QuotaForInvitee = 2
	common.TopUpRebateCount = 3
	common.TopUpRebatePercent = 4
	common.SubscriptionRebateCount = 5

	if err := SetTenantOption(9, "QuotaForInviter", "101"); err != nil {
		t.Fatalf("set tenant option: %v", err)
	}
	if err := DB.Create(&UserRebateSetting{
		InviterId:               42,
		RegisterReward:          501,
		InviteeReward:           502,
		TopUpRebateCount:        12,
		TopUpRebatePercent:      15,
		SubscriptionRebateCount: 18,
	}).Error; err != nil {
		t.Fatalf("create custom rebate setting: %v", err)
	}

	setting := GetEffectiveRebateSetting(42, 9)
	if setting.RegisterReward != 501 {
		t.Fatalf("RegisterReward = %d, want 501", setting.RegisterReward)
	}
	if setting.InviteeReward != 502 {
		t.Fatalf("InviteeReward = %d, want 502", setting.InviteeReward)
	}
	if setting.TopUpRebateCount != 12 {
		t.Fatalf("TopUpRebateCount = %d, want 12", setting.TopUpRebateCount)
	}
	if setting.TopUpRebatePercent != 15 {
		t.Fatalf("TopUpRebatePercent = %d, want 15", setting.TopUpRebatePercent)
	}
	if setting.SubscriptionRebateCount != 18 {
		t.Fatalf("SubscriptionRebateCount = %d, want 18", setting.SubscriptionRebateCount)
	}
}

func TestGetEffectiveRebateSetting_UserLevelBeatsTenantDefault(t *testing.T) {
	restore := setupUserRebateSettingTestDB(t)
	defer restore()

	common.QuotaForInviter = 1
	common.QuotaForInvitee = 2
	common.TopUpRebateCount = 3
	common.TopUpRebatePercent = 4
	common.SubscriptionRebateCount = 5

	level := UserLevel{
		TenantId:                9,
		Code:                    "gold",
		Name:                    "Gold",
		RegisterReward:          701,
		InviteeReward:           702,
		TopUpRebateCount:        17,
		TopUpRebatePercent:      20,
		SubscriptionRebateCount: 21,
		Enabled:                 true,
	}
	if err := DB.Create(&level).Error; err != nil {
		t.Fatalf("create level: %v", err)
	}
	if err := DB.Create(&User{
		Id:       42,
		TenantId: 9,
		Username: "inviter",
		Password: "password",
		LevelId:  level.Id,
	}).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	setting := GetEffectiveRebateSetting(42, 9)
	if setting.RegisterReward != 701 {
		t.Fatalf("RegisterReward = %d, want 701", setting.RegisterReward)
	}
	if setting.InviteeReward != 702 {
		t.Fatalf("InviteeReward = %d, want 702", setting.InviteeReward)
	}
	if setting.TopUpRebateCount != 17 {
		t.Fatalf("TopUpRebateCount = %d, want 17", setting.TopUpRebateCount)
	}
	if setting.TopUpRebatePercent != 20 {
		t.Fatalf("TopUpRebatePercent = %d, want 20", setting.TopUpRebatePercent)
	}
	if setting.SubscriptionRebateCount != 21 {
		t.Fatalf("SubscriptionRebateCount = %d, want 21", setting.SubscriptionRebateCount)
	}
}

func TestGetEffectiveRebateSetting_CustomSettingBeatsUserLevel(t *testing.T) {
	restore := setupUserRebateSettingTestDB(t)
	defer restore()

	level := UserLevel{
		TenantId:           9,
		Code:               "gold",
		Name:               "Gold",
		RegisterReward:     701,
		InviteeReward:      702,
		TopUpRebateCount:   17,
		TopUpRebatePercent: 20,
		Enabled:            true,
	}
	if err := DB.Create(&level).Error; err != nil {
		t.Fatalf("create level: %v", err)
	}
	if err := DB.Create(&User{
		Id:       42,
		TenantId: 9,
		Username: "inviter",
		Password: "password",
		LevelId:  level.Id,
	}).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	if err := DB.Create(&UserRebateSetting{
		InviterId:          42,
		RegisterReward:     801,
		InviteeReward:      802,
		TopUpRebateCount:   27,
		TopUpRebatePercent: 30,
	}).Error; err != nil {
		t.Fatalf("create custom rebate setting: %v", err)
	}

	setting := GetEffectiveRebateSetting(42, 9)
	if setting.RegisterReward != 801 {
		t.Fatalf("RegisterReward = %d, want 801", setting.RegisterReward)
	}
	if setting.InviteeReward != 802 {
		t.Fatalf("InviteeReward = %d, want 802", setting.InviteeReward)
	}
	if setting.TopUpRebateCount != 27 {
		t.Fatalf("TopUpRebateCount = %d, want 27", setting.TopUpRebateCount)
	}
	if setting.TopUpRebatePercent != 30 {
		t.Fatalf("TopUpRebatePercent = %d, want 30", setting.TopUpRebatePercent)
	}
}
