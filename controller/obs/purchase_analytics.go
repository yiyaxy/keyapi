package obs

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetPurchaseOverview(c *gin.Context) {
	startTs, endTs := getAnalyticsTimeRange(c)
	orderType := c.DefaultQuery("order_type", "all")
	result, err := model.GetPurchaseOverview(middleware.GetTenantId(c), startTs, endTs, orderType)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetPurchaseTrend(c *gin.Context) {
	startTs, endTs := getAnalyticsTimeRange(c)
	granularity := c.DefaultQuery("granularity", "day")
	orderType := c.DefaultQuery("order_type", "all")
	result, err := model.GetPurchaseTrend(middleware.GetTenantId(c), startTs, endTs, granularity, orderType)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetPurchasePaymentMethod(c *gin.Context) {
	startTs, endTs := getAnalyticsTimeRange(c)
	orderType := c.DefaultQuery("order_type", "all")
	result, err := model.GetPaymentMethodDistribution(middleware.GetTenantId(c), startTs, endTs, orderType)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetPurchaseOrderType(c *gin.Context) {
	startTs, endTs := getAnalyticsTimeRange(c)
	result, err := model.GetOrderTypeDistribution(middleware.GetTenantId(c), startTs, endTs)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetPurchaseTopSpenders(c *gin.Context) {
	startTs, endTs := getAnalyticsTimeRange(c)
	pageInfo := common.GetPageQuery(c)
	orderType := c.DefaultQuery("order_type", "all")
	items, total, err := model.GetTopSpenders(middleware.GetTenantId(c), startTs, endTs, pageInfo.GetStartIdx(), pageInfo.GetPageSize(), orderType)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func GetPurchaseRedemptionStats(c *gin.Context) {
	result, err := model.GetRedemptionStats(middleware.GetTenantId(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetSubscriptionOverview(c *gin.Context) {
	startTs, endTs := getAnalyticsTimeRange(c)
	result, err := model.GetSubscriptionAnalyticsOverview(middleware.GetTenantId(c), startTs, endTs)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetSubscriptionPlanBreakdown(c *gin.Context) {
	startTs, endTs := getAnalyticsTimeRange(c)
	result, err := model.GetSubscriptionPlanBreakdown(middleware.GetTenantId(c), startTs, endTs)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetTopUpOverview(c *gin.Context) {
	startTs, endTs := getAnalyticsTimeRange(c)
	result, err := model.GetTopUpAnalyticsOverview(middleware.GetTenantId(c), startTs, endTs)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetSubscriptionHeatmap(c *gin.Context) {
	startTs, endTs := getAnalyticsTimeRange(c)
	planID, _ := strconv.Atoi(c.DefaultQuery("plan_id", "0"))
	result, err := model.GetSubscriptionHeatmap(middleware.GetTenantId(c), startTs, endTs, planID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetPurchaseDAUTrend(c *gin.Context) {
	startTs, endTs := getAnalyticsTimeRange(c)
	granularity := c.DefaultQuery("granularity", "day")
	result, err := model.GetDAUTrend(middleware.GetTenantId(c), startTs, endTs, granularity)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetPurchaseRegistrationTrend(c *gin.Context) {
	startTs, endTs := getAnalyticsTimeRange(c)
	granularity := c.DefaultQuery("granularity", "day")
	result, err := model.GetRegistrationTrend(middleware.GetTenantId(c), startTs, endTs, granularity)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetPurchaseConversionFunnel(c *gin.Context) {
	startTs, endTs := getAnalyticsTimeRange(c)
	result, err := model.GetConversionFunnel(middleware.GetTenantId(c), startTs, endTs)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetPurchaseReferralAnalytics(c *gin.Context) {
	startTs, endTs := getAnalyticsTimeRange(c)
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if limit <= 0 {
		limit = 20
	}
	result, err := model.GetReferralAnalytics(middleware.GetTenantId(c), startTs, endTs, limit)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
