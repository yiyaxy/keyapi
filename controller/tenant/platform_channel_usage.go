package tenant

import (
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type PlatformChannelUsageRow struct {
	TenantId            int    `json:"tenant_id"`
	TenantName          string `json:"tenant_name"`
	PlanName            string `json:"plan_name"`
	PlatformQuotaCap    int64  `json:"platform_quota_cap"`
	PlatformQuotaUsed   int64  `json:"platform_quota_used"`
	PlatformQuotaPeriod string `json:"platform_quota_period"`
	PeriodStart         int64  `json:"period_start"`
}

func applyEffectivePlatformQuota(plan *model.TenantPlan) {
	if plan == nil {
		return
	}
	if needReset, newStart := model.ComputePlatformQuotaPeriodReset(plan.PlatformQuotaPeriod, plan.PlatformQuotaPeriodStart, time.Now()); needReset {
		plan.PlatformQuotaUsed = 0
		plan.PlatformQuotaPeriodStart = newStart
	}
}

// ListPlatformChannelUsage returns per-tenant platform-channel quota usage.
func ListPlatformChannelUsage(c *gin.Context) {
	plans, err := model.GetAllTenantPlans()
	if err != nil {
		common.ApiError(c, err)
		return
	}

	rows := make([]PlatformChannelUsageRow, 0, len(plans))
	for i := range plans {
		applyEffectivePlatformQuota(&plans[i])
		p := plans[i]
		if p.TenantId <= 0 {
			continue
		}
		name := ""
		if tenant := model.GetTenantById(p.TenantId); tenant != nil {
			name = tenant.Name
		}
		rows = append(rows, PlatformChannelUsageRow{
			TenantId:            p.TenantId,
			TenantName:          name,
			PlanName:            p.PlanName,
			PlatformQuotaCap:    p.PlatformQuotaCap,
			PlatformQuotaUsed:   p.PlatformQuotaUsed,
			PlatformQuotaPeriod: p.PlatformQuotaPeriod,
			PeriodStart:         p.PlatformQuotaPeriodStart,
		})
	}

	common.ApiSuccess(c, rows)
}

// ResetPlatformChannelUsage zeros out the current platform-channel usage.
func ResetPlatformChannelUsage(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "invalid tenant id")
		return
	}
	if tenant := model.GetTenantById(id); tenant == nil {
		common.ApiErrorMsg(c, "tenant not found")
		return
	}
	if err := model.WithTenantBypass(model.DB).Model(&model.TenantPlan{}).
		Where("tenant_id = ?", id).
		Updates(map[string]interface{}{
			"platform_quota_used":         0,
			"platform_quota_period_start": 0,
		}).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	model.BroadcastInvalidateTenantPlan(id)
	common.ApiSuccess(c, gin.H{"ok": true})
}
