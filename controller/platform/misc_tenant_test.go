package platform

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormLogger "gorm.io/gorm/logger"
)

func setupPlatformTenantOptionTestDB(t *testing.T) func() {
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

func TestGetStatusUsesTenantAuthOverrides(t *testing.T) {
	restoreDB := setupPlatformTenantOptionTestDB(t)
	defer restoreDB()

	prevRegisterEnabled := common.RegisterEnabled
	prevPasswordRegisterEnabled := common.PasswordRegisterEnabled
	prevPasswordLoginEnabled := common.PasswordLoginEnabled
	prevTurnstileCheckEnabled := common.TurnstileCheckEnabled
	prevTurnstileSiteKey := common.TurnstileSiteKey
	prevWxPayEnabled := common.WxPayEnabled
	defer func() {
		common.RegisterEnabled = prevRegisterEnabled
		common.PasswordRegisterEnabled = prevPasswordRegisterEnabled
		common.PasswordLoginEnabled = prevPasswordLoginEnabled
		common.TurnstileCheckEnabled = prevTurnstileCheckEnabled
		common.TurnstileSiteKey = prevTurnstileSiteKey
		common.WxPayEnabled = prevWxPayEnabled
	}()

	common.RegisterEnabled = false
	common.PasswordRegisterEnabled = false
	common.PasswordLoginEnabled = false
	common.TurnstileCheckEnabled = false
	common.TurnstileSiteKey = "platform-site-key"
	common.WxPayEnabled = true

	tenantId := 7
	overrides := map[string]string{
		"RegisterEnabled":         "true",
		"PasswordRegisterEnabled": "true",
		"PasswordLoginEnabled":    "true",
		"TurnstileCheckEnabled":   "true",
		"TurnstileSiteKey":        "tenant-site-key",
		"WxPayEnabled":            "false",
	}
	for key, value := range overrides {
		if err := model.SetTenantOption(tenantId, key, value); err != nil {
			t.Fatalf("set tenant option %s: %v", key, err)
		}
	}
	service.InvalidateTenantOptionCache(tenantId)

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("tenant_id", tenantId)

	GetStatus(c)

	if w.Code != 200 {
		t.Fatalf("status code = %d, want 200", w.Code)
	}

	var resp struct {
		Success bool           `json:"success"`
		Data    map[string]any `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !resp.Success {
		t.Fatalf("expected success response")
	}

	assertBool := func(key string) {
		t.Helper()
		got, ok := resp.Data[key].(bool)
		if !ok {
			t.Fatalf("%s missing or not bool: %#v", key, resp.Data[key])
		}
		if !got {
			t.Fatalf("%s = false, want true", key)
		}
	}

	assertBool("register_enabled")
	assertBool("password_register_enabled")
	assertBool("password_login_enabled")
	assertBool("turnstile_check")

	if got, ok := resp.Data["turnstile_site_key"].(string); !ok || got != "tenant-site-key" {
		t.Fatalf("turnstile_site_key = %#v, want tenant-site-key", resp.Data["turnstile_site_key"])
	}
	if got, ok := resp.Data["wx_pay_enabled"].(bool); !ok || got {
		t.Fatalf("wx_pay_enabled = %#v, want false from tenant override", resp.Data["wx_pay_enabled"])
	}
}
