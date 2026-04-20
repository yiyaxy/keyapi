package model

import (
	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// TenantChannelOverride records that a tenant has explicitly disabled a
// specific platform channel. Only "disabled" rows are stored; an absent row
// means "enabled (default)". See spec §3.5.
type TenantChannelOverride struct {
	TenantId  int   `json:"tenant_id" gorm:"primaryKey;not null"`
	ChannelId int   `json:"channel_id" gorm:"primaryKey;not null;index"`
	Disabled  bool  `json:"disabled" gorm:"not null;default:true"`
	CreatedAt int64 `json:"created_at" gorm:"bigint;autoCreateTime"`
}

func (TenantChannelOverride) TableName() string {
	return "tenant_channel_overrides"
}

// GetTenantDisabledPlatformChannels returns the set of platform channel IDs
// the tenant has disabled. Returns an empty map if none.
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

// SetTenantChannelDisabled upserts (disabled=true) or deletes (disabled=false)
// the override row.
func SetTenantChannelDisabled(tenantId, channelId int, disabled bool) error {
	if tenantId <= 0 || channelId <= 0 {
		return gorm.ErrInvalidData
	}
	if !disabled {
		return DB.Where("tenant_id = ? AND channel_id = ?", tenantId, channelId).
			Delete(&TenantChannelOverride{}).Error
	}
	row := TenantChannelOverride{
		TenantId:  tenantId,
		ChannelId: channelId,
		Disabled:  true,
		CreatedAt: common.GetTimestamp(),
	}
	return DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "tenant_id"}, {Name: "channel_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"disabled"}),
	}).Create(&row).Error
}
