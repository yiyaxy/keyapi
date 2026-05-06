package model

import (
	"errors"
	"strings"
)

// TenantXpayProduct maps an operator-managed top-up tier to the virtual item
// product_id configured in the WeChat mini-program/SAS console.
type TenantXpayProduct struct {
	Id          int    `json:"id" gorm:"primaryKey"`
	TenantId    int    `json:"tenant_id" gorm:"index:idx_tenant_xpay_product,unique;not null"`
	TierCode    string `json:"tier_code" gorm:"index:idx_tenant_xpay_product,unique;type:varchar(64);not null"`
	Name        string `json:"name" gorm:"type:varchar(128);not null"`
	ProductId   string `json:"product_id" gorm:"type:varchar(64)"`
	Platform    string `json:"platform" gorm:"index:idx_tenant_xpay_product,unique;type:varchar(16);default:'android'"`
	AmountCents int64  `json:"amount_cents" gorm:"bigint;not null"`
	QuotaDelta  int64  `json:"quota_delta" gorm:"bigint;not null"`
	Enabled     bool   `json:"enabled" gorm:"default:false"`
	SortOrder   int    `json:"sort_order" gorm:"default:0"`
	CreatedAt   int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

func normalizeXpayPlatform(platform string) string {
	platform = strings.TrimSpace(strings.ToLower(platform))
	if platform == "" {
		return "android"
	}
	return platform
}

func GetTenantXpayProductByTier(tenantId int, tierCode string, platform string) (*TenantXpayProduct, error) {
	if tenantId <= 0 || strings.TrimSpace(tierCode) == "" {
		return nil, errors.New("invalid tenantId or tierCode")
	}
	var row TenantXpayProduct
	err := WithTenantBypass(DB).
		Where("tenant_id = ? AND tier_code = ? AND platform = ?", tenantId, strings.TrimSpace(tierCode), normalizeXpayPlatform(platform)).
		First(&row).Error
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func ListEnabledTenantXpayProducts(tenantId int, platform string) ([]TenantXpayProduct, error) {
	if tenantId <= 0 {
		return nil, errors.New("invalid tenantId")
	}
	var rows []TenantXpayProduct
	err := WithTenantBypass(DB).
		Where("tenant_id = ? AND platform = ? AND enabled = ? AND product_id <> ''", tenantId, normalizeXpayPlatform(platform), true).
		Order("sort_order ASC, id ASC").
		Find(&rows).Error
	return rows, err
}
