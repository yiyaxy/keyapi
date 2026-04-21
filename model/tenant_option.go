package model

import (
	"fmt"

	"gorm.io/gorm/clause"
)

type TenantOption struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	TenantId  int    `json:"tenant_id" gorm:"uniqueIndex:uk_tenant_option,priority:1;not null"`
	Key       string `json:"key" gorm:"uniqueIndex:uk_tenant_option,priority:2;type:varchar(128);not null"`
	Value     string `json:"value" gorm:"type:text"`
	UpdatedAt int64  `json:"updated_at" gorm:"bigint;autoUpdateTime"`
}

// GetTenantOption queries a single tenant-specific option override.
// Returns the value and whether it was found.
func GetTenantOption(tenantId int, key string) (string, bool) {
	var opt TenantOption
	err := WithTenantBypass(DB).
		Where("tenant_id = ? AND " + commonKeyCol + " = ?", tenantId, key).
		First(&opt).Error
	if err != nil {
		return "", false
	}
	return opt.Value, true
}

// SetTenantOption upserts a tenant-specific option override.
func SetTenantOption(tenantId int, key, value string) error {
	opt := TenantOption{
		TenantId: tenantId,
		Key:      key,
		Value:    value,
	}
	return WithTenantBypass(DB).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "tenant_id"}, {Name: "key"}},
			DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"}),
		}).
		Create(&opt).Error
}

// DeleteTenantOption removes a tenant-specific option override, reverting to platform default.
func DeleteTenantOption(tenantId int, key string) error {
	return WithTenantBypass(DB).
		Where("tenant_id = ? AND " + commonKeyCol + " = ?", tenantId, key).
		Delete(&TenantOption{}).Error
}

// GetAllTenantOptions returns all option overrides for a given tenant as a key-value map.
func GetAllTenantOptions(tenantId int) (map[string]string, error) {
	var opts []TenantOption
	err := WithTenantBypass(DB).
		Where("tenant_id = ?", tenantId).
		Find(&opts).Error
	if err != nil {
		return nil, err
	}
	result := make(map[string]string, len(opts))
	for _, o := range opts {
		result[o.Key] = o.Value
	}
	return result, nil
}

// GetTenantOptionsByKeys returns a subset of tenant option overrides matching the given keys.
func GetTenantOptionsByKeys(tenantId int, keys []string) (map[string]string, error) {
	if len(keys) == 0 {
		return make(map[string]string), nil
	}
	var opts []TenantOption
	err := WithTenantBypass(DB).
		Where("tenant_id = ? AND " + commonKeyCol + " IN ?", tenantId, keys).
		Find(&opts).Error
	if err != nil {
		return nil, err
	}
	result := make(map[string]string, len(opts))
	for _, o := range opts {
		result[o.Key] = o.Value
	}
	return result, nil
}

func (TenantOption) TableName() string {
	return "tenant_options"
}

const (
	TenantOptionKeyPlatformChannelMode = "platform_channel_mode"

	PlatformChannelModePrivatePriority  = "private_priority"
	PlatformChannelModePlatformPriority = "platform_priority"
	PlatformChannelModeOnlyPrivate      = "only_private"
	PlatformChannelModeOnlyPlatform     = "only_platform"
)

func isValidPlatformChannelMode(s string) bool {
	switch s {
	case PlatformChannelModePrivatePriority,
		PlatformChannelModePlatformPriority,
		PlatformChannelModeOnlyPrivate,
		PlatformChannelModeOnlyPlatform:
		return true
	}
	return false
}

// GetTenantPlatformChannelMode returns the tenant's configured mode.
// Returns PlatformChannelModePrivatePriority if unset or if the stored value is invalid.
func GetTenantPlatformChannelMode(tenantId int) (string, error) {
	if tenantId <= 0 {
		return PlatformChannelModePrivatePriority, nil
	}
	v, ok := GetTenantOption(tenantId, TenantOptionKeyPlatformChannelMode)
	if !ok || !isValidPlatformChannelMode(v) {
		return PlatformChannelModePrivatePriority, nil
	}
	return v, nil
}

// SetTenantPlatformChannelMode validates and persists the mode.
func SetTenantPlatformChannelMode(tenantId int, mode string) error {
	if !isValidPlatformChannelMode(mode) {
		return fmt.Errorf("invalid platform_channel_mode: %q", mode)
	}
	return SetTenantOption(tenantId, TenantOptionKeyPlatformChannelMode, mode)
}
