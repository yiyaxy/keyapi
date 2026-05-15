package service

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
)

const tenantInactivitySuspendAfter = 7 * 24 * time.Hour

type inactiveTenantSuspendDetail struct {
	CutoffUnix int64  `json:"cutoff_unix"`
	Reason     string `json:"reason"`
}

func SuspendInactiveTenants(now time.Time) (int, error) {
	if now.IsZero() {
		now = time.Now()
	}
	cutoff := now.Add(-tenantInactivitySuspendAfter).Unix()

	var tenants []model.Tenant
	loginExists := model.WithTenantBypass(model.DB).
		Table("user_ip_records").
		Select("1").
		Where("user_ip_records.tenant_id = tenants.id").
		Where("user_ip_records.created_at >= ?", cutoff)
	adminMembershipExists := model.WithTenantBypass(model.DB).
		Table("tenant_memberships").
		Select("1").
		Where("tenant_memberships.tenant_id = tenants.id").
		Where("tenant_memberships.user_id = users.id").
		Where("tenant_memberships.status <> ?", model.TenantMembershipStatusRemoved).
		Where("tenant_memberships.role >= ?", model.TenantRoleAdmin).
		Where("tenant_memberships.deleted_at IS NULL")
	positiveUserQuotaExists := model.WithTenantBypass(model.DB).
		Table("users").
		Select("1").
		Where("users.tenant_id = tenants.id").
		Where("users.status = ?", common.UserStatusEnabled).
		Where("users.role < ?", common.RoleAdminUser).
		Where("users.quota > 0").
		Where("users.deleted_at IS NULL").
		Where("NOT EXISTS (?)", adminMembershipExists)

	if err := model.WithTenantBypass(model.DB).
		Model(&model.Tenant{}).
		Where("status = ?", model.TenantStatusActive).
		Where("id <> ?", model.DefaultTenantId).
		Where("created_at <= ?", cutoff).
		Where("NOT EXISTS (?)", loginExists).
		Where("NOT EXISTS (?)", positiveUserQuotaExists).
		Find(&tenants).Error; err != nil {
		return 0, err
	}

	suspended := 0
	for _, tenant := range tenants {
		detailBytes, _ := json.Marshal(inactiveTenantSuspendDetail{
			CutoffUnix: cutoff,
			Reason:     "no tenant login in the last 7 days",
		})
		err := model.DB.Transaction(func(tx *gorm.DB) error {
			res := model.WithTenantBypass(tx).
				Model(&model.Tenant{}).
				Where("id = ? AND status = ?", tenant.Id, model.TenantStatusActive).
				Updates(map[string]interface{}{
					"status":     model.TenantStatusSuspended,
					"updated_at": now.Unix(),
				})
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected == 0 {
				return nil
			}
			if err := model.CreateTenantAuditLogTx(tx, &model.TenantAuditLog{
				TenantId:  tenant.Id,
				ActorRole: "system",
				Action:    "tenant.auto_suspend_inactive",
				Target:    "tenant",
				TargetId:  tenant.Id,
				Detail:    string(detailBytes),
				CreatedAt: now.Unix(),
			}); err != nil {
				common.SysError(fmt.Sprintf("SuspendInactiveTenants audit failed tenant=%d: %s", tenant.Id, err.Error()))
			}
			suspended++
			return nil
		})
		if err != nil {
			return suspended, err
		}
	}
	if suspended > 0 {
		model.ClearTenantCache()
	}
	return suspended, nil
}

func RunTenantInactivitySweep() {
	n, err := SuspendInactiveTenants(time.Now())
	if err != nil {
		common.SysError(fmt.Sprintf("RunTenantInactivitySweep failed: %s", err.Error()))
		return
	}
	if n > 0 {
		common.SysLog(fmt.Sprintf("RunTenantInactivitySweep suspended %d inactive tenants", n))
	}
}
