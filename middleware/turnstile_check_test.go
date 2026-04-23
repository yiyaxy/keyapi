package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormLogger "gorm.io/gorm/logger"
)

func setupTurnstileTenantOptionTestDB(t *testing.T) func() {
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

func TestTurnstileCheck_TenantOverrideCanDisableGlobalCheck(t *testing.T) {
	restoreDB := setupTurnstileTenantOptionTestDB(t)
	defer restoreDB()

	prevTurnstileCheckEnabled := common.TurnstileCheckEnabled
	defer func() {
		common.TurnstileCheckEnabled = prevTurnstileCheckEnabled
	}()
	common.TurnstileCheckEnabled = true

	tenantId := 7
	if err := model.SetTenantOption(tenantId, "TurnstileCheckEnabled", "false"); err != nil {
		t.Fatalf("set tenant option: %v", err)
	}

	gin.SetMode(gin.TestMode)
	r := gin.New()
	store := cookie.NewStore([]byte("turnstile-test-secret"))
	r.Use(sessions.Sessions("turnstile-test", store))
	r.Use(func(c *gin.Context) {
		c.Set("tenant_id", tenantId)
		c.Next()
	})
	r.GET("/", TurnstileCheck(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("status code = %d, want %d; body=%s", w.Code, http.StatusNoContent, w.Body.String())
	}
}
