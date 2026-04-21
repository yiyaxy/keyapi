package middleware

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func TestTenantAdminOnlyAuth_RejectsRoot(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("platform_role", common.RoleRootUser)
	c.Set("tenant_role", model.TenantRoleAdmin)
	if _, ok := checkTenantAdminOnly(c); ok {
		t.Fatal("root must be rejected")
	}
}

func TestTenantAdminOnlyAuth_RejectsNonTenantAdmin(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("platform_role", common.RoleCommonUser)
	c.Set("tenant_role", model.TenantRoleMember)
	if _, ok := checkTenantAdminOnly(c); ok {
		t.Fatal("common user must be rejected")
	}
}

func TestTenantAdminOnlyAuth_AcceptsTenantAdmin(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("platform_role", common.RoleCommonUser)
	c.Set("tenant_role", model.TenantRoleAdmin)
	if _, ok := checkTenantAdminOnly(c); !ok {
		t.Fatal("tenant admin must be accepted")
	}
}
