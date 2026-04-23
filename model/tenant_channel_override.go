package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// TenantChannelOverride records that a tenant cannot use a specific
// platform channel. Only "disabled" rows are stored; an absent row means
// "enabled (default)". See spec §3.5.
//
// LockedByAdmin distinguishes platform-admin enforced blocks from
// tenant-self disables. When LockedByAdmin is true the tenant cannot
// re-enable the channel through its own UI (see SetTenantChannelDisabledAsTenant).
type TenantChannelOverride struct {
	TenantId      int   `json:"tenant_id" gorm:"primaryKey;not null"`
	ChannelId     int   `json:"channel_id" gorm:"primaryKey;not null;index"`
	Disabled      bool  `json:"disabled" gorm:"not null;default:true"`
	LockedByAdmin bool  `json:"locked_by_admin" gorm:"not null;default:false"`
	CreatedAt     int64 `json:"created_at" gorm:"bigint;autoCreateTime"`
}

func (TenantChannelOverride) TableName() string {
	return "tenant_channel_overrides"
}

// ErrTenantChannelLocked is returned by SetTenantChannelDisabledAsTenant
// when the target row was written by platform admin (LockedByAdmin=true).
// Callers should surface this as 403 Forbidden.
var ErrTenantChannelLocked = errors.New("channel is disabled by platform admin")

// GetTenantDisabledPlatformChannels returns the set of platform channel IDs
// the tenant currently cannot use. Combines tenant self-disables and
// admin-locks — the routing layer only cares about the union.
func GetTenantDisabledPlatformChannels(tenantId int) (map[int]struct{}, error) {
	result := make(map[int]struct{})
	if tenantId <= 0 {
		return result, nil
	}
	var rows []TenantChannelOverride
	if err := DB.Where("tenant_id = ? AND disabled = ?", tenantId, true).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, r := range rows {
		result[r.ChannelId] = struct{}{}
	}
	return result, nil
}

// GetTenantLockedPlatformChannels returns the subset of disabled channels
// that are admin-locked. UI uses this to mark a channel as "cannot be
// re-enabled by tenant" and disable the toggle.
func GetTenantLockedPlatformChannels(tenantId int) (map[int]struct{}, error) {
	result := make(map[int]struct{})
	if tenantId <= 0 {
		return result, nil
	}
	var rows []TenantChannelOverride
	if err := DB.
		Where("tenant_id = ? AND disabled = ? AND locked_by_admin = ?", tenantId, true, true).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, r := range rows {
		result[r.ChannelId] = struct{}{}
	}
	return result, nil
}

// SetTenantChannelDisabledAsAdmin is the platform-admin write path. It can
// always flip the row — overwriting a tenant's self-disable with an admin
// lock, or clearing any override back to "default enabled" (delete).
func SetTenantChannelDisabledAsAdmin(tenantId, channelId int, disabled bool) error {
	if tenantId <= 0 || channelId <= 0 {
		return gorm.ErrInvalidData
	}
	if !disabled {
		// admin 启用 = 清除记录（无论之前是谁锁的）。若租户曾经自禁用，
		// 也一并被重置为默认启用 —— 简化语义，避免状态机二义。
		return DB.Where("tenant_id = ? AND channel_id = ?", tenantId, channelId).
			Delete(&TenantChannelOverride{}).Error
	}
	row := TenantChannelOverride{
		TenantId:      tenantId,
		ChannelId:     channelId,
		Disabled:      true,
		LockedByAdmin: true,
		CreatedAt:     common.GetTimestamp(),
	}
	return DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "tenant_id"}, {Name: "channel_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"disabled", "locked_by_admin"}),
	}).Create(&row).Error
}

// SetTenantChannelDisabledAsTenant is the tenant-self write path. Refuses
// to mutate a row that the platform admin has locked — returning
// ErrTenantChannelLocked so the HTTP layer can map to 403.
func SetTenantChannelDisabledAsTenant(tenantId, channelId int, disabled bool) error {
	if tenantId <= 0 || channelId <= 0 {
		return gorm.ErrInvalidData
	}
	// 先读当前 row 检查锁态。即便是启用操作（disabled=false），若当前 row
	// 是 admin-lock，也必须拒绝；否则租户能把 admin 锁"解开"。
	var existing TenantChannelOverride
	err := DB.Where("tenant_id = ? AND channel_id = ?", tenantId, channelId).First(&existing).Error
	if err == nil && existing.LockedByAdmin {
		return fmt.Errorf("%w", ErrTenantChannelLocked)
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if !disabled {
		return DB.Where("tenant_id = ? AND channel_id = ?", tenantId, channelId).
			Delete(&TenantChannelOverride{}).Error
	}
	row := TenantChannelOverride{
		TenantId:      tenantId,
		ChannelId:     channelId,
		Disabled:      true,
		LockedByAdmin: false,
		CreatedAt:     common.GetTimestamp(),
	}
	return DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "tenant_id"}, {Name: "channel_id"}},
		// 只覆盖 disabled —— locked_by_admin 保持 false（租户写入路径永远是 false）
		DoUpdates: clause.AssignmentColumns([]string{"disabled"}),
	}).Create(&row).Error
}

// SetTenantChannelDisabled is kept for backwards compatibility; delegates to
// the admin-authority variant. New callers should pick AsAdmin or AsTenant
// explicitly — authority matters for lock semantics.
//
// Deprecated: prefer SetTenantChannelDisabledAsAdmin / SetTenantChannelDisabledAsTenant.
func SetTenantChannelDisabled(tenantId, channelId int, disabled bool) error {
	return SetTenantChannelDisabledAsAdmin(tenantId, channelId, disabled)
}
