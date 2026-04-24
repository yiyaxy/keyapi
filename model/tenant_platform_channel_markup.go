package model

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// TenantPlatformChannelMarkup stores a per-tenant override of platform-channel
// markup. It affects only the user-bill ledger; platform cost never reads it.
type TenantPlatformChannelMarkup struct {
	TenantId    int     `json:"tenant_id" gorm:"primaryKey;not null"`
	ChannelId   int     `json:"channel_id" gorm:"primaryKey;not null;index"`
	MarkupRatio float64 `json:"markup_ratio" gorm:"type:decimal(10,4);not null"`
	Enabled     bool    `json:"enabled" gorm:"not null;default:true"`
	CreatedAt   int64   `json:"created_at" gorm:"bigint;autoCreateTime"`
	UpdatedAt   int64   `json:"updated_at" gorm:"bigint;autoUpdateTime"`
}

func GetTenantPlatformChannelMarkup(tenantID, channelID int) (*TenantPlatformChannelMarkup, error) {
	var row TenantPlatformChannelMarkup
	err := DB.Where("tenant_id = ? AND channel_id = ? AND enabled = ?", tenantID, channelID, true).First(&row).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func UpsertTenantPlatformChannelMarkup(row *TenantPlatformChannelMarkup) error {
	return DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "tenant_id"},
			{Name: "channel_id"},
		},
		DoUpdates: clause.AssignmentColumns([]string{
			"markup_ratio",
			"enabled",
			"updated_at",
		}),
	}).Create(row).Error
}

func DeleteTenantPlatformChannelMarkup(tenantID, channelID int) error {
	return DB.Where("tenant_id = ? AND channel_id = ?", tenantID, channelID).Delete(&TenantPlatformChannelMarkup{}).Error
}
