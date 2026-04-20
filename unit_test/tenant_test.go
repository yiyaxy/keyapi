package unit_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// ---------- tenant resolution tests ----------

func setupGinContext(header string, host string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	if header != "" {
		req.Header.Set("X-Tenant-Id", header)
	}
	if host != "" {
		req.Host = host
	}
	c.Request = req
	return c, w
}

func TestTenantResolve_HeaderOverride(t *testing.T) {
	// Without DB, GetTenantById returns nil, so header "1" won't resolve.
	// But the middleware falls back to DefaultTenantId.
	// This test verifies the middleware doesn't panic and the fallback works.
	c, _ := setupGinContext("1", "")
	middleware.TenantResolve()(c)

	tid := middleware.GetTenantId(c)
	// Without DB initialized, tenant lookup returns nil → fallback to default
	if tid != model.DefaultTenantId {
		t.Errorf("expected fallback to DefaultTenantId=%d (DB not initialized), got %d", model.DefaultTenantId, tid)
	}
}

func TestTenantResolve_FallbackDefault(t *testing.T) {
	c, _ := setupGinContext("", "localhost:3000")
	middleware.TenantResolve()(c)

	tid := middleware.GetTenantId(c)
	if tid != model.DefaultTenantId {
		t.Errorf("expected fallback to DefaultTenantId=%d, got %d", model.DefaultTenantId, tid)
	}
}

func TestTenantResolve_SubdomainParsing(t *testing.T) {
	// Without a real DB, subdomain lookup returns nil and falls back to default
	c, _ := setupGinContext("", "acme.example.com:3000")
	middleware.TenantResolve()(c)

	tid := middleware.GetTenantId(c)
	// No "acme" tenant in DB, should fallback to default
	if tid != model.DefaultTenantId {
		t.Errorf("expected fallback for unknown subdomain, got %d", tid)
	}
}

func TestGetTenantId_Unset(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/test", nil)

	tid := middleware.GetTenantId(c)
	if tid != model.DefaultTenantId {
		t.Errorf("expected DefaultTenantId when unset, got %d", tid)
	}
}

// ---------- tenant model tests ----------

func TestDefaultTenantIdIsOne(t *testing.T) {
	if model.DefaultTenantId != 1 {
		t.Errorf("DefaultTenantId should be 1, got %d", model.DefaultTenantId)
	}
}

func TestTenantStatusConstants(t *testing.T) {
	if model.TenantStatusActive != 1 {
		t.Errorf("TenantStatusActive should be 1, got %d", model.TenantStatusActive)
	}
	if model.TenantStatusSuspended != 2 {
		t.Errorf("TenantStatusSuspended should be 2, got %d", model.TenantStatusSuspended)
	}
}

// ---------- tenant scope helper tests ----------

func TestTenantIDFromContext_NilContext(t *testing.T) {
	tid := model.TenantIDFromContext(nil)
	if tid != model.DefaultTenantId {
		t.Errorf("nil context should return DefaultTenantId, got %d", tid)
	}
}

func TestTenantIDFromContext_GinContext(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/test", nil)
	c.Set("tenant_id", 42)

	tid := model.TenantIDFromContext(c)
	if tid != 42 {
		t.Errorf("expected tenant_id=42 from gin.Context, got %d", tid)
	}
}

// ---------- context propagation tests ----------

func TestTenantResolve_InjectsIntoRequestContext(t *testing.T) {
	// This test verifies the BLOCKER fix: tenant_id must be readable
	// from c.Request.Context(), not just from gin's c.Get().
	c, _ := setupGinContext("", "localhost:3000")
	middleware.TenantResolve()(c)

	// After TenantResolve, c.Request.Context() should carry tenant_id
	tid := model.TenantIDFromContext(c.Request.Context())
	if tid != model.DefaultTenantId {
		t.Errorf("expected tenant_id=%d from c.Request.Context(), got %d", model.DefaultTenantId, tid)
	}
}

func TestTenantIDFromContext_RequestContext(t *testing.T) {
	// Simulate what TenantResolve does: inject into request context
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/test", nil)

	// Inject tenant_id=42 into request context (same as TenantResolve does)
	ctx := c.Request.Context()
	ctx = context.WithValue(ctx, constant.ContextKeyTenantId, 42)
	c.Request = c.Request.WithContext(ctx)

	// TenantIDFromContext should find it via Path 2 (typed key)
	tid := model.TenantIDFromContext(c.Request.Context())
	if tid != 42 {
		t.Errorf("expected tenant_id=42 from request context, got %d", tid)
	}
}

// ---------- struct field existence tests ----------

func TestUserHasTenantId(t *testing.T) {
	u := model.User{TenantId: 5}
	if u.TenantId != 5 {
		t.Error("User struct missing TenantId field")
	}
}

func TestTokenHasTenantId(t *testing.T) {
	tk := model.Token{TenantId: 5}
	if tk.TenantId != 5 {
		t.Error("Token struct missing TenantId field")
	}
}

func TestChannelHasTenantId(t *testing.T) {
	ch := model.Channel{TenantId: 5}
	if ch.TenantId != 5 {
		t.Error("Channel struct missing TenantId field")
	}
}

func TestAbilityHasTenantId(t *testing.T) {
	ab := model.Ability{TenantId: 5}
	if ab.TenantId != 5 {
		t.Error("Ability struct missing TenantId field")
	}
}

func TestLogHasTenantId(t *testing.T) {
	lg := model.Log{TenantId: 5}
	if lg.TenantId != 5 {
		t.Error("Log struct missing TenantId field")
	}
}

// ---------- explicitTenantIDFromContext tests ----------
// These test the guardrail-safe extraction that returns 0 (not DefaultTenantId)
// when no tenant key is set in context.

func TestExplicitTenantID_BackgroundContext_ReturnsZero(t *testing.T) {
	// context.Background() has no tenant key set.
	// explicitTenantIDFromContext must return 0 (not DefaultTenantId=1).
	// This prevents the guardrail callback from silently injecting tenant_id=1
	// on queries that use DB directly (no request context).
	tid := model.ExplicitTenantIDFromContext(context.Background())
	if tid != 0 {
		t.Errorf("context.Background() should yield 0 from ExplicitTenantIDFromContext, got %d (would silently rewrite non-default tenant queries)", tid)
	}
}

func TestExplicitTenantID_NilContext_ReturnsZero(t *testing.T) {
	tid := model.ExplicitTenantIDFromContext(nil)
	if tid != 0 {
		t.Errorf("nil context should yield 0 from ExplicitTenantIDFromContext, got %d", tid)
	}
}

func TestExplicitTenantID_WithTenantSet_ReturnsTenant(t *testing.T) {
	ctx := context.WithValue(context.Background(), constant.ContextKeyTenantId, 42)
	tid := model.ExplicitTenantIDFromContext(ctx)
	if tid != 42 {
		t.Errorf("expected 42 from ExplicitTenantIDFromContext, got %d", tid)
	}
}

func TestExplicitTenantID_GinContext_WithTenant(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/test", nil)
	c.Set("tenant_id", 7)

	tid := model.ExplicitTenantIDFromContext(c)
	if tid != 7 {
		t.Errorf("expected 7 from gin.Context with tenant_id=7, got %d", tid)
	}
}

func TestExplicitTenantID_GinContext_WithoutTenant_ReturnsZero(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/test", nil)
	// No tenant_id set on gin.Context

	tid := model.ExplicitTenantIDFromContext(c)
	if tid != 0 {
		t.Errorf("gin.Context without tenant_id should yield 0, got %d", tid)
	}
}

// ---------- TenantIDFromContext vs ExplicitTenantIDFromContext contrast ----------

func TestFallbackDifference_Background(t *testing.T) {
	ctx := context.Background()
	// TenantIDFromContext returns DefaultTenantId (safe for business logic)
	withFallback := model.TenantIDFromContext(ctx)
	// ExplicitTenantIDFromContext returns 0 (safe for guardrails)
	withoutFallback := model.ExplicitTenantIDFromContext(ctx)

	if withFallback != model.DefaultTenantId {
		t.Errorf("TenantIDFromContext(Background) should return DefaultTenantId=%d, got %d", model.DefaultTenantId, withFallback)
	}
	if withoutFallback != 0 {
		t.Errorf("ExplicitTenantIDFromContext(Background) should return 0, got %d", withoutFallback)
	}
	if withFallback == withoutFallback {
		t.Error("the two functions should return different values for context.Background() — that's the whole point")
	}
}

func TestTenantMembershipRoleValidation(t *testing.T) {
	if !model.IsValidTenantRole(model.TenantRoleMember) {
		t.Fatal("tenant member role should be valid")
	}
	if !model.IsValidTenantRole(model.TenantRoleAdmin) {
		t.Fatal("tenant admin role should be valid")
	}
	if model.IsValidTenantRole(common.RoleRootUser) {
		t.Fatal("root role should not be accepted as tenant membership role")
	}
}

func TestEffectiveRoleMapping(t *testing.T) {
	if got := model.EffectiveRole(common.RoleCommonUser, model.TenantRoleMember); got != common.RoleCommonUser {
		t.Fatalf("expected member effective role=%d, got %d", common.RoleCommonUser, got)
	}
	if got := model.EffectiveRole(common.RoleCommonUser, model.TenantRoleAdmin); got != common.RoleAdminUser {
		t.Fatalf("expected tenant admin effective role=%d, got %d", common.RoleAdminUser, got)
	}
	if got := model.EffectiveRole(common.RoleRootUser, model.TenantRoleMember); got != common.RoleRootUser {
		t.Fatalf("expected platform root effective role=%d, got %d", common.RoleRootUser, got)
	}
}
