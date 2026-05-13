package model

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// TenantPlan represents a tenant-level billing plan with quota and rate limits.
type TenantPlan struct {
	Id                 int    `json:"id" gorm:"primaryKey"`
	TenantId           int    `json:"tenant_id" gorm:"uniqueIndex;not null"`
	PlanName           string `json:"plan_name" gorm:"type:varchar(64);not null;default:'free'"`
	QuotaLimit         int64  `json:"quota_limit" gorm:"bigint;default:-1"` // -1 = unlimited
	RPMLimit           int    `json:"rpm_limit" gorm:"default:-1"`          // requests per minute, -1 = unlimited
	TPMLimit           int    `json:"tpm_limit" gorm:"default:-1"`          // tokens per minute, -1 = unlimited
	MaxMembers         int    `json:"max_members" gorm:"default:-1"`        // -1 = unlimited
	MaxTokens          int    `json:"max_tokens" gorm:"default:-1"`         // API tokens limit
	MaxChannels        int    `json:"max_channels" gorm:"default:-1"`
	AllowedModels      string `json:"allowed_models" gorm:"type:text"`       // comma-separated, empty = all
	Status             int    `json:"status" gorm:"default:1"`               // 1=active
	ExpiresAt          int64  `json:"expires_at" gorm:"bigint;default:0"`    // 0 = never expires
	GracePeriodSeconds int64  `json:"grace_period_seconds" gorm:"default:0"` // grace period after expires_at before disabling; 0 = no grace, immediate disable
	// Renewal pricing (S2). Platform admin configures via UpdateTenantPlanRequest.
	// - RenewPeriodDays: how many days each renewal order extends ExpiresAt.
	// - RenewPriceAmount: unit price in CNY cents. <=0 disables renewal ordering.
	// - RenewCurrency: v1 only "CNY".
	RenewPeriodDays  int    `json:"renew_period_days" gorm:"default:30"`
	RenewPriceAmount int64  `json:"renew_price_amount" gorm:"bigint;default:0"`
	RenewCurrency    string `json:"renew_currency" gorm:"type:varchar(8);default:'CNY'"`
	// PlatformMarkup is the default markup ratio for platform channels.
	// Falls back value when channel.markup_ratio is unset.
	// Defaults to 1.0 (no markup).
	PlatformMarkup float64 `json:"platform_markup" gorm:"not null;default:1.0"`
	// PlatformQuotaCap is the per-period quota ceiling for platform-scope channels.
	// -1 means unlimited; 0 means blocked. New tenants default to blocked so
	// platform shared channels are enabled deliberately.
	PlatformQuotaCap int64 `json:"platform_quota_cap" gorm:"bigint;default:0"`
	// PlatformQuotaPeriod controls when PlatformQuotaUsed resets to zero.
	// One of: none, daily, monthly.
	PlatformQuotaPeriod string `json:"platform_quota_period" gorm:"type:varchar(16);default:'none'"`
	// PlatformQuotaUsed is the amount consumed within the current period.
	PlatformQuotaUsed int64 `json:"platform_quota_used" gorm:"bigint;default:0"`
	// PlatformQuotaPeriodStart is the unix timestamp anchoring the current period.
	PlatformQuotaPeriodStart int64 `json:"platform_quota_period_start" gorm:"bigint;default:0"`
	CreatedAt                int64 `json:"created_at" gorm:"bigint;autoCreateTime"`
	UpdatedAt                int64 `json:"updated_at" gorm:"bigint;autoUpdateTime"`
}

const (
	TenantPlanStatusActive   = 1
	TenantPlanStatusDisabled = 0

	TenantPlanDefaultName = "free"

	PlatformQuotaPeriodNone    = "none"
	PlatformQuotaPeriodDaily   = "daily"
	PlatformQuotaPeriodMonthly = "monthly"
)

// ---------- cache ----------

var tenantPlanCache sync.Map // tenantId -> *TenantPlan

// InvalidateTenantPlanCache removes the cached plan for a given tenant on
// THIS node only. Callers that just wrote to tenant_plans should use
// BroadcastInvalidateTenantPlan instead, so peer nodes also drop their
// stale in-memory copy. This local-only variant is kept for the pub/sub
// subscriber path, where re-publishing would form a network amplification.
func InvalidateTenantPlanCache(tenantId int) {
	tenantPlanCache.Delete(tenantId)
}

// BroadcastInvalidateTenantPlan evicts the local cached plan AND notifies
// peer nodes (via Redis pub/sub) to do the same. Use this whenever
// tenant_plans was just written (UpsertTenantPlan, platform-quota
// increment/reset, plan disable, payment-driven expires_at extension, ...).
//
// No-op publish when Redis is disabled (single-instance mode); local cache
// is still cleared. Publish errors are intentionally swallowed: a failed
// broadcast leaves peers with stale cache, but the local write is already
// durable and SYNC_FREQUENCY-driven full reloads will eventually converge.
func BroadcastInvalidateTenantPlan(tenantId int) {
	InvalidateTenantPlanCache(tenantId)
	if err := common.PublishInvalidate(common.InvalidateMessage{
		Type: "tenant_plan",
		Key:  strconv.Itoa(tenantId),
	}); err != nil {
		common.SysError(fmt.Sprintf("BroadcastInvalidateTenantPlan publish failed tenant=%d: %s", tenantId, err.Error()))
	}
}

// ClearTenantPlanCache removes all cached tenant plans.
func ClearTenantPlanCache() {
	tenantPlanCache = sync.Map{}
}

// ---------- queries ----------

// GetTenantPlan returns the plan for a tenant, creating a default free plan if none exists.
func GetTenantPlan(tenantId int) (*TenantPlan, error) {
	if tenantId <= 0 {
		return nil, fmt.Errorf("%w: GetTenantPlan requires an explicit tenant", ErrTenantRequired)
	}

	// Check cache first
	if cached, ok := tenantPlanCache.Load(tenantId); ok {
		return cached.(*TenantPlan), nil
	}

	var plan TenantPlan
	err := WithTenantBypass(DB).Where("tenant_id = ?", tenantId).First(&plan).Error
	if err == nil {
		tenantPlanCache.Store(tenantId, &plan)
		return &plan, nil
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err
	}

	// Create default free plan
	now := common.GetTimestamp()
	plan = TenantPlan{
		TenantId:                 tenantId,
		PlanName:                 TenantPlanDefaultName,
		QuotaLimit:               -1,
		RPMLimit:                 -1,
		TPMLimit:                 -1,
		MaxMembers:               -1,
		MaxTokens:                -1,
		MaxChannels:              -1,
		PlatformMarkup:           1.0,
		PlatformQuotaCap:         0,
		PlatformQuotaPeriod:      PlatformQuotaPeriodNone,
		PlatformQuotaUsed:        0,
		PlatformQuotaPeriodStart: 0,
		Status:                   TenantPlanStatusActive,
		ExpiresAt:                0,
		CreatedAt:                now,
		UpdatedAt:                now,
	}
	if err := WithTenantBypass(DB).Create(&plan).Error; err != nil {
		// Another goroutine may have created it concurrently; try to read again
		var existing TenantPlan
		if err2 := WithTenantBypass(DB).Where("tenant_id = ?", tenantId).First(&existing).Error; err2 == nil {
			tenantPlanCache.Store(tenantId, &existing)
			return &existing, nil
		}
		return nil, err
	}
	tenantPlanCache.Store(tenantId, &plan)
	return &plan, nil
}

// UpsertTenantPlan creates or updates a tenant plan.
func UpsertTenantPlan(plan *TenantPlan) error {
	if plan == nil {
		return errors.New("tenant plan is nil")
	}
	if plan.TenantId <= 0 {
		return fmt.Errorf("%w: UpsertTenantPlan requires an explicit tenant", ErrTenantRequired)
	}
	plan.UpdatedAt = common.GetTimestamp()

	var existing TenantPlan
	err := WithTenantBypass(DB).Where("tenant_id = ?", plan.TenantId).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		// Insert
		plan.CreatedAt = common.GetTimestamp()
		if err := WithTenantBypass(DB).Create(plan).Error; err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else {
		// Update
		plan.Id = existing.Id
		if err := WithTenantBypass(DB).Save(plan).Error; err != nil {
			return err
		}
	}

	BroadcastInvalidateTenantPlan(plan.TenantId)
	return nil
}

// IsTenantPlanExpired checks whether the plan has expired.
func IsTenantPlanExpired(plan *TenantPlan) bool {
	if plan == nil {
		return true
	}
	if plan.ExpiresAt <= 0 {
		return false // 0 = never expires
	}
	return time.Now().Unix() > plan.ExpiresAt
}

// EffectiveExpireAt returns the absolute unix timestamp at which the plan should
// transition to disabled, factoring in the grace period.
// Returns 0 if the plan never expires.
func EffectiveExpireAt(plan *TenantPlan) int64 {
	if plan == nil || plan.ExpiresAt <= 0 {
		return 0
	}
	if plan.GracePeriodSeconds < 0 {
		return plan.ExpiresAt
	}
	return plan.ExpiresAt + plan.GracePeriodSeconds
}

// IsTenantPlanInGracePeriod returns true when the plan's expires_at has passed
// but the grace window has not yet elapsed (i.e. expires_at < now <= expires_at + grace).
func IsTenantPlanInGracePeriod(plan *TenantPlan) bool {
	if plan == nil || plan.ExpiresAt <= 0 || plan.GracePeriodSeconds <= 0 {
		return false
	}
	now := time.Now().Unix()
	return now > plan.ExpiresAt && now <= plan.ExpiresAt+plan.GracePeriodSeconds
}

// GetAllTenantPlans returns all tenant plans (for platform admin).
func GetAllTenantPlans() ([]TenantPlan, error) {
	var plans []TenantPlan
	if err := WithTenantBypass(DB).Order("tenant_id asc").Find(&plans).Error; err != nil {
		return nil, err
	}
	return plans, nil
}

// GetTenantPlanAllowedModels parses the AllowedModels field into a set.
// Returns nil if all models are allowed (empty string).
func GetTenantPlanAllowedModels(plan *TenantPlan) map[string]struct{} {
	if plan == nil || strings.TrimSpace(plan.AllowedModels) == "" {
		return nil
	}
	parts := strings.Split(plan.AllowedModels, ",")
	result := make(map[string]struct{}, len(parts))
	for _, p := range parts {
		m := strings.TrimSpace(p)
		if m != "" {
			result[m] = struct{}{}
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

// ComputePlatformQuotaPeriodReset decides whether the platform-channel quota
// period has rolled over. It is pure: no mutation, no cache writes, no DB.
//
// Returns (needReset, newPeriodStart). If needReset is false, callers should
// ignore newPeriodStart.
func ComputePlatformQuotaPeriodReset(period string, periodStart int64, now time.Time) (bool, int64) {
	switch period {
	case PlatformQuotaPeriodDaily:
		startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
		if periodStart < startOfToday {
			return true, startOfToday
		}
	case PlatformQuotaPeriodMonthly:
		startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).Unix()
		if periodStart < startOfMonth {
			return true, startOfMonth
		}
	}
	return false, 0
}
