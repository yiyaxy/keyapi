package user

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormLogger "gorm.io/gorm/logger"
)

type updateSelfAPIResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

func setupUpdateSelfTestDB(t *testing.T) func() {
	t.Helper()

	prevDB := model.DB
	prevLOGDB := model.LOG_DB
	prevUsingSQLite := common.UsingSQLite
	prevUsingPostgreSQL := common.UsingPostgreSQL
	prevUsingMySQL := common.UsingMySQL
	prevRedisEnabled := common.RedisEnabled

	model.InitColForTest()
	common.UsingSQLite = true
	common.UsingPostgreSQL = false
	common.UsingMySQL = false
	common.RedisEnabled = false

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormLogger.Default.LogMode(gormLogger.Silent),
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.User{}); err != nil {
		t.Fatalf("migrate users: %v", err)
	}
	model.DB = db
	model.LOG_DB = db

	return func() {
		model.DB = prevDB
		model.LOG_DB = prevLOGDB
		common.UsingSQLite = prevUsingSQLite
		common.UsingPostgreSQL = prevUsingPostgreSQL
		common.UsingMySQL = prevUsingMySQL
		common.RedisEnabled = prevRedisEnabled

		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	}
}

func newUpdateSelfContext(t *testing.T, body map[string]any, userID int, sessionTenantID int) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()

	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request body: %v", err)
	}

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPut, "/api/user/self", bytes.NewReader(payload))
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Set("id", userID)
	ctx.Set("tenant_id", sessionTenantID)
	return ctx, recorder
}

func decodeUpdateSelfResponse(t *testing.T, recorder *httptest.ResponseRecorder) updateSelfAPIResponse {
	t.Helper()

	var response updateSelfAPIResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return response
}

func TestUpdateSelfUsesStoredTenantIDForProfileChanges(t *testing.T) {
	restore := setupUpdateSelfTestDB(t)
	defer restore()

	gin.SetMode(gin.TestMode)

	hashedPassword, err := common.Password2Hash("oldpass12")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}

	const userID = 101
	const storedTenantID = 7
	const sessionTenantID = 42

	seed := &model.User{
		Id:          userID,
		TenantId:    storedTenantID,
		Username:    "alice",
		Password:    hashedPassword,
		DisplayName: "Alice",
		Status:      common.UserStatusEnabled,
		Role:        common.RoleCommonUser,
		Group:       "default",
	}
	if err := model.DB.Create(seed).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	ctx, recorder := newUpdateSelfContext(t, map[string]any{
		"display_name": "Alice New",
	}, userID, sessionTenantID)

	UpdateSelf(ctx)

	response := decodeUpdateSelfResponse(t, recorder)
	if !response.Success {
		t.Fatalf("expected success response, got message: %s", response.Message)
	}

	var updated model.User
	if err := model.DB.First(&updated, "id = ?", userID).Error; err != nil {
		t.Fatalf("reload user: %v", err)
	}
	if updated.DisplayName != "Alice New" {
		t.Fatalf("display_name = %q, want %q", updated.DisplayName, "Alice New")
	}
	if updated.TenantId != storedTenantID {
		t.Fatalf("tenant_id = %d, want %d", updated.TenantId, storedTenantID)
	}
}
