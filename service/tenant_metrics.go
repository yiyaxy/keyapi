package service

import (
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
)

type TenantMetricsSummary struct {
	TenantId       int   `json:"tenant_id"`
	TotalMembers   int64 `json:"total_members"`
	ActiveMembers  int64 `json:"active_members"`
	TotalTokens    int64 `json:"total_tokens"`
	ActiveTokens   int64 `json:"active_tokens"`
	TotalChannels  int64 `json:"total_channels"`
	ActiveChannels int64 `json:"active_channels"`
	TotalQuotaUsed int64 `json:"total_quota_used"`
	TotalRequests  int64 `json:"total_requests"`
	TodayQuotaUsed int64 `json:"today_quota_used"`
	TodayRequests  int64 `json:"today_requests"`
}

func GetTenantMetrics(tenantId int) (*TenantMetricsSummary, error) {
	summary := &TenantMetricsSummary{TenantId: tenantId}

	// 每次查询都从 WithTenantBypass(DB) 重新开始一条独立链路，
	// 不能复用同一个 *gorm.DB —— 否则 Where/Table 会在同一 Statement 上累积，
	// 下一次调用继承上次遗留的 WHERE 条件，导致类似
	// "column deleted_at does not exist" 这种跨表污染的怪异报错。
	freshDB := func() *gorm.DB {
		return model.WithTenantBypass(model.DB)
	}

	// Total members (not removed)
	if err := freshDB().Table("tenant_memberships").
		Where("tenant_id = ? AND status <> ?", tenantId, model.TenantMembershipStatusRemoved).
		Where("deleted_at IS NULL").
		Count(&summary.TotalMembers).Error; err != nil {
		return nil, err
	}

	// Active members
	if err := freshDB().Table("tenant_memberships").
		Where("tenant_id = ? AND status = ?", tenantId, model.TenantMembershipStatusActive).
		Where("deleted_at IS NULL").
		Count(&summary.ActiveMembers).Error; err != nil {
		return nil, err
	}

	// Total tokens
	if err := freshDB().Table("tokens").
		Where("tenant_id = ? AND deleted_at IS NULL", tenantId).
		Count(&summary.TotalTokens).Error; err != nil {
		return nil, err
	}

	// Active tokens (status = enabled)
	if err := freshDB().Table("tokens").
		Where("tenant_id = ? AND status = ? AND deleted_at IS NULL", tenantId, common.TokenStatusEnabled).
		Count(&summary.ActiveTokens).Error; err != nil {
		return nil, err
	}

	// Total channels（channels 表走硬删除，无 deleted_at 列）
	if err := freshDB().Table("channels").
		Where("tenant_id = ?", tenantId).
		Count(&summary.TotalChannels).Error; err != nil {
		return nil, err
	}

	// Active channels (status = enabled)
	if err := freshDB().Table("channels").
		Where("tenant_id = ? AND status = ?", tenantId, common.ChannelStatusEnabled).
		Count(&summary.ActiveChannels).Error; err != nil {
		return nil, err
	}

	// Total quota used and request count from logs
	logDB := model.LOG_DB
	var totalStats struct {
		Quota    int64
		Requests int64
	}
	if err := logDB.Table("logs").
		Select("COALESCE(SUM(quota), 0) as quota, COUNT(*) as requests").
		Where("tenant_id = ? AND type = ?", tenantId, model.LogTypeConsume).
		Scan(&totalStats).Error; err != nil {
		return nil, err
	}
	summary.TotalQuotaUsed = totalStats.Quota
	summary.TotalRequests = totalStats.Requests

	// Today's stats
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	todayTimestamp := todayStart.Unix()

	var todayStats struct {
		Quota    int64
		Requests int64
	}
	if err := logDB.Table("logs").
		Select("COALESCE(SUM(quota), 0) as quota, COUNT(*) as requests").
		Where("tenant_id = ? AND type = ? AND created_at >= ?", tenantId, model.LogTypeConsume, todayTimestamp).
		Scan(&todayStats).Error; err != nil {
		return nil, err
	}
	summary.TodayQuotaUsed = todayStats.Quota
	summary.TodayRequests = todayStats.Requests

	return summary, nil
}

type TenantUsageTrend struct {
	Date         string `json:"date"`
	QuotaUsed    int64  `json:"quota_used"`
	RequestCount int64  `json:"request_count"`
}

func GetTenantUsageTrend(tenantId int, days int) ([]TenantUsageTrend, error) {
	if days <= 0 {
		days = 7
	}
	if days > 90 {
		days = 90
	}

	now := time.Now()
	startDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).AddDate(0, 0, -days+1)
	startTimestamp := startDay.Unix()

	logDB := model.LOG_DB

	// Use portable date grouping: divide unix timestamp by 86400 to get day number,
	// then reconstruct. Works on both MySQL and SQLite.
	var rows []struct {
		DayNum       int64 `gorm:"column:day_num"`
		QuotaUsed    int64 `gorm:"column:quota_used"`
		RequestCount int64 `gorm:"column:request_count"`
	}

	if err := logDB.Table("logs").
		Select("(created_at / 86400) as day_num, COALESCE(SUM(quota), 0) as quota_used, COUNT(*) as request_count").
		Where("tenant_id = ? AND type = ? AND created_at >= ?", tenantId, model.LogTypeConsume, startTimestamp).
		Group("created_at / 86400").
		Order("day_num ASC").
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	// Build a map from day_num to data
	dataMap := make(map[int64]*TenantUsageTrend, len(rows))
	for i := range rows {
		t := time.Unix(rows[i].DayNum*86400, 0).UTC()
		dateStr := t.Format("2006-01-02")
		dataMap[rows[i].DayNum] = &TenantUsageTrend{
			Date:         dateStr,
			QuotaUsed:    rows[i].QuotaUsed,
			RequestCount: rows[i].RequestCount,
		}
	}

	// Fill all days in range
	result := make([]TenantUsageTrend, 0, days)
	for i := 0; i < days; i++ {
		day := startDay.AddDate(0, 0, i)
		dayNum := day.Unix() / 86400
		dateStr := day.Format("2006-01-02")
		if entry, ok := dataMap[dayNum]; ok {
			entry.Date = dateStr // ensure consistent formatting
			result = append(result, *entry)
		} else {
			result = append(result, TenantUsageTrend{
				Date:         dateStr,
				QuotaUsed:    0,
				RequestCount: 0,
			})
		}
	}

	return result, nil
}

type TenantModelUsage struct {
	ModelName    string `json:"model_name"`
	RequestCount int64  `json:"request_count"`
	QuotaUsed    int64  `json:"quota_used"`
}

func GetTenantModelUsage(tenantId int, startTime, endTime int64) ([]TenantModelUsage, error) {
	logDB := model.LOG_DB

	var results []TenantModelUsage
	query := logDB.Table("logs").
		Select("model_name, COUNT(*) as request_count, COALESCE(SUM(quota), 0) as quota_used").
		Where("tenant_id = ? AND type = ?", tenantId, model.LogTypeConsume)

	if startTime > 0 {
		query = query.Where("created_at >= ?", startTime)
	}
	if endTime > 0 {
		query = query.Where("created_at <= ?", endTime)
	}

	if err := query.
		Where("model_name <> ''").
		Group("model_name").
		Order("quota_used DESC").
		Scan(&results).Error; err != nil {
		return nil, err
	}

	return results, nil
}
