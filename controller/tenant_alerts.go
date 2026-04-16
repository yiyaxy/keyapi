package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// GetTenantAlerts returns active alerts for the current tenant.
// Requires TenantAdmin role.
func GetTenantAlerts(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if tenantId <= 0 {
		common.ApiErrorMsg(c, "租户信息无效")
		return
	}

	alerts, err := service.CheckTenantAlerts(tenantId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, alerts)
}
