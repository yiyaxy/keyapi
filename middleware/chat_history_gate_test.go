package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// gateOutcome captures whether the gate allowed the request through and, if
// not, what status it aborted with. Using an explicit "next called" flag is
// more legible than inferring it from c.IsAborted().
type gateOutcome struct {
	nextCalled bool
	status     int
}

func runGate(t *testing.T, setup func(*gin.Context)) gateOutcome {
	t.Helper()
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest("GET", "/api/chat_history/admin", nil)
	setup(c)

	out := gateOutcome{}
	c.Next() // no-op; below we manually invoke the gate

	handler := ChatHistoryViewGate()
	// Replace the engine handlers with our terminal "did it pass?" function.
	handler(c)
	if !c.IsAborted() {
		out.nextCalled = true
	}
	out.status = rec.Code
	return out
}

// Platform admin (platform_role >= RoleAdminUser) must always pass.
func TestChatHistoryViewGate_PlatformAdminBypasses(t *testing.T) {
	out := runGate(t, func(c *gin.Context) {
		c.Set("platform_role", common.RoleAdminUser)
	})
	if !out.nextCalled {
		t.Fatalf("platform admin must pass; aborted with status %d", out.status)
	}
}

// Tenant admin without the feature flag: 403.
func TestChatHistoryViewGate_TenantAdminWithoutFlagForbidden(t *testing.T) {
	if model.DB == nil {
		t.Skip("no DB")
	}
	tenantId := 91
	_ = model.SetChatHistoryViewEnabled(tenantId, false) // ensure clean

	out := runGate(t, func(c *gin.Context) {
		c.Set("platform_role", common.RoleCommonUser)
		c.Set(string(constant.ContextKeyTenantId), tenantId)
	})
	if out.nextCalled {
		t.Fatalf("tenant admin without feature must be denied")
	}
	if out.status != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", out.status)
	}
}

// Tenant admin with the feature flag enabled: passes.
func TestChatHistoryViewGate_TenantAdminWithFlagPasses(t *testing.T) {
	if model.DB == nil {
		t.Skip("no DB")
	}
	tenantId := 92
	if err := model.SetChatHistoryViewEnabled(tenantId, true); err != nil {
		t.Fatalf("seed: %v", err)
	}
	defer func() { _ = model.SetChatHistoryViewEnabled(tenantId, false) }()

	out := runGate(t, func(c *gin.Context) {
		c.Set("platform_role", common.RoleCommonUser)
		c.Set(string(constant.ContextKeyTenantId), tenantId)
	})
	if !out.nextCalled {
		t.Fatalf("tenant admin with feature must pass; aborted with %d", out.status)
	}
}
