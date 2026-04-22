package auth

import (
	"context"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/glebarez/sqlite"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	gormLogger "gorm.io/gorm/logger"
)

type stubProvider struct {
	enabled bool
}

func (p stubProvider) GetName() string { return "Stub" }
func (p stubProvider) IsEnabled() bool { return p.enabled }
func (p stubProvider) ExchangeToken(ctx context.Context, code string, c *gin.Context) (*oauth.OAuthToken, error) {
	return nil, nil
}
func (p stubProvider) GetUserInfo(ctx context.Context, token *oauth.OAuthToken) (*oauth.OAuthUser, error) {
	return nil, nil
}
func (p stubProvider) IsUserIDTaken(providerUserID string, tenantId int) bool { return false }
func (p stubProvider) FillUserByProviderID(user *model.User, providerUserID string, tenantId int) error {
	return nil
}
func (p stubProvider) SetProviderUserID(user *model.User, providerUserID string) {}
func (p stubProvider) GetProviderPrefix() string { return "stub_" }

func setupOAuthTenantTestDB(t *testing.T) func() {
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

func TestIsProviderEnabledForTenant_GitHubUsesTenantOverride(t *testing.T) {
	restore := setupOAuthTenantTestDB(t)
	defer restore()

	common.GitHubOAuthEnabled = false
	if err := model.SetTenantOption(7, "GitHubOAuthEnabled", "true"); err != nil {
		t.Fatalf("set tenant option: %v", err)
	}

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)
	c.Set("tenant_id", 7)

	if !isProviderEnabledForTenant(c, "github", stubProvider{enabled: false}) {
		t.Fatalf("expected tenant override to enable github oauth")
	}
}

func TestIsProviderEnabledForTenant_FallbackProviderUsesProviderFlag(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)

	if !isProviderEnabledForTenant(c, "discord", stubProvider{enabled: true}) {
		t.Fatalf("expected non-tenant-specific provider to use provider flag")
	}
}
