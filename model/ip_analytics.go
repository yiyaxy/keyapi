package model

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// ============================================================
// Struct definitions for IP Analytics V2
// ============================================================

type IpAnalyticsOverview struct {
	LoginRecords       int64 `json:"login_records"`
	LoginDistinctIps   int64 `json:"login_distinct_ips"`
	LoginDistinctUsers int64 `json:"login_distinct_users"`
	TodayLogins        int64 `json:"today_logins"`
	ApiCallCount       int64 `json:"api_call_count"`
	ApiDistinctIps     int64 `json:"api_distinct_ips"`
	ApiDistinctUsers   int64 `json:"api_distinct_users"`
	ApiQuotaConsumed   int64 `json:"api_quota_consumed"`
	NewIpCount         int64 `json:"new_ip_count"`
	MultiAccountIps    int64 `json:"multi_account_ips"`
	HighFreqIps        int64 `json:"high_freq_ips"`
}

type LoginGeoItem struct {
	Location string `json:"location"`
	Count    int64  `json:"count"`
	Users    int64  `json:"users"`
	LastSeen int64  `json:"last_seen"`
}

type HourlyDistItem struct {
	Hour  int   `json:"hour"`
	Count int64 `json:"count"`
}

type DailyDistItem struct {
	Date  string `json:"date"`
	Count int64  `json:"count"`
}

type TimePatternResult struct {
	HourlyDist []HourlyDistItem `json:"hourly_dist"`
	DailyDist  []DailyDistItem  `json:"daily_dist"`
}

type LoginTypeDetailItem struct {
	LoginType     string `json:"login_type"`
	Count         int64  `json:"count"`
	DistinctIps   int64  `json:"distinct_ips"`
	DistinctUsers int64  `json:"distinct_users"`
	LastSeen      int64  `json:"last_seen"`
}

type MultiAccountIpItem struct {
	Ip         string `json:"ip"`
	UserCount  int64  `json:"user_count"`
	Users      string `json:"users"`
	LoginCount int64  `json:"login_count"`
	Location   string `json:"location"`
	IsBanned   bool   `json:"is_banned"`
}

type ApiTopIpItem struct {
	Ip        string `json:"ip"`
	CallCount int64  `json:"call_count"`
	Quota     int64  `json:"quota"`
	Users     int64  `json:"users"`
	Models    int64  `json:"models"`
	TopModel  string `json:"top_model"`
	Location  string `json:"location"`
	IsBanned  bool   `json:"is_banned"`
}

type ApiGeoItem struct {
	Location  string `json:"location"`
	CallCount int64  `json:"call_count"`
	Quota     int64  `json:"quota"`
	Users     int64  `json:"users"`
}

type HighFreqIpItem struct {
	Ip          string  `json:"ip"`
	CallCount   int64   `json:"call_count"`
	CallsPerMin float64 `json:"calls_per_min"`
	Quota       int64   `json:"quota"`
	Users       int64   `json:"users"`
	PeakHour    int     `json:"peak_hour"`
	PeakCount   int64   `json:"peak_count"`
	Location    string  `json:"location"`
	IsBanned    bool    `json:"is_banned"`
}

type IpModelUsageItem struct {
	ModelName string `json:"model_name"`
	CallCount int64  `json:"call_count"`
	Quota     int64  `json:"quota"`
	Tokens    int64  `json:"tokens"`
}

type IpMismatchItem struct {
	UserId        int    `json:"user_id"`
	Username      string `json:"username"`
	LoginIpCount  int64  `json:"login_ip_count"`
	ApiIpCount    int64  `json:"api_ip_count"`
	MismatchCount int64  `json:"mismatch_count"`
	LoginIps      string `json:"login_ips"`
	ApiIps        string `json:"api_ips"`
}

type IpRiskItem struct {
	Ip           string   `json:"ip"`
	RiskScore    int      `json:"risk_score"`
	RiskFactors  []string `json:"risk_factors"`
	UserCount    int64    `json:"user_count"`
	ApiCallCount int64    `json:"api_call_count"`
	LoginCount   int64    `json:"login_count"`
	CallsPerMin  float64  `json:"calls_per_min"`
	Location     string   `json:"location"`
	IsBanned     bool     `json:"is_banned"`
}

type NewIpItem struct {
	Ip        string `json:"ip"`
	Source    string `json:"source"`
	Username  string `json:"username"`
	Location  string `json:"location"`
	FirstSeen int64  `json:"first_seen"`
	IsBanned  bool   `json:"is_banned"`
}

// ============================================================
// Helper function
// ============================================================

func ipLocationForIp(ip string) string {
	var loc string
	DB.Model(&UserIpRecord{}).Where("ip = ? AND ip_location != ''", ip).
		Select("ip_location").Limit(1).Scan(&loc)
	return loc
}

// ========== 1. Overview ==========

func GetIpAnalyticsOverviewV2(startTs, endTs int64) (*IpAnalyticsOverview, error) {
	r := &IpAnalyticsOverview{}

	// Login metrics from user_ip_records
	DB.Model(&UserIpRecord{}).Where("created_at >= ? AND created_at <= ?", startTs, endTs).Count(&r.LoginRecords)
	DB.Model(&UserIpRecord{}).Where("created_at >= ? AND created_at <= ?", startTs, endTs).Select("COUNT(DISTINCT ip)").Scan(&r.LoginDistinctIps)
	DB.Model(&UserIpRecord{}).Where("created_at >= ? AND created_at <= ?", startTs, endTs).Select("COUNT(DISTINCT user_id)").Scan(&r.LoginDistinctUsers)

	todayStart := time.Now().Truncate(24 * time.Hour).Unix()
	DB.Model(&UserIpRecord{}).Where("created_at >= ?", todayStart).Count(&r.TodayLogins)

	// API metrics from logs
	LOG_DB.Model(&Log{}).Where("type = ? AND created_at >= ? AND created_at <= ?", LogTypeConsume, startTs, endTs).Count(&r.ApiCallCount)
	LOG_DB.Model(&Log{}).Where("type = ? AND created_at >= ? AND created_at <= ? AND ip != ''", LogTypeConsume, startTs, endTs).Select("COUNT(DISTINCT ip)").Scan(&r.ApiDistinctIps)
	LOG_DB.Model(&Log{}).Where("type = ? AND created_at >= ? AND created_at <= ?", LogTypeConsume, startTs, endTs).Select("COUNT(DISTINCT user_id)").Scan(&r.ApiDistinctUsers)
	LOG_DB.Model(&Log{}).Where("type = ? AND created_at >= ? AND created_at <= ?", LogTypeConsume, startTs, endTs).Select("COALESCE(SUM(quota),0)").Scan(&r.ApiQuotaConsumed)

	// Alert: new IPs (IPs in current range that don't appear before startTs)
	DB.Raw(`SELECT COUNT(DISTINCT ip) FROM user_ip_records
		WHERE created_at >= ? AND created_at <= ?
		AND ip NOT IN (SELECT DISTINCT ip FROM user_ip_records WHERE created_at < ?)`,
		startTs, endTs, startTs).Scan(&r.NewIpCount)

	// Alert: multi-account IPs (IPs used by 2+ users in range)
	DB.Raw(`SELECT COUNT(*) FROM (
		SELECT ip FROM user_ip_records
		WHERE created_at >= ? AND created_at <= ?
		GROUP BY ip HAVING COUNT(DISTINCT user_id) >= 2
	) t`, startTs, endTs).Scan(&r.MultiAccountIps)

	// Alert: high-freq IPs (IPs with >100 API calls per hour on average)
	durationHours := float64(endTs-startTs) / 3600.0
	if durationHours < 1 {
		durationHours = 1
	}
	threshold := int64(100 * durationHours)
	LOG_DB.Raw(`SELECT COUNT(*) FROM (
		SELECT ip FROM logs
		WHERE type = ? AND created_at >= ? AND created_at <= ? AND ip != ''
		GROUP BY ip HAVING COUNT(*) > ?
	) t`, LogTypeConsume, startTs, endTs, threshold).Scan(&r.HighFreqIps)

	return r, nil
}

// ========== 2. Login Geo Distribution ==========

func GetLoginGeoDist(startTs, endTs int64) ([]LoginGeoItem, error) {
	var items []LoginGeoItem
	err := DB.Model(&UserIpRecord{}).
		Select("ip_location as location, COUNT(*) as count, COUNT(DISTINCT user_id) as users, MAX(created_at) as last_seen").
		Where("created_at >= ? AND created_at <= ? AND ip_location IS NOT NULL AND ip_location != ''", startTs, endTs).
		Group("ip_location").
		Order("count DESC").
		Limit(100).
		Find(&items).Error
	return items, err
}

// ========== 3. Login Time Pattern ==========

func GetLoginTimePattern(startTs, endTs int64) (*TimePatternResult, error) {
	result := &TimePatternResult{}

	// Hourly distribution (0-23)
	// Use database-agnostic approach: extract hour from timestamp
	var hourlyRaw []struct {
		CreatedAt int64 `gorm:"column:created_at"`
	}
	DB.Model(&UserIpRecord{}).
		Select("created_at").
		Where("created_at >= ? AND created_at <= ?", startTs, endTs).
		Find(&hourlyRaw)

	hourCounts := make(map[int]int64)
	for _, r := range hourlyRaw {
		h := time.Unix(r.CreatedAt, 0).Hour()
		hourCounts[h]++
	}
	for h := 0; h < 24; h++ {
		result.HourlyDist = append(result.HourlyDist, HourlyDistItem{Hour: h, Count: hourCounts[h]})
	}

	// Daily distribution
	var dailyRaw []struct {
		CreatedAt int64 `gorm:"column:created_at"`
	}
	DB.Model(&UserIpRecord{}).
		Select("created_at").
		Where("created_at >= ? AND created_at <= ?", startTs, endTs).
		Find(&dailyRaw)

	dayCounts := make(map[string]int64)
	for _, r := range dailyRaw {
		d := time.Unix(r.CreatedAt, 0).Format("2006-01-02")
		dayCounts[d]++
	}
	// Sort dates
	for d, c := range dayCounts {
		result.DailyDist = append(result.DailyDist, DailyDistItem{Date: d, Count: c})
	}

	return result, nil
}

// ========== 4. Login Type Detail ==========

func GetLoginTypeDetail(startTs, endTs int64) ([]LoginTypeDetailItem, error) {
	var items []LoginTypeDetailItem
	err := DB.Model(&UserIpRecord{}).
		Select("login_type, COUNT(*) as count, COUNT(DISTINCT ip) as distinct_ips, COUNT(DISTINCT user_id) as distinct_users, MAX(created_at) as last_seen").
		Where("created_at >= ? AND created_at <= ?", startTs, endTs).
		Group("login_type").
		Order("count DESC").
		Limit(50).
		Find(&items).Error
	return items, err
}

// ========== 5. Multi-Account IPs ==========

func GetMultiAccountIps(startTs, endTs int64, minUsers int, page, pageSize int) ([]MultiAccountIpItem, int64, error) {
	if minUsers < 2 {
		minUsers = 2
	}
	var total int64
	DB.Raw(`SELECT COUNT(*) FROM (
		SELECT ip FROM user_ip_records
		WHERE created_at >= ? AND created_at <= ?
		GROUP BY ip HAVING COUNT(DISTINCT user_id) >= ?
	) t`, startTs, endTs, minUsers).Scan(&total)

	offset := (page - 1) * pageSize
	var groupConcatExpr string
	if common.UsingPostgreSQL {
		groupConcatExpr = "STRING_AGG(DISTINCT username, ',')"
	} else {
		groupConcatExpr = "GROUP_CONCAT(DISTINCT username)"
	}
	var items []MultiAccountIpItem
	err := DB.Model(&UserIpRecord{}).
		Select("ip, COUNT(DISTINCT user_id) as user_count, COUNT(*) as login_count, MAX(created_at) as last_seen, MAX(ip_location) as location, "+groupConcatExpr+" as users").
		Where("created_at >= ? AND created_at <= ?", startTs, endTs).
		Group("ip").
		Having("COUNT(DISTINCT user_id) >= ?", minUsers).
		Order("user_count DESC").
		Offset(offset).
		Limit(pageSize).
		Find(&items).Error

	// Check ban status
	for i := range items {
		items[i].IsBanned, _ = IsIpBanned(items[i].Ip)
	}
	return items, total, err
}

// ========== 6. API Top IPs ==========

func GetApiTopIps(startTs, endTs int64) ([]ApiTopIpItem, error) {
	var items []ApiTopIpItem
	err := LOG_DB.Model(&Log{}).
		Select("ip, COUNT(*) as call_count, COALESCE(SUM(quota),0) as quota, COUNT(DISTINCT user_id) as users, COUNT(DISTINCT model_name) as models, MAX(created_at) as last_seen").
		Where("type = ? AND created_at >= ? AND created_at <= ? AND ip != ''", LogTypeConsume, startTs, endTs).
		Group("ip").
		Order("call_count DESC").
		Limit(100).
		Find(&items).Error

	// Enrich with top model, location, ban status
	for i := range items {
		// Top model for this IP
		var topModel string
		LOG_DB.Model(&Log{}).
			Select("model_name").
			Where("type = ? AND ip = ? AND created_at >= ? AND created_at <= ?", LogTypeConsume, items[i].Ip, startTs, endTs).
			Group("model_name").
			Order("COUNT(*) DESC").
			Limit(1).
			Scan(&topModel)
		items[i].TopModel = topModel
		items[i].Location = ipLocationForIp(items[i].Ip)
		items[i].IsBanned, _ = IsIpBanned(items[i].Ip)
	}
	return items, err
}

// ========== 7. API Geo Distribution ==========

func GetApiGeoDist(startTs, endTs int64) ([]ApiGeoItem, error) {
	// Get distinct IPs from logs, then lookup location from user_ip_records
	var ipData []struct {
		Ip        string `gorm:"column:ip"`
		CallCount int64  `gorm:"column:call_count"`
		Quota     int64  `gorm:"column:quota"`
		Users     int64  `gorm:"column:users"`
	}
	LOG_DB.Model(&Log{}).
		Select("ip, COUNT(*) as call_count, COALESCE(SUM(quota),0) as quota, COUNT(DISTINCT user_id) as users").
		Where("type = ? AND created_at >= ? AND created_at <= ? AND ip != ''", LogTypeConsume, startTs, endTs).
		Group("ip").
		Find(&ipData)

	// Aggregate by location
	locMap := make(map[string]*ApiGeoItem)
	for _, d := range ipData {
		loc := ipLocationForIp(d.Ip)
		if loc == "" {
			loc = "Unknown"
		}
		if _, ok := locMap[loc]; !ok {
			locMap[loc] = &ApiGeoItem{Location: loc}
		}
		locMap[loc].CallCount += d.CallCount
		locMap[loc].Quota += d.Quota
		locMap[loc].Users += d.Users
	}

	var items []ApiGeoItem
	for _, v := range locMap {
		items = append(items, *v)
	}
	return items, nil
}

// ========== 8. API Time Pattern ==========

func GetApiTimePattern(startTs, endTs int64) (*TimePatternResult, error) {
	result := &TimePatternResult{}

	var raw []struct {
		CreatedAt int64 `gorm:"column:created_at"`
	}
	LOG_DB.Model(&Log{}).
		Select("created_at").
		Where("type = ? AND created_at >= ? AND created_at <= ?", LogTypeConsume, startTs, endTs).
		Find(&raw)

	hourCounts := make(map[int]int64)
	dayCounts := make(map[string]int64)
	for _, r := range raw {
		t := time.Unix(r.CreatedAt, 0)
		hourCounts[t.Hour()]++
		dayCounts[t.Format("2006-01-02")]++
	}

	for h := 0; h < 24; h++ {
		result.HourlyDist = append(result.HourlyDist, HourlyDistItem{Hour: h, Count: hourCounts[h]})
	}
	for d, c := range dayCounts {
		result.DailyDist = append(result.DailyDist, DailyDistItem{Date: d, Count: c})
	}

	return result, nil
}

// ========== 9. High Frequency IPs ==========

func GetHighFreqIps(startTs, endTs int64, threshold int) ([]HighFreqIpItem, error) {
	if threshold <= 0 {
		threshold = 100 // default: 100 calls per hour
	}
	durationHours := float64(endTs-startTs) / 3600.0
	if durationHours < 1 {
		durationHours = 1
	}
	minCalls := int64(float64(threshold) * durationHours)

	var items []HighFreqIpItem
	err := LOG_DB.Model(&Log{}).
		Select("ip, COUNT(*) as call_count, COALESCE(SUM(quota),0) as quota, COUNT(DISTINCT user_id) as users").
		Where("type = ? AND created_at >= ? AND created_at <= ? AND ip != ''", LogTypeConsume, startTs, endTs).
		Group("ip").
		Having("COUNT(*) >= ?", minCalls).
		Order("call_count DESC").
		Limit(100).
		Find(&items).Error

	// Enrich with calls per minute, peak hour, location, ban status
	for i := range items {
		items[i].CallsPerMin = float64(items[i].CallCount) / (durationHours * 60)
		items[i].Location = ipLocationForIp(items[i].Ip)
		items[i].IsBanned, _ = IsIpBanned(items[i].Ip)

		// Peak hour calculation
		var rawLogs []struct {
			CreatedAt int64 `gorm:"column:created_at"`
		}
		LOG_DB.Model(&Log{}).
			Select("created_at").
			Where("type = ? AND ip = ? AND created_at >= ? AND created_at <= ?", LogTypeConsume, items[i].Ip, startTs, endTs).
			Find(&rawLogs)

		hourMap := make(map[int]int64)
		for _, r := range rawLogs {
			h := time.Unix(r.CreatedAt, 0).Hour()
			hourMap[h]++
		}
		var peakHour int
		var peakCount int64
		for h, c := range hourMap {
			if c > peakCount {
				peakHour = h
				peakCount = c
			}
		}
		items[i].PeakHour = peakHour
		items[i].PeakCount = peakCount
	}
	return items, err
}

// ========== 10. IP Model Usage (Drill-down) ==========

func GetApiIpModelUsage(ip string, startTs, endTs int64) ([]IpModelUsageItem, error) {
	var items []IpModelUsageItem
	err := LOG_DB.Model(&Log{}).
		Select("model_name, COUNT(*) as call_count, COALESCE(SUM(quota),0) as quota, COALESCE(SUM(prompt_tokens),0)+COALESCE(SUM(completion_tokens),0) as tokens, MAX(created_at) as last_seen").
		Where("type = ? AND ip = ? AND created_at >= ? AND created_at <= ?", LogTypeConsume, ip, startTs, endTs).
		Group("model_name").
		Order("call_count DESC").
		Find(&items).Error
	return items, err
}

// ========== 11. IP Mismatch Detection ==========

func GetIpMismatch(startTs, endTs int64) ([]IpMismatchItem, error) {
	// Get users who have both login and API records in the time range
	var userIds []int
	DB.Model(&UserIpRecord{}).
		Select("DISTINCT user_id").
		Where("created_at >= ? AND created_at <= ?", startTs, endTs).
		Find(&userIds)

	var results []IpMismatchItem
	for _, uid := range userIds {
		// Get login IPs
		var loginIps []string
		DB.Model(&UserIpRecord{}).
			Select("DISTINCT ip").
			Where("user_id = ? AND created_at >= ? AND created_at <= ?", uid, startTs, endTs).
			Find(&loginIps)

		// Get API IPs
		var apiIps []string
		LOG_DB.Model(&Log{}).
			Select("DISTINCT ip").
			Where("user_id = ? AND type = ? AND created_at >= ? AND created_at <= ? AND ip != ''", uid, LogTypeConsume, startTs, endTs).
			Find(&apiIps)

		if len(loginIps) == 0 || len(apiIps) == 0 {
			continue
		}

		// Find API-only IPs (IPs used for API but never logged in from)
		loginIpSet := make(map[string]bool)
		for _, ip := range loginIps {
			loginIpSet[ip] = true
		}
		var mismatchIps []string
		for _, ip := range apiIps {
			if !loginIpSet[ip] {
				mismatchIps = append(mismatchIps, ip)
			}
		}

		if len(mismatchIps) > 0 {
			var username string
			DB.Model(&User{}).Select("username").Where("id = ?", uid).Scan(&username)
			results = append(results, IpMismatchItem{
				UserId:        uid,
				Username:      username,
				LoginIps:      fmt.Sprintf("%v", loginIps),
				ApiIps:        fmt.Sprintf("%v", mismatchIps),
				LoginIpCount:  int64(len(loginIps)),
				ApiIpCount:    int64(len(apiIps)),
				MismatchCount: int64(len(mismatchIps)),
			})
		}
	}

	if len(results) > 100 {
		results = results[:100]
	}
	return results, nil
}

// ========== 12. IP Risk Scores ==========

func GetIpRiskScores(startTs, endTs int64) ([]IpRiskItem, error) {
	// Collect all unique IPs from both login and API
	ipSet := make(map[string]bool)

	var loginIps []string
	DB.Model(&UserIpRecord{}).
		Select("DISTINCT ip").
		Where("created_at >= ? AND created_at <= ?", startTs, endTs).
		Find(&loginIps)
	for _, ip := range loginIps {
		ipSet[ip] = true
	}

	var apiIps []string
	LOG_DB.Model(&Log{}).
		Select("DISTINCT ip").
		Where("type = ? AND created_at >= ? AND created_at <= ? AND ip != ''", LogTypeConsume, startTs, endTs).
		Find(&apiIps)
	for _, ip := range apiIps {
		ipSet[ip] = true
	}

	durationHours := float64(endTs-startTs) / 3600.0
	if durationHours < 1 {
		durationHours = 1
	}

	var results []IpRiskItem
	for ip := range ipSet {
		item := IpRiskItem{Ip: ip}

		// User count (login)
		DB.Model(&UserIpRecord{}).
			Where("ip = ? AND created_at >= ? AND created_at <= ?", ip, startTs, endTs).
			Select("COUNT(DISTINCT user_id)").
			Scan(&item.UserCount)

		// Login count
		DB.Model(&UserIpRecord{}).
			Where("ip = ? AND created_at >= ? AND created_at <= ?", ip, startTs, endTs).
			Count(&item.LoginCount)

		// API call count
		LOG_DB.Model(&Log{}).
			Where("ip = ? AND type = ? AND created_at >= ? AND created_at <= ?", ip, LogTypeConsume, startTs, endTs).
			Count(&item.ApiCallCount)

		item.CallsPerMin = float64(item.ApiCallCount) / (durationHours * 60)
		item.Location = ipLocationForIp(ip)
		item.IsBanned, _ = IsIpBanned(ip)

		// Calculate risk score
		score := 0
		var factors []string

		// Multi-account: +30
		if item.UserCount >= 2 {
			score += 30
			factors = append(factors, fmt.Sprintf("multi_account(%d)", item.UserCount))
		}

		// High frequency: +25 (>100 calls/hour)
		if item.CallsPerMin > 100.0/60.0 {
			score += 25
			factors = append(factors, "high_freq")
		}

		// Abnormal hours (2-5 AM): +10
		var abnormalCount int64
		var rawLogs []struct {
			CreatedAt int64 `gorm:"column:created_at"`
		}
		DB.Model(&UserIpRecord{}).
			Select("created_at").
			Where("ip = ? AND created_at >= ? AND created_at <= ?", ip, startTs, endTs).
			Find(&rawLogs)
		for _, r := range rawLogs {
			h := time.Unix(r.CreatedAt, 0).Hour()
			if h >= 2 && h <= 5 {
				abnormalCount++
			}
		}
		if abnormalCount > 0 {
			score += 10
			factors = append(factors, "abnormal_hours")
		}

		// Unknown location: +10
		if item.Location == "" || item.Location == "Unknown" {
			score += 10
			factors = append(factors, "unknown_location")
		}

		item.RiskScore = score
		item.RiskFactors = factors
		results = append(results, item)
	}

	// Sort by risk score descending
	for i := 0; i < len(results)-1; i++ {
		for j := i + 1; j < len(results); j++ {
			if results[j].RiskScore > results[i].RiskScore {
				results[i], results[j] = results[j], results[i]
			}
		}
	}

	if len(results) > 100 {
		results = results[:100]
	}
	return results, nil
}

// ========== 13. New IPs ==========

func GetNewIps(startTs, endTs int64) ([]NewIpItem, error) {
	var results []NewIpItem

	// New login IPs
	var newLoginIps []struct {
		Ip        string `gorm:"column:ip"`
		UserId    int    `gorm:"column:user_id"`
		Username  string `gorm:"column:username"`
		Location  string `gorm:"column:location"`
		FirstSeen int64  `gorm:"column:first_seen"`
	}
	DB.Raw(`SELECT ip, MIN(user_id) as user_id, MIN(username) as username, MAX(ip_location) as location, MIN(created_at) as first_seen
		FROM user_ip_records
		WHERE created_at >= ? AND created_at <= ?
		AND ip NOT IN (SELECT DISTINCT ip FROM user_ip_records WHERE created_at < ?)
		GROUP BY ip`, startTs, endTs, startTs).Scan(&newLoginIps)

	for _, r := range newLoginIps {
		banned, _ := IsIpBanned(r.Ip)
		results = append(results, NewIpItem{
			Ip:        r.Ip,
			Source:    "login",
			Username:  r.Username,
			Location:  r.Location,
			FirstSeen: r.FirstSeen,
			IsBanned:  banned,
		})
	}

	// New API IPs
	var newApiIps []struct {
		Ip        string `gorm:"column:ip"`
		UserId    int    `gorm:"column:user_id"`
		Username  string `gorm:"column:username"`
		FirstSeen int64  `gorm:"column:first_seen"`
	}
	LOG_DB.Raw(`SELECT ip, MIN(user_id) as user_id, MIN(username) as username, MIN(created_at) as first_seen
		FROM logs
		WHERE type = ? AND created_at >= ? AND created_at <= ? AND ip != ''
		AND ip NOT IN (SELECT DISTINCT ip FROM logs WHERE type = ? AND created_at < ? AND ip != '')
		GROUP BY ip`, LogTypeConsume, startTs, endTs, LogTypeConsume, startTs).Scan(&newApiIps)

	for _, r := range newApiIps {
		banned, _ := IsIpBanned(r.Ip)
		results = append(results, NewIpItem{
			Ip:        r.Ip,
			Source:    "api",
			Username:  r.Username,
			Location:  ipLocationForIp(r.Ip),
			FirstSeen: r.FirstSeen,
			IsBanned:  banned,
		})
	}

	if len(results) > 100 {
		results = results[:100]
	}
	return results, nil
}

// ========== 14. User IP Summary ==========

type UserIpSummaryItem struct {
	UserId       int    `json:"user_id"`
	Username     string `json:"username"`
	LoginIpCount int64  `json:"login_ip_count"`
	ApiIpCount   int64  `json:"api_ip_count"`
	TotalIpCount int64  `json:"total_ip_count"`
	LoginIps     string `json:"login_ips"`
	ApiIps       string `json:"api_ips"`
	IsBanned     bool   `json:"is_banned"`
}

func GetUserIpSummary(startTs, endTs int64) ([]UserIpSummaryItem, error) {
	var stringAggExpr string
	if common.UsingPostgreSQL {
		stringAggExpr = "STRING_AGG(DISTINCT ip, ',')"
	} else {
		stringAggExpr = "GROUP_CONCAT(DISTINCT ip)"
	}

	// 1. Login IPs per user
	type loginRow struct {
		UserId       int    `gorm:"column:user_id"`
		Username     string `gorm:"column:username"`
		LoginIpCount int64  `gorm:"column:login_ip_count"`
		LoginIps     string `gorm:"column:login_ips"`
	}
	var loginRows []loginRow
	DB.Model(&UserIpRecord{}).
		Select("user_id, MAX(username) as username, COUNT(DISTINCT ip) as login_ip_count, "+stringAggExpr+" as login_ips").
		Where("created_at >= ? AND created_at <= ?", startTs, endTs).
		Group("user_id").
		Find(&loginRows)

	// 2. API IPs per user
	type apiRow struct {
		UserId     int    `gorm:"column:user_id"`
		Username   string `gorm:"column:username"`
		ApiIpCount int64  `gorm:"column:api_ip_count"`
		ApiIps     string `gorm:"column:api_ips"`
	}
	var apiRows []apiRow
	LOG_DB.Model(&Log{}).
		Select("user_id, MAX(username) as username, COUNT(DISTINCT ip) as api_ip_count, "+stringAggExpr+" as api_ips").
		Where("type = ? AND created_at >= ? AND created_at <= ? AND ip != ''", LogTypeConsume, startTs, endTs).
		Group("user_id").
		Find(&apiRows)

	// 3. Merge results
	userMap := make(map[int]*UserIpSummaryItem)
	for _, r := range loginRows {
		userMap[r.UserId] = &UserIpSummaryItem{
			UserId:       r.UserId,
			Username:     r.Username,
			LoginIpCount: r.LoginIpCount,
			LoginIps:     r.LoginIps,
		}
	}
	for _, r := range apiRows {
		if item, ok := userMap[r.UserId]; ok {
			item.ApiIpCount = r.ApiIpCount
			item.ApiIps = r.ApiIps
		} else {
			userMap[r.UserId] = &UserIpSummaryItem{
				UserId:     r.UserId,
				Username:   r.Username,
				ApiIpCount: r.ApiIpCount,
				ApiIps:     r.ApiIps,
			}
		}
	}

	// 4. Calculate total and check ban status
	var results []UserIpSummaryItem
	for _, item := range userMap {
		item.TotalIpCount = item.LoginIpCount + item.ApiIpCount
		var status int
		DB.Model(&User{}).Select("status").Where("id = ?", item.UserId).Scan(&status)
		item.IsBanned = (status != 1)
		results = append(results, *item)
	}

	// 5. Sort by total_ip_count DESC
	for i := 0; i < len(results)-1; i++ {
		for j := i + 1; j < len(results); j++ {
			if results[j].TotalIpCount > results[i].TotalIpCount {
				results[i], results[j] = results[j], results[i]
			}
		}
	}

	if len(results) > 100 {
		results = results[:100]
	}
	return results, nil
}
