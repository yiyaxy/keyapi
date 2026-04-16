package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// GetTenantAlerts 返回当前租户的活跃告警。
//
// 实现已从"纯运行时计算"升级为"持久化 + 实时刷新":
//  1. 调用 RefreshTenantAlerts 同步当前告警到 tenant_alert_records 表
//  2. 返回表中 active/acknowledged 状态记录（带 id/status/acknowledged_at 等）
//
// 前端可据此实现"告警确认/解除"UI。
func GetTenantAlerts(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if tenantId <= 0 {
		common.ApiErrorMsg(c, "租户信息无效")
		return
	}

	alerts, err := service.RefreshTenantAlerts(tenantId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, alerts)
}

// GetTenantAlertHistory 返回告警历史（分页，可按 status 过滤）。
func GetTenantAlertHistory(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if tenantId <= 0 {
		common.ApiErrorMsg(c, "租户信息无效")
		return
	}
	pageInfo := common.GetPageQuery(c)
	status := c.Query("status")
	items, total, err := model.ListTenantAlertHistory(tenantId, pageInfo, status)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

// AckTenantAlert 确认告警（status: active → acknowledged）。
func AckTenantAlert(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if tenantId <= 0 {
		common.ApiErrorMsg(c, "租户信息无效")
		return
	}
	alertId, err := strconv.Atoi(c.Param("id"))
	if err != nil || alertId <= 0 {
		common.ApiErrorMsg(c, "无效的告警 ID")
		return
	}
	operatorId := c.GetInt("id")
	if err := model.AcknowledgeTenantAlert(tenantId, alertId, operatorId); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// ResolveTenantAlertHandler 手动解除告警（status → resolved）。
func ResolveTenantAlertHandler(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if tenantId <= 0 {
		common.ApiErrorMsg(c, "租户信息无效")
		return
	}
	alertId, err := strconv.Atoi(c.Param("id"))
	if err != nil || alertId <= 0 {
		common.ApiErrorMsg(c, "无效的告警 ID")
		return
	}
	if err := model.ResolveTenantAlert(tenantId, alertId); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
