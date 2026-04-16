package model

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"

	"github.com/bytedance/gopkg/util/gopool"
	"gorm.io/gorm"
)

type Log struct {
	Id               int    `json:"id" gorm:"index:idx_created_at_id,priority:1;index:idx_user_id_id,priority:2"`
	TenantId         int    `json:"tenant_id" gorm:"index;not null;default:1"`
	UserId           int    `json:"user_id" gorm:"index;index:idx_user_id_id,priority:1"`
	CreatedAt        int64  `json:"created_at" gorm:"bigint;index:idx_created_at_id,priority:2;index:idx_created_at_type"`
	Type             int    `json:"type" gorm:"index:idx_created_at_type"`
	Content          string `json:"content"`
	Username         string `json:"username" gorm:"index;index:index_username_model_name,priority:2;default:''"`
	TokenName        string `json:"token_name" gorm:"index;default:''"`
	ModelName        string `json:"model_name" gorm:"index;index:index_username_model_name,priority:1;default:''"`
	Quota            int    `json:"quota" gorm:"default:0"`
	PromptTokens     int    `json:"prompt_tokens" gorm:"default:0"`
	CompletionTokens int    `json:"completion_tokens" gorm:"default:0"`
	UseTime          int    `json:"use_time" gorm:"default:0"`
	IsStream         bool   `json:"is_stream"`
	ChannelId        int    `json:"channel" gorm:"index"`
	ChannelName      string `json:"channel_name" gorm:"->"`
	TokenId          int    `json:"token_id" gorm:"default:0;index"`
	Group            string `json:"group" gorm:"index"`
	Ip               string `json:"ip" gorm:"index;default:''"`
	RequestId        string `json:"request_id,omitempty" gorm:"type:varchar(64);index:idx_logs_request_id;default:''"`
	Other            string `json:"other"`
}

// don't use iota, avoid change log type value
const (
	LogTypeUnknown = 0
	LogTypeTopup   = 1
	LogTypeConsume = 2
	LogTypeManage  = 3
	LogTypeSystem  = 4
	LogTypeError   = 5
	LogTypeRefund  = 6
)

func formatUserLogs(logs []*Log, startIdx int) {
	for i := range logs {
		logs[i].ChannelName = ""
		var otherMap map[string]interface{}
		otherMap, _ = common.StrToMap(logs[i].Other)
		if otherMap != nil {
			// Remove admin-only debug fields.
			delete(otherMap, "admin_info")
			// delete(otherMap, "reject_reason")
			delete(otherMap, "stream_status")
		}
		logs[i].Other = common.MapToJsonStr(otherMap)
		logs[i].Id = startIdx + i + 1
	}
}

func GetLogByTokenId(tokenId int) (logs []*Log, err error) {
	err = LOG_DB.Model(&Log{}).Where("token_id = ?", tokenId).Order("id desc").Limit(common.MaxRecentItems).Find(&logs).Error
	formatUserLogs(logs, 0)
	return logs, err
}

// tenantIdFromGinContext extracts tenant_id from gin.Context without importing middleware.
func tenantIdFromGinContext(c *gin.Context) int {
	if c == nil {
		return DefaultTenantId
	}
	if tid, exists := c.Get("tenant_id"); exists {
		if id, ok := tid.(int); ok && id > 0 {
			return id
		}
	}
	return DefaultTenantId
}

func RecordLog(userId int, logType int, content string) {
	RecordLogWithTenant(DefaultTenantId, userId, logType, content)
}

// RecordLogCtx records a log entry with tenant_id extracted from gin.Context.
// Use this instead of RecordLog in all controller/handler code.
func RecordLogCtx(c *gin.Context, userId int, logType int, content string) {
	RecordLogWithTenant(tenantIdFromGinContext(c), userId, logType, content)
}

// RecordLogWithTenant records a log entry with explicit tenant_id.
func RecordLogWithTenant(tenantId int, userId int, logType int, content string) {
	if logType == LogTypeConsume && !common.LogConsumeEnabled {
		return
	}
	username, _ := GetUsernameById(userId, false)
	log := &Log{
		TenantId:  tenantId,
		UserId:    userId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      logType,
		Content:   content,
	}
	err := LOG_DB.Create(log).Error
	if err != nil {
		common.SysLog("failed to record log: " + err.Error())
	}
}

// RecordTopUpLog records a topup log with quota amount.
// This ensures the quota field is properly set for topup records.
func RecordTopUpLog(userId int, quota int, content string) {
	RecordTopUpLogWithTenant(DefaultTenantId, userId, quota, content)
}

// RecordTopUpLogWithTenant records a topup log entry with explicit tenant_id.
func RecordTopUpLogWithTenant(tenantId int, userId int, quota int, content string) {
	username, _ := GetUsernameById(userId, false)
	log := &Log{
		TenantId:  tenantId,
		UserId:    userId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      LogTypeTopup,
		Content:   content,
		Quota:     quota,
	}
	err := LOG_DB.Create(log).Error
	if err != nil {
		common.SysLog("failed to record topup log: " + err.Error())
	}
}

func RecordErrorLog(c *gin.Context, userId int, channelId int, modelName string, tokenName string, content string, tokenId int, useTimeSeconds int,
	isStream bool, group string, other map[string]interface{}) {
	logger.LogInfo(c, fmt.Sprintf("record error log: userId=%d, channelId=%d, modelName=%s, tokenName=%s, content=%s", userId, channelId, modelName, tokenName, content))
	username := c.GetString("username")
	requestId := c.GetString(common.RequestIdKey)
	otherStr := common.MapToJsonStr(other)
	log := &Log{
		TenantId:         tenantIdFromGinContext(c),
		UserId:           userId,
		Username:         username,
		CreatedAt:        common.GetTimestamp(),
		Type:             LogTypeError,
		Content:          content,
		PromptTokens:     0,
		CompletionTokens: 0,
		TokenName:        tokenName,
		ModelName:        modelName,
		Quota:            0,
		ChannelId:        channelId,
		TokenId:          tokenId,
		UseTime:          useTimeSeconds,
		IsStream:         isStream,
		Group:            group,
		Ip:               c.ClientIP(),
		RequestId:        requestId,
		Other:            otherStr,
	}
	err := LOG_DB.Create(log).Error
	if err != nil {
		logger.LogError(c, "failed to record log: "+err.Error())
	}
}

type RecordConsumeLogParams struct {
	ChannelId        int                    `json:"channel_id"`
	PromptTokens     int                    `json:"prompt_tokens"`
	CompletionTokens int                    `json:"completion_tokens"`
	ModelName        string                 `json:"model_name"`
	TokenName        string                 `json:"token_name"`
	Quota            int                    `json:"quota"`
	Content          string                 `json:"content"`
	TokenId          int                    `json:"token_id"`
	UseTimeSeconds   int                    `json:"use_time_seconds"`
	IsStream         bool                   `json:"is_stream"`
	Group            string                 `json:"group"`
	Other            map[string]interface{} `json:"other"`
}

func RecordConsumeLog(c *gin.Context, userId int, params RecordConsumeLogParams) {
	if !common.LogConsumeEnabled {
		return
	}
	logger.LogInfo(c, fmt.Sprintf("record consume log: userId=%d, params=%s", userId, common.GetJsonString(params)))
	username := c.GetString("username")
	requestId := c.GetString(common.RequestIdKey)
	otherStr := common.MapToJsonStr(params.Other)
	log := &Log{
		TenantId:         tenantIdFromGinContext(c),
		UserId:           userId,
		Username:         username,
		CreatedAt:        common.GetTimestamp(),
		Type:             LogTypeConsume,
		Content:          params.Content,
		PromptTokens:     params.PromptTokens,
		CompletionTokens: params.CompletionTokens,
		TokenName:        params.TokenName,
		ModelName:        params.ModelName,
		Quota:            params.Quota,
		ChannelId:        params.ChannelId,
		TokenId:          params.TokenId,
		UseTime:          params.UseTimeSeconds,
		IsStream:         params.IsStream,
		Group:            params.Group,
		Ip:               c.ClientIP(),
		RequestId:        requestId,
		Other:            otherStr,
	}
	err := LOG_DB.Create(log).Error
	if err != nil {
		logger.LogError(c, "failed to record log: "+err.Error())
	}
	if common.DataExportEnabled {
		gopool.Go(func() {
			LogQuotaData(userId, username, params.ModelName, params.Quota, common.GetTimestamp(), params.PromptTokens+params.CompletionTokens)
		})
	}
}

type RecordTaskBillingLogParams struct {
	UserId    int
	LogType   int
	Content   string
	ChannelId int
	ModelName string
	Quota     int
	TokenId   int
	Group     string
	Other     map[string]interface{}
}

func RecordTaskBillingLog(params RecordTaskBillingLogParams) {
	if params.LogType == LogTypeConsume && !common.LogConsumeEnabled {
		return
	}
	username, _ := GetUsernameById(params.UserId, false)
	tokenName := ""
	if params.TokenId > 0 {
		if token, err := GetTokenById(params.TokenId); err == nil {
			tokenName = token.Name
		}
	}
	log := &Log{
		UserId:    params.UserId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      params.LogType,
		Content:   params.Content,
		TokenName: tokenName,
		ModelName: params.ModelName,
		Quota:     params.Quota,
		ChannelId: params.ChannelId,
		TokenId:   params.TokenId,
		Group:     params.Group,
		Other:     common.MapToJsonStr(params.Other),
	}
	err := LOG_DB.Create(log).Error
	if err != nil {
		common.SysLog("failed to record task billing log: " + err.Error())
	}
}

func GetAllLogs(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string, startIdx int, num int, channel int, group string, requestId string, ip string) (logs []*Log, total int64, err error) {
	var tx *gorm.DB
	if logType == LogTypeUnknown {
		tx = LOG_DB
	} else {
		tx = LOG_DB.Where("logs.type = ?", logType)
	}

	if modelName != "" {
		tx = tx.Where("logs.model_name like ?", modelName)
	}
	if username != "" {
		tx = tx.Where("logs.username = ?", username)
	}
	if tokenName != "" {
		tx = tx.Where("logs.token_name = ?", tokenName)
	}
	if requestId != "" {
		tx = tx.Where("logs.request_id = ?", requestId)
	}
	if startTimestamp != 0 {
		tx = tx.Where("logs.created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("logs.created_at <= ?", endTimestamp)
	}
	if channel != 0 {
		tx = tx.Where("logs.channel_id = ?", channel)
	}
	if group != "" {
		tx = tx.Where("logs."+logGroupCol+" = ?", group)
	}
	if ip != "" {
		tx = tx.Where("logs.ip = ?", ip)
	}
	err = tx.Model(&Log{}).Count(&total).Error
	if err != nil {
		return nil, 0, err
	}
	err = tx.Order("logs.id desc").Limit(num).Offset(startIdx).Find(&logs).Error
	if err != nil {
		return nil, 0, err
	}

	channelIds := types.NewSet[int]()
	for _, log := range logs {
		if log.ChannelId != 0 {
			channelIds.Add(log.ChannelId)
		}
	}

	if channelIds.Len() > 0 {
		var channels []struct {
			Id   int    `gorm:"column:id"`
			Name string `gorm:"column:name"`
		}
		if common.MemoryCacheEnabled {
			// Cache get channel
			for _, channelId := range channelIds.Items() {
				if cacheChannel, err := CacheGetChannel(channelId); err == nil {
					channels = append(channels, struct {
						Id   int    `gorm:"column:id"`
						Name string `gorm:"column:name"`
					}{
						Id:   channelId,
						Name: cacheChannel.Name,
					})
				}
			}
		} else {
			// Bulk query channels from DB
			if err = DB.Table("channels").Select("id, name").Where("id IN ?", channelIds.Items()).Find(&channels).Error; err != nil {
				return logs, total, err
			}
		}
		channelMap := make(map[int]string, len(channels))
		for _, channel := range channels {
			channelMap[channel.Id] = channel.Name
		}
		for i := range logs {
			logs[i].ChannelName = channelMap[logs[i].ChannelId]
		}
	}

	return logs, total, err
}

const logSearchCountLimit = 10000

func GetUserLogs(userId int, logType int, startTimestamp int64, endTimestamp int64, modelName string, tokenName string, startIdx int, num int, group string, requestId string) (logs []*Log, total int64, err error) {
	var tx *gorm.DB
	if logType == LogTypeUnknown {
		tx = LOG_DB.Where("logs.user_id = ?", userId)
	} else {
		tx = LOG_DB.Where("logs.user_id = ? and logs.type = ?", userId, logType)
	}

	if modelName != "" {
		modelNamePattern, err := sanitizeLikePattern(modelName)
		if err != nil {
			return nil, 0, err
		}
		tx = tx.Where("logs.model_name LIKE ? ESCAPE '!'", modelNamePattern)
	}
	if tokenName != "" {
		tx = tx.Where("logs.token_name = ?", tokenName)
	}
	if requestId != "" {
		tx = tx.Where("logs.request_id = ?", requestId)
	}
	if startTimestamp != 0 {
		tx = tx.Where("logs.created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("logs.created_at <= ?", endTimestamp)
	}
	if group != "" {
		tx = tx.Where("logs."+logGroupCol+" = ?", group)
	}
	err = tx.Model(&Log{}).Limit(logSearchCountLimit).Count(&total).Error
	if err != nil {
		common.SysError("failed to count user logs: " + err.Error())
		return nil, 0, errors.New("查询日志失败")
	}
	err = tx.Order("logs.id desc").Limit(num).Offset(startIdx).Find(&logs).Error
	if err != nil {
		common.SysError("failed to search user logs: " + err.Error())
		return nil, 0, errors.New("查询日志失败")
	}

	formatUserLogs(logs, startIdx)
	return logs, total, err
}

type Stat struct {
	Quota                  int   `json:"quota"`
	Rpm                    int   `json:"rpm"`
	Tpm                    int   `json:"tpm"`
	TotalRequests          int64 `json:"total_requests"`
	TotalTokens            int64 `json:"total_tokens"`
	SmartCacheSavingsQuota int64 `json:"smartcache_savings_quota"`
}

func SumUsedQuota(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string, channel int, group string, tenantId int) (stat Stat, err error) {
	_ = logType
	tx := LOG_DB.Table("logs").Select("COALESCE(sum(quota), 0) as quota")
	rpmTpmQuery := LOG_DB.Table("logs").Select("count(*) as rpm, COALESCE(sum(prompt_tokens), 0) + COALESCE(sum(completion_tokens), 0) as tpm")
	totalUsageQuery := LOG_DB.Table("logs").Select("count(*) as total_requests, COALESCE(sum(prompt_tokens), 0) + COALESCE(sum(completion_tokens), 0) as total_tokens")
	savingsQuery := LOG_DB.Table("logs").Select("quota, prompt_tokens, completion_tokens, other")

	if tenantId > 0 {
		tx = tx.Where("tenant_id = ?", tenantId)
		rpmTpmQuery = rpmTpmQuery.Where("tenant_id = ?", tenantId)
		totalUsageQuery = totalUsageQuery.Where("tenant_id = ?", tenantId)
		savingsQuery = savingsQuery.Where("tenant_id = ?", tenantId)
	}

	if username != "" {
		tx = tx.Where("username = ?", username)
		rpmTpmQuery = rpmTpmQuery.Where("username = ?", username)
		totalUsageQuery = totalUsageQuery.Where("username = ?", username)
		savingsQuery = savingsQuery.Where("username = ?", username)
	}
	if tokenName != "" {
		tx = tx.Where("token_name = ?", tokenName)
		rpmTpmQuery = rpmTpmQuery.Where("token_name = ?", tokenName)
		totalUsageQuery = totalUsageQuery.Where("token_name = ?", tokenName)
		savingsQuery = savingsQuery.Where("token_name = ?", tokenName)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
		totalUsageQuery = totalUsageQuery.Where("created_at >= ?", startTimestamp)
		savingsQuery = savingsQuery.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
		totalUsageQuery = totalUsageQuery.Where("created_at <= ?", endTimestamp)
		savingsQuery = savingsQuery.Where("created_at <= ?", endTimestamp)
	}
	if modelName != "" {
		modelNamePattern, err := sanitizeLikePattern(modelName)
		if err != nil {
			return stat, err
		}
		tx = tx.Where("model_name LIKE ? ESCAPE '!'", modelNamePattern)
		rpmTpmQuery = rpmTpmQuery.Where("model_name LIKE ? ESCAPE '!'", modelNamePattern)
		totalUsageQuery = totalUsageQuery.Where("model_name LIKE ? ESCAPE '!'", modelNamePattern)
		savingsQuery = savingsQuery.Where("model_name LIKE ? ESCAPE '!'", modelNamePattern)
	}
	if channel != 0 {
		tx = tx.Where("channel_id = ?", channel)
		rpmTpmQuery = rpmTpmQuery.Where("channel_id = ?", channel)
		totalUsageQuery = totalUsageQuery.Where("channel_id = ?", channel)
		savingsQuery = savingsQuery.Where("channel_id = ?", channel)
	}
	if group != "" {
		tx = tx.Where(logGroupCol+" = ?", group)
		rpmTpmQuery = rpmTpmQuery.Where(logGroupCol+" = ?", group)
		totalUsageQuery = totalUsageQuery.Where(logGroupCol+" = ?", group)
		savingsQuery = savingsQuery.Where(logGroupCol+" = ?", group)
	}

	tx = tx.Where("type = ?", LogTypeConsume)
	rpmTpmQuery = rpmTpmQuery.Where("type = ?", LogTypeConsume)
	totalUsageQuery = totalUsageQuery.Where("type = ?", LogTypeConsume)
	savingsQuery = savingsQuery.Where("type = ?", LogTypeConsume).Where("other LIKE ?", "%cache_tokens%")

	// 只统计最近60秒的rpm和tpm
	rpmTpmQuery = rpmTpmQuery.Where("created_at >= ?", time.Now().Add(-60*time.Second).Unix())

	// Scan each query into its own temporary struct, then merge.
	// Scanning all three into &stat directly would cause each .Scan() to
	// zero-out the fields set by the previous one.
	var quotaStat struct {
		Quota int `gorm:"column:quota"`
	}
	if err := tx.Scan(&quotaStat).Error; err != nil {
		common.SysError("failed to query log stat: " + err.Error())
		return stat, errors.New("查询统计数据失败")
	}

	var rpmTpmStat struct {
		Rpm int `gorm:"column:rpm"`
		Tpm int `gorm:"column:tpm"`
	}
	if err := rpmTpmQuery.Scan(&rpmTpmStat).Error; err != nil {
		common.SysError("failed to query rpm/tpm stat: " + err.Error())
		return stat, errors.New("查询统计数据失败")
	}

	var totalStat struct {
		TotalRequests int64 `gorm:"column:total_requests"`
		TotalTokens   int64 `gorm:"column:total_tokens"`
	}
	if err := totalUsageQuery.Scan(&totalStat).Error; err != nil {
		common.SysError("failed to query total usage stat: " + err.Error())
		return stat, errors.New("查询统计数据失败")
	}

	smartCacheSavingsQuota, err := sumSmartCacheSavingsQuotaFromQuery(savingsQuery)
	if err != nil {
		common.SysError("failed to query smartcache savings stat: " + err.Error())
		return stat, errors.New("查询统计数据失败")
	}

	stat.Quota = quotaStat.Quota
	stat.Rpm = rpmTpmStat.Rpm
	stat.Tpm = rpmTpmStat.Tpm
	stat.TotalRequests = totalStat.TotalRequests
	stat.TotalTokens = totalStat.TotalTokens
	stat.SmartCacheSavingsQuota = smartCacheSavingsQuota

	return stat, nil
}

func SumUsedToken(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string) (token int) {
	tx := LOG_DB.Table("logs").Select("ifnull(sum(prompt_tokens),0) + ifnull(sum(completion_tokens),0)")
	if username != "" {
		tx = tx.Where("username = ?", username)
	}
	if tokenName != "" {
		tx = tx.Where("token_name = ?", tokenName)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if modelName != "" {
		tx = tx.Where("model_name = ?", modelName)
	}
	tx.Where("type = ?", LogTypeConsume).Scan(&token)
	return token
}

func DeleteOldLog(ctx context.Context, targetTimestamp int64, limit int) (int64, error) {
	var total int64 = 0

	for {
		if nil != ctx.Err() {
			return total, ctx.Err()
		}

		result := LOG_DB.Where("created_at < ?", targetTimestamp).Limit(limit).Delete(&Log{})
		if nil != result.Error {
			return total, result.Error
		}

		total += result.RowsAffected

		if result.RowsAffected < int64(limit) {
			break
		}
	}

	return total, nil
}

// ========== Analytics Aggregation ==========

type AnalyticsItem struct {
	Name   string `json:"name" gorm:"column:name"`
	Quota  int64  `json:"quota" gorm:"column:quota"`
	Count  int64  `json:"count" gorm:"column:count"`
	Tokens int64  `json:"tokens" gorm:"column:tokens"`
}

type AnalyticsSummary struct {
	TotalQuota  int64 `json:"total_quota"`
	TotalCount  int64 `json:"total_count"`
	TotalTokens int64 `json:"total_tokens"`
	RPM         int64 `json:"rpm"`
	TPM         int64 `json:"tpm"`
}

type AnalyticsResult struct {
	Items   []AnalyticsItem  `json:"items"`
	Summary AnalyticsSummary `json:"summary"`
}

func buildAnalyticsSummary(items []AnalyticsItem, startTs, endTs int64) AnalyticsSummary {
	var summary AnalyticsSummary
	for _, item := range items {
		summary.TotalQuota += item.Quota
		summary.TotalCount += item.Count
		summary.TotalTokens += item.Tokens
	}
	// RPM/TPM: count requests and tokens in last 60 seconds
	var rpmTpm struct {
		RPM int64 `gorm:"column:rpm"`
		TPM int64 `gorm:"column:tpm"`
	}
	since60s := time.Now().Add(-60 * time.Second).Unix()
	if err := LOG_DB.Table("logs").
		Select("count(*) as rpm, COALESCE(sum(prompt_tokens),0) + COALESCE(sum(completion_tokens),0) as tpm").
		Where("type = ? AND created_at >= ?", LogTypeConsume, since60s).
		Scan(&rpmTpm).Error; err == nil {
		summary.RPM = rpmTpm.RPM
		summary.TPM = rpmTpm.TPM
	}
	return summary
}

func SumQuotaByChannel(startTs, endTs int64, tenantId int) (*AnalyticsResult, error) {
	var items []AnalyticsItem
	tx := LOG_DB.Table("logs").
		Select("logs.channel_id as cid, COALESCE(sum(logs.quota),0) as quota, count(*) as count, COALESCE(sum(logs.prompt_tokens),0) + COALESCE(sum(logs.completion_tokens),0) as tokens").
		Where("logs.type = ?", LogTypeConsume).
		Group("logs.channel_id")
	if tenantId > 0 {
		tx = tx.Where("logs.tenant_id = ?", tenantId)
	}
	if startTs != 0 {
		tx = tx.Where("logs.created_at >= ?", startTs)
	}
	if endTs != 0 {
		tx = tx.Where("logs.created_at <= ?", endTs)
	}

	type channelRow struct {
		Cid    int   `gorm:"column:cid"`
		Quota  int64 `gorm:"column:quota"`
		Count  int64 `gorm:"column:count"`
		Tokens int64 `gorm:"column:tokens"`
	}
	var rows []channelRow
	if err := tx.Scan(&rows).Error; err != nil {
		return nil, err
	}

	// Batch fetch channel names
	channelIds := make([]int, 0, len(rows))
	for _, r := range rows {
		if r.Cid != 0 {
			channelIds = append(channelIds, r.Cid)
		}
	}
	channelNameMap := make(map[int]string)
	if len(channelIds) > 0 {
		var channels []struct {
			Id   int    `gorm:"column:id"`
			Name string `gorm:"column:name"`
		}
		DB.Table("channels").Select("id, name").Where("id IN ?", channelIds).Find(&channels)
		for _, ch := range channels {
			channelNameMap[ch.Id] = ch.Name
		}
	}

	for _, r := range rows {
		name := channelNameMap[r.Cid]
		if name == "" {
			name = fmt.Sprintf("channel#%d", r.Cid)
		}
		items = append(items, AnalyticsItem{Name: name, Quota: r.Quota, Count: r.Count, Tokens: r.Tokens})
	}

	summary := buildAnalyticsSummary(items, startTs, endTs)
	return &AnalyticsResult{Items: items, Summary: summary}, nil
}

func SumQuotaByModel(startTs, endTs int64, tenantId int) (*AnalyticsResult, error) {
	var items []AnalyticsItem
	tx := LOG_DB.Table("logs").
		Select("model_name as name, COALESCE(sum(quota),0) as quota, count(*) as count, COALESCE(sum(prompt_tokens),0) + COALESCE(sum(completion_tokens),0) as tokens").
		Where("type = ?", LogTypeConsume).
		Group("model_name")
	if tenantId > 0 {
		tx = tx.Where("tenant_id = ?", tenantId)
	}
	if startTs != 0 {
		tx = tx.Where("created_at >= ?", startTs)
	}
	if endTs != 0 {
		tx = tx.Where("created_at <= ?", endTs)
	}
	if err := tx.Scan(&items).Error; err != nil {
		return nil, err
	}
	summary := buildAnalyticsSummary(items, startTs, endTs)
	return &AnalyticsResult{Items: items, Summary: summary}, nil
}

func SumQuotaByUser(startTs, endTs int64, tenantId int) (*AnalyticsResult, error) {
	var items []AnalyticsItem
	tx := LOG_DB.Table("logs").
		Select("logs.user_id as uid, COALESCE(sum(logs.quota),0) as quota, count(*) as count, COALESCE(sum(logs.prompt_tokens),0) + COALESCE(sum(logs.completion_tokens),0) as tokens").
		Where("logs.type = ?", LogTypeConsume).
		Group("logs.user_id")
	if tenantId > 0 {
		tx = tx.Where("logs.tenant_id = ?", tenantId)
	}
	if startTs != 0 {
		tx = tx.Where("logs.created_at >= ?", startTs)
	}
	if endTs != 0 {
		tx = tx.Where("logs.created_at <= ?", endTs)
	}

	type userRow struct {
		Uid    int   `gorm:"column:uid"`
		Quota  int64 `gorm:"column:quota"`
		Count  int64 `gorm:"column:count"`
		Tokens int64 `gorm:"column:tokens"`
	}
	var rows []userRow
	if err := tx.Scan(&rows).Error; err != nil {
		return nil, err
	}

	// Batch fetch usernames
	userIds := make([]int, 0, len(rows))
	for _, r := range rows {
		if r.Uid != 0 {
			userIds = append(userIds, r.Uid)
		}
	}
	userNameMap := make(map[int]string)
	if len(userIds) > 0 {
		var users []struct {
			Id       int    `gorm:"column:id"`
			Username string `gorm:"column:username"`
		}
		DB.Table("users").Select("id, username").Where("id IN ?", userIds).Find(&users)
		for _, u := range users {
			userNameMap[u.Id] = u.Username
		}
	}

	for _, r := range rows {
		name := userNameMap[r.Uid]
		if name == "" {
			name = fmt.Sprintf("user#%d", r.Uid)
		}
		items = append(items, AnalyticsItem{Name: name, Quota: r.Quota, Count: r.Count, Tokens: r.Tokens})
	}

	summary := buildAnalyticsSummary(items, startTs, endTs)
	return &AnalyticsResult{Items: items, Summary: summary}, nil
}

// ========== Cache Savings ==========

type CacheSavingsResult struct {
	TotalSavingsQuota int64 `json:"total_savings_quota"`
	TotalCacheTokens  int64 `json:"total_cache_tokens"`
	CacheHitCount     int64 `json:"cache_hit_count"`
}

func GetUserCacheSavings(userId int, startTimestamp, endTimestamp int64) (*CacheSavingsResult, error) {
	return getCacheSavings(func(tx *gorm.DB) *gorm.DB {
		return tx.Where("user_id = ?", userId)
	}, startTimestamp, endTimestamp)
}

func GetAllCacheSavings(startTimestamp, endTimestamp int64) (*CacheSavingsResult, error) {
	return getCacheSavings(func(tx *gorm.DB) *gorm.DB {
		return tx
	}, startTimestamp, endTimestamp)
}

func getCacheSavings(applyScope func(tx *gorm.DB) *gorm.DB, startTimestamp, endTimestamp int64) (*CacheSavingsResult, error) {
	tx := LOG_DB.Table("logs").Select("quota, prompt_tokens, completion_tokens, other").Where("type = ?", LogTypeConsume).Where("other LIKE ?", "%cache_tokens%")
	if applyScope != nil {
		tx = applyScope(tx)
	}
	if startTimestamp > 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp > 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}

	result := &CacheSavingsResult{}
	var logs []Log
	err := tx.Find(&logs).Error
	if err != nil {
		return nil, err
	}
	for _, log := range logs {
		savingsQuota, cacheTokens := getSmartCacheSavingsQuotaFromLog(log)
		if savingsQuota <= 0 || cacheTokens <= 0 {
			continue
		}
		result.TotalSavingsQuota += savingsQuota
		result.TotalCacheTokens += cacheTokens
		result.CacheHitCount++
	}
	return result, nil
}

func sumSmartCacheSavingsQuotaFromQuery(tx *gorm.DB) (int64, error) {
	var logs []Log
	if err := tx.Find(&logs).Error; err != nil {
		return 0, err
	}
	var total int64
	for _, log := range logs {
		savingsQuota, _ := getSmartCacheSavingsQuotaFromLog(log)
		total += savingsQuota
	}
	return total, nil
}

func getSmartCacheSavingsQuotaFromLog(log Log) (int64, int64) {
	if log.Other == "" {
		return 0, 0
	}
	otherMap, err := common.StrToMap(log.Other)
	if err != nil || otherMap == nil {
		return 0, 0
	}
	cacheTokens := getFloat64FromMap(otherMap, "cache_tokens")
	if cacheTokens <= 0 {
		return 0, 0
	}

	baseInputRatio := getFloat64FromMap(otherMap, "model_ratio")
	if baseInputRatio <= 0 {
		return 0, int64(cacheTokens)
	}
	if userGroupRatio := getFloat64FromMap(otherMap, "user_group_ratio"); userGroupRatio > 0 {
		baseInputRatio *= userGroupRatio
	} else {
		groupRatio := getFloat64FromMap(otherMap, "group_ratio")
		if groupRatio <= 0 {
			return 0, int64(cacheTokens)
		}
		baseInputRatio *= groupRatio
	}

	cacheRatio := getFloat64FromMap(otherMap, "cache_ratio")
	if cacheRatio < 0 {
		return 0, int64(cacheTokens)
	}

	savingsQuota := cacheTokens * baseInputRatio * (1 - cacheRatio)
	if channelRatio := getFloat64FromMap(otherMap, "channel_ratio"); channelRatio > 0 && channelRatio < 1 {
		fullQuotaBeforeChannelDiscount := float64(log.Quota) / channelRatio
		if fullQuotaBeforeChannelDiscount <= 0 {
			fullQuotaBeforeChannelDiscount = baseInputRatio * float64(log.PromptTokens)
			fullQuotaBeforeChannelDiscount += baseInputRatio * cacheTokens * cacheRatio
			completionRatio := getFloat64FromMap(otherMap, "completion_ratio")
			if completionRatio > 0 {
				fullQuotaBeforeChannelDiscount += baseInputRatio * completionRatio * float64(log.CompletionTokens)
			}
		}
		if fullQuotaBeforeChannelDiscount > 0 {
			savingsQuota += fullQuotaBeforeChannelDiscount * (1 - channelRatio)
		}
	}
	if savingsQuota <= 0 {
		return 0, int64(cacheTokens)
	}
	return int64(savingsQuota), int64(cacheTokens)
}

func getFloat64FromMap(m map[string]interface{}, key string) float64 {
	val, ok := m[key]
	if !ok {
		return 0
	}
	switch v := val.(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case int64:
		return float64(v)
	default:
		return 0
	}
}

// ========== Site RPM ==========

type SiteRPMEntry struct {
	SiteLabel string  `json:"site_label"`
	RPM       float64 `json:"rpm"`
}

type SiteRPMResult struct {
	WindowSeconds int64          `json:"window_seconds"`
	All           struct {
		RPM float64 `json:"rpm"`
	} `json:"all"`
	Sites []SiteRPMEntry `json:"sites"`
}

// GetSiteRPM fetches consume logs within window_seconds and groups by site_label from other.admin_info.
// It selects only (other, created_at) to keep the scan lightweight.
// We cap at 50 000 rows to bound memory usage for very high-traffic deployments.
func GetSiteRPM(windowSeconds int64) (*SiteRPMResult, error) {
	if windowSeconds <= 0 {
		windowSeconds = 60
	}
	since := time.Now().Add(-time.Duration(windowSeconds) * time.Second).Unix()

	type row struct {
		Other     string `gorm:"column:other"`
		CreatedAt int64  `gorm:"column:created_at"`
	}
	var rows []row
	if err := LOG_DB.Table("logs").
		Select("other, created_at").
		Where("type = ? AND created_at >= ?", LogTypeConsume, since).
		Limit(50000).
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	counts := make(map[string]int64)
	for _, r := range rows {
		label := ""
		if r.Other != "" {
			otherMap, err := common.StrToMap(r.Other)
			if err == nil && otherMap != nil {
				if ai, ok := otherMap["admin_info"]; ok {
					if aiMap, ok := ai.(map[string]interface{}); ok {
						if sl, ok := aiMap["site_label"]; ok {
							if s, ok := sl.(string); ok {
								label = s
							}
						}
					}
				}
			}
		}
		if label == "" {
			label = "(unset)"
		}
		counts[label]++
	}

	result := &SiteRPMResult{WindowSeconds: windowSeconds}
	var totalCount int64
	for label, cnt := range counts {
		totalCount += cnt
		rpm := float64(cnt) * 60.0 / float64(windowSeconds)
		result.Sites = append(result.Sites, SiteRPMEntry{SiteLabel: label, RPM: rpm})
	}
	result.All.RPM = float64(totalCount) * 60.0 / float64(windowSeconds)
	return result, nil
}
