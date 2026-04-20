package model

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

type ChannelMonitorData struct {
	Groups    []ChannelMonitorGroup `json:"groups"`
	UpdatedAt int64                 `json:"updated_at"`
}

type ChannelMonitorGroup struct {
	GroupName           string               `json:"group_name"`
	GroupKey            string               `json:"group_key"`
	Channels            []ChannelMonitorItem `json:"channels"`
	TotalCount          int                  `json:"total_count"`
	NormalCount         int                  `json:"normal_count"`
	DegradedCount       int                  `json:"degraded_count"`
	ErrorCount          int                  `json:"error_count"`
	HealthStatus        string               `json:"health_status"`
	HealthReason        string               `json:"health_reason"`
	AvgAvailabilityRate float64              `json:"avg_availability_rate"`
	AvgCacheHitRate     float64              `json:"avg_cache_hit_rate"`
	History             []ChannelMetricPoint `json:"history"`
}

type ChannelMonitorItem struct {
	ChannelId        int     `json:"channel_id"`
	Name             string  `json:"name"`
	Group            string  `json:"group"`
	Models           string  `json:"models"`
	Status           int     `json:"status"`
	ResponseTimeMs   int     `json:"response_time_ms"`
	TestTime         int64   `json:"test_time"`
	Balance          float64 `json:"balance"`
	AvailabilityRate float64 `json:"availability_rate"`
	UsedQuota1h      int64   `json:"used_quota_1h"`
}

type ChannelMetricPoint struct {
	Ts                int64   `json:"ts"`
	AvailabilityRate  float64 `json:"availability_rate"`
	CacheHitRate      float64 `json:"cache_hit_rate"`
	RequestCount      int64   `json:"request_count"`
	SuccessCount      int64   `json:"success_count"`
	ErrorCount        int64   `json:"error_count"`
	PromptTokens      int64   `json:"prompt_tokens"`
	CacheTokens       int64   `json:"cache_tokens"`
	UsedPreviousValue bool    `json:"used_previous_value"`
}

type channelMonitorVisibilityOption struct {
	HiddenChannelIDs []int `json:"hidden_channel_ids"`
}

// GetChannelMonitorData returns channel metrics grouped by channel group tag.
// channel.Group is comma-separated (e.g. "default,SLA,smartcache"); each channel
// appears in each of its group tags. Group-level cache_hit_rate and availability
// are computed from the aggregate of all channels in the group.
func GetChannelMonitorData(tenantId int) (*ChannelMonitorData, error) {
	now := time.Now().Unix()
	oneHourAgo := now - 3600
	nowMinute := now / 60 * 60
	minuteCount := 60
	bucketStart := nowMinute - int64((minuteCount-1)*60)

	hiddenChannelIDs, err := getHiddenChannelIDSet()
	if err != nil {
		return nil, err
	}

	var channels []Channel
	chQuery := DB.Where("status = ?", common.ChannelStatusEnabled)
	if tenantId > 0 {
		chQuery = chQuery.Where("tenant_id = ?", tenantId)
	}
	if err := chQuery.Find(&channels).Error; err != nil {
		return nil, err
	}

	filteredChannels := make([]Channel, 0, len(channels))
	for _, ch := range channels {
		if hiddenChannelIDs[ch.Id] {
			continue
		}
		filteredChannels = append(filteredChannels, ch)
	}
	if len(filteredChannels) == 0 {
		return &ChannelMonitorData{Groups: []ChannelMonitorGroup{}, UpdatedAt: now}, nil
	}

	type rawLog struct {
		ChannelID    int    `gorm:"column:channel_id"`
		Type         int    `gorm:"column:type"`
		CreatedAt    int64  `gorm:"column:created_at"`
		PromptTokens int    `gorm:"column:prompt_tokens"`
		Quota        int    `gorm:"column:quota"`
		Other        string `gorm:"column:other"`
	}

	var logs []rawLog
	logQuery := LOG_DB.Table("logs").
		Select("channel_id, type, created_at, prompt_tokens, quota, other").
		Where("created_at >= ? AND channel_id > 0 AND (type = ? OR type = ?)", oneHourAgo, LogTypeConsume, LogTypeError)
	if tenantId > 0 {
		logQuery = logQuery.Where("tenant_id = ?", tenantId)
	}
	if err := logQuery.Find(&logs).Error; err != nil {
		return nil, err
	}

	type chMetrics struct {
		successCount int64
		errorCount   int64
		usedQuota    int64
		promptTokens int64
		cacheTokens  int64
	}

	type minuteKey struct {
		channelID int
		bucket    int64
	}

	chMetricsMap := make(map[int]*chMetrics)
	minuteMetrics := make(map[minuteKey]*chMetrics)
	allowedChannelIDs := make(map[int]bool, len(filteredChannels))
	for _, ch := range filteredChannels {
		allowedChannelIDs[ch.Id] = true
	}

	for _, log := range logs {
		if !allowedChannelIDs[log.ChannelID] {
			continue
		}

		m := chMetricsMap[log.ChannelID]
		if m == nil {
			m = &chMetrics{}
			chMetricsMap[log.ChannelID] = m
		}
		if log.Type == LogTypeConsume {
			m.successCount++
			m.usedQuota += int64(log.Quota)
			m.promptTokens += int64(log.PromptTokens)
			m.cacheTokens += extractCacheTokens(log.Other)
		} else if log.Type == LogTypeError {
			m.errorCount++
		}

		bucket := log.CreatedAt / 60 * 60
		key := minuteKey{channelID: log.ChannelID, bucket: bucket}
		mm := minuteMetrics[key]
		if mm == nil {
			mm = &chMetrics{}
			minuteMetrics[key] = mm
		}
		if log.Type == LogTypeConsume {
			mm.successCount++
			mm.usedQuota += int64(log.Quota)
			mm.promptTokens += int64(log.PromptTokens)
			mm.cacheTokens += extractCacheTokens(log.Other)
		} else if log.Type == LogTypeError {
			mm.errorCount++
		}
	}

	type chItem struct {
		item         ChannelMonitorItem
		healthStatus string
	}

	type groupTotals struct {
		successCount int64
		errorCount   int64
		promptTokens int64
		cacheTokens  int64
	}

	groupItems := make(map[string][]chItem)
	groupAggregateTotals := make(map[string]groupTotals)
	groupMinuteTotals := make(map[string]map[int64]*chMetrics)

	for _, ch := range filteredChannels {
		m := chMetricsMap[ch.Id]
		if m == nil {
			m = &chMetrics{}
		}

		total := m.successCount + m.errorCount
		availRate := 0.0
		if total > 0 {
			availRate = float64(m.successCount) / float64(total)
		}
		healthStatus := classifyChannelHealth(m.successCount, m.errorCount)

		item := ChannelMonitorItem{
			ChannelId:        ch.Id,
			Name:             ch.Name,
			Group:            ch.Group,
			Models:           ch.Models,
			Status:           ch.Status,
			ResponseTimeMs:   ch.ResponseTime,
			TestTime:         ch.TestTime,
			Balance:          ch.Balance,
			AvailabilityRate: availRate,
			UsedQuota1h:      m.usedQuota,
		}

		tags := splitGroupTags(ch.Group)
		for _, tag := range tags {
			groupItems[tag] = append(groupItems[tag], chItem{item: item, healthStatus: healthStatus})

			gt := groupAggregateTotals[tag]
			gt.successCount += m.successCount
			gt.errorCount += m.errorCount
			gt.promptTokens += m.promptTokens
			gt.cacheTokens += m.cacheTokens
			groupAggregateTotals[tag] = gt

			if groupMinuteTotals[tag] == nil {
				groupMinuteTotals[tag] = make(map[int64]*chMetrics)
			}
			gmb := groupMinuteTotals[tag]
			for i := 0; i < minuteCount; i++ {
				bucket := bucketStart + int64(i)*60
				key := minuteKey{channelID: ch.Id, bucket: bucket}
				mm := minuteMetrics[key]
				if mm == nil {
					continue
				}
				bucketMetrics := gmb[bucket]
				if bucketMetrics == nil {
					bucketMetrics = &chMetrics{}
					gmb[bucket] = bucketMetrics
				}
				bucketMetrics.successCount += mm.successCount
				bucketMetrics.errorCount += mm.errorCount
				bucketMetrics.usedQuota += mm.usedQuota
				bucketMetrics.promptTokens += mm.promptTokens
				bucketMetrics.cacheTokens += mm.cacheTokens
			}
		}
	}

	groupHistory := make(map[string][]ChannelMetricPoint)
	for tag := range groupItems {
		history := make([]ChannelMetricPoint, minuteCount)
		gmb := groupMinuteTotals[tag]
		previousAvailabilityRate := 0.0
		previousCacheRate := -1.0
		for i := 0; i < minuteCount; i++ {
			bucket := bucketStart + int64(i)*60
			bm := gmb[bucket]
			availRate := previousAvailabilityRate
			cacheRate := previousCacheRate
			usedPreviousValue := true
			var requestCount, successCount, errorCount, promptTokens, cacheTokens int64
			if bm != nil {
				successCount = bm.successCount
				errorCount = bm.errorCount
				requestCount = successCount + errorCount
				promptTokens = bm.promptTokens
				cacheTokens = bm.cacheTokens
				if requestCount > 0 {
					availRate = float64(successCount) / float64(requestCount)
				}
				if promptTokens > 0 {
					cacheRate = float64(cacheTokens) / float64(promptTokens)
				}
				previousAvailabilityRate = availRate
				previousCacheRate = cacheRate
				usedPreviousValue = false
			}
			history[i] = ChannelMetricPoint{
				Ts:                bucket,
				AvailabilityRate:  availRate,
				CacheHitRate:      cacheRate,
				RequestCount:      requestCount,
				SuccessCount:      successCount,
				ErrorCount:        errorCount,
				PromptTokens:      promptTokens,
				CacheTokens:       cacheTokens,
				UsedPreviousValue: usedPreviousValue,
			}
		}
		groupHistory[tag] = history
	}

	groups := make([]ChannelMonitorGroup, 0, len(groupItems))
	for tag, items := range groupItems {
		channels := make([]ChannelMonitorItem, 0, len(items))
		normalCount := 0
		degradedCount := 0
		errorCount := 0
		for _, im := range items {
			channels = append(channels, im.item)
			switch im.healthStatus {
			case "normal":
				normalCount++
			case "degraded":
				degradedCount++
			default:
				errorCount++
			}
		}

		gt := groupAggregateTotals[tag]
		total := gt.successCount + gt.errorCount
		avgAvail := 0.0
		if total > 0 {
			avgAvail = float64(gt.successCount) / float64(total)
		}
		avgCache := -1.0
		if gt.promptTokens > 0 {
			avgCache = float64(gt.cacheTokens) / float64(gt.promptTokens)
		}

		groupName := tag
		if tag == "default" {
			groupName = "默认分组"
		}

		sort.Slice(channels, func(i, j int) bool {
			return channels[i].Name < channels[j].Name
		})

		healthStatus, healthReason := buildGroupHealth(normalCount, degradedCount, errorCount, total)
		groups = append(groups, ChannelMonitorGroup{
			GroupName:           groupName,
			GroupKey:            tag,
			Channels:            channels,
			TotalCount:          len(channels),
			NormalCount:         normalCount,
			DegradedCount:       degradedCount,
			ErrorCount:          errorCount,
			HealthStatus:        healthStatus,
			HealthReason:        healthReason,
			AvgAvailabilityRate: avgAvail,
			AvgCacheHitRate:     avgCache,
			History:             groupHistory[tag],
		})
	}

	sort.Slice(groups, func(i, j int) bool {
		return groups[i].GroupName < groups[j].GroupName
	})

	return &ChannelMonitorData{
		Groups:    groups,
		UpdatedAt: now,
	}, nil
}

func getHiddenChannelIDSet() (map[int]bool, error) {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap["ChannelMonitorVisibility"]
	common.OptionMapRWMutex.RUnlock()

	hiddenChannelIDs := make(map[int]bool)
	if strings.TrimSpace(raw) == "" {
		return hiddenChannelIDs, nil
	}

	var option channelMonitorVisibilityOption
	if err := json.Unmarshal([]byte(raw), &option); err != nil {
		return nil, fmt.Errorf("invalid ChannelMonitorVisibility option: %w", err)
	}
	for _, channelID := range option.HiddenChannelIDs {
		if channelID > 0 {
			hiddenChannelIDs[channelID] = true
		}
	}
	return hiddenChannelIDs, nil
}

func extractCacheTokens(other string) int64 {
	if other == "" {
		return 0
	}
	om, err := common.StrToMap(other)
	if err != nil || om == nil {
		return 0
	}
	ct := getFloat64FromMap(om, "cache_tokens")
	if ct <= 0 {
		return 0
	}
	return int64(ct)
}

const (
	monitorMinSample          int64   = 10
	monitorDegradedErrorRate  float64 = 0.05
	monitorAbnormalErrorRate  float64 = 0.20
	monitorHardFailMinRequest int64   = 3
)

func classifyChannelHealth(successCount, errorCount int64) string {
	total := successCount + errorCount
	if total == 0 {
		return "degraded"
	}
	if total >= monitorHardFailMinRequest && successCount == 0 && errorCount > 0 {
		return "abnormal"
	}
	if total < monitorMinSample {
		if errorCount > 0 {
			return "degraded"
		}
		return "normal"
	}

	errorRate := float64(errorCount) / float64(total)
	if errorRate >= monitorAbnormalErrorRate {
		return "abnormal"
	}
	if errorRate >= monitorDegradedErrorRate {
		return "degraded"
	}
	return "normal"
}

func buildGroupHealth(normalCount, degradedCount, errorCount int, requestTotal int64) (string, string) {
	totalCount := normalCount + degradedCount + errorCount
	if errorCount > 0 {
		return "abnormal", fmt.Sprintf("%d abnormal, %d degraded, %d normal channels in recent monitor window", errorCount, degradedCount, normalCount)
	}
	if degradedCount > 0 {
		if requestTotal == 0 && normalCount == 0 {
			return "degraded", "No recent monitor traffic in the last hour"
		}
		return "degraded", fmt.Sprintf("%d degraded, %d normal channels in recent monitor window", degradedCount, normalCount)
	}
	return "normal", fmt.Sprintf("All %d channels healthy in recent monitor window", totalCount)
}

// splitGroupTags splits a comma-separated group string into individual tags,
// filtering out empty strings and trimming whitespace.
func splitGroupTags(group string) []string {
	if group == "" {
		return []string{}
	}
	var tags []string
	for _, t := range strings.Split(group, ",") {
		t = strings.TrimSpace(t)
		if t != "" {
			tags = append(tags, t)
		}
	}
	if len(tags) == 0 {
		return []string{""} // treat empty as "default"
	}
	return tags
}
