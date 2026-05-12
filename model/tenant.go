package model

import (
	"errors"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

type Tenant struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	Name      string `json:"name" gorm:"type:varchar(128);not null"`
	Slug      string `json:"slug" gorm:"type:varchar(64);uniqueIndex;not null"`
	Status    int    `json:"status" gorm:"default:1"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;autoCreateTime"`
	UpdatedAt int64  `json:"updated_at" gorm:"bigint;autoUpdateTime"`
}

type PlatformTenant struct {
	Tenant
	LastLoginAt   int64  `json:"last_login_at"`
	AdminUserId   int    `json:"admin_user_id"`
	AdminUsername string `json:"admin_username"`
}

const (
	TenantStatusActive    = 1
	TenantStatusSuspended = 2
	TenantStatusDeleted   = 3

	DefaultTenantId = 1
)

// ---------- cache ----------

var (
	tenantSlugCache sync.Map // slug -> *Tenant
	tenantIdCache   sync.Map // id   -> *Tenant
)

func ClearTenantCache() {
	tenantSlugCache = sync.Map{}
	tenantIdCache = sync.Map{}
}

// ---------- queries ----------

func GetTenantBySlug(slug string) *Tenant {
	if v, ok := tenantSlugCache.Load(slug); ok {
		return v.(*Tenant)
	}
	if DB == nil {
		return nil
	}
	var t Tenant
	if err := DB.Where("slug = ? AND status = ?", slug, TenantStatusActive).First(&t).Error; err != nil {
		return nil
	}
	tenantSlugCache.Store(slug, &t)
	tenantIdCache.Store(t.Id, &t)
	return &t
}

func GetTenantById(id int) *Tenant {
	if v, ok := tenantIdCache.Load(id); ok {
		return v.(*Tenant)
	}
	if DB == nil {
		return nil
	}
	var t Tenant
	if err := DB.Where("id = ? AND status = ?", id, TenantStatusActive).First(&t).Error; err != nil {
		return nil
	}
	tenantSlugCache.Store(t.Slug, &t)
	tenantIdCache.Store(t.Id, &t)
	return &t
}

// ListAllTenants returns non-deleted tenants in descending creation time order.
func ListAllTenants(offset, limit int) ([]PlatformTenant, int64, error) {
	var total int64
	if err := WithTenantBypass(DB).Model(&Tenant{}).Where("status <> ?", TenantStatusDeleted).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var tenants []Tenant
	err := WithTenantBypass(DB).Model(&Tenant{}).
		Where("status <> ?", TenantStatusDeleted).
		Order("created_at DESC").
		Order("id DESC").
		Offset(offset).
		Limit(limit).
		Find(&tenants).Error
	if err != nil {
		return nil, 0, err
	}
	items := make([]PlatformTenant, 0, len(tenants))
	if len(tenants) == 0 {
		return items, total, nil
	}
	tenantIDs := make([]int, 0, len(tenants))
	for _, tenant := range tenants {
		tenantIDs = append(tenantIDs, tenant.Id)
		items = append(items, PlatformTenant{Tenant: tenant})
	}
	var loginRows []struct {
		TenantId    int   `gorm:"column:tenant_id"`
		LastLoginAt int64 `gorm:"column:last_login_at"`
	}
	if err := WithTenantBypass(DB).Table("user_ip_records AS r").
		Select("u.tenant_id, MAX(r.created_at) as last_login_at").
		Joins("JOIN users u ON u.id = r.user_id").
		Where("u.tenant_id IN ?", tenantIDs).
		Group("u.tenant_id").
		Scan(&loginRows).Error; err != nil {
		return nil, 0, err
	}
	lastLoginByTenant := make(map[int]int64, len(loginRows))
	for _, row := range loginRows {
		lastLoginByTenant[row.TenantId] = row.LastLoginAt
	}
	for i := range items {
		items[i].LastLoginAt = lastLoginByTenant[items[i].Id]
	}
	var adminRows []struct {
		TenantId int    `gorm:"column:tenant_id"`
		UserId   int    `gorm:"column:user_id"`
		Username string `gorm:"column:username"`
	}
	if err := WithTenantBypass(DB).Table("tenant_memberships AS tm").
		Select("tm.tenant_id, tm.user_id, u.username").
		Joins("JOIN users u ON u.id = tm.user_id").
		Where("tm.tenant_id IN ? AND tm.role = ? AND tm.status <> ?", tenantIDs, TenantRoleAdmin, TenantMembershipStatusRemoved).
		Order("tm.id ASC").
		Scan(&adminRows).Error; err != nil {
		return nil, 0, err
	}
	adminByTenant := make(map[int]struct {
		UserId   int
		Username string
	}, len(adminRows))
	for _, row := range adminRows {
		if _, ok := adminByTenant[row.TenantId]; ok {
			continue
		}
		adminByTenant[row.TenantId] = struct {
			UserId   int
			Username string
		}{UserId: row.UserId, Username: row.Username}
	}
	var userAdminRows []struct {
		TenantId int    `gorm:"column:tenant_id"`
		UserId   int    `gorm:"column:user_id"`
		Username string `gorm:"column:username"`
	}
	if err := WithTenantBypass(DB).Table("users AS u").
		Select("u.tenant_id, u.id as user_id, u.username").
		Where("u.tenant_id IN ? AND u.role >= ? AND u.status = ?", tenantIDs, TenantRoleAdmin, common.UserStatusEnabled).
		Order("u.id ASC").
		Scan(&userAdminRows).Error; err != nil {
		return nil, 0, err
	}
	for _, row := range userAdminRows {
		if _, ok := adminByTenant[row.TenantId]; ok {
			continue
		}
		adminByTenant[row.TenantId] = struct {
			UserId   int
			Username string
		}{UserId: row.UserId, Username: row.Username}
	}
	for i := range items {
		admin := adminByTenant[items[i].Id]
		items[i].AdminUserId = admin.UserId
		items[i].AdminUsername = admin.Username
	}
	return items, total, nil
}

func CreateTenant(tenant *Tenant) error {
	if tenant.Slug == "" {
		return errors.New("tenant slug is required")
	}
	return DB.Create(tenant).Error
}

// UpdateTenant updates specified fields for a tenant by ID.
func UpdateTenant(id int, updates map[string]interface{}) error {
	if id <= 0 {
		return errors.New("invalid tenant id")
	}
	result := DB.Model(&Tenant{}).Where("id = ?", id).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("tenant not found")
	}
	return nil
}

// EnsureDefaultTenant creates the default tenant (id=1) if it doesn't exist.
func EnsureDefaultTenant() error {
	var count int64
	DB.Model(&Tenant{}).Where("id = ?", DefaultTenantId).Count(&count)
	if count > 0 {
		return nil
	}
	return DB.Create(&Tenant{
		Id:     DefaultTenantId,
		Name:   "Default",
		Slug:   "default",
		Status: TenantStatusActive,
	}).Error
}
