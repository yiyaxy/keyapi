package middleware

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// TenantAdminOnlyAuth allows only tenant admins (not platform root/admin acting directly)
// to use tenant-scoped management endpoints.
func TenantAdminOnlyAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !authHelper(c, common.RoleCommonUser) {
			return
		}
		if reason, ok := checkTenantAdminOnly(c); !ok {
			c.JSON(http.StatusForbidden, gin.H{
				"success": false,
				"message": reason,
			})
			c.Abort()
			return
		}
		c.Next()
	}
}

// checkTenantAdminOnly returns (reason, ok). ok=true means pass.
func checkTenantAdminOnly(c *gin.Context) (string, bool) {
	platformRole := c.GetInt("platform_role")
	if platformRole >= common.RoleRootUser {
		return "root 用户请使用 /api/admin/tenant/:tenantId/channel/* 端点代租户操作", false
	}
	tenantRole := c.GetInt("tenant_role")
	if tenantRole < model.TenantRoleAdmin {
		return "需要当前租户的 admin 角色", false
	}
	return "", true
}
