package model

import (
	"errors"
	"sync"
)

type Tenant struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	Name      string `json:"name" gorm:"type:varchar(128);not null"`
	Slug      string `json:"slug" gorm:"type:varchar(64);uniqueIndex;not null"`
	Status    int    `json:"status" gorm:"default:1"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;autoCreateTime"`
	UpdatedAt int64  `json:"updated_at" gorm:"bigint;autoUpdateTime"`
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

// ListAllTenants 返回所有租户（不含已删除），按 id 升序。供平台级管理 UI 使用。
func ListAllTenants() ([]Tenant, error) {
	var items []Tenant
	err := DB.Where("status <> ?", TenantStatusDeleted).Order("id ASC").Find(&items).Error
	return items, err
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
