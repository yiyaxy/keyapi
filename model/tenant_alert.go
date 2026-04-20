package model

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// TenantAlertRecord 是告警的持久化记录。
//
// 生命周期：active → acknowledged → resolved
//   - active：当前仍然触发（CheckTenantAlerts 仍会产出同 alert_type 的告警）
//   - acknowledged：运维已确认，但触发条件仍然存在（UI 不再醒目，直到真正解除）
//   - resolved：触发条件已消除，或运维手动解除
//
// 唯一性：为每个 (tenant_id, alert_type) 在同一时刻只允许一条 **active**
// 或 **acknowledged** 状态的记录（通过 tenantUpsertAlert 保证）。resolved
// 记录保留作为历史。
type TenantAlertRecord struct {
	Id             int            `json:"id" gorm:"primaryKey"`
	TenantId       int            `json:"tenant_id" gorm:"index;not null"`
	AlertType      string         `json:"alert_type" gorm:"type:varchar(64);not null;index"`
	Severity       string         `json:"severity" gorm:"type:varchar(16);not null;default:'warning'"`
	Message        string         `json:"message" gorm:"type:text"`
	Status         string         `json:"status" gorm:"type:varchar(16);not null;default:'active';index"`
	TriggeredAt    int64          `json:"triggered_at" gorm:"bigint;not null"`
	AcknowledgedAt int64          `json:"acknowledged_at,omitempty" gorm:"bigint;default:0"`
	AcknowledgedBy int            `json:"acknowledged_by,omitempty" gorm:"default:0"`
	ResolvedAt     int64          `json:"resolved_at,omitempty" gorm:"bigint;default:0"`
	CreatedAt      int64          `json:"created_at" gorm:"bigint;autoCreateTime"`
	UpdatedAt      int64          `json:"updated_at" gorm:"bigint;autoUpdateTime"`
	DeletedAt      gorm.DeletedAt `json:"-" gorm:"index"`
}

const (
	TenantAlertStatusActive       = "active"
	TenantAlertStatusAcknowledged = "acknowledged"
	TenantAlertStatusResolved     = "resolved"
)

// IsValidTenantAlertStatus 校验 status 字段。
func IsValidTenantAlertStatus(s string) bool {
	return s == TenantAlertStatusActive || s == TenantAlertStatusAcknowledged || s == TenantAlertStatusResolved
}

// UpsertTenantAlert 写入一条告警：
//   - 若 (tenant_id, alert_type) 已存在 active/acknowledged 记录 → 刷新 message/severity/triggered_at
//   - 否则新建 active 记录
//
// 返回最终生效的记录。
func UpsertTenantAlert(tenantId int, alertType, severity, message string, triggeredAt int64) (*TenantAlertRecord, error) {
	if tenantId <= 0 {
		return nil, errors.New("invalid tenantId")
	}
	if alertType == "" {
		return nil, errors.New("alertType required")
	}
	var existing TenantAlertRecord
	err := DB.Where("tenant_id = ? AND alert_type = ? AND status IN (?, ?)",
		tenantId, alertType, TenantAlertStatusActive, TenantAlertStatusAcknowledged).
		First(&existing).Error
	if err == nil {
		// 已有同类型未解决告警，刷新其内容
		updates := map[string]interface{}{
			"message":      message,
			"severity":     severity,
			"triggered_at": triggeredAt,
			"updated_at":   time.Now().Unix(),
		}
		if err := DB.Model(&existing).Where("tenant_id = ?", tenantId).Updates(updates).Error; err != nil {
			return nil, err
		}
		existing.Message = message
		existing.Severity = severity
		existing.TriggeredAt = triggeredAt
		return &existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	record := &TenantAlertRecord{
		TenantId:    tenantId,
		AlertType:   alertType,
		Severity:    severity,
		Message:     message,
		Status:      TenantAlertStatusActive,
		TriggeredAt: triggeredAt,
	}
	if err := DB.Create(record).Error; err != nil {
		return nil, err
	}
	return record, nil
}

// ResolveStaleTenantAlerts 将数据库里 status=active/acknowledged 但本次快照没命中的
// alert_type 标记为 resolved —— 表示触发条件已消除。
// `currentTypes` 为本次 CheckTenantAlerts 产出的类型集合。
func ResolveStaleTenantAlerts(tenantId int, currentTypes map[string]bool) error {
	if tenantId <= 0 {
		return errors.New("invalid tenantId")
	}
	now := time.Now().Unix()
	query := DB.Model(&TenantAlertRecord{}).
		Where("tenant_id = ? AND status IN (?, ?)", tenantId,
			TenantAlertStatusActive, TenantAlertStatusAcknowledged)
	if len(currentTypes) > 0 {
		keys := make([]string, 0, len(currentTypes))
		for k := range currentTypes {
			keys = append(keys, k)
		}
		query = query.Where("alert_type NOT IN ?", keys)
	}
	return query.Updates(map[string]interface{}{
		"status":      TenantAlertStatusResolved,
		"resolved_at": now,
		"updated_at":  now,
	}).Error
}

// ListActiveTenantAlerts 返回当前租户所有 active/acknowledged 告警（按严重度 + 时间倒序）。
func ListActiveTenantAlerts(tenantId int) ([]TenantAlertRecord, error) {
	if tenantId <= 0 {
		return nil, errors.New("invalid tenantId")
	}
	var items []TenantAlertRecord
	err := DB.Where("tenant_id = ? AND status IN (?, ?)", tenantId,
		TenantAlertStatusActive, TenantAlertStatusAcknowledged).
		Order("CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, triggered_at DESC").
		Find(&items).Error
	return items, err
}

// ListTenantAlertHistory 返回告警历史（分页），包括已解除。
func ListTenantAlertHistory(tenantId int, pageInfo *common.PageInfo, status string) ([]TenantAlertRecord, int64, error) {
	if tenantId <= 0 {
		return nil, 0, errors.New("invalid tenantId")
	}
	if pageInfo == nil {
		pageInfo = &common.PageInfo{Page: 1, PageSize: common.ItemsPerPage}
	}
	query := DB.Model(&TenantAlertRecord{}).Where("tenant_id = ?", tenantId)
	if status != "" {
		if !IsValidTenantAlertStatus(status) {
			return nil, 0, errors.New("invalid status filter")
		}
		query = query.Where("status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []TenantAlertRecord
	err := query.Order("triggered_at DESC").
		Offset(pageInfo.GetStartIdx()).Limit(pageInfo.PageSize).
		Find(&items).Error
	return items, total, err
}

// AcknowledgeTenantAlert 将告警置为 acknowledged 状态。
func AcknowledgeTenantAlert(tenantId, alertId, operatorId int) error {
	if tenantId <= 0 || alertId <= 0 {
		return errors.New("invalid params")
	}
	now := time.Now().Unix()
	res := DB.Model(&TenantAlertRecord{}).
		Where("id = ? AND tenant_id = ? AND status = ?", alertId, tenantId, TenantAlertStatusActive).
		Updates(map[string]interface{}{
			"status":          TenantAlertStatusAcknowledged,
			"acknowledged_at": now,
			"acknowledged_by": operatorId,
			"updated_at":      now,
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return errors.New("告警不存在、不属于当前租户，或状态已变更")
	}
	return nil
}

// ListAlertsCreatedSince 返回自 `sinceUnix` 起新创建的 active 告警（跨租户）。
// 供定时巡检 sweep 的推送流程使用。
func ListAlertsCreatedSince(sinceUnix int64) ([]TenantAlertRecord, error) {
	var items []TenantAlertRecord
	err := WithTenantBypass(DB).
		Where("created_at >= ? AND status = ?", sinceUnix, TenantAlertStatusActive).
		Order("created_at ASC").
		Find(&items).Error
	return items, err
}

// ListActiveTenantsForSweep 返回所有 status=active 的租户（跨租户查询，仅限巡检场景）。
func ListActiveTenantsForSweep() ([]Tenant, error) {
	var items []Tenant
	err := DB.Where("status = ?", TenantStatusActive).Find(&items).Error
	return items, err
}

// ResolveTenantAlert 将告警置为 resolved 状态（手动解除）。
func ResolveTenantAlert(tenantId, alertId int) error {
	if tenantId <= 0 || alertId <= 0 {
		return errors.New("invalid params")
	}
	now := time.Now().Unix()
	res := DB.Model(&TenantAlertRecord{}).
		Where("id = ? AND tenant_id = ? AND status IN (?, ?)", alertId, tenantId,
			TenantAlertStatusActive, TenantAlertStatusAcknowledged).
		Updates(map[string]interface{}{
			"status":      TenantAlertStatusResolved,
			"resolved_at": now,
			"updated_at":  now,
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return errors.New("告警不存在、不属于当前租户，或已解除")
	}
	return nil
}
