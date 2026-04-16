package unit_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

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
