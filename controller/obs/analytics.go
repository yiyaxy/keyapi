package obs

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func getAnalyticsTimeRange(c *gin.Context) (int64, int64) {
	startTs, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTs, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	return startTs, endTs
}

func GetAnalyticsByChannel(c *gin.Context) {
	startTs, endTs := getAnalyticsTimeRange(c)
	result, err := model.SumQuotaByChannel(startTs, endTs, middleware.GetTenantId(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetAnalyticsByModel(c *gin.Context) {
	startTs, endTs := getAnalyticsTimeRange(c)
	result, err := model.SumQuotaByModel(startTs, endTs, middleware.GetTenantId(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetAnalyticsByUser(c *gin.Context) {
	startTs, endTs := getAnalyticsTimeRange(c)
	result, err := model.SumQuotaByUser(startTs, endTs, middleware.GetTenantId(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetSiteRPM(c *gin.Context) {
	windowSeconds, _ := strconv.ParseInt(c.DefaultQuery("window_seconds", "60"), 10, 64)
	result, err := model.GetSiteRPM(windowSeconds, middleware.GetTenantId(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetSiteRPMHistory(c *gin.Context) {
	windowSeconds, _ := strconv.Atoi(c.DefaultQuery("window_seconds", "60"))
	rangeSeconds, _ := strconv.ParseInt(c.DefaultQuery("range_seconds", "1800"), 10, 64)
	since, _ := strconv.ParseInt(c.Query("since"), 10, 64)
	startTs, endTs := getAnalyticsTimeRange(c)

	snapshots, err := model.GetSiteRPMHistory(windowSeconds, rangeSeconds, since, startTs, endTs)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	var latestTs int64
	series := make([]map[string]interface{}, 0, len(snapshots))
	for _, s := range snapshots {
		if s.CreatedAt > latestTs {
			latestTs = s.CreatedAt
		}
		series = append(series, map[string]interface{}{
			"ts":         s.CreatedAt,
			"site_label": s.SiteLabel,
			"rpm":        s.RPM,
		})
	}

	common.ApiSuccess(c, gin.H{
		"window_seconds":  windowSeconds,
		"range_seconds":   rangeSeconds,
		"start_timestamp": startTs,
		"end_timestamp":   endTs,
		"step_seconds":    5,
		"latest_ts":       latestTs,
		"series":          series,
	})
}

func GetChannelMonitor(c *gin.Context) {
	data, err := model.GetChannelMonitorData(middleware.GetTenantId(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, data)
}
