package model

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type UserIpRecord struct {
	Id         int    `json:"id" gorm:"primaryKey;autoIncrement"`
	TenantId   int    `json:"tenant_id" gorm:"index;default:1"`
	UserId     int    `json:"user_id" gorm:"index;not null"`
	Username   string `json:"username" gorm:"index;default:''"`
	Ip         string `json:"ip" gorm:"index;type:varchar(64);not null"`
	IpLocation string `json:"ip_location" gorm:"type:text"`
	LoginType  string `json:"login_type" gorm:"type:varchar(32)"`
	UserAgent  string `json:"user_agent" gorm:"type:varchar(512)"`
	CreatedAt  int64  `json:"created_at" gorm:"bigint;index"`
}

func (r *UserIpRecord) BeforeCreate(tx *gorm.DB) (err error) {
	if r.CreatedAt == 0 {
		r.CreatedAt = time.Now().Unix()
	}
	return
}

// RecordLoginIp inserts a login IP record. Geolocation is resolved asynchronously by the caller.
func RecordLoginIp(tenantId int, userId int, username, ip, loginType, userAgent string) {
	record := &UserIpRecord{
		TenantId:  tenantId,
		UserId:    userId,
		Username:  username,
		Ip:        ip,
		LoginType: loginType,
		UserAgent: userAgent,
	}
	err := DB.Create(record).Error
	if err != nil {
		common.SysError(fmt.Sprintf("failed to record login IP: %v", err))
	}
	// Maintain user IP set
	AddIpToUserSet(tenantId, userId, ip)
}

// UpdateIpLocation updates the ip_location field for a given IP address.
func UpdateIpLocation(ip string, location string) {
	err := DB.Model(&UserIpRecord{}).
		Where("ip = ? AND (ip_location IS NULL OR ip_location = '')", ip).
		Update("ip_location", location).Error
	if err != nil {
		common.SysError(fmt.Sprintf("failed to update IP location for %s: %v", ip, err))
	}
}

// GetIpRecordsByUserId returns paginated login IP records for a specific user.
func GetIpRecordsByUserId(tenantId int, userId int, page, pageSize int) ([]*UserIpRecord, int64, error) {
	var records []*UserIpRecord
	var total int64

	tx := DB.Model(&UserIpRecord{}).Where("user_id = ?", userId)
	if tenantId > 0 {
		tx = tx.Where("tenant_id = ?", tenantId)
	}
	tx.Count(&total)

	offset := (page - 1) * pageSize
	err := tx.Order("created_at DESC").Offset(offset).Limit(pageSize).Find(&records).Error
	return records, total, err
}

// GetIpRecordsByIp returns paginated login records for a specific IP.
func GetIpRecordsByIp(tenantId int, ip string, page, pageSize int) ([]*UserIpRecord, int64, error) {
	var records []*UserIpRecord
	var total int64

	tx := DB.Model(&UserIpRecord{}).Where("ip = ?", ip)
	if tenantId > 0 {
		tx = tx.Where("tenant_id = ?", tenantId)
	}
	tx.Count(&total)

	offset := (page - 1) * pageSize
	err := tx.Order("created_at DESC").Offset(offset).Limit(pageSize).Find(&records).Error
	return records, total, err
}

// IpUserInfo represents a user who used a given IP, with login count and last login time.
type IpUserInfo struct {
	UserId    int    `json:"user_id"`
	Username  string `json:"username"`
	Count     int64  `json:"count"`
	LastLogin int64  `json:"last_login"`
	Source    string `json:"source"` // "login" or "api"
}

// GetDistinctUsersByIp returns distinct users who logged in from a given IP.
func GetDistinctUsersByIp(tenantId int, ip string) ([]*IpUserInfo, error) {
	var results []*IpUserInfo
	tx := DB.Model(&UserIpRecord{}).Where("ip = ?", ip)
	if tenantId > 0 {
		tx = tx.Where("tenant_id = ?", tenantId)
	}
	err := tx.
		Select("user_id, username, COUNT(*) as count, MAX(created_at) as last_login").
		Group("user_id, username").
		Order("count DESC").
		Find(&results).Error
	if err != nil {
		return nil, err
	}
	for i := range results {
		results[i].Source = "login"
	}
	return results, nil
}

// GetUsersFromLogsByIp returns distinct users who made API calls from a given IP.
func GetUsersFromLogsByIp(tenantId int, ip string) ([]*IpUserInfo, error) {
	var results []*IpUserInfo
	tx := LOG_DB.Model(&Log{}).Where("ip = ?", ip)
	if tenantId > 0 {
		tx = tx.Where("tenant_id = ?", tenantId)
	}
	err := tx.
		Select("user_id, username, COUNT(*) as count, MAX(created_at) as last_login").
		Group("user_id, username").
		Order("count DESC").
		Find(&results).Error
	if err != nil {
		return nil, err
	}
	for i := range results {
		results[i].Source = "api"
	}
	return results, nil
}

// IpUserActivityV2 represents per-user activity from a specific IP within a time range.
type IpUserActivityV2 struct {
	UserId     int   `json:"user_id"`
	Username   string `json:"username"`
	LoginCount int64 `json:"login_count"`
	LastLogin  int64 `json:"last_login"`
	ApiCount   int64 `json:"api_count"`
	LastApi    int64 `json:"last_api"`
	LastSeen   int64 `json:"last_seen"`
}

// GetIpUserActivityV2 aggregates login + API activity for a single IP within [startTs, endTs].
// - Login data source: user_ip_records
// - API data source: logs (LOG_DB) with type = LogTypeConsume
func GetIpUserActivityV2(tenantId int, ip string, startTs, endTs int64) (map[int]*IpUserActivityV2, error) {
	activity := make(map[int]*IpUserActivityV2)

	// 1) Login side
	var loginRows []struct {
		UserId    int    `gorm:"column:user_id"`
		Username  string `gorm:"column:username"`
		Count     int64  `gorm:"column:count"`
		LastLogin int64  `gorm:"column:last_login"`
	}
	loginTx := DB.Model(&UserIpRecord{}).
		Where("ip = ? AND created_at >= ? AND created_at <= ?", ip, startTs, endTs)
	if tenantId > 0 {
		loginTx = loginTx.Where("tenant_id = ?", tenantId)
	}
	err := loginTx.
		Select("user_id, username, COUNT(*) as count, MAX(created_at) as last_login").
		Group("user_id, username").
		Scan(&loginRows).Error
	if err != nil {
		return nil, err
	}
	for _, r := range loginRows {
		if r.UserId <= 0 {
			continue
		}
		item := activity[r.UserId]
		if item == nil {
			item = &IpUserActivityV2{UserId: r.UserId, Username: r.Username}
			activity[r.UserId] = item
		}
		item.LoginCount = r.Count
		item.LastLogin = r.LastLogin
		if item.LastSeen < r.LastLogin {
			item.LastSeen = r.LastLogin
		}
	}

	// 2) API side
	var apiRows []struct {
		UserId   int    `gorm:"column:user_id"`
		Username string `gorm:"column:username"`
		Count    int64  `gorm:"column:count"`
		LastApi  int64  `gorm:"column:last_api"`
	}
	apiTx := LOG_DB.Model(&Log{}).
		Where("type = ? AND ip = ? AND created_at >= ? AND created_at <= ?", LogTypeConsume, ip, startTs, endTs)
	if tenantId > 0 {
		apiTx = apiTx.Where("tenant_id = ?", tenantId)
	}
	err = apiTx.
		Select("user_id, username, COUNT(*) as count, MAX(created_at) as last_api").
		Group("user_id, username").
		Scan(&apiRows).Error
	if err != nil {
		return nil, err
	}
	for _, r := range apiRows {
		if r.UserId <= 0 {
			continue
		}
		item := activity[r.UserId]
		if item == nil {
			item = &IpUserActivityV2{UserId: r.UserId, Username: r.Username}
			activity[r.UserId] = item
		}
		item.ApiCount = r.Count
		item.LastApi = r.LastApi
		if item.LastSeen < r.LastApi {
			item.LastSeen = r.LastApi
		}
	}

	return activity, nil
}

// IpAnalyticsResult holds aggregated IP analytics data.
type IpAnalyticsResult struct {
	TotalRecords int64              `json:"total_records"`
	DistinctIps  int64              `json:"distinct_ips"`
	DistinctUsers int64             `json:"distinct_users"`
	TodayLogins  int64              `json:"today_logins"`
	TopIps       []*IpCountItem     `json:"top_ips"`
	CountryDist  []*NameCountItem   `json:"country_dist"`
	LoginTypeDist []*NameCountItem  `json:"login_type_dist"`
	TopUsers     []*UserLoginCount  `json:"top_users"`
}

type IpCountItem struct {
	Ip    string `json:"ip"`
	Count int64  `json:"count"`
}

type NameCountItem struct {
	Name  string `json:"name"`
	Count int64  `json:"count"`
}

type UserLoginCount struct {
	UserId   int    `json:"user_id"`
	Username string `json:"username"`
	IpCount  int64  `json:"ip_count"`
}

// UserApiIpRecord represents an API usage IP record for a user.
type UserApiIpRecord struct {
	Ip        string `json:"ip"`
	Count     int64  `json:"count"`
	LastUsed  int64  `json:"last_used"`
	ModelName string `json:"model_name"`
}

// GetApiIpRecordsByUserId returns paginated API usage IP records for a specific user.
func GetApiIpRecordsByUserId(tenantId int, userId int, page, pageSize int) ([]*UserApiIpRecord, int64, error) {
	var results []*UserApiIpRecord
	var total int64

	// Count distinct IPs
	countTx := LOG_DB.Model(&Log{}).Where("user_id = ? AND ip != ''", userId)
	if tenantId > 0 {
		countTx = countTx.Where("tenant_id = ?", tenantId)
	}
	countTx.Select("COUNT(DISTINCT ip)").Scan(&total)

	dataTx := LOG_DB.Model(&Log{}).Where("user_id = ? AND ip != ''", userId)
	if tenantId > 0 {
		dataTx = dataTx.Where("tenant_id = ?", tenantId)
	}
	offset := (page - 1) * pageSize
	err := dataTx.
		Select("ip, COUNT(*) as count, MAX(created_at) as last_used, MAX(model_name) as model_name").
		Group("ip").
		Order("last_used DESC").
		Offset(offset).
		Limit(pageSize).
		Find(&results).Error

	return results, total, err
}

// GetIpAnalytics returns aggregated IP analytics within a time range.
func GetIpAnalytics(tenantId int, startTs, endTs int64) (*IpAnalyticsResult, error) {
	result := &IpAnalyticsResult{}

	baseCond := func(tx *gorm.DB) *gorm.DB {
		tx = tx.Where("created_at >= ? AND created_at <= ?", startTs, endTs)
		if tenantId > 0 {
			tx = tx.Where("tenant_id = ?", tenantId)
		}
		return tx
	}

	// Total records
	baseCond(DB.Model(&UserIpRecord{})).Count(&result.TotalRecords)

	// Distinct IPs
	baseCond(DB.Model(&UserIpRecord{})).
		Select("COUNT(DISTINCT ip)").
		Scan(&result.DistinctIps)

	// Distinct users
	baseCond(DB.Model(&UserIpRecord{})).
		Select("COUNT(DISTINCT user_id)").
		Scan(&result.DistinctUsers)

	// Today logins
	todayStart := time.Now().Truncate(24 * time.Hour).Unix()
	todayTx := DB.Model(&UserIpRecord{}).Where("created_at >= ?", todayStart)
	if tenantId > 0 {
		todayTx = todayTx.Where("tenant_id = ?", tenantId)
	}
	todayTx.Count(&result.TodayLogins)

	// Top IPs
	baseCond(DB.Model(&UserIpRecord{})).
		Select("ip, COUNT(*) as count").
		Group("ip").
		Order("count DESC").
		Limit(20).
		Find(&result.TopIps)

	// Login type distribution
	baseCond(DB.Model(&UserIpRecord{})).
		Select("login_type as name, COUNT(*) as count").
		Group("login_type").
		Order("count DESC").
		Find(&result.LoginTypeDist)

	// Top users by distinct IP count
	baseCond(DB.Model(&UserIpRecord{})).
		Select("user_id, username, COUNT(DISTINCT ip) as ip_count").
		Group("user_id, username").
		Order("ip_count DESC").
		Limit(20).
		Find(&result.TopUsers)

	return result, nil
}
