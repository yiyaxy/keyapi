package controller

import (
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetTenantDashboard(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if tenantId <= 0 {
		common.ApiErrorMsg(c, "租户信息无效")
		return
	}

	summary, err := service.GetTenantMetrics(tenantId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, summary)
}

func GetTenantUsageTrend(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if tenantId <= 0 {
		common.ApiErrorMsg(c, "租户信息无效")
		return
	}

	days := 7
	if daysStr := c.Query("days"); daysStr != "" {
		if d, err := strconv.Atoi(daysStr); err == nil && d > 0 {
			days = d
		}
	}
	if days > 90 {
		days = 90
	}

	trend, err := service.GetTenantUsageTrend(tenantId, days)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, trend)
}

func GetTenantModelUsage(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if tenantId <= 0 {
		common.ApiErrorMsg(c, "租户信息无效")
		return
	}

	now := time.Now()
	defaultStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).AddDate(0, 0, -6).Unix()
	defaultEnd := now.Unix()

	startTime := defaultStart
	endTime := defaultEnd

	if s := c.Query("start_time"); s != "" {
		if v, err := strconv.ParseInt(s, 10, 64); err == nil && v > 0 {
			startTime = v
		}
	}
	if e := c.Query("end_time"); e != "" {
		if v, err := strconv.ParseInt(e, 10, 64); err == nil && v > 0 {
			endTime = v
		}
	}

	usage, err := service.GetTenantModelUsage(tenantId, startTime, endTime)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, usage)
}
