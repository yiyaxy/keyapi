package tenant

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/glebarez/sqlite"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	gormLogger "gorm.io/gorm/logger"
)

func setupTenantConfigTestDB(t *testing.T) func() {
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

func TestSecretGetRedaction_Policy(t *testing.T) {
	cases := []struct {
		key          string
		shouldRedact bool
	}{
		{"SystemName", false},
		{"Logo", false},
		{"GroupRatio", false},
		{"SMTPToken", true},
		{"GitHubClientSecret", true},
		{"WeChatServerToken", true},
		{"TelegramBotToken", true},
		{"TurnstileSecretKey", true},
		{"WebhookSecret", true},
		{"InvoicePiaoTongPrivateKey", true},
	}
	for _, tc := range cases {
		got := service.IsSensitiveConfigKey(tc.key)
		if got != tc.shouldRedact {
			t.Errorf("IsSensitiveConfigKey(%q) = %v, want %v", tc.key, got, tc.shouldRedact)
		}
	}
}

func TestRedactedConfigValue(t *testing.T) {
	cases := []struct {
		key      string
		value    string
		expected string
	}{
		{"SystemName", "Acme Inc", "Acme Inc"},
		{"GroupRatio", `{"vip":0.5}`, `{"vip":0.5}`},
		{"SMTPToken", "supersecret", "***"},
		{"SMTPToken", "", ""},
		{"GitHubClientSecret", "abc123", "***"},
		{"WebhookSecret", "hmac-key", "***"},
	}
	for _, tc := range cases {
		got := redactedConfigValue(tc.key, tc.value)
		if got != tc.expected {
			t.Errorf("redactedConfigValue(%q, %q) = %q, want %q", tc.key, tc.value, got, tc.expected)
		}
	}
}

func TestGetTenantConfig_AppliesRedactionInHandler(t *testing.T) {
	restoreDB := setupTenantConfigTestDB(t)
	defer restoreDB()

	prevOptionMap := common.OptionMap
	common.OptionMapRWMutex.Lock()
	common.OptionMap = make(map[string]string)
	common.OptionMap["SMTPToken"] = "platform-smtp-secret"
	common.OptionMap["SystemName"] = "Acme Inc"
	common.OptionMapRWMutex.Unlock()
	defer func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = prevOptionMap
		common.OptionMapRWMutex.Unlock()
	}()

	prevWhitelist := service.TenantOverridableKeys
	service.TenantOverridableKeys = map[string]bool{
		"SMTPToken":  true,
		"SystemName": true,
	}
	defer func() {
		service.TenantOverridableKeys = prevWhitelist
	}()

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req, _ := http.NewRequest(http.MethodGet, "/api/tenant/config", nil)
	c.Request = req
	c.Set(string(constant.ContextKeyTenantId), 999999)

	GetTenantConfig(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", w.Code, w.Body.String())
	}

	var resp struct {
		Success bool `json:"success"`
		Data    []struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v; body = %s", err, w.Body.String())
	}
	if !resp.Success {
		t.Fatalf("expected success response, body = %s", w.Body.String())
	}

	values := make(map[string]string, len(resp.Data))
	for _, item := range resp.Data {
		values[item.Key] = item.Value
	}
	if got := values["SMTPToken"]; got != "***" {
		t.Fatalf("SMTPToken should be redacted to ***, got %q", got)
	}
	if got := values["SystemName"]; got != "Acme Inc" {
		t.Fatalf("SystemName should remain visible, got %q", got)
	}
}
